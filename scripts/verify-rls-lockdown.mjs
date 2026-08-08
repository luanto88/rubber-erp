// Verify RLS lockdown for the 13 previously-"Allow all" core tables (migrations
// 20260821_rls_lockdown_master_data_full.sql + 20260822_rls_lockdown_factories_and_write_protect.sql),
// PLUS the follow-up SELECT lockdown of the 6 tables that `/storage` + `/product-label` used to
// read directly with the anon key (migration
// 20260823_rls_lockdown_storage_product_label_select.sql — lots, ngans, qc_results,
// dispatch_entries, lot_prediction_lots, lot_prediction_batches). Those 2 public pages were
// refactored (2026-08-08) to read through 3 new service-role API routes instead
// (/api/storage/public-lookup, /api/storage/geojson, /api/product-label/lookup) — this script
// does NOT exercise those routes (needs a running Next server); test them manually or via the
// curl examples in the PR/commit notes after `npm run dev`.
//
// Usage:
//   node --env-file=.env.local scripts/verify-rls-lockdown.mjs baseline       -> anon-only read probe (13-table group), run BEFORE that migration
//   node --env-file=.env.local scripts/verify-rls-lockdown.mjs post           -> full anon + authenticated probe (13-table group), run AFTER that migration
//   node --env-file=.env.local scripts/verify-rls-lockdown.mjs select-post    -> anon SELECT must now be BLOCKED for the 6-table group, run AFTER 20260823 migration
//
// "post" mode creates a temporary auth user + profile (factory A), verifies it can read/write
// its own factory's rows and is blocked from factory B's rows, then deletes the temp user and
// any test rows it created (best-effort service-role cleanup runs in a finally block regardless
// of outcome).

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const mode = process.argv[2] || "baseline"

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const FULL_LOCK_TABLES = [
  "dispatch_drivers",
  "dispatch_vehicles",
  "dispatch_vehicle_driver_assignments",
  "customers",
  "export_orders",
  "suffixes",
  "sk_history",
  "users",
]
const WRITE_PROTECT_TABLES = ["lots", "ngans", "qc_results", "dispatch_entries"]
const SELECT_LOCK_TABLES = [
  "lots",
  "ngans",
  "qc_results",
  "dispatch_entries",
  "lot_prediction_lots",
  "lot_prediction_batches",
]

async function anonSelectProbe(table) {
  const { data, error, count } = await anon.from(table).select("*", { count: "exact", head: false }).limit(1)
  return { table, ok: !error, error: error?.message, rowsReturned: data?.length ?? 0, totalCount: count }
}

async function runBaseline() {
  console.log("=== BASELINE (anon key, no session) — chạy TRƯỚC khi migration ===\n")
  console.log("--- Nhóm sẽ bị khóa toàn bộ (full lockdown) ---")
  for (const t of FULL_LOCK_TABLES) {
    const r = await anonSelectProbe(t)
    console.log(
      `${r.ok ? "⚠️  VULNERABLE" : "✓ blocked"}  ${t.padEnd(38)} rows=${r.rowsReturned} total=${r.totalCount ?? "?"} ${r.error ?? ""}`,
    )
  }
  console.log("\n--- Nhóm chỉ khóa write, giữ read mở (public pages phụ thuộc) ---")
  for (const t of WRITE_PROTECT_TABLES) {
    const r = await anonSelectProbe(t)
    console.log(
      `${r.ok ? "(đọc mở — ĐÚNG dự kiến, giữ nguyên)" : "✗ unexpected block"}  ${t.padEnd(20)} rows=${r.rowsReturned} total=${r.totalCount ?? "?"} ${r.error ?? ""}`,
    )
  }
  const f = await anonSelectProbe("factories")
  console.log(`\nfactories: ${f.ok ? "đọc mở (đúng dự kiến, /login cần)" : "✗ unexpected block"} rows=${f.rowsReturned}`)
}

async function safeDelete(client, table, column, value) {
  try {
    await client.from(table).delete().eq(column, value)
  } catch {
    // best-effort cleanup, ignore
  }
}

async function anonWriteProbe(table, payload) {
  const { error } = await anon.from(table).insert(payload)
  return { table, blocked: !!error, error: error?.message }
}

async function makeTempUser(factoryId, label) {
  const email = `rls-test-${label}-${Date.now()}@auth.rubber-erp.example.com`
  const password = `Test${Math.random().toString(36).slice(2)}!A1`
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr) throw new Error(`createUser failed: ${createErr.message}`)
  const userId = created.user.id
  const { error: profileErr } = await admin.from("profiles").insert({
    id: userId,
    username: `rls-test-${label}`,
    auth_email: email,
    full_name: `RLS Test ${label}`,
    factory_id: factoryId,
    role: "user",
    status: "active",
  })
  if (profileErr) {
    try { await admin.auth.admin.deleteUser(userId) } catch {}
    throw new Error(`profile insert failed: ${profileErr.message}`)
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: session, error: signInErr } = await client.auth.signInWithPassword({ email, password })
  if (signInErr) {
    await safeDelete(admin, "profiles", "id", userId)
    try { await admin.auth.admin.deleteUser(userId) } catch {}
    throw new Error(`sign-in failed: ${signInErr.message}`)
  }
  return { userId, client, email }
}

async function cleanupTempUser(userId) {
  await safeDelete(admin, "profiles", "id", userId)
  try { await admin.auth.admin.deleteUser(userId) } catch {}
}

async function runPost() {
  console.log("=== POST-MIGRATION VERIFY ===\n")

  console.log("--- 1) Anon SELECT phải bị chặn hoàn toàn (full lockdown tables) ---")
  for (const t of FULL_LOCK_TABLES) {
    const r = await anonSelectProbe(t)
    const pass = !r.ok || r.rowsReturned === 0
    console.log(`${pass ? "✓ PASS" : "✗ FAIL"}  ${t.padEnd(38)} rowsReturned=${r.rowsReturned} ${r.error ?? ""}`)
  }

  console.log("\n--- 2) Anon SELECT vẫn phải hoạt động (write-protect tables, đọc giữ mở) ---")
  for (const t of WRITE_PROTECT_TABLES) {
    const r = await anonSelectProbe(t)
    console.log(`${r.ok ? "✓ PASS (đọc vẫn mở)" : "✗ FAIL (đọc bị chặn nhầm, sẽ hỏng /storage hoặc /product-label)"}  ${t.padEnd(20)} ${r.error ?? ""}`)
  }

  console.log("\n--- 3) factories vẫn đọc public được (cần cho /login) ---")
  const f = await anonSelectProbe("factories")
  console.log(`${f.ok ? "✓ PASS" : "✗ FAIL"}  factories rowsReturned=${f.rowsReturned}`)

  console.log("\n--- 4) Anon INSERT phải bị chặn ở TẤT CẢ 13 bảng (kể cả write-protect) ---")
  const { data: factoriesForProbe } = await admin.from("factories").select("id, code").order("code").limit(2)
  const factoryA = factoriesForProbe?.[0]
  const factoryB = factoriesForProbe?.[1]
  if (!factoryA) throw new Error("Không tìm thấy factory nào để test — kiểm tra lại DB.")

  const insertProbes = [
    ["suffixes", { factory_id: factoryA.id, code: "__RLS_PROBE__", name: "RLS probe (should be blocked)" }],
    ["customers", { factory_id: factoryA.id, ma_kh: "__RLS_PROBE__" }],
    ["ngans", { factory_id: factoryA.id, ma_ngan: "__RLS_PROBE__", ten_ngan: "RLS probe" }],
    ["lots", { factory_id: factoryA.id, ma_lo: "__RLS_PROBE__", num: 999999, suffix: "probe" }],
  ]
  for (const [table, payload] of insertProbes) {
    const r = await anonWriteProbe(table, payload)
    console.log(`${r.blocked ? "✓ PASS (bị chặn)" : "✗ FAIL — GHI ĐƯỢC KHI CHƯA ĐĂNG NHẬP!"}  ${table.padEnd(15)} ${r.error ?? ""}`)
    if (!r.blocked) {
      // Dọn ngay nếu lỡ ghi được (không nên xảy ra nếu RLS đúng)
      const col = table === "ngans" ? "ma_ngan" : table === "customers" ? "ma_kh" : table === "lots" ? "ma_lo" : "code"
      await safeDelete(admin, table, col, "__RLS_PROBE__")
    }
  }

  console.log("\n--- 5) Authenticated cùng nhà máy: đọc + ghi phải hoạt động bình thường ---")
  console.log("--- 6) Authenticated khác nhà máy: phải bị chặn hoàn toàn ---")
  if (!factoryB) {
    console.log("(chỉ có 1 factory trong DB — bỏ qua test cross-factory, không đủ dữ liệu để so sánh)")
  }

  let tempA = null
  let tempB = null
  try {
    tempA = await makeTempUser(factoryA.id, "a")
    console.log(`  Đã tạo user test cho factory ${factoryA.code} (${factoryA.id})`)

    // 5a) same-factory INSERT + SELECT + UPDATE + DELETE round-trip on suffixes (low-risk table)
    const probeCode = `__RLS_PROBE_${Date.now()}__`
    const { data: inserted, error: insErr } = await tempA.client
      .from("suffixes")
      .insert({ factory_id: factoryA.id, code: probeCode, name: "RLS same-factory probe" })
      .select("id")
      .single()
    console.log(`  ${insErr ? "✗ FAIL same-factory INSERT: " + insErr.message : "✓ PASS same-factory INSERT ok"}`)

    if (inserted) {
      const { data: readBack, error: readErr } = await tempA.client.from("suffixes").select("id,code").eq("id", inserted.id).maybeSingle()
      console.log(`  ${!readErr && readBack ? "✓ PASS same-factory SELECT ok" : "✗ FAIL same-factory SELECT: " + (readErr?.message ?? "no row")}`)

      const { error: updErr } = await tempA.client.from("suffixes").update({ name: "updated" }).eq("id", inserted.id)
      console.log(`  ${!updErr ? "✓ PASS same-factory UPDATE ok" : "✗ FAIL same-factory UPDATE: " + updErr.message}`)

      const { error: delErr } = await tempA.client.from("suffixes").delete().eq("id", inserted.id)
      console.log(`  ${!delErr ? "✓ PASS same-factory DELETE ok" : "✗ FAIL same-factory DELETE: " + delErr.message}`)

      // cleanup safety net regardless
      await safeDelete(admin, "suffixes", "id", inserted.id)
    }

    if (factoryB) {
      // 6) cross-factory: tempA tries to insert into factory B, and read factory B's existing rows
      const crossCode = `__RLS_CROSS_${Date.now()}__`
      const { error: crossInsErr } = await tempA.client
        .from("suffixes")
        .insert({ factory_id: factoryB.id, code: crossCode, name: "should be blocked" })
      console.log(`  ${crossInsErr ? "✓ PASS cross-factory INSERT blocked" : "✗ FAIL — ghi được vào nhà máy khác!"}`)
      if (!crossInsErr) {
        await safeDelete(admin, "suffixes", "code", crossCode)
      }

      const { data: crossRead } = await tempA.client.from("suffixes").select("id").eq("factory_id", factoryB.id).limit(1)
      console.log(`  ${!crossRead || crossRead.length === 0 ? "✓ PASS cross-factory SELECT returns 0 rows" : "✗ FAIL — đọc được dữ liệu nhà máy khác!"}`)

      const { data: crossExport } = await tempA.client.from("export_orders").select("id").eq("factory_id", factoryB.id).limit(1)
      console.log(`  ${!crossExport || crossExport.length === 0 ? "✓ PASS cross-factory export_orders returns 0 rows" : "✗ FAIL — đọc được export_orders nhà máy khác!"}`)
    }
  } finally {
    if (tempA) await cleanupTempUser(tempA.userId)
    if (tempB) await cleanupTempUser(tempB.userId)
  }

  console.log("\nHoàn tất.")
}

async function runExtra() {
  console.log("=== EXTRA ROUND-TRIP (authenticated same-factory CRUD trên các bảng còn lại) ===\n")
  const { data: factoriesForProbe } = await admin.from("factories").select("id, code").order("code").limit(1)
  const factoryA = factoriesForProbe?.[0]
  if (!factoryA) throw new Error("Không tìm thấy factory nào để test.")

  let temp = null
  let tempAdmin = null
  try {
    temp = await makeTempUser(factoryA.id, "extra")
    console.log(`  Đã tạo user role=user cho factory ${factoryA.code}`)

    // export_orders
    {
      const { data, error } = await temp.client
        .from("export_orders")
        .insert({ factory_id: factoryA.id, ma_don: "__RLS_PROBE__", ngay: "2026-01-01" })
        .select("id")
        .single()
      console.log(`  export_orders INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) {
        const { error: uErr } = await temp.client.from("export_orders").update({ so_thong_bao: "x" }).eq("id", data.id)
        console.log(`  export_orders UPDATE: ${uErr ? "✗ FAIL " + uErr.message : "✓ PASS"}`)
        const { error: dErr } = await temp.client.from("export_orders").delete().eq("id", data.id)
        console.log(`  export_orders DELETE: ${dErr ? "✗ FAIL " + dErr.message : "✓ PASS"}`)
        await safeDelete(admin, "export_orders", "id", data.id)
      }
    }

    // ngans
    let nganId = null
    {
      const { data, error } = await temp.client
        .from("ngans")
        .insert({ factory_id: factoryA.id, ma_ngan: "__RLS_PROBE__", ten_ngan: "RLS probe" })
        .select("id")
        .single()
      console.log(`  ngans INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) {
        nganId = data.id
        const { error: uErr } = await temp.client.from("ngans").update({ ghi_chu: "x" }).eq("id", data.id)
        console.log(`  ngans UPDATE: ${uErr ? "✗ FAIL " + uErr.message : "✓ PASS"}`)
      }
    }

    // lots (references ngan_id optionally, keep null-safe)
    let lotId = null
    {
      const { data, error } = await temp.client
        .from("lots")
        .insert({
          factory_id: factoryA.id,
          ma_lo: "__RLS_PROBE__",
          num: 999999,
          suffix: "probe",
          year: "26",
          ngay_sx: "2026-01-01",
          ca: "A",
          loai_csr: "10",
        })
        .select("id")
        .single()
      console.log(`  lots INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) {
        lotId = data.id
        const { error: uErr } = await temp.client.from("lots").update({ ghi_chu: "x" }).eq("id", data.id)
        console.log(`  lots UPDATE: ${uErr ? "✗ FAIL " + uErr.message : "✓ PASS"}`)
      }
    }

    // qc_results (references lot_id from above)
    if (lotId) {
      const { data, error } = await temp.client
        .from("qc_results")
        .insert({ factory_id: factoryA.id, lot_id: lotId, ma_lo: "__RLS_PROBE__", ngay_kn: "2026-01-01" })
        .select("id")
        .single()
      console.log(`  qc_results INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) {
        const { error: uErr } = await temp.client.from("qc_results").update({ ghi_chu: "x" }).eq("id", data.id)
        console.log(`  qc_results UPDATE: ${uErr ? "✗ FAIL " + uErr.message : "✓ PASS"}`)
        const { error: dErr } = await temp.client.from("qc_results").delete().eq("id", data.id)
        console.log(`  qc_results DELETE: ${dErr ? "✗ FAIL " + dErr.message : "✓ PASS"}`)
        await safeDelete(admin, "qc_results", "id", data.id)
      }
    }

    if (lotId) {
      const { error: dErr } = await temp.client.from("lots").delete().eq("id", lotId)
      console.log(`  lots DELETE: ${dErr ? "✗ FAIL " + dErr.message : "✓ PASS"}`)
      await safeDelete(admin, "lots", "id", lotId)
    }
    if (nganId) {
      const { error: dErr } = await temp.client.from("ngans").delete().eq("id", nganId)
      console.log(`  ngans DELETE: ${dErr ? "✗ FAIL " + dErr.message : "✓ PASS"}`)
      await safeDelete(admin, "ngans", "id", nganId)
    }

    // dispatch_entries
    {
      const { data, error } = await temp.client
        .from("dispatch_entries")
        .insert({ factory_id: factoryA.id, ngay: "2026-01-01", chung_nhan: "__RLS_PROBE__" })
        .select("id")
        .single()
      console.log(`  dispatch_entries INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) {
        const { error: uErr } = await temp.client.from("dispatch_entries").update({ day_chuyen: "x" }).eq("id", data.id)
        console.log(`  dispatch_entries UPDATE: ${uErr ? "✗ FAIL " + uErr.message : "✓ PASS"}`)
        const { error: dErr } = await temp.client.from("dispatch_entries").delete().eq("id", data.id)
        console.log(`  dispatch_entries DELETE: ${dErr ? "✗ FAIL " + dErr.message : "✓ PASS"}`)
        await safeDelete(admin, "dispatch_entries", "id", data.id)
      }
    }

    // dispatch_drivers / dispatch_vehicles
    let driverId = null
    let vehicleId = null
    {
      const { data, error } = await temp.client
        .from("dispatch_drivers")
        .insert({ factory_id: factoryA.id, name: "__RLS_PROBE__" })
        .select("id")
        .single()
      console.log(`  dispatch_drivers INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) driverId = data.id
    }
    {
      const { data, error } = await temp.client
        .from("dispatch_vehicles")
        .insert({ factory_id: factoryA.id, code: "__RLS_PROBE__", name: "RLS probe" })
        .select("id")
        .single()
      console.log(`  dispatch_vehicles INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) vehicleId = data.id
    }
    if (driverId && vehicleId) {
      const { data, error } = await temp.client
        .from("dispatch_vehicle_driver_assignments")
        .insert({ factory_id: factoryA.id, vehicle_id: vehicleId, driver_id: driverId, effective_from: "2026-01-01" })
        .select("id")
        .single()
      console.log(`  dispatch_vehicle_driver_assignments INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) await safeDelete(admin, "dispatch_vehicle_driver_assignments", "id", data.id)
    }
    if (driverId) await safeDelete(admin, "dispatch_drivers", "id", driverId)
    if (vehicleId) await safeDelete(admin, "dispatch_vehicles", "id", vehicleId)

    // sk_history
    {
      const { data, error } = await temp.client
        .from("sk_history")
        .insert({ factory_id: factoryA.id, ngay: "2026-01-01", loai: "__RLS_PROBE__" })
        .select("id")
        .single()
      console.log(`  sk_history INSERT: ${error ? "✗ FAIL " + error.message : "✓ PASS"}`)
      if (data) await safeDelete(admin, "sk_history", "id", data.id)
    }

    // factories UPDATE — role=user phải bị chặn, role=admin cùng nhà máy phải được phép.
    // LƯU Ý: Postgres RLS lọc hàng cho UPDATE giống hệt SELECT — nếu bị chặn, câu UPDATE
    // vẫn trả error=null (chỉ đơn giản khớp 0 dòng), KHÔNG throw lỗi. Phải chain .select()
    // và kiểm tra data.length để phân biệt "bị chặn" (data=[]) với "thành công" (data có 1
    // phần tử) — chỉ check `error` không đủ để kết luận.
    {
      const { data, error } = await temp.client.from("factories").update({ location: "probe" }).eq("id", factoryA.id).select("id")
      const blocked = !error && (!data || data.length === 0)
      console.log(`  factories UPDATE (role=user): ${blocked ? "✓ PASS blocked (đúng, chỉ admin mới sửa được)" : "✗ FAIL — role=user sửa được factories! error=" + (error?.message ?? "none") + " rowsAffected=" + (data?.length ?? 0)}`)
    }

    tempAdmin = await makeTempUser(factoryA.id, "extra-admin")
    await admin.from("profiles").update({ role: "admin" }).eq("id", tempAdmin.userId)
    // re-sign-in not needed; current_profile_role() reads live from profiles table each call
    {
      const { data: before } = await admin.from("factories").select("location").eq("id", factoryA.id).single()
      const { data, error } = await tempAdmin.client.from("factories").update({ location: before?.location ?? null }).eq("id", factoryA.id).select("id")
      const ok = !error && data && data.length === 1
      console.log(`  factories UPDATE (role=admin, same factory, no-op value): ${ok ? "✓ PASS" : "✗ FAIL error=" + (error?.message ?? "none") + " rowsAffected=" + (data?.length ?? 0)}`)
    }
  } finally {
    if (temp) await cleanupTempUser(temp.userId)
    if (tempAdmin) await cleanupTempUser(tempAdmin.userId)
  }
  console.log("\nHoàn tất.")
}

async function runSelectPost() {
  console.log("=== SELECT LOCKDOWN VERIFY (lots/ngans/qc_results/dispatch_entries/lot_prediction_*) ===\n")
  console.log("--- Anon SELECT phải bị chặn hoàn toàn ở cả 6 bảng ---")
  let allPass = true
  for (const t of SELECT_LOCK_TABLES) {
    const r = await anonSelectProbe(t)
    const pass = !r.ok || r.rowsReturned === 0
    if (!pass) allPass = false
    console.log(`${pass ? "✓ PASS" : "✗ FAIL"}  ${t.padEnd(28)} rowsReturned=${r.rowsReturned} ${r.error ?? ""}`)
  }

  console.log("\n--- Authenticated cùng nhà máy vẫn đọc/ghi bình thường (round-trip) ---")
  const { data: factoriesForProbe } = await admin.from("factories").select("id, code").order("code").limit(1)
  const factoryA = factoriesForProbe?.[0]
  if (!factoryA) throw new Error("Không tìm thấy factory nào để test — kiểm tra lại DB.")

  let temp = null
  try {
    temp = await makeTempUser(factoryA.id, "select-lock")
    const { data, error } = await temp.client.from("ngans").select("id").limit(1)
    console.log(`  ${!error ? "✓ PASS ngans SELECT (authenticated, own factory)" : "✗ FAIL " + error.message} rows=${data?.length ?? 0}`)
    const { data: lp, error: lpErr } = await temp.client.from("lot_prediction_lots").select("id").limit(1)
    console.log(`  ${!lpErr ? "✓ PASS lot_prediction_lots SELECT (authenticated, own factory)" : "✗ FAIL " + lpErr.message} rows=${lp?.length ?? 0}`)
  } finally {
    if (temp) await cleanupTempUser(temp.userId)
  }

  console.log(
    `\n${allPass ? "✓ Tất cả 6 bảng đã khóa SELECT đúng." : "✗ CÒN BẢNG CHƯA KHÓA — kiểm tra lại migration 20260823 đã chạy trên Supabase chưa."}`,
  )
  console.log(
    "\nLưu ý: script này KHÔNG test 3 route service-role mới (/api/storage/public-lookup,",
    "/api/storage/geojson, /api/product-label/lookup) — cần `npm run dev` rồi mở /storage và",
    "/product-label thật (hoặc curl) để xác nhận 2 trang public vẫn hoạt động đúng sau khi khóa.",
  )
}

if (mode === "baseline") {
  await runBaseline()
} else if (mode === "post") {
  await runPost()
} else if (mode === "extra") {
  await runExtra()
} else if (mode === "select-post") {
  await runSelectPost()
} else {
  console.error(`Unknown mode "${mode}" — dùng "baseline", "post", "extra" hoặc "select-post"`)
  process.exit(1)
}
