import { createClient } from "@supabase/supabase-js"

// Kiểm tra RPC submit_confirm_draft_batch (migration 20260716_product_confirm_drafts.sql) trên dữ
// liệu thật của 1 nhà máy — tự tạo 1 ngăn tạm + các lô/nháp test riêng biệt (mã lô luôn có suffix
// "test" + năm "99" để không bao giờ trùng dữ liệu sản xuất thật), rồi tự dọn dẹp toàn bộ sau khi
// chạy xong (kể cả khi có test fail giữa chừng — cleanup luôn chạy trong finally).
//
// Chạy: node --env-file=.env.local scripts/test-confirm-draft-batch.mjs [--factory=<uuid>] [--keep]
//   --factory=<uuid>  Chỉ định factory_id thay vì tự tìm factory code 'phuochoa_kt'
//   --keep            Không dọn dẹp dữ liệu test sau khi chạy (debug)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const KEEP = process.argv.includes("--keep")
const factoryArg = process.argv.find((a) => a.startsWith("--factory="))
const RUN_TAG = "AUTO_TEST_CLEANUP" // đánh dấu mọi dòng do script này tạo, dùng để cleanup gọn
const RUN_ID = Date.now() % 1000000 // numeric, dùng làm base cho num của mã lô test (xem maLoFor)
const LOAI_CSR = "10"
const LOAI_BANH = 35
const MAX_PER_KIEN = 36 // mirror getLoaiBanhConfig("10", 35).max_per_kien (nhánh default trong product-lot-config.ts)

let nganId = null
let factoryId = null
let userId = null

const results = []
function record(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? `: ${detail}` : ""}`)
}
function assert(cond, message) {
  if (!cond) throw new Error(message)
}

// Mã lô phải khớp ĐÚNG regex `^(\d+)([a-z]*)\/(\d{2,4})$` mà RPC dùng để parse num/suffix/year —
// toàn bộ phần trước "/" phải là số rồi mới tới chữ thường THUẦN TÚY, không được xen số vào phần
// chữ (bug đã gặp ở bản đầu của script này: nhúng timestamp vào giữa suffix khiến suffix lẫn chữ
// số, RPC luôn từ chối đúng là "Mã lô không hợp lệ" — không phải bug của RPC). `testIndex` (1-4)
// đảm bảo 4 test trong CÙNG 1 lần chạy không trùng mã lô nhau; `RUN_ID` (từ timestamp) đảm bảo
// không trùng giữa các lần chạy. Suffix cố định "test", năm cố định "99" — không bao giờ trùng dữ
// liệu sản xuất thật (năm thật luôn là 2 chữ số của năm hiện tại, vd "26").
function maLoFor(testIndex) {
  return `${RUN_ID}${testIndex}test/99`
}

async function resolveFactoryId() {
  if (factoryArg) return factoryArg.split("=")[1]
  const { data, error } = await supabase.from("factories").select("id").eq("code", "phuochoa_kt").maybeSingle()
  if (error) throw new Error(`Không tìm được factory 'phuochoa_kt': ${error.message}`)
  if (!data) throw new Error("Không tìm thấy factory code 'phuochoa_kt' — chạy lại với --factory=<uuid>")
  return data.id
}

async function resolveUserId(fid) {
  const { data, error } = await supabase.from("profiles").select("id").eq("factory_id", fid).limit(1).maybeSingle()
  if (error) throw new Error(`Không tra được user trong factory: ${error.message}`)
  if (!data) throw new Error("Không có profile nào thuộc factory này để dùng làm created_by test.")
  return data.id
}

async function setupNgan(fid) {
  const { data, error } = await supabase
    .from("ngans")
    .insert({
      factory_id: fid,
      ma_ngan: `TEST-${RUN_ID}`,
      ten_ngan: "Ngăn test tạm (auto-cleanup, script test-confirm-draft-batch)",
      loai_nl: "Mủ tạp",
      trang_thai: "Đang sản xuất",
      tong_kho: 5000,
    })
    .select("id")
    .single()
  if (error) throw new Error(`Không tạo được ngăn test: ${error.message}`)
  return data.id
}

async function insertDraft({ maLo, kien, soBanh, boc, pallet }) {
  const soKg = Math.round(soBanh * LOAI_BANH * 100) / 100
  const { data, error } = await supabase
    .from("product_confirm_drafts")
    .insert({
      factory_id: factoryId,
      created_by: userId,
      ma_lo: maLo,
      kien,
      is_new_lot: true,
      ngan_id: nganId,
      loai_csr: LOAI_CSR,
      loai_banh: LOAI_BANH,
      so_banh: soBanh,
      so_kg: soKg,
      max_per_kien: MAX_PER_KIEN,
      ngay_sx: "2099-01-01",
      ca: "A",
      boc,
      pallet,
      chi_thi: RUN_TAG,
      ghi_chu: RUN_TAG,
    })
    .select("id")
    .single()
  if (error) throw new Error(`Không tạo được nháp test: ${error.message}`)
  return data.id
}

function recomputedFor(draftIds) {
  return draftIds.map((id) => ({ draft_id: id, max_per_kien: MAX_PER_KIEN }))
}

async function callRpc(draftIds, overrideUserId) {
  return supabase.rpc("submit_confirm_draft_batch", {
    p_draft_ids: draftIds,
    p_user_id: overrideUserId || userId,
    p_recomputed: recomputedFor(draftIds),
  })
}

async function countDrafts(draftIds) {
  const { data, error } = await supabase.from("product_confirm_drafts").select("id").in("id", draftIds)
  if (error) throw new Error(error.message)
  return (data || []).length
}

async function fetchLot(maLo) {
  const { data, error } = await supabase
    .from("lots")
    .select("id, kien_a, kien_b, kien_c, kien_d, trang_thai")
    .eq("factory_id", factoryId)
    .eq("ma_lo", maLo)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// Test 1: batch hợp lệ (3 kiện khác nhau, cùng lô mới) — phải tạo đúng 1 lô, 3 dòng
// lot_transactions, và toàn bộ nháp bị xóa sau khi gửi.
async function test1() {
  const maLo = maLoFor(1)
  const d1 = await insertDraft({ maLo, kien: "A", soBanh: 10, boc: "BocTest1", pallet: ["Sắt đế gỗ"] })
  const d2 = await insertDraft({ maLo, kien: "B", soBanh: 10, boc: "BocTest1", pallet: ["Sắt đế gỗ"] })
  const d3 = await insertDraft({ maLo, kien: "C", soBanh: 10, boc: "BocTest1", pallet: ["Sắt đế gỗ"] })
  const draftIds = [d1, d2, d3]

  const { data, error } = await callRpc(draftIds)
  assert(!error, `RPC lỗi không mong đợi: ${error?.message}`)
  assert(Array.isArray(data) && data.length === 3, `Kỳ vọng 3 dòng trả về, nhận ${data?.length}`)

  const lot = await fetchLot(maLo)
  assert(!!lot, "Không tìm thấy lô vừa tạo")
  assert(Number(lot.kien_a) === 10 && Number(lot.kien_b) === 10 && Number(lot.kien_c) === 10, "Sai kien_a/b/c của lô")
  assert(lot.trang_thai === "Dở dang", `Sai trang_thai: ${lot.trang_thai}`)

  const remaining = await countDrafts(draftIds)
  assert(remaining === 0, `Còn ${remaining} nháp chưa bị xóa sau khi gửi thành công`)

  record("Test 1: batch hợp lệ 3 kiện -> 1 lô, 3 dòng, nháp đã xóa", true)
}

// Test 2: 2 nháp cùng kiện A (20 + 20 = 40 > max_per_kien=36) trong cùng batch với 1 nháp kiện B
// hợp lệ khác — toàn bộ phải bị từ chối, KHÔNG tạo lô, KHÔNG xóa nháp nào (all-or-nothing).
async function test2() {
  const maLo = maLoFor(2)
  const d1 = await insertDraft({ maLo, kien: "A", soBanh: 20, boc: "BocTest2", pallet: ["Sắt đế gỗ"] })
  const d2 = await insertDraft({ maLo, kien: "A", soBanh: 20, boc: "BocTest2", pallet: ["Sắt đế gỗ"] })
  const d3 = await insertDraft({ maLo, kien: "B", soBanh: 10, boc: "BocTest2", pallet: ["Sắt đế gỗ"] })
  const draftIds = [d1, d2, d3]

  const { error } = await callRpc(draftIds)
  assert(!!error, "Kỳ vọng RPC báo lỗi vượt max_per_kien nhưng lại thành công")
  assert(
    /vượt quá/i.test(error?.message || "") && /bành/i.test(error?.message || ""),
    `Lỗi đúng nhưng SAI NGUYÊN NHÂN — kỳ vọng message nhắc "vượt quá ... bành", nhận: "${error?.message}"`,
  )

  const lot = await fetchLot(maLo)
  assert(!lot, "Lô KHÔNG được phép tồn tại sau khi batch bị từ chối (rollback phải xóa cả lô mới tạo)")

  const remaining = await countDrafts(draftIds)
  assert(remaining === 3, `Kỳ vọng cả 3 nháp còn nguyên sau rollback, thực tế còn ${remaining}`)

  record("Test 2: vượt max_per_kien lũy kế trong batch -> rollback toàn bộ, nháp còn nguyên", true)
}

// Test 3: 2 nháp cùng kiện A nhưng khác Bọc (top-up không đồng nhất) + 1 nháp kiện B hợp lệ khác —
// toàn bộ phải bị từ chối bởi guard đồng nhất bọc/pallet.
async function test3() {
  const maLo = maLoFor(3)
  const d1 = await insertDraft({ maLo, kien: "A", soBanh: 10, boc: "BocX", pallet: ["Sắt đế gỗ"] })
  const d2 = await insertDraft({ maLo, kien: "A", soBanh: 5, boc: "BocY", pallet: ["Sắt đế gỗ"] })
  const d3 = await insertDraft({ maLo, kien: "B", soBanh: 10, boc: "BocX", pallet: ["Sắt đế gỗ"] })
  const draftIds = [d1, d2, d3]

  const { error } = await callRpc(draftIds)
  assert(!!error, "Kỳ vọng RPC báo lỗi lệch Bọc theo kiện nhưng lại thành công")
  assert(
    /Bọc/i.test(error?.message || ""),
    `Lỗi đúng nhưng SAI NGUYÊN NHÂN — kỳ vọng message nhắc "Bọc", nhận: "${error?.message}"`,
  )

  const lot = await fetchLot(maLo)
  assert(!lot, "Lô KHÔNG được phép tồn tại sau khi batch bị từ chối do lệch Bọc")

  const remaining = await countDrafts(draftIds)
  assert(remaining === 3, `Kỳ vọng cả 3 nháp còn nguyên sau rollback, thực tế còn ${remaining}`)

  record("Test 3: lệch Bọc giữa 2 lần nhập cùng kiện -> rollback toàn bộ, nháp còn nguyên", true)
}

// Test 4: gọi RPC với p_user_id KHÔNG khớp created_by thật của nháp — phải bị chặn ở bước
// ownership pre-check, không ghi gì cả.
async function test4() {
  const maLo = maLoFor(4)
  const d1 = await insertDraft({ maLo, kien: "A", soBanh: 10, boc: "BocTest4", pallet: ["Sắt đế gỗ"] })
  const draftIds = [d1]
  const fakeUserId = "00000000-0000-0000-0000-000000000000"

  const { error } = await callRpc(draftIds, fakeUserId)
  assert(!!error, "Kỳ vọng RPC báo lỗi không có quyền nhưng lại thành công")
  assert(
    /quyền/i.test(error?.message || ""),
    `Lỗi đúng nhưng SAI NGUYÊN NHÂN — kỳ vọng message nhắc "quyền", nhận: "${error?.message}"`,
  )

  const lot = await fetchLot(maLo)
  assert(!lot, "Lô KHÔNG được phép tồn tại sau khi bị chặn bởi ownership check")

  const remaining = await countDrafts(draftIds)
  assert(remaining === 1, `Kỳ vọng nháp còn nguyên sau khi bị chặn ownership, thực tế còn ${remaining}`)

  record("Test 4: p_user_id không khớp created_by -> bị chặn, không ghi gì", true)
}

async function cleanup() {
  if (KEEP) {
    console.log("--keep: bỏ qua dọn dẹp dữ liệu test.")
    return
  }
  console.log("Đang dọn dẹp dữ liệu test...")
  // lot_transactions tự xóa theo CASCADE khi xóa lots (FK ON DELETE CASCADE).
  const { error: lotsErr } = await supabase.from("lots").delete().eq("factory_id", factoryId).eq("ghi_chu", RUN_TAG)
  if (lotsErr) console.error(`Lỗi dọn lots: ${lotsErr.message}`)
  const { error: draftsErr } = await supabase
    .from("product_confirm_drafts")
    .delete()
    .eq("factory_id", factoryId)
    .eq("chi_thi", RUN_TAG)
  if (draftsErr) console.error(`Lỗi dọn product_confirm_drafts: ${draftsErr.message}`)
  if (nganId) {
    const { error: nganErr } = await supabase.from("ngans").delete().eq("id", nganId)
    if (nganErr) console.error(`Lỗi dọn ngăn test: ${nganErr.message}`)
  }
  console.log("Đã dọn dẹp xong.")
}

async function main() {
  factoryId = await resolveFactoryId()
  userId = await resolveUserId(factoryId)
  nganId = await setupNgan(factoryId)
  console.log(`factory=${factoryId} user=${userId} ngan=${nganId} (tong_kho=5000, run=${RUN_ID})`)

  const tests = [test1, test2, test3, test4]
  for (const fn of tests) {
    try {
      await fn()
    } catch (err) {
      record(fn.name, false, err instanceof Error ? err.message : String(err))
    }
  }
}

try {
  await main()
} catch (err) {
  console.error("Lỗi khởi tạo:", err instanceof Error ? err.message : err)
  results.push({ name: "setup", pass: false, detail: String(err) })
} finally {
  await cleanup()
}

const failed = results.filter((r) => !r.pass)
console.log("\n=== KẾT QUẢ ===")
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`)
console.log(failed.length === 0 ? `\nTất cả ${results.length} test PASS.` : `\n${failed.length}/${results.length} test FAIL.`)
process.exit(failed.length === 0 ? 0 : 1)
