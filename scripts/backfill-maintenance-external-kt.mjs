// GĐ2g — Đưa vật tư MUA NGOÀI ("ben_ngoai") của các biên bản bảo trì ĐÃ DUYỆT trước đây vào kho:
//   - 1 phiếu đề nghị mua "00/ĐNMVT" mỗi nhà máy / năm (dữ liệu lịch sử, không ký số, trạng thái tự
//     tính → Hoàn tất), dòng gộp theo vật tư;
//   - mỗi biên bản: phiếu NHẬP kho tạm KT (dòng trỏ dòng của phiếu 00) + phiếu XUẤT kho KT
//     `X-BT-{ma_bb}-KT` cùng ngày biên bản ⇒ tồn KT không đổi ròng, thẻ kho truy được 2 chiều.
// Mặc định CHỈ XEM. Ghi thật: --apply --actor=<user_id admin>. Tuỳ chọn --factory=<code>.
// Idempotent: bỏ qua biên bản đã có phiếu xuất `X-BT-{ma_bb}-KT` hoặc phiếu nhập `N-KT-LS-{ma_bb}`.
//
//   node --env-file=.env.local scripts/backfill-maintenance-external-kt.mjs
//   node --env-file=.env.local scripts/backfill-maintenance-external-kt.mjs --apply --actor=<uuid>

import { createClient } from "@supabase/supabase-js"

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=")
  return [k, v ?? true]
}))
const APPLY = !!args.apply
const ACTOR = typeof args.actor === "string" ? args.actor : null
if (APPLY && !ACTOR) { console.error("Cần --actor=<user_id admin> khi --apply"); process.exit(1) }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const KT = "KT"
const DEFAULT_RATE = { USD: 1, KHR: 4100, VND: 25000 }

async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

function todayVN() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())
}

async function processFactory(fac, actorName) {
  const { data: kt } = await sb.from("inventory_warehouses").select("id, code, name").eq("factory_id", fac.id).eq("code", KT).maybeSingle()
  if (!kt) { console.log(`- ${fac.code}: không có kho ${KT}, bỏ qua`); return }

  const records = await fetchAll(() =>
    sb.from("maintenance_records").select("id, ma_bb, ngay").eq("factory_id", fac.id).eq("trang_thai", "da_duyet").order("ngay"),
  )
  const recIds = records.map((r) => r.id)
  const mats = []
  for (let i = 0; i < recIds.length; i += 200) {
    const { data, error } = await sb
      .from("maintenance_materials")
      .select("record_id, inventory_item_id, ten_vat_tu, so_luong, don_gia, loai_tien")
      .eq("nguon", "ben_ngoai")
      .not("inventory_item_id", "is", null)
      .gt("so_luong", 0)
      .in("record_id", recIds.slice(i, i + 200))
    if (error) throw error
    mats.push(...(data || []))
  }
  const byRecord = new Map()
  for (const m of mats) byRecord.set(m.record_id, [...(byRecord.get(m.record_id) || []), m])

  // Đã xử lý trước đó?
  const done = new Set()
  const docs = await fetchAll(() =>
    sb.from("inventory_documents").select("document_code").eq("factory_id", fac.id).or(`document_code.like.N-KT-LS-%,document_code.like.X-BT-%-${KT}`),
  )
  const codes = new Set(docs.map((d) => d.document_code))
  for (const r of records) {
    if (codes.has(`N-KT-LS-${r.ma_bb}`) || codes.has(`X-BT-${r.ma_bb}-${KT}`)) done.add(r.id)
  }
  const todo = records.filter((r) => byRecord.has(r.id) && !done.has(r.id))

  const itemIds = [...new Set(mats.map((m) => m.inventory_item_id))]
  const items = new Map()
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await sb.from("inventory_items").select("id, code, name, unit, specification, manages_lot").in("id", itemIds.slice(i, i + 200))
    for (const it of data || []) items.set(it.id, it)
  }
  const rate = { ...DEFAULT_RATE }
  if (Number(fac.ty_gia_usd_vnd) > 0) rate.VND = Number(fac.ty_gia_usd_vnd)
  if (Number(fac.ty_gia_usd_khr) > 0) rate.KHR = Number(fac.ty_gia_usd_khr)
  const toUsd = (v, c) => (Number(v) || 0) / (rate[c] || 1)

  const skippedLot = []
  const plan = []
  for (const r of todo) {
    const lines = byRecord.get(r.id).filter((m) => {
      const it = items.get(m.inventory_item_id)
      if (!it) return false
      if (it.manages_lot) { skippedLot.push(`${r.ma_bb}: ${it.name}`); return false }
      return true
    })
    if (lines.length) plan.push({ record: r, lines })
  }
  const totals = new Map()
  for (const p of plan) for (const m of p.lines) {
    const t = totals.get(m.inventory_item_id) || { qty: 0, usd: 0 }
    t.qty += Number(m.so_luong); t.usd += toUsd(m.don_gia, m.loai_tien || "USD") * Number(m.so_luong)
    totals.set(m.inventory_item_id, t)
  }

  console.log(`\n== ${fac.code} (${fac.name}) — kho ${kt.code}`)
  console.log(`  Biên bản đã duyệt: ${records.length}; có vật tư mua ngoài: ${byRecord.size}; đã xử lý trước: ${done.size}; sẽ xử lý: ${plan.length}`)
  console.log(`  Vật tư khác nhau: ${totals.size}; tổng dòng: ${plan.reduce((s, p) => s + p.lines.length, 0)}`)
  if (skippedLot.length) console.log(`  Bỏ qua (vật tư quản lý lô, cần xử lý tay): ${skippedLot.join("; ")}`)
  for (const p of plan.slice(0, 15)) {
    console.log(`   ${p.record.ma_bb} (${p.record.ngay}): ${p.lines.map((m) => `${items.get(m.inventory_item_id).name} × ${m.so_luong}`).join(", ")}`)
  }
  if (plan.length > 15) console.log(`   … và ${plan.length - 15} biên bản khác`)
  if (!APPLY || !plan.length) return

  // Phiếu 00/ĐNMVT của năm hiện tại.
  const nam = Number(todayVN().slice(0, 4))
  let { data: req00 } = await sb.from("purchase_requests").select("id").eq("factory_id", fac.id).eq("nam", nam).eq("so", 0).maybeSingle()
  if (!req00) {
    const { data, error } = await sb.from("purchase_requests").insert({
      factory_id: fac.id, nam, so: 0, ngay: todayVN(), loai: "goc",
      nguoi_de_nghi_id: ACTOR, nguoi_de_nghi_ten: actorName, loai_tien: "USD", tong_tien: 0,
      ghi_chu: "Dữ liệu lịch sử — vật tư mua ngoài của biên bản bảo trì đã duyệt trước khi có liên kết kho tạm KT",
      trang_thai: "da_duyet", created_by: ACTOR,
    }).select("id").single()
    if (error) throw error
    req00 = data
  }
  const { data: existingLines } = await sb.from("purchase_request_lines").select("sort_order").eq("request_id", req00.id)
  let sort = (existingLines || []).reduce((m, l) => Math.max(m, l.sort_order + 1), 0)
  const lineByItem = new Map()
  for (const [itemId, t] of totals) {
    const it = items.get(itemId)
    const donGia = t.qty > 0 ? Math.round((t.usd / t.qty) * 100) / 100 : 0
    const { data, error } = await sb.from("purchase_request_lines").insert({
      request_id: req00.id, factory_id: fac.id, sort_order: sort++, item_id: itemId, item_code: it.code,
      item_name: it.name, unit: it.unit, so_luong: t.qty, don_gia: donGia, thanh_tien: Math.round(t.qty * donGia * 100) / 100,
      muc_dich: "Vật tư mua ngoài — biên bản bảo trì (dữ liệu lịch sử)",
    }).select("id").single()
    if (error) throw error
    lineByItem.set(itemId, { id: data.id, donGia })
  }

  let ok = 0
  for (const p of plan) {
    const r = p.record
    try {
      // Nhập KT
      const { data: imp, error: impErr } = await sb.from("inventory_documents").insert({
        factory_id: fac.id, document_code: `N-KT-LS-${r.ma_bb}`, document_type: "import", document_date: r.ngay,
        target_warehouse_id: kt.id, source_name: "Mua ngoài (dữ liệu lịch sử)", requester_name: actorName,
        created_by: ACTOR, status: "draft", notes: `Nhập theo đề nghị mua số 00/ĐNMVT (${nam}) — biên bản ${r.ma_bb}`,
      }).select("id").single()
      if (impErr) throw impErr
      const lineRows = (doc) => p.lines.map((m) => {
        const it = items.get(m.inventory_item_id)
        return {
          document_id: doc, factory_id: fac.id, item_id: it.id, item_code: it.code, item_name: it.name, unit: it.unit || "",
          specification: it.specification || null, quantity: Number(m.so_luong), lot_no: null, expiry_date: null,
          location_code: kt.code, line_notes: m.ten_vat_tu || it.name, image_urls: [],
        }
      })
      const { error: il } = await sb.from("inventory_document_lines").insert(lineRows(imp.id).map((l, i) => ({
        ...l, don_gia: lineByItem.get(p.lines[i].inventory_item_id).donGia, loai_tien: "USD",
        purchase_request_line_id: lineByItem.get(p.lines[i].inventory_item_id).id,
      })))
      if (il) throw il
      const { error: ip } = await sb.rpc("inventory_post_import_document", { p_factory_id: fac.id, p_document_id: imp.id, p_posted_by: ACTOR })
      if (ip) throw ip
      // Xuất KT
      const { data: exp, error: expErr } = await sb.from("inventory_documents").insert({
        factory_id: fac.id, document_type: "export", document_code: `X-BT-${r.ma_bb}-${KT}`, document_date: r.ngay,
        source_warehouse_id: kt.id, target_warehouse_id: null, source_name: kt.name, status: "draft",
        notes: `Xuất kho cho biên bản sửa chữa/bảo trì số: ${r.ma_bb} (vật tư mua ngoài, dữ liệu lịch sử)`,
        requester_name: actorName, created_by: ACTOR,
      }).select("id").single()
      if (expErr) throw expErr
      const { error: el } = await sb.from("inventory_document_lines").insert(lineRows(exp.id))
      if (el) throw el
      const { error: ep } = await sb.rpc("inventory_post_export_document", { p_factory_id: fac.id, p_document_id: exp.id, p_posted_by: ACTOR })
      if (ep) throw ep
      const { data: recRow } = await sb.from("maintenance_records").select("inventory_issue_doc_ids").eq("id", r.id).single()
      const ids = [...new Set([...(recRow?.inventory_issue_doc_ids || []), exp.id])]
      await sb.from("maintenance_records").update({ inventory_issue_doc_ids: ids }).eq("id", r.id)
      ok++
    } catch (e) {
      console.error(`   ✗ ${r.ma_bb}: ${e.message || e}`)
    }
  }
  const { data: allLines } = await sb.from("purchase_request_lines").select("thanh_tien").eq("request_id", req00.id)
  await sb.from("purchase_requests").update({ tong_tien: (allLines || []).reduce((s, l) => s + Number(l.thanh_tien || 0), 0) }).eq("id", req00.id)
  const { error: rc } = await sb.rpc("purchase_recompute_request", { p_request_id: req00.id })
  if (rc) console.warn(`  Không tính lại trạng thái phiếu 00: ${rc.message}`)
  console.log(`  ✓ Đã xử lý ${ok}/${plan.length} biên bản — phiếu 00/ĐNMVT (${nam}) id ${req00.id}`)
}

const facQ = sb.from("factories").select("id, code, name, ty_gia_usd_vnd, ty_gia_usd_khr")
const { data: factories, error } = typeof args.factory === "string" ? await facQ.eq("code", args.factory) : await facQ
if (error) throw error
let actorName = ""
if (ACTOR) {
  const { data } = await sb.from("profiles").select("full_name, username, role").eq("id", ACTOR).maybeSingle()
  if (!data) { console.error("Không tìm thấy --actor"); process.exit(1) }
  actorName = data.full_name || data.username || ""
}
console.log(APPLY ? "CHẾ ĐỘ GHI THẬT" : "CHẾ ĐỘ XEM (thêm --apply --actor=<uuid> để ghi)")
for (const fac of factories || []) await processFactory(fac, actorName)
