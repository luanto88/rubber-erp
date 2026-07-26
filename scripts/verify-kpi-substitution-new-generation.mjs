// Script kiểm chứng (tạo + xóa dữ liệu TEST riêng, không đụng dữ liệu thật) cho kịch bản
// "task sinh MỚI khi đăng ký thay thế ĐÃ có hiệu lực từ trước" — case chưa test tay được vì
// không thể chờ tới ngày thật (xem .claude/rules/27-kpi-module.md mục "Cập nhật 2026-07-26
// (tiếp 3)"). Toàn bộ dữ liệu test được dọn sạch ở cuối script (kể cả khi có lỗi giữa chừng).
//
// Chạy: node --env-file=.env.local scripts/verify-kpi-substitution-new-generation.mjs

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const FACTORY_ID = "0268ab41-a564-4538-acf1-6297ac372f57" // phuochoa_kt
const RYTA_ID = "acd6c6ed-64af-435a-85a8-27316105f3f6" // original_user_id
const THO_ID = "a23eab55-7539-4924-906c-d8c457937c81" // substitute_user_id
const LUAN_EMAIL = "luanto@auth.rubber-erp.example.com" // dùng để đăng nhập gọi RPC (auth.uid() thật)
const GROUP_SAN_LUONG = "b6079baa-b25c-41b4-83a4-58fb29e6c2f9" // RyTa primary, Thọ KHÔNG primary

let templateId = null
let subId = null
let createdTaskId = null
let assertions = []

function assert(label, cond, detail) {
  assertions.push({ label, pass: !!cond, detail })
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? " :: " + detail : ""}`)
}

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  const in5days = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)

  // 1. Tạo template TEST — assigned cho RyTa, group = "Nhóm sản lượng" (đúng nhóm chính của RyTa)
  const { data: tpl, error: tplErr } = await admin
    .from("kpi_task_templates")
    .insert({
      factory_id: FACTORY_ID,
      group_id: GROUP_SAN_LUONG,
      assigned_user_id: RYTA_ID,
      tieu_de: "[TEST-KPI-VERIFY] Việc test tạm thời — script tự xóa",
      mo_ta: "Sinh ra bởi verify-kpi-substitution-new-generation.mjs, sẽ bị xóa cuối script.",
      apply_weekdays: [1, 2, 3, 4, 5, 6, 7],
      gio_han: "23:59:00",
      yeu_cau_bao_cao: [],
      is_active: true,
      created_by: RYTA_ID,
    })
    .select("id")
    .single()
  if (tplErr) throw tplErr
  templateId = tpl.id
  console.log("Đã tạo template test:", templateId)

  // 2. Tạo substitution TEST — RyTa → Thọ, phủ đúng hôm nay, CHỈ áp dụng cho template test này
  const { data: sub, error: subErr } = await admin
    .from("kpi_user_substitutions")
    .insert({
      factory_id: FACTORY_ID,
      original_user_id: RYTA_ID,
      substitute_user_id: THO_ID,
      template_id: templateId,
      tu_ngay: today,
      den_ngay: in5days,
      ly_do: "TEST verify — script tự xóa",
      created_by: RYTA_ID,
    })
    .select("id")
    .single()
  if (subErr) throw subErr
  subId = sub.id
  console.log("Đã tạo substitution test:", subId, `(${today} → ${in5days})`)

  // Xác nhận CHƯA có task nào cho template này hôm nay (đúng tiền đề "sinh mới")
  const { data: preExisting, error: preErr } = await admin
    .from("kpi_tasks")
    .select("id")
    .eq("template_id", templateId)
    .eq("ngay_giao", today)
  if (preErr) throw preErr
  assert("Chưa có task nào cho template test hôm nay trước khi gọi RPC", (preExisting || []).length === 0)

  // 3. Đăng nhập thật (magic link + verifyOtp) để có auth.uid() hợp lệ khi gọi RPC
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: LUAN_EMAIL,
  })
  if (linkErr) throw linkErr
  const hashedToken = linkData?.properties?.hashed_token
  if (!hashedToken) throw new Error("Không lấy được hashed_token từ generateLink")

  const anonForVerify = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: verifyData, error: verifyErr } = await anonForVerify.auth.verifyOtp({
    token_hash: hashedToken,
    type: "magiclink",
  })
  if (verifyErr) throw verifyErr
  const accessToken = verifyData?.session?.access_token
  if (!accessToken) throw new Error("Không lấy được access_token sau verifyOtp")
  console.log("Đã đăng nhập thật với user:", verifyData.user?.email, "uid:", verifyData.user?.id)

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  // 4. Gọi đúng RPC thật (không mock) như app sẽ gọi trong bootstrap
  const { data: rpcResult, error: rpcErr } = await asUser.rpc("kpi_ensure_today_task_instances", {
    p_factory_id: FACTORY_ID,
  })
  if (rpcErr) throw rpcErr
  console.log("kpi_ensure_today_task_instances trả về (số task mới sinh, gồm cả 5 template thật nếu có):", rpcResult)
  assert("RPC sinh được ít nhất 1 task mới (bao gồm task test)", (rpcResult ?? 0) >= 1, `rpcResult=${rpcResult}`)

  // 5. Kiểm tra kết quả cho ĐÚNG template test
  const { data: newTasks, error: newTaskErr } = await admin
    .from("kpi_tasks")
    .select("id, ma_cong_viec, tieu_de, ngay_giao, trang_thai")
    .eq("template_id", templateId)
    .eq("ngay_giao", today)
  if (newTaskErr) throw newTaskErr
  assert("Đã sinh đúng 1 task cho template test hôm nay", (newTasks || []).length === 1, JSON.stringify(newTasks))
  createdTaskId = newTasks?.[0]?.id || null

  if (createdTaskId) {
    const { data: members, error: memErr } = await admin
      .from("kpi_task_members")
      .select("user_id, phan_loai, is_active")
      .eq("task_id", createdTaskId)
    if (memErr) throw memErr
    console.log("Thành viên của task vừa sinh:", JSON.stringify(members, null, 2))
    assert("Task được gán đúng 1 thành viên", (members || []).length === 1, JSON.stringify(members))
    const m = members?.[0]
    assert(
      "Thành viên được gán là NGƯỜI THAY THẾ (Thọ), KHÔNG phải người gốc (RyTa)",
      m?.user_id === THO_ID,
      `user_id thực tế = ${m?.user_id}`,
    )
    assert(
      "phan_loai tính đúng theo nhóm chính của NGƯỜI THAY THẾ (Thọ không thuộc chính 'Nhóm sản lượng' → phải là 'choang')",
      m?.phan_loai === "choang",
      `phan_loai thực tế = ${m?.phan_loai}`,
    )
  }
}

async function cleanup() {
  console.log("\n--- Dọn dẹp dữ liệu test ---")
  if (createdTaskId) {
    const { error } = await admin.from("kpi_tasks").delete().eq("id", createdTaskId)
    if (error) console.error("Lỗi xóa task test:", error.message)
    else console.log("Đã xóa task test:", createdTaskId)
  }
  if (subId) {
    const { error } = await admin.from("kpi_user_substitutions").delete().eq("id", subId)
    if (error) console.error("Lỗi xóa substitution test:", error.message)
    else console.log("Đã xóa substitution test:", subId)
  }
  if (templateId) {
    const { error } = await admin.from("kpi_task_templates").delete().eq("id", templateId)
    if (error) console.error("Lỗi xóa template test:", error.message)
    else console.log("Đã xóa template test:", templateId)
  }
}

main()
  .then(async () => {
    await cleanup()
    const failed = assertions.filter((a) => !a.pass)
    console.log(`\n=== KẾT QUẢ: ${assertions.length - failed.length}/${assertions.length} PASS ===`)
    process.exit(failed.length ? 1 : 0)
  })
  .catch(async (err) => {
    console.error("\nLỖI:", err)
    await cleanup()
    process.exit(1)
  })
