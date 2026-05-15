// One-time script: seed Netlify Blobs with full 42-row Customer Master
// Run: node tmp/seed_blobs.mjs
import { getStore } from '@netlify/blobs'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(
  join(process.env.APPDATA, 'netlify', 'Config', 'config.json'), 'utf8'
))
const token = Object.values(cfg.users)[0].auth.token
const siteID = 'c6475070-cecc-48bc-91db-2f437db051c5'

const SEED = [
  { id: 'seed-0',  store_name: 'ซีพี แอ็กซ์ตร้า', customergroup: '04 - ซีพี แอ็กซ์ตร้า(Makro)', customercode: '0118808 - บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107567000414' },
  { id: 'seed-1',  store_name: 'ซีพี แอ็กซ์ตร้า', customergroup: '05 - โลตัส', customercode: '0118866 - บริษัท ซีพี แอ็กซ์ตร้า จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107567000414' },
  { id: 'seed-2',  store_name: 'บิ๊กซี 00000', customergroup: '06 - บิ๊กซี', customercode: '0102856-บมจ.บิ๊กซีซูเปอร์เซ็นเตอร์ จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107536000633' },
  { id: 'seed-3',  store_name: 'บิ๊กซี สาขาที่02043', customergroup: '06 - บิ๊กซี', customercode: '3073539 - บมจ.บิ๊กซี ซูเปอร์เซ็นเตอร์ (ศูนย์กระจายสินค้าบางปะอิน) สาขาที่02043', taxid: '0107536000633' },
  { id: 'seed-4',  store_name: 'บิ๊กซี (คลังธัญบุรี) สาขาที่00485', customergroup: '06 - บิ๊กซี', customercode: '0114556 - บมจ.บิ๊กซีซูเปอร์เซ็นเตอร์(คลังธัญบุรี) สาขาที่00485', taxid: '0107536000633' },
  { id: 'seed-5',  store_name: 'บิ๊กซี (คลังครอสด็อคธัญบุรี) สาขาที่00485', customergroup: '06 - บิ๊กซี', customercode: '0115526 - บมจ.บิ๊กซีซูเปอร์เซ็นเตอร์(คลังครอสด็อคธัญบุรี) สาขาที่00485', taxid: '0107536000633' },
  { id: 'seed-6',  store_name: 'บิ๊กซี สาขาที่00528', customergroup: '06 - บิ๊กซี', customercode: '3101168 - บมจ.บิ๊กซี ซูเปอร์เซ็นเตอร์ (ศูนย์กระจายสินค้าฉะเชิงเทรา)สาขาที่00528', taxid: '0107536000633' },
  { id: 'seed-7',  store_name: 'ซีพี ออลล์', customergroup: '07 - เซเว่นอีเลฟเว่น (7-11)', customercode: '0201553 - บริษัท ซีพี ออลล์ จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107542000011' },
  { id: 'seed-8',  store_name: 'เดอะมอลล์ สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0204754 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สำนักงานใหญ่', taxid: '0105523009350' },
  { id: 'seed-9',  store_name: 'เดอะมอลล์ สาขาที่00004', customergroup: '09 - เดอะมอลล์', customercode: '0208640 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00004', taxid: '0105523009350' },
  { id: 'seed-10', store_name: 'เดอะมอลล์ สาขาที่00005', customergroup: '09 - เดอะมอลล์', customercode: '0115555 - บริษัท เดอะมอลล์กรุ๊ป จำกัด สาขาที่00005', taxid: '0105523009350' },
  { id: 'seed-11', store_name: 'เดอะมอลล์ สาขาที่00006', customergroup: '09 - เดอะมอลล์', customercode: '0115542 - บริษัท เดอะมอลล์กรุ๊ป จำกัด สาขาที่00006', taxid: '0105523009350' },
  { id: 'seed-12', store_name: 'เดอะมอลล์ สาขาที่00007', customergroup: '09 - เดอะมอลล์', customercode: '0207049 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00007', taxid: '0105523009350' },
  { id: 'seed-13', store_name: 'เดอะมอลล์ สาขาที่00009', customergroup: '09 - เดอะมอลล์', customercode: '0114572 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00009', taxid: '0105523009350' },
  { id: 'seed-14', store_name: 'เดอะมอลล์ สาขาที่00010', customergroup: '09 - เดอะมอลล์', customercode: '3230686 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00010', taxid: '0105523009350' },
  { id: 'seed-15', store_name: 'เดอะมอลล์ สาขาที่00011', customergroup: '09 - เดอะมอลล์', customercode: '0115241 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00011', taxid: '0105523009350' },
  { id: 'seed-16', store_name: 'เดอะมอลล์ สาขาที่00013', customergroup: '09 - เดอะมอลล์', customercode: '0115720 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00013', taxid: '0105523009350' },
  { id: 'seed-17', store_name: 'เดอะมอลล์ สาขาที่00014', customergroup: '09 - เดอะมอลล์', customercode: '0115788 - บริษัท เดอะมอลล์ กรุ๊ป จำกัด สาขาที่00014', taxid: '0105523009350' },
  { id: 'seed-18', store_name: 'ซิตี้มอลล์ สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0092128 - บริษัท ซิตี้มอลล์ กรุ๊ป จำกัด สำนักงานใหญ่', taxid: '0105540016253' },
  { id: 'seed-19', store_name: 'ซิตี้มอลล์ สาขาที่ 00001', customergroup: '09 - เดอะมอลล์', customercode: '0114682 - บริษัท ซิตี้มอลล์ กรุ๊ป จำกัด สาขาที่ 00001', taxid: '0105540016253' },
  { id: 'seed-20', store_name: 'ซิตี้มอลล์ สาขาที่00002', customergroup: '09 - เดอะมอลล์', customercode: '0118714 - บริษัท ซิตี้มอลล์ กรุ๊ป จำกัด สาขาที่00002', taxid: '0105540016253' },
  { id: 'seed-21', store_name: 'สยามพารากอน สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0056119 - บริษัท สยามพารากอน รีเทล จำกัด สำนักงานใหญ่', taxid: '0105544113032' },
  { id: 'seed-22', store_name: 'เอ็มโพเรี่ยม สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0063623 - บริษัท เอ็มโพเรี่ยม ฟู้ด แกลเลอรี่ จำกัด สำนักงานใหญ่', taxid: '0105548110704' },
  { id: 'seed-23', store_name: 'พรอมานาด สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '0113557 - บริษัท พรอมานาด โฮมเฟรชมาร์ท จำกัด สำนักงานใหญ่', taxid: '0105554112080' },
  { id: 'seed-24', store_name: 'เดอะมอลล์ราชสีมา สำนักงานใหญ่', customergroup: '09 - เดอะมอลล์', customercode: '4144247 - บริษัท เดอะมอลล์ราชสีมา จำกัด สำนักงานใหญ่', taxid: '0305540000746' },
  { id: 'seed-25', store_name: 'อิออน', customergroup: '10 - อิออน (MaxValu)', customercode: '0207036 - บริษัท อิออน (ไทยแลนด์) จำกัด สำนักงานใหญ่', taxid: '0105527044125' },
  { id: 'seed-26', store_name: 'เซ็นทรัลฟู้ด มินิมาร์เก็ต', customergroup: '11 - เซ็นทรัล ฟู้ด มินิมาร์เก็ต', customercode: '0114886 - บริษัท เซ็นทรัล ฟู้ด มินิมาร์เก็ต จำกัด สำนักงานใหญ่', taxid: '0105535133093' },
  { id: 'seed-27', store_name: 'เซ็นทรัลฟู้ด รีเทล', customergroup: '13 - ท๊อปส์ซุปเปอร์มาร์เก็ต', customercode: '3230217 - บริษัท เซ็นทรัล ฟู้ด รีเทล จำกัด', taxid: '0105535134278' },
  { id: 'seed-28', store_name: 'เซ็นทรัลและมัทสึโมโตะ', customergroup: '13 - ท๊อปส์ซุปเปอร์มาร์เก็ต', customercode: '0115953 - บริษัท เซ็นทรัล และ มัทสึโมโตะ คิโยชิ จำกัด สาขา ดีซี สาขาที่00036', taxid: '0125558018410' },
  { id: 'seed-29', store_name: 'ฟู้ดแลนด์', customergroup: '14 - ฟู้ดแลนด์', customercode: '0200897 - บ.ฟู้ดแลนด์ซุปเปอร์มาร์เก็ต จก. สำนักงานใหญ่', taxid: '0105515004549' },
  { id: 'seed-30', store_name: 'วัตสัน', customergroup: '17 - วัตสัน', customercode: '0301152 - บริษัท เซ็นทรัล วัตสัน จำกัด สำนักงานใหญ่', taxid: '0105539086260' },
  { id: 'seed-31', store_name: 'บู๊ทส์ รีเทล', customergroup: '19 - บู๊ทส์ รีเทล', customercode: '0301958 - บ.บู๊ทส์ รีเทล (ประเทศไทย) จก. สำนักงานใหญ่', taxid: '0115539007084' },
  { id: 'seed-32', store_name: 'ปตท', customergroup: '25 - ปตท (Jiffy)', customercode: '0051460 - บริษัท ปตท. บริหารธุรกิจค้าปลีก จำกัด สำนักงานใหญ่', taxid: '0105537121254' },
  { id: 'seed-33', store_name: 'ซูรูฮะ', customergroup: '46 - ซูรูฮะ', customercode: '0113748 - บริษัท ซูรูฮะ(ประเทศไทย) จำกัด สำนักงานใหญ่', taxid: '0105554157903' },
  { id: 'seed-34', store_name: 'ซี.เจ. เอ็กซ์เพรส', customergroup: '47 - ซี.เจ.เอ็กซ์เพรส', customercode: '0076746 - บริษัท ซี.เจ. เอ็กซ์เพรส กรุ๊ป จำกัด สำนักงานใหญ่', taxid: '0105556055491' },
  { id: 'seed-35', store_name: 'บิ๊กซี ฟู๊ด', customergroup: '68 - เอ็มเอ็ม เมก้า มาร์เก็ต', customercode: '0116224 - บริษัท บิ๊กซี ฟู๊ด เซอร์วิส จำกัด สำนักงานใหญ่', taxid: '0107536000633' },
  { id: 'seed-36', store_name: 'ปิโตรเลียมไทย', customergroup: '69 - แมกซ์มาร์ท', customercode: '0086901 - บริษัท ปิโตรเลียมไทยคอร์ปอเรชั่น จำกัด สำนักงานใหญ่', taxid: '0105535099511' },
  { id: 'seed-37', store_name: 'เซ็นทรัลฟู้ด โฮลเซลล์', customergroup: '80 - เซ็นทรัลฟู้ดโฮลเซล', customercode: '0118701 - บริษัท เซ็นทรัล ฟู้ด โฮลเซลล์ จำกัด สำนักงานใหญ่', taxid: '0125565034662' },
  { id: 'seed-38', store_name: 'โฮมโปร', customergroup: '82 - โฮมโปร', customercode: '0114242 - บริษัท โฮม โปรดักส์ เซ็นเตอร์ จำกัด (มหาชน) สำนักงานใหญ่', taxid: '0107544000043' },
  { id: 'seed-39', store_name: 'บิวเทรี่ยม', customergroup: '84 - บิวเทรี่ยม', customercode: '0119056 - บริษัท บิวเทรี่ยม จำกัด สำนักงานใหญ่', taxid: '0105555002130' },
  { id: 'seed-40', store_name: 'ไทยฟู้ดส์เฟรซมาร์เก็ต', customergroup: '86 - ไทยฟู้ดส์เฟรซมาร์เก็ต', customercode: '0089128 - บริษัท ไทย ฟู้ดส์ เฟรซ มาร์เก็ต จำกัด สำนักงานใหญ่', taxid: '0105563089753' },
  { id: 'seed-41', store_name: 'วิลล่า', customergroup: '97 - วิลล่า', customercode: '0202031 - บ.วิลล่ามาร์เก็ท เจพี จก. สำนักงานใหญ่', taxid: '0105531013646' },
]

const state = { rows: SEED, history: [] }

try {
  const store = getStore({ name: 'customer-master', siteID, token })
  await store.set('state', JSON.stringify(state))
  console.log('✓ Seeded', SEED.length, 'rows to Netlify Blobs')
  // Verify
  const check = await store.get('state', { type: 'text' })
  const parsed = JSON.parse(check)
  console.log('✓ Verified:', parsed.rows.length, 'rows in store')
  const aeon = parsed.rows.find(r => r.store_name === 'อิออน')
  console.log('✓ Aeon:', aeon ? aeon.customergroup : 'NOT FOUND')
} catch (e) {
  console.error('✗ Failed:', e.message)
}
