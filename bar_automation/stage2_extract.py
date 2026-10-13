import base64
import json
import os
import re
import tempfile
from typing import Any

try:
    import google.generativeai as genai
except ImportError:  # pragma: no cover
    genai = None

SYSTEM_PROMPT = """
You are an advanced Bar Sales Document AI. Your task is to process the attached sales sheet.

STRICT INSTRUCTIONS:
1. Extract data into a JSON array of objects.
2. MANDATORY FIELDS: "name", "total_amount", "selling_price", "quantity", "buying_price".
3. CALCULATE "buying_price": Use the provided BUSINESS RULES to divide "total_amount" by the unit divisor.
4. VALIDATION: If "total_amount" is missing or unreadable, set "buying_price" to 0 and add a flag "requires_manual_review": true.

BUSINESS RULES (Divisors):
- Whisks: 21
- Amarula, Best Cream: 23
- Lagers: 24
- Water, Drinks, Life Way: 12
- Konyagi Small: 24
- Konyagi Big: 12

OUTPUT FORMAT:
Return ONLY clean, minified JSON. No Markdown formatting, no code blocks, no introductory text.
Example: [{"name":"Mosi","total_amount":500,"selling_price":30,"quantity":24,"buying_price":20.83}]
"""


def _encode_image(image: Any) -> str:
    import cv2

    success, encoded = cv2.imencode('.jpg', image)
    if not success or encoded is None:
        raise ValueError('Unable to encode cleaned image for extraction.')
    return base64.b64encode(encoded.tobytes()).decode('utf-8')


def _sanitize_output(raw_text: str) -> str:
    cleaned = raw_text.replace('```json', '').replace('```', '').strip()
    cleaned = re.sub(r'^\s*```[a-zA-Z0-9_-]*\s*', '', cleaned, flags=re.I)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned, flags=re.I)
    cleaned = cleaned.strip()

    if not cleaned:
        return cleaned

    array_match = re.search(r'(\[.*\])', cleaned, re.S)
    if array_match:
        return array_match.group(1)

    object_match = re.search(r'(\{.*\})', cleaned, re.S)
    if object_match:
        return object_match.group(1)

    return cleaned


DIVISOR_MAP = {
    'amarula': 23,
    'best cream': 23,
    'cream': 23,
    'lagers': 24,
    'beer': 24,
    'water': 12,
    'soft drink': 12,
    'drinks': 12,
    'coca': 12,
    'fanta': 12,
    'sprite': 12,
    'life way': 12,
    'konyagi small': 24,
    'konyagi big': 12,
    'konyagi': 12,
    'whisks': 21,
    'whisk': 21,
}


def calculate_buying_price(item_name: str, total_amount: float) -> float:
    """
    Calculate buying price from total amount using product divisor rules.
    Divisor = cost per unit, so buying_price = total_amount / divisor.
    """
    name = item_name.lower().strip()
    divisor = 24  # Default
    
    # Match longest key first for specificity
    for key in sorted(DIVISOR_MAP.keys(), key=len, reverse=True):
        if key in name:
            divisor = DIVISOR_MAP[key]
            break
    
    if total_amount <= 0:
        return 0.0
    
    return round(total_amount / divisor, 2)


def _normalize_row(entry: Any) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None

    def safe_number(value: Any) -> float | None:
        if value is None:
            return None
        try:
            if isinstance(value, str):
                value = value.replace(',', '.')
            number = float(value)
            return number if number == number else None
        except Exception:
            return None

    name = str(entry.get('name') or entry.get('Name') or '').strip()
    total_amount = safe_number(entry.get('total_amount') or entry.get('TotalAmount') or entry.get('amount'))
    selling_price = safe_number(entry.get('selling_price') or entry.get('sellingPrice') or entry.get('unit_price') or entry.get('price'))
    quantity = safe_number(entry.get('quantity') or entry.get('qty') or entry.get('amount') or entry.get('units'))
    buying_price = safe_number(entry.get('buying_price') or entry.get('buyingPrice'))

    if buying_price in (None, 0) and total_amount is not None:
        buying_price = calculate_buying_price(name, total_amount)

    if total_amount is None and buying_price is None:
        buying_price = 0.0

    requires_manual_review = total_amount is None or buying_price == 0

    return {
        'name': name,
        'total_amount': total_amount if total_amount is not None else 0,
        'selling_price': selling_price if selling_price is not None else 0,
        'quantity': quantity if quantity is not None else 0,
        'buying_price': buying_price if buying_price is not None else 0,
        'requires_manual_review': requires_manual_review,
    }


def get_data(clean_img: Any) -> list[dict[str, Any]]:
    api_key = os.environ.get('GOOGLE_API_KEY') or os.environ.get('GEMINI_API_KEY')
    if genai is None:
        raise ImportError(
            'google-generativeai is required for Stage 2 extraction. Install it from requirements.txt.'
        )
    if not api_key:
        raise EnvironmentError(
            'Set GOOGLE_API_KEY or GEMINI_API_KEY in your environment to use Gemini extraction.'
        )

    genai.configure(api_key=api_key)
    image_base64 = _encode_image(clean_img)

    # Use the correct API for google-generativeai 0.8.6
    model = genai.GenerativeModel('gemini-1.5-pro')
    
    # Create the content message with system prompt and image
    message = genai.types.ContentDict(
        role='user',
        parts=[
            genai.types.PartDict(text=SYSTEM_PROMPT),
            genai.types.PartDict(
                inline_data=genai.types.BlobDict(
                    mime_type='image/jpeg',
                    data=image_base64,
                )
            ),
        ]
    )
    
    response = model.generate_content(
        content=[message],
        generation_config=genai.types.GenerationConfigDict(
            max_output_tokens=1024,
        ),
    )

    raw_text = response.text
    sanitized = _sanitize_output(str(raw_text))

    try:
        parsed = json.loads(sanitized)
    except Exception as exc:
        try:
            # Sometimes the model still wraps with extra text; attempt to extract JSON again.
            extracted = _sanitize_output(sanitized)
            parsed = json.loads(extracted)
        except Exception as final_exc:
            print(f'Extraction failed: {final_exc}')
            print(f'Raw AI output: {raw_text}')
            return []

    if isinstance(parsed, dict) and 'rows' in parsed and isinstance(parsed['rows'], list):
        parsed = parsed['rows']

    if not isinstance(parsed, list):
        return []

    normalized_rows = [_normalize_row(item) for item in parsed]
    return [row for row in normalized_rows if row is not None]
