#!/usr/bin/env python
"""Render STA sales invoices from the local Airtable record export.

The script is intentionally read-only. It consumes files under
records/Steel_Trade_Advisors, where fields are keyed by Airtable field ID.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    import reportlab
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit(
        "Missing reportlab. Install it with: python -m pip install reportlab"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RECORDS_DIR = ROOT / "records" / "Steel_Trade_Advisors"
DEFAULT_OUTPUT_DIR = ROOT / "output" / "pdf" / "invoices"
DEFAULT_BASE_ID = "appnS0geRMpHaxib9"

EURO = "\u20ac"
REGISTRY_LINE = (
    "R.M. de Madrid, Tomo 37.401 - Folio 178 - "
    "Secci\u00f3n 8 - Hoja M-666796 - Inscripci\u00f3n 1"
)
EUR_BANK_LINE = "CAIXA BANK: ES40 2100 6428 2213 0012 3884"
USD_BANK_LINE = "BANCO SANTANDER: ES23 0049 6701 1723 1616 6089"


def register_invoice_fonts() -> tuple[str, str]:
    windows_fonts = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    candidates = [
        (
            "STA-Regular",
            "STA-Bold",
            Path(reportlab.__file__).resolve().parent / "fonts" / "Vera.ttf",
            Path(reportlab.__file__).resolve().parent / "fonts" / "VeraBd.ttf",
        ),
        (
            "STA-Regular",
            "STA-Bold",
            windows_fonts / "arial.ttf",
            windows_fonts / "arialbd.ttf",
        ),
        (
            "STA-Regular",
            "STA-Bold",
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
    ]
    for regular_name, bold_name, regular_path, bold_path in candidates:
        if not regular_path.exists() or not bold_path.exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont(regular_name, str(regular_path)))
            pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
            return regular_name, bold_name
        except Exception:
            continue
    return "Helvetica", "Helvetica-Bold"


REGULAR_FONT, BOLD_FONT = register_invoice_fonts()


FACTURA = {
    "id": "fldltLIbwNuH9RWo9",
    "fecha": "fldTOhx5UyOR4IGS6",
    "valor_sin_iva": "fldpUg71bnByRXn4i",
    "iva": "fldTQQ2RMyBxPns2v",
    "descripcion": "fld7jfExgeRkJJwDw",
    "venta": "fldB6zFs0qcnmA5gO",
    "incoterm": "fldlOSfyhSnK7RE8o",
    "peso": "fld5HTNTpHqGXTgiT",
    "terminos": "fld2RZDepeJvHVo4n",
    "vencimiento": "fld47AWj5BCNOql1J",
    "cliente_nombre": "fldS9jkgx94V74CRT",
    "cliente_domicilio": "fldNvQvMgVd4swnlZ",
    "cliente_cp": "fldtZUuulg5wCPtYu",
    "cliente_municipio": "fldBR1V59yFMWf6GF",
    "cliente_provincia": "fldqeE34Dwg2UWc8c",
    "cliente_pais": "fldg47CYjDNI2t31T",
    "cliente_nif": "fldOr31AI2jXkvCou",
    "cliente_manual": "fldusDesJyM0W18A2",
    "existencias": "fld76m6DpeR3OaulN",
    "valor_venta": "fldjZ6fi8ZiCYep0n",
    "anticipo_manual": "fldkNmFM4k9Sfo6C9",
}

EXISTENCIA = {
    "id_fabrica": "fldCMmf7cTUzUmPAb",
    "uds": "fldnUz9FK7PynVPtC",
    "neto": "fldvpgxVSxQWzOv6X",
    "bruto": "fldD4itGy9e1qTIxT",
    "peso": "fldjnWnawgEqOIKgu",
    "pl": "fldKrns7X3mkA8R9a",
    "barco": "fldrdf8Hybz4oMEcd",
    "precio_venta": "fldxMzVEgXDZiTj2P",
    "valor_venta": "fldgohky23L3qMjC9",
    "descripcion": "fldCzDd5UMrc0UZo5",
    "material": "fldk6qFHHgXn1gXk2",
    "eal": "fldJpUP2JCAwmLIdo",
    "crac": "fldVtpMWSNzzXTkxs",
    "item_venta": "fld6aouedO2bl0MuG",
    "peso_cliente": "fldOeiDrQFe5AO1Rf",
    "espesor": "fldltcPdAI7UCKCIi",
    "ancho": "fldGKYFeLwtZB9nz9",
    "largo": "fldWjb44kCwH4TGxe",
    "calidad": "fldNjXUAafi0fbOzj",
    "recubrimiento": "fldU5cIV95gnhZV9D",
    "acabado": "flda4iwgVizHC4Y5t",
    "color": "fldTazhFY88OydGwE",
}

VENTA = {
    "contrato": "fldBxZ0nEJAOnGiUj",
    "numero_pedido": "fld70YdIwfeD4F1jD",
    "lugares_entrega": "fldawla61axRmkf5E",
    "items": "fldSSpBbTESUG8Z2T",
    "moneda": "fldfAYJqypZS9nIlw",
}

ITEM_VENTA = {
    "item": "fldVvxDlxNOXZ7Q0J",
    "numero_orden": "flddREJcUbhspPzBz",
    "codigo_producto": "fldgGoIGAmb2i9X3S",
    "precio_eur": "fldcg1jTAyKcxeKGC",
}

MATERIAL = {
    "codigo": "fldpB4YiAn2w8w70I",
    "nombre": "fldDclRe2H0kqZw48",
    "tipo": "fld9l2c0MW70BKlzb",
}
TIPO_MATERIAL = {"nombre": "fldYe0hoT3OWTfwA1"}
BARCO = {"nombre": "fldPOt1yGRROvj6fa"}
INCOTERM = {"nombre": "fldPX1GEsaBR4rzMd"}
TERMINO = {"nombre": "fldVtyWKQXXoz2VHc"}
CLIENTE = {
    "nombre_fiscal": "fldjf0CdOybWQATX4",
    "domicilio": "fldT27pMLegGjsla3",
    "cp": "flddWfBgfWLfYi4Gu",
    "municipio": "fldXVJQsu0EgLdUZi",
    "nif": "fldJT91Hj8W2J9C0h",
}

TABLES = {
    "facturas": "tblD7MvJnqpiqKMfm",
    "existencias": "tblOGE7nApPr8zTsZ",
    "ventas": "tbly2fHo6evAFY33X",
    "items_venta": "tblmx0d8G49Qx29LD",
    "materiales": "tbldcH54bb4nIP2Ts",
    "tipos_material": "tblVYEUxcX8xtyUsv",
    "barcos": "tblApIqakkmlO73gM",
    "incoterms": "tblynLHJbKXFrLhTc",
    "terminos": "tbl5psJrD0ezwtSzN",
    "clientes": "tbliyYuo9mWCnHGUG",
}

MATERIAL_LABELS = {
    "CRC": "COLD ROLLED STEEL COILS",
    "HRC": "HOT ROLLED STEEL COILS",
    "HRP": "HOT ROLLED PICKLED AND OILED STEEL COILS",
    "HDG": "HOT-DIP GALVANIZED STEEL COILS",
    "P&O": "HOT ROLLED PICKLED AND OILED STEEL COILS",
    "ZN-MG": "HOT-DIP ZINC ALLOYED MAGNESIUM COATED STEEL COILS",
    "PPGI": "PREPAINTED GALVANIZED STEEL COILS",
    "PPGL": "PREPAINTED HOT-DIP ALUMINIUM ZINC ALLOY COATED STEEL COILS",
    "ETP": "ELECTROLYTIC TINPLATE",
    "TFS": "TIN FREE STEEL",
}

MATERIAL_TYPE_SUFFIXES = {
    "Bobina": "COILS",
    "Fleje": "STRIPS",
    "Hoja": "SHEETS",
    "Chapa": "PLATES",
    "Chapa grande": "PLATES",
}


@dataclass
class Line:
    material: str
    dimensions: str
    quality: str
    factory_id: str
    packing: str
    quantity: float
    price: float
    amount: float
    item_id: str = ""
    item_label: str = ""
    units: float = 0.0
    thickness: str = ""
    width: str = ""
    length: str = ""
    coating: str = ""
    finish: str = ""
    color: str = ""
    order_number: str = ""
    product_code: str = ""
    net_weight: float = 0.0
    gross_weight: float = 0.0
    weight_basis: str = ""
    material_heading: str = ""


@dataclass
class DiscountLine:
    label: str
    amount: float


@dataclass
class InvoiceData:
    record_id: str
    invoice_id: str
    date_text: str
    title_label: str
    customer_lines: list[str]
    category: str
    lines: list[Line]
    subtotal: float
    vat_rate: float
    vat_amount: float
    total: float
    total_qty: float
    internal_order: str
    customer_order: str
    delivery_terms: str
    payment_terms: str
    down_payment: float
    due_date: str
    line_subtotal: float = 0.0
    discount_lines: list[DiscountLine] = field(default_factory=list)
    packing_lists: list[str] = field(default_factory=list)
    currency: str = "EUR"
    currency_symbol: str = EURO
    customer_code: str = ""
    mode: str = "detail"
    detail_lines: list[Line] = field(default_factory=list)
    weight_mode: str = "gross"


def load_table(records_dir: Path, file_name: str) -> list[dict[str, Any]]:
    path = records_dir / f"{file_name}.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing local record export: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("records", data if isinstance(data, list) else [])


def load_dotenv(path: Path | None = None) -> None:
    env_path = path or (ROOT / ".env")
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def index(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {record["id"]: record for record in records}


def airtable_request_json(
    url: str,
    token: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    request = Request(url, data=body, headers=headers, method=method)
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            with urlopen(request, timeout=45) as response:
                text = response.read().decode("utf-8")
                return json.loads(text) if text else {}
        except Exception as exc:  # pragma: no cover - network guard
            last_error = exc
            if attempt == 4:
                break
            time.sleep(0.5 * attempt)
    raise RuntimeError(f"Airtable API request failed for {url}: {last_error}")


def airtable_url(base_id: str, table_id: str, record_id: str | None = None, **params: Any) -> str:
    path = f"https://api.airtable.com/v0/{base_id}/{table_id}"
    if record_id:
        path = f"{path}/{record_id}"
    query = {"returnFieldsByFieldId": "true", **{k: v for k, v in params.items() if v is not None}}
    return f"{path}?{urlencode(query)}"


def fetch_record(base_id: str, table_id: str, record_id: str, token: str) -> dict[str, Any]:
    return airtable_request_json(airtable_url(base_id, table_id, record_id), token)


def fetch_records_by_formula(
    base_id: str, table_id: str, formula: str, token: str
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offset = None
    while True:
        url = airtable_url(
            base_id,
            table_id,
            filterByFormula=formula,
            pageSize=100,
            offset=offset,
        )
        payload = airtable_request_json(url, token)
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def fetch_records_by_ids(
    base_id: str, table_id: str, record_ids: list[str], token: str
) -> dict[str, dict[str, Any]]:
    clean_ids = list(dict.fromkeys(record_id for record_id in record_ids if record_id))
    if not clean_ids:
        return {}
    records: list[dict[str, Any]] = []
    for chunk in chunked(clean_ids, 25):
        formula = "OR(" + ",".join(f"RECORD_ID()='{record_id}'" for record_id in chunk) + ")"
        records.extend(fetch_records_by_formula(base_id, table_id, formula, token))
    return index(records)


def collect_link_ids(records: list[dict[str, Any]], field_id: str) -> list[str]:
    ids: list[str] = []
    for record in records:
        for value in values(get_field(record, field_id)):
            text = scalar_text(value)
            if text.startswith("rec"):
                ids.append(text)
    return list(dict.fromkeys(ids))


def get_field(record: dict[str, Any] | None, field_id: str, default: Any = None) -> Any:
    if not record:
        return default
    return record.get("fields", {}).get(field_id, default)


def values(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if item is not None]
    return [value]


def first(value: Any, default: Any = "") -> Any:
    vals = values(value)
    return vals[0] if vals else default


BOX_GLYPHS = {"\ufffd", "\u25a1", "\u25a0", "\u25a2", "\u25a3", "\u25fb", "\u25fc"}
ARROW_GLYPHS = {"\u2192", "\u2190", "\u2194", "\u21d2"}
DASH_GLYPHS = {"\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"}


def clean_text(value: str) -> str:
    cleaned: list[str] = []
    for char in str(value or ""):
        if char in BOX_GLYPHS:
            continue
        if char in ARROW_GLYPHS:
            cleaned.append(" - ")
            continue
        if char in DASH_GLYPHS:
            cleaned.append("-")
            continue
        category = unicodedata.category(char)
        if category.startswith("C"):
            continue
        cleaned.append(" " if category == "Zs" else char)
    text = re.sub(r"\s+", " ", "".join(cleaned)).strip()
    return "" if text in {"?", "??", "-", "--", "->"} else text


def clean_invoice_phrase(value: str) -> str:
    text = clean_text(value)
    return text.strip(" \"'“”")


def format_material_heading(name: str, material_type: str = "") -> str:
    heading = clean_text(name).upper()
    if not heading:
        return ""
    suffix = MATERIAL_TYPE_SUFFIXES.get(clean_text(material_type))
    if not suffix:
        return heading
    singular_suffix = suffix[:-1] if suffix.endswith("S") else suffix
    if heading.endswith(suffix) or heading.endswith(singular_suffix):
        return heading
    return f"{heading} {suffix}"


def material_heading_from_code(code: str) -> str:
    clean_code = clean_text(code).upper()
    return MATERIAL_LABELS.get(clean_code, clean_code).upper()


def scalar_text(value: Any, default: str = "") -> str:
    item = first(value, default)
    if isinstance(item, dict):
        if "name" in item:
            return clean_text(str(item["name"]))
        if "label" in item:
            return clean_text(str(item["label"]))
        return default
    if item is None:
        return default
    return clean_text(str(item))


def scalar_number(value: Any, default: float = 0.0) -> float:
    item = first(value, default)
    try:
        if item is None or item == "":
            return default
        if isinstance(item, dict):
            return default
        return float(item)
    except (TypeError, ValueError):
        return default


def linked_record(
    link_value: Any, records: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    linked_id = scalar_text(link_value)
    return records.get(linked_id)


def linked_text(
    link_value: Any,
    records: dict[str, dict[str, Any]],
    field_id: str,
    default: str = "",
) -> str:
    record = linked_record(link_value, records)
    return scalar_text(get_field(record, field_id), default)


def date_text(value: Any) -> str:
    raw = scalar_text(value)
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw[:10], fmt).strftime("%d/%m/%Y")
        except ValueError:
            pass
    return raw


def safe_filename(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return text.strip("_") or "invoice"


def fmt_decimal(value: float, decimals: int, grouping: bool = True) -> str:
    if not math.isfinite(value):
        value = 0.0
    quant = Decimal("1").scaleb(-decimals)
    rounded = Decimal(str(value)).quantize(quant, rounding=ROUND_HALF_UP)
    text = f"{rounded:,.{decimals}f}" if grouping else f"{rounded:.{decimals}f}"
    return text.replace(",", "X").replace(".", ",").replace("X", ".")


def fmt_money(value: float, currency_symbol: str | bool = EURO) -> str:
    if isinstance(currency_symbol, bool):
        symbol = EURO if currency_symbol else ""
    else:
        symbol = currency_symbol
    suffix = f" {symbol}" if symbol else ""
    return f"{fmt_decimal(value, 2, True)}{suffix}"


def fmt_price(value: float, currency_symbol: str | bool = EURO) -> str:
    return fmt_money(value, currency_symbol)


def fmt_measure_text(value: str) -> str:
    text = clean_text(value).replace("\u00d7", "x")
    text = re.sub(r"\s*x\s*", " x ", text)
    return re.sub(r"(?<=\d)\.(?=\d)", ",", text)


def fmt_thickness_text(value: str) -> str:
    text = clean_text(value)
    if not text:
        return ""
    normalized = text.replace(",", ".")
    try:
        parsed = float(normalized)
    except ValueError:
        return fmt_measure_text(text)
    return fmt_decimal(parsed, 2, False)


def normalize_thickness_in_measure(value: str) -> str:
    text = fmt_measure_text(value)
    return re.sub(
        r"(\d+(?:[,.]\d+)?)\s*x\s*\d+",
        lambda match: f"{fmt_thickness_text(match.group(1))}{match.group(0)[len(match.group(1)):]}",
        text,
        count=1,
        flags=re.IGNORECASE,
    )


def clean_delivery_place(value: str) -> str:
    text = clean_invoice_phrase(value)
    if " - " in text:
        text = text.split(" - ")[-1]
    return clean_invoice_phrase(text)


def format_delivery_terms(incoterm: str, delivery_places: list[str]) -> str:
    incoterm_text = clean_invoice_phrase(incoterm)
    places = [clean_delivery_place(place) for place in delivery_places]
    places = list(dict.fromkeys(place for place in places if place))
    place_text = ", ".join(places)
    if not incoterm_text:
        return place_text
    if not place_text:
        return incoterm_text

    parts = incoterm_text.split(maxsplit=1)
    code = parts[0].upper()
    qualifier = parts[1].strip() if len(parts) > 1 else ""
    if code == "DDP":
        first_place = places[0]
        if qualifier.lower() == "cliente":
            primary = f"{code} {first_place}"
        elif qualifier and first_place.upper().startswith(qualifier.upper()):
            primary = f"{code} {first_place}"
        else:
            primary = f"{incoterm_text} {first_place}"
        if len(places) > 1:
            return f"{primary}, {', '.join(places[1:])}"
        return primary

    return f"{incoterm_text} {place_text}"


def normalise_mode(value: Any) -> str:
    text = scalar_text(value).strip().lower()
    if text in {"grouped", "agrupada", "agrupado"}:
        return "grouped"
    return "detail"


def normalise_weight_mode(value: Any) -> str:
    text = scalar_text(value).strip().lower()
    if text in {"net", "neto"}:
        return "net"
    if text in {"gross", "bruto"}:
        return "gross"
    return ""


def document_header_label(invoice: InvoiceData) -> str:
    base = scalar_text(invoice.title_label, "Commercial Invoice Number")
    if base.endswith(" Number"):
        base = base[: -len(" Number")]
    mode_label = "Summary" if invoice.mode == "grouped" else "Detail"
    return f"{base} {mode_label} Number"


def normalise_currency(value: Any) -> str:
    text = scalar_text(value).strip().upper()
    if text in {"USD", "$", "US DOLLAR", "US DOLLARS"}:
        return "USD"
    return "EUR"


def currency_symbol_for(currency: str) -> str:
    return "$" if normalise_currency(currency) == "USD" else EURO


def bank_line_for(invoice: InvoiceData) -> str:
    payment = invoice.payment_terms.strip().lower()
    if not payment.startswith(("transferencia", "transf", "transfer")):
        return ""
    return USD_BANK_LINE if invoice.currency == "USD" else EUR_BANK_LINE


def combine_dimensions(thickness: str, width: str, length: str, fallback: str = "") -> str:
    parts = [str(part or "").strip() for part in [thickness, width, length]]
    if any(parts):
        formatted = [
            fmt_thickness_text(parts[0]) if index == 0 else fmt_measure_text(part)
            for index, part in enumerate(parts)
            if part
        ]
        return "x".join(formatted)
    return normalize_thickness_in_measure(fallback)


def line_item_label(line: Line) -> str:
    return line.item_label or line.item_id or line.factory_id


def line_characteristics(line: Line) -> str:
    return " ".join(unique_texts([line.quality, line.coating, line.finish, line.color]))


def clean_ship_name(value: str) -> str:
    return re.sub(r"^\s*MV\s+", "", clean_text(value), flags=re.IGNORECASE)


def clean_packing_text(value: str) -> str:
    text = clean_text(value)
    text = re.sub(r"\bMV\s+MV\b", "MV", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+-\s+", " - ", text)
    return text


def compose_packing(packing: str, ship: str) -> str:
    packing_text = clean_packing_text(packing)
    ship_text = clean_ship_name(ship)
    if not ship_text:
        return packing_text
    if ship_text.upper() in packing_text.upper():
        return clean_packing_text(packing_text)
    return clean_packing_text(f"{packing_text} - MV {ship_text}" if packing_text else f"MV {ship_text}")


def detail_description(line: Line) -> str:
    main = " ".join(
        unique_texts(
            [
                line.material,
                normalize_thickness_in_measure(line.dimensions),
                line_characteristics(line),
                line.factory_id,
            ]
        )
    )
    packing = clean_packing_text(line.packing)
    return " - ".join(part for part in [main, packing] if part)


def detail_description_parts(line: Line) -> tuple[str, str]:
    main = " ".join(
        unique_texts(
            [
                line.material,
                normalize_thickness_in_measure(line.dimensions),
                line_characteristics(line),
                line.factory_id,
            ]
        )
    )
    return main, clean_packing_text(line.packing)


def unique_texts(values_to_check: list[str]) -> list[str]:
    return list(dict.fromkeys(value.strip() for value in values_to_check if value and value.strip()))


def common_text(values_to_check: list[str], fallback: str = "") -> str:
    unique_values = unique_texts(values_to_check)
    if not unique_values:
        return fallback
    if len(unique_values) == 1:
        return unique_values[0]
    return "VARIOUS"


def infer_weight_mode(lines: list[Line], fallback: str = "gross") -> str:
    explicit = " ".join(line.weight_basis for line in lines if line.weight_basis).lower()
    if "neto" in explicit or "net" in explicit:
        return "net"
    if "bruto" in explicit or "gross" in explicit:
        return "gross"

    for line in lines:
        if not line.quantity or not (line.net_weight or line.gross_weight):
            continue
        net_delta = abs(line.quantity - line.net_weight) if line.net_weight else math.inf
        gross_delta = abs(line.quantity - line.gross_weight) if line.gross_weight else math.inf
        return "net" if net_delta <= gross_delta else "gross"
    return fallback


def line_group_key(line: Line) -> tuple[Any, ...]:
    if line.item_id:
        return ("item_id", line.item_id)
    if line.item_label:
        return ("item_label", line.item_label)
    return ("fallback", line.material, line.dimensions, line.quality, round(line.price, 6))


def group_invoice_lines(lines: list[Line]) -> list[Line]:
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for line in lines:
        key = line_group_key(line)
        if key not in grouped:
            grouped[key] = {"lines": [], "prices": []}
        grouped[key]["lines"].append(line)
        if line.price:
            grouped[key]["prices"].append(line.price)

    result: list[Line] = []
    for group in grouped.values():
        items = group["lines"]
        first_line = items[0]
        quantity = sum(line.quantity for line in items)
        amount = sum(line.amount for line in items)
        prices = group["prices"]
        unique_prices = {round(price, 6) for price in prices}
        price = prices[0] if len(unique_prices) == 1 and prices else (amount / quantity if quantity else 0.0)
        item_label = line_item_label(first_line)
        result.append(
            Line(
                material=common_text([line.material for line in items], first_line.material),
                dimensions=common_text([line.dimensions for line in items], first_line.dimensions),
                quality=common_text([line.quality for line in items], first_line.quality),
                factory_id=item_label,
                packing=" / ".join(unique_texts([line.packing for line in items])[:3]),
                quantity=quantity,
                price=price,
                amount=amount,
                item_id=first_line.item_id,
                item_label=item_label,
                units=sum(line.units for line in items),
                thickness=common_text([line.thickness for line in items], first_line.thickness),
                width=common_text([line.width for line in items], first_line.width),
                length=common_text([line.length for line in items], first_line.length),
                coating=common_text([line.coating for line in items], first_line.coating),
                finish=common_text([line.finish for line in items], first_line.finish),
                color=common_text([line.color for line in items], first_line.color),
                order_number=common_text([line.order_number for line in items], first_line.order_number),
                product_code=common_text([line.product_code for line in items], first_line.product_code),
                net_weight=sum(line.net_weight for line in items),
                gross_weight=sum(line.gross_weight for line in items),
                weight_basis=common_text([line.weight_basis for line in items], first_line.weight_basis),
            )
        )
    return result


def apply_invoice_mode(invoice: InvoiceData, mode: Any, weight_mode: Any = "") -> InvoiceData:
    detail_lines = invoice.detail_lines or invoice.lines
    invoice.detail_lines = detail_lines
    invoice.mode = normalise_mode(mode)
    invoice.weight_mode = normalise_weight_mode(weight_mode) or infer_weight_mode(detail_lines)
    invoice.lines = group_invoice_lines(detail_lines) if invoice.mode == "grouped" else detail_lines
    if not invoice.total_qty:
        invoice.total_qty = sum(line.quantity for line in invoice.lines)
    return invoice


def infer_category(lines: list[Line], fallback: str) -> str:
    headings = list(
        dict.fromkeys(
            clean_text(line.material_heading).upper()
            for line in lines
            if clean_text(line.material_heading)
        )
    )
    if len(headings) == 1:
        return headings[0]
    if len(headings) > 1:
        return " / ".join(headings)

    codes = list(
        dict.fromkeys(
            clean_text(line.material).upper() for line in lines if clean_text(line.material)
        )
    )
    if len(codes) == 1:
        code = codes[0]
        return material_heading_from_code(code)
    if set(codes) == {"ETP", "TFS"}:
        return "TIN FREE STEEL / ELECTROLYTIC TINPLATE"
    known_labels = [material_heading_from_code(code) for code in codes if code in MATERIAL_LABELS]
    if known_labels and len(known_labels) == len(codes):
        return " / ".join(known_labels)
    if fallback:
        fallback_code = clean_text(fallback).upper()
        return material_heading_from_code(fallback_code)
    return "STEEL PRODUCTS"


def resolve_customer_from_manual(
    factura: dict[str, Any], clientes: dict[str, dict[str, Any]]
) -> list[str]:
    record = linked_record(get_field(factura, FACTURA["cliente_manual"]), clientes)
    if not record:
        return []
    cp_city = " ".join(
        part
        for part in [
            scalar_text(get_field(record, CLIENTE["cp"])),
            scalar_text(get_field(record, CLIENTE["municipio"])),
        ]
        if part
    )
    return [
        scalar_text(get_field(record, CLIENTE["nombre_fiscal"])),
        scalar_text(get_field(record, CLIENTE["domicilio"])),
        cp_city,
        scalar_text(get_field(record, CLIENTE["nif"])),
    ]


def build_invoice(
    records_dir: Path,
    invoice_query: str,
    title_label: str,
    category_override: str,
    vat_override: float | None,
) -> InvoiceData:
    facturas = load_table(records_dir, "Facturas")
    existencias = index(load_table(records_dir, "Existencias"))
    ventas = index(load_table(records_dir, "Contratos_de_venta"))
    items_venta = index(load_table(records_dir, "Items_de_venta"))
    materiales = index(load_table(records_dir, "Materiales"))
    tipos_material = index(load_table(records_dir, "Tipos_de_material"))
    barcos = index(load_table(records_dir, "Barcos"))
    incoterms = index(load_table(records_dir, "Incoterms"))
    terminos = index(load_table(records_dir, "Terminos_de_pago"))
    clientes = index(load_table(records_dir, "Clientes"))

    factura = next(
        (
            record
            for record in facturas
            if record.get("id") == invoice_query
            or scalar_text(get_field(record, FACTURA["id"])) == invoice_query
        ),
        None,
    )
    if not factura:
        available = ", ".join(
            scalar_text(get_field(record, FACTURA["id"]), record.get("id", ""))
            for record in facturas[:10]
        )
        raise SystemExit(
            f"Invoice {invoice_query!r} is not in the local export. "
            f"Available examples: {available or 'none'}."
        )

    return build_invoice_from_records(
        factura=factura,
        existencias=existencias,
        ventas=ventas,
        items_venta=items_venta,
        materiales=materiales,
        tipos_material=tipos_material,
        barcos=barcos,
        incoterms=incoterms,
        terminos=terminos,
        clientes=clientes,
        title_label=title_label,
        category_override=category_override,
        vat_override=vat_override,
    )


def build_invoice_live(
    base_id: str,
    token: str,
    invoice_query: str,
    title_label: str,
    category_override: str,
    vat_override: float | None,
) -> InvoiceData:
    if invoice_query.startswith("rec"):
        factura = fetch_record(base_id, TABLES["facturas"], invoice_query, token)
    else:
        matches = fetch_records_by_formula(
            base_id,
            TABLES["facturas"],
            f"{{ID}}='{invoice_query}'",
            token,
        )
        if not matches:
            raise SystemExit(f"Invoice {invoice_query!r} was not found in Airtable.")
        if len(matches) > 1:
            raise SystemExit(f"Invoice {invoice_query!r} matched {len(matches)} records.")
        factura = matches[0]

    venta_ids = collect_link_ids([factura], FACTURA["venta"])
    existencia_ids = collect_link_ids([factura], FACTURA["existencias"])
    cliente_ids = collect_link_ids([factura], FACTURA["cliente_manual"])
    incoterm_ids = collect_link_ids([factura], FACTURA["incoterm"])
    termino_ids = collect_link_ids([factura], FACTURA["terminos"])

    ventas = fetch_records_by_ids(base_id, TABLES["ventas"], venta_ids, token)
    existencias = fetch_records_by_ids(base_id, TABLES["existencias"], existencia_ids, token)

    existencia_records = list(existencias.values())
    material_ids = collect_link_ids(existencia_records, EXISTENCIA["material"])
    barco_ids = collect_link_ids(existencia_records, EXISTENCIA["barco"])
    item_ids = collect_link_ids(existencia_records, EXISTENCIA["item_venta"])

    items_venta = fetch_records_by_ids(base_id, TABLES["items_venta"], item_ids, token)
    materiales = fetch_records_by_ids(base_id, TABLES["materiales"], material_ids, token)
    tipo_material_ids = collect_link_ids(list(materiales.values()), MATERIAL["tipo"])
    tipos_material = fetch_records_by_ids(
        base_id, TABLES["tipos_material"], tipo_material_ids, token
    )
    barcos = fetch_records_by_ids(base_id, TABLES["barcos"], barco_ids, token)
    incoterms = fetch_records_by_ids(base_id, TABLES["incoterms"], incoterm_ids, token)
    terminos = fetch_records_by_ids(base_id, TABLES["terminos"], termino_ids, token)
    clientes = fetch_records_by_ids(base_id, TABLES["clientes"], cliente_ids, token)

    return build_invoice_from_records(
        factura=factura,
        existencias=existencias,
        ventas=ventas,
        items_venta=items_venta,
        materiales=materiales,
        tipos_material=tipos_material,
        barcos=barcos,
        incoterms=incoterms,
        terminos=terminos,
        clientes=clientes,
        title_label=title_label,
        category_override=category_override,
        vat_override=vat_override,
    )


def build_invoice_from_payload(
    payload: dict[str, Any],
    title_label: str,
    category_override: str,
    vat_override: float | None,
) -> InvoiceData:
    lines: list[Line] = []
    for item in payload.get("lines", []):
        if not isinstance(item, dict):
            continue
        thickness = scalar_text(item.get("thickness"))
        width = scalar_text(item.get("width"))
        length = scalar_text(item.get("length"))
        dimensions = normalize_thickness_in_measure(
            scalar_text(item.get("dimensions"))
        ) or combine_dimensions(thickness, width, length)
        lines.append(
            Line(
                material=scalar_text(item.get("material")),
                dimensions=dimensions,
                quality=scalar_text(item.get("quality")),
                factory_id=scalar_text(item.get("factoryId")),
                packing=clean_packing_text(scalar_text(item.get("packing"))),
                quantity=scalar_number(item.get("quantity")),
                price=scalar_number(item.get("price")),
                amount=scalar_number(item.get("amount")),
                item_id=scalar_text(item.get("itemVentaId") or item.get("itemId")),
                item_label=scalar_text(item.get("itemVentaLabel") or item.get("itemLabel")),
                units=scalar_number(item.get("units")),
                thickness=thickness,
                width=width,
                length=length,
                coating=scalar_text(item.get("coating")),
                finish=scalar_text(item.get("finish")),
                color=scalar_text(item.get("color")),
                order_number=scalar_text(item.get("orderNumber")),
                product_code=scalar_text(item.get("productCode")),
                net_weight=scalar_number(item.get("netWeight")),
                gross_weight=scalar_number(item.get("grossWeight")),
                weight_basis=scalar_text(item.get("weightBasis")),
                material_heading=scalar_text(item.get("materialHeading"))
                or material_heading_from_code(item.get("material")),
            )
        )

    discount_lines: list[DiscountLine] = []
    for item in payload.get("discountLines", []):
        if not isinstance(item, dict):
            continue
        label = scalar_text(item.get("label"))
        amount = scalar_number(item.get("amount"))
        if not label or not amount:
            continue
        if amount > 0:
            amount = -amount
        discount_lines.append(DiscountLine(label=label, amount=amount))

    line_subtotal = scalar_number(payload.get("lineSubtotal"))
    if not line_subtotal:
        line_subtotal = sum(line.amount for line in lines)
    subtotal = scalar_number(payload.get("subtotal"))
    if not subtotal:
        subtotal = line_subtotal + sum(discount.amount for discount in discount_lines)
    total_qty = scalar_number(payload.get("totalQty"))
    if not total_qty:
        total_qty = sum(line.quantity for line in lines)
    vat_rate = (
        float(vat_override)
        if vat_override is not None
        else scalar_number(payload.get("vatRate"), 0.0)
    )
    vat_amount = scalar_number(payload.get("vatAmount"))
    if not vat_amount:
        vat_amount = subtotal * vat_rate
    total = scalar_number(payload.get("total"))
    if not total:
        total = subtotal + vat_amount

    customer_lines = [
        scalar_text(line)
        for line in payload.get("customerLines", [])
        if scalar_text(line)
    ]

    record_id = scalar_text(payload.get("recordId"))
    invoice_id = scalar_text(
        payload.get("invoiceId") or payload.get("invoiceNumber") or record_id,
        "invoice",
    )
    currency = normalise_currency(payload.get("currency"))
    packing_lists = unique_texts(
        [scalar_text(value) for value in payload.get("packingLists", [])]
        or [line.packing for line in lines]
    )

    invoice = InvoiceData(
        record_id=record_id,
        invoice_id=invoice_id,
        date_text=date_text(payload.get("date")),
        title_label=title_label,
        customer_lines=customer_lines,
        category=infer_category(
            lines,
            category_override
            or scalar_text(payload.get("category"))
            or scalar_text(payload.get("description")),
        ),
        lines=lines,
        subtotal=subtotal,
        vat_rate=vat_rate,
        vat_amount=vat_amount,
        total=total,
        total_qty=total_qty,
        internal_order=scalar_text(payload.get("internalOrder")),
        customer_order=scalar_text(payload.get("customerOrder")),
        delivery_terms=clean_invoice_phrase(scalar_text(payload.get("deliveryTerms"))),
        payment_terms=scalar_text(payload.get("paymentTerms")),
        down_payment=scalar_number(payload.get("downPayment")),
        due_date=date_text(payload.get("dueDate")),
        line_subtotal=line_subtotal,
        discount_lines=discount_lines,
        packing_lists=packing_lists,
        currency=currency,
        currency_symbol=scalar_text(payload.get("currencySymbol")) or currency_symbol_for(currency),
        customer_code=scalar_text(payload.get("customerCode")),
        detail_lines=lines,
        weight_mode=normalise_weight_mode(payload.get("weightMode")) or infer_weight_mode(lines),
    )
    return apply_invoice_mode(invoice, payload.get("mode"), payload.get("weightMode"))


def build_invoice_from_records(
    factura: dict[str, Any],
    existencias: dict[str, dict[str, Any]],
    ventas: dict[str, dict[str, Any]],
    items_venta: dict[str, dict[str, Any]],
    materiales: dict[str, dict[str, Any]],
    tipos_material: dict[str, dict[str, Any]],
    barcos: dict[str, dict[str, Any]],
    incoterms: dict[str, dict[str, Any]],
    terminos: dict[str, dict[str, Any]],
    clientes: dict[str, dict[str, Any]],
    title_label: str,
    category_override: str,
    vat_override: float | None,
) -> InvoiceData:
    venta_records = [
        ventas[record_id]
        for record_id in values(get_field(factura, FACTURA["venta"]))
        if record_id in ventas
    ]

    line_records = [
        existencias[record_id]
        for record_id in values(get_field(factura, FACTURA["existencias"]))
        if record_id in existencias
    ]
    lines: list[Line] = []
    for existencia in line_records:
        material_record = linked_record(get_field(existencia, EXISTENCIA["material"]), materiales)
        material_code = linked_text(
            get_field(existencia, EXISTENCIA["material"]),
            materiales,
            MATERIAL["codigo"],
            "",
        )
        material_name = scalar_text(get_field(material_record, MATERIAL["nombre"]))
        material_type_record = linked_record(get_field(material_record, MATERIAL["tipo"]), tipos_material)
        material_type = scalar_text(get_field(material_type_record, TIPO_MATERIAL["nombre"]))
        material_heading = (
            format_material_heading(material_name, material_type)
            or material_heading_from_code(material_code)
        )
        thickness = scalar_text(get_field(existencia, EXISTENCIA["espesor"]))
        width = scalar_text(get_field(existencia, EXISTENCIA["ancho"]))
        length = scalar_text(get_field(existencia, EXISTENCIA["largo"]))
        dimensions = normalize_thickness_in_measure(
            scalar_text(get_field(existencia, EXISTENCIA["eal"]))
        ) or combine_dimensions(thickness, width, length)
        quality = scalar_text(get_field(existencia, EXISTENCIA["calidad"])) or scalar_text(
            get_field(existencia, EXISTENCIA["crac"])
        )
        if not dimensions or not quality:
            description = scalar_text(get_field(existencia, EXISTENCIA["descripcion"]))
            if "|" in description:
                left, right = [part.strip() for part in description.split("|", 1)]
                dimensions = dimensions or normalize_thickness_in_measure(right)
                if material_code and left.startswith(material_code):
                    quality = quality or left[len(material_code) :].strip()
                else:
                    quality = quality or left
        ship = linked_text(
            get_field(existencia, EXISTENCIA["barco"]), barcos, BARCO["nombre"], ""
        )
        packing = compose_packing(scalar_text(get_field(existencia, EXISTENCIA["pl"])), ship)
        quantity = scalar_number(get_field(existencia, EXISTENCIA["peso"]))
        price = scalar_number(get_field(existencia, EXISTENCIA["precio_venta"]))
        amount = scalar_number(get_field(existencia, EXISTENCIA["valor_venta"]))
        if not amount and quantity and price:
            amount = quantity * price
        item_id = scalar_text(get_field(existencia, EXISTENCIA["item_venta"]))
        item = items_venta.get(item_id)
        item_label = scalar_text(get_field(item, ITEM_VENTA["item"]), item_id)
        lines.append(
            Line(
                material=material_code,
                dimensions=dimensions,
                quality=quality,
                factory_id=scalar_text(get_field(existencia, EXISTENCIA["id_fabrica"])),
                packing=packing,
                quantity=quantity,
                price=price,
                amount=amount,
                item_id=item_id,
                item_label=item_label,
                units=scalar_number(get_field(existencia, EXISTENCIA["uds"])),
                thickness=thickness,
                width=width,
                length=length,
                coating=scalar_text(get_field(existencia, EXISTENCIA["recubrimiento"])),
                finish=scalar_text(get_field(existencia, EXISTENCIA["acabado"])),
                color=scalar_text(get_field(existencia, EXISTENCIA["color"])),
                order_number=scalar_text(get_field(item, ITEM_VENTA["numero_orden"])),
                product_code=scalar_text(get_field(item, ITEM_VENTA["codigo_producto"])),
                net_weight=scalar_number(get_field(existencia, EXISTENCIA["neto"])),
                gross_weight=scalar_number(get_field(existencia, EXISTENCIA["bruto"])),
                weight_basis=scalar_text(get_field(existencia, EXISTENCIA["peso_cliente"])),
                material_heading=material_heading,
            )
        )

    line_subtotal = scalar_number(get_field(factura, FACTURA["valor_venta"]))
    if not line_subtotal:
        line_subtotal = sum(line.amount for line in lines)
    subtotal = scalar_number(get_field(factura, FACTURA["valor_sin_iva"]))
    if not subtotal:
        subtotal = line_subtotal
    total_qty = scalar_number(get_field(factura, FACTURA["peso"]))
    if not total_qty:
        total_qty = sum(line.quantity for line in lines)

    incoterm_record = linked_record(get_field(factura, FACTURA["incoterm"]), incoterms)
    incoterm = scalar_text(get_field(incoterm_record, INCOTERM["nombre"]))
    vat_rate = (
        float(vat_override)
        if vat_override is not None
        else scalar_number(get_field(factura, FACTURA["iva"]), 0.0)
    )
    vat_amount = subtotal * vat_rate
    total = subtotal + vat_amount

    terms_record = linked_record(get_field(factura, FACTURA["terminos"]), terminos)
    payment_terms = scalar_text(get_field(terms_record, TERMINO["nombre"]))

    customer_lines = [
        scalar_text(get_field(factura, FACTURA["cliente_nombre"])),
        scalar_text(get_field(factura, FACTURA["cliente_domicilio"])),
        " ".join(
            part
            for part in [
                scalar_text(get_field(factura, FACTURA["cliente_cp"])),
                scalar_text(get_field(factura, FACTURA["cliente_municipio"])),
            ]
            if part
        ),
        scalar_text(get_field(factura, FACTURA["cliente_provincia"])),
        scalar_text(get_field(factura, FACTURA["cliente_nif"])),
    ]
    customer_lines = [line for line in customer_lines if line]
    if not customer_lines:
        customer_lines = resolve_customer_from_manual(factura, clientes)

    internal_order = ", ".join(
        scalar_text(get_field(record, VENTA["contrato"])) for record in venta_records
    )
    customer_order_candidates = [
        scalar_text(get_field(record, VENTA["numero_pedido"])) for record in venta_records
    ]
    for existencia in line_records:
        for item_id in values(get_field(existencia, EXISTENCIA["item_venta"])):
            item = items_venta.get(item_id)
            value = scalar_text(get_field(item, ITEM_VENTA["numero_orden"]))
            if value:
                customer_order_candidates.append(value)
    customer_order = ", ".join(dict.fromkeys(filter(None, customer_order_candidates)))

    delivery_places = []
    for record in venta_records:
        delivery_places.extend(
            clean_delivery_place(scalar_text(place)) for place in values(get_field(record, VENTA["lugares_entrega"]))
        )
    delivery_places = list(dict.fromkeys(filter(None, delivery_places)))
    delivery_terms = format_delivery_terms(incoterm, delivery_places)

    down_payment = scalar_number(get_field(factura, FACTURA["anticipo_manual"]))
    currency = normalise_currency(
        next(
            (
                scalar_text(get_field(record, VENTA["moneda"]))
                for record in venta_records
                if scalar_text(get_field(record, VENTA["moneda"]))
            ),
            "EUR",
        )
    )

    invoice = InvoiceData(
        record_id=factura.get("id", ""),
        invoice_id=scalar_text(get_field(factura, FACTURA["id"]), factura["id"]),
        date_text=date_text(get_field(factura, FACTURA["fecha"])),
        title_label=title_label,
        customer_lines=customer_lines,
        category=infer_category(
            lines, category_override or scalar_text(get_field(factura, FACTURA["descripcion"]))
        ),
        lines=lines,
        subtotal=subtotal,
        vat_rate=vat_rate,
        vat_amount=vat_amount,
        total=total,
        total_qty=total_qty,
        internal_order=internal_order,
        customer_order=customer_order,
        delivery_terms=delivery_terms,
        payment_terms=payment_terms,
        down_payment=down_payment,
        due_date=date_text(get_field(factura, FACTURA["vencimiento"])),
        line_subtotal=line_subtotal,
        packing_lists=unique_texts([line.packing for line in lines]),
        currency=currency,
        currency_symbol=currency_symbol_for(currency),
        detail_lines=lines,
        weight_mode=infer_weight_mode(lines),
    )
    return apply_invoice_mode(invoice, "detail", invoice.weight_mode)


def fit_text(c: canvas.Canvas, text: str, max_width: float, font: str, size: float) -> str:
    text = clean_text(str(text or ""))
    if c.stringWidth(text, font, size) <= max_width:
        return text
    ellipsis = "..."
    while text and c.stringWidth(text + ellipsis, font, size) > max_width:
        text = text[:-1]
    return text + ellipsis if text else ellipsis


def font_size_for_width(
    c: canvas.Canvas,
    text: str,
    max_width: float,
    font: str,
    size: float,
    min_size: float,
) -> tuple[float, bool]:
    draw_size = size
    while draw_size > min_size and c.stringWidth(text, font, draw_size) > max_width:
        draw_size -= 0.2
    return draw_size, c.stringWidth(text, font, draw_size) <= max_width


def split_two_lines_for_width(c: canvas.Canvas, text: str, max_width: float, font: str, size: float) -> list[str]:
    words = clean_text(text).split()
    if len(words) < 2:
        return [fit_text(c, text, max_width, font, size)]
    candidates = [
        (" ".join(words[:index]), " ".join(words[index:]))
        for index in range(1, len(words))
    ]
    return list(
        min(
            candidates,
            key=lambda parts: max(c.stringWidth(part, font, size) for part in parts),
        )
    )


def customer_header_segments(
    c: canvas.Canvas,
    text: str,
    max_width: float,
    font: str,
    base_size: float = 8.5,
    min_single_size: float = 7.2,
    min_wrapped_size: float = 6.8,
) -> list[tuple[str, str, float]]:
    text = clean_text(text)
    size, fits = font_size_for_width(c, text, max_width, font, base_size, min_single_size)
    if fits:
        return [(text, font, size)]

    lines = split_two_lines_for_width(c, text, max_width, font, base_size)
    wrapped_size = base_size
    while wrapped_size > min_wrapped_size and any(
        c.stringWidth(line, font, wrapped_size) > max_width for line in lines
    ):
        wrapped_size -= 0.2
    return [
        (fit_text(c, line, max_width, font, wrapped_size), font, wrapped_size)
        for line in lines
    ]


def customer_block_segments(c: canvas.Canvas, invoice: InvoiceData, max_width: float) -> list[tuple[str, str, float]]:
    segments: list[tuple[str, str, float]] = []
    for idx, line in enumerate(invoice.customer_lines[:6]):
        text = clean_text(line)
        if not text:
            continue
        font = BOLD_FONT if idx == 0 else REGULAR_FONT
        if idx in {0, 1}:
            segments.extend(customer_header_segments(c, text, max_width, font))
            continue
        size, fits = font_size_for_width(c, text, max_width, font, 8.5, 7.2)
        segments.append((text if fits else fit_text(c, text, max_width, font, size), font, size))
    return segments


def draw_right_fit(
    c: canvas.Canvas,
    text: str,
    right_x: float,
    y: float,
    max_width: float,
    font: str,
    size: float,
    min_size: float = 5.2,
) -> None:
    text = clean_text(text)
    draw_size = size
    while draw_size > min_size and c.stringWidth(text, font, draw_size) > max_width:
        draw_size -= 0.2
    c.setFont(font, draw_size)
    c.drawRightString(right_x, y, text)


def draw_center_fit(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    font: str,
    size: float,
    min_size: float = 4.4,
) -> bool:
    text = clean_text(text)
    draw_size = size
    while draw_size > min_size and c.stringWidth(text, font, draw_size) > width:
        draw_size -= 0.2
    if c.stringWidth(text, font, draw_size) > width:
        return False
    c.setFont(font, draw_size)
    c.drawCentredString(x + width / 2, y, text)
    return True


def draw_wrapped_center(
    c: canvas.Canvas, text: str, x: float, y: float, width: float, font: str, size: float
) -> None:
    text = clean_text(text)
    if draw_center_fit(c, text, x, y - 2.2, width, font, size):
        return
    parts = text.split(" - MV ", 1)
    if len(parts) == 2:
        lines = [f"{parts[0]} - MV", parts[1]]
    else:
        words = str(text or "").split()
        lines = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if c.stringWidth(candidate, font, size) <= width or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
            if len(lines) == 1 and current:
                # Keep invoice rows compact.
                continue
        if current:
            lines.append(current)
        lines = lines[:2]
    if not lines:
        lines = [""]
    if len(lines) == 1:
        c.drawCentredString(x + width / 2, y - 3, fit_text(c, lines[0], width, font, size))
    else:
        c.drawCentredString(x + width / 2, y + 0.5, fit_text(c, lines[0], width, font, size))
        c.drawCentredString(x + width / 2, y - 4.7, fit_text(c, lines[1], width, font, size))


def draw_wrapped_left(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    font: str,
    size: float,
    max_lines: int = 2,
) -> None:
    words = clean_text(text).split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if c.stringWidth(candidate, font, size) <= width or not current:
            current = candidate
            continue
        lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if not lines:
        return
    c.setFont(font, size)
    line_gap = size + 1.0
    for index, line in enumerate(lines[:max_lines]):
        c.drawString(x, y - index * line_gap, fit_text(c, line, width, font, size))


def draw_logo(c: canvas.Canvas, x: float, y: float, scale: float = 1.0) -> None:
    palette = [
        colors.HexColor("#be737e"),
        colors.HexColor("#a43052"),
        colors.HexColor("#741c35"),
        colors.HexColor("#4d0919"),
    ]
    bar_w = 54 * scale
    bar_h = 8 * scale
    gap = 5 * scale
    for idx, color in enumerate(palette):
        c.setFillColor(color)
        c.rect(x, y - idx * (bar_h + gap), bar_w, bar_h, stroke=0, fill=1)
    c.setFillColor(colors.black)


def draw_header(c: canvas.Canvas, invoice: InvoiceData) -> None:
    page_w, page_h = A4
    draw_logo(c, 52, page_h - 58, 1.21)
    c.setFillColor(colors.HexColor("#800014"))
    c.setFont(BOLD_FONT, 10)
    c.drawString(124, page_h - 56, "Steel Trade Advisors, S.L.U.")
    c.setFillColor(colors.black)
    c.setFont(REGULAR_FONT, 8)
    company_lines = [
        "C/ Almirante, n\u00ba 22, 5A",
        "28004 Madrid, Espa\u00f1a",
        "+34 91 068 82 77",
        "CIF: B88047790",
    ]
    y = page_h - 72
    for line in company_lines:
        c.drawString(125, y, line)
        y -= 10.8

    customer_x = 330
    customer_w = page_w - customer_x - 52
    customer_cif_y = page_h - 72 - 3 * 10.8
    customer_gap = 10.8
    customer_segments = customer_block_segments(c, invoice, customer_w)
    customer_y = customer_cif_y + (len(customer_segments) - 1) * customer_gap
    for text, font, size in customer_segments:
        c.setFont(font, size)
        c.drawString(customer_x, customer_y, text)
        customer_y -= customer_gap


def table_layout(show_summary: bool, mode: str = "detail") -> dict[str, float]:
    page_w, _ = A4
    x = 38.0
    table_w = page_w - 76.0
    desc_w = 326.0
    qty_w = 62.0
    price_w = 56.0
    row_h = 15.0 if mode == "detail" else 12.0
    y_top = 690.0
    y_bottom = 182.0 if show_summary else 70.0
    header_h = 13.0
    category_h = 22.0
    summary_h = 110.0 if show_summary else 0.0
    line_area = y_top - y_bottom - header_h - category_h - summary_h
    return {
        "x": x,
        "table_w": table_w,
        "desc_w": desc_w,
        "qty_w": qty_w,
        "price_w": price_w,
        "amount_w": table_w - desc_w - qty_w - price_w,
        "y_top": y_top,
        "y_bottom": y_bottom,
        "header_h": header_h,
        "category_h": category_h,
        "summary_h": summary_h,
        "line_area": line_area,
        "row_h": row_h,
        "capacity": max(1, int(line_area // row_h)),
    }


def paginate_lines(lines: list[Line], mode: str) -> list[tuple[list[Line], bool]]:
    final_capacity = int(table_layout(True, mode)["capacity"])
    page_capacity = int(table_layout(False, mode)["capacity"])
    if len(lines) <= final_capacity:
        return [(lines, True)]

    pages: list[tuple[list[Line], bool]] = []
    remaining = list(lines)
    while len(remaining) > final_capacity:
        if len(remaining) <= page_capacity + final_capacity:
            take = len(remaining) - final_capacity
        else:
            take = page_capacity
        pages.append((remaining[:take], False))
        remaining = remaining[take:]
    pages.append((remaining, True))
    return pages


def draw_table_page(c: canvas.Canvas, invoice: InvoiceData, page_lines: list[Line], show_summary: bool) -> float:
    layout = table_layout(show_summary, invoice.mode)
    x = layout["x"]
    table_w = layout["table_w"]
    desc_w = layout["desc_w"]
    qty_w = layout["qty_w"]
    price_w = layout["price_w"]
    amount_w = layout["amount_w"]
    y_top = layout["y_top"]
    y_bottom = layout["y_bottom"]
    header_h = layout["header_h"]
    category_h = layout["category_h"]
    summary_h = layout["summary_h"]
    row_h = layout["row_h"]

    col_x = [x, x + desc_w, x + desc_w + qty_w, x + desc_w + qty_w + price_w, x + table_w]
    c.setLineWidth(0.8)
    c.rect(x, y_bottom, table_w, y_top - y_bottom, stroke=1, fill=0)
    for vx in col_x[1:-1]:
        c.line(vx, y_top, vx, y_bottom)
    c.line(x, y_top - header_h, x + table_w, y_top - header_h)

    header_font_size = 5.8
    c.setFont(BOLD_FONT, header_font_size)
    c.drawCentredString(x + desc_w / 2, y_top - 9.5, "Description")
    c.drawCentredString(
        col_x[1] + qty_w / 2,
        y_top - 9.5,
        fit_text(c, "Quantity (MT)", qty_w - 4, BOLD_FONT, header_font_size),
    )
    c.drawCentredString(
        col_x[2] + price_w / 2,
        y_top - 9.5,
        fit_text(c, f"Price ({invoice.currency_symbol}/MT)", price_w - 4, BOLD_FONT, header_font_size),
    )
    c.drawCentredString(
        col_x[3] + amount_w / 2,
        y_top - 9.5,
        fit_text(c, f"Amount ({invoice.currency_symbol})", amount_w - 4, BOLD_FONT, header_font_size),
    )

    category_font_size = 6.6
    line_font_size = 6.0
    c.setFont(REGULAR_FONT, category_font_size)
    c.drawString(x + 2, y_top - header_h - 19, invoice.category)

    y = y_top - header_h - category_h - row_h + 2
    for line in page_lines:
        c.setFont(REGULAR_FONT, line_font_size)
        if invoice.mode == "grouped":
            c.drawString(x + 42, y, fit_text(c, fmt_measure_text(line.dimensions), 78, REGULAR_FONT, line_font_size))
            c.drawString(x + 130, y, fit_text(c, line_characteristics(line), 170, REGULAR_FONT, line_font_size))
        else:
            main_desc, packing_desc = detail_description_parts(line)
            c.setFont(REGULAR_FONT, 5.8)
            if packing_desc:
                c.drawString(x + 5, y + 3.2, fit_text(c, main_desc, desc_w - 12, REGULAR_FONT, 5.8))
                c.drawString(x + 5, y - 3.4, fit_text(c, packing_desc, desc_w - 12, REGULAR_FONT, 5.8))
            else:
                draw_wrapped_left(
                    c,
                    main_desc,
                    x + 5,
                    y + 3,
                    desc_w - 12,
                    REGULAR_FONT,
                    5.8,
                    max_lines=2,
                )
        draw_right_fit(c, fmt_decimal(line.quantity, 3, False), col_x[2] - 8, y, qty_w - 12, REGULAR_FONT, line_font_size)
        draw_right_fit(c, fmt_price(line.price, invoice.currency_symbol), col_x[3] - 8, y, price_w - 12, REGULAR_FONT, line_font_size)
        draw_right_fit(c, fmt_money(line.amount, invoice.currency_symbol), col_x[4] - 4, y, amount_w - 6, REGULAR_FONT, line_font_size)
        y -= row_h

    if not show_summary:
        return y_bottom

    summary_top = y_bottom + summary_h
    c.setLineWidth(0.6)
    c.line(x, summary_top, x + table_w, summary_top)
    total_row_top = y_bottom + 28
    c.line(x, total_row_top, x + table_w, total_row_top)

    y = summary_top - 18
    c.setFont(BOLD_FONT, 6.9)
    if invoice.discount_lines:
        draw_right_fit(c, fmt_money(invoice.line_subtotal, invoice.currency_symbol), col_x[4] - 4, y, amount_w - 6, BOLD_FONT, 6.9)
        y -= 14
        c.setFont(REGULAR_FONT, 6.8)
        for discount in invoice.discount_lines[:2]:
            c.drawCentredString(x + desc_w * 0.52, y, fit_text(c, discount.label, 165, REGULAR_FONT, 6.8))
            draw_right_fit(c, fmt_money(discount.amount, invoice.currency_symbol), col_x[4] - 4, y, amount_w - 6, REGULAR_FONT, 6.8)
            y -= 14
        c.setFont(BOLD_FONT, 6.9)
    draw_right_fit(c, fmt_money(invoice.subtotal, invoice.currency_symbol), col_x[4] - 4, y, amount_w - 6, BOLD_FONT, 6.9)
    y -= 18
    c.setFont(REGULAR_FONT, 6.8)
    vat_label = f"VAT {fmt_decimal(invoice.vat_rate * 100, 2, False)}%"
    c.drawCentredString(x + desc_w * 0.52, y, vat_label)
    draw_right_fit(c, fmt_money(invoice.vat_amount, invoice.currency_symbol), col_x[4] - 4, y, amount_w - 6, REGULAR_FONT, 6.8)

    c.setFont(BOLD_FONT, 7.1)
    c.drawCentredString(x + desc_w / 2, y_bottom + 13, "TOTAL")
    draw_right_fit(c, fmt_decimal(invoice.total_qty, 3, False), col_x[2] - 8, y_bottom + 13, qty_w - 12, BOLD_FONT, 7.1)
    draw_right_fit(c, fmt_money(invoice.total, invoice.currency_symbol), col_x[4] - 4, y_bottom + 13, amount_w - 6, BOLD_FONT, 7.1)

    return y_bottom


def draw_footer(c: canvas.Canvas, invoice: InvoiceData, y_top: float) -> None:
    x = 52
    value_right_x = 410
    y = y_top - 17
    footer_font_size = 6.8
    c.setFont(REGULAR_FONT, footer_font_size)
    rows = []
    if invoice.mode == "grouped" and invoice.packing_lists:
        rows.append(("Packing List:", " / ".join(invoice.packing_lists)))
    rows.extend([
        ("Internal order number:", invoice.internal_order),
        ("Customer order number:", invoice.customer_order),
        ("Delivery terms:", invoice.delivery_terms),
    ])
    for label, value in rows:
        c.setFont(BOLD_FONT if label.startswith("Customer") else REGULAR_FONT, footer_font_size)
        c.drawString(x, y, label)
        c.setFont(REGULAR_FONT, footer_font_size)
        c.drawRightString(
            value_right_x,
            y,
            fit_text(c, value, 240, REGULAR_FONT, footer_font_size),
        )
        y -= 11

    c.setFont(BOLD_FONT, footer_font_size)
    c.drawString(x, y, "Payment terms:")
    y -= 11
    c.setFont(REGULAR_FONT, footer_font_size)
    c.drawString(x + 15, y, f"- {invoice.payment_terms or '-'}")
    y -= 10
    c.drawString(x + 15, y, "- Down payment:")
    draw_right_fit(c, fmt_money(invoice.down_payment, invoice.currency_symbol), value_right_x, y, 90, REGULAR_FONT, footer_font_size)
    y -= 10
    c.setFont(BOLD_FONT, footer_font_size)
    c.drawString(x + 15, y, "- Balance to be paid:")
    draw_right_fit(
        c,
        fmt_money(invoice.total - invoice.down_payment, invoice.currency_symbol),
        value_right_x,
        y,
        90,
        BOLD_FONT,
        footer_font_size,
    )
    y -= 10
    c.setFont(REGULAR_FONT, footer_font_size)
    c.drawString(x + 15, y, "- Due date:")
    c.drawRightString(value_right_x, y, invoice.due_date or "-")
    bank_line = bank_line_for(invoice)
    if bank_line:
        y -= 10
        c.drawString(x + 15, y, f"- {bank_line}")


def draw_registry_footer(c: canvas.Canvas) -> None:
    page_w, _ = A4
    c.setFillColor(colors.HexColor("#888888"))
    c.setFont(REGULAR_FONT, 6)
    c.drawCentredString(page_w / 2, 30, REGISTRY_LINE)
    c.setFillColor(colors.black)


def render_pdf(invoice: InvoiceData, output_path: Path, max_lines: int) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(output_path), pagesize=A4)
    page_w, page_h = A4

    for page_lines, is_final_page in paginate_lines(invoice.lines, invoice.mode):
        draw_header(c, invoice)
        c.setFont(BOLD_FONT, 6.8)
        c.drawString(52, 706, f"{document_header_label(invoice)}: {invoice.invoice_id}")
        c.setFont(REGULAR_FONT, 6.8)
        c.drawRightString(page_w - 52, 706, invoice.date_text)

        table_bottom = draw_table_page(c, invoice, page_lines, show_summary=is_final_page)
        if is_final_page:
            draw_footer(c, invoice, table_bottom)
        draw_registry_footer(c)
        c.showPage()
    c.save()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a STA sales invoice PDF from local Airtable record exports."
    )
    parser.add_argument("--invoice", required=True, help="Invoice ID or Airtable record ID.")
    parser.add_argument(
        "--records-dir",
        type=Path,
        default=DEFAULT_RECORDS_DIR,
        help="Directory containing exported Airtable record JSON files.",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Read the invoice and linked records directly from Airtable Web API.",
    )
    parser.add_argument(
        "--base-id",
        default=os.environ.get("AIRTABLE_BASE_ID", DEFAULT_BASE_ID),
        help="Airtable base ID for --live mode.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where the PDF will be written.",
    )
    parser.add_argument(
        "--title",
        default="Commercial Invoice Number",
        help="Document title label before the invoice number.",
    )
    parser.add_argument(
        "--proforma",
        action="store_true",
        help="Shortcut for --title 'Proforma Invoice Number'.",
    )
    parser.add_argument(
        "--category",
        default="",
        help="Override the product category line shown above invoice lines.",
    )
    parser.add_argument(
        "--vat-rate",
        type=float,
        default=None,
        help="Override VAT rate as a decimal, e.g. 0.21. Defaults to Facturas.IVA.",
    )
    parser.add_argument(
        "--max-lines",
        type=int,
        default=30,
        help="Compatibility option. The PDF now paginates all invoice lines.",
    )
    parser.add_argument(
        "--mode",
        choices=["detail", "grouped"],
        default="detail",
        help="detail shows one row per existencia; grouped shows one row per item de venta.",
    )
    parser.add_argument("--output", type=Path, default=None, help="Explicit PDF path.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    load_dotenv()
    args = parse_args(argv)
    title = "Proforma Invoice Number" if args.proforma else args.title
    if args.live:
        token = os.environ.get("AIRTABLE_TOKEN") or os.environ.get("AIRTABLE_PAT")
        if not token:
            raise SystemExit("--live requires AIRTABLE_TOKEN or AIRTABLE_PAT.")
        invoice = build_invoice_live(
            base_id=args.base_id,
            token=token,
            invoice_query=args.invoice,
            title_label=title,
            category_override=args.category,
            vat_override=args.vat_rate,
        )
    else:
        invoice = build_invoice(
            records_dir=args.records_dir,
            invoice_query=args.invoice,
            title_label=title,
            category_override=args.category,
            vat_override=args.vat_rate,
        )
    apply_invoice_mode(invoice, args.mode, invoice.weight_mode)
    output_path = args.output or (
        args.output_dir / f"{safe_filename(invoice.invoice_id)}.pdf"
    )
    render_pdf(invoice, output_path, max_lines=max(1, args.max_lines))
    print(output_path.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
