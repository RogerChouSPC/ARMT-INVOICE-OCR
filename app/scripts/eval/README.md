# Eval Harness

Measures invoice-extraction accuracy against the human-verified ground-truth
registers in `OUTPUT JAN-APR/`, using the **real** production pipeline
(`src/config/customers.ts` detection + `api/extract.ts` / `api/ocr.ts`), headless.

## Why
Before this, every `customers.ts` change was unmeasured — no way to know if a fix
for one vendor regressed another. This harness turns extraction quality into a
number, per vendor and per field, and acts as a regression gate.

## Setup
- **API key**: needs `OPENROUTER_API_KEY` in `app/.env` (or the environment) for
  the OCR + extraction LLM calls.
- **poppler** (`pdftoppm`): installed via `winget install oschwartz10612.Poppler`.
  Auto-detected from the winget packages dir; override with env `POPPLER_PDFTOPPM`.
- Run everything from the `app/` directory.

## Commands
```bash
# (re)generate the input↔output vendor map (run once / when dataset changes)
python scripts/eval/gen_vendor_map.py

# offline, free — validate the loader/scorer (must be ~100%)
npx tsx scripts/eval/selfcheck.ts

# offline, free — pdf.js text + detection/routing over all 425 PDFs
npx tsx scripts/eval/routing.ts            # or: routing.ts CJ  (one vendor)

# offline, free — Customer Master seed vs register mappings
npx tsx scripts/eval/customerMasterDiff.ts

# the eval (needs API key)
npx tsx scripts/eval/run.ts                # 2 PDFs/vendor (sampled)
npx tsx scripts/eval/run.ts --sample 4
npx tsx scripts/eval/run.ts --vendor CJ
npx tsx scripts/eval/run.ts --all          # every PDF (full LLM cost)
npx tsx scripts/eval/run.ts --concurrency 4
```

## How it works
- **Ground truth**: each register's canonical data is the sheet whose first column
  header is `seq` (the ทะเบียนคุม tab). Rows indexed by `invoiceno`.
- **Join**: extracted rows are matched to GT rows by `invoiceno`, then by closest
  `amount` for multi-line invoices.
- **Scoring**: `normalize.ts` ignores representation noise (whitespace, thousands
  separators, date format, BE/CE year, zero-vs-blank) so only genuine value
  differences count. Money matches within ±0.01.
- **Caching** (`.cache/`, gitignored): pdf text, combined OCR text, and raw LLM
  output are cached. Post-processing in `api/extract.ts` (`postProcessRows`) is
  pure and re-runs for free over cached raw output — so post-processing changes
  re-evaluate at **zero LLM cost**. Editing a vendor's `notes` changes the prompt
  and re-spends on extraction (expected). Delete `.cache/` to force a full re-run.

## Files
| file | role |
|---|---|
| `gen_vendor_map.py` | pairs input folder ↔ register ↔ expected rule id → `vendor-map.json` |
| `fields.ts` | the 22 column keys + field categories |
| `normalize.ts` | field normalisation + match rules |
| `groundTruth.ts` | load a register's `seq` sheet, index by invoiceno |
| `pdfText.ts` | headless pdf.js text extraction (mirrors the app's isDigital logic) |
| `raster.ts` | `pdftoppm` PDF→PNG for the OCR path |
| `cache.ts` | tiny disk cache |
| `pipeline.ts` | run ONE pdf through the real pipeline (mirrors `App.tsx`) |
| `score.ts` | match extracted↔GT, tally per-field |
| `run.ts` | sampled/full runner + report (writes `reports/*.json`) |
| `selfcheck.ts` / `routing.ts` / `customerMasterDiff.ts` | offline diagnostics |

## Caveat
The OCR path rasterises with poppler, not the browser's pdf.js canvas, so OCR text
is not byte-identical to production — an accepted approximation for OCR-path eval.
Text-path extraction and the routing decision are identical to production.
