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

## 6. Cập nhật 2026-11-25 (sau test production 1–7 PASS) — CHƯA commit
- Migration `20261212_attendance_empty_sections.sql` — **chạy TRƯỚC khi test**: phiếu ca trống không tính, RPC
  `attendance_discard_section`, xoá 16 việc đã tắt không ai dùng, tính lại trạng thái mọi phiếu ngày.
- Code: màn điểm danh (không tự lưu phần điền sẵn, số người/việc, Gửi tất cả, Bỏ phiếu ca, tổ mặc định Bỏ qua người chưa giao),
  tab Phiếu TKSX (thao tác inline, ẩn phiếu ca trống), tải PDF mobile, Cài đặt Nhân sự + Phân công gọn, `.row-hover`.
- Dữ liệu 25/11: sau migration, admin bỏ phiếu Ca A của TKSXMT-251126 (lý do "Ca A không làm việc") ⇒ dấu duyệt TKSX dựng lại.
- Tài khoản: `scripts/delete-disabled-accounts.mjs` xem trước liệt kê 9 tài khoản (6 TEST + Chau Kim Sêne, Nguyễn Trung Cường,
  Vương Nguyễn Phương Lâm) — CHỜ người dùng xác nhận rồi mới `--apply`.
- Test tay (chi tiết ở câu trả lời phiên 2026-11-25): A) bỏ phiếu Ca A 25/11; B) mở màn điểm danh Ca/Tổ không làm việc rồi đổi
  sang ca khác ⇒ không sinh dòng, phiếu ngày vẫn duyệt đủ được; C) số người trên thẻ việc; D) Gửi tất cả; E) bước gửi tổ mặc
  định Bỏ qua; F) Tải PDF TKSX trên điện thoại; G) thao tác inline; H) Cài đặt Phân công + Nhân sự (cuộn ngang không giật).

## 7. Cập nhật 2026-11-25 (chiều) — test A–H PASS localhost (G chờ deploy) — CHƯA commit
- Migration `20261213_attendance_shift_end_by_scan.sql` — **chạy TRƯỚC khi test** (sau 20261212): `lot_transactions.quet_luc`,
  trigger chặn duyệt phiếu ca khi Thành phẩm chưa phê duyệt ca, `submit_confirm_draft_batch` (chép 20261118 + quet_luc).
- Đã xoá tài khoản: 3 xoá, 6 giữ (có lịch sử) — rule 31.
- Code: thẻ việc hiện tên người; Ca/Tổ được phân công đậm + ★; tự điền "Trực ca" cho người đăng nhập ở tổ có việc này;
  TKSX giờ kết thúc = kiện quét cuối, bỏ dấu duyệt nếu có kiện sau giờ duyệt, ngăn = mã đầy đủ; chi tiết phiếu hiện trạng thái
  phê duyệt ca Thành phẩm.
- Test tay: (1) thẻ việc PC rê chuột / mobile dòng tên; (2) dropdown ★; (3) trực ca mở Tổ cơ điện thấy sẵn mình ở "Trực ca",
  chỉ mở rồi đổi tổ ⇒ không sinh dòng; (4) quét 2 lượt cách vài phút rồi Gửi tất cả ⇒ TKSX giờ kết thúc = giờ quét kiện cuối
  (chỉ áp kiện quét SAU migration); (5) duyệt phiếu Ca A khi TP chưa phê duyệt ca A ⇒ báo lỗi; phê duyệt TP rồi duyệt ⇒ OK;
  (6) Ngăn TKSX mã đầy đủ. Lưu ý: hàng đợi mất mạng gửi nháp lúc có mạng ⇒ quet_luc = giờ nháp lên server, không phải giờ quét.

## 8. Cập nhật 2026-11-25 (tối) — mục 6–7 đã push `fcaa324`; C2b đã code (tsc + eslint sạch, CHƯA commit)
- C2b Truy vết: tab "Nhân sự ca" + thẻ "Ca sản xuất" ở `/dashboard/product/lot/[id]` (rule 31 mục "C2b"). Không migration.
- Kiểm code thật: F01 TKSXMT-251126 giống hệt trước/sau tách helper `section-people.ts`; lô 2119cs/26 ⇒ 24/11 Ca A "Chưa có
  phiếu", 25/11 Ca B đã duyệt, 22 người, xe X02; giả lập chỉ quyền Thành phẩm ⇒ không lộ xếp loại / người vắng.
- Treo chờ quyết: giờ bắt đầu ca trên phiếu TKSX = lúc mở phiếu ⇒ 25/11 Ca B in "16:10–13:40" (C2b đã dùng kiện quét đầu).
- Test tay C2b: (1) lô 2 ca ⇒ 2 khối đúng kiện; (2) tài khoản chỉ product.view ⇒ không thấy cột Xếp loại, dòng Vắng, "Mở
  phiếu"; (3) phiếu chưa duyệt ⇒ nhãn vàng; (4) ca chưa có phiếu ⇒ "Chưa có phiếu điểm danh cho ca này"; (5) thẻ "Ca sản
  xuất" bấm ⇒ mở tab (mobile chuyển sang cột tài liệu); (6) mobile bảng cuộn ngang.

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 29, rule 31 (mục "Ca / Tổ điểm danh", "Sửa sau test production 2026-11-25", "C2b"), và ĐỌC HẾT
.claude/plans/ban-giao-cham-cong-ca-to.md (mục 8 là trạng thái mới nhất).
Đầu phiên: tôi báo kết quả test C2b mục 8 + quyết định giờ bắt đầu ca trên phiếu TKSX. Sửa lỗi tôi báo trước, giữ mô hình mục 2;
hỏi tôi trước khi commit/push C2b.
Sau đó: lên kế hoạch C3 Có mặt tự động (nhân viên) theo .claude/plans/cham-cong-2026-11-19.md (mục 2, 5) và bảng nguồn hoạt động
ở .claude/plans/kpi-k1-chuyen-can-2026-11-19.md mục 0 — liệt kê bảng / RPC / màn hình để tôi duyệt trước khi code; điểm nào
chưa rõ thì HỎI tôi (ngôn ngữ nghiệp vụ + ví dụ), không tự quyết.
Mỗi bước tsc + eslint; xong hướng dẫn test tay, DỪNG cho tôi test; hỏi tôi trước khi commit/push.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối); U11 KPI.
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build.
```