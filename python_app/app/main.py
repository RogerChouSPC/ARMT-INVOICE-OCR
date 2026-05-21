"""FastAPI app exposing the extraction pipeline.

Endpoints:
  POST /api/extract  — upload one or more PDFs, returns JSON {rows: [...]}
  POST /api/excel    — upload PDFs, returns the .xlsx file directly
  GET  /             — minimal HTML upload UI
"""

from __future__ import annotations

import io

import asyncio

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse

from app.customer_master import DEFAULT_MASTER_PATH, load_customer_master
from app.excel_export import write_excel
from app.extract import extract_pdf


async def _extract_in_thread(pdf_bytes, filename, master):
    """extract_pdf is sync and internally calls asyncio.run() for OCR.
    FastAPI's handler runs in an active event loop, so call asyncio.run()
    from there would error. Wrapping in a thread gives the sync code its
    own event loop context.
    """
    return await asyncio.to_thread(extract_pdf, pdf_bytes, filename, master)


app = FastAPI(title="ARMT Invoice OCR (Python)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_MASTER_CACHE = None


def _master():
    global _MASTER_CACHE
    if _MASTER_CACHE is None:
        _MASTER_CACHE = load_customer_master(DEFAULT_MASTER_PATH)
    return _MASTER_CACHE


@app.post("/api/extract")
async def api_extract(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "No files uploaded.")
    out_rows = []
    warnings: list[str] = []
    for f in files:
        data = await f.read()
        result = await _extract_in_thread(data, f.filename or "", _master())
        for r in result.rows:
            out_rows.append(r.to_dict() | {"_source": f.filename})
        warnings.extend(f"{f.filename}: {w}" for w in result.warnings)
    return {"rows": out_rows, "warnings": warnings}


@app.post("/api/excel")
async def api_excel(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "No files uploaded.")
    all_rows = []
    for f in files:
        data = await f.read()
        result = await _extract_in_thread(data, f.filename or "", _master())
        all_rows.extend(result.rows)
    excel_bytes = write_excel(all_rows)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="extracted.xlsx"'},
    )


@app.get("/", response_class=HTMLResponse)
async def index():
    # One-button flow: user uploads PDFs → server auto-routes each file to either
    # the Python parser (for vendors with a clean text layer) or to OCR + parser
    # (for scanned / broken-font PDFs). Results render inline; a "Download Excel"
    # link appears after extraction succeeds.
    return """
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ARMT Invoice OCR</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 3rem auto; padding: 0 1rem; color: #222; }
  h1 { margin-bottom: 0.25rem; }
  p.lead { color: #666; margin-top: 0; }
  .drop { border: 2px dashed #ccc; padding: 2rem; text-align: center; border-radius: 10px; transition: background .15s, border-color .15s; }
  .drop.hover { border-color: #2b6cb0; background: #ebf4ff; }
  .drop input { margin-top: .75rem; }
  .controls { margin: 1.25rem 0; display: flex; align-items: center; gap: 1rem; }
  button.primary { padding: .7rem 1.6rem; background: #2b6cb0; color: white; border: none;
           border-radius: 6px; cursor: pointer; font-size: 1rem; font-weight: 600; }
  button.primary:disabled { background: #888; cursor: default; }
  button.danger { padding: .7rem 1.2rem; background: #fff; color: #b54708; border: 1px solid #d97706;
           border-radius: 6px; cursor: pointer; font-size: .95rem; }
  button.danger:hover { background: #fff7ed; }
  button.danger[hidden] { display: none; }
  a.download { color: #2b6cb0; text-decoration: none; font-weight: 500; }
  a.download:hover { text-decoration: underline; }
  #status { color: #555; font-size: .95rem; }
  table { border-collapse: collapse; margin-top: 1.5rem; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; position: sticky; top: 0; }
  .warn { color: #b54708; }
  .warn ul { margin: .25rem 0 0 1.25rem; padding: 0; }
  .file-pill { display: inline-block; background: #eef; padding: 2px 8px; border-radius: 999px; margin: 2px 4px 0 0; font-size: 12px; }

  /* Per-file progress list */
  .progress-list { margin: 1rem 0; }
  .progress-row { display: grid; grid-template-columns: 1fr 100px 90px;
       gap: .75rem; align-items: center; padding: .5rem .75rem;
       border-bottom: 1px solid #eee; font-size: .9rem; }
  .progress-row:first-child { border-top: 1px solid #eee; }
  .progress-row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .progress-bar { background: #eee; border-radius: 3px; height: 8px; overflow: hidden; position: relative; }
  .progress-bar .fill { background: #2b6cb0; height: 100%; width: 0%; transition: width .15s ease; }
  .progress-bar.indet .fill { width: 30%; animation: indet 1.2s linear infinite; }
  @keyframes indet { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
  .progress-row .state { font-weight: 500; font-size: .85rem; }
  .state.queued    { color: #6b7280; }
  .state.processing { color: #2b6cb0; }
  .state.done      { color: #16a34a; }
  .state.error     { color: #b54708; }
  .state.cancelled { color: #6b7280; }
</style>
</head>
<body>
<h1>ARMT Invoice OCR</h1>
<p class="lead">Upload Thai vendor invoice PDFs. The server auto-picks parser vs. OCR per file.</p>

<div class="drop" id="drop">
  Drop PDF files here, or
  <input type="file" id="files" accept="application/pdf" multiple />
  <div id="picked"></div>
</div>

<div class="controls">
  <button class="primary" id="extractBtn">Extract</button>
  <button class="danger" id="cancelBtn" hidden>Cancel</button>
  <span id="status"></span>
  <span id="downloadSlot"></span>
</div>

<div id="progressList" class="progress-list" hidden></div>

<div id="results"></div>

<script>
const drop = document.getElementById('drop');
const filesInput = document.getElementById('files');
const status = document.getElementById('status');
const results = document.getElementById('results');
const downloadSlot = document.getElementById('downloadSlot');
const picked = document.getElementById('picked');
const extractBtn = document.getElementById('extractBtn');
const cancelBtn = document.getElementById('cancelBtn');
const progressList = document.getElementById('progressList');
let lastFiles = [];
let abortCtrl = null;  // AbortController for in-flight upload
let cancelled = false;

function renderPicked() {
  picked.innerHTML = lastFiles.length
    ? lastFiles.map(f => `<span class="file-pill">${f.name}</span>`).join('')
    : '';
}

filesInput.addEventListener('change', e => { lastFiles = Array.from(e.target.files); renderPicked(); });
['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hover'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hover'); }));
drop.addEventListener('drop', e => { lastFiles = Array.from(e.dataTransfer.files); renderPicked(); });

function renderProgress(items) {
  // items: [{name, state, rows, error}]
  progressList.hidden = items.length === 0;
  progressList.innerHTML = items.map((it, i) => {
    const indet = it.state === 'processing' ? 'indet' : '';
    const pct = it.state === 'done' ? 100 : (it.state === 'processing' ? 0 : 0);
    return `
      <div class="progress-row">
        <div class="name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>
        <div class="progress-bar ${indet}"><div class="fill" style="width:${pct}%"></div></div>
        <div class="state ${it.state}">${it.state}${it.rows!=null ? ' · '+it.rows+' rows' : ''}${it.error ? ' · '+escapeHtml(it.error) : ''}</div>
      </div>`;
  }).join('');
}

extractBtn.addEventListener('click', async () => {
  if (lastFiles.length === 0) { alert('Pick at least one PDF first.'); return; }
  cancelled = false;
  abortCtrl = new AbortController();
  results.innerHTML = '';
  downloadSlot.innerHTML = '';
  status.textContent = '';
  extractBtn.disabled = true;
  cancelBtn.hidden = false;

  // Per-file state — start all 'queued'.
  const items = lastFiles.map(f => ({ name: f.name, state: 'queued', rows: null, error: '' }));
  renderProgress(items);

  const allRows = [];
  const allWarnings = [];

  try {
    for (let i = 0; i < lastFiles.length; i++) {
      if (cancelled) {
        // Mark remaining files as cancelled.
        for (let j = i; j < items.length; j++) {
          if (items[j].state === 'queued') items[j].state = 'cancelled';
        }
        renderProgress(items);
        break;
      }
      items[i].state = 'processing';
      renderProgress(items);

      const fd = new FormData();
      fd.append('files', lastFiles[i]);
      try {
        const res = await fetch('/api/extract', {
          method: 'POST', body: fd, signal: abortCtrl.signal,
        });
        if (!res.ok) {
          items[i].state = 'error';
          items[i].error = `HTTP ${res.status}`;
        } else {
          const data = await res.json();
          items[i].state = 'done';
          items[i].rows = data.rows.length;
          allRows.push(...data.rows);
          allWarnings.push(...(data.warnings || []));
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          items[i].state = 'cancelled';
          cancelled = true;
        } else {
          items[i].state = 'error';
          items[i].error = String(e.message || e);
        }
      }
      renderProgress(items);
    }

    if (allRows.length || allWarnings.length) {
      renderRows({ rows: allRows, warnings: allWarnings });
      const doneCount = items.filter(x => x.state === 'done').length;
      status.textContent = `${allRows.length} row(s) extracted from ${doneCount} file(s).`;
      // Build Excel from the accumulated rows server-side; only send the
      // succeeded files to avoid re-processing.
      const succeededFiles = lastFiles.filter((_, i) => items[i].state === 'done');
      if (succeededFiles.length) {
        const fd2 = new FormData();
        succeededFiles.forEach(f => fd2.append('files', f));
        const xRes = await fetch('/api/excel', { method: 'POST', body: fd2 });
        if (xRes.ok) {
          const blob = await xRes.blob();
          const url = URL.createObjectURL(blob);
          downloadSlot.innerHTML = `<a class="download" href="${url}" download="extracted.xlsx">⬇ Download as Excel</a>`;
        }
      }
    }
  } finally {
    extractBtn.disabled = false;
    cancelBtn.hidden = true;
    abortCtrl = null;
  }
});

cancelBtn.addEventListener('click', () => {
  cancelled = true;
  if (abortCtrl) abortCtrl.abort();
  status.textContent = 'Cancelling…';
});

function renderRows(data) {
  let html = '';
  if (data.warnings?.length) {
    html += '<div class="warn"><strong>Notes:</strong><ul>' + data.warnings.map(w => '<li>'+escapeHtml(w)+'</li>').join('') + '</ul></div>';
  }
  if (!data.rows.length) { results.innerHTML = html + '<p>No rows extracted.</p>'; return; }
  const keys = Object.keys(data.rows[0]);
  html += '<table><thead><tr>' + keys.map(k => '<th>'+escapeHtml(k)+'</th>').join('') + '</tr></thead><tbody>';
  for (const r of data.rows) {
    html += '<tr>' + keys.map(k => '<td>' + escapeHtml(r[k] ?? '') + '</td>').join('') + '</tr>';
  }
  html += '</tbody></table>';
  results.innerHTML = html;
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
</script>
</body>
</html>
"""
