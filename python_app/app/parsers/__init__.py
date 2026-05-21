"""Per-vendor invoice parsers.

Each parser takes the invoice text (post-pdfplumber or post-OCR), the source
filename, and optionally a list of rasterised page PNGs (for parsers that
need to re-OCR a specific page with a structured prompt). Parsers that don't
need the PNGs simply ignore the extra arg.
"""

from __future__ import annotations

from typing import Callable

from app.schema import InvoiceRow

Parser = Callable[..., list[InvoiceRow]]


def get_parser(vendor_id: str) -> Parser | None:
    """Look up a parser by vendor id (e.g. 'BTM', 'CFW'). Returns None if missing."""
    # Lazy import to avoid circulars while keeping the registry colocated here.
    from app.parsers import (
        aeon, bigc, btm, central_tops, cfm, cfw, lt, scanned_vendors as sv,
    )
    registry: dict[str, Parser] = {
        "AEON": aeon.parse,
        "BIGC": bigc.parse,
        "BIGC_FOOD": sv.parse_bigc_food,
        "BOOTS": sv.parse_boots,
        "BTM": btm.parse,
        "CFM": cfm.parse,
        "CFR": central_tops.parse_cfr,
        "CFW": cfw.parse,
        "CJ": sv.parse_cj,
        "CMK": central_tops.parse_cmk,
        "CP_ALL": sv.parse_cp_all,
        "FOODLAND": sv.parse_foodland,
        "HOMEPRO": sv.parse_homepro,
        "LT": lt.parse,
        "MAKRO": sv.parse_makro,
        "PTT": sv.parse_ptt,
        "TFG": sv.parse_tfg,
        "THEMALL": sv.parse_themall,
        "TSURUHA": sv.parse_tsuruha,
        "VILLA": sv.parse_villa,
        "WATSON": sv.parse_watson,
    }
    return registry.get(vendor_id)
