import { useEffect, useId, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (barcode: string) => void | Promise<void>;
};

type CameraOption = {
  id: string;
  label?: string;
};

export function BarcodeScannerDialog({ open, onOpenChange, onDetected }: Props) {
  const regionId = useId();
  const manualInputId = `manual-barcode-${regionId}`;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const startTokenRef = useRef(0);
  const detectedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const onOpenChangeRef = useRef(onOpenChange);

  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) {
      setManual('');
      setError(null);
      setStarting(false);
      setCameras([]);
      setSelectedCameraId(null);
      detectedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    if (!window.isSecureContext) {
      setError(
        'Camera access requires HTTPS. If you are using a phone, open the app over HTTPS or install the PWA. Manual entry will still work.'
      );
      return;
    }

    const initCameraSelection = async () => {
      setError(null);

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;

        const detected = devices
          .filter((device) => device.kind === 'videoinput')
          .map((device) => ({ id: device.deviceId, label: device.label }));

        setCameras(detected);

        setSelectedCameraId((current) => {
          if (current) return current;

          const isMobile =
            typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
          if (isMobile) {
            return '__environment__';
          }

          const remembered = (() => {
            try {
              return localStorage.getItem('pos:scannerCameraId');
            } catch {
              return null;
            }
          })();

          const byId = new Set(detected.map((camera) => camera.id));
          const preferredFromMemory = remembered && byId.has(remembered) ? remembered : null;
          const bestByLabel = detected.find((camera) => /back|rear|environment/i.test(camera.label ?? ''))?.id ?? null;
          const fallback = detected[detected.length - 1]?.id ?? null;

          const cameraId = preferredFromMemory ?? bestByLabel ?? fallback;
          if (!cameraId) {
            setError('No camera found. Please allow camera permission or use manual entry.');
            return null;
          }

          return cameraId;
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError('Failed to access cameras. Please allow camera permission or use manual entry.');
        }
      }
    };

    void initCameraSelection();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedCameraId) return;

    let cancelled = false;
    const token = ++startTokenRef.current;

    const stopScanner = () => {
      if (frameRef.current !== null) {
        window.clearTimeout(frameRef.current);
        frameRef.current = null;
      }

      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
          video.srcObject = null;
        } catch {
          // ignore
        }
      }
    };

    const startScanner = async () => {
      setStarting(true);
      setError(null);
      detectedRef.current = false;

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not supported in this browser.');
        }

        if (!(window as any).BarcodeDetector) {
          throw new Error('This browser does not support camera barcode detection. Use manual entry instead.');
        }

        try {
          localStorage.setItem('pos:scannerCameraId', selectedCameraId);
        } catch {
          // ignore
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) {
          throw new Error('Scanner view is not ready yet. Please try again.');
        }

        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });

        const constraints: MediaStreamConstraints = {
          audio: false,
          video:
            selectedCameraId === '__environment__' || selectedCameraId === '__user__'
              ? { facingMode: { ideal: selectedCameraId === '__environment__' ? 'environment' : 'user' } }
              : { deviceId: { exact: selectedCameraId } },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled || token !== startTokenRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;

        await new Promise<void>((resolve) => {
          if (video.readyState >= 1) {
            resolve();
            return;
          }
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        });

        if (cancelled || token !== startTokenRef.current) {
          stopScanner();
          return;
        }

        try {
          await video.play();
        } catch (err) {
          const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
          if (!msg.includes('aborterror')) {
            throw err;
          }
          return;
        }

        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          throw new Error('Unable to prepare scanner canvas.');
        }

        const scanFrame = async () => {
          if (cancelled || token !== startTokenRef.current) return;

          const width = video.videoWidth;
          const height = video.videoHeight;
          if (!width || !height) {
            frameRef.current = window.setTimeout(scanFrame, 150);
            return;
          }

          canvas.width = width;
          canvas.height = height;
          context.drawImage(video, 0, 0, width, height);

          try {
            const results = await detector.detect(canvas);
            const barcode = results[0]?.rawValue?.trim();
            if (barcode && !detectedRef.current) {
              detectedRef.current = true;
              stopScanner();
              onOpenChangeRef.current(false);
              await onDetectedRef.current(barcode);
              return;
            }
          } catch {
            // Ignore decode misses and keep scanning.
          }

          frameRef.current = window.setTimeout(scanFrame, 150);
        };

        frameRef.current = window.setTimeout(scanFrame, 0);
      } catch (e) {
        console.error(e);
        const msg = String((e as any)?.message ?? '');
        const normalized = msg.toLowerCase();
        if (normalized.includes('aborterror') || normalized.includes('timeout starting video source')) {
          return;
        }
        if (normalized.includes('permission') || normalized.includes('notallowed')) {
          setError('Camera permission denied. Please allow camera access and try again, or use manual entry.');
        } else {
          setError(
            msg
              ? `Failed to start camera scanner: ${msg}`
              : 'Failed to start camera scanner. Use manual entry instead.'
          );
        }
      } finally {
        if (!cancelled && token === startTokenRef.current) {
          setStarting(false);
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      startTokenRef.current += 1;
      detectedRef.current = false;
      stopScanner();
    };
  }, [open, selectedCameraId]);

  const submitManual = async () => {
    const barcode = manual.trim();
    if (!barcode) {
      toast.error('Enter a barcode');
      return;
    }
    onOpenChange(false);
    await onDetected(barcode);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan Barcode</DialogTitle>
          <DialogDescription className="sr-only">
            Scan a barcode using the camera or enter a barcode manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {cameras.length > 1 && (
            <div className="space-y-2">
              <Label>Camera</Label>
              <Select
                value={selectedCameraId ?? ''}
                onValueChange={(v) => {
                  setSelectedCameraId(v);
                  try {
                    localStorage.setItem('pos:scannerCameraId', v);
                  } catch {
                    // ignore
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((camera) => (
                    <SelectItem key={camera.id} value={camera.id}>
                      {camera.label?.trim() ? camera.label : camera.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="relative overflow-hidden rounded-md border bg-black">
            <video ref={videoRef} className="h-[320px] w-full object-cover" muted playsInline autoPlay />
            <canvas ref={canvasRef} className="hidden" />

            {starting && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
                Starting camera…
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-2">
            <Label htmlFor={manualInputId}>Manual entry</Label>
            <div className="flex gap-2">
              <Input
                id={manualInputId}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Type barcode"
                inputMode="numeric"
                autoComplete="off"
              />
              <Button onClick={submitManual}>Add</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
