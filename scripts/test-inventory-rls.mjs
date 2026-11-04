// Test RLS GĐ A (20261107) + GĐ B (20261108 — khoá ghi thẳng tồn, 4 RPC SECURITY DEFINER) cho 13 bảng
// inventory_* — đăng nhập THẬT, gọi đúng thao tác app gọi.
// Dữ liệu test gắn MARK, dọn bằng service role trong finally.
// Chạy: node --env-file=.env.local <file này>   (cwd = gốc repo)
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { createClient } = require("@supabase/supabase-js")

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // phuochoa_kt
const MARK = `RLSINV${Date.now()}`
const opt = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SR, opt)

const TABLES = [
  "inventory_warehouses", "inventory_item_categories", "inventory_items", "inventory_item_warehouse_rules",
  "inventory_stock_balances", "inventory_lot_balances", "inventory_stock_movements", "inventory_oil_stock_pools",
  "inventory_alert_thresholds", "inventory_consumption_norms", "inventory_consumption_norm_lines",
  "inventory_monthly_norm_reports", "inventory_monthly_norm_report_lines",
]

const results = []
const rec = (name, ok, detail = "") => {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 220) : ""}`)
}
const attempt = async (name, fn) => { try { await fn() } catch (e) { rec(name, false, e?.message || String(e)) } }
const cleanups = []

async function signIn(email, password) {
  const c = createClient(URL_, ANON, opt)
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Đăng nhập ${email}: ${error.message}`)
  return { c, uid: data.user.id }
}

async function onHand(whId, itemId) {
  const { data, error } = await admin.from("inventory_stock_balances").select("on_hand")
    .eq("factory_id", FACTORY_ID).eq("warehouse_id", whId).eq("item_id", itemId).maybeSingle()
  if (error) throw error
  return Number(data?.on_hand || 0)
}
async function poolOnHand(whId) {
  const { data, error } = await admin.from("inventory_oil_stock_pools").select("on_hand")
    .eq("factory_id", FACTORY_ID).eq("warehouse_id", whId).maybeSingle()
  if (error) throw error
  return Number(data?.on_hand || 0)
}

async function makeDraft(user, type, { source = null, target = null, item, qty, code }) {
  const { data: doc, error } = await user.c.from("inventory_documents").insert({
    factory_id: FACTORY_ID, document_code: code, document_type: type,
    document_date: new Date().toISOString().slice(0, 10),
    source_warehouse_id: source, target_warehouse_id: target,
    requester_name: MARK, created_by: user.uid, status: "draft", notes: MARK,
  }).select("id").single()
  if (error) throw new Error(`insert phiếu: ${error.message}`)
  cleanups.push(async () => {
    await admin.from("inventory_stock_movements").delete().eq("document_id", doc.id)
    await admin.from("inventory_documents").delete().eq("id", doc.id)
  })
  const { error: le } = await user.c.from("inventory_document_lines").insert({
    factory_id: FACTORY_ID, document_id: doc.id, item_id: item.id, item_code: item.code,
    item_name: item.name, unit: item.unit || "Cái", quantity: qty, line_notes: MARK,
  })
  if (le) throw new Error(`insert dòng: ${le.message}`)
  return doc.id
}

async function main() {
  console.log(`=== Test RLS kho vật tư GĐ A — MARK=${MARK} ===\n`)

  // ── 1. Chưa đăng nhập ───────────────────────────────────────────────
  console.log("--- 1. Chưa đăng nhập (anon key) ---")
  const anon = createClient(URL_, ANON, opt)
  for (const t of TABLES) {
    await attempt(`anon đọc ${t}`, async () => {
      const { data, error } = await anon.from(t).select("id").limit(5)
      if (error) return rec(`anon đọc ${t} bị từ chối`, true, error.code)
      rec(`anon đọc ${t} = 0 dòng`, (data || []).length === 0, `${(data || []).length} dòng`)
    })
  }
  await attempt("anon ghi inventory_item_categories", async () => {
    const { error } = await anon.from("inventory_item_categories").insert({ factory_id: FACTORY_ID, code: MARK.slice(-10) + "A", name: `${MARK}_anon` })
    if (!error) cleanups.push(() => admin.from("inventory_item_categories").delete().eq("name", `${MARK}_anon`))
    rec("anon ghi inventory_item_categories bị chặn", !!error, error?.message || "GHI ĐƯỢC — LỖ HỔNG")
  })

  // ── 2. Đăng nhập ────────────────────────────────────────────────────
  console.log("\n--- 2. Đăng nhập ---")
  const user = await signIn("htho2000@auth.rubber-erp.local", "123456")
  let adm = null; try { adm = await signIn("admin@auth.rubber-erp.local", "nmphk123") } catch (e) { console.log("   (bỏ qua admin: " + e.message + ")") }
  const { data: prof } = await admin.from("profiles").select("factory_id, role").eq("id", user.uid).single()
  rec("htho2000 thuộc phuochoa_kt", prof?.factory_id === FACTORY_ID, `role=${prof?.role}`)

  // ── 3. Đọc đủ dữ liệu nhà máy mình ──────────────────────────────────
  console.log("\n--- 3. Đọc đủ (so số dòng với service role) ---")
  for (const t of TABLES) {
    await attempt(`đọc ${t}`, async () => {
      const [{ count: mine, error: e1 }, { count: real, error: e2 }] = await Promise.all([
        user.c.from(t).select("id", { count: "exact", head: true }).eq("factory_id", FACTORY_ID),
        admin.from(t).select("id", { count: "exact", head: true }).eq("factory_id", FACTORY_ID),
      ])
      if (e1 || e2) throw new Error((e1 || e2).message)
      const { count: noFilter } = await user.c.from(t).select("id", { count: "exact", head: true })
      rec(`htho đọc ${t}: ${mine}/${real} (không lọc factory: ${noFilter})`, mine === real && noFilter === real)
    })
  }

  // ── 4. Chéo nhà máy ─────────────────────────────────────────────────
  console.log("\n--- 4. Chéo nhà máy ---")
  const { data: others } = await admin.from("factories").select("id, code").neq("id", FACTORY_ID).limit(1)
  const other = others?.[0]
  if (!other) rec("Có nhà máy khác để thử chéo", false, "không có")
  else {
    const { count: otherReal } = await admin.from("inventory_items").select("id", { count: "exact", head: true }).eq("factory_id", other.id)
    const { data: seen } = await user.c.from("inventory_items").select("id").eq("factory_id", other.id).limit(5)
    rec(`htho KHÔNG đọc được vật tư nhà máy ${other.code} (thật có ${otherReal})`, (seen || []).length === 0)
    await attempt("ghi chéo nhà máy", async () => {
      const { error } = await user.c.from("inventory_item_categories").insert({ factory_id: other.id, code: MARK.slice(-10) + "X", name: `${MARK}_cross` })
      if (!error) cleanups.push(() => admin.from("inventory_item_categories").delete().eq("name", `${MARK}_cross`))
      rec("htho ghi phân loại cho nhà máy khác bị chặn", !!error, error?.message || "GHI ĐƯỢC — LỖ HỔNG")
    })
  }

  // ── 5. Danh mục: thêm nhanh / sửa / xoá ─────────────────────────────
  console.log("\n--- 5. Danh mục (Cài đặt, thêm nhanh ở phiếu nhập, ngưỡng cảnh báo) ---")
  const { data: wh } = await admin.from("inventory_warehouses").select("id, code").eq("factory_id", FACTORY_ID).eq("code", "KT").maybeSingle()
  let catId, itemId
  await attempt("thêm phân loại", async () => {
    const { data, error } = await user.c.from("inventory_item_categories").insert({ factory_id: FACTORY_ID, code: MARK.slice(-10) + "C", name: `${MARK}_cat` }).select("id").single()
    if (error) throw error
    catId = data.id
    cleanups.push(() => admin.from("inventory_item_categories").delete().eq("id", catId))
    rec("htho thêm phân loại", true)
  })
  await attempt("thêm vật tư + rule kho", async () => {
    const { data, error } = await user.c.from("inventory_items").insert({
      factory_id: FACTORY_ID, code: MARK.slice(-12), name: `${MARK}_item`, unit: "Cái",
      category_id: catId, default_warehouse_ids: wh ? [wh.id] : [],
    }).select("id").single()
    if (error) throw error
    itemId = data.id
    cleanups.unshift(async () => {
      await admin.from("inventory_item_warehouse_rules").delete().eq("item_id", itemId)
      await admin.from("inventory_items").delete().eq("id", itemId)
    })
    if (wh) {
      const { error: re } = await user.c.from("inventory_item_warehouse_rules").insert({ factory_id: FACTORY_ID, item_id: itemId, warehouse_id: wh.id, is_primary: true })
      if (re) throw new Error(`rule: ${re.message}`)
    }
    rec("htho thêm vật tư + rule kho (thêm nhanh ở phiếu nhập)", true)
  })
  await attempt("sửa vật tư", async () => {
    const { data, error } = await user.c.from("inventory_items").update({ specification: "rls-test" }).eq("id", itemId).select("id")
    if (error) throw error
    rec("htho sửa vật tư", data?.length === 1, `${data?.length} dòng`)
  })
  await attempt("upsert ngưỡng cảnh báo", async () => {
    const { error } = await user.c.from("inventory_alert_thresholds")
      .upsert({ factory_id: FACTORY_ID, code: MARK, label: MARK, value: 50, unit: "%" }, { onConflict: "factory_id,code" })
    cleanups.push(() => admin.from("inventory_alert_thresholds").delete().eq("code", MARK))
    if (error) throw error
    rec("htho upsert ngưỡng cảnh báo (Tổng quan kho)", true)
  })
  await attempt("xoá phân loại", async () => {
    const { data: c2, error: e0 } = await user.c.from("inventory_item_categories").insert({ factory_id: FACTORY_ID, code: MARK.slice(-10) + "D", name: `${MARK}_del` }).select("id").single()
    if (e0) throw e0
    const { data, error } = await user.c.from("inventory_item_categories").delete().eq("id", c2.id).select("id")
    if (error) throw error
    rec("htho xoá phân loại", data?.length === 1)
  })

  // ── 6. Ghi sổ / huỷ qua RPC (SECURITY INVOKER) ──────────────────────
  console.log("\n--- 6. Nhập / Chuyển / Xuất / Huỷ qua RPC ---")
  const { data: whs } = await admin.from("inventory_warehouses").select("id, code").eq("factory_id", FACTORY_ID)
  const { data: cand } = await admin.from("inventory_items")
    .select("id, code, name, unit, default_warehouse_ids, manages_lot, uses_shared_oil_stock, la_dich_vu")
    .eq("factory_id", FACTORY_ID).eq("is_active", true).eq("manages_lot", false).eq("uses_shared_oil_stock", false)
    .limit(500)
  const item = (cand || []).find((i) => !i.la_dich_vu && (i.default_warehouse_ids || []).length >= 2)
    || (cand || []).find((i) => !i.la_dich_vu && (i.default_warehouse_ids || []).length >= 1)
  if (!item) { rec("Tìm vật tư thử ghi sổ", false, "không có"); return }
  const w1 = item.default_warehouse_ids[0]
  const w2 = item.default_warehouse_ids[1] || (whs || []).find((w) => w.id !== w1)?.id
  const code = (id) => (whs || []).find((w) => w.id === id)?.code
  console.log(`   Vật tư thử: ${item.code} — kho ${code(w1)} → ${code(w2)}`)
  const base1 = await onHand(w1, item.id)
  const base2 = await onHand(w2, item.id)

  // Không dùng 'base' tồn của dòng chưa có: ghi nhớ dòng tồn nào CHƯA tồn tại để dọn dòng on_hand = 0 phát sinh.
  for (const w of [w1, w2]) {
    const { data: row } = await admin.from("inventory_stock_balances").select("id").eq("factory_id", FACTORY_ID).eq("warehouse_id", w).eq("item_id", item.id).maybeSingle()
    if (!row) cleanups.unshift(async () => {
      await admin.from("inventory_stock_balances").delete().eq("factory_id", FACTORY_ID).eq("warehouse_id", w).eq("item_id", item.id).eq("on_hand", 0)
    })
  }
  // GĐ B: huỷ phiếu cần inventory.cancel | admin ⇒ htho không có quyền thì dùng admin để huỷ.
  const { data: userCanCancel } = await user.c.rpc("current_profile_has_permission", { p_code: "inventory.cancel" })
  const { data: userMaintApprove } = await user.c.rpc("current_profile_has_permission", { p_code: "maintenance.approve" })
  console.log(`   htho: inventory.cancel=${userCanCancel}, maintenance.approve=${userMaintApprove}`)
  const canceller = userCanCancel ? user : adm
  if (!canceller) { rec("Có người huỷ được phiếu (htho có inventory.cancel hoặc đăng nhập được admin)", false); return }
  const rpc = async (fn, args, who = user) => { const { error } = await who.c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`) }
  // 20261110: ghi sổ cần inventory.post | admin. htho lập nháp; ai có quyền ghi sổ (htho hoặc admin) ghi sổ.
  const { data: userCanPost } = await user.c.rpc("current_profile_has_permission", { p_code: "inventory.post" })
  console.log(`   htho: inventory.post=${userCanPost}`)
  const poster = userCanPost ? user : adm
  if (!poster) { rec("Có người ghi sổ được (htho có inventory.post hoặc đăng nhập được admin)", false); return }
  const post = (fn, id) => rpc(fn, { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: poster.uid }, poster)
  const cancelRpc = (id) => rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: id, p_cancelled_by: canceller.uid, p_cancel_reason: MARK }, canceller)
  let impId, trfId, expId
  await attempt("Nhập kho", async () => {
    impId = await makeDraft(user, "import", { target: w1, item, qty: 1, code: `N-${MARK}` })
    await post("inventory_post_import_document", impId)
    const v = await onHand(w1, item.id)
    rec(`Nhập kho ghi sổ: tồn ${code(w1)} ${base1} → ${v}`, v === base1 + 1)
  })
  await attempt("Chuyển kho", async () => {
    trfId = await makeDraft(user, "transfer", { source: w1, target: w2, item, qty: 1, code: `C-${MARK}` })
    await post("inventory_post_transfer_document", trfId)
    const [a, b] = [await onHand(w1, item.id), await onHand(w2, item.id)]
    rec(`Chuyển kho ghi sổ: ${code(w1)}=${a}, ${code(w2)}=${b}`, a === base1 && b === base2 + 1)
  })
  await attempt("Huỷ chuyển kho", async () => {
    await cancelRpc(trfId)
    const [a, b] = [await onHand(w1, item.id), await onHand(w2, item.id)]
    rec(`Huỷ chuyển kho: ${code(w1)}=${a}, ${code(w2)}=${b}`, a === base1 + 1 && b === base2)
  })
  await attempt("Xuất kho", async () => {
    expId = await makeDraft(user, "export", { source: w1, item, qty: 1, code: `X-${MARK}` })
    await post("inventory_post_export_document", expId)
    const v = await onHand(w1, item.id)
    rec(`Xuất kho ghi sổ: tồn ${code(w1)} → ${v}`, v === base1)
  })
  await attempt("Xuất vượt tồn bị chặn", async () => {
    const id = await makeDraft(user, "export", { source: w1, item, qty: base1 + 1000, code: `XV-${MARK}` })
    const { error } = await poster.c.rpc("inventory_post_export_document", { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: poster.uid })
    rec("Xuất vượt tồn bị chặn đúng thông báo", !!error && /vượt tồn|tồn hiện tại/i.test(error.message), error?.message || "KHÔNG BỊ CHẶN")
  })
  await attempt("Huỷ xuất + huỷ nhập", async () => {
    await cancelRpc(expId)
    await cancelRpc(impId)
    const [a, b] = [await onHand(w1, item.id), await onHand(w2, item.id)]
    rec(`Huỷ xuất + huỷ nhập: tồn về ban đầu (${a}/${base1}, ${b}/${base2})`, a === base1 && b === base2)
  })

  // ── 7. Dầu dùng chung bồn ───────────────────────────────────────────
  console.log("\n--- 7. Dầu dùng chung bồn ---")
  const { data: oils } = await admin.from("inventory_items").select("id, code, name, unit, default_warehouse_ids")
    .eq("factory_id", FACTORY_ID).eq("uses_shared_oil_stock", true).eq("is_active", true).limit(50)
  const oil = (oils || []).find((o) => (o.default_warehouse_ids || []).length > 0)
  if (!oil) rec("Có mã dầu dùng chung bồn", false, "không có")
  else {
    const ow = oil.default_warehouse_ids[0]
    const p0 = await poolOnHand(ow)
    await attempt("Nhập + huỷ dầu dùng chung bồn", async () => {
      const id = await makeDraft(user, "import", { target: ow, item: oil, qty: 1, code: `NO-${MARK}` })
      await post("inventory_post_import_document", id)
      const p1 = await poolOnHand(ow)
      await cancelRpc(id)
      const p2 = await poolOnHand(ow)
      rec(`Bồn ${code(ow)} (${oil.code}): ${p0} → ${p1} → ${p2}`, p1 === p0 + 1 && p2 === p0)
    })
  }

  // ── 9. GĐ B (20261108): khoá ghi thẳng tồn / phát sinh ──────────────
  console.log("\n--- 9. GĐ B: ghi thẳng tồn bị chặn, RPC kiểm quyền ---")
  const expectBlocked = async (name, fn) => attempt(name, async () => {
    const { data, error } = await fn()
    const rows = Array.isArray(data) ? data.length : (data ? 1 : 0)
    rec(`${name} bị chặn`, !!error || rows === 0, error?.message || (rows ? `GHI ĐƯỢC ${rows} dòng — LỖ HỔNG` : "0 dòng"))
  })
  const { data: anyBal } = await admin.from("inventory_stock_balances").select("id, on_hand, warehouse_id, item_id").eq("factory_id", FACTORY_ID).limit(1).single()
  await expectBlocked("htho UPDATE inventory_stock_balances", () =>
    user.c.from("inventory_stock_balances").update({ on_hand: 999999 }).eq("id", anyBal.id).select("id"))
  const { data: balAfter } = await admin.from("inventory_stock_balances").select("on_hand").eq("id", anyBal.id).single()
  rec("Tồn không đổi sau khi htho thử UPDATE", Number(balAfter.on_hand) === Number(anyBal.on_hand))
  await expectBlocked("htho INSERT inventory_stock_balances", () =>
    user.c.from("inventory_stock_balances").insert({ factory_id: FACTORY_ID, warehouse_id: w1, item_id: itemId || item.id, on_hand: 5 }).select("id"))
  await expectBlocked("htho DELETE inventory_stock_balances", () =>
    user.c.from("inventory_stock_balances").delete().eq("id", anyBal.id).select("id"))
  await expectBlocked("htho INSERT inventory_stock_movements", () =>
    user.c.from("inventory_stock_movements").insert({
      factory_id: FACTORY_ID, movement_type: "import", warehouse_id: w1, item_id: item.id,
      quantity_in: 1, quantity_out: 0, balance_after: 1, movement_date: new Date().toISOString().slice(0, 10),
    }).select("id"))
  await expectBlocked("htho UPDATE inventory_oil_stock_pools", () =>
    user.c.from("inventory_oil_stock_pools").update({ on_hand: 999999 }).eq("factory_id", FACTORY_ID).select("id"))
  await expectBlocked("htho INSERT inventory_lot_balances", () =>
    user.c.from("inventory_lot_balances").insert({ factory_id: FACTORY_ID, warehouse_id: w1, item_id: item.id, lot_no: MARK, on_hand: 5 }).select("id"))

  const rpcBlocked = async (name, who, fn, args) => attempt(name, async () => {
    const { error } = await who.rpc(fn, args)
    rec(`${name} bị chặn`, !!error, error?.message || "KHÔNG BỊ CHẶN — LỖ HỔNG")
  })
  await rpcBlocked("anon gọi inventory_post_import_document", anon, "inventory_post_import_document",
    { p_factory_id: FACTORY_ID, p_document_id: anyBal.id, p_posted_by: user.uid })

  await attempt("Ghi sổ sai người / sai nhà máy", async () => {
    const id = await makeDraft(user, "import", { target: w1, item, qty: 1, code: `NB-${MARK}` })
    if (adm) await rpcBlocked("htho ghi sổ với p_posted_by = admin", user.c, "inventory_post_import_document",
      { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: adm.uid })
    if (other) await rpcBlocked("htho ghi sổ với p_factory_id nhà máy khác", user.c, "inventory_post_import_document",
      { p_factory_id: other.id, p_document_id: id, p_posted_by: user.uid })
    await rpcBlocked("htho ghi sổ phiếu nhập bằng RPC xuất (sai loại)", user.c, "inventory_post_export_document",
      { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: user.uid })
    rec("Tồn không đổi sau các lần ghi sổ sai", (await onHand(w1, item.id)) === base1)
  })

  if (adm) await attempt("htho ghi sổ phiếu nháp của admin", async () => {
    const id = await makeDraft(adm, "import", { target: w1, item, qty: 1, code: `NA-${MARK}` })
    // 20261110: ai có inventory.post ghi sổ được phiếu nháp của người khác ⇒ chỉ kiểm chặn khi htho KHÔNG có quyền.
    if (!userCanPost) await rpcBlocked("htho (không có inventory.post) ghi sổ phiếu nháp của người khác", user.c, "inventory_post_import_document",
      { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: user.uid })
    await rpc("inventory_post_import_document", { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: adm.uid }, adm)
    rec("Admin ghi sổ phiếu nháp của chính admin", (await onHand(w1, item.id)) === base1 + 1)
    if (!userCanCancel) {
      await rpcBlocked("htho (không có inventory.cancel) huỷ phiếu", user.c, "inventory_cancel_document",
        { p_factory_id: FACTORY_ID, p_document_id: id, p_cancelled_by: user.uid, p_cancel_reason: MARK })
    } else console.log("   (bỏ qua ca 'huỷ không có quyền' — htho đang có inventory.cancel)")
    if (other) await rpcBlocked("admin huỷ với p_factory_id nhà máy khác", adm.c, "inventory_cancel_document",
      { p_factory_id: other.id, p_document_id: id, p_cancelled_by: adm.uid, p_cancel_reason: MARK })
    await rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: id, p_cancelled_by: adm.uid, p_cancel_reason: MARK }, adm)
    rec("Admin huỷ được, tồn về ban đầu", (await onHand(w1, item.id)) === base1)
  })

  // Service role = đường Bảo trì ký biên bản (post_export + cancel) và Đề nghị mua (purchase_receive → post_import).
  const sr = { c: admin, uid: adm?.uid || user.uid }
  await attempt("Service role: nhập (Đề nghị mua) → xuất X-BT (Bảo trì ký) → huỷ (huỷ phê duyệt)", async () => {
    const nId = await makeDraft(sr, "import", { target: w1, item, qty: 2, code: `N-${MARK}-SR` })
    await rpc("inventory_post_import_document", { p_factory_id: FACTORY_ID, p_document_id: nId, p_posted_by: sr.uid }, sr)
    const xId = await makeDraft(sr, "export", { source: w1, item, qty: 1, code: `X-BT-${MARK}` })
    await rpc("inventory_post_export_document", { p_factory_id: FACTORY_ID, p_document_id: xId, p_posted_by: sr.uid }, sr)
    const mid = await onHand(w1, item.id)
    rec(`Service role ghi sổ nhập 2 + xuất X-BT 1: ${base1} → ${mid}`, mid === base1 + 1)
    if (userMaintApprove && !userCanCancel) {
      await rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: xId, p_cancelled_by: user.uid, p_cancel_reason: MARK })
      rec("htho (maintenance.approve) huỷ được phiếu X-BT", true)
    } else {
      await rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: xId, p_cancelled_by: sr.uid, p_cancel_reason: MARK }, sr)
      if (!userMaintApprove) console.log("   (bỏ qua ca 'X-BT + maintenance.approve' — htho không có maintenance.approve)")
    }
    await rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: nId, p_cancelled_by: sr.uid, p_cancel_reason: MARK }, sr)
    rec("Service role huỷ cả 2 phiếu, tồn về ban đầu", (await onHand(w1, item.id)) === base1)
  })

  // ── 10. 20261109: huỷ phiếu nhập/chuyển khi hàng đã xuất đi ⇒ bị chặn (không cho tồn âm) ──
  console.log("\n--- 10. Huỷ phiếu nhập / chuyển sau khi hàng đã xuất ⇒ chặn tồn âm ---")
  await attempt("Nhập 10 → xuất hết → huỷ nhập bị chặn", async () => {
    const b2 = await onHand(w2, item.id)
    const nId = await makeDraft(user, "import", { target: w2, item, qty: 10, code: `NG-${MARK}` })
    await post("inventory_post_import_document", nId)
    const xId = await makeDraft(user, "export", { source: w2, item, qty: b2 + 10, code: `XG-${MARK}` })
    await post("inventory_post_export_document", xId)
    const { error } = await canceller.c.rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: nId, p_cancelled_by: canceller.uid, p_cancel_reason: MARK })
    rec("Huỷ phiếu nhập khi hàng đã xuất hết bị chặn", !!error && /tồn âm/.test(error.message), error?.message || "KHÔNG BỊ CHẶN — tồn âm")
    rec("Thông báo nêu đích danh phiếu xuất đang giữ hàng", !!error && error.message.includes(`XG-${MARK}`), error?.message)
    const { data: st } = await admin.from("inventory_documents").select("status").eq("id", nId).single()
    rec(`Phiếu nhập vẫn 'posted', tồn ${code(w2)} vẫn 0`, st?.status === "posted" && (await onHand(w2, item.id)) === 0)
    // Đúng thứ tự: huỷ xuất trước rồi huỷ nhập ⇒ được.
    await cancelRpc(xId)
    await cancelRpc(nId)
    rec(`Huỷ xuất rồi huỷ nhập: tồn ${code(w2)} về ${b2}`, (await onHand(w2, item.id)) === b2)
  })
  await attempt("Chuyển 1 → xuất hết ở kho đích → huỷ chuyển bị chặn", async () => {
    const b2 = await onHand(w2, item.id)
    const cId = await makeDraft(user, "transfer", { source: w1, target: w2, item, qty: 1, code: `CG-${MARK}` })
    await post("inventory_post_transfer_document", cId)
    const xId = await makeDraft(user, "export", { source: w2, item, qty: b2 + 1, code: `XG2-${MARK}` })
    await post("inventory_post_export_document", xId)
    const { error } = await canceller.c.rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: cId, p_cancelled_by: canceller.uid, p_cancel_reason: MARK })
    rec("Huỷ phiếu chuyển khi kho đích đã xuất hết bị chặn", !!error && /tồn âm/.test(error.message), error?.message || "KHÔNG BỊ CHẶN — tồn âm")
    await cancelRpc(xId)
    await cancelRpc(cId)
    const [a, b] = [await onHand(w1, item.id), await onHand(w2, item.id)]
    rec(`Huỷ xuất rồi huỷ chuyển: ${code(w1)}=${a}/${base1}, ${code(w2)}=${b}/${b2}`, a === base1 && b === b2)
  })
  if (oil) await attempt("Bồn dầu: nhập 1 → xuất hết bồn → huỷ nhập bị chặn", async () => {
    const ow = oil.default_warehouse_ids[0]
    const p0 = await poolOnHand(ow)
    const nId = await makeDraft(user, "import", { target: ow, item: oil, qty: 1, code: `NOG-${MARK}` })
    await post("inventory_post_import_document", nId)
    const xId = await makeDraft(user, "export", { source: ow, item: oil, qty: p0 + 1, code: `XOG-${MARK}` })
    await post("inventory_post_export_document", xId)
    const { error } = await canceller.c.rpc("inventory_cancel_document", { p_factory_id: FACTORY_ID, p_document_id: nId, p_cancelled_by: canceller.uid, p_cancel_reason: MARK })
    rec("Huỷ nhập dầu khi bồn đã xuất hết bị chặn", !!error && /tồn âm/.test(error.message), error?.message || "KHÔNG BỊ CHẶN — bồn âm")
    await cancelRpc(xId)
    await cancelRpc(nId)
    rec(`Bồn ${code(ow)} về ${p0}`, (await poolOnHand(ow)) === p0)
  })

  // ── 11. 20261110: quyền ghi sổ + khoá ghi danh mục theo quyền ──────────
  console.log("\n--- 11. Quyền ghi sổ + khoá danh mục ---")
  const perm = async (code) => (await user.c.rpc("current_profile_has_permission", { p_code: code })).data === true
  const [uCreate, uManage, uInvSettings] = [await perm("inventory.create"), await perm("settings.manage_config"), await perm("inventory.settings")]
  console.log(`   htho: inventory.create=${uCreate}, settings.manage_config=${uManage}, inventory.settings=${uInvSettings}`)
  if (!userCanPost && adm) await attempt("htho không có quyền ghi sổ: lưu nháp được, admin ghi sổ hộ", async () => {
    const id = await makeDraft(user, "import", { target: w1, item, qty: 1, code: `NP-${MARK}` })
    const { error } = await user.c.rpc("inventory_post_import_document", { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: user.uid })
    rec("htho (không có inventory.post) ghi sổ phiếu của chính mình bị chặn", !!error && /quyền ghi sổ/.test(error.message), error?.message || "KHÔNG BỊ CHẶN")
    await rpc("inventory_post_import_document", { p_factory_id: FACTORY_ID, p_document_id: id, p_posted_by: adm.uid }, adm)
    rec("Admin ghi sổ phiếu nháp do htho lập", (await onHand(w1, item.id)) === base1 + 1)
    await cancelRpc(id)
    rec("Huỷ lại, tồn về ban đầu", (await onHand(w1, item.id)) === base1)
  })

  // Danh mục: htho thử ghi; kỳ vọng theo đúng quyền hiệu lực của htho.
  const catCode = `C${MARK.slice(-8)}`
  await attempt("Danh mục: INSERT phân loại (thêm nhanh trên phiếu nhập)", async () => {
    const { data, error } = await user.c.from("inventory_item_categories").insert({ factory_id: FACTORY_ID, code: catCode, name: `${MARK}_cat` }).select("id")
    cleanups.push(() => admin.from("inventory_item_categories").delete().eq("factory_id", FACTORY_ID).eq("code", catCode))
    const ok = !error && (data || []).length === 1
    rec(`htho INSERT phân loại ${uCreate || uManage ? "được" : "bị chặn"}`, ok === (uCreate || uManage), error?.message || `${(data || []).length} dòng`)
  })
  // Đảm bảo có 1 phân loại test để thử sửa/xoá (admin tạo nếu htho không tạo được).
  let { data: catRow } = await admin.from("inventory_item_categories").select("id, name").eq("factory_id", FACTORY_ID).eq("code", catCode).maybeSingle()
  if (!catRow) {
    const r = await admin.from("inventory_item_categories").insert({ factory_id: FACTORY_ID, code: catCode, name: `${MARK}_cat` }).select("id, name").single()
    catRow = r.data
  }
  if (!uManage) {
    await expectBlocked("htho UPDATE phân loại", () => user.c.from("inventory_item_categories").update({ name: `${MARK}_hack` }).eq("id", catRow.id).select("id"))
    await expectBlocked("htho DELETE phân loại", () => user.c.from("inventory_item_categories").delete().eq("id", catRow.id).select("id"))
    await expectBlocked("htho UPDATE vật tư", () => user.c.from("inventory_items").update({ name: item.name }).eq("id", item.id).select("id"))
    await expectBlocked("htho UPDATE kho", () => user.c.from("inventory_warehouses").update({ code: code(w1) }).eq("id", w1).select("id"))
    await expectBlocked("htho INSERT kho", () => user.c.from("inventory_warehouses").insert({ factory_id: FACTORY_ID, code: catCode, name: `${MARK}_wh` }).select("id"))
    cleanups.push(() => admin.from("inventory_warehouses").delete().eq("factory_id", FACTORY_ID).eq("code", catCode))
  } else console.log("   (bỏ qua ca chặn sửa danh mục — htho đang có settings.manage_config)")
  if (!uInvSettings && !uManage) {
    const { data: th } = await admin.from("inventory_alert_thresholds").select("id, value").eq("factory_id", FACTORY_ID).limit(1).maybeSingle()
    if (th) await expectBlocked("htho UPDATE ngưỡng cảnh báo", () => user.c.from("inventory_alert_thresholds").update({ value: th.value }).eq("id", th.id).select("id"))
  }
  if (adm) await attempt("Admin sửa phân loại được", async () => {
    const { data, error } = await adm.c.from("inventory_item_categories").update({ name: `${MARK}_adm` }).eq("id", catRow.id).select("id")
    rec("Admin UPDATE phân loại", !error && (data || []).length === 1, error?.message)
  })

  // ── 8. Admin đọc ────────────────────────────────────────────────────
  if (!adm) return
  console.log("\n--- 8. Admin ---")
  const { count } = await adm.c.from("inventory_stock_movements").select("id", { count: "exact", head: true })
  const { count: real } = await admin.from("inventory_stock_movements").select("id", { count: "exact", head: true }).eq("factory_id", FACTORY_ID)
  rec(`admin đọc phát sinh: ${count}/${real}`, count === real)
}

try { await main() } catch (e) { rec("Lỗi dừng script", false, e?.message || String(e)) }
finally {
  for (const fn of cleanups.reverse()) { try { await fn() } catch { /* bỏ qua */ } }
  const { count: left } = await admin.from("inventory_documents").select("id", { count: "exact", head: true }).eq("notes", MARK)
  console.log(`\nDọn dẹp: còn ${left} phiếu test.`)
  const fail = results.filter((r) => !r.ok)
  console.log(`\nTổng: ${results.length - fail.length} PASS / ${fail.length} FAIL`)
}
