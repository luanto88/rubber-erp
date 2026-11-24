# Bàn giao Chấm công — Ca/Tổ điểm danh + GĐ3 (2026-11-24)

Thay file `ban-giao-cham-cong-c2-gd3.md` cho phần còn lại. Mô hình hiện hành: rule 31 mục "GĐ3" + "Ca / Tổ điểm danh".

## 1. Trạng thái
- Đã push main (commit "Chấm công GĐ3 + Ca/Tổ điểm danh"). tsc + eslint sạch. Không chạy `npm run build`.
- Migration theo thứ tự (chạy tay trên Supabase SQL Editor):
  | File | Trạng thái |
  |---|---|
  | 20261208_attendance_section_positions | ĐÃ CHẠY, test PASS |
  | 20261209_attendance_logs_fix_delete_sheet | ĐÃ CHẠY, test PASS |
  | 20261210_attendance_units | ĐÃ CHẠY, test bước 1–3 PASS |
  | 20261211_attendance_unit_jobs | **CHƯA XÁC NHẬN ĐÃ CHẠY** — phải chạy trước khi mở màn chấm công trên bản mới |
- Test tay còn treo (người dùng test trên mobile, bản deploy):
  1. Cài đặt → Chấm công → Ca / Tổ: cột Dây chuyền; có Tổ tiếp nhận mủ nước (TN_MN), Đội xe cơ khí (XE_CK).
  2. Tab Công việc: chip "Ca sản xuất · Mủ tạp/Mủ nước" + từng tổ; "Trực hồ XLNT" ở Tổ xử lý nước thải; việc cơ điện gộp CD;
     thêm việc cho Đội xe cơ khí.
  3. Sarath (chỉ `attendance.shift_check`, gán Ca A): màn điểm danh chỉ có Ca A, không còn thẻ nhóm, chỉ việc ca sản xuất.
  4. Gán thêm XLNT ⇒ chọn được tổ, việc của tổ; điểm danh tổ cho Mủ tạp và Mủ nước ⇒ khối tổ ở cả TKSXMT và TKSXMN.
  5. Chọn TN_MN ⇒ nút Mủ tạp khoá; phiếu chỉ ở TKSXMN.
  6. (Từ lần trước) Phiếu TKSX tab "Phiếu TKSX": mỗi Ca/Tổ 1 khối theo thứ tự, QR nhỏ, dấu duyệt + bản cứng khi đủ duyệt.
  7. Phiếu cũ đã đổi mã TKSXMT/TKSXMN; màn quét Thành phẩm vẫn nhận ca A/B/C (`loadUserShiftAssignment`), "Kết thúc ca" ghi giờ.

## 2. Mô hình đã chốt (KHÔNG tự đổi)
- Nhóm nhân sự (`personnel_groups`) CHỈ là nhóm chuyên môn: KPI, người thực hiện biên bản bảo trì, người trực xuất hàng.
  Màn điểm danh không có thẻ nhóm (`hien_diem_danh` đã tắt, UI Cài đặt đã gỡ).
- Điểm danh theo Ca/Tổ (`attendance_units`). Trực ca chỉ có `shift_check` ⇒ chỉ thấy/mở Ca/Tổ được phân công
  (`production_shift_assignments.ca = mã đơn vị`, 1 người nhiều đơn vị được). RPC `attendance_open_section` chặn ở server.
- `attendance_units.day_chuyen`: NULL = chọn khi điểm danh (Ca A/B/C; tổ độc lập CD, XLNT, XE_CK — mỗi dây chuyền 1 phiếu riêng,
  in ở cả 2 phiếu, người có ở cả 2 thì in 2 lần, ngày công tính 1 lần); 'Mủ tạp' (TN_MT) / 'Mủ nước' (TN_MN) = khoá dây chuyền.
- Việc: `attendance_job_types.unit_code` = việc của tổ; việc ca = `unit_code` NULL + `to_nhom='ca_san_xuat'` + `day_chuyen`.
  Hàm dùng chung `isJobOfUnit` / `jobsForUnit` (`src/lib/attendance/shift.ts`). Trực ca, Trực xuất hàng là NHIỆM VỤ, không phải tổ.
- Người thay mượn từ ca/tổ khác ở thẻ "Khác", chỉ nhận việc của Ca/Tổ đang điểm danh.
- Vị trí trưởng/phó theo Ca/Tổ (`vi_tri` = `{truong, pho}`); người giữ vị trí = có mặt A; người mặc định bị thay ⇒ vắng.
- Đã duyệt ⇒ khoá; chỉ admin mở lại / xoá phiếu (lý do bắt buộc).
- Mọi `CREATE OR REPLACE attendance_open_section` chép từ 20261211; `attendance_save_section` chép từ 20261210.

## 3. File chính
- `src/lib/attendance/shift.ts` (roster, vị trí, việc theo đơn vị), `types.ts`, `f01-model.ts`, `f01-sheet.ts`, `f01-client.ts`.
- `src/app/dashboard/attendance/shift/page.tsx` + `_components/{worker-tile,job-sheet,submit-review,position-block}.tsx`.
- `src/app/dashboard/attendance/sheet-report-actions.ts`, `sheet/[id]/page.tsx`, `_components/sheet-review-list.tsx`.
- Cài đặt: `attendance-config-tab.tsx` (Công việc theo "Thuộc"), `attendance-units-card.tsx`, `attendance-qr-points-card.tsx`,
  `shift-assignments-tab.tsx`, `staff-attendance-fields.tsx`.
- Liên quan: `export/page.tsx` (Người trực xuất hàng), `product/confirm/*` (Kết thúc ca, dấu duyệt F09), `src/lib/pdf-approval-stamp.ts`.

## 4. Việc tiếp theo (theo kế hoạch `.claude/plans/cham-cong-2026-11-19.md` mục 7–8)
1. Sửa lỗi sau test mobile bản deploy (ưu tiên).
2. C2b Truy vết: khối nhân sự ca ở chi tiết lô Thành phẩm (`/dashboard/product/lot/[id]`) dựa trên phiếu ca + `ket_thuc_luc`.
3. C3 Có mặt tự động (nhân viên) — gom hoạt động app → `auto_app`; chấm D → `cham_diem_d`; cờ mâu thuẫn.
4. C4 Sổ phép + chuỗi 3 tháng; C5 KPI dùng chuyên cần mới; C6 Bảng công tháng; C8 bổ sung.
- Khoảng trống đã biết: Lịch công chưa tô ô đã khoá; không có hàng đợi mất mạng cho điểm danh; chữ Khmer máy dịch
  (`cung_cap_dl/dich_khmer_cham_cong.xlsx` chờ chuyên gia); đổi nhân viên → công nhân không chặn ô "nghi_tua" cũ.

## 5. Lưu ý kỹ thuật
- Chỉ `npx tsc --noEmit` + `npx eslint <file>`; lỗi Turbopack ⇒ tắt dev, xoá `.next/dev/cache/turbopack`.
- Chữ Khmer mới ⇒ `khmer-ui.json` / `khmer-catalog.json` + `node scripts/export-attendance-khmer.mjs`.
- Bảng lớn ⇒ `fetchAllPaginated` + `.order()` ổn định; `.in()` chia lô 200. Ngày nghiệp vụ `getFactoryTodayISO()`.
- File `cung_cap_dl/*` (ảnh xoá, `du_lieu_cu/`, `load.jpg`) KHÔNG nằm trong commit — để người dùng tự quyết.

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 29, rule 31 (mục GĐ3 + "Ca / Tổ điểm danh"), và ĐỌC HẾT .claude/plans/ban-giao-cham-cong-ca-to.md.
Trạng thái: Chấm công GĐ3 + Ca/Tổ điểm danh đã push main; migration 20261208–20261210 đã chạy; 20261211 tôi sẽ xác nhận
đầu phiên (nếu chưa chạy, nhắc tôi chạy trước khi test).
Đầu phiên: tôi báo kết quả test tay mục 1 trong file bàn giao (test trên mobile, bản deploy). Sửa lỗi tôi báo trước,
giữ đúng mô hình mục 2 (không đưa lại thẻ nhóm, không gắn tổ độc lập vào dây chuyền).
Sau khi test PASS: đề xuất kế hoạch C2b Truy vết (khối nhân sự ca ở chi tiết lô) rồi C3 — lên plan liệt kê bảng / RPC / màn
hình để tôi duyệt trước khi code; điểm nào chưa rõ thì HỎI tôi (ngôn ngữ nghiệp vụ + ví dụ), không tự quyết.
Mỗi bước tsc + eslint; xong hướng dẫn test tay, DỪNG cho tôi test; hỏi tôi trước khi commit/push.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối); U11 KPI.
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build.
```
