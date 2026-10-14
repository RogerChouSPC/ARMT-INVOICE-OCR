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
