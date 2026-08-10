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
// này — chỉ lọc theo "Khu vực" (tùy chọn, thường bỏ trống). Đã thêm tầng lọc MỚI theo Phòng ban,
// áp dụng TRƯỚC tầng "Khu vực" hiện có:
//   `deptPoolRelaxed` — lọc theo Phòng ban của vị trí (deptUserIdsByDept, không nới lỏng: nếu
//   vị trí có phong_ban_id và có mapping, BẮT BUỘC chỉ chọn trong số nhân sự phòng ban đó — đây
//   chính là fix chính cho bug).
//
// Cập nhật 2026-08-19 (theo phản hồi người dùng — dropdown sửa tay quá hẹp): "đã từng dọn/chấm"
// (established5sUserIds) KHÔNG CÒN là một tầng lọc cứng nữa — trước đây nó thu hẹp
// `eligibleUserIds` (dùng để giới hạn dropdown sửa tay trong modal) xuống chỉ còn người đã từng
// giữ vai trò 5S, khiến dropdown "gần như trống" với phòng ban mới. Giờ nó chỉ còn là TRỌNG SỐ ƯU
// TIÊN khi random (ESTABLISHED_WEIGHT_BOOST) — dropdown (`eligibleUserIds`) luôn hiển thị TOÀN BỘ
// nhân sự đủ điều kiện theo Phòng ban + Khu vực, việc random vẫn có xu hướng ưu tiên người đã có
// kinh nghiệm nhưng không loại hẳn người mới.

export type AutoAssignCandidate = { userId: string; ten: string; primaryGroupId: string | null; zoneIds: string[] }
export type AutoAssignLocationInput = {
  id: string
  ma_vi_tri: string
  ten_vi_tri: string
  nguoi_don_id: string | null
  nguoi_cham_id: string | null
  zone_id: string | null
  phong_ban_id: string | null
  // Đội ngũ dọn dẹp THẬT (kpi_5s_location_cleaners, fallback [nguoi_don_id] nếu vị trí chưa từng
  // gán qua bảng multi) — quyết định SỐ LƯỢNG người dọn sẽ được đề xuất khi random lại (giữ
  // nguyên số lượng hiện có, không tụt về 1).
  current_cleaner_ids: string[]
}
export type AutoAssignSuggestion = {
  locationId: string
  nguoiDonIds: string[]
  nguoiChamId: string | null
  groupConstraintRelaxed: boolean
  zonePoolRelaxed: boolean
  deptPoolRelaxed: boolean
  // true = trong pool cuối cùng (đã lọc Phòng ban + Khu vực) không có ai từng giữ vai trò 5S
  // (dọn/chấm) trước đây — random hoàn toàn ngẫu nhiên, không có ai được ưu tiên trọng số. KHÔNG
  // còn ý nghĩa "đã nới lỏng bộ lọc" như trước 2026-08-19 (established không còn là bộ lọc).
  noEstablishedCandidate: boolean
  // Danh sách ứng viên cuối cùng đã dùng để random cho vị trí này (sau lọc Phòng ban + Khu vực,
  // KHÔNG thu hẹp thêm theo "đã từng dọn/chấm") — dùng cho dropdown sửa tay trong modal, luôn
  // hiển thị đủ nhân sự đúng phòng ban/khu vực, không loại người mới chưa từng làm 5S.
  eligibleUserIds: string[]
}

// Hệ số ưu tiên khi random cho ứng viên "đã từng dọn/chấm 5S" — không loại hẳn người khác, chỉ
// tăng xác suất được chọn (xem weightedPick).
const ESTABLISHED_WEIGHT_BOOST = 4

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
  preferredIds?: Set<string>,
): AutoAssignCandidate | null {
  const candidates = pool.filter((p) => !exclude.has(p.userId))
  if (candidates.length === 0) return null
  const weights = candidates.map((c) => {
    const base = 1 / ((loadByUser.get(c.userId) || 0) + 1)
    return preferredIds?.has(c.userId) ? base * ESTABLISHED_WEIGHT_BOOST : base
  })
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
    for (const uid of loc.current_cleaner_ids) loadByUser.set(uid, (loadByUser.get(uid) || 0) + 1)
    if (loc.nguoi_cham_id) loadByUser.set(loc.nguoi_cham_id, (loadByUser.get(loc.nguoi_cham_id) || 0) + 1)
  }

  const targetLocations = opts.onlyUnassigned
    ? locations.filter((loc) => loc.current_cleaner_ids.length === 0 || !loc.nguoi_cham_id)
    : locations
  const sorted = [...targetLocations].sort((a, b) => a.ma_vi_tri.localeCompare(b.ma_vi_tri, "vi"))

  const results: AutoAssignSuggestion[] = []

  for (const loc of sorted) {
    const keepDon = opts.onlyUnassigned && loc.current_cleaner_ids.length > 0
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

    // Tầng 2 — Khu vực (hiện có từ trước) — cần ít nhất 2 người mới đủ để phân biệt người dọn/
    // người chấm; không đủ thì nới lỏng về deptPool.
    let zonePool = deptPool
    let zonePoolRelaxed = false
    if (loc.zone_id) {
      const filtered = deptPool.filter((p) => p.zoneIds.includes(loc.zone_id!))
      if (filtered.length >= 2) zonePool = filtered
      else zonePoolRelaxed = true
    }

    // "Đã từng dọn/chấm" giờ chỉ là TRỌNG SỐ ưu tiên khi random (weightedPick), KHÔNG còn thu hẹp
    // pool — eligibleUserIds (dropdown) luôn là toàn bộ zonePool.
    const preferredIds = opts.establishedUserIds
    const noEstablishedCandidate = !preferredIds || !zonePool.some((p) => preferredIds.has(p.userId))

    let donIds: string[]
    if (keepDon) {
      donIds = loc.current_cleaner_ids
    } else {
      // Giữ nguyên SỐ LƯỢNG người dọn hiện có (mặc định 1 nếu vị trí chưa từng gán ai) — random
      // lần lượt, mỗi lượt loại trừ những người đã được chọn ở lượt trước (không trùng người).
      const targetCleanerCount = loc.current_cleaner_ids.length > 0 ? loc.current_cleaner_ids.length : 1
      donIds = []
      for (let i = 0; i < targetCleanerCount; i++) {
        const picked = weightedPick(zonePool, loadByUser, new Set(donIds), preferredIds)
        if (!picked) break
        donIds.push(picked.userId)
        loadByUser.set(picked.userId, (loadByUser.get(picked.userId) || 0) + 1)
      }
    }

    let chamId = keepCham ? loc.nguoi_cham_id : null
    let groupConstraintRelaxed = false
    if (!chamId) {
      const exclude = new Set<string>(donIds)
      const donGroups = new Set(donIds.map((uid) => people.find((p) => p.userId === uid)?.primaryGroupId).filter(Boolean))
      let pool = zonePool
      if (opts.avoidSameGroup && donGroups.size > 0) {
        const filtered = zonePool.filter((p) => !p.primaryGroupId || !donGroups.has(p.primaryGroupId))
        if (filtered.length > 0) pool = filtered
        else groupConstraintRelaxed = true
      }
      const picked = weightedPick(pool, loadByUser, exclude, preferredIds)
      chamId = picked?.userId || null
      if (chamId) loadByUser.set(chamId, (loadByUser.get(chamId) || 0) + 1)
    }

    const eligibleUserIds = [...new Set(zonePool.map((p) => p.userId))]

    results.push({
      locationId: loc.id,
      nguoiDonIds: donIds,
      nguoiChamId: chamId,
      groupConstraintRelaxed,
      zonePoolRelaxed,
      deptPoolRelaxed,
      noEstablishedCandidate,
      eligibleUserIds,
    })
  }

  return results
}
