"""Shared row schema. Matches the 22 columns of data/Output.xlsx."""

from dataclasses import dataclass, field, asdict
from typing import Any


OUTPUT_COLUMNS = [
    "seq ",
    "customergroup",
    "customercode",
    "taxid",
    "vendor_customercode",
    "vendor_branch",
    "vendor_expensecode",
    "vendor_expensegroup",
    "divisionsale",
    "invoiceno",
    "invoicedate",
    "duedate",
    "description",
    "product_description",
    "amount",
    "VAT 7% ",
    "TAX % ",
    "TAX 2% ",
    "TAX 3% ",
    "TAX 5% ",
    "netamount",
    "remark",
]


@dataclass
class InvoiceRow:
    customergroup: str = ""
    customercode: str = ""
    taxid: str = ""
    vendor_customercode: str = ""
    vendor_branch: str = ""
    vendor_expensecode: str = ""
    vendor_expensegroup: str = ""
    divisionsale: str = ""
    invoiceno: str = ""
    invoicedate: str = ""
    duedate: str = ""
    description: str = ""
    product_description: str = ""
    amount: float | str = ""
    vat_7: float | str = ""
    tax_pct: float | str = ""
    tax_2: float | str = ""
    tax_3: float | str = ""
    tax_5: float | str = ""
    netamount: float | str = ""
    remark: str = ""

    def to_excel_row(self, seq: int) -> list[Any]:
        return [
            seq,
            self.customergroup,
            self.customercode,
            self.taxid,
            self.vendor_customercode,
            self.vendor_branch,
            self.vendor_expensecode,
            self.vendor_expensegroup,
            self.divisionsale,
            self.invoiceno,
            self.invoicedate,
            self.duedate,
            self.description,
            self.product_description,
            self.amount,
            self.vat_7,
            self.tax_pct,
            self.tax_2,
            self.tax_3,
            self.tax_5,
            self.netamount,
            self.remark,
        ]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
