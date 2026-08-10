// Test tay thay thế cho "kiểm tra qua trình duyệt thật" — môi trường agent không có công cụ
// điều khiển trình duyệt, nên script này đăng nhập THẬT bằng 4 tài khoản người dùng cung cấp
// (htho2000/nhà máy, admin, phr_vn/customer đã được cấp 4 đơn, kumho/customer chưa được cấp gì)
// qua Supabase Auth, rồi gọi thẳng đúng các thao tác Supabase mà mỗi luồng browser sẽ gọi —
// quick-add tài xế/xe, tạo phiếu điều xe, tạo/sửa ngăn lưu, "Sửa theo ngày" của lot_transactions,
// tạo phiếu KN, tạo đơn xuất + quick-add khách hàng, CRUD danh mục Cài đặt, và các route
// service-role (EUDR reissue, customer-portal orders, resolve-order) qua HTTP thật tới dev
// server đang chạy trên localhost:3000.
//
// Mọi dữ liệu test đều gắn tiền tố MARK (timestamp) để không đụng dữ liệu thật, và được dọn
// sạch trong finally bằng service role — kể cả khi test giữa chừng bị lỗi.
//
// Usage: node --env-file=.env.local scripts/test-manual-rls-flows.mjs

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_BASE_URL = process.env.TEST_APP_BASE_URL || "http://localhost:3000"

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // phuochoa_kt
const MARK = `RLSMANUAL${Date.now()}`
const today = new Date().toISOString().slice(0, 10)

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? "✓ PASS" : "✗ FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 200) : ""}`)
}
async function attempt(name, fn) {
  try {
    await fn()
  } catch (e) {
    record(name, false, e?.message || String(e))
  }
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Đăng nhập thất bại (${email}): ${error.message}`)
  return { client, token: data.session.access_token, userId: data.user.id }
}

async function callApi(path, token, opts = {}) {
  const res = await fetch(`${APP_BASE_URL}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

const cleanupFns = []
const cleanup = (fn) => cleanupFns.push(fn)

async function main() {
  console.log(`=== Test tay RLS bằng tài khoản thật — MARK=${MARK} ===\n`)

  console.log("--- Đăng nhập 4 tài khoản ---")
  const htho = await signIn("htho2000@auth.rubber-erp.local", "123456")
  const adminAcc = await signIn("admin@auth.rubber-erp.local", "admin123")
  const phrVn = await signIn("phr_vn@auth.rubber-erp.example.com", "phr.vn")
  const kumho = await signIn("kumho@auth.rubber-erp.example.com", "kumho123")
  record("Đăng nhập cả 4 tài khoản thành công", true)

  // ═══════════════════════════════════════════════════════════════════════
  // NHÀ MÁY (htho2000) — CRUD trực tiếp giống browser client
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n--- Dispatch (Điều xe): quick-add tài xế / xe, tạo phiếu ---")

  let driverId, vehicleId
  await attempt("Dispatch: quick-add tài xế (insert dispatch_drivers)", async () => {
    const { data, error } = await htho.client
      .from("dispatch_drivers")
      .insert({ factory_id: FACTORY_ID, name: `${MARK}_driver`, phone: "0123456789" })
      .select("id")
      .single()
    if (error) throw error
    driverId = data.id
    cleanup(() => admin.from("dispatch_drivers").delete().eq("id", driverId))
    record("Dispatch: quick-add tài xế (insert dispatch_drivers)", true)
  })

  await attempt("Dispatch: sửa tài xế vừa tạo (update dispatch_drivers)", async () => {
    const { error } = await htho.client.from("dispatch_drivers").update({ phone: "0999999999" }).eq("id", driverId)
    if (error) throw error
    record("Dispatch: sửa tài xế vừa tạo (update dispatch_drivers)", true)
  })

  await attempt("Dispatch: quick-add xe (insert dispatch_vehicles)", async () => {
    const { data, error } = await htho.client
      .from("dispatch_vehicles")
      .insert({ factory_id: FACTORY_ID, code: MARK.slice(-8), name: `${MARK}_vehicle` })
      .select("id")
      .single()
    if (error) throw error
    vehicleId = data.id
    cleanup(() => admin.from("dispatch_vehicles").delete().eq("id", vehicleId))
    record("Dispatch: quick-add xe (insert dispatch_vehicles)", true)
  })

  await attempt("Dispatch: gán tài xế chính cho xe (insert dispatch_vehicle_driver_assignments)", async () => {
    if (!driverId || !vehicleId) throw new Error("thiếu driverId/vehicleId từ bước trước")
    const { data, error } = await htho.client
      .from("dispatch_vehicle_driver_assignments")
      .insert({ factory_id: FACTORY_ID, vehicle_id: vehicleId, driver_id: driverId, effective_from: today, is_current: true })
      .select("id")
      .single()
    if (error) throw error
    cleanup(() => admin.from("dispatch_vehicle_driver_assignments").delete().eq("id", data.id))
    record("Dispatch: gán tài xế chính cho xe (insert dispatch_vehicle_driver_assignments)", true)
  })

  let dispatchEntryId
  await attempt("Dispatch: tạo phiếu điều xe (insert dispatch_entries)", async () => {
    const { data, error } = await htho.client
      .from("dispatch_entries")
      .insert({ factory_id: FACTORY_ID, ngay: today, day_chuyen: "Mủ tạp", rows: [] })
      .select("id")
      .single()
    if (error) throw error
    dispatchEntryId = data.id
    cleanup(() => admin.from("dispatch_entries").delete().eq("id", dispatchEntryId))
    record("Dispatch: tạo phiếu điều xe (insert dispatch_entries)", true)
  })

  await attempt("Dispatch: sửa phiếu điều xe vừa tạo (update dispatch_entries.rows)", async () => {
    const { error } = await htho.client
      .from("dispatch_entries")
      .update({ rows: [{ so_xe: MARK.slice(-6), chuyen: 1 }] })
      .eq("id", dispatchEntryId)
    if (error) throw error
    record("Dispatch: sửa phiếu điều xe vừa tạo (update dispatch_entries.rows)", true)
  })

  console.log("\n--- Storage (Kho nguyên liệu): tạo/sửa ngăn lưu ---")
  let nganId
  await attempt("Storage: tạo ngăn lưu (insert ngans)", async () => {
    const { data, error } = await htho.client
      .from("ngans")
      .insert({
        factory_id: FACTORY_ID,
        ma_ngan: `${MARK}_NGAN`,
        ten_ngan: "RLS Test",
        loai_nl: "Mủ chén",
        trang_thai: "Đang nhận (Cần cập nhật)",
      })
      .select("id")
      .single()
    if (error) throw error
    nganId = data.id
    cleanup(() => admin.from("ngans").delete().eq("id", nganId))
    record("Storage: tạo ngăn lưu (insert ngans)", true)
  })

  await attempt("Storage: sửa ngăn lưu (gán chuyến vào trips[])", async () => {
    const { error } = await htho.client
      .from("ngans")
      .update({ ngay_bd: today, trips: [{ uid: `${MARK}_trip` }] })
      .eq("id", nganId)
    if (error) throw error
    record("Storage: sửa ngăn lưu (gán chuyến vào trips[])", true)
  })

  console.log("\n--- Product (Thành phẩm): tạo lô + \"Sửa theo ngày\" lot_transactions ---")
  let lotId
  await attempt("Product: nhập tay tạo lô thành phẩm (insert lots)", async () => {
    const { data, error } = await htho.client
      .from("lots")
      .insert({
        factory_id: FACTORY_ID,
        ma_lo: `${MARK}TEST/99`,
        num: 900000,
        suffix: "rlstest",
        year: "99",
        ngay_sx: today,
        ca: "A",
        ngan_id: nganId,
        loai_csr: "10",
        kien_a: 10,
        tong_banh: 10,
        tong_kg: 350,
      })
      .select("id")
      .single()
    if (error) throw error
    lotId = data.id
    cleanup(() => admin.from("lots").delete().eq("id", lotId))
    record("Product: nhập tay tạo lô thành phẩm (insert lots)", true)
  })

  let ltId
  const oldNgayNhap = today
  const newNgayNhap = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  await attempt("(fixture, service role) tạo sẵn 1 dòng lot_transactions để test 'Sửa theo ngày'", async () => {
    const { data, error } = await admin
      .from("lot_transactions")
      .insert({ lot_id: lotId, ngan_id: nganId, ca: "A", ngay_nhap: oldNgayNhap, kien_a: 10, so_banh: 10, so_kg: 350 })
      .select("id")
      .single()
    if (error) throw error
    ltId = data.id
    cleanup(() => admin.from("lot_transactions").delete().eq("id", ltId))
  })

  await attempt("Product: \"Sửa theo ngày\" — UPDATE lot_transactions.ngay_nhap trực tiếp từ client", async () => {
    const { data, error, count } = await htho.client
      .from("lot_transactions")
      .update({ ngay_nhap: newNgayNhap })
      .eq("lot_id", lotId)
      .eq("ngay_nhap", oldNgayNhap)
      .select("id")
    if (error) throw error
    if (!data || data.length === 0) throw new Error("update chạy không lỗi nhưng 0 dòng bị ảnh hưởng (RLS âm thầm chặn)")
    record("Product: \"Sửa theo ngày\" — UPDATE lot_transactions.ngay_nhap trực tiếp từ client", true)
  })

  await attempt("Product: trigger update_lot_master_totals vẫn ghi lại được lots.tong_banh dưới role authenticated", async () => {
    const { data, error } = await admin.from("lots").select("tong_banh, updated_at").eq("id", lotId).single()
    if (error) throw error
    if (Number(data.tong_banh) !== 10) throw new Error(`tong_banh sau trigger = ${data.tong_banh}, kỳ vọng 10`)
    record("Product: trigger update_lot_master_totals vẫn ghi lại được lots.tong_banh dưới role authenticated", true)
  })

  console.log("\n--- Quality (Kiểm nghiệm): tạo/sửa phiếu KN ---")
  let qcId
  await attempt("Quality: tạo phiếu kiểm nghiệm (insert qc_results)", async () => {
    const { data, error } = await htho.client
      .from("qc_results")
      .insert({
        factory_id: FACTORY_ID,
        lot_id: lotId,
        ma_lo: `${MARK}TEST/99`,
        ngay_kn: today,
        chung_loai: "Mủ tạp",
        loai_csr: "10",
        so_mau: 6,
        trang_thai: "dat",
      })
      .select("id")
      .single()
    if (error) throw error
    qcId = data.id
    cleanup(() => admin.from("qc_results").delete().eq("id", qcId))
    record("Quality: tạo phiếu kiểm nghiệm (insert qc_results)", true)
  })

  await attempt("Quality: sửa phiếu kiểm nghiệm vừa tạo (update qc_results)", async () => {
    const { error } = await htho.client.from("qc_results").update({ ghi_chu: "RLS manual test" }).eq("id", qcId)
    if (error) throw error
    record("Quality: sửa phiếu kiểm nghiệm vừa tạo (update qc_results)", true)
  })

  console.log("\n--- Export (Xuất hàng): quick-add khách hàng, tạo đơn xuất ---")
  let customerId
  await attempt("Export: quick-add khách hàng (insert customers)", async () => {
    const { data, error } = await htho.client
      .from("customers")
      .insert({ factory_id: FACTORY_ID, ma_kh: `${MARK}_KH`, ten_kh_en: "RLS TEST CUSTOMER" })
      .select("id")
      .single()
    if (error) throw error
    customerId = data.id
    cleanup(() => admin.from("customers").delete().eq("id", customerId))
    record("Export: quick-add khách hàng (insert customers)", true)
  })

  let testOrderId
  await attempt("Export: tạo đơn xuất hàng (insert export_orders)", async () => {
    const { data, error } = await htho.client
      .from("export_orders")
      .insert({ factory_id: FACTORY_ID, ma_don: `${MARK}-XH`, ngay: today, customer_id: customerId, chung_loai: "Mủ tạp" })
      .select("id, public_token")
      .single()
    if (error) throw error
    testOrderId = data.id
    cleanup(() => admin.from("export_orders").delete().eq("id", testOrderId))
    record("Export: tạo đơn xuất hàng (insert export_orders)", true)
  })

  console.log("\n--- Settings: CRUD danh mục (Hậu tố lô) ---")
  let suffixId
  await attempt("Settings: thêm hậu tố lô (insert suffixes)", async () => {
    const { data, error } = await htho.client
      .from("suffixes")
      .insert({ factory_id: FACTORY_ID, code: MARK.slice(-6), name: "RLS test suffix" })
      .select("id")
      .single()
    if (error) throw error
    suffixId = data.id
    cleanup(() => admin.from("suffixes").delete().eq("id", suffixId))
    record("Settings: thêm hậu tố lô (insert suffixes)", true)
  })

  console.log("\n--- factories: UPDATE chỉ admin mới được, htho2000 (role=user) phải bị chặn ---")
  await attempt("factories: htho2000 (role=user) KHÔNG được UPDATE factories (đúng dự kiến bị chặn)", async () => {
    const { data: before } = await admin.from("factories").select("ca_c_ten").eq("id", FACTORY_ID).single()
    const { data, error } = await htho.client
      .from("factories")
      .update({ ca_c_ten: before.ca_c_ten }) // no-op value, chỉ test quyền ghi
      .eq("id", FACTORY_ID)
      .select("id")
    // RLS chặn UPDATE trả error=null nhưng 0 rows — không throw
    const blocked = !!error || !data || data.length === 0
    record("factories: htho2000 (role=user) KHÔNG được UPDATE factories (đúng dự kiến bị chặn)", blocked, error?.message)
  })

  await attempt("factories: admin ĐƯỢC UPDATE factories cùng nhà máy (ghi lại giá trị cũ, không đổi dữ liệu thật)", async () => {
    const { data: before } = await admin.from("factories").select("ca_c_ten").eq("id", FACTORY_ID).single()
    const { data, error } = await adminAcc.client
      .from("factories")
      .update({ ca_c_ten: before.ca_c_ten })
      .eq("id", FACTORY_ID)
      .select("id")
    if (error) throw error
    if (!data || data.length === 0) throw new Error("admin update 0 dòng — RLS chặn nhầm cả admin")
    record("factories: admin ĐƯỢC UPDATE factories cùng nhà máy (ghi lại giá trị cũ, không đổi dữ liệu thật)", true)
  })

  // ═══════════════════════════════════════════════════════════════════════
  // KHÁCH HÀNG — RESTRICTIVE policy phải chặn đọc thẳng 8 bảng chuỗi trace
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n--- Customer (phr_vn/kumho): RESTRICTIVE policy phải chặn đọc thẳng 8 bảng chuỗi trace ---")
  const traceTables = [
    "export_orders",
    "customers",
    "lots",
    "ngans",
    "dispatch_entries",
    "qc_results",
    "forest_plots",
    "dispatch_delivery_points",
  ]
  for (const [label, acc] of [["phr_vn", phrVn], ["kumho", kumho]]) {
    for (const table of traceTables) {
      await attempt(`Customer ${label}: KHÔNG đọc trực tiếp được bảng ${table}`, async () => {
        const { data, error } = await acc.client.from(table).select("id").limit(3)
        const blocked = !!error || !data || data.length === 0
        record(`Customer ${label}: KHÔNG đọc trực tiếp được bảng ${table}`, blocked, error?.message ?? `trả về ${data?.length ?? "?"} dòng`)
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // API route thật qua HTTP (dev server đang chạy localhost:3000)
  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n--- API route thật qua HTTP (${APP_BASE_URL}) ---`)

  await attempt("phr_vn: GET /api/customer-portal/orders trả đúng 4 đơn đã được cấp", async () => {
    const r = await callApi("/api/customer-portal/orders", phrVn.token)
    if (r.status !== 200) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    if (!Array.isArray(r.json.orders) || r.json.orders.length !== 4)
      throw new Error(`kỳ vọng 4 đơn, nhận ${r.json.orders?.length}`)
    record("phr_vn: GET /api/customer-portal/orders trả đúng 4 đơn đã được cấp", true)
    global.__firstGrantedOrder = r.json.orders[0]
  })

  await attempt("kumho: GET /api/customer-portal/orders trả rỗng (chưa được cấp đơn nào)", async () => {
    const r = await callApi("/api/customer-portal/orders", kumho.token)
    if (r.status !== 200) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    if (!Array.isArray(r.json.orders) || r.json.orders.length !== 0)
      throw new Error(`kỳ vọng 0 đơn, nhận ${r.json.orders?.length}`)
    record("kumho: GET /api/customer-portal/orders trả rỗng (chưa được cấp đơn nào)", true)
  })

  const grantedOrderId = global.__firstGrantedOrder?.id
  const grantedOrderCode = global.__firstGrantedOrder?.ma_don

  await attempt("phr_vn: GET /api/customer-portal/orders/[id] xem được chi tiết đơn đã cấp", async () => {
    if (!grantedOrderId) throw new Error("thiếu grantedOrderId từ bước trước")
    const r = await callApi(`/api/customer-portal/orders/${grantedOrderId}`, phrVn.token)
    if (r.status !== 200) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    record("phr_vn: GET /api/customer-portal/orders/[id] xem được chi tiết đơn đã cấp", true)
  })

  await attempt("kumho: GET /api/customer-portal/orders/[id] KHÔNG xem được đơn của phr_vn", async () => {
    if (!grantedOrderId) throw new Error("thiếu grantedOrderId từ bước trước")
    const r = await callApi(`/api/customer-portal/orders/${grantedOrderId}`, kumho.token)
    const blocked = r.status === 403 || r.status === 404
    record("kumho: GET /api/customer-portal/orders/[id] KHÔNG xem được đơn của phr_vn", blocked, `status=${r.status}`)
  })

  await attempt("phr_vn: GET /api/eudr/resolve-order?code=<mã đơn đã cấp> resolve đúng id", async () => {
    if (!grantedOrderCode) throw new Error("thiếu grantedOrderCode")
    const r = await callApi(`/api/eudr/resolve-order?code=${encodeURIComponent(grantedOrderCode)}`, phrVn.token)
    if (r.status !== 200 || r.json?.id !== grantedOrderId) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    record("phr_vn: GET /api/eudr/resolve-order?code=<mã đơn đã cấp> resolve đúng id", true)
  })

  await attempt("phr_vn: resolve-order mã KHÔNG tồn tại -> 404 chung (không lộ thông tin)", async () => {
    const r = await callApi(`/api/eudr/resolve-order?code=${MARK}_NONEXISTENT`, phrVn.token)
    if (r.status !== 404) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    record("phr_vn: resolve-order mã KHÔNG tồn tại -> 404 chung (không lộ thông tin)", true, r.json?.error)
  })

  await attempt("kumho: resolve-order mã có thật (của phr_vn) nhưng chưa được cấp -> CÙNG 404 chung (không lộ tồn tại)", async () => {
    if (!grantedOrderCode) throw new Error("thiếu grantedOrderCode")
    const r = await callApi(`/api/eudr/resolve-order?code=${encodeURIComponent(grantedOrderCode)}`, kumho.token)
    if (r.status !== 404) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    record("kumho: resolve-order mã có thật (của phr_vn) nhưng chưa được cấp -> CÙNG 404 chung (không lộ tồn tại)", true, r.json?.error)
  })

  console.log("\n--- EUDR: cấp lại mã công khai (POST /api/eudr/regenerate-public-token) ---")
  await attempt("htho2000 (role=user, không phải admin) KHÔNG cấp lại được public_token -> 403", async () => {
    if (!testOrderId) throw new Error("thiếu testOrderId")
    const r = await callApi("/api/eudr/regenerate-public-token", htho.token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: testOrderId }),
    })
    if (r.status !== 403) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    record("htho2000 (role=user, không phải admin) KHÔNG cấp lại được public_token -> 403", true, r.json?.error)
  })

  await attempt("admin CẤP LẠI được public_token cho đơn test (cùng nhà máy)", async () => {
    if (!testOrderId) throw new Error("thiếu testOrderId")
    const { data: before } = await admin.from("export_orders").select("public_token").eq("id", testOrderId).single()
    const r = await callApi("/api/eudr/regenerate-public-token", adminAcc.token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: testOrderId }),
    })
    if (r.status !== 200 || !r.json?.public_token) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    if (r.json.public_token === before.public_token) throw new Error("token không đổi")
    record("admin CẤP LẠI được public_token cho đơn test (cùng nhà máy)", true)
  })

  await attempt("kumho (role=customer) KHÔNG cấp lại được public_token -> 403", async () => {
    if (!testOrderId) throw new Error("thiếu testOrderId")
    const r = await callApi("/api/eudr/regenerate-public-token", kumho.token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: testOrderId }),
    })
    if (r.status !== 403) throw new Error(`status=${r.status} ${JSON.stringify(r.json)}`)
    record("kumho (role=customer) KHÔNG cấp lại được public_token -> 403", true, r.json?.error)
  })
}

main()
  .catch((e) => {
    console.error("\nLỗi không lường trước:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    console.log("\n--- Dọn dẹp dữ liệu test ---")
    for (const fn of cleanupFns.reverse()) {
      try {
        await fn()
      } catch (e) {
        console.error("  cleanup lỗi (bỏ qua):", e?.message || e)
      }
    }
    const failed = results.filter((r) => !r.ok)
    console.log(`\n=== KẾT QUẢ: ${results.length - failed.length}/${results.length} PASS ===`)
    if (failed.length) {
      console.log("\nCÁC MỤC FAIL:")
      for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`)
      process.exitCode = 1
    }
  })
