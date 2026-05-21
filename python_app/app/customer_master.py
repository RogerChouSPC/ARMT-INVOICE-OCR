"""Loads data/Customer Master.xlsx and provides lookup by taxid (+ branch hint)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import openpyxl


@dataclass
class CustomerMasterEntry:
    store_name: str
    customergroup: str
    customercode: str
    taxid: str

    @property
    def customercode_id(self) -> str:
        """The leading numeric code, e.g. '0118866' from '0118866 - บริษัท ...'."""
        return self.customercode.split(" - ", 1)[0].split("-", 1)[0].strip()


def _norm(s: str | None) -> str:
    return (s or "").strip()


def load_customer_master(xlsx_path: Path | str) -> list[CustomerMasterEntry]:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.active
    entries: list[CustomerMasterEntry] = []
    # Sheet has columns: ชื่อร้านค้า | customergroup | customercode | taxid | PDF | Paper Scan to PDF
    for row in ws.iter_rows(min_row=2, values_only=True):
        store_name, group, code, taxid, *_ = row + (None,) * (4 - len(row))
        if not group or not code:
            continue
        entries.append(
            CustomerMasterEntry(
                store_name=_norm(store_name),
                customergroup=_norm(group),
                customercode=_norm(code),
                taxid=_norm(str(taxid) if taxid is not None else ""),
            )
        )
    return entries


def lookup(
    entries: list[CustomerMasterEntry],
    taxid: str,
    name_hint: str = "",
    branch_hint: str = "",
) -> CustomerMasterEntry | None:
    """Find the best Customer Master row for an invoice.

    Match by taxid first; if multiple rows share the taxid, refine with
    branch hint (e.g. 'สาขาที่00010') then with the name hint.
    """
    taxid = taxid.strip()
    if not taxid:
        return None
    matches = [e for e in entries if e.taxid == taxid]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]

    # Multiple branches share this taxid — refine.
    bh = (branch_hint or "").strip().lower()
    if bh:
        # Try exact "สาขาที่<n>" substring.
        for m in matches:
            if bh in m.customercode.lower() or bh in m.store_name.lower():
                return m

    nh = (name_hint or "").strip().lower()
    if nh:
        best = None
        best_score = 0
        for m in matches:
            score = 0
            ml = (m.store_name + " " + m.customercode).lower()
            for tok in nh.split():
                if tok and tok in ml:
                    score += 1
            if score > best_score:
                best_score = score
                best = m
        if best:
            return best

    # Default: head office row (sees 'สำนักงานใหญ่') if any, else first.
    for m in matches:
        if "สำนักงานใหญ่" in m.customercode:
            return m
    return matches[0]


DEFAULT_MASTER_PATH = (
    Path(__file__).resolve().parents[2]
    / "ARMT-INVOICE-OCR"
    / "data"
    / "Customer Master.xlsx"
)


_MASTER_CACHE: list[CustomerMasterEntry] | None = None


def get_master() -> list[CustomerMasterEntry]:
    """Memoised loader so parsers can call the lookup without an injected dep."""
    global _MASTER_CACHE
    if _MASTER_CACHE is None:
        _MASTER_CACHE = load_customer_master(DEFAULT_MASTER_PATH)
    return _MASTER_CACHE
