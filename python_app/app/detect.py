"""Detect which vendor an invoice belongs to.

Mirrors the rules in vercel/src/config/customers.ts. Priority:
  1. issuer tax id substring match (most reliable)
  2. Thai/English company-name keyword match
  3. filename keyword match (last resort)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal


ExtractMode = Literal["auto", "ocr", "text"]


@dataclass(frozen=True)
class VendorRule:
    id: str
    label: str
    filename_keywords: tuple[str, ...] = ()
    name_keywords: tuple[str, ...] = ()
    taxids: tuple[str, ...] = ()
    extract_mode: ExtractMode = "auto"


# Order matters: more specific entries (e.g. Big C Food) come before more general
# ones (e.g. Big C) so substring matches resolve to the correct vendor.
VENDOR_RULES: list[VendorRule] = [
    VendorRule(
        id="CFR", label="Central Food Retail",
        filename_keywords=("cfr",),
        name_keywords=("เซ็นทรัล ฟู้ด รีเทล",),
        taxids=("0105535134278",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="CMK", label="Central + Matsumoto Kiyoshi",
        filename_keywords=("cmk",),
        name_keywords=("มัทสึโมโตะ", "matsumoto"),
        taxids=("0125558018410",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="CFM", label="Central Food Minimart (FamilyMart)",
        filename_keywords=("cfm",),
        name_keywords=("เซ็นทรัลฟู้ด มินิมาร์เก็ต", "central food minimart"),
        taxids=("0105535133093",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="BTM", label="Beautrium",
        filename_keywords=("btm",),
        name_keywords=("บิวเทรี่ยม", "beautrium"),
        taxids=("0105555002130",),
        extract_mode="text",
    ),
    VendorRule(
        id="CFW", label="Central Food Wholesale",
        filename_keywords=("cfw",),
        name_keywords=("เซ็นทรัล ฟู้ด โฮลเซลล์",),
        taxids=("0125565034662",),
        extract_mode="text",
    ),
    VendorRule(
        id="AEON", label="AEON (MaxValu)",
        filename_keywords=("aeon",),
        name_keywords=("อิออน",),
        taxids=("0105527044125",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="BOOTS", label="Boots",
        filename_keywords=("boots",),
        name_keywords=("บู๊ทส์", "boots retail"),
        taxids=("0115539007084",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="CJ", label="CJ Express",
        filename_keywords=("cj",),
        name_keywords=("cj express", "ซี.เจ. เอ็กซ์เพรส", "ซี.เจ.เอ็กซ์เพรส"),
        taxids=("0105556055491",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="FOODLAND", label="Foodland",
        filename_keywords=("foodland",),
        name_keywords=("foodland", "ฟู้ดแลนด์"),
        taxids=("0105515004549",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="PTT", label="PTT (Jiffy)",
        filename_keywords=("ptt",),
        name_keywords=("ปตท",),
        taxids=("0105537121254",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="THEMALL", label="The Mall",
        filename_keywords=("themall",),
        name_keywords=("the mall", "เดอะมอลล์"),
        extract_mode="ocr",
    ),
    VendorRule(
        id="HOMEPRO", label="HomePro",
        filename_keywords=("homepro",),
        name_keywords=("homepro", "home product", "โฮมโปร"),
        taxids=("0107544000043",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="LT", label="Lotus",
        filename_keywords=("lt", "lotus"),
        name_keywords=("โลตัส", "lotus"),
        extract_mode="text",
    ),
    VendorRule(
        id="MAKRO", label="Makro",
        filename_keywords=("makro",),
        name_keywords=("makro", "แม็คโคร"),
        extract_mode="ocr",
    ),
    VendorRule(
        id="TFG", label="Thai Foods Fresh Market",
        filename_keywords=("tfg",),
        name_keywords=("ไทยฟู้ด",),
        extract_mode="ocr",
    ),
    VendorRule(
        id="VILLA", label="Villa Market",
        filename_keywords=("villa",),
        name_keywords=("villa market", "วิลล่า"),
        extract_mode="ocr",
    ),
    VendorRule(
        id="WATSON", label="Watsons",
        filename_keywords=("watson", "watsons"),
        name_keywords=("watson", "วัตสัน"),
        extract_mode="ocr",
    ),
    VendorRule(
        id="TSURUHA", label="Tsuruha",
        filename_keywords=("tsuruha",),
        name_keywords=("tsuruha", "ซูรูฮะ"),
        extract_mode="ocr",
    ),
    VendorRule(
        id="BIGC_FOOD", label="Big C Food Service",
        filename_keywords=("big c food", "bigcfood", "bigc_food"),
        name_keywords=("บิ๊กซี ฟู๊ด", "บิ๊กซีฟู๊ด", "บิ๊กซี ฟู้ด", "big c food", "bigc food"),
        taxids=("0105563176541",),
        extract_mode="auto",
    ),
    VendorRule(
        id="BIGC", label="Big C",
        filename_keywords=("big c", "bigc", "big-c"),
        name_keywords=(
            "บิ๊กซีซูเปอร์เซ็นเตอร์", "บิ๊กซี ซูเปอร์เซ็นเตอร์",
            "big c supercenter", "big c super center", "บิ๊กซี", "big c", "bigc",
        ),
        taxids=("0107536000633",),
        extract_mode="auto",
    ),
    VendorRule(
        id="CP_ALL", label="CP All (7-Eleven)",
        filename_keywords=("cp all", "cpall", "cp-all", "cp_all", "all speedy", "allspeedy"),
        name_keywords=("ซีพี ออลล์", "ซีพีออลล์", "cp all", "cpall", "all speedy", "ออลล์ สปีดดี้"),
        taxids=("0107542000011", "0105565017547"),
        extract_mode="auto",
    ),
]


def _filename_matches(filename: str, keywords: tuple[str, ...]) -> bool:
    fn = filename.lower()
    for kw in keywords:
        pat = r"(^|[^a-z0-9])" + re.escape(kw.lower()) + r"([^a-z0-9]|$)"
        if re.search(pat, fn):
            return True
    return False


def detect_vendor(invoice_text: str, filename: str = "") -> VendorRule | None:
    """Pick the first VendorRule that matches, in priority order."""
    text = invoice_text or ""
    lower = text.lower()

    for r in VENDOR_RULES:
        if any(t in text for t in r.taxids):
            return r

    for r in VENDOR_RULES:
        if any(k.lower() in lower for k in r.name_keywords):
            return r

    for r in VENDOR_RULES:
        if r.filename_keywords and _filename_matches(filename, r.filename_keywords):
            return r

    return None
