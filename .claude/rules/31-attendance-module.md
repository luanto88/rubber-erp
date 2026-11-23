# Module Chấm công / Điểm danh (`/dashboard/attendance`) — đang xây (2026-11-19)

Kế hoạch đầy đủ + quyết định đã chốt: `.claude/plans/cham-cong-2026-11-19.md` (đọc mục 0, 7, 8 trước khi làm).
KPI chỉ ĐỌC kết quả chuyên cần của module này (rule 27).

## Nguyên tắc đã chốt
- Mọi tổ (tiếp nhận, cơ điện, nâng hàng, ca sản xuất) do TRỰC CA điểm danh bằng QR dán tại ca; người có
  `attendance.mark` / `attendance.mark_all` làm thay được. 1 ngày = 1 phiếu / dây chuyền (F01 Mủ tạp, F02 Mủ nước), tối đa 3 ca.
- Tiếng Khmer CHỈ ở màn điểm danh của trực ca (chuyển ngôn ngữ) và phiếu F01/F02 song ngữ. Lịch công, Cài đặt: tiếng Việt.
- Mọi chữ Khmer mới ⇒ thêm vào `src/lib/attendance/khmer-catalog.json` (danh mục) hoặc `khmer-ui.json` (chữ màn hình, từ C2)
  rồi chạy `node scripts/export-attendance-khmer.mjs` ⇒ `cung_cap_dl/dich_khmer_cham_cong.xlsx` cho chuyên gia duyệt.
  Chuyên gia gửi lại ⇒ sửa JSON, `scripts/seed-attendance-catalog.mjs --apply --update`.
- Người = `maintenance_staff` (Nhân sự), `loai_nhan_su` nhan_vien | cong_nhan; công nhân không cần tài khoản.
- **Công nhân KHÔNG có nghỉ tua** (người địa phương, lương theo công thực tế + sản lượng tháng, không có công chuẩn): chỉ
  Có mặt (A/B) / Nghỉ có phép / Nghỉ không phép. Số ngày nghỉ có/không phép + tỷ lệ A/B dùng phân loại thi đua cuối năm.
  Chặn ở DB bằng trigger `trg_attendance_records_worker_no_tua` (migration `20261204`), UI khoá nút "Nghỉ tua" và cột
  "Chuẩn" để "—". Màn điểm danh trực ca (C2), chuyên cần KPI, bảng công tháng (C6) PHẢI tôn trọng quy tắc này
  (không đặt trước tua, không tính công chuẩn / hệ số chuyên cần theo tua cho công nhân).
- Nhãn quyền tiếng Việt: `ATTENDANCE_PERMISSION_LABELS` (`src/lib/attendance/types.ts`), trải vào `PERMISSION_CODE_LABELS`
  của Cài đặt; module label "Chấm công".

## GĐ C0 — nền nhân sự (2026-11-19, chờ chạy migration + test tay)
- Migration `20261201_attendance_c0_foundation.sql` (**chạy tay TRƯỚC deploy**): cột mới `maintenance_staff` (loai_nhan_su,
  ma_nhan_su, day_chuyen_mac_dinh, ca_mac_dinh, cong_viec_mac_dinh_id, thu_tu_diem_danh, ngay_vao_lam, ngay_nghi_viec,
  nguon_tao, cho_xac_nhan); bảng `attendance_job_types` (dây chuyền + tổ + Việt/Khmer + số người gợi ý + loại xe) và
  `attendance_absence_reasons`; `dispatch_drivers.staff_id`; bảng `dispatch_vehicle_secondary_drivers` (tài xế phụ, lịch sử);
  6 quyền `attendance.*` (admin đủ; manager/user có `attendance.view`). Hàm `attendance_can_manage_config()`,
  `attendance_can_quick_add()` (trực ca thêm nhanh lý do).
- Cài đặt: tab "Chấm công" (`settings/_components/attendance-config-tab.tsx`: Công việc theo dây chuyền/tổ, Lý do vắng);
  form Nhân sự có khối "Chấm công" (`staff-attendance-fields.tsx`); danh sách Nhân sự lọc "Công nhân" / "Chờ xác nhận";
  Xe & Tài xế: tài xế phụ (nhiều người, đóng/thêm từ hôm nay, giữ lịch sử) + ô "Hồ sơ nhân sự" của tài xế.
  Chưa chạy migration ⇒ form Nhân sự / tài xế tự lưu như cũ (bỏ cột mới), tab Chấm công báo cần migration.
- Script (mặc định chỉ xem, `--apply` ghi): `seed-attendance-catalog.mjs` (58 công việc F01+F02, 6 lý do),
  `import-attendance-workers.mjs` (44 công nhân, Ca 1→A, Ca 2→B), `link-drivers-to-staff.mjs` (nối theo tên, chỉ khớp đúng 1).
  Thứ tự: migration → seed → import công nhân → nối tài xế.
- Dữ liệu thật 2026-11-19: 44 công nhân trong file chưa có ai trong Nhân sự; tài xế trùng tên Nhân sự: Bao Thea, Keo Sarath,
  Chau Som Rên (+ Pheap Phin sau khi nhập công nhân). Xe sản xuất: X01 Uk SaRath, X02 Pheap Phin, X04 "Tài xế mới",
  N01 Chau Som Rên, N02 Keo Sarath, X03 (Biomass) Ban So Sieng.
- C0 đã chạy migration + 3 script `--apply`, test PASS 2026-11-20.

## GĐ C1 — Lịch công tháng + chấm tay (2026-11-20, chờ chạy migration + test tay)
- Migration `20261202_attendance_c1_records.sql` (**chạy tay TRƯỚC deploy**): `attendance_records` (1 dòng / nhân sự / ngày,
  trạng thái, nguồn, xếp loại A/B chỉ khi có mặt, lý do bắt buộc khi chấm tay), `attendance_logs` (trigger chặn sửa/xoá).
  RLS chỉ SELECT qua `attendance_can_view_staff()`; ghi qua RPC `attendance_set_days` / `attendance_clear_days`
  (SECURITY DEFINER, `attendance_can_mark_staff()`: admin / mark_all mọi người; `attendance.mark` chỉ nhân sự có
  `department_id` = phòng ban của mình — hồ sơ nhân sự trước, `profiles.department_id` dự phòng). Không chấm "Có mặt" ngày
  tương lai; không chấm ngoài khoảng ngày vào làm – nghỉ việc; tối đa 2.000 ô / lần.
- Script `assign-workers-department.mjs` (xem trước → `--apply`): gán NMCB cho công nhân chưa có phòng ban (44 người) để
  trưởng phòng NMCB chấm được.
- Trang `/dashboard/attendance` (theme mint, menu "Chấm công" trong Quản lý sản xuất, guard `attendance.view`):
  `_components/attendance-calendar.tsx` — FilterBar (tháng ‹ ›, phòng ban, loại, ca, dây chuyền, tìm), StatGrid, lưới
  nhân sự × ngày nhóm theo phòng ban (ô: + có mặt, B có mặt xếp B, T tua, P có phép, K không phép; tím = chấm tay),
  chọn ô / Shift dải / bấm tiêu đề ngày chọn cả cột ⇒ hộp chấm (4 trạng thái, A/B, lý do) hoặc "Xoá chấm"; bấm tên ⇒
  nhật ký tháng. Hàm thuần `src/lib/attendance/calendar.ts` (công chuẩn = ngày lịch − 6, tháng làm không trọn, tổng hợp).
- `StatusBadge` domain `attendance`.
- Test tay C1 bước 1–6 PASS 2026-11-20. Sau test: chấm "Có mặt" xếp A KHÔNG bắt buộc lý do (migration
  `20261203_attendance_c1_reason_optional.sql`, **chạy tay**; nhật ký ghi "Chấm có mặt (A)"); Có mặt B, các loại nghỉ,
  Xoá chấm vẫn bắt buộc. Mọi `CREATE OR REPLACE attendance_set_days` về sau chép từ file 20261203.
- Migration 20261203 + 20261204 ĐÃ CHẠY, test PASS 2026-11-20. Giao diện: ô Tháng của bộ lọc rộng 1,2 phần (lưới riêng
  trong FilterBar, không sửa FilterBar dùng chung); cột ngày xen kẽ nền/viền đậm–nhạt (`dayColCls`), cột hôm nay giữ màu
  nhấn. Test PASS 2026-11-20.
- Khoảng trống đã biết: đổi nhân sự từ nhân viên sang công nhân KHÔNG chặn các ô "nghi_tua" đã có từ trước.

## GĐ C2 — Điểm danh ca (2026-11-20, chờ chạy migration + test tay)
Người dùng chốt (kế hoạch mục 10): gửi / duyệt / trả về THEO TỪNG PHẦN; Tổ tiếp nhận / Cơ điện / Nâng hàng = 1 phần / ngày
(ca NULL), Ca sản xuất = 1 phần / ca; trực ca mở được ca khác ca phân công (cảnh báo + `ngoai_phan_cong`); 1 người ở nhiều
phần cùng ngày ⇒ Có mặt nếu có mặt ≥ 1 phần, xếp B nếu bất kỳ phần nào B. **Đã duyệt ⇒ KHOÁ**: phần không sửa / trả về được;
ngày công `attendance_records.sheet_line_id` khác NULL ⇒ `attendance_set_days` / `attendance_clear_days` từ chối (chỉ admin,
lý do bắt buộc).
- Migration `20261205_attendance_c2_shift_sheets.sql` (**chạy tay TRƯỚC deploy**, sau 20261204): `attendance_qr_points`
  (token base64url 22), `attendance_daily_sheets` (UNIQUE ngày + dây chuyền, mã `F01-ddmmyy` / `F02-ddmmyy`, trạng thái SUY
  bằng `attendance_recompute_sheet`), `attendance_sheet_sections`, `attendance_sheet_lines` (UNIQUE phần + người;
  `thay_cho_staff_id` trên dòng NGƯỜI THAY). RLS chỉ SELECT. RPC: `attendance_resolve_qr`, `attendance_open_section`
  (trực ca chỉ hôm nay / hôm qua; người chấm công mọi ngày quá khứ), `attendance_save_section` (thay toàn bộ dòng, 1 giao
  dịch), `attendance_submit_section` (+ chuông người có approve / mark_all), `attendance_review_sections` (duyệt ⇒ ghi ngày
  công nguồn `truc_ca`, KHÔNG đè `bo_sung_tay`, log `duyet_phieu`; trả về ⇒ lý do bắt buộc + chuông trực ca),
  `attendance_quick_add_worker` (công nhân `cho_xac_nhan`, trùng tên ⇒ trả người cũ). Mọi `CREATE OR REPLACE
  attendance_set_days / clear_days` về sau chép từ file này.
- Quyền sửa phần: người lập (`truc_ca_user_id`) có `shift_check`, hoặc mark / mark_all / admin; chỉ khi `dang_lam | tra_ve`.
- Màn `/dashboard/attendance/shift?qr=<token>` (hoặc `?section=<id>` từ chuông; layout bypass sidebar): chọn dây chuyền / ngày /
  phần / ca (tự theo `production_shift_assignments`) → "Mở điểm danh" → danh sách mặc định `buildDefaultLines`
  (`src/lib/attendance/shift.ts`): mỗi công việc hiện max(số người gợi ý, số người có việc đó mặc định) dòng; Ca sản xuất thêm
  công nhân của ca chưa có việc ở nhóm "Chưa phân công việc". Ô trống không lưu. Chọn người thay ⇒ tự thêm dòng người thay
  nhận đúng việc. Ô Xe khi việc có `loai_xe`, mặc định xe người đó là tài xế chính/phụ. Lưu nháp / Gửi chấm công (chỉ online).
- Song ngữ: `src/lib/attendance/khmer-ui.json` + `i18n.ts` (`at`, `bilingual`); xuất file chuyên gia bằng
  `node scripts/export-attendance-khmer.mjs` (70 chữ màn điểm danh, máy dịch).
- Văn phòng: tab "Phiếu điểm danh" (`?tab=sheets`, `sheet-review-list.tsx`) + chi tiết `/dashboard/attendance/sheet/[id]`
  (Duyệt / Trả về từng phần, "Duyệt mọi phần đã gửi"). Chuông `getAttendanceTasks`. Registry `attendance_sheet`.
- Cài đặt → Chấm công → "Điểm QR điểm danh" (`attendance-qr-points-card.tsx`): thêm / sửa / tạo lại token / in tem
  (`buildQrLabelsPdf`). QR = `buildAttendanceQrUrl` (domain qlsxkpt.vercel.app như tem thiết bị).
- Chưa làm: chi tiết phiếu chưa có PDF F01/F02 (GĐ C7); không có hàng đợi mất mạng; Lịch công chưa tô ô đã khoá (RPC báo lỗi
  khi chấm vào); `ket_thuc_luc` + khối nhân sự ca ở chi tiết lô = C2b.

## C2 làm lại "lưới ô người" (2026-11-22/23) — GĐ1 test PASS, GĐ2–3 chưa làm
Bàn giao + mô hình đầy đủ: `.claude/plans/ban-giao-cham-cong-c2-luoi.md`. Thay mô hình "phần" ở mục GĐ C2 trên: 1 phiếu / CA
(section `loai = 'ca_san_xuat'`), dòng nhiều việc (`cong_viec_ids`), người vắng có người thay (`thay_the_staff_id` /
`thay_the_ten` gõ tay — không tạo nhân sự). Migration `20261206_attendance_c2b_grid.sql` ĐÃ CHẠY (mọi CREATE OR REPLACE
save / submit / review_section về sau chép từ file này). Danh mục 48 việc theo F01/F02 cải tiến (tổ `co_dien` = "Cơ điện – nâng
hàng", việc mẫu cũ đã tắt). `maintenance_staff.to_vai_tro` / `to_pham_vi` (tổ trưởng / tổ phó in phiếu, thiếu ⇒ không in).
`personnel_groups.hien_diem_danh` = nhóm hiện thành THẺ trong CÙNG màn điểm danh của trực ca (không phải màn / phiếu riêng).
`export_orders.nguoi_xuat_hang_ids` (UI ở GĐ3).
