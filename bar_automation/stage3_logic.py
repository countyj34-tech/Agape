from typing import Any


def _safe_number(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        if isinstance(value, str):
            value = value.strip().replace(',', '.')
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def apply_rules(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []

    final_rows: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get('name') or row.get('Name') or '').strip()
        total_amount = _safe_number(row.get('total_amount') or row.get('TotalAmount') or row.get('amount'))
        selling_price = _safe_number(row.get('selling_price') or row.get('sellingPrice') or row.get('unit_price') or row.get('price'))
        quantity = _safe_number(row.get('quantity') or row.get('qty') or row.get('units'))
        buying_price = _safe_number(row.get('buying_price') or row.get('buyingPrice'))

        if buying_price == 0 and total_amount > 0 and quantity > 0:
            buying_price = total_amount / quantity

        final_rows.append({
            'name': name,
            'buyingPrice': str(round(buying_price, 2)),
            'sellingPrice': str(round(selling_price, 2)),
            'quantity': str(int(quantity if quantity > 0 else 0)),
            'totalAmount': str(round(total_amount, 2)),
            'requiresManualReview': bool(row.get('requires_manual_review') or row.get('requiresManualReview') or buying_price == 0),
        })

    return final_rows
