"""
Local stock-sheet extractor — OpenCV + EasyOCR (free, no Puter, no cloud API).

Usage:
  python stock_sheet_extract.py <image_path> [--sheet-type opening|closing|refill|combined] [--out out.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# Lazy EasyOCR reader (heavy to load once)
_reader = None


def get_reader():
    global _reader
    if _reader is None:
        import easyocr

        _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _reader


def preprocess_variants(image_path: str) -> list[np.ndarray]:
    """Return several cleaned versions of the photo for better OCR."""
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Unable to read image: {image_path}")

    # Upscale small phone photos
    h, w = image.shape[:2]
    if max(h, w) < 1400:
        scale = 1400 / max(h, w)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    contrast = clahe.apply(denoised)
    adaptive = cv2.adaptiveThreshold(
        contrast, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    _, otsu = cv2.threshold(contrast, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return [contrast, adaptive, otsu]


HEADER_SKIP = re.compile(
    r"^(item|product|name|description|opening|closing|refill|qty|quantity|price|amount|total|stock|s/?n|no\.?#?)$",
    re.I,
)

CANONICAL_NAMES = [
    "Black Label Small",
    "Black Label Canned",
    "Black Label Whisky",
    "Castle Lite",
    "Castle Lite Dumpy",
    "Castle Lite Canned",
    "Castle Lite Small",
    "Castle Small",
    "Castle Lager",
    "Heineken",
    "Heineken Silver",
    "Savannah",
    "Fruitree Juice",
    "Corona",
    "Windhoek Draught",
    "Windhoek Lager",
    "Breezer",
    "1340",
    "Kombutcha",
    "Kombat Big",
    "Brothers Mocktail",
    "Brutal Fruit Canned",
    "Flying Fish",
    "C.Shot",
    "Codys Vody",
    "FT Energy",
    "Disposable Drinks",
    "Hunters Gold",
    "Hunters Dry",
    "Budweiser",
    "Fruiticanna",
    "Fruiticanna Smoothie",
    "Gordons Canned",
    "Mosi Lite",
    "Mosi Small",
    "Mosi Lager",
    "Belgravia",
    "Belgravia Shots",
    "Small Kungfull",
    "Kungfull Big",
    "Mixers",
    "Amarula Big",
    "Drosdy Hof",
    "Mineral Water",
    "Red Bull",
    "Four Cousins Canned",
    "Four Cousins Bottle",
    "Power Energy",
    "Power Plus",
    "Celler Cask",
    "Celebration",
    "Chateau Canned",
    "Life Shot",
    "Nederbero",
    "Autumn Harvest",
    "Glenfiddich 12",
    "Jameson",
    "Smirnoff",
    "Absolute Vodka",
    "Tequila Silver",
    "Carling Black Label",
]

SMALL_KEEP = {
    "big",
    "small",
    "dry",
    "gold",
    "lite",
    "lager",
    "red",
    "hof",
    "ft",
    "ml",
    "can",
    "shot",
    "plus",
}

PRODUCT_WORDS = SMALL_KEEP | {
    "canned",
    "bottle",
    "juice",
    "water",
    "energy",
    "bull",
    "fish",
    "vody",
    "cask",
    "shots",
    "silver",
    "draught",
    "dumpy",
    "whisky",
    "smoothie",
    "mocktail",
    "drinks",
    "harvest",
    "cousins",
    "label",
    "fruit",
    "castle",
    "windhoek",
    "hunters",
    "black",
    "mosi",
    "brutal",
    "flying",
    "codys",
    "gordons",
    "fruiticanna",
    "fruitree",
    "belgravia",
    "amarula",
    "drosdy",
    "mineral",
    "power",
    "celler",
    "celebration",
    "chateau",
    "life",
    "nederbero",
    "autumn",
    "glenfiddich",
    "heineken",
    "savannah",
    "corona",
    "breezer",
    "kombutcha",
    "kombat",
    "brothers",
    "disposable",
    "budweiser",
    "mixers",
    "kungfull",
    "jameson",
    "smirnoff",
    "cshot",
}

OCR_TOKEN_FIXES = {
    "lte": "lite",
    "light": "lite",
    "dumpie": "dumpy",
    "dump": "dumpy",
    "dunghill": "dunhill",
    "fruiticana": "fruiticanna",
    "fruitcanna": "fruiticanna",
    "nederburg": "nederbero",
    "nederberg": "nederbero",
    "cellar": "celler",
    "cody": "codys",
    "whiskey": "whisky",
    "draft": "draught",
    "kombucha": "kombutcha",
    "kungfu": "kungfull",
}


def _norm_key(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (value or "").lower())).strip()


def _title_case(name: str) -> str:
    special = {"ft": "FT", "c.shot": "C.Shot", "cshot": "C.Shot", "ml": "ml"}
    out = []
    for token in name.split():
        lower = token.lower()
        if lower in special:
            out.append(special[lower])
        elif token.isdigit():
            out.append(token)
        else:
            out.append(token[:1].upper() + token[1:].lower())
    return " ".join(out)


def _similarity(a: str, b: str) -> float:
    na, nb = _norm_key(a), _norm_key(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0

    ta = [t for t in na.split(" ") if t]
    tb = [t for t in nb.split(" ") if t]
    set_a, set_b = set(ta), set(tb)
    inter = len(set_a & set_b)
    union = len(set_a | set_b)
    jaccard = inter / union if union else 0.0

    all_in = all(t in set_b for t in ta)
    coverage = 0.0
    if all_in and len(ta) == len(tb):
        coverage = 0.99
    elif all_in and ta:
        coverage = 0.55 + 0.35 * (len(ta) / len(tb))

    from difflib import SequenceMatcher

    lev = SequenceMatcher(None, na, nb).ratio()
    return max(jaccard, coverage, lev)


def snap_to_canonical(raw: str, min_score: float = 0.78) -> str | None:
    cleaned = scrub_raw_name(raw)
    if not cleaned:
        return None
    best = None
    best_score = 0.0
    best_len = 10**9
    for canonical in CANONICAL_NAMES:
        score = _similarity(cleaned, canonical)
        length = len(_norm_key(canonical))
        if score > best_score + 0.02 or (abs(score - best_score) <= 0.02 and length < best_len):
            best_score = score
            best = canonical
            best_len = length
    return best if best_score >= min_score else None


def _is_ocr_junk_token(token: str, lower: str) -> bool:
    if lower in PRODUCT_WORDS or lower in SMALL_KEEP or token.isdigit():
        return False
    if len(token) <= 2:
        return True
    if len(token) <= 4 and (token.isupper() or token.islower()):
        return True
    return False


def scrub_raw_name(raw: str) -> str:
    name = raw or ""
    # Strip ALL dashes/slashes/symbols including ASCII hyphen
    name = re.sub(r"[\-/\\|—–−_=~`^*+#@£$€©<>\[\]{}()\"'`,;:!?·•]+", " ", name)
    name = re.sub(r"^a\s+", "", name, flags=re.I)
    name = re.sub(r"^\d+[\).\s]+", "", name).strip()
    name = re.sub(r"\s+\d+(?:[.,]\d+)?\s*$", "", name).strip()
    name = re.sub(r"[^A-Za-z0-9\s']", " ", name)
    name = re.sub(r"\s+", " ", name).strip()

    tokens = [t for t in name.split() if t]
    kept: list[str] = []
    for i, token in enumerate(tokens):
        lower = token.lower()
        if lower in OCR_TOKEN_FIXES:
            token = OCR_TOKEN_FIXES[lower]
            lower = token.lower()
        if not re.search(r"[A-Za-z0-9]", token):
            continue
        if len(token) <= 2 and lower not in SMALL_KEEP and not token.isdigit():
            if lower not in {"c", "ft"} or i == len(tokens) - 1:
                if lower not in SMALL_KEEP:
                    continue
        is_trailing = i >= len(tokens) - 3
        if is_trailing and kept and _is_ocr_junk_token(token, lower):
            continue
        if (
            len(token) >= 3
            and not re.search(r"[aeiouAEIOU]", token)
            and not token.isdigit()
            and lower not in SMALL_KEEP
            and lower not in PRODUCT_WORDS
        ):
            continue
        kept.append(token)

    while len(kept) > 1:
        last = kept[-1]
        lower = last.lower()
        if not _is_ocr_junk_token(last, lower):
            break
        kept.pop()

    return " ".join(kept).strip()


def clean_product_name(raw: str) -> str:
    snapped = snap_to_canonical(raw, 0.78)
    if snapped:
        return snapped
    scrubbed = scrub_raw_name(raw)
    if not scrubbed:
        return ""
    soft = snap_to_canonical(scrubbed, 0.72)
    if soft:
        return soft
    titled = _title_case(scrubbed)
    return re.sub(r"\s+", " ", re.sub(r"[\-/\\|—–−_]+", " ", titled)).strip()


def parse_quantity(value: Any) -> float:
    if value is None:
        return 0.0
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    try:
        num = float(cleaned)
        return max(0.0, num) if num == num else 0.0
    except Exception:
        return 0.0


def is_valid_name(name: str) -> bool:
    if len(name) < 2:
        return False
    if HEADER_SKIP.match(name):
        return False
    if re.fullmatch(r"[\d\s.,]+", name):
        return False
    letters = len(re.findall(r"[A-Za-z]", name))
    if letters < 2:
        return False
    if letters / max(len(name), 1) < 0.3:
        return False
    symbols = len(re.findall(r"[^A-Za-z0-9\s]", name))
    if symbols > len(name) * 0.35:
        return False
    return True


def group_ocr_into_lines(results: list[tuple], y_tol: int = 18) -> list[list[tuple]]:
    """
    EasyOCR returns (bbox, text, conf).
    Group boxes that share roughly the same vertical center into table rows.
    """
    items = []
    for bbox, text, conf in results:
        if not text or not str(text).strip():
            continue
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        items.append(
            {
                "text": str(text).strip(),
                "conf": float(conf or 0),
                "x": min(xs),
                "y": (min(ys) + max(ys)) / 2,
                "w": max(xs) - min(xs),
            }
        )
    items.sort(key=lambda i: (i["y"], i["x"]))

    lines: list[list[dict]] = []
    for item in items:
        if not lines:
            lines.append([item])
            continue
        last = lines[-1]
        if abs(item["y"] - last[0]["y"]) <= y_tol:
            last.append(item)
            last.sort(key=lambda i: i["x"])
        else:
            lines.append([item])
    return lines


def line_to_row(line: list[dict], sheet_type: str) -> dict[str, Any] | None:
    texts = [p["text"] for p in line]
    joined = " ".join(texts)

    # Collect numeric tokens and name tokens
    nums: list[float] = []
    name_parts: list[str] = []
    for t in texts:
        if re.fullmatch(r"-?\d+(?:[.,]\d+)?", t.replace(",", ".")):
            nums.append(parse_quantity(t))
        else:
            # Split trailing numbers glued to words: "Jameson 12"
            m = re.match(r"^(.+?)\s+(-?\d+(?:[.,]\d+)?)$", t)
            if m and not re.search(r"[A-Za-z]", m.group(2)):
                name_parts.append(m.group(1))
                nums.append(parse_quantity(m.group(2)))
            else:
                name_parts.append(t)

    # Also try whole-line pattern
    if not nums:
        found = re.findall(r"(-?\d+(?:[.,]\d+)?)", joined)
        nums = [parse_quantity(n) for n in found]
        name_guess = re.sub(r"[\d.,]+", " ", joined)
        name_parts = [name_guess]

    name = clean_product_name(" ".join(name_parts))
    if not is_valid_name(name):
        return None
    if not nums:
        return None

    opening = closing = refill = 0.0
    if sheet_type == "opening":
        opening = nums[0]
    elif sheet_type == "closing":
        closing = nums[0]
    elif sheet_type == "refill":
        refill = nums[0]
    else:
        # combined: opening [refill] closing
        if len(nums) >= 3:
            opening, refill, closing = nums[0], nums[1], nums[2]
        elif len(nums) == 2:
            opening, closing = nums[0], nums[1]
        else:
            opening = nums[0]

    qty = opening or closing or refill
    if qty <= 0 and opening + closing + refill <= 0:
        return None

    return {
        "name": name,
        "opening": opening,
        "closing": closing,
        "refill": refill,
        "quantity": qty,
    }


def extract_from_image(image_path: str, sheet_type: str = "combined") -> list[dict[str, Any]]:
    reader = get_reader()
    variants = preprocess_variants(image_path)

    best_rows: list[dict[str, Any]] = []
    for img in variants:
        results = reader.readtext(img, detail=1, paragraph=False)
        lines = group_ocr_into_lines(results)
        rows = []
        for line in lines:
            row = line_to_row(line, sheet_type)
            if row:
                rows.append(row)
        if len(rows) > len(best_rows):
            best_rows = rows

    # Deduplicate by normalized name (keep first)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for row in best_rows:
        key = re.sub(r"\s+", " ", row["name"].lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)

    return unique


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract stock sheet rows with EasyOCR")
    parser.add_argument("image", help="Path to stock sheet image")
    parser.add_argument(
        "--sheet-type",
        default="combined",
        choices=["opening", "closing", "refill", "combined"],
    )
    parser.add_argument("--out", help="Optional JSON output path")
    args = parser.parse_args()

    path = Path(args.image)
    if not path.exists():
        print(json.dumps({"error": f"File not found: {path}", "rows": []}))
        sys.exit(1)

    try:
        rows = extract_from_image(str(path), args.sheet_type)
        payload = {"rows": rows, "method": "python-easyocr", "count": len(rows)}
    except Exception as exc:
        payload = {"rows": [], "method": "failed", "error": str(exc), "count": 0}

    text = json.dumps(payload, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
