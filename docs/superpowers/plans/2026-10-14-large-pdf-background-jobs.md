# Large-PDF Background Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process 300-page invoice PDFs without HTTP 504, unbounded image memory, manual PDF splitting, or false progress reporting.

**Architecture:** Large files become persistent background jobs: a short authenticated create request stores the PDF and returns a UUID, a single-server worker renders/OCRs ten-page ranges and persists page text, then the existing extraction core produces final rows while the browser polls status. Small files retain the existing synchronous path; active large jobs persist through browser refresh and resume after a container restart.

**Tech Stack:** Node.js 20, TypeScript, Express 4, React 18, Poppler (`pdfinfo`, `pdftoppm`), OpenRouter/Gemini, Node's built-in test runner through `tsx --test`, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-14-large-pdf-background-jobs-design.md`

## Global Constraints

- Preserve all existing customer detection, prompts, deterministic post-processing, output fields, and row ordering.
- Keep the existing synchronous routes for PDFs of 25 pages or fewer.
- Use background jobs for PDFs over 25 pages.
- Render at most 10 PDF pages at once; never materialize every page image for a large job.
- Run one large job at a time by default; retain the existing per-page OCR concurrency cap within that job.
- Persist job state beneath `JOB_DATA_DIR`; never persist bearer tokens or API keys.
- Bind every job to the authenticated Azure `oid`, falling back to `sub`.
- Retain terminal job data for 24 hours by default and never delete an active job.
- Do not add Redis, RabbitMQ, a database, or another external runtime dependency.
- Treat invoice text, customer master rows, and extracted rows as private: never place them in logs.
- Use TDD for each task and commit only the files named by that task.

## Review Focus

- Malformed base64, non-PDF bytes, and payloads above the decoded-size ceiling must return 400/413 without leaving a partial job directory (Task 6 API tests).
- A process restart after page 83 must re-enqueue the job and skip all durable OCR pages rather than charging for them twice (Task 5 recovery test).
- A valid second user must receive 404 for another user's job ID, including completed jobs (Task 6 authorization test).
- A transient OCR 429/network error must retry only that page while progress remains at the last durable page; permanent failure must become terminal (Task 5 retry tests).
- Refreshing while a job completes, or starting two pollers for the same saved job, must add final rows only once (Task 7 restore/deduplication test).

---

## File map

**Create**

- `app/api/jobTypes.ts` — persistent job/request/result contracts shared by store, worker, and handlers.
- `app/api/jobStore.ts` — path-safe atomic persistence, page checkpoints, recovery listing, and retention cleanup.
- `app/api/pdfRaster.ts` — Poppler discovery, page counting, ten-page range generation, and bounded rasterization.
- `app/api/jobWorker.ts` — one-process queue, recovery, retry policy, OCR orchestration, extraction, and progress updates.
- `app/api/jobs.ts` — authenticated create/status HTTP handlers with ownership enforcement.
- `app/src/api/backgroundJobs.ts` — browser API calls, polling, active-job local-storage registry, and progress helpers.
- `app/tests/jobStore.test.ts`, `verifyToken.test.ts`, `pdfRaster.test.ts`, `extractProgress.test.ts`, `jobWorker.test.ts`, `jobsApi.test.ts`, `backgroundJobs.test.ts` — focused Node tests.

**Modify**

- `app/package.json` — add the explicit TypeScript test command.
- `app/api/verifyToken.ts` — include the stable authenticated subject in successful verification.
- `app/api/ocrPdf.ts` — consume bounded raster helpers while retaining the compatibility route.
- `app/api/extract.ts` — accept an optional extraction-progress callback/model-call seam.
- `app/server/index.ts` — register job endpoints and recover unfinished work at startup.
- `app/src/App.tsx` — route files over 25 pages through jobs and restore active jobs after login.
- `app/src/types/invoice.ts` — represent restored jobs without an in-memory `File`, plus real progress fields.
- `app/src/components/ProcessingStatus.tsx` — render accurate page/batch progress and disable unavailable preview.
- `app/src/i18n/dictionary.ts` — Thai/English background-job progress text.
- `app/Dockerfile`, `app/docker-compose.yml`, `app/.env.example` — runtime shared config, volume, and job tuning.
- `PROGRESS.md` and `project_doc/IT_Director_Technical.md` — record the actual background-processing architecture.

---

### Task 1: Persistent job contracts and atomic store

**Files:**
- Create: `app/api/jobTypes.ts`
- Create: `app/api/jobStore.ts`
- Create: `app/tests/jobStore.test.ts`
- Modify: `app/package.json:6-12`

**Interfaces:**
- Produces: `JobStage`, `StoredJobRequest`, `JobMetadata`, `JobResult`, `JobStore`, and `createJobStore(rootDir)`.
- JobStore methods used later: create, readMetadata, updateMetadata, readRequest, writeOcrPage, readOcrPage, listCompletedOcrPages, writeResult, readResult, listRecoverable, and cleanupExpired.

- [ ] **Step 1: Add the explicit test command and write failing store tests**

Add the test script shown below to package.json without changing existing scripts. Create tests/jobStore.test.ts with Node node:test and temporary directories only.

Package script value: `tsx --test tests/*.test.ts`.

The test fixture must be exactly:

```ts
const request: StoredJobRequest = {
  filename: 'large.pdf', pageCount: 277, text: '', isDigital: false,
  useOcr: true, customerMaster: [], customerId: null,
  customerInstructions: '', vendorCode: 'auto', vendorBranch: 'auto',
}
```

Test these five behaviors with `node:assert/strict`:

1. `create('owner-1', request, Buffer.from('%PDF-test'))` persists queued metadata, `request.json`, and `input.pdf`, and neither JSON file matches `/Bearer|apiKey/i`.
2. `updateMetadata(id, { stage: 'ocr', pagesDone: 7 })` preserves filename/owner and makes a subsequent read return 7.
3. Writing page 10 then page 2 makes `listCompletedOcrPages` return `[2, 10]`, and both texts round-trip.
4. `readMetadata('../escape')` rejects with `/invalid job id/i`.
5. Cleanup at 2026-10-14 with 24-hour retention removes an old `done` job but preserves an equally old `ocr` job.

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npx tsx --test tests/jobStore.test.ts`  
Expected: FAIL because `../api/jobStore` and `../api/jobTypes` do not exist.

- [ ] **Step 3: Implement job types and the minimal path-safe store**

Define these contracts in `api/jobTypes.ts`:

```ts
export type JobStage = 'queued' | 'rendering' | 'ocr' | 'extracting' | 'done' | 'error'

export interface StoredJobRequest {
  filename: string; pageCount: number; text: string; isDigital: boolean; useOcr: boolean
  customerMaster: unknown[]; customerId: string | null; customerInstructions: string
  vendorCode: string; vendorBranch: string
}

export interface JobMetadata {
  id: string; ownerId: string; filename: string; stage: JobStage
  pagesDone: number; pagesTotal: number
  extractBatchesDone: number; extractBatchesTotal: number
  createdAt: string; updatedAt: string; error: string | null
}

export interface JobResult { rows: Record<string, unknown>[] }
```

Implement `createJobStore(rootDir)` with `node:fs/promises`, `crypto.randomUUID()`, UUID validation, six-digit page filenames, and one private `writeJsonAtomic(path, value)` that writes a UUID-suffixed temporary file then renames it. `create()` makes the job directory with `recursive: false`, persists request/PDF, then writes metadata last. `readMetadata()` returns null only for `ENOENT`; corrupt JSON throws. `listRecoverable()` returns `queued|rendering|ocr|extracting`. Cleanup removes only expired `done|error` directories.

- [ ] **Step 4: Run the focused test and full build**

Run: `npx tsx --test tests/jobStore.test.ts`  
Expected: 5 tests PASS.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit the store**

```bash
git add app/package.json app/api/jobTypes.ts app/api/jobStore.ts app/tests/jobStore.test.ts
git commit -m 'feat: add persistent invoice job store'
```

---

### Task 2: Authenticated job ownership identity

**Files:**
- Create: `app/tests/verifyToken.test.ts`
- Modify: `app/api/verifyToken.ts:12-78`

**Interfaces:**
- Produces: discriminated `VerifyResult` with `subject` on success, plus pure `tokenSubjectFromClaims(claims)`.
- Task 6 consumes `VerifyResult.subject`; existing handlers continue checking only `ok` and `reason`.

- [ ] **Step 1: Write failing subject-selection tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { tokenSubjectFromClaims } from '../api/verifyToken'

test('uses Azure object id before sub', () => {
  assert.equal(tokenSubjectFromClaims({ oid: 'object-id', sub: 'subject-id' }), 'object-id')
})

test('falls back to sub and rejects missing identity', () => {
  assert.equal(tokenSubjectFromClaims({ sub: 'subject-id' }), 'subject-id')
  assert.equal(tokenSubjectFromClaims({}), null)
})
```

- [ ] **Step 2: Verify the export is absent**

Run: `npx tsx --test tests/verifyToken.test.ts`  
Expected: FAIL because `tokenSubjectFromClaims` is not exported.

- [ ] **Step 3: Return a subject from both verification success paths**

```ts
export type VerifyResult =
  | { ok: true; reason: string; subject: string }
  | { ok: false; reason: string }

export function tokenSubjectFromClaims(claims: Record<string, unknown>): string | null {
  const value = claims.oid ?? claims.sub
  return typeof value === 'string' && value.trim() ? value : null
}
```

Require the existing audience/tenant/expiry checks and a subject in the claims-only path. In the signed-JWT path derive it from `payload`; reject a valid token with `reason: 'subject-missing'` when absent. Do not change cooldown, tenant, audience, expiry, or clock-skew behavior.

- [ ] **Step 4: Run auth tests and build**

Run: `npx tsx --test tests/verifyToken.test.ts`  
Expected: 2 tests PASS.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit ownership identity**

```bash
git add app/api/verifyToken.ts app/tests/verifyToken.test.ts
git commit -m 'feat: expose authenticated job owner'
```

---

### Task 3: Bounded PDF page-range rasterization

**Files:**
- Create: `app/api/pdfRaster.ts`
- Create: `app/tests/pdfRaster.test.ts`
- Modify: `app/api/ocrPdf.ts:1-108`

**Interfaces:**
- Produces: `pageRanges(total, batchSize)`, `parsePdfInfoPages(output)`, `getPdfPageCount(pdfPath)`, and `renderPdfPageRange(pdfPath, startPage, endPage)`.
- `renderPdfPageRange` returns `Array<{ page: number; pngBase64: string }>` in ascending absolute page order.
- Task 5 and `/api/ocr-pdf` consume these helpers.

- [ ] **Step 1: Write failing pure range/parser tests**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { pageRanges, parsePdfInfoPages, sortRenderedPageNames } from '../api/pdfRaster'

test('splits 277 pages into ten-page ranges', () => {
  const ranges = pageRanges(277, 10)
  assert.deepEqual(ranges[0], { startPage: 1, endPage: 10 })
  assert.deepEqual(ranges.at(-1), { startPage: 271, endPage: 277 })
  assert.equal(ranges.length, 28)
  assert.ok(ranges.every(r => r.endPage - r.startPage + 1 <= 10))
})

test('validates range inputs and parses pdfinfo', () => {
  assert.throws(() => pageRanges(0, 10), /total pages/i)
  assert.throws(() => pageRanges(10, 0), /batch size/i)
  assert.equal(parsePdfInfoPages('Title: x\nPages: 292\n'), 292)
  assert.throws(() => parsePdfInfoPages('Title: x\n'), /page count/i)
})

test('sorts Poppler output numerically', () => {
  assert.deepEqual(sortRenderedPageNames(['page-12.png', 'page-10.png', 'page-11.png']), [
    { filename: 'page-10.png', page: 10 },
    { filename: 'page-11.png', page: 11 },
    { filename: 'page-12.png', page: 12 },
  ])
})
```

- [ ] **Step 2: Verify the raster module is absent**

Run: `npx tsx --test tests/pdfRaster.test.ts`  
Expected: FAIL because `../api/pdfRaster` does not exist.

- [ ] **Step 3: Implement bounded Poppler helpers**

Move Poppler discovery from `ocrPdf.ts` into `pdfRaster.ts`, keeping Windows WinGet search and Linux PATH fallback. Add `findPdfInfo()` beside `findPdftoppm()` and export:

```ts
export function pageRanges(totalPages: number, batchSize: number): PageRange[]
export function parsePdfInfoPages(output: string): number
export function sortRenderedPageNames(names: string[]): Array<{ filename: string; page: number }>
export function getPdfPageCount(pdfPath: string): number
export function renderPdfPageRange(pdfPath: string, startPage: number, endPage: number): RenderedPage[]
```

`renderPdfPageRange` creates a temporary output directory and calls `pdftoppm` with `-png -r <DPI> -f <start> -l <end> <pdf> <output-prefix>`. Read only that range into memory and remove its directory in `finally`. Validate integers and `1 <= start <= end` before executing Poppler.

- [ ] **Step 4: Refactor the compatibility route without changing its response**

Keep authentication, request validation, and `{ text, pages }` unchanged. Write the upload to one temporary PDF, get its real page count, loop over `pageRanges(total, OCR_RENDER_BATCH_PAGES)`, OCR each range with the existing pool, append text in page order, and clean up in `finally`. Default `OCR_RENDER_BATCH_PAGES` to 10 and reject values below 1.

- [ ] **Step 5: Run tests and build**

Run: `npx tsx --test tests/pdfRaster.test.ts`  
Expected: 3 tests PASS.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit bounded rasterization**

```bash
git add app/api/pdfRaster.ts app/api/ocrPdf.ts app/tests/pdfRaster.test.ts
git commit -m 'refactor: bound PDF rasterization memory'
```

---

### Task 4: Observable extraction batches without semantic changes

**Files:**
- Create: `app/tests/extractProgress.test.ts`
- Modify: `app/api/extract.ts:453-610`

**Interfaces:**
- Produces: `ExtractProgress { completedBatches, totalBatches }` and `ExtractCoreOptions { onProgress?, callModel? }`.
- Changes signature to `extractRowsCore(input, options = {})`; all existing one-argument calls remain valid.
- Task 5 supplies `onProgress`; test code supplies `callModel` to avoid external AI calls.

- [ ] **Step 1: Write a failing deterministic progress test**

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { extractRowsCore } from '../api/extract'

test('reports one durable progress event per initial eight-page batch', async () => {
  const pages = Array.from({ length: 17 }, (_, i) => `invoice page ${i + 1}`)
  const events: Array<{ completedBatches: number; totalBatches: number }> = []
  const result = await extractRowsCore({
    text: pages.join('\n--- PAGE BREAK ---\n'), filename: 'x.pdf',
    customerSection: 'test', vendorCode: 'auto', vendorBranch: 'auto',
    customerId: '', customerMasterJson: '[]', apiKey: 'unused',
  }, {
    callModel: async () => ({ ok: true, content: '[]' }),
    onProgress: event => events.push(event),
  })
  assert.equal(result.ok, true)
  assert.deepEqual(events.map(x => x.completedBatches), [1, 2, 3])
  assert.ok(events.every(x => x.totalBatches === 3))
})
```

- [ ] **Step 2: Verify the options argument is unsupported**

Run: `npx tsx --test tests/extractProgress.test.ts`  
Expected: FAIL with a signature/type or ignored-progress assertion failure.

- [ ] **Step 3: Thread options through the existing extraction pool**

Default `callModel` to `callExtractModel`. Pass it into every recursive `extractPageSlice` call, including its single-page retry. After each top-level chunk writes `results[i]`, increment one local completed counter and call:

```ts
options.onProgress?.({ completedBatches: completed, totalBatches: chunks.length })
```

Do not report recursive split calls as additional batches. Do not alter batch size 8, concurrency 5, parse recovery, failure selection, row merge order, or `postProcessRows` invocation.

- [ ] **Step 4: Run test and build**

Run: `npx tsx --test tests/extractProgress.test.ts`  
Expected: PASS with events 1, 2, 3.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 5: Commit observable extraction**

```bash
git add app/api/extract.ts app/tests/extractProgress.test.ts
git commit -m 'refactor: report extraction batch progress'
```

---

### Task 5: Recoverable background worker and retry policy

**Files:**
- Create: `app/api/jobWorker.ts`
- Create: `app/tests/jobWorker.test.ts`

**Interfaces:**
- Consumes: `JobStore`, `pageRanges`, `renderPdfPageRange`, `ocrImageCore`, `extractRowsCore`, and shared customer detection.
- Produces: `createJobWorker(deps, config)` returning `enqueue(id)`, `recover()`, `waitForIdle()`, and `stop()`.
- `JobWorkerDeps` injects store, page counting/rendering, OCR, extraction, API-key lookup, sleep, and clock so tests perform no I/O beyond the temporary store.

- [ ] **Step 1: Write failing worker tests with fakes**

Create a fixture store and a `deps` object whose renderer returns page-tagged images, OCR returns matching text, and extractor returns one row. Pin these behaviors:

```ts
test('processes 23 pages in ranges no larger than ten and persists final rows', async () => {
  const seenRanges: Array<[number, number]> = []
  const { store, worker, job } = await fixture({
    pageCount: 23,
    render: async (_path, start, end) => {
      seenRanges.push([start, end])
      return Array.from({ length: end - start + 1 }, (_, i) => ({
        page: start + i, pngBase64: `png-${start + i}`,
      }))
    },
  })
  worker.enqueue(job.id)
  await worker.waitForIdle()
  assert.deepEqual(seenRanges, [[1, 10], [11, 20], [21, 23]])
  assert.equal((await store.readMetadata(job.id))?.stage, 'done')
  assert.equal((await store.readResult(job.id))?.rows.length, 1)
})

test('recovery skips durable OCR pages after restart', async () => {
  const called: number[] = []
  const { store, worker, job } = await fixture({ pageCount: 5, onOcr: page => called.push(page) })
  await store.writeOcrPage(job.id, 1, 'already done')
  await store.writeOcrPage(job.id, 2, 'already done')
  await store.updateMetadata(job.id, { stage: 'ocr', pagesDone: 2 })
  await worker.recover()
  await worker.waitForIdle()
  assert.deepEqual(called, [3, 4, 5])
})
```

Also test that an OCR function failing twice with `{ status: 429 }` succeeds on attempt 3, writes one checkpoint, and calls sleep with `[2000, 5000]`; that four failures set terminal `error`, keep `pagesDone` at the last checkpoint, and never invoke extraction; and that one transient extraction failure resets batch progress then succeeds without repeating OCR.

- [ ] **Step 2: Verify the worker module is absent**

Run: `npx tsx --test tests/jobWorker.test.ts`  
Expected: FAIL because `../api/jobWorker` does not exist.

- [ ] **Step 3: Implement a bounded single-process queue**

Use this public configuration and dependency shape:

```ts
export interface JobWorkerConfig {
  jobConcurrency: number
  renderBatchPages: number
  ocrConcurrency: number
  retryDelaysMs: number[]
}

export interface JobWorkerDeps {
  store: JobStore
  getPdfPageCount(path: string): number | Promise<number>
  renderPdfPageRange(path: string, start: number, end: number): Promise<RenderedPage[]> | RenderedPage[]
  ocrPage(image: string, page: number, apiKey: string): Promise<string>
  extract(input: ExtractCoreInput, onProgress: (done: number, total: number) => void): Promise<ExtractCoreResult>
  getApiKey(): string
  sleep(ms: number): Promise<void>
}
```

Queue IDs in a `Set` to deduplicate repeated enqueue/recovery calls. Run at most `jobConcurrency` drain loops. `waitForIdle()` resolves only when queued and active counts are both zero. Every uncaught job error must be converted to user-safe metadata and must not stop the drain loop.

- [ ] **Step 4: Implement resumable OCR and extraction**

For OCR jobs, trust `pdfinfo` as the actual page count and update metadata if the browser count differs. For each page range, omit already-checkpointed pages; render only ranges that contain missing pages. Run missing pages through an order-preserving pool capped at `ocrConcurrency`. Retry each page independently using delays 2 s, 5 s, and 10 s. Write page text first, then derive `pagesDone` from `listCompletedOcrPages()` and persist progress. Never log OCR text.

Join pages 1..N with the existing `--- PAGE BREAK ---` marker. When the initial customer is null, call `detectCustomer(joinedText, filename)`, then `buildCustomerInstructions()` and use the effective rule's vendor code/branch. Run `extractRowsCore` with the same bounded retry delays for status 429, network failures, and upstream 5xx; reset only extraction-batch progress before a retry and never repeat OCR. Map its progress callback to metadata. On success write `result.json` before setting `stage: 'done'`.

For digital-text jobs skip rendering/OCR, preserve the supplied text exactly, set `pagesDone=pagesTotal`, and start extraction. `recover()` enqueues every non-terminal store record; durable OCR page files make restart idempotent.

- [ ] **Step 5: Run worker and regression tests**

Run: `npx tsx --test tests/jobWorker.test.ts tests/extractProgress.test.ts tests/jobStore.test.ts`  
Expected: all tests PASS, including range, recovery, transient retry, and terminal failure.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit the worker**

```bash
git add app/api/jobWorker.ts app/tests/jobWorker.test.ts
git commit -m 'feat: process large PDFs in recoverable jobs'
```

---

### Task 6: Authenticated create/status job API

**Files:**
- Create: `app/api/jobs.ts`
- Create: `app/tests/jobsApi.test.ts`
- Modify: `app/server/index.ts:1-38`

**Interfaces:**
- Consumes: `JobStore`, job worker `enqueue/recover`, and `verifyAzureToken` subject.
- Produces: `createJobsHandlers({ store, worker, verify })` with `createJob` and `getJob` Express handlers.
- Routes: `POST /api/jobs` and `GET /api/jobs/:jobId`.

- [ ] **Step 1: Write failing handler tests with fake request/response objects**

Build a response recorder implementing `status(code).json(value)`. Inject a verifier returning owner A or owner B and a fake worker recording enqueue calls. Test:

```ts
test('create returns 202 and enqueues only after durable creation', async () => {
  const res = responseRecorder()
  await handlers.createJob(request({
    filename: 'large.pdf', pageCount: 277, useOcr: true,
    pdf: Buffer.from('%PDF-test').toString('base64'), text: '', isDigital: false,
    customerMaster: [], customerId: null, customerInstructions: '',
    vendorCode: 'auto', vendorBranch: 'auto',
  }), res)
  assert.equal(res.code, 202)
  assert.match(res.body.jobId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(enqueued, [res.body.jobId])
})

test('another authenticated owner receives 404', async () => {
  const job = await store.create('owner-a', storedRequest, Buffer.from('%PDF-test'))
  verifySubject = 'owner-b'
  const res = responseRecorder()
  await handlers.getJob(request({}, { jobId: job.id }), res)
  assert.equal(res.code, 404)
})
```

Add table-driven cases for missing/invalid base64 (400), bytes not starting `%PDF-` (400), decoded payload over `MAX_PDF_BYTES` (413), OCR job without PDF (400), and digital job with empty text (400). After each rejection assert the store has no new metadata directory and worker was not called. Test `getJob` omits rows while running and includes `result.rows` only at `done`.

- [ ] **Step 2: Verify the handler module is absent**

Run: `npx tsx --test tests/jobsApi.test.ts`  
Expected: FAIL because `../api/jobs` does not exist.

- [ ] **Step 3: Implement validation and ownership-safe responses**

Set `MAX_PDF_BYTES = 37 * 1024 * 1024`, which leaves base64/JSON overhead below Express's 50 MB body limit. Strictly validate filename, integer page count, booleans, arrays, and string fields before calling the store. Reject base64 unless it matches the standard alphabet/padding and its normalized decode/re-encode round-trips; Node `Buffer.from` alone is intentionally lenient. Decode once, then verify the first five ASCII bytes are `%PDF-`. Do not accept a client path.

For every handler, return 401 when token verification fails. `getJob` returns 404 when metadata is absent **or** `ownerId !== subject`. Its running response contains metadata plus calculated progress but no request, OCR text, filesystem path, or result. At `done`, read and include rows. At `error`, include only the stored user-safe error.

- [ ] **Step 4: Register production dependencies and startup recovery**

In `server/index.ts`, construct one store rooted at `process.env.JOB_DATA_DIR || join(process.cwd(), 'job-data')`, one worker with validated numeric environment values, and one handler pair. Register routes before the SPA fallback:

Bind production worker dependencies explicitly: `getPdfPageCount` and `renderPdfPageRange` come from `pdfRaster.ts`; `ocrPage(image, page, key)` calls `ocrImageCore(image, key)` and throws a status-bearing error when it is not ok; `extract(input, progress)` calls `extractRowsCore(input, { onProgress })`; `getApiKey` reads `OPENROUTER_API_KEY` at execution time and throws a user-safe configuration error when absent.

```ts
app.post('/api/jobs', jobs.createJob)
app.get('/api/jobs/:jobId', jobs.getJob)
```

After `app.listen`, invoke `worker.recover()` and log only count/state/job IDs. Run retention cleanup at startup and every hour with a timer that calls `unref()`. Startup recovery failure must be logged without crashing the health endpoint.

- [ ] **Step 5: Run API tests, full tests, and build**

Run: `npx tsx --test tests/jobsApi.test.ts`  
Expected: create, validation, ownership, and result-shaping tests PASS.

Run: `npm test`  
Expected: all server tests PASS without network calls.

Run: `npm run build`  
Expected: PASS.

- [ ] **Step 6: Commit API routes**

```bash
git add app/api/jobs.ts app/server/index.ts app/tests/jobsApi.test.ts
git commit -m 'feat: expose persistent PDF job API'
```

---

### Task 7: Browser submission, polling, refresh recovery, and truthful progress

**Files:**
- Create: `app/src/api/backgroundJobs.ts`
- Create: `app/tests/backgroundJobs.test.ts`
- Modify: `app/src/App.tsx:1-163`
- Modify: `app/src/types/invoice.ts:75-91`
- Modify: `app/src/components/ProcessingStatus.tsx:1-112`
- Modify: `app/src/i18n/dictionary.ts` processing-status keys in both languages

**Interfaces:**
- Produces: `createBackgroundJob`, `pollBackgroundJob`, `createActiveJobRegistry`, `jobProgressPercent`, and browser `BackgroundJobStatus` types.
- `App.tsx` uses jobs only when `pageCount > LARGE_PDF_PAGE_THRESHOLD`, with threshold fixed at 25.
- `FileProcessingStatus.file` becomes optional; `filename` becomes required; add job/page/batch progress fields.

- [ ] **Step 1: Write failing pure browser-helper tests**

Use an in-memory `Storage` implementation and injected `fetch`. Pin these behaviors:

```ts
test('active job registry survives recreation and claims a result once', () => {
  const storage = memoryStorage()
  createActiveJobRegistry(storage).save({ jobId: 'j1', filename: 'x.pdf', pagesTotal: 277 })
  const restored = createActiveJobRegistry(storage)
  assert.deepEqual(restored.list().map(x => x.jobId), ['j1'])
  assert.equal(restored.claimResult('j1'), true)
  assert.equal(restored.claimResult('j1'), false)
})

test('progress uses real OCR pages and never reports failed work complete', () => {
  assert.equal(jobProgressPercent({ stage: 'ocr', pagesDone: 83, pagesTotal: 277,
    extractBatchesDone: 0, extractBatchesTotal: 35 }), 27)
  assert.equal(jobProgressPercent({ stage: 'error', pagesDone: 83, pagesTotal: 277,
    extractBatchesDone: 0, extractBatchesTotal: 35 }), 27)
})
```

Also test: polling returns rows at `done`; two pollers sharing the registry invoke the delivery callback once; a 401 reacquires a token and retries once; two network errors use 2-second then 5-second injected delays without changing job state; an abort signal stops polling without removing the saved reference.

- [ ] **Step 2: Verify the browser helper is absent**

Run: `npx tsx --test tests/backgroundJobs.test.ts`  
Expected: FAIL because `../src/api/backgroundJobs` does not exist.

- [ ] **Step 3: Implement storage, status types, API calls, and polling**

Use local-storage key `armt_active_pdf_jobs_v1`. Parse defensively: invalid JSON or malformed entries become an empty/filtered list, never an app crash. Persist `{ jobId, filename, pagesTotal, delivered }`; set `delivered=true` synchronously inside `claimResult` before returning true.

`createBackgroundJob(payload, getToken, fetchImpl)` posts to `api/jobs`, requires HTTP 202, and returns `{ jobId, status, pagesTotal }`. `pollBackgroundJob` GETs every 2 seconds while successful/running, backs off to 5 seconds after network errors, refreshes the token once after 401, calls `onStatus` for valid responses, and returns only for `done|error`. Use injectable `sleep/fetch` for tests and respect `AbortSignal`.

Calculate progress consistently: OCR owns 0-90% using `Math.round(90 * pagesDone / pagesTotal)`; extraction owns 90-99% using `90 + Math.floor(9 * batchesDone / batchesTotal)`; `done` alone is 100%. An `error` preserves the percentage of its last completed durable unit.

- [ ] **Step 4: Extend processing status without breaking small files**

Change the type to this compatible shape:

```ts
export interface FileProcessingStatus {
  file?: File
  filename: string
  jobId?: string
  state: ProcessingState
  progress: number
  pagesDone?: number
  pagesTotal?: number
  extractBatchesDone?: number
  extractBatchesTotal?: number
  error?: string
  rows: InvoiceRow[]
}
```

Set `filename: file.name` at every existing construction site. In `ProcessingStatus`, render `item.filename`; show preview only when `item.file` exists. Display `pagesDone/pagesTotal` during OCR and translated `batch X/Y` during extraction. Add Thai/English keys `status.pages` and `status.extractBatches`; preserve every existing key.

- [ ] **Step 5: Route large files through jobs and restore after refresh**

In `App.tsx`, keep page counting and customer pre-detection. When `pageCount > 25`, submit a job containing PDF base64 only when `useOcr`, plus text/routing/master inputs. Save its reference before polling. Map server stages and progress into that file's status. On `done`, call `claimResult(jobId)` before appending rows; then remove the active reference. On terminal error, retain the real `pagesDone` and remove the reference only after displaying its message.

Add an effect that starts after `user` exists, restores saved jobs as statuses with no `File`, polls each, and uses the same claim/append path. Abort only browser pollers on unmount; never cancel server work. Remove the current `finally` assignment that forces `done` to the file's full page count. Recalculate global page totals from each status's actual `pagesDone/pagesTotal` so an error at page 83 displays 83/277.

Keep the existing synchronous OCR/extract branches unchanged for 25 pages or fewer.

- [ ] **Step 6: Run helper tests and build**

Run: `npx tsx --test tests/backgroundJobs.test.ts`  
Expected: registry, dedupe, progress, polling retry, token refresh, and abort tests PASS.

Run: `npm test`  
Expected: all tests PASS.

Run: `npm run build`  
Expected: PASS with both Thai and English dictionary keys present.

- [ ] **Step 7: Commit frontend orchestration**

```bash
git add app/src/api/backgroundJobs.ts app/src/App.tsx app/src/types/invoice.ts app/src/components/ProcessingStatus.tsx app/src/i18n/dictionary.ts app/tests/backgroundJobs.test.ts
git commit -m 'feat: resume large PDF jobs from the browser'
```

---

### Task 8: Container persistence, operational documentation, and acceptance verification

**Files:**
- Modify: `app/Dockerfile:31-47`
- Modify: `app/docker-compose.yml:7-24`
- Modify: `app/.env.example`
- Modify: `PROGRESS.md`
- Modify: `project_doc/IT_Director_Technical.md`

**Interfaces:**
- Supplies runtime `JOB_DATA_DIR`, `JOB_CONCURRENCY`, `OCR_RENDER_BATCH_PAGES`, `JOB_RETENTION_HOURS`, and shared customer config.
- Provides named Docker volume `armt-job-data` mounted at `/app/job-data`.

- [ ] **Step 1: Add runtime config and persistent volume**

In the runtime Docker stage, copy `src/config/customers.ts` to `./src/config/customers.ts` so server-side post-OCR detection uses the single source of truth. Create `/app/job-data` and set `JOB_DATA_DIR=/app/job-data`.

Add these Compose environment values and volume mount:

```yaml
      JOB_DATA_DIR: /app/job-data
      JOB_CONCURRENCY: ${JOB_CONCURRENCY:-1}
      OCR_RENDER_BATCH_PAGES: ${OCR_RENDER_BATCH_PAGES:-10}
      JOB_RETENTION_HOURS: ${JOB_RETENTION_HOURS:-24}
    volumes:
      - armt-job-data:/app/job-data

volumes:
  armt-job-data:
```

Document all four values in `.env.example`; explain that increasing concurrency raises RAM use and OpenRouter rate-limit risk.

- [ ] **Step 2: Validate deployment configuration**

Run: `docker compose config` from `app/`  
Expected: valid resolved config with one named volume and all four job variables.

Run: `docker build --build-arg VITE_AZURE_CLIENT_ID=test --build-arg VITE_AZURE_TENANT_ID=test --build-arg VITE_BASE_PATH=/armt-invoice-ocr/ -t armt-invoice-ocr:large-job-test .`  
Expected: image builds and runtime contains Poppler, API files, and `src/config/customers.ts`.

- [ ] **Step 3: Run all automated verification**

Run: `npm test`  
Expected: every job-store, auth, raster, extraction-progress, worker, API, and browser-helper test PASS with zero network calls.

Run: `npm run build`  
Expected: TypeScript and Vite build PASS.

Run: `git diff --check`  
Expected: no whitespace errors.

- [ ] **Step 4: Run a local mocked 300-page acceptance job**

Extend the `jobWorker.test.ts` fixture with `pageCount: 300`, one fake row per page, and an artificial 1 ms OCR delay. Assert create returns before `waitForIdle`, exactly 30 render ranges are seen, maximum range width is 10, 300 page checkpoints exist, extraction is called once, and final stage is `done`.

Run: `npx tsx --test tests/jobWorker.test.ts`  
Expected: the 300-page acceptance test PASS without OpenRouter cost.

- [ ] **Step 5: Run the real CFR stress test when the configured API key is available**

Use `INVOICE JAN-APR/INVOICE JAN-APR/บจ.เซ็นทรัล ฟู้ด รีเทล/ใบแจ้งหนี้เซ็นทรัลฟู้ดรีเทล รอบโอน 17-03-69 (P)(CRM).pdf` (292 pages). Start the production server locally, upload through the browser, and record:

- POST `/api/jobs` returns 202 in under five seconds.
- No individual HTTP request stays open through OCR/extraction.
- Page progress is monotonic and refresh restores polling.
- Process memory remains bounded by a ten-page image range.
- Final status is `done`; key CFR invoice numbers and row count match processing the same source in smaller verified groups.

If an API key or production-like auth is unavailable, explicitly report this acceptance test as not run; do not claim live 292-page success from mocked tests alone.

- [ ] **Step 6: Update project documentation with observed behavior**

Correct the technical document's obsolete client-only processing description. Document create/poll endpoints, 25-page threshold, job volume, 24-hour retention, one-job default concurrency, bounded ten-page rasterization, restart recovery, and rollback by raising the threshold. Append a dated `PROGRESS.md` entry listing tests actually run and any unrun live acceptance check.

- [ ] **Step 7: Commit deployment and docs**

```bash
git add app/Dockerfile app/docker-compose.yml app/.env.example PROGRESS.md project_doc/IT_Director_Technical.md app/tests/jobWorker.test.ts
git commit -m 'docs: deploy and verify large PDF jobs'
```

---

## Final verification gate

Before claiming completion, invoke `superpowers:verification-before-completion` and run fresh commands:

1. `npm test`
2. `npm run build`
3. `docker compose config`
4. `git diff --check HEAD~7..HEAD`
5. `git status --short`

Report automated test counts, build result, whether Docker image/config validation ran, whether the paid/authenticated 292-page live test ran, and all remaining user-owned untracked files. Do not push or deploy unless the user separately requests it.
