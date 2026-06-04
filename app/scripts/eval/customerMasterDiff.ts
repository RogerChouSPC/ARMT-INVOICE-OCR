// Customer Master validation (offline, no API key).
//
// The ground-truth registers contain authoritative taxid → customergroup /
// customercode mappings. Compare the DISTINCT mappings actually used in the
// registers against the app's seed (src/config/customerMasterSeed.ts) to find:
//   - taxids present in real data but MISSING from the seed
//   - taxid+group pairs whose customercode in the seed DIFFERS from real data
// These directly affect the customergroup/customercode the LLM looks up.
//
// Run: npx tsx scripts/eval/customerMasterDiff.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadGroundTruth } from './groundTruth.ts'
import { CUSTOMER_MASTER_SEED } from '../../src/config/customerMasterSeed.ts'
import { normText } from './normalize.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
interface Vendor { code: string; outputFile: string }
const vendors: Vendor[] = JSON.parse(readFileSync(join(HERE, 'vendor-map.json'), 'utf-8'))

// Seed index: taxid -> set of "group||code", plus taxid -> code by group.
const seedByTaxid = new Map<string, { group: string; code: string }[]>()
for (const s of CUSTOMER_MASTER_SEED) {
  const arr = seedByTaxid.get(s.taxid) || []
  arr.push({ group: normText(s.customergroup), code: normText(s.customercode) })
  seedByTaxid.set(s.taxid, arr)
}

// Collect distinct (taxid, group, code) used in registers, with row counts.
interface Usage { taxid: string; group: string; code: string; count: number; vendors: Set<string> }
const used = new Map<string, Usage>()
for (const v of vendors) {
  let gt
  try { gt = loadGroundTruth(v.outputFile) } catch { continue }
  for (const r of gt.rows) {
    const taxid = normText(r.taxid)
    if (!/^\d{13}$/.test(taxid)) continue
    const group = normText(r.customergroup)
    const code = normText(r.customercode)
    const key = `${taxid}||${group}||${code}`
    const u = used.get(key)
    if (u) { u.count++; u.vendors.add(v.code) }
    else used.set(key, { taxid, group, code, count: 1, vendors: new Set([v.code]) })
  }
}

const missingTaxids: Usage[] = []
const codeMismatches: { u: Usage; seedCode: string }[] = []
const ok: Usage[] = []

for (const u of used.values()) {
  const seedRows = seedByTaxid.get(u.taxid)
  if (!seedRows) { missingTaxids.push(u); continue }
  // exact group+code match?
  if (seedRows.some((s) => s.group === u.group && s.code === u.code)) { ok.push(u); continue }
  // same group, different code?
  const sameGroup = seedRows.find((s) => s.group === u.group)
  if (sameGroup) codeMismatches.push({ u, seedCode: sameGroup.code })
  else codeMismatches.push({ u, seedCode: `(no seed row for group "${u.group}"; taxid has groups: ${seedRows.map((s) => s.group).join(' | ')})` })
}

console.log('=== CUSTOMER MASTER DIFF (registers vs seed) ===')
console.log(`distinct (taxid,group,code) mappings in registers: ${used.size}`)
console.log(`  exact match in seed:        ${ok.length}`)
console.log(`  taxid MISSING from seed:    ${new Set(missingTaxids.map((u) => u.taxid)).size} taxids (${missingTaxids.length} mappings)`)
console.log(`  group present, code DIFFERS: ${codeMismatches.length}`)

if (missingTaxids.length) {
  console.log('\n--- taxids in real data but NOT in seed (add these) ---')
  for (const u of missingTaxids.sort((a, b) => b.count - a.count)) {
    console.log(`  taxid=${u.taxid} rows=${String(u.count).padStart(4)} vendors=${[...u.vendors].join(',')}`)
    console.log(`     group=${u.group}`)
    console.log(`     code =${u.code}`)
  }
}

if (codeMismatches.length) {
  console.log('\n--- same taxid+group, customercode differs (review) ---')
  for (const { u, seedCode } of codeMismatches.sort((a, b) => b.u.count - a.u.count)) {
    console.log(`  taxid=${u.taxid} group="${u.group}" rows=${u.count} vendors=${[...u.vendors].join(',')}`)
    console.log(`     register code = ${u.code}`)
    console.log(`     seed code     = ${seedCode}`)
  }
}
