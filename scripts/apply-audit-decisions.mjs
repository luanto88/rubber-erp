// Áp dụng quyết định rà soát Đề nghị mua ↔ Biên bản bảo trì từ file Excel đã điền cột "Quyết định".
//   node --env-file=.env.local scripts/apply-audit-decisions.mjs <file.xlsx> --actor=<uuid admin> [--factory=phuochoa_kt]
//   ... thêm --apply để GHI THẬT (mặc định chỉ in kế hoạch).
// Chỉ xử lý dòng có quyết định Huỷ / Đóng / Gắn; dùng ĐÚNG code server:
//   phiếu đề nghị: cancelPurchaseRequest / closePurchaseRequest (src/lib/purchase/cancel.ts)
//   biên bản: closeMaintenanceRecord (src/lib/maintenance-record-close.ts)
//   phiếu X-BT: reverseMaintenanceStockIssuance (src/lib/maintenance-stock-issuance.ts)
//   gắn biên bản / gỡ phân bổ: RPC purchase_allocate_line + syncMaintenanceExtPricesSafe (như route allocations)
// Sao lưu bản ghi trước khi ghi ra ../rubber-erp-backups/. Không xoá cứng gì, không đụng PDF đã ký.
import { register } from "node:module"
import fs from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"

register(new URL("./_ts-alias-hook.mjs", import.meta.url))

const argv = process.argv.slice(2)
const file = argv.find((a) => !a.startsWith("--"))
const opt = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")))
const APPLY = "apply" in opt
if (!file || !opt.actor) {
  console.error("Dùng: node --env-file=.env.local scripts/apply-audit-decisions.mjs <file.xlsx> --actor=<uuid admin> [--factory=code] [--apply]")
  process.exit(1)
}

const { getSupabaseAdmin } = await import("../src/lib/supabase-admin.ts")
const { cancelPurchaseRequest, closePurchaseRequest, checkPurchaseCancel, loadPurchaseCancelTarget } = await import("../src/lib/purchase/cancel.ts")
const { closeMaintenanceRecord } = await import("../src/lib/maintenance-record-close.ts")
const { reverseMaintenanceStockIssuance } = await import("../src/lib/maintenance-stock-issuance.ts")
const { syncMaintenanceExtPricesSafe } = await import("../src/lib/maintenance-ext-price.ts")

const sb = getSupabaseAdmin()
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())

// ── Người thao tác (admin) + nhà máy ─────────────────────────────────────────────────────
const { data: factory } = await sb.from("factories").select("id, code, name").eq("code", opt.factory || "phuochoa_kt").maybeSingle()
if (!factory) throw new Error("Không tìm thấy nhà máy")
const { data: prof } = await sb.from("profiles").select("id, full_name, role, status, factory_id").eq("id", opt.actor).maybeSingle()
if (!prof || prof.role !== "admin" || prof.status !== "active" || prof.factory_id !== factory.id) {
  throw new Error("--actor phải là tài khoản ADMIN đang hoạt động của đúng nhà máy")
}
const actor = { userId: prof.id, factoryId: factory.id, role: "admin", isAdmin: true }
console.log(`Nhà máy ${factory.name} · người thao tác ${prof.full_name} · ${APPLY ? "GHI THẬT (--apply)" : "CHỈ XEM KẾ HOẠCH"}`)

// ── Đọc Excel ───────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").trim().toLowerCase()
const cellText = (v) => (v && typeof v === "object" ? v.text ?? v.result ?? "" : v ?? "")
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(file)
const tasks = new Map() // key kind|id|action → task
for (const ws of wb.worksheets) {
  const head = {}
  ws.getRow(1).eachCell((c, n) => { head[String(c.value)] = n })
  const col = (name) => Object.keys(head).find((h) => h.startsWith(name))
  const cQD = col("Quyết định"), cKind = col("Loại đối tượng"), cId = col("ID (không sửa)")
  if (!cQD || !cKind || !cId) continue
  ws.eachRow((row, n) => {
    if (n === 1) return
    const get = (h) => (h && col(h) ? String(cellText(row.getCell(head[col(h)]).value)).trim() : "")
    const qd = norm(get("Quyết định"))
    if (!qd || qd === "giu") return
    const action = qd.startsWith("huy") ? "huy" : qd.startsWith("dong") ? "dong" : qd.startsWith("gan") ? "gan" : null
    const base = { sheet: ws.name, row: n, kind: get("Loại đối tượng"), id: get("ID (không sửa)"), ma: get("Mã phiếu"), sub: get("Nhóm con") }
    if (!action) { console.log(`  [BỎ QUA] ${base.sheet} dòng ${n}: quyết định "${get("Quyết định")}" không hiểu`); return }
    const t = {
      ...base, action,
      note: get("Ghi chú / lý do"),
      lineId: get("ID dòng"),
      recordTarget: get("ID biên bản gắn"),
      qty: get("SL gắn"),
      xbtIds: get("ID phiếu X-BT").split(",").filter(Boolean),
    }
    const key = `${t.kind}|${t.id}|${t.action}|${t.lineId}|${t.recordTarget}`
    if (!tasks.has(key)) tasks.set(key, t)
  })
}
// Mâu thuẫn: cùng đối tượng nhưng 2 quyết định khác nhau.
const byObj = new Map()
for (const t of tasks.values()) {
  const k = `${t.kind}|${t.id}`
  const prev = byObj.get(k)
  if (prev && prev.action !== t.action && t.action !== "gan") throw new Error(`Mâu thuẫn quyết định cho ${t.ma} (${prev.action} vs ${t.action}) — sửa file`)
  byObj.set(k, t)
}
const list = Array.from(tasks.values()).sort((a, b) => `${a.sheet}|${a.row}`.localeCompare(`${b.sheet}|${b.row}`))
if (!list.length) { console.log("Không có dòng nào cần xử lý."); process.exit(0) }
const reasonOf = (t) => `${t.note || "Theo danh sách rà soát"} (Rà soát ${today})`

// ── Kế hoạch + kiểm trước ───────────────────────────────────────────────────────────────
async function plan(t) {
  if (t.kind === "purchase" && t.action === "huy") {
    const r = await loadPurchaseCancelTarget(factory.id, t.id)
    if (!r) return "LỖI: không tìm thấy phiếu"
    const denied = await checkPurchaseCancel(actor, r)
    return denied ? `KHÔNG ĐƯỢC: ${denied.message}` : `Huỷ phiếu (đang ${r.trang_thai})`
  }
  if (t.kind === "purchase" && t.action === "dong") {
    const { data: r } = await sb.from("purchase_requests").select("trang_thai").eq("id", t.id).eq("factory_id", factory.id).maybeSingle()
    return r?.trang_thai === "dang_mua" ? "Đóng phiếu" : `KHÔNG ĐƯỢC: chỉ đóng phiếu Đang mua (đang ${r?.trang_thai || "?"})`
  }
  if ((t.kind === "purchase" || t.kind === "allocation") && (t.action === "gan" || (t.kind === "allocation" && t.action === "huy"))) {
    const qty = t.kind === "allocation" && t.action === "huy" ? 0 : Number(String(t.qty).replace(",", "."))
    if (!t.lineId || !t.recordTarget || !Number.isFinite(qty) || qty < 0) return "LỖI: thiếu ID dòng / ID biên bản gắn / SL gắn hợp lệ"
    const { data: rec } = await sb.from("maintenance_records").select("ma_bb, trang_thai").eq("id", t.recordTarget).eq("factory_id", factory.id).maybeSingle()
    if (!rec && qty > 0) return "LỖI: biên bản gắn không tồn tại"
    return qty === 0 ? `Gỡ phân bổ khỏi biên bản ${rec?.ma_bb || t.recordTarget}` : `Gắn ${qty} cho biên bản ${rec.ma_bb} (đang ${rec.trang_thai})`
  }
  if (t.kind === "record" && t.action === "huy") {
    const { data: rec } = await sb.from("maintenance_records").select("ma_bb, trang_thai").eq("id", t.id).eq("factory_id", factory.id).maybeSingle()
    if (!rec) return "LỖI: không tìm thấy biên bản"
    if (rec.trang_thai === "huy") return t.xbtIds.length ? `Huỷ ${t.xbtIds.length} phiếu X-BT (hoàn tồn) của biên bản đã huỷ` : "Bỏ qua: biên bản đã huỷ"
    return `Huỷ biên bản (đang ${rec.trang_thai})`
  }
  if (t.kind === "xbt" && t.action === "huy") {
    const { data: d } = await sb.from("inventory_documents").select("document_code, status").eq("id", t.id).eq("factory_id", factory.id).maybeSingle()
    return d?.status === "posted" ? `Huỷ phiếu xuất ${d.document_code} (hoàn tồn)` : `Bỏ qua: phiếu ${d?.document_code || "?"} không còn ghi sổ`
  }
  return `KHÔNG HỖ TRỢ: ${t.kind} + ${t.action}`
}

const planned = []
for (const t of list) {
  const p = await plan(t)
  planned.push({ t, p })
  console.log(`  ${t.sheet} dòng ${t.row} · ${t.ma} · ${t.action.toUpperCase()} → ${p}`)
}
const runnable = planned.filter((x) => !/^(LỖI|KHÔNG|Bỏ qua)/.test(x.p))
console.log(`\nKế hoạch: ${runnable.length} thao tác chạy được / ${planned.length} dòng có quyết định.`)
if (!APPLY) { console.log("Chưa ghi gì. Xem kỹ rồi chạy lại với --apply."); process.exit(0) }

// ── Sao lưu ─────────────────────────────────────────────────────────────────────────────
const ids = (kind) => runnable.filter((x) => x.t.kind === kind).map((x) => x.t.id)
const pick = async (table, column, values) => {
  const out = []
  const v = Array.from(new Set(values.filter(Boolean)))
  for (let i = 0; i < v.length; i += 200) {
    const { data, error } = await sb.from(table).select("*").in(column, v.slice(i, i + 200))
    if (error) throw new Error(`Sao lưu ${table}: ${error.message}`)
    out.push(...(data || []))
  }
  return out
}
const purchaseIds = ids("purchase")
const recordIds = [...ids("record"), ...runnable.map((x) => x.t.recordTarget)]
const xbtIds = [...ids("xbt"), ...runnable.flatMap((x) => x.t.xbtIds)]
const backup = {
  createdAt: new Date().toISOString(), factory: factory.code, actor: actor.userId, file: path.basename(file),
  tasks: runnable.map((x) => ({ ...x.t, plan: x.p })),
  purchase_requests: await pick("purchase_requests", "id", purchaseIds),
  purchase_request_lines: await pick("purchase_request_lines", "request_id", purchaseIds),
  purchase_line_record_allocations: [
    ...(await pick("purchase_line_record_allocations", "id", ids("allocation"))),
    ...(await pick("purchase_line_record_allocations", "line_id", runnable.map((x) => x.t.lineId))),
  ],
  maintenance_records: await pick("maintenance_records", "id", recordIds),
  maintenance_record_lines: await pick("maintenance_record_lines", "record_id", recordIds),
  maintenance_materials: await pick("maintenance_materials", "record_id", recordIds),
  yeu_cau_ky: await pick("yeu_cau_ky", "ban_ghi_id", [...recordIds, ...purchaseIds]),
  inventory_documents: await pick("inventory_documents", "id", xbtIds),
  inventory_document_lines: await pick("inventory_document_lines", "document_id", xbtIds),
}
const outDir = path.resolve(process.cwd(), "..", "rubber-erp-backups")
fs.mkdirSync(outDir, { recursive: true })
const backupFile = path.join(outDir, `audit-apply-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2))
console.log(`Đã sao lưu: ${backupFile}`)

// ── Thực hiện (từng dòng độc lập — lỗi 1 dòng không dừng các dòng khác) ─────────────────
const results = []
for (const { t } of runnable) {
  try {
    const reason = reasonOf(t)
    if (t.kind === "purchase" && t.action === "huy") {
      await cancelPurchaseRequest({ actor, requestId: t.id, reason, notify: false })
    } else if (t.kind === "purchase" && t.action === "dong") {
      await closePurchaseRequest({ actor, requestId: t.id, reason, notify: false })
    } else if (t.kind === "purchase" || t.kind === "allocation") {
      const qty = t.kind === "allocation" && t.action === "huy" ? 0 : Number(String(t.qty).replace(",", "."))
      const { error } = await sb.rpc("purchase_allocate_line", {
        p_factory_id: factory.id, p_line_id: t.lineId, p_record_id: t.recordTarget, p_qty: qty, p_actor: actor.userId,
      })
      if (error) throw new Error(error.message)
      await syncMaintenanceExtPricesSafe(factory.id, [t.recordTarget])
    } else if (t.kind === "record") {
      const { data: rec } = await sb.from("maintenance_records").select("trang_thai").eq("id", t.id).maybeSingle()
      if (rec?.trang_thai === "huy") {
        await reverseMaintenanceStockIssuance({ factoryId: factory.id, issueDocIds: t.xbtIds, cancelledByUserId: actor.userId, reason })
      } else {
        await closeMaintenanceRecord({ factoryId: factory.id, recordId: t.id, actorId: actor.userId, isAdmin: true, mode: "cancel", reason, actor, notify: false })
      }
    } else if (t.kind === "xbt") {
      await reverseMaintenanceStockIssuance({ factoryId: factory.id, issueDocIds: [t.id], cancelledByUserId: actor.userId, reason })
    }
    results.push({ t, ok: true })
  } catch (err) {
    results.push({ t, ok: false, err: err instanceof Error ? err.message : String(err) })
  }
}

// ── Kiểm lại trạng thái sau khi chạy ────────────────────────────────────────────────────
console.log("\nKết quả:")
for (const r of results) {
  const { t } = r
  let after = ""
  if (t.kind === "purchase" && t.action !== "gan") {
    const { data } = await sb.from("purchase_requests").select("trang_thai").eq("id", t.id).maybeSingle()
    after = `phiếu → ${data?.trang_thai}`
  } else if (t.kind === "purchase" || t.kind === "allocation") {
    const { data } = await sb.from("purchase_line_record_allocations").select("so_luong").eq("line_id", t.lineId).eq("maintenance_record_id", t.recordTarget).maybeSingle()
    after = `phân bổ → ${data ? data.so_luong : "không còn"}`
  } else if (t.kind === "record") {
    const { data } = await sb.from("maintenance_records").select("trang_thai").eq("id", t.id).maybeSingle()
    after = `biên bản → ${data?.trang_thai}`
  }
  const docIds = t.kind === "xbt" ? [t.id] : t.xbtIds
  if (docIds.length) {
    const { data } = await sb.from("inventory_documents").select("document_code, status").in("id", docIds)
    after += ` ${(data || []).map((d) => `${d.document_code}: ${d.status}`).join(", ")}`
  }
  console.log(`  ${r.ok ? "OK " : "LỖI"} ${t.ma} (${t.action}) ${r.ok ? after : `— ${r.err}`}`)
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} thành công. Sao lưu: ${backupFile}`)
