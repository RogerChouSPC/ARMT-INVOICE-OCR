"""Shared parser utilities: Thai date parsing, number cleanup, etc."""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal


def round_half_up(value: float, places: int = 2) -> float:
    """Round half-away-from-zero (the rounding humans expect on invoices).

    Python's built-in round() uses banker's rounding, which gives 88198.51 for
    2939950.5 * 0.03 instead of the 88198.52 our gold expects. Using Decimal
    with ROUND_HALF_UP fixes the discrepancy.

    We also clean float-noise (10084.5*0.03 = 302.53499999... in float, not
    302.535) by rounding to many places BEFORE quantising — this snaps the
    value to its human-intended decimal before the half-up decision.
    """
    # Snap to ~places+6 decimals first via Python's own round (banker's, but
    # at this far-out precision banker vs up doesn't matter), then quantize.
    cleaned = Decimal(str(round(value, places + 6)))
    q = Decimal("1").scaleb(-places)
    return float(cleaned.quantize(q, rounding=ROUND_HALF_UP))


THAI_MONTHS = {
    "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
    "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
    "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
    # Abbreviated forms occasionally seen on invoices
    "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4,
    "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8,
    "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
}


def parse_thai_date(s: str) -> str:
    """Parse a Thai-style date string into ISO YYYY-MM-DD.

    Handles formats commonly seen in Thai invoices:
      '11 มีนาคม 2569'  -> '2026-03-11'  (Buddhist Era → Gregorian)
      '26/03/2026'      -> '2026-03-26'
      '24-Mar-26'       -> '2026-03-24'
      '31-Mar-26'       -> '2026-03-31'

    Returns empty string when the input is unrecognisable.
    """
    if not s:
        return ""
    s = s.strip().replace("​", "")  # zero-width

    # DD/MM/YYYY or DD-MM-YYYY
    m = re.fullmatch(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        elif y >= 2500:
            y -= 543
        return f"{y:04d}-{mo:02d}-{d:02d}"

    # Thai-month words: 11 มีนาคม 2569
    parts = s.split()
    if len(parts) == 3:
        d_raw, mo_raw, y_raw = parts
        if mo_raw in THAI_MONTHS and d_raw.isdigit() and y_raw.isdigit():
            d, mo, y = int(d_raw), THAI_MONTHS[mo_raw], int(y_raw)
            if y >= 2500:
                y -= 543
            elif y < 100:
                y += 2000
            return f"{y:04d}-{mo:02d}-{d:02d}"

    # English short month: 24-Mar-26 / 24 Mar 2026
    m = re.fullmatch(r"(\d{1,2})[\-\s]([A-Za-z]{3,9})[\-\s](\d{2,4})", s)
    if m:
        d = int(m.group(1))
        mo_name = m.group(2)[:3].lower()
        en_months = {
            "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
            "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
        }
        mo = en_months.get(mo_name, 0)
        if mo:
            y = int(m.group(3))
            if y < 100:
                y += 2000
            return f"{y:04d}-{mo:02d}-{d:02d}"

    return ""


def parse_amount(s: str) -> float:
    """Parse a Thai-style invoice amount.

    Invoices print amounts as: '35,684 00' (last group = decimal) or '35,684.00'.
    """
    if s is None:
        return 0.0
    s = str(s).strip().replace(",", "").replace(" ", " ")
    if not s:
        return 0.0
    # Pattern 1: '35684 00' or '35,684 00' — two space-separated groups
    m = re.fullmatch(r"(-?\d+)\s+(\d{2})", s)
    if m:
        return float(f"{m.group(1)}.{m.group(2)}")
    try:
        return float(s)
    except ValueError:
        return 0.0


def to_number(x: float) -> float | int:
    """Return int when the value is an integer, else float — matches Output.xlsx mixed style."""
    return int(x) if isinstance(x, float) and x.is_integer() else x


def collapse_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()
