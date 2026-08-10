"use client"

// Tính "việc cần làm" theo module hiện tại cho chuông thông báo (Bell) trong layout.tsx.
// Đây là dữ liệu LIVE-COMPUTED theo route đang đứng — khác hẳn bảng `notifications`
// (push notification thật, persisted, chỉ phục vụ ISO/Văn bản). Không ghi gì vào DB.
//
// Nguyên tắc: tái dùng ĐÚNG công thức/điều kiện nghiệp vụ đã có ở từng trang gốc
// (iso/my-tasks, documents/my-tasks, export/page.tsx, inventory/analytics, quality/page.tsx),
// nhưng viết lại thành query gọn — chỉ SELECT cột cần đếm — thay vì import nguyên page
// component (vốn kéo theo state/effect/UI không liên quan, không có ý nghĩa tái sử dụng ở đây).

import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { getIsoWeekStart } from "@/lib/date-utils"
import { buildEffectiveStockBalances } from "@/app/dashboard/inventory/_components/inventory-stock"
import type {
  InventoryItemOption,
  InventoryStockBalanceRow,
  InventoryOilPoolBalanceRow,
} from "@/app/dashboard/inventory/_components/inventory-data"
import {
  computeKpi5sNextDeadline,
  fetchAllLocationCleanerMemberships,
  fetchLatestKpi5sEvaluationsByLocationIds,
  getEffectiveCleanerIds,
  isKpi5sDeadlineDueSoon,
  isKpi5sDeadlineOverdue,
  type Kpi5sLocation,
} from "@/lib/kpi-5s"
import { fetchPendingSubstitutionsForApprover } from "@/lib/kpi-templates"

export type ModuleTaskItem = {
  label: string
  count: number
  link: string
  // Chỉ set bởi getKpiTasks() — cho phép trang chủ tổng hợp (/dashboard/kpi) nhóm item theo vai
  // trò ("nhan" = việc chính bạn phải làm, "giao" = việc bạn giao/quản lý cần xử lý cho người
  // khác) và cho KpiShell tính badge số trên từng tab, KHÔNG phải suy luận qua chuỗi label dễ vỡ
  // khi label đổi câu chữ. Các module khác (ISO, Văn bản, Xuất hàng...) không set 2 field này —
  // luôn undefined, Bell/widget không đọc tới nên không bị ảnh hưởng.
  role?: "nhan" | "giao"
  tab?: "tasks" | "5s" | "templates" | "appeals"
}
export type ModuleTaskSummary = { moduleLabel: string; items: ModuleTaskItem[] }

function isUnderRoute(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

// Mirror chính xác normalizeText ở export/page.tsx
function normalizeText(value?: string | null): string {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
}

// Mirror chính xác getDaysToExpiry ở inventory/analytics/page.tsx
function getDaysToExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null
  const expiry = new Date(expiryDate)
  if (Number.isNaN(expiry.getTime())) return null
  return Math.ceil((expiry.getTime() - Date.now()) / 86400000)
}

// ── Lô rớt hạng "đang sống" — dùng chung Xuất hàng + Chất lượng ─────────────
// Chỉ tính trong phạm vi lô đang Hoàn thành/Xuất hàng (quyết định đã chốt với người dùng)
// — tránh quét toàn bộ lịch sử qc_results, có thể vượt 1000 dòng theo thời gian
// (xem .claude/rules/04-code-patterns.md mục "Phân trang khi query bảng lớn").
type QcLatestRow = {
  lot_id: string | null
  ma_lo: string
  lan: number | null
  created_at: string
  dat_hang: string | null
  trang_thai: string | null
}

async function getRotHangLotCount(factoryId: string): Promise<number> {
  const { data: lotsData } = await supabase
    .from("lots")
    .select("id")
    .eq("factory_id", factoryId)
    // "Hoan thanh" (khong dau) la gia tri sai do trigger DB cu ghi truoc khi
    // duoc chuan hoa (xem migration 20260708_fix_lot_status_trigger.sql) —
    // giu them de tranh am tham bo sot lo trong khi cho migration duoc ap dung.
    .in("trang_thai", ["Hoàn thành", "Xuất hàng", "Hoan thanh"])
  const lotIds = ((lotsData || []) as { id: string }[]).map((l) => l.id)
  if (lotIds.length === 0) return 0

  const rows: QcLatestRow[] = []
  const CHUNK = 200
  for (let i = 0; i < lotIds.length; i += CHUNK) {
    const chunk = lotIds.slice(i, i + CHUNK)
    const { data } = await supabase
      .from("qc_results")
      .select("lot_id, ma_lo, lan, created_at, dat_hang, trang_thai")
      .in("lot_id", chunk)
    rows.push(...((data || []) as QcLatestRow[]))
  }

  // Dedupe theo lô, giữ kết quả KN mới nhất (lan lớn nhất, rồi created_at mới nhất) — mirror quality/page.tsx
  const latestByLot = new Map<string, QcLatestRow>()
  for (const r of rows) {
    const key = r.lot_id || r.ma_lo
    const existing = latestByLot.get(key)
    const rLan = r.lan || 1
    const exLan = existing?.lan || 1
    if (!existing || rLan > exLan || (rLan === exLan && new Date(r.created_at || 0) > new Date(existing.created_at || 0))) {
      latestByLot.set(key, r)
    }
  }
  return Array.from(latestByLot.values()).filter((r) => r.dat_hang?.endsWith("RH") || r.trang_thai === "khong_dat").length
}

// ── ISO ──────────────────────────────────────────────────────────────────────
// Mirror isMyPendingDoc + logic iso_form_instances ở src/app/dashboard/iso/my-tasks/page.tsx
export async function getIsoTasks(factoryId: string, userId: string): Promise<ModuleTaskSummary> {
  const [{ data: docs }, { data: forms }] = await Promise.all([
    supabase
      .from("iso_documents")
      .select("id, trang_thai, xem_xet_user_id, phe_duyet_user_id, soan_thao_user_id")
      .eq("factory_id", factoryId)
      .or(`xem_xet_user_id.eq.${userId},phe_duyet_user_id.eq.${userId},soan_thao_user_id.eq.${userId}`)
      .in("trang_thai", ["cho_xem_xet", "cho_phe_duyet", "bi_tu_choi_phe_duyet", "tra_ve"]),
    supabase
      .from("iso_form_instances")
      .select("id, trang_thai, nguoi_tao, xem_xet_user_id, phe_duyet_user_id")
      .eq("factory_id", factoryId)
      .or(`nguoi_tao.eq.${userId},xem_xet_user_id.eq.${userId},phe_duyet_user_id.eq.${userId}`)
      .in("trang_thai", ["draft", "cho_xem_xet", "cho_phe_duyet", "tra_ve"]),
  ])

  type IsoDocRow = { trang_thai: string; xem_xet_user_id: string | null; phe_duyet_user_id: string | null; soan_thao_user_id: string | null }
  const docCount = ((docs || []) as IsoDocRow[]).filter(
    (d) =>
      (d.trang_thai === "cho_xem_xet" && d.xem_xet_user_id === userId) ||
      (d.trang_thai === "cho_phe_duyet" && d.phe_duyet_user_id === userId) ||
      (d.trang_thai === "bi_tu_choi_phe_duyet" && d.xem_xet_user_id === userId) ||
      (d.trang_thai === "tra_ve" && d.soan_thao_user_id === userId),
  ).length

  type IsoFormRow = { trang_thai: string; nguoi_tao: string | null; xem_xet_user_id: string | null; phe_duyet_user_id: string | null }
  const formCount = ((forms || []) as IsoFormRow[]).filter((f) => {
    if (f.trang_thai === "draft") return f.nguoi_tao === userId
    if (f.trang_thai === "cho_xem_xet") return f.xem_xet_user_id === userId
    if (f.trang_thai === "cho_phe_duyet") return f.phe_duyet_user_id === userId
    if (f.trang_thai === "tra_ve") return true
    return false
  }).length

  return {
    moduleLabel: "ISO",
    items: [
      { label: "Tài liệu ISO cần xử lý", count: docCount, link: "/dashboard/iso/my-tasks" },
      { label: "Hồ sơ thực hiện cần xử lý", count: formCount, link: "/dashboard/iso/my-tasks" },
    ],
  }
}

// ── Văn bản nội bộ ───────────────────────────────────────────────────────────
// Mirror logic ở src/app/dashboard/documents/my-tasks/page.tsx
type ThuTuKyStep = { step: number; type: "phong_ban" | "ca_nhan"; phong_ban_code?: string; user_id?: string }

async function resolveUserDeptCode(userId: string): Promise<string | null> {
  try {
    const { data: session } = await supabase.auth.getSession()
    const token = session.session?.access_token || ""
    const res = await fetch(`/api/documents/dept-code?userId=${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const json = (await res.json()) as { code: string | null }
      return json.code
    }
  } catch {
    // bỏ qua — không xác định được phòng ban thì chỉ bỏ sót mục "cần ký phòng ban", không lỗi
  }
  return null
}

export async function getDocumentsTasks(factoryId: string, user: SessionUser): Promise<ModuleTaskSummary> {
  const isAdmin = user.role === "admin"
  const deptCode = isAdmin ? null : await resolveUserDeptCode(user.id)

  const { data } = await supabase
    .from("van_ban_documents")
    .select("id, trang_thai, thu_tu_ky_json, buoc_hien_tai, soan_thao_user_id, phe_duyet_user_id")
    .eq("factory_id", factoryId)
    .in("trang_thai", ["draft", "cho_ky_phong_ban", "cho_phe_duyet", "tra_ve"])

  type VanBanRow = { trang_thai: string; thu_tu_ky_json: ThuTuKyStep[] | null; buoc_hien_tai: number; soan_thao_user_id: string | null; phe_duyet_user_id: string | null }
  const docs = (data || []) as VanBanRow[]

  let soanThaoCount = 0
  let kyBuocCount = 0
  let pheDuyetCount = 0
  for (const doc of docs) {
    if (doc.trang_thai === "draft" || doc.trang_thai === "tra_ve") {
      if (isAdmin || doc.soan_thao_user_id === user.id) soanThaoCount++
      continue
    }
    if (doc.trang_thai === "cho_ky_phong_ban") {
      const step = (doc.thu_tu_ky_json || [])[doc.buoc_hien_tai]
      const match =
        isAdmin ||
        (step?.type === "phong_ban" && deptCode === step.phong_ban_code) ||
        (step?.type === "ca_nhan" && step.user_id === user.id)
      if (match) kyBuocCount++
      continue
    }
    // Chỉ đúng người được chỉ định phe_duyet_user_id hoặc admin — không gate theo
    // quyền chung documents.phe_duyet (có thể cấp cho nhiều lãnh đạo khác không phải
    // người được chỉ định trên chính văn bản này).
    if (doc.trang_thai === "cho_phe_duyet" && (isAdmin || doc.phe_duyet_user_id === user.id)) {
      pheDuyetCount++
    }
  }

  return {
    moduleLabel: "Văn bản nội bộ",
    items: [
      { label: "Văn bản cần soạn thảo / gửi ký", count: soanThaoCount, link: "/dashboard/documents/my-tasks" },
      { label: "Văn bản cần ký phòng ban", count: kyBuocCount, link: "/dashboard/documents/my-tasks" },
      { label: "Văn bản cần phê duyệt", count: pheDuyetCount, link: "/dashboard/documents/my-tasks" },
    ],
  }
}

// ── Xuất hàng ────────────────────────────────────────────────────────────────
// Mirror canApproveOrders + EXPORT_ORDER_STATUS_PENDING ở export/page.tsx
const EXPORT_ORDER_APPROVER_TITLES = new Set(["giam doc nha may", "pho giam doc nha may"])

async function canApproveExportOrders(factoryId: string, user: SessionUser): Promise<boolean> {
  if (user.role === "admin") return true
  const fullName = user.full_name?.trim() || ""
  const [byProfile, byName] = await Promise.all([
    supabase.from("maintenance_staff").select("chuc_vu_chinh_quyen")
      .eq("factory_id", factoryId).eq("active", true).eq("profile_id", user.id).maybeSingle(),
    fullName
      ? supabase.from("maintenance_staff").select("chuc_vu_chinh_quyen")
          .eq("factory_id", factoryId).eq("active", true).eq("ten", fullName).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const staffRow =
    (byProfile.data as { chuc_vu_chinh_quyen: string | null } | null) ||
    (byName.data as { chuc_vu_chinh_quyen: string | null } | null)
  return EXPORT_ORDER_APPROVER_TITLES.has(normalizeText(staffRow?.chuc_vu_chinh_quyen))
}

export async function getExportTasks(factoryId: string, user: SessionUser): Promise<ModuleTaskSummary> {
  const [canApprove, rotHangCount] = await Promise.all([
    canApproveExportOrders(factoryId, user),
    getRotHangLotCount(factoryId),
  ])

  const items: ModuleTaskItem[] = []
  if (canApprove) {
    const { count } = await supabase
      .from("export_orders")
      .select("id", { count: "exact", head: true })
      .eq("factory_id", factoryId)
      .eq("trang_thai", "cho_phe_duyet")
    items.push({ label: "Đơn xuất chờ duyệt", count: count || 0, link: "/dashboard/export" })
  }
  items.push({ label: "Lô rớt hạng cần xử lý", count: rotHangCount, link: "/dashboard/export" })

  return { moduleLabel: "Xuất hàng", items }
}

// ── Kho vật tư ───────────────────────────────────────────────────────────────
// "Cần duyệt" ở module này thực ra là "cần ghi sổ" (inventory_documents.status='draft')
// vì module không có bước approve. Cảnh báo tồn thấp/cận hạn mirror alertRows ở
// inventory/analytics/page.tsx — tái dùng buildEffectiveStockBalances (pure function,
// xử lý đúng case "dầu dùng chung bồn") thay vì viết lại logic gộp tồn.
export async function getInventoryTasks(factoryId: string): Promise<ModuleTaskSummary> {
  const [{ count: draftCount }, { data: itemsRaw }, { data: rulesRaw }, { data: balancesRaw }, { data: oilPoolRaw }, { data: lotBalancesRaw }] =
    await Promise.all([
      supabase.from("inventory_documents").select("id", { count: "exact", head: true })
        .eq("factory_id", factoryId).eq("status", "draft"),
      supabase.from("inventory_items")
        .select("id, min_stock, max_stock, manages_expiry, uses_shared_oil_stock, default_warehouse_ids")
        .eq("factory_id", factoryId).eq("is_active", true),
      supabase.from("inventory_item_warehouse_rules")
        .select("item_id, warehouse_id, min_stock, max_stock")
        .eq("factory_id", factoryId),
      supabase.from("inventory_stock_balances")
        .select("warehouse_id, item_id, on_hand")
        .eq("factory_id", factoryId),
      supabase.from("inventory_oil_stock_pools")
        .select("warehouse_id, on_hand")
        .eq("factory_id", factoryId),
      supabase.from("inventory_lot_balances")
        .select("item_id, expiry_date, on_hand")
        .eq("factory_id", factoryId),
    ])

  const items = (itemsRaw || []) as unknown as InventoryItemOption[]
  const effectiveBalances = buildEffectiveStockBalances({
    items,
    stockBalances: (balancesRaw || []) as unknown as InventoryStockBalanceRow[],
    oilPoolBalances: (oilPoolRaw || []) as unknown as InventoryOilPoolBalanceRow[],
  })

  type RuleRow = { item_id: string; warehouse_id: string; min_stock: number | null; max_stock: number | null }
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const ruleMap = new Map(((rulesRaw || []) as RuleRow[]).map((r) => [`${r.item_id}:${r.warehouse_id}`, r]))

  let lowStockCount = 0
  for (const b of effectiveBalances) {
    const item = itemMap.get(b.item_id)
    if (!item) continue
    const rule = ruleMap.get(`${b.item_id}:${b.warehouse_id}`)
    const minStock = Number(rule?.min_stock ?? item.min_stock ?? 0)
    if (minStock > 0 && Number(b.on_hand || 0) < minStock) lowStockCount++
  }

  let expiryCount = 0
  for (const lot of (lotBalancesRaw || []) as { item_id: string; expiry_date: string | null; on_hand: number }[]) {
    if (Number(lot.on_hand || 0) <= 0) continue
    const item = itemMap.get(lot.item_id)
    if (!item?.manages_expiry) continue
    const days = getDaysToExpiry(lot.expiry_date)
    if (days !== null && days <= 30) expiryCount++
  }

  return {
    moduleLabel: "Kho vật tư",
    items: [
      { label: "Phiếu chưa ghi sổ", count: draftCount || 0, link: "/dashboard/inventory/receipts" },
      { label: "Vật tư tồn thấp", count: lowStockCount, link: "/dashboard/inventory/analytics" },
      { label: "Lô sắp/đã hết hạn", count: expiryCount, link: "/dashboard/inventory/analytics" },
    ],
  }
}

// ── Chất lượng ───────────────────────────────────────────────────────────────
export async function getQualityTasks(factoryId: string): Promise<ModuleTaskSummary> {
  const count = await getRotHangLotCount(factoryId)
  return { moduleLabel: "Chất lượng", items: [{ label: "Lô đang rớt hạng", count, link: "/dashboard/quality" }] }
}

// ── 5S — vị trí tôi phụ trách (dọn hoặc chấm) đang quá hạn/sắp đến hạn ──────────────────────
// Chỉ tính vị trí ĐANG ÁP DỤNG và CÓ cấu hình hạn chấm (deadline_weekdays NOT NULL) — mirror
// đúng ngữ nghĩa isKpi5sDeadlineOverdue/DueSoon (vị trí không cấu hình hạn không bao giờ "quá
// hạn"). Số vị trí 5S của 1 nhà máy nhỏ (chục dòng) nên không cần phân trang thêm.
type Kpi5sDeadlineRow = Pick<
  Kpi5sLocation,
  "id" | "nguoi_don_id" | "nguoi_cham_id" | "deadline_weekdays" | "deadline_time" | "deadline_effective_from"
>

async function getKpi5sDueCounts(factoryId: string, userId: string): Promise<{ overdue: number; dueSoon: number }> {
  const weekStart = getIsoWeekStart()
  const [{ data: locRows }, cleanerMap] = await Promise.all([
    supabase
      .from("kpi_5s_locations")
      .select("id, nguoi_don_id, nguoi_cham_id, deadline_weekdays, deadline_time, deadline_effective_from")
      .eq("factory_id", factoryId)
      .eq("is_active", true)
      .not("deadline_weekdays", "is", null),
    fetchAllLocationCleanerMemberships(factoryId),
  ])
  const locs = (locRows || []) as Kpi5sDeadlineRow[]
  const mine = locs.filter((l) => l.nguoi_cham_id === userId || getEffectiveCleanerIds(l, cleanerMap).includes(userId))
  if (mine.length === 0) return { overdue: 0, dueSoon: 0 }

  const latestMap = await fetchLatestKpi5sEvaluationsByLocationIds(mine.map((l) => l.id))
  let overdue = 0
  let dueSoon = 0
  for (const loc of mine) {
    const hasEvaluatedThisWeek = latestMap.get(loc.id)?.tuan_bat_dau === weekStart
    const deadline = computeKpi5sNextDeadline(loc)
    if (isKpi5sDeadlineOverdue(deadline, hasEvaluatedThisWeek)) overdue++
    else if (isKpi5sDeadlineDueSoon(deadline, hasEvaluatedThisWeek)) dueSoon++
  }
  return { overdue, dueSoon }
}

// ── Khiếu nại — chỉ đếm cho admin/kpi.manage_config (đúng phạm vi thật sự XỬ LÝ được, khác
// RLS kpi_appeals_select vốn còn cho chủ khiếu nại thấy CỦA CHÍNH HỌ dù họ không giải quyết được).
async function getKpiAppealsPendingCount(factoryId: string): Promise<number> {
  const { count } = await supabase
    .from("kpi_appeals")
    .select("id", { count: "exact", head: true })
    .eq("factory_id", factoryId)
    .eq("trang_thai", "cho_xu_ly")
  return count || 0
}

// ── Công việc & KPI ──────────────────────────────────────────────────────────
// Chỉ tính trên các task còn "sống" (chưa hoàn thành/hủy) — bảng kpi_tasks không có khả
// năng vượt 1000 dòng ở phạm vi "đang mở" của 1 nhà máy nên không cần phân trang thêm.
// Ngưỡng "sắp đến hạn" cố định KPI_DUE_SOON_HOURS giờ trước hạn (đã chốt: chỉ badge Bell,
// không kênh chủ động Telegram/Email — xem .claude/rules/27-kpi-module.md).
type KpiTaskRow = { id: string; trang_thai: string; han_hoan_thanh: string; nguoi_giao_id: string }

export async function getKpiTasks(factoryId: string, user: SessionUser): Promise<ModuleTaskSummary> {
  const isAdmin = user.role === "admin"
  const nowMs = Date.now()
  const soonCutoffMs = nowMs + 24 * 3600_000
  const canResolveAppeals = isAdmin || hasPermission(user, "kpi.manage_config")

  const [{ data: memberRows }, { data: taskRows }, { count: transferCount }, kpi5sDue, pendingSubs, appealsPendingCount] = await Promise.all([
    supabase.from("kpi_task_members").select("task_id").eq("user_id", user.id).eq("is_active", true),
    supabase
      .from("kpi_tasks")
      .select("id, trang_thai, han_hoan_thanh, nguoi_giao_id")
      .eq("factory_id", factoryId)
      .in("trang_thai", ["moi_giao", "dang_thuc_hien", "cho_nghiem_thu", "tra_ve"]),
    // Phase 1b — Chuyển giao việc: lời mời đang chờ TÔI phản hồi (chưa phải active member nên
    // không lọt qua vòng lặp tasks bên dưới) — xem migration 20260727_kpi_task_transfers.sql.
    supabase
      .from("kpi_task_transfers")
      .select("id", { count: "exact", head: true })
      .eq("den_nguoi_id", user.id)
      .eq("trang_thai", "cho_duyet"),
    // Gộp thêm tín hiệu từ 3 tab còn lại (5S, Việc định kỳ, Khiếu nại) — trước đây Bell chỉ
    // biết về tab "Công việc chuyên môn", khiến người dùng phải tự mở từng tab mới biết có việc
    // 5S/khiếu nại/duyệt thay thế đang chờ hay không (xem .claude/rules/27-kpi-module.md).
    getKpi5sDueCounts(factoryId, user.id),
    fetchPendingSubstitutionsForApprover(user.id, factoryId),
    canResolveAppeals ? getKpiAppealsPendingCount(factoryId) : Promise.resolve(0),
  ])

  const myActiveTaskIds = new Set((memberRows || []).map((r: { task_id: string }) => r.task_id))
  const tasks = (taskRows || []) as KpiTaskRow[]

  let pendingCount = 0
  let approvalCount = 0
  // Tách riêng theo vai trò (2026-08-19) — trước đây "sắp đến hạn"/"quá hạn" gộp chung
  // iAmMember||iAmGiver vào 1 số duy nhất, không phân biệt được đó là việc TÔI phải làm hay việc
  // TÔI GIAO đang trễ ở người khác. Trang chủ tổng hợp (/dashboard/kpi) cần tách rõ 2 khối
  // "Cần bạn LÀM" / "Cần bạn DUYỆT-XỬ LÝ" nên phải tách ngay từ đây, không suy luận qua label.
  let dueSoonMineCount = 0
  let overdueMineCount = 0
  let dueSoonGivenCount = 0
  let overdueGivenCount = 0

  for (const t of tasks) {
    const iAmMember = myActiveTaskIds.has(t.id)
    const iAmGiver = t.nguoi_giao_id === user.id
    if (iAmMember && (t.trang_thai === "moi_giao" || t.trang_thai === "dang_thuc_hien" || t.trang_thai === "tra_ve")) {
      pendingCount++
    }
    if (t.trang_thai === "cho_nghiem_thu" && (iAmGiver || isAdmin)) {
      approvalCount++
    }
    const dueMs = new Date(t.han_hoan_thanh).getTime()
    if (!Number.isNaN(dueMs)) {
      const overdue = dueMs < nowMs
      const dueSoon = !overdue && dueMs <= soonCutoffMs
      if (iAmMember) {
        if (overdue) overdueMineCount++
        else if (dueSoon) dueSoonMineCount++
      }
      if (iAmGiver) {
        if (overdue) overdueGivenCount++
        else if (dueSoon) dueSoonGivenCount++
      }
    }
  }

  // approvalCount gồm cả task admin không phải nguoi_giao_id (admin thấy toàn bộ hàng chờ
  // duyệt) — link phải trỏ tab "all" cho admin, nếu không bấm vào tab "mine" sẽ không thấy
  // đúng việc đó (task đó không thuộc "của họ" theo nghĩa thành viên/người giao).
  const approvalLink = isAdmin ? "/dashboard/kpi/tasks?tab=all" : "/dashboard/kpi/tasks?tab=mine"

  return {
    moduleLabel: "Công việc & KPI",
    items: [
      { label: "Việc cần cập nhật/nộp", count: pendingCount, link: "/dashboard/kpi/tasks?tab=mine", role: "nhan", tab: "tasks" },
      { label: "Việc của bạn sắp đến hạn (24h)", count: dueSoonMineCount, link: "/dashboard/kpi/tasks?tab=mine", role: "nhan", tab: "tasks" },
      { label: "Việc của bạn đã quá hạn", count: overdueMineCount, link: "/dashboard/kpi/tasks?tab=mine", role: "nhan", tab: "tasks" },
      { label: "Lời mời chuyển giao chờ phản hồi", count: transferCount || 0, link: "/dashboard/kpi/tasks?tab=mine", role: "nhan", tab: "tasks" },
      { label: "Vị trí 5S đã quá hạn", count: kpi5sDue.overdue, link: "/dashboard/kpi/5s", role: "nhan", tab: "5s" },
      { label: "Vị trí 5S sắp đến hạn (24h)", count: kpi5sDue.dueSoon, link: "/dashboard/kpi/5s", role: "nhan", tab: "5s" },
      { label: "Việc chờ nghiệm thu", count: approvalCount, link: approvalLink, role: "giao", tab: "tasks" },
      { label: "Việc bạn giao đã quá hạn", count: overdueGivenCount, link: "/dashboard/kpi/tasks?tab=mine", role: "giao", tab: "tasks" },
      { label: "Việc bạn giao sắp đến hạn (24h)", count: dueSoonGivenCount, link: "/dashboard/kpi/tasks?tab=mine", role: "giao", tab: "tasks" },
      { label: "Đăng ký thay thế chờ bạn duyệt", count: pendingSubs.length, link: "/dashboard/kpi/templates", role: "giao", tab: "templates" },
      { label: "Khiếu nại chờ xử lý", count: appealsPendingCount, link: "/dashboard/kpi/appeals", role: "giao", tab: "appeals" },
    ],
  }
}

// ── Entry point — switch theo tiền tố route hiện tại ───────────────────────
export async function getModuleTasks(
  pathname: string,
  factoryId: string,
  user: SessionUser,
): Promise<ModuleTaskSummary | null> {
  if (isUnderRoute(pathname, "/dashboard/iso")) return getIsoTasks(factoryId, user.id)
  if (isUnderRoute(pathname, "/dashboard/documents")) return getDocumentsTasks(factoryId, user)
  if (isUnderRoute(pathname, "/dashboard/export")) return getExportTasks(factoryId, user)
  if (isUnderRoute(pathname, "/dashboard/inventory")) return getInventoryTasks(factoryId)
  if (isUnderRoute(pathname, "/dashboard/quality") || isUnderRoute(pathname, "/dashboard/quality-analytics")) {
    return getQualityTasks(factoryId)
  }
  if (isUnderRoute(pathname, "/dashboard/kpi")) return getKpiTasks(factoryId, user)
  return null
}
