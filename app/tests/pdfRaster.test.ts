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
