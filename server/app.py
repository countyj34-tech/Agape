from fastapi import FastAPI, File, HTTPException, UploadFile, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Tuple
import base64
import os
from pathlib import Path
import re
from io import BytesIO
import json
import urllib.parse
import urllib.request
import pandas as pd
import fitz
import numpy as np
import cv2


def load_root_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_root_env()


def supabase_service_key() -> str:
    return os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY") or ""


def supabase_url() -> str:
    return os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or ""


def supabase_rest_get(path_with_query: str) -> list:
    base = supabase_url().rstrip("/")
    key = supabase_service_key()
    if not base or not key:
        raise HTTPException(status_code=503, detail="Supabase service role not configured on server")

    url = f"{base}/rest/v1/{path_with_query}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else []
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=exc.code, detail=detail or str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def require_master_session(x_master_session: Optional[str]) -> None:
    if x_master_session != "true":
        raise HTTPException(status_code=403, detail="Master session required")


# Import the extraction helper from the automation package. If missing, import will raise.
from bar_automation.stage2_extract import get_data


def parse_float(value: object) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        v = value.strip().replace(",", ".")
        v = re.sub(r"[^0-9.\-]", "", v)
        try:
            return float(v) if v not in ("", "-") else None
        except ValueError:
            return None
    return None


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def find_columns(columns: List[str], keys: List[str]) -> List[str]:
    matches: List[str] = []
    lower_columns = [c.lower() for c in columns]
    for key in keys:
        for idx, column in enumerate(lower_columns):
            if key in column and columns[idx] not in matches:
                matches.append(columns[idx])
    return matches


def extract_from_table(df: pd.DataFrame) -> Optional[Tuple[str, float]]:
    if df.empty:
        return None

    item_headers = ['item', 'product', 'name', 'description', 'item name']
    amount_headers = ['amount', 'total', 'price', 'qty', 'quantity', 'cost', 'value']
    candidate_item_cols = find_columns(list(df.columns), item_headers)
    candidate_amount_cols = find_columns(list(df.columns), amount_headers)

    rows = df.to_dict(orient='records')

    for row in rows:
        item = ''
        for col in candidate_item_cols:
            item = normalize_text(row.get(col))
            if item:
                break

        if not item:
            for key, value in row.items():
                if isinstance(value, str) and any(char.isalpha() for char in value):
                    if len(value.strip()) > 2:
                        item = value.strip()
                        break

        amount = None
        for col in candidate_amount_cols:
            amount = parse_float(row.get(col))
            if amount is not None:
                break

        if amount is None:
            for key, value in row.items():
                parsed = parse_float(value)
                if parsed is not None:
                    amount = parsed
                    break

        if item and amount is not None and amount > 0:
            return item, amount

    return None


def extract_from_text(text: str) -> Optional[Tuple[str, float]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        # find numbers in the line, take the last as amount
        nums = re.findall(r'[0-9][0-9,\.]*', line)
        if nums:
            amount = parse_float(nums[-1])
            item = re.sub(r'[0-9][0-9,\.]*', '', line).strip()
            if item and amount is not None and amount > 0:
                return item, amount

        # fallback: split on large whitespace or tabs/commas
        parts = re.split(r'\s{2,}|\t|,', line)
        if len(parts) >= 2:
            for i in range(len(parts) - 1):
                item = normalize_text(parts[i])
                amount = parse_float(parts[-1])
                if item and amount is not None and amount > 0:
                    return item, amount

    # last resort: collect any single numeric value across lines
    all_numbers: List[float] = []
    for line in lines:
        for token in re.findall(r'[0-9][0-9,\.]*', line):
            parsed = parse_float(token)
            if parsed is not None:
                all_numbers.append(parsed)
    if len(all_numbers) == 1 and lines:
        text_line = lines[0]
        item = re.sub(r'[0-9,\.]+', '', text_line).strip()
        if item:
            return item, all_numbers[0]

    return None


def extract_from_pdf(content: bytes) -> Optional[Tuple[str, float]]:
    try:
        document = fitz.open(stream=content, filetype='pdf')
    except Exception:
        return None
    text_parts: List[str] = []
    for page in document:
        try:
            text_parts.append(page.get_text('text'))
        except Exception:
            continue
    return extract_from_text('\n'.join(text_parts))


def extract_from_spreadsheet(content: bytes, filename: str) -> Optional[Tuple[str, float]]:
    try:
        if filename.lower().endswith('.csv'):
            df = pd.read_csv(BytesIO(content))
        else:
            df = pd.read_excel(BytesIO(content), engine='openpyxl')
    except Exception:
        return None
    return extract_from_table(df)


def extract_from_image(content: bytes) -> Optional[Tuple[str, float]]:
    image_data = np.frombuffer(content, dtype=np.uint8)
    image = cv2.imdecode(image_data, cv2.IMREAD_COLOR)
    if image is None:
        return None
    rows = get_data(image)
    for row in rows:
        item_name = normalize_text(row.get('name'))
        total_amount = parse_float(row.get('total_amount'))
        if item_name and total_amount is not None and total_amount > 0:
            return item_name, total_amount
    return None


def compute_refill_quantity(item_name: str, total_amount: float) -> float:
    """
    Calculate refill quantity (units) from total amount using product divisor rules.
    Divisor = cost per unit, so units = total_amount / divisor.
    
    Product Categories:
    - Cream/Premium liqueurs (Amarula, Best Cream): 23 units per reference amount
    - Spirits (Konyagi): 24 units (small) or 12 units (big)
    - Beer/Lagers: 24 units per reference amount
    - Water/Soft drinks: 12 units per reference amount
    - Utensils/Whisks: 21 units per reference amount
    - Other items: 24 units (default)
    """
    item_name = item_name.lower().strip()
    
    # Map keywords to divisors (cost per unit)
    divisor_map = {
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
        'konyagi': 12,  # Default to big if not specified
        'whisks': 21,
        'whisk': 21,
    }
    
    divisor = 24  # Default divisor
    
    # Match the most specific term first
    for key in sorted(divisor_map.keys(), key=len, reverse=True):
        if key in item_name:
            divisor = divisor_map[key]
            break
    
    if total_amount <= 0:
        return 0
    
    return round(total_amount / divisor, 2)


class PipelineFile(BaseModel):
    fileName: str
    mimeType: str
    fileBase64: str


class PipelineRequest(BaseModel):
    files: List[PipelineFile]


class PipelineResponse(BaseModel):
    rows: List[dict]


app = FastAPI(
    title="Bar Sales Sheet Pipeline",
    description="FastAPI backend for handwritten bar sales sheet extraction.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/pipeline/health")
async def pipeline_health():
    return {"status": "ok", "supabase": bool(supabase_url() and supabase_service_key())}


@app.get("/api/master/catalog")
async def master_catalog(x_master_session: Optional[str] = Header(default=None, alias="X-Master-Session")):
    """Load all remote companies/stores/product counts using service role (dev master workflow)."""
    require_master_session(x_master_session)

    companies = supabase_rest_get("companies?select=*&order=name.asc")
    stores = supabase_rest_get("stores?select=*")

    store_ids = [str(s.get("id")) for s in stores if s.get("id")]
    product_count_by_store: dict[str, int] = {}

    for store_id in store_ids:
        encoded = urllib.parse.quote(f"store_id.eq.{store_id}")
        rows = supabase_rest_get(f"products?select=id&{encoded}")
        product_count_by_store[store_id] = len(rows) if isinstance(rows, list) else 0

    summaries = []
    for company in companies:
        company_id = str(company.get("id", ""))
        company_stores = [s for s in stores if str(s.get("company_id", "")) == company_id]
        store_summaries = [
            {
                **store,
                "productCount": product_count_by_store.get(str(store.get("id")), 0),
            }
            for store in company_stores
        ]
        store_summaries.sort(key=lambda s: s.get("productCount", 0), reverse=True)
        product_count = sum(s.get("productCount", 0) for s in store_summaries)
        summaries.append(
            {
                **company,
                "productCount": product_count,
                "storeCount": len(store_summaries),
                "stores": store_summaries,
                "source": "cloud",
            }
        )

    summaries.sort(key=lambda c: c.get("productCount", 0), reverse=True)
    return {"companies": summaries, "cloudConnected": True}


@app.get("/api/master/products")
async def master_products(
    store_id: str,
    company_id: Optional[str] = None,
    x_master_session: Optional[str] = Header(default=None, alias="X-Master-Session"),
):
    require_master_session(x_master_session)
    if not store_id:
        raise HTTPException(status_code=400, detail="store_id is required")

    encoded = urllib.parse.quote(f"store_id.eq.{store_id}")
    rows = supabase_rest_get(f"products?select=*&{encoded}")
    if (not rows) and company_id:
        encoded_company = urllib.parse.quote(f"company_id.eq.{company_id}")
        rows = supabase_rest_get(f"products?select=*&{encoded_company}")

    return {"products": rows if isinstance(rows, list) else [], "cloudCount": len(rows) if isinstance(rows, list) else 0}


@app.post("/api/pipeline/process", response_model=PipelineResponse)
async def process_pipeline(request: PipelineRequest):
    if not request.files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    results: List[dict] = []
    for file in request.files:
        if not file.fileBase64:
            raise HTTPException(status_code=400, detail=f"No file data for {file.fileName}")

        file_base64 = file.fileBase64
        if file_base64.startswith("data:") and "," in file_base64:
            file_base64 = file_base64.split(",", 1)[1]
        file_base64 = file_base64.strip()

        try:
            content = base64.b64decode(file_base64, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Unable to decode base64 file data") from exc

        image_data = np.frombuffer(content, dtype=np.uint8)
        image = cv2.imdecode(image_data, cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=400, detail=f"Unable to decode uploaded image: {file.fileName}")

        try:
            rows = get_data(image)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        results.extend(rows)

    invalid_rows = [
        {"index": index, "field": "buying_price", "name": row.get("name", "")}
        for index, row in enumerate(results)
        if row.get("buying_price") == 0
    ]

    if invalid_rows:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "buying_price_zero",
                "fields": [item["field"] for item in invalid_rows],
                "rows": invalid_rows,
            },
        )

    return {"rows": results}


@app.post('/api/inventory/refill')
async def inventory_refill(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail='File name is required')

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail='Uploaded file is empty')

    suffix = Path(file.filename).suffix.lower()
    parse_result: Optional[Tuple[str, float]] = None
    source = 'unknown'

    image_extensions = {'.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tif', '.tiff'}
    if suffix in image_extensions or (file.content_type and file.content_type.startswith('image/')):
        parse_result = extract_from_image(content)
        source = 'image'
    elif suffix in {'.xls', '.xlsx', '.csv'}:
        parse_result = extract_from_spreadsheet(content, file.filename)
        source = 'spreadsheet'
    elif suffix == '.pdf' or (file.content_type and file.content_type == 'application/pdf'):
        parse_result = extract_from_pdf(content)
        source = 'pdf'
    else:
        raise HTTPException(status_code=400, detail=f'Unsupported file type: {suffix}')

    if not parse_result:
        raise HTTPException(status_code=422, detail=f'Unable to extract item name and amount from {source}')

    item_name, total_amount = parse_result
    refill_quantity = compute_refill_quantity(item_name, total_amount)
    if refill_quantity <= 0:
        raise HTTPException(status_code=422, detail='Unable to compute refill quantity from extracted data')

    return {
        'item_name': item_name,
        'refill_quantity': refill_quantity,
    }
