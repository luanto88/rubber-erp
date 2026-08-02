import { createClient } from "@supabase/supabase-js"

// Script điều tra READ-ONLY (không ghi/sửa gì) — user báo "chấm 5S + hoàn thành task cho cnho/ryta
// nhưng Bảng điểm KPI tháng 7/2026 vẫn hiện 'Chưa có điểm cho tháng này'".
// Xem .claude/rules/27-kpi-module.md mục "Cập nhật Phase 4".
//
// Chạy: node --env-file=.env.local scripts/investigate-kpi-no-score.mjs

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  // 1. Bảng kpi_monthly_scores / kpi_score_weights có tồn tại chưa (migration 20260813 đã chạy?)
  console.log("=== 1. Kiểm tra bảng kpi_monthly_scores / kpi_score_weights ===")
  const { error: msErr } = await supabase.from("kpi_monthly_scores").select("id").limit(1)
  const { error: swErr } = await supabase.from("kpi_score_weights").select("id").limit(1)
  console.log("kpi_monthly_scores tồn tại:", !msErr, msErr?.message || "")
  console.log("kpi_score_weights tồn tại:", !swErr, swErr?.message || "")

  // 2. RPC kpi_compute_monthly_scores có tồn tại chưa
  console.log("\n=== 2. Kiểm tra RPC kpi_compute_monthly_scores ===")
  const { data: factories } = await supabase.from("factories").select("id, code, name")
  const factory = factories?.[0]
  console.log("Factory dùng để test:", factory)
  if (factory) {
    const { error: rpcErr } = await supabase.rpc("kpi_compute_monthly_scores", {
      p_factory_id: factory.id,
      p_nam: 2026,
      p_thang: 7,
    })
    console.log("Gọi RPC kết quả lỗi (kỳ vọng lỗi quyền vì dùng service role không có auth.uid()):", rpcErr?.message || "(không lỗi — lạ)")
  }

  // 3. Tìm profile của cnho/ryta
  console.log("\n=== 3. Tìm profiles khớp 'nho'/'ryta' ===")
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, full_name, factory_id, status")
    .or("username.ilike.%nho%,username.ilike.%ryta%,full_name.ilike.%nho%,full_name.ilike.%ryta%")
  console.log(JSON.stringify(profiles, null, 2))

  const userIds = (profiles || []).map((p) => p.id)
  if (userIds.length === 0) {
    console.log("Không tìm thấy profile nào khớp — dừng điều tra ở đây.")
    return
  }

  // 4. kpi_5s_evaluations của họ trong tháng 7/2026 (theo nguoi_don_id)
  console.log("\n=== 4. kpi_5s_evaluations (nguoi_don_id trong danh sách trên, tuan_bat_dau 2026-07) ===")
  const { data: evals, error: evalErr } = await supabase
    .from("kpi_5s_evaluations")
    .select("id, factory_id, location_id, tuan_bat_dau, nguoi_don_id, nguoi_cham_id, ket_qua")
    .in("nguoi_don_id", userIds)
    .gte("tuan_bat_dau", "2026-07-01")
    .lte("tuan_bat_dau", "2026-07-31")
  if (evalErr) console.log("Lỗi:", evalErr.message)
  console.log(JSON.stringify(evals, null, 2))

  // 4b. Toàn bộ kpi_5s_evaluations gần đây (không lọc ngày) để xem tuan_bat_dau thật là bao nhiêu
  console.log("\n=== 4b. Toàn bộ kpi_5s_evaluations của 2 user này (không lọc ngày) ===")
  const { data: evalsAll } = await supabase
    .from("kpi_5s_evaluations")
    .select("id, tuan_bat_dau, nguoi_don_id, nguoi_cham_id, ket_qua")
    .in("nguoi_don_id", userIds)
    .order("tuan_bat_dau", { ascending: false })
  console.log(JSON.stringify(evalsAll, null, 2))

  // 5. kpi_task_members của họ + kpi_tasks.ngay_giao
  console.log("\n=== 5. kpi_task_members + kpi_tasks (is_active=true) của 2 user này ===")
  const { data: members } = await supabase
    .from("kpi_task_members")
    .select("id, task_id, user_id, tien_do, tien_do_nghiem_thu, da_nop_luc, is_active")
    .in("user_id", userIds)
  console.log("kpi_task_members rows:", members?.length)
  const taskIds = [...new Set((members || []).map((m) => m.task_id))]
  if (taskIds.length > 0) {
    const { data: tasks } = await supabase
      .from("kpi_tasks")
      .select("id, tieu_de, ngay_giao, han_hoan_thanh, trang_thai, template_id")
      .in("id", taskIds)
    const taskById = Object.fromEntries((tasks || []).map((t) => [t.id, t]))
    for (const m of members || []) {
      const t = taskById[m.task_id]
      console.log(
        `- user=${m.user_id.slice(0, 8)} task="${t?.tieu_de}" ngay_giao=${t?.ngay_giao} trang_thai=${t?.trang_thai} tien_do=${m.tien_do} tien_do_nghiem_thu=${m.tien_do_nghiem_thu} is_active=${m.is_active}`,
      )
    }
  }

  // 6. kpi_daily_evaluations (D) của họ trong tháng 7
  console.log("\n=== 6. kpi_daily_evaluations trong tháng 7/2026 ===")
  const { data: daily, error: dailyErr } = await supabase
    .from("kpi_daily_evaluations")
    .select("id, user_id, ngay, group_id, loai")
    .in("user_id", userIds)
    .gte("ngay", "2026-07-01")
    .lte("ngay", "2026-07-31")
  if (dailyErr) console.log("Lỗi (có thể bảng chưa tồn tại — migration 20260811 chưa chạy):", dailyErr.message)
  console.log(JSON.stringify(daily, null, 2))

  // 7. kpi_monthly_scores hiện có cho tháng 7/2026 (nếu bảng tồn tại)
  if (!msErr) {
    console.log("\n=== 7. kpi_monthly_scores hiện có cho nam=2026 thang=7 ===")
    const { data: scores } = await supabase
      .from("kpi_monthly_scores")
      .select("*")
      .eq("nam", 2026)
      .eq("thang", 7)
    console.log(JSON.stringify(scores, null, 2))
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
