// GĐ3b — Thống kê chu kỳ sửa chữa / bảo dưỡng của 1 thiết bị hoặc xe. Hàm THUẦN (client + server).
// Quy ước người dùng chốt 2026-11-07 (docs/qr-equipment-plan.md mục GĐ3b):
// - Chu kỳ sửa chữa = giữa 2 lần Sửa chữa liên tiếp, bất kể Lớn/Nhỏ, bất kể đã duyệt hay chưa
//   (bỏ "huy"/"tu_choi"); nhiều biên bản cùng ngày = 1 lần.
// - Sản lượng mỗi chu kỳ = [ngày sửa trước, ngày sửa sau], TÍNH CẢ 2 ĐẦU (thống kê tương đối).
// - Bảo dưỡng: chỉ thống kê theo thời gian (không sản lượng).
// - Giờ máy (xe nâng / xe xúc): chỉ khi CẢ 2 đầu chu kỳ đều ghi đồng hồ và hiệu > 0.

export type EquipmentOutputKind =
  | "tp_mu_tap" // thành phẩm Mủ tạp toàn nhà máy
  | "tp_mu_nuoc" // thành phẩm Mủ nước toàn nhà máy
  | "xe_nang" // chỉ giờ
  | "xe_xuc" // giờ + nguyên liệu mủ tạp tươi toàn nhà máy (Điều xe)
  | "xe_van_chuyen" // tấn tươi xe đó chở (Điều xe)
  | "none"

export const OUTPUT_LABEL: Record<EquipmentOutputKind, string | null> = {
  tp_mu_tap: "Thành phẩm Mủ tạp (toàn nhà máy)",
  tp_mu_nuoc: "Thành phẩm Mủ nước (toàn nhà máy)",
  xe_nang: null,
  xe_xuc: "Nguyên liệu mủ tạp tươi nhập về (toàn nhà máy)",
  xe_van_chuyen: "Khối lượng tươi xe đã chở",
  none: null,
}

/** Bộ phận (máy móc) → loại sản lượng. */
export function outputKindForAsset(boPhan: string | null | undefined): EquipmentOutputKind {
  if (boPhan === "Mủ tạp") return "tp_mu_tap"
  if (boPhan === "Mủ nước") return "tp_mu_nuoc"
  return "none"
}

function norm(s: string | null | undefined) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** `dispatch_vehicles.vehicle_type` → loại sản lượng. X03 "Xúc Biomass" theo Biomass ⇒ none. */
export function outputKindForVehicle(vehicleType: string | null | undefined): EquipmentOutputKind {
  const t = norm(vehicleType)
  if (!t) return "none"
  if (t.includes("xuc")) return t.includes("biomass") ? "none" : "xe_xuc"
  if (t.includes("nang")) return "xe_nang"
  if (t.includes("ban tai") || t.includes("thue ngoai")) return "none"
  if (t.includes("van chuyen") || t.includes("noi bo") || t.includes("tai 20") || t === "cozon") return "xe_van_chuyen"
  return "none"
}

export function kindHasHours(kind: EquipmentOutputKind) {
  return kind === "xe_nang" || kind === "xe_xuc"
}

/** 1 biên bản (đã gộp các dòng của CÙNG thiết bị trong biên bản đó). */
export type EquipmentStatsEvent = {
  record_id: string
  ma_bb: string | null
  ngay: string // YYYY-MM-DD
  hang_muc: "Sửa chữa" | "Bảo dưỡng"
  trang_thai: string
  loai_sua_chua: string | null
  /** Số đồng hồ (Km/giờ) lớn nhất ghi trên các dòng của thiết bị; null nếu không ghi. */
  dong_ho: number | null
  /** Khoá nhóm vật tư (gom như tab Vật tư) — để lọc "theo vật tư". */
  material_keys: string[]
  material_names: string[]
  /** Chỉ có khi được xem giá. */
  costs?: { loai_tien: string; amount: number }[]
}

export type EquipmentStatsMaterialOption = { key: string; name: string; times: number }

export type EquipmentStatsResponse = {
  kind: EquipmentOutputKind
  outputLabel: string | null
  today: string
  events: EquipmentStatsEvent[]
  /** Sản lượng theo ngày [YYYY-MM-DD, kg] — chỉ ngày có số; rỗng khi kind không có sản lượng. */
  daily: [string, number][]
  materials: EquipmentStatsMaterialOption[]
  canSeeCost: boolean
}

const DAY_MS = 86_400_000

export function dayIndex(iso: string): number {
  return Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS)
}

export function addDaysIso(iso: string, days: number) {
  return new Date((dayIndex(iso) + days) * DAY_MS).toISOString().slice(0, 10)
}

/** Gộp các biên bản cùng ngày thành 1 "lần". */
export type StatsOccasion = {
  ngay: string
  events: EquipmentStatsEvent[]
  dong_ho: number | null
  material_names: string[]
  pending: boolean
  lon: boolean
}

export function groupOccasions(events: EquipmentStatsEvent[]): StatsOccasion[] {
  const byDay = new Map<string, EquipmentStatsEvent[]>()
  for (const e of events) {
    const list = byDay.get(e.ngay) || []
    list.push(e)
    byDay.set(e.ngay, list)
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ngay, evs]) => {
      const meters = evs.map((e) => e.dong_ho).filter((v): v is number => v != null && v > 0)
      return {
        ngay,
        events: evs,
        dong_ho: meters.length ? Math.max(...meters) : null,
        material_names: [...new Set(evs.flatMap((e) => e.material_names))],
        pending: evs.some((e) => e.trang_thai !== "da_duyet"),
        lon: evs.some((e) => e.loai_sua_chua === "lon"),
      }
    })
}

export type StatsCycle = {
  from: StatsOccasion
  to: StatsOccasion
  days: number
  /** kg trong [from, to] cả 2 đầu; null khi loại thiết bị không có sản lượng. */
  output: number | null
  /** Giờ máy = hiệu đồng hồ; null nếu thiếu 1 đầu / hiệu ≤ 0 / loại không theo giờ. */
  hours: number | null
}

export type StatsOpenCycle = { from: StatsOccasion; days: number; output: number | null; hours: null }

export type StatsSummary = {
  occasions: StatsOccasion[]
  cycles: StatsCycle[]
  open: StatsOpenCycle | null
  /** TB số ngày giữa 2 lần; < 3 lần ⇒ null ("chưa đủ dữ liệu"). */
  /** TB số ngày các chu kỳ — có khi ≥ 1 chu kỳ. */
  avgDays: number | null
  avgOutput: number | null
  /** ≥ 3 lần (≥ 2 chu kỳ) mới coi trung bình là tin cậy; ít hơn vẫn hiện số kèm ghi chú. */
  reliable: boolean
  /** Dự kiến lần tiếp theo (tham khảo) = lần cuối + avgDays — chỉ khi `reliable`. */
  nextExpected: string | null
}

/** Cộng dồn sản lượng theo ngày (prefix sum) để tính nhanh mọi khoảng [from, to]. */
export function buildOutputLookup(daily: [string, number][]) {
  if (daily.length === 0) return null
  const sorted = [...daily].sort((a, b) => a[0].localeCompare(b[0]))
  const idx = sorted.map(([d]) => dayIndex(d))
  const prefix: number[] = [0]
  for (const [, v] of sorted) prefix.push(prefix[prefix.length - 1] + v)
  // số phần tử có dayIndex <= x
  const upper = (x: number) => {
    let lo = 0
    let hi = idx.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (idx[mid] <= x) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  return (fromIso: string, toIso: string) => prefix[upper(dayIndex(toIso))] - prefix[upper(dayIndex(fromIso) - 1)]
}

export function computeStats(
  events: EquipmentStatsEvent[],
  opts: {
    kind: EquipmentOutputKind
    daily: [string, number][]
    today: string
    /** Chỉ tính các lần từ ngày này (lọc kỳ 6/12 tháng); null = tất cả. */
    since?: string | null
    /** Chỉ tính các lần tới ngày này (khoảng ngày trang Lý lịch); null = tới hôm nay. */
    until?: string | null
    /** Chỉ các biên bản có vật tư thuộc nhóm này. */
    materialKey?: string | null
    withOutput: boolean
  },
): StatsSummary {
  const filtered = events.filter(
    (e) =>
      (!opts.since || e.ngay >= opts.since) &&
      (!opts.until || e.ngay <= opts.until) &&
      (!opts.materialKey || e.material_keys.includes(opts.materialKey)),
  )
  const occasions = groupOccasions(filtered)
  const lookup = opts.withOutput && OUTPUT_LABEL[opts.kind] ? buildOutputLookup(opts.daily) : null
  const hasOutput = opts.withOutput && OUTPUT_LABEL[opts.kind] != null
  const outputOf = (a: string, b: string) => (hasOutput ? (lookup ? lookup(a, b) : 0) : null)
  const withHours = opts.withOutput && kindHasHours(opts.kind)

  const cycles: StatsCycle[] = []
  for (let i = 1; i < occasions.length; i++) {
    const from = occasions[i - 1]
    const to = occasions[i]
    const diff = from.dong_ho != null && to.dong_ho != null ? to.dong_ho - from.dong_ho : null
    cycles.push({
      from,
      to,
      days: dayIndex(to.ngay) - dayIndex(from.ngay),
      output: outputOf(from.ngay, to.ngay),
      hours: withHours && diff != null && diff > 0 ? Math.round(diff * 10) / 10 : null,
    })
  }

  const last = occasions[occasions.length - 1]
  // Chu kỳ đang mở chỉ có nghĩa khi khoảng xem kéo tới hôm nay.
  const open: StatsOpenCycle | null =
    last && last.ngay <= opts.today && (!opts.until || opts.until >= opts.today)
      ? { from: last, days: dayIndex(opts.today) - dayIndex(last.ngay), output: outputOf(last.ngay, opts.today), hours: null }
      : null

  const reliable = occasions.length >= 3
  const avgDays = cycles.length ? Math.round((cycles.reduce((s, c) => s + c.days, 0) / cycles.length) * 10) / 10 : null
  const outs = cycles.map((c) => c.output).filter((v): v is number => v != null)
  const avgOutput = outs.length ? outs.reduce((s, v) => s + v, 0) / outs.length : null
  const nextExpected = reliable && avgDays != null && last ? addDaysIso(last.ngay, Math.round(avgDays)) : null

  return { occasions, cycles, open, avgDays, avgOutput, reliable, nextExpected }
}

export function formatTons(kg: number | null | undefined) {
  if (kg == null) return "—"
  return `${(kg / 1000).toLocaleString("vi-VN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} tấn`
}
