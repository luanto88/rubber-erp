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

export type AutoAssignCandidate = { userId: string; ten: string; primaryGroupId: string | null; zoneIds: string[] }
export type AutoAssignLocationInput = {
  id: string
  ma_vi_tri: string
  ten_vi_tri: string
  nguoi_don_id: string | null
  nguoi_cham_id: string | null
  zone_id: string | null
}
export type AutoAssignSuggestion = {
  locationId: string
  nguoiDonId: string | null
  nguoiChamId: string | null
  groupConstraintRelaxed: boolean
  zonePoolRelaxed: boolean
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
  opts: { onlyUnassigned: boolean; avoidSameGroup: boolean },
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

    // Thu hẹp pool theo khu vực (nếu có) — cần ít nhất 2 người trong khu vực mới đủ để phân
    // biệt người dọn/người chấm; không đủ thì nới lỏng về pool toàn nhà máy cho cả 2 vai trò.
    let zonePool = people
    let zonePoolRelaxed = false
    if (loc.zone_id) {
      const filtered = people.filter((p) => p.zoneIds.includes(loc.zone_id!))
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

    results.push({ locationId: loc.id, nguoiDonId: donId, nguoiChamId: chamId, groupConstraintRelaxed, zonePoolRelaxed })
  }

  return results
}
