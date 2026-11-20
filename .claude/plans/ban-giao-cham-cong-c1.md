# Prompt bàn giao — Module Chấm công, sang GĐ C1 (viết 2026-11-19)

```
Đọc CLAUDE.md, rule 29, rule 31 (.claude/rules/31-attendance-module.md) và kế hoạch
.claude/plans/cham-cong-2026-11-19.md (mục 0, 2, 3, 7, 8 — mục 8 THAY mô hình phiếu ở mục 2/4).
Trạng thái: GĐ C0 (nền nhân sự) đã code; tôi đã/đang chạy migration 20261201_attendance_c0_foundation.sql và 3 script
(seed-attendance-catalog, import-attendance-workers, link-drivers-to-staff) — hỏi tôi kết quả test C0 trước, sửa lỗi nếu có.
Bắt đầu GĐ C1 "Khung module + lịch công":
- Module /dashboard/attendance (menu sidebar "Chấm công", guard attendance.view; theme riêng — hỏi tôi màu banner),
  bám UI dự án (rule 29: PageHeaderBanner, SegmentedTabs, FilterBar grid, enterprise-table, StatusBadge — thêm domain
  "attendance" vào status-registry).
- Migration mới: attendance_records (staff_id, ngay, trang_thai co_mat|nghi_tua|nghi_co_phep|nghi_khong_phep, nguon
  auto_app|cham_diem_d|truc_ca|bo_sung_tay, xep_loai A|B, cong_viec_id, vehicle_id, thay_the_cho_staff_id, ly_do_id, ghi_chu,
  dung_phep_thuong, section_id…), attendance_logs (bất biến), và khung attendance_daily_sheets + attendance_sheet_sections
  (dùng ở C2). Ghi qua RPC SECURITY DEFINER kiểm quyền bằng auth.uid(); RLS tách 4 policy; trưởng phòng (attendance.mark)
  chỉ nhân sự cùng phòng ban, attendance.mark_all toàn nhà máy.
- Tab "Lịch công tháng": lưới người × ngày, màu theo trạng thái/nguồn, lọc phòng ban / loại nhân sự / ca / dây chuyền;
  chọn nhiều ô → chấm tay (trạng thái + lý do bắt buộc); khung nhật ký điều chỉnh. Người chỉ có attendance.view xem công
  của chính mình. Tháng làm không trọn (ngày vào/nghỉ việc) hiển thị nhãn riêng.
- Lên plan liệt kê bảng / RPC / trang / thay đổi để tôi duyệt TRƯỚC khi code. Câu nào chưa rõ thì hỏi.
Xong: tsc + eslint (không npm run build), liệt kê việc đã làm, hướng dẫn test tay, sửa bug, cập nhật rule 31 + CLAUDE.md,
viết prompt bàn giao C2. Hỏi tôi trước khi commit/push. Lỗi Turbopack ở dev ⇒ tắt dev, xoá .next/dev/cache/turbopack.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối).
```
