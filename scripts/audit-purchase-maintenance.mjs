// Rà soát (CHỈ ĐỌC) liên kết Đề nghị mua ↔ Biên bản bảo trì ↔ Kho.
//   node --env-file=.env.local scripts/audit-purchase-maintenance.mjs [--factory=phuochoa_kt]
// Xuất ../rubber-erp-backups/rasoat-de-nghi-bien-ban-<ngày>.xlsx — mỗi nhóm 1 sheet, cột "Quyết định" để
// người dùng điền (Huỷ / Đóng / Gắn / Giữ) rồi đưa cho scripts/apply-audit-decisions.mjs.
// KHÔNG ghi gì vào DB. Chỉ "nghi ngờ" + lý do, không kết luận chắc chắn sai.
import { createClient } from "@supabase/supabase-js"
import ExcelJS from "exceljs"
import fs from "node:fs"
import path from "node:path"

const APP = "https://qlsxkpt.vercel.app"
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")))
const FACTORY_CODE = args.factory || "phuochoa_kt"
const STALE_DAYS = 30

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const todayISO = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())
const staleBefore = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()

// ── Truy vấn ────────────────────────────────────────────────────────────────────────────
async function fetchAll(table, cols, build, orderCol = "created_at") {
  const PAGE = 1000
  let all = []
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols)
    q = build(q).order(orderCol, { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
  }
  const { count, error } = await build(sb.from(table).select("id", { count: "exact", head: true }))
  if (error) throw new Error(`${table} (count): ${error.message}`)
  if (count !== all.length) throw new Error(`${table}: tải ${all.length} dòng nhưng count = ${count} — dừng`)
  return all
}

async function fetchIn(table, cols, col, ids, extra = (q) => q) {
  const out = []
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await extra(sb.from(table).select(cols).in(col, uniq.slice(i, i + 200)))
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data || []))
  }
  return out
}

// ── Nhãn ────────────────────────────────────────────────────────────────────────────────
const PR_STATUS = { nhap: "Nháp", cho_ky: "Đang ký duyệt", tra_ve: "Bị trả về", da_duyet: "Đã duyệt", dang_mua: "Đang mua", hoan_tat: "Hoàn tất", dong: "Đã đóng", huy: "Đã huỷ" }
const MR_STATUS = { cho_duyet: "Chờ duyệt", da_duyet: "Đã duyệt", huy: "Đã huỷ", tu_choi: "Từ chối" }
const soPhieu = (r) => `${String(r.so ?? "").padStart(2, "0")}/ĐNMVT (${r.nam})`
const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 3 })
const day = (s) => (s ? String(s).slice(0, 10) : "")
const MA_BB_RE = /[A-Z]{1,3}-\d{6}\/\d{3}/g

// ── Nạp dữ liệu ─────────────────────────────────────────────────────────────────────────
const { data: factory, error: fErr } = await sb.from("factories").select("id, code, name").eq("code", FACTORY_CODE).maybeSingle()
if (fErr || !factory) throw new Error(`Không tìm thấy nhà máy ${FACTORY_CODE}`)
const FID = factory.id
const byF = (q) => q.eq("factory_id", FID)
console.log(`Nhà máy: ${factory.name} (${factory.code})`)

const requests = await fetchAll(
  "purchase_requests",
  "id, nam, so, ngay, loai, parent_request_id, trang_thai, nguoi_de_nghi_id, lap_boi_id, created_by, maintenance_record_id, ghi_chu, ly_do_dieu_chinh, yeu_cau_ky_id, created_at, updated_at",
  byF,
)
const lines = await fetchAll(
  "purchase_request_lines",
  "id, request_id, item_id, item_code, item_name, unit, so_luong, muc_dich, ghi_chu, ly_do_lech_gia, parent_line_id, maintenance_record_id, created_at",
  byF,
)
const logs = await fetchAll("purchase_request_logs", "id, request_id, hanh_dong, noi_dung, created_at", byF)
const records = await fetchAll(
  "maintenance_records",
  "id, ma_bb, hang_muc, bo_phan, ngay, trang_thai, nguoi_tao, created_by, created_at, updated_at, inventory_issue_doc_id, inventory_issue_doc_ids",
  byF,
)
const recLines = await fetchAll(
  "maintenance_record_lines",
  "id, record_id, asset_id, dispatch_vehicle_id, ten_tb, ma_tb, noi_dung, nguyen_nhan, cac_khac_phuc",
  byF,
)
const mats = await fetchAll("maintenance_materials", "id, record_id, line_id, nguon, inventory_item_id, ten_vat_tu, dvt, so_luong", byF)
const allocs = await fetchAll("purchase_line_record_allocations", "id, line_id, maintenance_record_id, so_luong, created_at", byF)
const ycs = await fetchAll("yeu_cau_ky", "id, ban_ghi_id, trang_thai, tao_luc", (q) => byF(q).eq("modun", "maintenance"), "tao_luc")
const xbtDocs = await fetchAll(
  "inventory_documents",
  "id, document_code, status, document_date, created_at",
  (q) => byF(q).like("document_code", "X-BT-%"),
)
const items = await fetchIn("inventory_items", "id, code, name, la_dich_vu, nguon_tao", "id", [
  ...lines.map((l) => l.item_id),
  ...mats.map((m) => m.inventory_item_id),
])
const people = await fetchIn("profiles", "id, full_name, username", "id", [
  ...requests.flatMap((r) => [r.nguoi_de_nghi_id, r.lap_boi_id, r.created_by]),
  ...records.map((r) => r.created_by),
])

// SL hiệu lực + đã nhận theo dòng gốc (phiếu chưa huỷ).
const effByLine = new Map()
const liveReq = requests.filter((r) => r.trang_thai !== "huy" && r.loai !== "dieu_chinh")
for (let i = 0; i < liveReq.length; i += 10) {
  const res = await Promise.all(liveReq.slice(i, i + 10).map((r) => sb.rpc("purchase_effective_lines", { p_request_id: r.id })))
  for (const { data, error } of res) {
    if (error) throw new Error(`purchase_effective_lines: ${error.message}`)
    for (const e of data || []) effByLine.set(e.root_line_id, e)
  }
}
console.log(
  `Đã tải: ${requests.length} phiếu, ${lines.length} dòng, ${records.length} biên bản, ${mats.length} vật tư BB, ${allocs.length} phân bổ, ${xbtDocs.length} phiếu X-BT`,
)

// ── Chỉ mục ─────────────────────────────────────────────────────────────────────────────
const reqById = new Map(requests.map((r) => [r.id, r]))
const recById = new Map(records.map((r) => [r.id, r]))
const recByMa = new Map(records.filter((r) => r.ma_bb).map((r) => [r.ma_bb, r]))
const itemById = new Map(items.map((i) => [i.id, i]))
const personName = (id) => {
  const p = people.find((x) => x.id === id)
  return p ? p.full_name || p.username || id : id ? "(không rõ)" : ""
}
const linesByReq = new Map()
for (const l of lines) (linesByReq.get(l.request_id) || linesByReq.set(l.request_id, []).get(l.request_id)).push(l)
const logsByReq = new Map()
for (const l of logs) (logsByReq.get(l.request_id) || logsByReq.set(l.request_id, []).get(l.request_id)).push(l)
const matsByRec = new Map()
for (const m of mats) (matsByRec.get(m.record_id) || matsByRec.set(m.record_id, []).get(m.record_id)).push(m)
const linesByRec = new Map()
for (const l of recLines) (linesByRec.get(l.record_id) || linesByRec.set(l.record_id, []).get(l.record_id)).push(l)
const allocsByLine = new Map()
for (const a of allocs) (allocsByLine.get(a.line_id) || allocsByLine.set(a.line_id, []).get(a.line_id)).push(a)
const ycByRec = new Map()
for (const y of ycs) if (y.ban_ghi_id) (ycByRec.get(y.ban_ghi_id) || ycByRec.set(y.ban_ghi_id, []).get(y.ban_ghi_id)).push(y)
const isService = (itemId) => !!itemById.get(itemId)?.la_dich_vu || itemById.get(itemId)?.nguon_tao === "bao_tri_gia_cong"

function eff(line) {
  const e = effByLine.get(line.id)
  return {
    qty: Number(e?.so_luong ?? line.so_luong) || 0,
    received: Number(e?.received ?? 0) || 0,
    itemId: e?.item_id || line.item_id,
    name: e?.item_name || line.item_name,
    unit: e?.unit || line.unit || "",
  }
}
function reqItems(r) {
  return (linesByReq.get(r.id) || [])
    .filter((l) => !l.parent_line_id)
    .map((l) => {
      const e = eff(l)
      return `${e.name} × ${fmtNum(e.qty)} ${e.unit}`.trim()
    })
    .join("; ")
}
function reqReceived(r) {
  return (linesByReq.get(r.id) || [])
    .filter((l) => !l.parent_line_id)
    .map((l) => `${eff(l).name}: ${fmtNum(eff(l).received)}`)
    .join("; ")
}
function recItems(rec) {
  return (matsByRec.get(rec.id) || [])
    .map((m) => `${m.ten_vat_tu || itemById.get(m.inventory_item_id)?.name || "?"} × ${fmtNum(m.so_luong)} ${m.dvt || ""} (${m.nguon})`.trim())
    .join("; ")
}
function reqRow(r, sub, lyDo, deXuat, extra = {}) {
  return {
    kind: "purchase",
    id: r.id,
    sub,
    ma: soPhieu(r),
    trangThai: PR_STATUS[r.trang_thai] || r.trang_thai,
    ngay: day(r.ngay || r.created_at),
    nguoiLap: personName(r.lap_boi_id || r.created_by),
    nguoiDeNghi: personName(r.nguoi_de_nghi_id),
    vatTu: reqItems(r),
    daNhap: reqReceived(r),
    link: `${APP}/dashboard/purchase/${r.id}`,
    lyDo,
    deXuat,
    ...extra,
  }
}
function recRow(rec, sub, lyDo, deXuat, extra = {}) {
  return {
    kind: "record",
    id: rec.id,
    sub,
    ma: rec.ma_bb || "(chưa có mã)",
    trangThai: MR_STATUS[rec.trang_thai] || rec.trang_thai,
    ngay: day(rec.ngay || rec.created_at),
    nguoiLap: rec.nguoi_tao || personName(rec.created_by),
    nguoiDeNghi: "",
    vatTu: recItems(rec),
    daNhap: "",
    link: `${APP}/dashboard/maintenance/records/${rec.id}`,
    lyDo,
    deXuat,
    ...extra,
  }
}

const groups = { A: [], B: [], C: [], D: [], E: [], F: [] }
const OPEN = ["nhap", "tra_ve", "cho_ky", "da_duyet"]

// ── A. Phiếu lập từ biên bản đã huỷ / đã xoá ───────────────────────────────────────────
for (const r of requests) {
  if (!OPEN.includes(r.trang_thai)) continue
  const texts = [r.ghi_chu || "", ...(logsByReq.get(r.id) || [])
    .filter((l) => ["tao_tu_bao_tri", "cap_nhat_tu_bao_tri"].includes(l.hanh_dong))
    .map((l) => l.noi_dung || "")]
  const fromRecordLog = (logsByReq.get(r.id) || []).some((l) => ["tao_tu_bao_tri", "cap_nhat_tu_bao_tri"].includes(l.hanh_dong))
  const maBbs = Array.from(new Set(texts.flatMap((t) => t.match(MA_BB_RE) || [])))
  if (r.maintenance_record_id) {
    const rec = recById.get(r.maintenance_record_id)
    if (rec?.trang_thai === "huy") {
      groups.A.push(reqRow(r, "Biên bản đã huỷ", `Phiếu lập từ biên bản ${rec.ma_bb} — biên bản đã huỷ, phiếu còn ${PR_STATUS[r.trang_thai]}`,
        r.trang_thai === "da_duyet" ? "Huỷ (nếu chưa mua) / Giữ" : "Huỷ", { bienBan: rec.ma_bb }))
    }
  } else if (r.lap_boi_id && (fromRecordLog || maBbs.length)) {
    const live = maBbs.map((m) => recByMa.get(m)).filter(Boolean)
    const missing = maBbs.filter((m) => !recByMa.has(m))
    if (!live.length || live.every((x) => x.trang_thai === "huy")) {
      groups.A.push(reqRow(r, "Biên bản đã xoá",
        `Phiếu có dấu vết lập từ biên bản ${maBbs.join(", ") || "(không rõ mã)"} nhưng không còn liên kết${missing.length ? ` — biên bản ${missing.join(", ")} không còn trong hệ thống` : " — biên bản đã huỷ"}`,
        r.trang_thai === "da_duyet" ? "Huỷ (nếu chưa mua) / Giữ" : "Huỷ", { bienBan: maBbs.join(", ") }))
    }
  }
}

// ── Nhu cầu biên bản (mua ngoài / gia công) theo (biên bản, vật tư) ─────────────────────
const demand = new Map() // `${rec}|${item}` → SL
for (const m of mats) {
  if (!["ben_ngoai", "gia_cong"].includes(m.nguon) || !m.inventory_item_id) continue
  const k = `${m.record_id}|${m.inventory_item_id}`
  demand.set(k, (demand.get(k) || 0) + (Number(m.so_luong) || 0))
}
// Cung = dòng gắn biên bản (phiếu gốc chưa huỷ) + phân bổ.
const supply = new Map() // key → [{line, req, qty, how}]
for (const l of lines) {
  if (!l.maintenance_record_id || l.parent_line_id) continue
  const r = reqById.get(l.request_id)
  if (!r || r.trang_thai === "huy" || r.loai === "dieu_chinh") continue
  const e = eff(l)
  const qty = r.trang_thai === "dong" ? e.received : e.qty
  const k = `${l.maintenance_record_id}|${e.itemId}`
  ;(supply.get(k) || supply.set(k, []).get(k)).push({ line: l, req: r, qty, how: "dòng gắn" })
}
for (const a of allocs) {
  const l = lines.find((x) => x.id === a.line_id)
  const r = l && reqById.get(l.request_id)
  if (!l || !r || r.trang_thai === "huy") continue
  const k = `${a.maintenance_record_id}|${eff(l).itemId}`
  ;(supply.get(k) || supply.set(k, []).get(k)).push({ line: l, req: r, qty: Number(a.so_luong) || 0, how: "phân bổ" })
}

// ── B. Lập thừa ─────────────────────────────────────────────────────────────────────────
for (const [k, list] of Array.from(supply.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
  const [recId, itemId] = k.split("|")
  const rec = recById.get(recId)
  if (!rec || rec.trang_thai === "huy") continue // biên bản huỷ ⇒ nhóm A / F
  const need = demand.get(k) || 0
  const total = list.reduce((s, x) => s + x.qty, 0)
  const multi = list.filter((x) => x.how === "dòng gắn").length >= 2
  if (total <= need && !multi) continue
  const name = itemById.get(itemId)?.name || list[0].line.item_name
  const excess = Math.max(0, total - need)
  for (const x of list) {
    const reason = [
      multi ? `Biên bản ${rec.ma_bb} có ${list.length} dòng đề nghị cùng "${name}"` : null,
      total > need ? `Tổng đề nghị ${fmtNum(total)} > nhu cầu biên bản ${fmtNum(need)} (thừa ${fmtNum(excess)})` : null,
      `Dòng này: ${fmtNum(x.qty)} (${x.how})`,
    ].filter(Boolean).join(" · ")
    const received = eff(x.line).received
    const deXuat = x.req.trang_thai === "nhap" || x.req.trang_thai === "tra_ve" || x.req.trang_thai === "cho_ky"
      ? "Huỷ phiếu thừa / Giữ"
      : received > 0 ? "Giữ (đã nhận hàng) — dư dùng cho biên bản sau" : "Giữ / Huỷ nếu chưa mua"
    groups.B.push(reqRow(x.req, x.how === "phân bổ" ? "Phân bổ" : "Dòng gắn", reason, deXuat, {
      bienBan: rec.ma_bb,
      vatTu: `${name} × ${fmtNum(x.qty)}`,
      daNhap: fmtNum(received),
    }))
  }
}

// ── C. Gia công lập riêng chưa gắn biên bản ────────────────────────────────────────────
for (const l of lines) {
  if (l.parent_line_id || l.maintenance_record_id) continue
  const r = reqById.get(l.request_id)
  if (!r || r.trang_thai === "huy" || r.loai === "dieu_chinh") continue
  const e = eff(l)
  if (!isService(e.itemId)) continue
  const allocated = (allocsByLine.get(l.id) || []).reduce((s, a) => s + (Number(a.so_luong) || 0), 0)
  if (allocated >= e.qty) continue
  const free = e.qty - allocated
  // Biên bản chờ duyệt đang thiếu đúng dịch vụ này.
  const cands = records
    .filter((rec) => rec.trang_thai === "cho_duyet")
    .map((rec) => {
      const k = `${rec.id}|${e.itemId}`
      const need = demand.get(k) || 0
      const have = (supply.get(k) || []).reduce((s, x) => s + x.qty, 0)
      return { rec, short: need - have }
    })
    .filter((c) => c.short > 0)
    .sort((a, b) => String(a.rec.created_at).localeCompare(String(b.rec.created_at)))
  const best = cands[0]
  groups.C.push(reqRow(r, e.received > 0 ? "Đã hoàn thành (một phần)" : "Còn mở",
    `Dịch vụ "${e.name}" ${fmtNum(e.qty)} chưa gắn biên bản (còn ${fmtNum(free)} chưa phân bổ)` +
      (cands.length ? ` · Biên bản đang thiếu: ${cands.map((c) => `${c.rec.ma_bb} (${fmtNum(c.short)})`).join(", ")}` : " · Không có biên bản nào đang thiếu dịch vụ này"),
    best ? "Gắn biên bản" : r.trang_thai === "nhap" ? "Giữ / Huỷ" : "Giữ",
    {
      vatTu: `${e.name} × ${fmtNum(e.qty)}`,
      daNhap: fmtNum(e.received),
      lineId: l.id,
      ganBienBanId: best?.rec.id || "",
      ganBienBan: best?.rec.ma_bb || "",
      ganSoLuong: best ? Math.min(free, best.short) : "",
    }))
}

// ── D. Nháp / Trả về không động > 30 ngày + phiếu "test" ───────────────────────────────
const TEST_RE = /\btest\b/i
for (const r of requests) {
  if (r.trang_thai === "huy") continue
  const reasons = []
  if (["nhap", "tra_ve"].includes(r.trang_thai) && r.updated_at < staleBefore) {
    reasons.push(`${PR_STATUS[r.trang_thai]} không cập nhật từ ${day(r.updated_at)} (> ${STALE_DAYS} ngày)`)
  }
  const texts = [r.ghi_chu, r.ly_do_dieu_chinh, ...(linesByReq.get(r.id) || []).flatMap((l) => [l.muc_dich, l.ghi_chu, l.ly_do_lech_gia])]
  if (texts.some((t) => t && TEST_RE.test(t))) reasons.push('Có chữ "test" trong ghi chú / mục đích / lý do')
  if (!reasons.length) continue
  const deXuat = ["nhap", "tra_ve", "cho_ky", "da_duyet"].includes(r.trang_thai)
    ? "Huỷ"
    : r.trang_thai === "dang_mua" ? "Đóng phiếu" : "Giữ"
  groups.D.push(reqRow(r, reasons.length > 1 ? "Cũ + test" : reasons[0].includes("test") ? "Test" : "Không động", reasons.join(" · "), deXuat))
}

// ── E. Biên bản ─────────────────────────────────────────────────────────────────────────
const xbtRecMa = (code) => (String(code).match(/^X-BT-([A-Z]{1,3}-\d{6}\/\d{3})/) || [])[1] || null
const postedXbtByMa = new Map()
for (const d of xbtDocs) {
  if (d.status !== "posted") continue
  const m = xbtRecMa(d.document_code)
  ;(postedXbtByMa.get(m || "?") || postedXbtByMa.set(m || "?", []).get(m || "?")).push(d)
}
// Mốc dữ liệu: trước khi có xuất kho tự động (phiếu X-BT đầu tiên) là dữ liệu cũ — không đưa vào E2/E5/E6
// (chỉ đếm). Vật tư MUA NGOÀI chỉ xuất qua kho từ GĐ2g (06/10/2026) khi ký hoàn tất.
const XBT_START = day(xbtDocs.map((d) => d.created_at).sort()[0] || "2026-05-11")
const EXT_KT_START = "2026-10-06"
const legacy = { e2: 0, e5: 0, e6: 0 }
for (const rec of records) {
  const yc = ycByRec.get(rec.id) || []
  const recMats = matsByRec.get(rec.id) || []
  const posted = (rec.ma_bb && postedXbtByMa.get(rec.ma_bb)) || []
  const recDay = day(rec.ngay || rec.created_at)
  const signedNewFlow = yc.some((y) => y.trang_thai === "hoan_tat" && day(y.tao_luc) >= EXT_KT_START)
  // (1) kẹt
  if (rec.trang_thai === "cho_duyet" && yc.some((y) => y.trang_thai === "hoan_tat")) {
    groups.E.push(recRow(rec, "1. Kẹt xuất kho", "Chờ duyệt nhưng yêu cầu ký đã hoàn tất (xuất kho lỗi)", "Thử xuất kho lại / Huỷ ký duyệt (làm trên app)"))
  }
  // (2) đã duyệt nhưng không còn X-BT posted mà có vật tư qua kho
  const stockMats = recMats.filter(
    (m) =>
      m.inventory_item_id && !isService(m.inventory_item_id) && Number(m.so_luong) > 0 &&
      ((m.nguon === "trong_kho" && recDay >= XBT_START) || (m.nguon === "ben_ngoai" && signedNewFlow)),
  )
  const hadAnyStockMat = recMats.some((m) => m.inventory_item_id && ["trong_kho", "ben_ngoai"].includes(m.nguon) && Number(m.so_luong) > 0)
  if (rec.trang_thai === "da_duyet" && !posted.length && hadAnyStockMat && !stockMats.length) legacy.e2++
  if (rec.trang_thai === "da_duyet" && stockMats.length && !posted.length) {
    groups.E.push(recRow(rec, "2. Đã duyệt thiếu X-BT", `Đã duyệt, có ${stockMats.length} vật tư qua kho nhưng không có phiếu X-BT-${rec.ma_bb} đã ghi sổ`, "Kiểm tra tồn / Giữ (dữ liệu cũ)"))
  }
  // (3) huỷ mà còn X-BT posted
  if (rec.trang_thai === "huy" && posted.length) {
    groups.E.push(recRow(rec, "3. Huỷ còn X-BT", `Biên bản đã huỷ nhưng còn phiếu ${posted.map((d) => d.document_code).join(", ")} đã ghi sổ (tồn chưa hoàn)`, "Huỷ phiếu X-BT (hoàn tồn)", {
      xbtIds: posted.map((d) => d.id).join(","),
    }))
  }
  // (5) chờ duyệt > 30 ngày không có yêu cầu ký
  if (rec.trang_thai === "cho_duyet" && rec.created_at < staleBefore && !yc.some((y) => ["dang_luan_chuyen", "hoan_tat"].includes(y.trang_thai))) {
    // Mốc theo NGÀY biên bản (dữ liệu 2024 nhập vào sau nên created_at mới).
    if (recDay < XBT_START) legacy.e5++
    else groups.E.push(recRow(rec, "5. Chờ duyệt lâu", `Chờ duyệt từ ${day(rec.created_at)}, chưa gửi ký`, "Huỷ / Giữ (nhắc gửi ký)"))
  }
  // (7) không có thiết bị / nội dung trống
  const rl = linesByRec.get(rec.id) || []
  const emptyContent = rl.length > 0 && rl.every((l) => ![l.noi_dung, l.nguyen_nhan, l.cac_khac_phuc].some((t) => String(t || "").trim())) && !recMats.length
  if (rec.trang_thai !== "huy" && (!rl.length || emptyContent)) {
    groups.E.push(recRow(rec, "7. Trống", !rl.length ? "Không có dòng thiết bị nào" : "Mọi dòng thiết bị trống nội dung và không có vật tư", "Huỷ / Giữ"))
  }
}
// (4) X-BT posted không khớp biên bản nào
for (const [ma, docs] of postedXbtByMa) {
  if (ma !== "?" && recByMa.has(ma)) continue
  for (const d of docs) {
    groups.E.push({
      kind: "xbt", id: d.id, sub: "4. X-BT mồ côi", ma: d.document_code, trangThai: "Đã ghi sổ", ngay: day(d.document_date || d.created_at),
      nguoiLap: "", nguoiDeNghi: "", vatTu: "", daNhap: "", link: `${APP}/dashboard/inventory/document/issue/${d.id}`,
      lyDo: ma === "?" ? "Mã phiếu không đọc được mã biên bản" : `Biên bản ${ma} không còn trong hệ thống (đã xoá?) — phiếu xuất vẫn trừ tồn`,
      deXuat: "Kiểm tra — huỷ phiếu X-BT nếu biên bản đã xoá",
    })
  }
}
// (6) nghi trùng: cùng thiết bị/xe + cùng ngày + cùng hạng mục
const dupMap = new Map()
for (const rec of records) {
  if (rec.trang_thai === "huy") continue
  if (day(rec.ngay || rec.created_at) < XBT_START) { legacy.e6++; continue }
  for (const l of linesByRec.get(rec.id) || []) {
    const eq = l.asset_id || l.dispatch_vehicle_id
    if (!eq) continue
    const k = `${eq}|${rec.ngay}|${rec.hang_muc}`
    const s = dupMap.get(k) || dupMap.set(k, new Set()).get(k)
    s.add(rec.id)
  }
}
const dupSeen = new Set()
for (const [k, ids] of dupMap) {
  if (ids.size < 2) continue
  const recs = Array.from(ids).map((id) => recById.get(id)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const eqName = (linesByRec.get(recs[0].id) || []).find((l) => (l.asset_id || l.dispatch_vehicle_id) === k.split("|")[0])
  for (const rec of recs) {
    const key = `${rec.id}|${k}`
    if (dupSeen.has(key)) continue
    dupSeen.add(key)
    groups.E.push(recRow(rec, "6. Nghi trùng",
      `Cùng ${eqName?.ma_tb || eqName?.ten_tb || "thiết bị"} + ngày ${day(rec.ngay)} + ${rec.hang_muc} với ${recs.filter((x) => x.id !== rec.id).map((x) => x.ma_bb).join(", ")}`,
      rec === recs[0] ? "Giữ (biên bản lập trước)" : "Huỷ nếu trùng thật / Giữ"))
  }
}

// ── F. Phân bổ lỗi ──────────────────────────────────────────────────────────────────────
for (const a of allocs) {
  const l = lines.find((x) => x.id === a.line_id)
  const r = l && reqById.get(l.request_id)
  const rec = recById.get(a.maintenance_record_id)
  const base = r ? reqRow(r, "", "", "") : { kind: "purchase", id: "", ma: "(phiếu không còn)", link: "" }
  let reason = null
  if (!rec) reason = "Phân bổ trỏ biên bản không còn trong hệ thống"
  else if (rec.trang_thai === "huy") reason = `Phân bổ trỏ biên bản ${rec.ma_bb} đã huỷ`
  else {
    const k = `${rec.id}|${l ? eff(l).itemId : ""}`
    const need = demand.get(k) || 0
    const totalAlloc = allocs.filter((x) => x.maintenance_record_id === rec.id && lines.find((y) => y.id === x.line_id && eff(y).itemId === (l && eff(l).itemId))).reduce((s, x) => s + Number(x.so_luong || 0), 0)
    if (totalAlloc > need) reason = `Tổng phân bổ ${fmtNum(totalAlloc)} > nhu cầu hiện tại ${fmtNum(need)} của biên bản ${rec.ma_bb}`
  }
  if (!reason) continue
  groups.F.push({
    ...base, kind: "allocation", id: a.id, sub: "Phân bổ", lyDo: reason, deXuat: "Gỡ phân bổ (Gắn SL 0)",
    bienBan: rec?.ma_bb || a.maintenance_record_id, vatTu: l ? `${eff(l).name} × ${fmtNum(a.so_luong)}` : "",
    lineId: a.line_id, ganBienBanId: a.maintenance_record_id, ganSoLuong: 0,
  })
}

// ── Xuất Excel ──────────────────────────────────────────────────────────────────────────
const SHEETS = [
  ["A", "A. Phiếu từ BB đã huỷ-xoá"],
  ["B", "B. Lập thừa"],
  ["C", "C. Gia công chưa gắn BB"],
  ["D", "D. Nháp cũ - test"],
  ["E", "E. Biên bản"],
  ["F", "F. Phân bổ lỗi"],
]
const COLS = [
  ["sub", "Nhóm con", 16],
  ["ma", "Mã phiếu / biên bản", 22],
  ["trangThai", "Trạng thái", 14],
  ["ngay", "Ngày lập", 11],
  ["nguoiLap", "Người lập", 18],
  ["nguoiDeNghi", "Người đề nghị", 18],
  ["bienBan", "Biên bản liên quan", 18],
  ["vatTu", "Vật tư + SL", 40],
  ["daNhap", "Đã nhập / hoàn thành", 22],
  ["link", "Link app", 30],
  ["lyDo", "Lý do nghi ngờ", 55],
  ["deXuat", "Đề xuất", 24],
  ["ganBienBan", "Gắn vào biên bản (đề xuất)", 18],
  ["ganSoLuong", "SL gắn (đề xuất)", 10],
  ["quyetDinh", "Quyết định (Huỷ / Đóng / Gắn / Giữ)", 18],
  ["ghiChu", "Ghi chú / lý do của bạn", 30],
  ["kind", "Loại đối tượng (không sửa)", 12],
  ["id", "ID (không sửa)", 38],
  ["lineId", "ID dòng (không sửa)", 38],
  ["ganBienBanId", "ID biên bản gắn (có thể sửa)", 38],
  ["xbtIds", "ID phiếu X-BT (không sửa)", 38],
]
const wb = new ExcelJS.Workbook()
wb.creator = "audit-purchase-maintenance"
const readme = wb.addWorksheet("Hướng dẫn")
readme.getColumn(1).width = 120
;[
  `Rà soát Đề nghị mua ↔ Biên bản bảo trì — ${factory.name} — ${todayISO}`,
  "Mỗi dòng là NGHI NGỜ (không phải kết luận chắc chắn). Mở link để xem trước khi quyết định.",
  'Điền cột "Quyết định": Huỷ / Đóng / Gắn / Giữ (để trống = Giữ). Cột "Ghi chú / lý do của bạn" dùng làm lý do khi thực hiện.',
  "Huỷ: phiếu đề nghị ⇒ huỷ phiếu (như nút Huỷ); biên bản ⇒ huỷ biên bản (như nút Hủy biên bản); X-BT mồ côi / biên bản huỷ còn X-BT ⇒ huỷ phiếu xuất (hoàn tồn).",
  "Đóng: chỉ phiếu đề nghị Đang mua (như nút Đóng phiếu). Gắn: dòng gia công / phân bổ ⇒ gắn biên bản ở cột ID biên bản gắn với SL ở cột SL gắn (0 = gỡ).",
  "KHÔNG sửa các cột ID. Script áp dụng: node --env-file=.env.local scripts/apply-audit-decisions.mjs <file> (xem trước) rồi thêm --apply.",
].forEach((t, i) => { readme.getCell(i + 1, 1).value = t; readme.getCell(i + 1, 1).alignment = { wrapText: true } })

const sortRows = (rows) =>
  rows.sort((a, b) => `${a.sub}|${a.ma}|${a.id}|${a.lineId || ""}`.localeCompare(`${b.sub}|${b.ma}|${b.id}|${b.lineId || ""}`))
for (const [key, title] of SHEETS) {
  const ws = wb.addWorksheet(title)
  ws.columns = COLS.map(([k, h, w]) => ({ key: k, header: h, width: w }))
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).alignment = { wrapText: true, vertical: "middle" }
  ws.views = [{ state: "frozen", ySplit: 1 }]
  for (const row of sortRows(groups[key])) {
    const r = ws.addRow({ ...row, quyetDinh: "", ghiChu: "" })
    if (row.link) r.getCell("link").value = { text: row.link, hyperlink: row.link }
    r.alignment = { wrapText: true, vertical: "top" }
  }
  ws.getColumn("quyetDinh").eachCell((c, n) => {
    if (n > 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7D6" } }
  })
}
const outDir = path.resolve(process.cwd(), "..", "rubber-erp-backups")
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `rasoat-de-nghi-bien-ban-${todayISO}.xlsx`)
await wb.xlsx.writeFile(outFile)

console.log("\nTóm tắt (số dòng nghi ngờ):")
for (const [key, title] of SHEETS) {
  const subs = {}
  for (const r of groups[key]) subs[r.sub] = (subs[r.sub] || 0) + 1
  console.log(`  ${title}: ${groups[key].length}${Object.keys(subs).length ? "  — " + Object.entries(subs).map(([s, n]) => `${s}: ${n}`).join(", ") : ""}`)
}
console.log(
  `  (Dữ liệu cũ trước ${XBT_START} — không đưa vào sheet: E2 ${legacy.e2} biên bản, E5 ${legacy.e5} biên bản, E6 bỏ qua ${legacy.e6} biên bản)`,
)
console.log(`\nĐã ghi: ${outFile}`)
