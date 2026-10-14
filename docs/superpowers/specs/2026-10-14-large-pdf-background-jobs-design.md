# Large-PDF Background Processing Design

**Date:** 2026-10-14  
**Status:** Proposed  
**Problem:** OCR/extraction of a 277-page CFR PDF returns HTTP 504 because the current `/api/ocr-pdf` and `/api/extract` calls keep a reverse-proxied HTTP request open until all work finishes.

## Goals

- Process PDFs of at least 300 pages without requiring users to split them.
- Return from the upload request quickly enough that it cannot hit the proxy timeout.
- Show truthful page-level OCR progress and extraction progress.
- Continue processing when the browser disconnects or refreshes.
- Preserve the existing customer detection, model prompts, post-processing, row ordering, and Excel output.
- Retry only the failed unit of work where safe, without repeating completed OCR pages.
- Keep invoice data private and automatically remove temporary job data.

## Non-goals

- A distributed queue or multi-host worker fleet.
- Redis, RabbitMQ, or another external service.
- Parallel processing of many large PDFs at full speed; protecting the AI quota and server memory is more important.
- Permanent invoice archiving.
- Changing extraction rules or output columns.

## Selected approach

Add a persistent, single-server background-job subsystem. For a large file, the browser creates a job and receives `202 Accepted` plus a random job ID immediately. A server worker then renders and OCRs bounded page ranges, stores each completed page's OCR text, runs the existing extraction core after OCR completes, and writes the final rows. The browser polls a short status endpoint.

This removes long-lived HTTP requests while retaining the current extraction implementation. Job state lives in a Docker volume so browser refreshes and container restarts do not discard completed OCR work.

Small PDFs keep the current synchronous route initially. PDFs over 25 pages use background jobs. This limits regression risk while covering the known failure and similarly large files. The threshold will be a named frontend constant and can later be lowered after production confidence is established.

## Alternatives considered

### Increase reverse-proxy timeout

Rejected as the primary fix. It only moves the failure boundary, leaves the browser waiting on one fragile request, and retains the current peak-memory behavior.

### Stream heartbeats in the existing response

Rejected. Some reverse proxies buffer streamed output, browser refresh still loses the response, and a process/container restart loses all progress.

### Split calls only in the browser

Rejected as the permanent design. It avoids individual timeouts but requires repeatedly uploading the PDF or adding server-side upload state anyway, and closing the tab stops orchestration.

## API design

All endpoints require the existing Azure bearer token. A job is bound to the authenticated token subject (`oid`, falling back to `sub`); another user receives `404` rather than learning that the job exists.

### `POST /api/jobs`

Creates a job and returns immediately.

Request body:

```json
{
  "filename": "invoice.pdf",
  "pageCount": 277,
  "pdf": "<base64, required for OCR jobs>",
  "text": "<PDF text layer>",
  "isDigital": false,
  "customerMaster": [],
  "customerId": null,
  "customerInstructions": "...",
  "vendorCode": "auto",
  "vendorBranch": "auto"
}
```

The initial customer payload is a hint. After OCR, the worker re-runs `detectCustomer()` against OCR text and builds the effective customer payload, matching today's browser behavior for scanned PDFs.

Response:

```json
{
  "jobId": "random UUID",
  "status": "queued",
  "pagesTotal": 277
}
```

### `GET /api/jobs/:jobId`

Returns a small status document while running and includes `rows` only when complete.

```json
{
  "jobId": "...",
  "filename": "invoice.pdf",
  "status": "ocr",
  "pagesDone": 83,
  "pagesTotal": 277,
  "extractBatchesDone": 0,
  "extractBatchesTotal": 35,
  "progress": 30,
  "createdAt": "...",
  "updatedAt": "...",
  "error": null
}
```

Terminal states are `done` and `error`. Worker states are `queued`, `rendering`, `ocr`, and `extracting`.

No cancel endpoint is included in the first version. Cancellation can be added independently later.

## Persistent job layout

`JOB_DATA_DIR` defaults to `/app/job-data` in Docker and a temporary/local directory in development. Each job has an isolated directory:

```text
job-data/<job-id>/
  metadata.json
  input.pdf
  request.json
  ocr-pages/
    000001.txt
    000002.txt
  result.json
```

- Metadata writes use write-to-temp plus rename so polling never reads partial JSON.
- Secrets and bearer tokens are never written.
- `request.json` contains only extraction inputs needed to resume.
- Finished/error jobs expire after 24 hours by default (`JOB_RETENTION_HOURS`).
- Cleanup never removes an active job.
- The Docker Compose configuration mounts a named volume at `/app/job-data`.

## Worker and data flow

1. Validate the request, page count, decoded PDF size, and required extraction inputs.
2. Create the isolated job directory, persist input and metadata, enqueue the job, and return HTTP 202.
3. A process-local queue runs one PDF job at a time by default (`JOB_CONCURRENCY=1`). This prevents two 300-page PDFs from exhausting memory or API quota.
4. For OCR jobs, invoke Poppler for a bounded range (`-f`/`-l`) of at most 10 pages (`OCR_RENDER_BATCH_PAGES=10`). Do not rasterize the whole PDF into memory.
5. OCR rendered pages with the existing bounded OCR pool. Persist each successful page text immediately and update `pagesDone` only after the page file is durable.
6. On retry or restart, skip page text files that already exist and continue from the first missing page.
7. Join persisted page texts with the existing page-break marker.
8. Re-detect the customer from OCR text when the initial rule was unknown, matching current `App.tsx` behavior.
9. Call the existing `extractRowsCore()` over the complete text. Add an optional progress callback to report completion of each initial eight-page extraction batch; this does not change extraction semantics.
10. Persist final rows, then atomically set the job to `done`.

If the source is a large digital PDF that does not need OCR, the job skips steps 4-7 and uses the supplied text layer before extraction.

## Failure and retry behavior

- A transient OCR/model failure is retried with bounded exponential delays: 2 s, 5 s, and 10 s.
- Successfully persisted OCR pages are never repeated during job retry or process restart.
- Existing extraction JSON-repair/split logic remains unchanged.
- After retries are exhausted, set `status=error` with a user-safe stage and page/batch description. Do not expose API keys or upstream response bodies.
- A malformed/corrupt PDF fails during validation or rendering with an actionable message.
- If a worker process restarts, startup recovery scans non-terminal jobs and re-enqueues them. OCR resumes from page files; extraction restarts from the assembled OCR text.
- Polling failures do not mark the job failed. The browser retries polling with backoff and may reacquire an Azure token.

## Frontend behavior

- Files with more than 25 pages use the background-job API. Existing behavior remains for smaller files.
- Save active `{jobId, filename, pagesTotal}` entries in local storage.
- Poll active jobs every two seconds while the page is visible, backing off to five seconds after repeated network errors.
- Restore polling after login on page refresh.
- Map server states to the current processing-status UI.
- Display actual `pagesDone/pagesTotal`; remove the current `finally` behavior that marks all pages done after an error.
- During extraction, show extraction batches as secondary detail; do not pretend additional OCR pages completed.
- On completion, merge rows into the results table in file order and remove the active-job entry.
- PDF preview remains available during the original tab session. After refresh, the job can be resumed but preview is unavailable because the browser no longer holds the original `File` object.

## Security and privacy

- Extend token verification to return the verified/validated token subject without changing current success/failure behavior.
- Bind every job to that subject and authorize every status/result lookup.
- Use UUIDs generated with `crypto.randomUUID()` and never accept a filesystem path from the client.
- Validate base64 decoded size against the existing 50 MB request ceiling and reject invalid PDFs.
- Store data only beneath the configured job root and delete it on expiry.
- Do not log raw OCR text, invoice rows, customer-master content, or bearer tokens.

## Code boundaries

Expected changes:

- `app/api/jobs.ts`: authenticated create/status handlers.
- `app/api/jobStore.ts`: safe persistent metadata/input/result operations and cleanup.
- `app/api/jobWorker.ts`: queue, startup recovery, batched raster/OCR, extraction orchestration, retries.
- `app/api/ocrPdf.ts`: export reusable bounded rendering/OCR helpers; retain current route for small files.
- `app/api/extract.ts`: optional extraction progress callback only; extraction/post-processing behavior remains identical.
- `app/api/verifyToken.ts`: return a stable subject for job ownership.
- `app/src/config/customers.ts`: remain the shared source for post-OCR customer detection; include this shared config in the runtime image.
- `app/server/index.ts`: register job routes and start recovery.
- `app/src/App.tsx`: submit/poll/restore large jobs and correct progress behavior.
- `app/src/types/invoice.ts`, `app/src/components/ProcessingStatus.tsx`, and translations: represent restored jobs and precise progress.
- `app/Dockerfile`, `app/docker-compose.yml`, and `.env.example`: include shared customer config, persistent job directory, and tunables.

The job store and worker stay separate so persistence can later move to a database without changing the HTTP API or UI.

## Testing strategy

### Unit tests

- Atomic job metadata write/read and path confinement.
- Owner authorization and unknown-job behavior.
- Expiration cleanup excludes active jobs.
- Progress calculation for OCR and extraction phases.
- Startup recovery and skipping persisted OCR pages.
- Retry succeeds after transient failures and becomes terminal after exhaustion.

### API tests

- Create returns 202 before worker completion.
- Status transitions in order and exposes rows only at `done`.
- A different authenticated subject cannot read a job.
- Invalid/missing PDF payload is rejected without creating a partial job.

### Regression tests

- Existing extraction unit/eval behavior remains unchanged.
- `npm run build` succeeds.
- Existing small-PDF synchronous path still works.

### Large-file acceptance test

Use the local 292-page CFR sample as the pre-deployment stress case:

- Upload finishes quickly with 202 and no 504.
- Server memory remains bounded because at most one render batch is held.
- Progress increases from real completed pages, survives page refresh, and never jumps to complete on error.
- Job produces rows and completes without manually splitting the PDF.
- Compare row count/key invoice fields against the same sample processed in smaller verified groups.

## Rollout and rollback

- The threshold keeps small-file traffic on the proven synchronous path.
- Deploy the new named volume before enabling large jobs.
- Log job ID, state transitions, duration, page number, and batch number only.
- If production issues appear, raise the client threshold above supported file sizes to route no files into jobs, leaving existing endpoints intact; no data migration is required.

## Success criteria

- The reported 277-page CFR file completes without HTTP 504 or manual splitting.
- The upload/create request responds in under five seconds on the company network.
- No request used for polling or job creation remains open for the duration of OCR/extraction.
- Peak image memory is bounded by the configured render batch rather than total PDF pages.
- Displayed progress corresponds to durable completed work.
- Browser refresh does not cancel the server job or lose the ability to retrieve its result within retention.
- Existing small invoice behavior and extracted output remain unchanged.
