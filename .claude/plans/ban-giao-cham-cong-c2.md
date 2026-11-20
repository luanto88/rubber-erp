# Prompt bàn giao — Module Chấm công, sang GĐ C2 "Điểm danh ca" (viết 2026-11-20)

```
Đọc CLAUDE.md, rule 29, rule 31 (.claude/rules/31-attendance-module.md) và kế hoạch
.claude/plans/cham-cong-2026-11-19.md (mục 4, 7, 8 — mục 8 là mô hình phiếu ngày nhiều phần, THAY mục 2/4).
Trạng thái: C0 + C1 test PASS 2026-11-20, đã commit. Migration 20261201–20261204 ĐÃ CHẠY (20261203 "Có mặt A không
bắt buộc lý do", 20261204 "công nhân không có nghỉ tua"). Lịch công: ô Tháng rộng 1,2 phần, cột ngày xen kẽ đậm/nhạt.
Quy tắc: công nhân KHÔNG có nghỉ tua (lương theo công thực tế + sản lượng) — màn điểm danh chỉ Có mặt / Vắng có phép /
Vắng không phép; nghỉ có/không phép + A/B dùng phân loại thi đua cuối năm (rule 31).
Bắt đầu GĐ C2 "Điểm danh ca" (màn trực ca, điện thoại, đồng bộ giao diện với /dashboard/product/confirm):
- QR dán tại ca (bảng attendance_qr_points: token, tên điểm, dây chuyền mặc định; in tem ở Cài đặt → Chấm công).
  Quét ⇒ /dashboard/attendance/shift?qr=<token> (chưa đăng nhập ⇒ /login?next=). Quyền attendance.shift_check (trực ca
  theo production_shift_assignments — tự chọn ca: vd Danh Ngàn ⇒ Ca B) hoặc attendance.mark / mark_all (chọn ca tay).
- 1 ngày = 1 phiếu / dây chuyền (attendance_daily_sheets) gồm các phần (attendance_sheet_sections: tiep_nhan, co_dien,
  nang_hang, ca_san_xuat × ca A/B/C), bat_dau_luc = lúc bắt đầu điểm danh, ket_thuc_luc = lúc bấm "Kết thúc ca" ở màn
  quét Thành phẩm. Tổ tiếp nhận điểm danh trước rồi chuyển sang phần ca sản xuất. Mỗi trực ca chỉ sửa phần mình lập.
- Khối thông tin ca: dây chuyền, ngày SX, ca trưởng (production_shift_names), tổ phó, trực ca, số công nhân tổng/có/vắng.
- Dòng: STT · công nhân · công việc (danh mục theo dây chuyền + tổ, mặc định công việc của người; 1 việc nhiều người,
  hiện sẵn đúng "số người gợi ý") · ô Xe khi công việc có loại xe (mặc định xe mà người đó là tài xế chính/phụ) ·
  xếp loại A/B (mặc định A) · Có/Vắng (mặc định Có) ⇒ Vắng: Có phép/Không phép (mặc định Có phép) + Người thay thế
  (dropdown, gõ tên mới ⇒ tạo nhân sự cho_xac_nhan, nguon_tao them_nhanh_truc_ca); Không phép thêm Lý do (danh mục, thêm
  nhanh); Ghi chú luôn hiện. Trực ca chọn được chính mình vào công việc. Thêm người ngoài danh sách vào ca.
- Gửi chấm công ⇒ văn phòng (attendance.approve) duyệt / trả về kèm lý do. Duyệt ⇒ ghi attendance_records nguồn
  truc_ca (không đè bo_sung_tay), xếp loại. Thông báo chuông.
- Chuyển ngôn ngữ Việt/Khmer trên màn điểm danh (như i18n màn quét Thành phẩm); chữ màn hình vào
  src/lib/attendance/khmer-ui.json, chạy scripts/export-attendance-khmer.mjs để cập nhật file cho chuyên gia.
- Tab "Phiếu chờ duyệt" trong /dashboard/attendance.
Lên plan (bảng, RPC, màn, câu hỏi còn mở) để tôi duyệt TRƯỚC khi code. Câu nào chưa rõ thì hỏi.
Xong: tsc + eslint (không npm run build), liệt kê việc đã làm, hướng dẫn test tay, sửa bug, cập nhật rule 31 + CLAUDE.md,
viết prompt bàn giao C2b/C3. Hỏi tôi trước khi commit/push.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối).
```
