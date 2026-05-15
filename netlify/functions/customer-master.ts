import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

export interface CustomerRow {
  id: string
  store_name: string
  customergroup: string
  customercode: string
  taxid: string
}

type ChangeType = 'add' | 'delete' | 'edit'

interface Change {
  type: ChangeType
  row?: CustomerRow
  key?: string
  before?: Partial<CustomerRow>
  after?: Partial<CustomerRow>
}

export interface Version {
  id: string
  timestamp: string
  label: string
  added: number
  deleted: number
  modified: number
  changes: Change[]
  snapshot: CustomerRow[]
}

interface State {
  rows: CustomerRow[]
  history: Version[]
}

function diff(before: CustomerRow[], after: CustomerRow[]): Change[] {
  const changes: Change[] = []
  const bMap = new Map(before.map(r => [r.id, r]))
  const aMap = new Map(after.map(r => [r.id, r]))

  for (const [id, r] of bMap) {
    if (!aMap.has(id)) {
      changes.push({ type: 'delete', row: r })
    } else {
      const a = aMap.get(id)!
      const bFields: Partial<CustomerRow> = {}
      const aFields: Partial<CustomerRow> = {}
      for (const f of ['store_name', 'customergroup', 'customercode', 'taxid'] as const) {
        if (r[f] !== a[f]) { bFields[f] = r[f]; aFields[f] = a[f] }
      }
      if (Object.keys(aFields).length) {
        changes.push({ type: 'edit', key: id, before: bFields, after: aFields })
      }
    }
  }
  for (const [id, r] of aMap) {
    if (!bMap.has(id)) changes.push({ type: 'add', row: r })
  }
  return changes
}

const handler: Handler = async (event) => {
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' }

  const store = getStore('customer-master')

  // GET — return current rows + history
  if (event.httpMethod === 'GET') {
    const raw = await store.get('state', { type: 'text' })
    const state: State = raw ? JSON.parse(raw) : { rows: [], history: [] }
    return { statusCode: 200, headers: cors, body: JSON.stringify(state) }
  }

  // POST — save new version
  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}')
    const newRows: CustomerRow[] = body.rows || []
    const label: string = body.label || 'Web edit'

    const raw = await store.get('state', { type: 'text' })
    const state: State = raw ? JSON.parse(raw) : { rows: [], history: [] }

    const changes = diff(state.rows, newRows)
    const version: Version = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      label,
      added:    changes.filter(c => c.type === 'add').length,
      deleted:  changes.filter(c => c.type === 'delete').length,
      modified: changes.filter(c => c.type === 'edit').length,
      changes,
      snapshot: state.rows,
    }

    const newState: State = {
      rows: newRows,
      history: [version, ...state.history].slice(0, 50),
    }

    await store.set('state', JSON.stringify(newState))
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, id: version.id }) }
  }

  // PUT — restore snapshot from a version
  if (event.httpMethod === 'PUT') {
    const body = JSON.parse(event.body || '{}')
    const id: string = body.id

    const raw = await store.get('state', { type: 'text' })
    const state: State = raw ? JSON.parse(raw) : { rows: [], history: [] }

    const version = state.history.find(v => v.id === id)
    if (!version) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Not found' }) }

    const changes = diff(state.rows, version.snapshot)
    const saveVersion: Version = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      label: `Restored to ${new Date(Number(id)).toLocaleString()}`,
      added:    changes.filter(c => c.type === 'add').length,
      deleted:  changes.filter(c => c.type === 'delete').length,
      modified: changes.filter(c => c.type === 'edit').length,
      changes,
      snapshot: state.rows,
    }

    const newState: State = {
      rows: version.snapshot,
      history: [saveVersion, ...state.history].slice(0, 50),
    }

    await store.set('state', JSON.stringify(newState))
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, rows: version.snapshot }) }
  }

  return { statusCode: 405, headers: cors, body: 'Method Not Allowed' }
}

export { handler }
