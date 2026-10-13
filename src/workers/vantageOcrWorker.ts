import { createWorker } from 'tesseract.js';

type VantageWorkerMessage = {
  requestId: string;
  file: File;
  endpoints: string[];
  prompt?: string;
};

const workerScope = self as DedicatedWorkerGlobalScope;

function postProgress(requestId: string, progress: number, status: string) {
  workerScope.postMessage({ requestId, type: 'progress', progress, status });
}

function normalizeRowsFromText(text: string) {
  const rows: Array<{ name: string; selling_price: number; amount?: number }> = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;

    const priceMatches = cleaned.match(/(\d+[.,]?\d*)/g) || [];
    let sellingPrice = 0;
    let amount: number | undefined;

    if (priceMatches.length >= 2) {
      // Assume format: name ... unit_price ... amount
      sellingPrice = Number(priceMatches[priceMatches.length - 2].replace(',', '.'));
      amount = Number(priceMatches[priceMatches.length - 1].replace(',', '.'));
    } else if (priceMatches.length === 1) {
      sellingPrice = Number(priceMatches[0].replace(',', '.'));
    }

    const name = cleaned.replace(/(\d+[.,]?\d*\s*)+$/g, '').trim() || cleaned;
    const entry: { name: string; selling_price: number; amount?: number } = {
      name,
      selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
    };
    if (amount !== undefined && Number.isFinite(amount)) entry.amount = amount;
    rows.push(entry);
  }

  return rows;
}

async function bufferToDataUrl(buffer: ArrayBuffer, mimeType = 'application/octet-stream') {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function fileToDataUrl(file: File) {
  return bufferToDataUrl(await file.arrayBuffer(), file.type || 'application/octet-stream');
}

async function preprocessImageFile(file: File) {
  try {
    const imgBitmap = await createImageBitmap(file as any);
    const targetWidth = Math.min(2500, Math.max(1200, imgBitmap.width * 1.8));
    const scale = targetWidth / imgBitmap.width;
    const targetHeight = Math.round(imgBitmap.height * scale);

    const off = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = off.getContext('2d');
    if (!ctx) return await fileToDataUrl(file);

    ctx.drawImage(imgBitmap, 0, 0, targetWidth, targetHeight);

    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      let v = 0.299 * r + 0.587 * g + 0.114 * b;
      v = ((v - 128) * 1.45) + 128;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v));
    }
    ctx.putImageData(imgData, 0, 0);

    const imgData2 = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const d2 = imgData2.data;
    for (let i = 0; i < d2.length; i += 4) {
      const v = d2[i];
      const t = v > 175 ? 255 : 0;
      d2[i] = d2[i + 1] = d2[i + 2] = t;
    }
    ctx.putImageData(imgData2, 0, 0);

    const skewAngle = estimateSkewAngle(ctx, targetWidth, targetHeight);
    let processedCanvas = off;
    if (Math.abs(skewAngle) > 0.5) {
      const rotated = new OffscreenCanvas(targetWidth, targetHeight);
      const rotatedCtx = rotated.getContext('2d');
      if (rotatedCtx) {
        rotatedCtx.translate(targetWidth / 2, targetHeight / 2);
        rotatedCtx.rotate(-skewAngle * Math.PI / 180);
        rotatedCtx.drawImage(off, -targetWidth / 2, -targetHeight / 2);
        processedCanvas = rotated;
      }
    }

    const blob = await processedCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return await bufferToDataUrl(await blob.arrayBuffer(), blob.type || 'image/jpeg');
  } catch {
    return await fileToDataUrl(file);
  }
}

async function runLocalOcrInternal(requestId: string, file: File) {
  postProgress(requestId, 0.75, 'Running local OCR fallback');

  let processedBlob: Blob | null = null;
  try {
    const preprocessedDataUrl = await preprocessImageFile(file);
    const response = await fetch(preprocessedDataUrl);
    processedBlob = await response.blob();
  } catch (err) {
    processedBlob = file;
  }

  const worker = await createWorker('eng', 1, {
    logger: (message) => {
      const progress = typeof message.progress === 'number' ? message.progress : 0;
      postProgress(requestId, 0.75 + Math.min(0.2, progress * 0.2), message.status || 'Local OCR in progress');
    },
  });

  try {
    const inputForTess = processedBlob instanceof Blob ? processedBlob : file;
    try {
      await (worker as any).setParameters?.({ tessedit_pageseg_mode: '6' });
    } catch {
      // ignore unsupported parameters
    }

    const result = await worker.recognize(inputForTess as Blob);
    const data = (result as any)?.data || {};
    const text = String(data.text || '');
    const words = Array.isArray(data.words) ? data.words : (Array.isArray(data.symbols) ? data.symbols : []);
    const rows = normalizeRowsFromText(text);
    return { rows, rawText: text, words };
  } finally {
    try {
      await worker.terminate();
    } catch {
      // ignore
    }
  }
}

function estimateSkewAngle(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  let count = 0;
  for (let y = 0; y < height; y += 6) {
    for (let x = 0; x < width; x += 6) {
      const idx = (y * width + x) * 4;
      if (data[idx] < 128) {
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumXY += x * y;
        count += 1;
      }
    }
  }
  if (count < 10) return 0;
  const meanX = sumX / count;
  const meanY = sumY / count;
  const denom = sumXX - count * meanX * meanX;
  if (Math.abs(denom) < 1e-6) return 0;
  const slope = (sumXY - count * meanX * meanY) / denom;
  return Math.atan(slope) * (180 / Math.PI);
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(jpe?g|png|bmp|gif|webp|tiff?)$/i.test(file.name);
}

async function runLocalOcr(requestId: string, file: File) {
  if (!isImageFile(file)) {
    throw new Error(`Local OCR fallback only supports image files. ${file.name} is not a supported image.`);
  }

  const result = await runLocalOcrInternal(requestId, file);
  postProgress(requestId, 0.98, 'Local OCR complete');
  workerScope.postMessage({ requestId, type: 'result', rows: result.rows, rawText: result.rawText, words: result.words });
}

workerScope.onmessage = async (event: MessageEvent<VantageWorkerMessage>) => {
  const { requestId, file, endpoints, prompt } = event.data;

  try {
    postProgress(requestId, 0.05, 'Preparing upload');

    // For images: send as data URL. For PDFs/DOCX/TXT: send raw base64 and let backend handle extraction.
    const lowerName = String(file.name || '').toLowerCase();
    let payload: any = {};
    if (file.type.startsWith('image/')) {
      const imageBase64 = await preprocessImageFile(file);
      payload = { imageBase64, fileName: file.name || 'image.jpg', mimeType: file.type || 'application/octet-stream' };
    } else {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let b64 = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const fileBase64 = btoa(b64);
      payload = { fileBase64, fileName: file.name || 'file.bin', mimeType: file.type || 'application/octet-stream' };
    }

    postProgress(requestId, 0.25, 'Uploading image');

    let lastError = 'OCR request failed';
    let remoteSucceeded = false;

    for (const endpoint of endpoints && endpoints.length > 0 ? endpoints : []) {
      postProgress(requestId, 0.25, `Uploading image to ${endpoint}`);

      try {
        const bodyPayload = {
          ...payload,
          prompt,
        };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });

        postProgress(requestId, 0.7, 'Waiting for OCR results');

        if (response.ok) {
          let data: any;
          try {
            data = await response.json();
          } catch (err) {
            const text = await response.text().catch(() => '');
            postProgress(requestId, 0.95, 'Parsing response');
            workerScope.postMessage({ requestId, type: 'error', error: `Invalid JSON response from OCR endpoint: ${text}` });
            return;
          }

          // If backend returned an error object, treat it as failure
          if (data && typeof data === 'object' && (data.error || data.message)) {
            const errMsg = String(data.error || data.message || JSON.stringify(data));
            lastError = errMsg;
            // try next endpoint
            continue;
          }

          postProgress(requestId, 0.95, 'Parsing response');
          let localResult: { rows: any; rawText: string; words: unknown[] } | null = null;
          try {
            localResult = await runLocalOcrInternal(requestId, file);
          } catch {
            // If local OCR fails after a remote success, still return the remote result.
          }

          if (localResult) {
            workerScope.postMessage({
              requestId,
              type: 'result',
              rows: data,
              rawText: localResult.rawText,
              words: localResult.words,
            });
          } else {
            workerScope.postMessage({ requestId, type: 'result', rows: data });
          }

          remoteSucceeded = true;
          return;
        }

        // Try to extract a helpful message from the response body
        const rawText = await response.text().catch(() => '');
        try {
          const parsed = JSON.parse(rawText);
          lastError = String(parsed.error || parsed.message || rawText || `OCR request failed (${response.status})`);
        } catch {
          lastError = rawText || `OCR request failed (${response.status})`;
        }

        if (!lastError.includes(String(response.status))) {
          lastError = `${lastError} (${response.status})`;
        }

        // Try the next candidate if the backend route is not available.
        if (response.status !== 404) {
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error || 'OCR request failed');
      }
    }

    if (!remoteSucceeded) {
      if (isImageFile(file)) {
        await runLocalOcr(requestId, file);
        return;
      }
      workerScope.postMessage({
        requestId,
        type: 'error',
        error: `Remote OCR failed for non-image file ${file.name}: ${lastError}`,
      });
      return;
    }

    workerScope.postMessage({ requestId, type: 'error', error: lastError });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      type: 'error',
      error: error instanceof Error ? error.message : 'OCR worker failed',
    });
  }
};

export {};
