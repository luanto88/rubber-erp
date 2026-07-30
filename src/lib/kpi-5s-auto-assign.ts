// Thuật toán "Phân công thông minh" cho vị trí 5S — thay thế đề xuất "vòng quay ngẫu nhiên"
// thuần túy: random CÓ TRỌNG SỐ nghịch đảo theo tải hiện tại (ai đang phụ trách ít vị trí hơn
// thì xác suất được chọn cao hơn) + ràng buộc cứng (người dọn ≠ người chấm) + ràng buộc mềm
// (tránh người chấm cùng nhóm chuyên môn chính với người dọn, để giảm rủi ro thông đồng — tự
// động nới lỏng nếu không còn ứng viên nào khác, không được để vị trí bỏ trống). Xem phân tích
// đầy đủ trong hội thoại — không dùng thuật toán tối ưu ghép cặp (Hungarian...) vì đây chỉ là
// công cụ ĐỀ XUẤT, người dùng luôn xem lại và sửa tay trước khi xác nhận.
//
// Khu vực (zone_id): nếu 1 vị trí gán 1 khu vực (kpi_5s_zones — TẦNG LỚN, vd "Kho 1", KHÁC
// HẲN "Vị trí" là tầng NHỎ đang được gán người ở đây), pool ứng viên của CẢ người dọn lẫn
// người chấm bị giới hạn chỉ trong số nhân sự thuộc đúng khu vực đó (kpi_5s_zone_members) —
// nhân sự chỉ hoán đổi trong nội bộ khu vực (vd Kho 1 chỉ đổi với Kho 1), không random xuyên
// suốt cả nhà máy. Ràng buộc "tránh cùng nhóm chuyên môn chính" (personnel_groups — một khái
// niệm KHÁC hẳn "khu vực", không được gộp lại) áp dụng SAU, độc lập, bên trong pool đã lọc
// theo khu vực — 2 tầng ràng buộc lồng nhau, mỗi tầng có cờ nới lỏng riêng
// (zonePoolRelaxed/groupConstraintRelaxed). Trọng số random (loadByUser) vẫn tính trên tải
// TOÀN NHÀ MÁY — chỉ phạm vi ứng viên bị thu hẹp.
//
// Cập nhật 2026-07-29 (fix bug thật — "chọn rất nhiều nhân sự không liên quan"): trước đây pool
// hoàn toàn KHÔNG lọc theo Phòng ban (`kpi_5s_locations.phong_ban_id`) dù vị trí đã có trường
// này — chỉ lọc theo "Khu vực" (tùy chọn, thường bỏ trống). Đã thêm 2 tầng lọc MỚI, áp dụng
// TRƯỚC tầng "Khu vực" hiện có, mỗi tầng có cờ nới lỏng riêng (khớp quyết định đã chốt với người
// dùng: "Phòng ban + chỉ người đã từng dọn/chấm"):
//   1. `deptPoolRelaxed` — lọc theo Phòng ban của vị trí (deptUserIdsByDept, không nới lỏng: nếu
//      vị trí có phong_ban_id và có mapping, BẮT BUỘC chỉ chọn trong số nhân sự phòng ban đó —
//      đây chính là fix chính cho bug).
//   2. `establishedRelaxed` — trong số đã lọc theo phòng ban, ưu tiên CHỈ những người ĐANG là
//      người dọn/chấm ở BẤT KỲ vị trí nào khác (established5sUserIds) — tự động nới lỏng về pool
//      phòng ban thuần túy nếu phòng ban đó chưa từng có ai được gán 5S (tránh pool rỗng vĩnh
//      viễn khi mới thiết lập phòng ban).

export type AutoAssignCandidate = { userId: string; ten: string; primaryGroupId: string | null; zoneIds: string[] }
export type AutoAssignLocationInput = {
  id: string
  ma_vi_tri: string
  ten_vi_tri: string
  nguoi_don_id: string | null
  nguoi_cham_id: string | null
  zone_id: string | null
  phong_ban_id: string | null
}
export type AutoAssignSuggestion = {
  locationId: string
  nguoiDonId: string | null
  nguoiChamId: string | null
  groupConstraintRelaxed: boolean
  zonePoolRelaxed: boolean
  deptPoolRelaxed: boolean
  establishedRelaxed: boolean
  // Danh sách ứng viên cuối cùng đã dùng để random cho vị trí này (sau mọi tầng lọc/nới lỏng) —
  // dùng để giới hạn luôn dropdown sửa tay trong modal, tránh chọn tay ra người "không liên quan"
  // mà thuật toán vừa cố loại bỏ.
  eligibleUserIds: string[]
}

/** Union userId đang là người dọn (kpi_5s_location_cleaners, fallback nguoi_don_id khi vị trí
 *  chưa có dòng multi-cleaner nào) HOẶC người chấm (nguoi_cham_id) của BẤT KỲ vị trí nào trong
 *  `locations` — dùng làm ràng buộc mềm "chỉ random nhân sự dọn dẹp/chấm hiện tại". */
export function computeEstablished5sUserIds(
  locations: Pick<AutoAssignLocationInput, "id" | "nguoi_don_id" | "nguoi_cham_id">[],
  cleanerMembership: Map<string, string[]>,
): Set<string> {
  const established = new Set<string>()
  for (const loc of locations) {
    const cleaners = cleanerMembership.get(loc.id) ?? (loc.nguoi_don_id ? [loc.nguoi_don_id] : [])
    for (const uid of cleaners) established.add(uid)
    if (loc.nguoi_cham_id) established.add(loc.nguoi_cham_id)
  }
  return established
}

function weightedPick(
  pool: AutoAssignCandidate[],
  loadByUser: Map<string, number>,
  exclude: Set<string>,
): AutoAssignCandidate | null {
  const candidates = pool.filter((p) => !exclude.has(p.userId))
  if (candidates.length === 0) return null
  const weights = candidates.map((c) => 1 / ((loadByUser.get(c.userId) || 0) + 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

export function buildAutoAssignSuggestions(
  locations: AutoAssignLocationInput[],
  people: AutoAssignCandidate[],
  opts: {
    onlyUnassigned: boolean
    avoidSameGroup: boolean
    // Phòng ban → tập userId thuộc đúng phòng ban đó (từ /api/kpi/dept-users). Bỏ trống hoặc
    // thiếu mapping cho 1 phòng ban cụ thể = không lọc theo phòng ban cho vị trí đó (an toàn hơn
    // là loại sạch, phòng trường hợp route tra cứu lỗi tạm thời).
    deptUserIdsByDept?: Map<string, Set<string>>
    // Union userId đang là người dọn/chấm ở BẤT KỲ vị trí nào — ràng buộc mềm "chỉ random nhân
    // sự dọn dẹp/chấm hiện tại", tự nới lỏng nếu phòng ban chưa từng gán ai.
    establishedUserIds?: Set<string>
  },
): AutoAssignSuggestion[] {
  if (people.length < 2) return []

  // Tải hiện tại = số lần 1 người xuất hiện (dọn HOẶC chấm) trên TOÀN BỘ vị trí — phản ánh
  // đúng khối lượng thật đang gánh, kể cả những vị trí không nằm trong lượt phân công này.
  const loadByUser = new Map<string, number>()
  for (const loc of locations) {
    if (loc.nguoi_don_id) loadByUser.set(loc.nguoi_don_id, (loadByUser.get(loc.nguoi_don_id) || 0) + 1)
    if (loc.nguoi_cham_id) loadByUser.set(loc.nguoi_cham_id, (loadByUser.get(loc.nguoi_cham_id) || 0) + 1)
  }

  const targetLocations = opts.onlyUnassigned
    ? locations.filter((loc) => !loc.nguoi_don_id || !loc.nguoi_cham_id)
    : locations
  const sorted = [...targetLocations].sort((a, b) => a.ma_vi_tri.localeCompare(b.ma_vi_tri, "vi"))

  const results: AutoAssignSuggestion[] = []

  for (const loc of sorted) {
    const keepDon = opts.onlyUnassigned && !!loc.nguoi_don_id
    const keepCham = opts.onlyUnassigned && !!loc.nguoi_cham_id

    // Tầng 1 — Phòng ban (bắt buộc, không nới lỏng): chỉ giữ nhân sự thuộc đúng phong_ban_id của
    // vị trí. Đây là fix chính cho bug "chọn rất nhiều nhân sự không liên quan".
    let deptPool = people
    let deptPoolRelaxed = false
    if (loc.phong_ban_id && opts.deptUserIdsByDept?.has(loc.phong_ban_id)) {
      const deptIds = opts.deptUserIdsByDept.get(loc.phong_ban_id)!
      deptPool = people.filter((p) => deptIds.has(p.userId))
    } else if (loc.phong_ban_id) {
      deptPoolRelaxed = true // có phòng ban nhưng chưa tra được mapping — không lọc được, ghi nhận để cảnh báo
    }

    // Tầng 2 — "Đã từng dọn/chấm" (mềm, tự nới lỏng về deptPool nếu phòng ban chưa từng gán ai).
    let establishedPool = deptPool
    let establishedRelaxed = false
    if (opts.establishedUserIds) {
      const filtered = deptPool.filter((p) => opts.establishedUserIds!.has(p.userId))
      if (filtered.length >= 2) establishedPool = filtered
      else establishedRelaxed = true
    }

    // Tầng 3 — Khu vực (hiện có từ trước) — cần ít nhất 2 người mới đủ để phân biệt người dọn/
    // người chấm; không đủ thì nới lỏng về pool đã lọc ở 2 tầng trên.
    let zonePool = establishedPool
    let zonePoolRelaxed = false
    if (loc.zone_id) {
      const filtered = establishedPool.filter((p) => p.zoneIds.includes(loc.zone_id!))
      if (filtered.length >= 2) zonePool = filtered
      else zonePoolRelaxed = true
    }

    let donId = keepDon ? loc.nguoi_don_id : null
    if (!donId) {
      const picked = weightedPick(zonePool, loadByUser, new Set())
      donId = picked?.userId || null
      if (donId) loadByUser.set(donId, (loadByUser.get(donId) || 0) + 1)
    }

    let chamId = keepCham ? loc.nguoi_cham_id : null
    let groupConstraintRelaxed = false
    if (!chamId) {
      const exclude = new Set<string>(donId ? [donId] : [])
      const donGroup = donId ? people.find((p) => p.userId === donId)?.primaryGroupId : null
      let pool = zonePool
      if (opts.avoidSameGroup && donGroup) {
        const filtered = zonePool.filter((p) => p.primaryGroupId !== donGroup)
        if (filtered.length > 0) pool = filtered
        else groupConstraintRelaxed = true
      }
      const picked = weightedPick(pool, loadByUser, exclude)
      chamId = picked?.userId || null
      if (chamId) loadByUser.set(chamId, (loadByUser.get(chamId) || 0) + 1)
    }

    const eligibleUserIds = [...new Set(zonePool.map((p) => p.userId))]

    results.push({
      locationId: loc.id,
      nguoiDonId: donId,
      nguoiChamId: chamId,
      groupConstraintRelaxed,
      zonePoolRelaxed,
      deptPoolRelaxed,
      establishedRelaxed,
      eligibleUserIds,
    })
  }

  return results
}
