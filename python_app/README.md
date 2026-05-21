# ARMT Invoice OCR — Python implementation

A FastAPI version of the invoice extractor that minimises OpenRouter spend by
running deterministic per-vendor parsers in Python and reserving the vision LLM
strictly for OCR (no LLM extraction step).

Status (M1): foundations + 2 vendor parsers (BTM, CFW) validate end-to-end
against `data/Output.xlsx`. Other 19 vendors land in M2.

## Cost model

| Path                 | Vendors                                  | API spend per page |
|----------------------|------------------------------------------|--------------------|
| Text + Python parse  | BTM, Big C, CFW, LT                      | $0                 |
| OCR + Python parse   | 17 others (broken-CID or pure scan PDFs) | 1 vision call only |

The existing TypeScript app pays for BOTH OCR and LLM-extraction per page; the
Python app drops the extraction call entirely.

## Run

```bash
cd python_app
python -m pip install -r requirements.txt

# Validate against data/Output.xlsx
python -m app.cli

# Process a single PDF
python -m app.cli ../ARMT-INVOICE-OCR/data/sample_invoices/BTM_Invoice.pdf

# Boot the web app
cp .env.example .env   # then set OPENROUTER_API_KEY
python -m uvicorn app.main:app --reload --port 8000
# → open http://127.0.0.1:8000
```

## Layout

```
app/
  schema.py         InvoiceRow + 22-column output schema
  customer_master.py  Loads data/Customer Master.xlsx, lookup by taxid + branch
  detect.py         Vendor detection (priority: taxid → name → filename)
  pdf_text.py       pdfplumber text layer + pypdfium2 page rasteriser
  ocr.py            Gemini-via-OpenRouter image OCR (only for scanned vendors)
  parsers/
    common.py       Thai date parsing, amount cleanup
    btm.py          Beautrium parser  (text)
    cfw.py          Central Food Wholesale parser  (text)
    …               more vendors land here in M2
  excel_export.py   Writes a 22-column .xlsx matching data/Output.xlsx
  extract.py        Top-level pipeline: PDF → text/OCR → parser → row
  main.py           FastAPI app (POST /api/extract, /api/excel; GET /)
  cli.py            `python -m app.cli` validator + single-file mode
```

## Adding a new vendor parser

1. Confirm the vendor is already registered in `app/detect.py` (taxid + name
   keywords). Add it there if not.
2. Create `app/parsers/<vendor>.py` exporting `parse(text, filename) -> list[InvoiceRow]`.
   Look at `btm.py` as a template — it's the simplest case (one invoice per page,
   clean text layer).
3. Register the parser in `app/parsers/__init__.py` (`get_parser` registry).
4. Run `python -m app.cli` and confirm the new vendor's gold rows show
   `matched` rather than `missing`.
