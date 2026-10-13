#!/usr/bin/env python3
import argparse
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

UNIT_RULES = [
    ('whisk', 21),
    ('amarula', 23),
    ('best cream', 23),
    ('konyagi small', 24),
    ('konyagi big', 12),
    ('water', 12),
    ('drink', 12),
    ('life way', 12),
    ('power', 12),
    ('red bull', 12),
    ('lager', 24),
    ('black label', 24),
    ('castle', 24),
    ('budweiser', 24),
    ('corona', 24),
    ('heineken', 24),
    ('windhoek', 24),
    ('mossi', 24),
    ('msi', 24),
    ('stella', 24),
]


def infer_units_per_container(name: str) -> int:
    value = name.lower().strip()
    for key, units in UNIT_RULES:
        if key in value:
            return units
    return 1


def safe_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
        if math.isfinite(number):
            return number
    except (TypeError, ValueError):
        pass
    return None


def postprocess_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    processed: List[Dict[str, Any]] = []
    for row in rows:
        name = str(row.get('name', '')).strip()
        selling_price = safe_number(row.get('selling_price')) or 0
        amount = safe_number(row.get('amount'))
        units_per_container = infer_units_per_container(name)
        buying_price = 0.0
        quantity = 0

        if amount is not None and units_per_container > 0:
            buying_price = round(amount / units_per_container, 2)

        if amount is not None and selling_price > 0:
            quantity = round(amount / selling_price)

        processed.append({
            'name': name,
            'selling_price': selling_price,
            'amount': amount,
            'buying_price': buying_price,
            'quantity': quantity,
            'units_per_container': units_per_container,
        })
    return processed


def validate_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    for index, row in enumerate(rows):
        row_issues: List[str] = []
        name = str(row.get('name', '')).strip()
        selling_price = safe_number(row.get('selling_price'))
        amount = safe_number(row.get('amount'))

        if not name:
            row_issues.append('Missing product name')
        if selling_price is None or selling_price <= 0:
            row_issues.append('Missing or invalid selling price')
        if amount is not None and amount <= 0:
            row_issues.append('Invalid amount')

        if row_issues:
            issues.append({'row': index + 1, 'name': name, 'issues': row_issues})

    return issues


def deskew_image(input_path: Path, output_path: Optional[Path] = None) -> Path:
    image = cv2.imread(str(input_path))
    if image is None:
        raise FileNotFoundError(f'Unable to read image: {input_path}')

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(thresh < 255))
    if coords.size == 0:
        output = output_path or input_path
        cv2.imwrite(str(output), image)
        return output

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle

    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(image, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    contrasted = cv2.convertScaleAbs(rotated, alpha=1.3, beta=15)
    denoised = cv2.medianBlur(contrasted, 3)

    output = output_path or input_path
    cv2.imwrite(str(output), denoised)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description='OCR stock import pipeline helper')
    parser.add_argument('--mode', choices=['preprocess', 'postprocess', 'validate'], default='postprocess')
    parser.add_argument('--input', required=True, help='Input path (image for preprocess, JSON for postprocess/validate)')
    parser.add_argument('--output', help='Output file path (optional)')

    args = parser.parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else None

    if args.mode == 'preprocess':
        result = deskew_image(input_path, output_path)
        print(str(result))
        return

    if not input_path.exists():
        raise FileNotFoundError(f'Input file not found: {input_path}')

    with input_path.open('r', encoding='utf-8') as handle:
        rows = json.load(handle)

    if args.mode == 'postprocess':
        result = postprocess_rows(rows)
    else:
        result = validate_rows(rows)

    output = output_path or Path('-')
    if str(output) == '-':
        print(json.dumps(result, indent=2))
    else:
        with output.open('w', encoding='utf-8') as handle:
            json.dump(result, handle, indent=2)


if __name__ == '__main__':
    main()
