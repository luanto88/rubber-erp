// Công thức "có phải LƯỢT KÝ của người đang xem hay không" — dùng chung cho các badge trạng
// thái ký ở trang danh sách (Kiểm nghiệm/Điều xe/Bảo trì). Mirror ĐÚNG công thức `myTurn` đã có
// sẵn và chạy đúng ở SignScreen (`src/app/dashboard/ky/[id]/page.tsx`): tới lượt khi TẤT CẢ
// người có `thuTu` nhỏ hơn đã ký xong. Khác SignScreen ở 1 điểm: nếu người xem KHÔNG nằm trong
// danh sách ký (`mine` không tìm thấy), trả `false` — SignScreen coi `!myNguoiKy` là `true` vì
// ngữ cảnh trang đó luôn có người dùng đang thực sự tham gia; ở badge danh sách, người xem có
// thể chỉ là người không liên quan, "chờ bạn ký" không có ý nghĩa với họ.
export type MyTurnSigner = { userId: string; thuTu: number; trangThai: string }

export function computeMyTurn(signers: MyTurnSigner[], currentUserId: string | null | undefined): boolean {
  if (!currentUserId) return false
  const mine = signers.find((s) => s.userId === currentUserId)
  if (!mine) return false
  if (mine.trangThai === "da_ky") return false
  return signers.every((s) => s.thuTu >= mine.thuTu || s.trangThai === "da_ky")
}

// Đã có người ký chưa — dùng để ẩn nút "Hủy yêu cầu" ở UI (đã có người ký thì không cho hủy nữa,
// chỉ còn "Trả về"; backend cancelSigningRequest() cũng chặn cứng riêng, đây chỉ là gate UI).
export function hasAnySigned(signers: MyTurnSigner[]): boolean {
  return signers.some((s) => s.trangThai === "da_ky")
}
