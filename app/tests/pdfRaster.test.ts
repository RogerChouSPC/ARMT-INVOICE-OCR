import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as pdfRaster from '../api/pdfRaster'

const { pageRanges, parsePdfInfoPages, renderPdfPageRange, sortRenderedPageNames } = pdfRaster

test('splits 277 pages into ten-page ranges', () => {
  const ranges = pageRanges(277, 10)
  assert.deepEqual(ranges[0], { startPage: 1, endPage: 10 })
  assert.deepEqual(ranges.at(-1), { startPage: 271, endPage: 277 })
  assert.equal(ranges.length, 28)
  assert.ok(ranges.every(r => r.endPage - r.startPage + 1 <= 10))
})

test('a timer remains responsive while a real render child process is pending', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-raster-responsive-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const shimPath = join(root, 'slow-pdftoppm.cjs')
  await writeFile(shimPath, [
    'const { writeFile } = require(\'node:fs/promises\')',
    'const outputPrefix = process.argv.at(-1)',
    'setTimeout(async () => {',
    '  await writeFile(outputPrefix + \'-1.png\', Buffer.from(\'rendered-page\'))',
    '}, 150)',
  ].join(String.fromCharCode(10)), 'utf8')

  type RenderWithCommand = (
    pdfPath: string,
    startPage: number,
    endPage: number,
    command: { executable: string; argsPrefix: string[] },
  ) => Promise<Array<{ page: number; pngBase64: string }>>
  const renderWithCommand = Reflect.get(
    pdfRaster,
    'renderPdfPageRangeWithCommand',
  ) as RenderWithCommand | undefined
  assert.equal(typeof renderWithCommand, 'function')

  const events: string[] = []
  const pendingRender = renderWithCommand!(
    'input-path-is-only-forwarded-to-the-child.pdf',
    1,
    1,
    { executable: process.execPath, argsPrefix: [shimPath] },
  ).then((pages) => {
    events.push('render')
    return pages
  })
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      events.push('timer')
      resolve()
    }, 25)
  })

  assert.deepEqual(events, ['timer'])
  assert.deepEqual(await pendingRender, [{
    page: 1,
    pngBase64: Buffer.from('rendered-page').toString('base64'),
  }])
  assert.deepEqual(events, ['timer', 'render'])
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

test('rejects render ranges larger than ten pages before Poppler executes', async () => {
  await assert.rejects(
    () => renderPdfPageRange('does-not-need-to-exist.pdf', 1, 11),
    /at most 10 pages/i,
  )
})
