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

### GĐ2 màn lưới + văn phòng (2026-11-23, chờ test tay)
- `/dashboard/attendance/shift` viết lại: mở màn TỰ mở phiếu ca (`attendance_open_section(..., 'ca_san_xuat', ca)`), chip Ca
  (mặc định ca được phân công) / Dây chuyền (mặc định `day_chuyen_mac_dinh` của trực ca → của điểm QR) / ngày trên header.
  Thẻ = "Ca X" + nhóm `hien_diem_danh` + "Khác" (người có dòng ngoài các thẻ). Ô người `_components/worker-tile.tsx`,
  tấm chọn việc `job-sheet.tsx` (nhiều việc, A/B, xe khi việc có `loai_xe`, người thay từ công nhân ca khác + thành viên nhóm
  hoặc tên gõ tay "(tạm)"), bước gửi `submit-review.tsx` (vắng: có / không phép + lý do; công nhân ca chưa giao: Vắng / Bỏ qua).
- Tự lưu 2 s sau thay đổi cuối (`attendance_save_section`, chỉ gửi người có việc hoặc vắng), lỗi ⇒ thử lại sau 8 s; đổi ca /
  dây chuyền / ngày / rời màn ⇒ lưu ngay trước. Phiếu ca mới chưa có dòng ⇒ gợi ý từ phiếu cùng dây chuyền + ca gần nhất
  (10 phiếu ngày trước) — chỉ chép việc + xe, banner "Xoá hết việc".
- Hàm thuần `src/lib/attendance/shift.ts`: `buildRosterTabs`, `classifyTile`, `countRoster`, `suggestFromPrevious`,
  `linesToPayload`, `jobIdsOf` (dòng cũ chỉ có `cong_viec_id`). Đã bỏ `buildDefaultLines` / `validateLines`.
- Văn phòng: danh sách thêm cột "Người thay"; chi tiết phiếu = mỗi phiếu ca 1 khối, cột Việc (nhiều) + Người thay ("(tạm)").


### Sửa sau test GĐ2 (2026-11-23, chờ chạy migration 20261207 + test tay)
- Thẻ ↔ loại việc: `personnel_groups.diem_danh_to_nhom` (tiep_nhan | co_dien | ca_san_xuat; trống = mọi tổ trừ ca SX), chọn ở
  Cài đặt → Chấm công → Điểm QR → "Loại việc của từng thẻ". Thẻ Ca chỉ việc `ca_san_xuat`; thẻ "Khác" mọi việc. Hàm thuần
  `jobsForTab` (shift.ts) luôn giữ việc đang có trên dòng. Thành viên nhóm có thẻ riêng KHÔNG hiện ở thẻ Ca.
- Nhóm hệ thống "Tổ tiếp nhận" (code tiep_nhan) — thêm thành viên ở Cài đặt → Nhân sự.
- `attendance_job_types.an_diem_danh` (ô "Ẩn ở màn điểm danh" ở form công việc): Trực xuất hàng — chọn người ở đơn xuất.
- Bước gửi có khối tóm tắt (dây chuyền · ca · ngày · mã, số có mặt / vắng / người thay, bảng theo việc).
- RPC `attendance_reopen_section(section, ly_do)` — CHỈ admin mở lại phiếu ca đã duyệt (UI ở GĐ3). Bảng bản cứng
  `attendance_sheet_snapshots` + bucket `attendance-sheet-reports` (dùng ở GĐ3).
- Sau test lần 2 (2026-11-23): màn điểm danh nạp quyền mới nhất (`hydrateActiveSession`, lỗi mạng mới dùng cache); KHÔNG có
  quyền trực ca, hoặc có `shift_check` nhưng chưa được phân công ca nào (Cài đặt → Cấu hình nhà máy → Phân công trực ca) và
  không có mark / mark_all ⇒ chỉ hiện thông báo + Về trang chính / Đăng xuất. Lưới xếp nam → nữ → chưa khai giới tính
  (`genderRank`). Đăng xuất có lớp phủ "Đang đăng xuất...". Khmer: dây chuyền, tên thẻ theo code nhóm (tiep_nhan / co_dien /
  bao_tri), "Khác". Icon xám = chưa khai giới tính (không phải bị khoá).
- Test lần 2 PASS (2026-11-23). Header màn điểm danh: tiêu đề "QR điểm danh <tên điểm QR>" + mã phiếu; góc phải = tên +
  chức vụ thật (`chuc_vu_chinh_quyen || chuc_vu`), bấm ⇒ menu. Cài đặt → Điểm QR: xem QR có "Tải PNG" (`OrderQrDownload`),
  admin xoá được điểm QR. Bàn giao GĐ3 (+ vị trí Ca trưởng / Tổ trưởng mặc định, đổi người thay):
  `.claude/plans/ban-giao-cham-cong-c2-gd3.md`.

### GĐ3 (2026-11-24, chờ chạy migration 20261208 + test tay)
- **Admin mở lại phiếu ca đã duyệt**: chi tiết phiếu, nút "Mở lại để sửa" (chỉ `role = admin`) ⇒ `ReasonConfirmDialog` ⇒
  RPC `attendance_reopen_section` (20261207).
- **Vị trí phụ trách** (migration `20261208_attendance_section_positions.sql`, **chạy tay TRƯỚC deploy** — `SECTION_SELECT` đọc
  cột `vi_tri`, thiếu cột là mọi màn chấm công lỗi). Người dùng chốt: (a) người giữ vị trí = có mặt A dù không giao việc;
  (b) người mặc định bị thay ⇒ tự VẮNG, người thay = người giữ mới, chọn phép lúc gửi; (c) cả 3 tổ; (d) Ca trưởng = Tổ trưởng ca.
  `attendance_sheet_sections.vi_tri` = 6 khoá `<ca_san_xuat|tiep_nhan|co_dien>.<to_truong|to_pho>` → `{staff_id, goc_staff_id}`.
  Phiếu chưa có vị trí ⇒ màn trực ca điền mặc định theo hồ sơ (`defaultPositions`, `to_vai_tro` + `to_pham_vi`, ca SX theo
  `ca_mac_dinh`). Khối "Vị trí phụ trách" (`shift/_components/position-block.tsx`) trên lưới; ô người giữ vị trí có nhãn tím.
  Hàm thuần: `applyPositionChange`, `positionHolderIds`, `classifyTile(line, isHolder)`, `linesToPayload(lines, holderIds)`
  (người giữ chưa có dòng ⇒ thêm dòng Có mặt A). RPC save nhận `p_header.vi_tri`, đồng bộ `to_truong_staff_id` /
  `to_pho_staff_id` / `ca_truong_ten`. Mọi `CREATE OR REPLACE attendance_save_section` về sau chép từ 20261208.
- **Đơn xuất**: ô "Người trực xuất hàng" (nhóm `xuat_hang`, `export_orders.nguoi_xuat_hang_ids`), chi tiết đơn hiện tên.
- **Kết thúc ca** (màn quét TP): sau khi dựng phiếu F09 thành công gọi `attendance_close_shift(ngày, ca của Hub)` best-effort.
- **Phiếu F01/F02**: tab "Phiếu F01/F02" ở chi tiết phiếu. Dữ liệu `sheet-report-actions.ts` (`loadF01Model`, service role,
  quyền attendance.view|approve|mark_all|shift_check); mô hình `src/lib/attendance/f01-model.ts`; vẽ Canvas → JPEG → jsPDF A4
  `f01-sheet.ts` (QR góc phải trên, chân trang mã tài liệu, bảng Vắng cuối mỗi ca, chỉ in việc có người, người thay ghi
  "(thay X)", Trực xuất hàng ∪ người trên đơn xuất ĐÃ DUYỆT cùng ngày cùng dây chuyền). Giờ ca = `bat_dau_luc` – `ket_thuc_luc`.
  Chữ in song ngữ ở `khmer-ui.json` nhóm "Phiếu F01/F02" (`nguon: mau_giay` = chép mẫu giấy).
- **Bản cứng F01/F02 + dấu duyệt**: đủ duyệt = mọi phiếu ca `da_duyet`; `approval_key` = sha256 `section_id:duyet_luc`; lần mở
  đầu sau khi đủ duyệt dựng PDF có dấu (`src/lib/pdf-approval-stamp.ts`) rồi lưu (`attendance_sheet_snapshots`, bucket
  `attendance-sheet-reports`); mở lại dùng đúng bản đó (`f01-client.ts`). Admin mở lại ⇒ key đổi ⇒ bản mới. Lỗi lưu không chặn xem.
- **F09**: bản cứng mới (ngày khoá đủ ca) có dấu "Đã duyệt: <người khoá ca cuối> · giờ khoá" (`loadDayLockState` trả
  `lastLockName/lastLockAt`). Bản cứng cũ bất biến. Không áp F11/F12.
- Sửa sau test 2026-11-24 (migration `20261209_attendance_logs_fix_delete_sheet.sql`, **chạy tay**): ràng buộc
  `attendance_logs.hanh_dong` trên DB thật thiếu `mo_lai_phieu` (phần đó của 20261207 không được áp) ⇒ thêm lại + `xoa_phieu`;
  RPC `attendance_delete_sheet` (CHỈ admin, lý do) xoá cả phiếu ngày, tính lại ngày công truc_ca từ phiếu khác (nút "Xoá phiếu"
  ở chi tiết); bỏ FK `attendance_sheet_snapshots.sheet_id`. Form Nhân sự: "Vai trò trong tổ" = Không ⇒ ô "Của tổ" khoá
  (người thường để Không); lưu chặn trùng vị trí (`findRoleConflict`: cùng vai trò + tổ + ca (ca SX) + dây chuyền giao nhau).
  F01/F02: mỗi việc 1 dòng (chữ tự thu), nhiều người nối "A, B", người thay in nghiêng, xếp loại "A-A-B", KHÔNG in người vắng,
  Ngăn / Chỉ thị xuống dòng đủ chữ, chân trang chỉ số trang. Dấu duyệt kiểu Văn bản: tick xanh + chữ xám
  "Phiếu được duyệt bởi {Tên} dd/mm/yyyy hh:mm:ss" (cả F09).

### Ca / Tổ điểm danh (2026-11-24, chờ chạy migration 20261210 + test tay)
Người dùng chốt: Tổ xử lý nước thải, Tổ tiếp nhận mủ tạp, Tổ cơ điện – bảo trì – xe nâng hoạt động như Ca A/B/C; thêm được
ca/tổ mới; mỗi ca/tổ có trưởng/phó (trống thì phiếu để trống); tổ ⇒ "Tổ trưởng / Tổ phó", ca ⇒ "Ca trưởng / Ca phó"; thành
viên = nhân sự có "Ca/Tổ mặc định" là đơn vị đó; tổ dùng chung 2 dây chuyền đi theo dây chuyền người điểm danh chọn — cùng
ngày + cùng dây chuyền ⇒ chung 1 phiếu.
- Migration `20261210_attendance_units.sql` (**chạy tay TRƯỚC deploy**): bảng `attendance_units` (code bất biến, tên, tên Khmer,
  loai ca|to, to_nhom = loại việc hiện khi giao, thứ tự, đang dùng; seed TN_MT, XLNT, CD, A, B, C); bỏ CHECK ca A/B/C ở
  `maintenance_staff.ca_mac_dinh`, `production_shift_assignments.ca`, `attendance_sheet_sections.ca` (cột `ca` nay giữ MÃ đơn vị,
  section vẫn `loai = 'ca_san_xuat'`); chuyển `to_pham_vi` cũ → `ca_mac_dinh` CD / TN_MT (chỉ khi đang trống); `vi_tri` 6 khoá →
  `{truong, pho}`; `attendance_qr_points.unit_code`; đổi mã phiếu cũ sang `TKSXMT-` / `TKSXMN-` + ddmmyy. `attendance_open_section`
  mới: người không có mark / mark_all / admin phải có dòng `production_shift_assignments` với `ca = mã đơn vị`. Mọi
  `CREATE OR REPLACE attendance_open_section / attendance_save_section` về sau chép từ file 20261210.
- Cài đặt → Chấm công → "Ca / Tổ" (`attendance-units-card.tsx`, không xoá — chỉ tắt). Nhân sự: "Ca/Tổ mặc định" + "Vai trò trong
  ca/tổ" (trưởng/phó), chặn trùng (`findRoleConflict`: cùng vai trò + cùng Ca/Tổ + dây chuyền giao nhau). Điểm QR có "Ca/Tổ mặc
  định". Phân công điểm danh (`shift-assignments-tab.tsx`) liệt kê mọi Ca/Tổ.
- Màn điểm danh: ô chọn Ca/Tổ (người được phân công chỉ thấy đơn vị của mình; mark / mark_all thấy tất cả), thẻ chính = người có
  Ca/Tổ mặc định là đơn vị đó; khối vị trí 2 ô trưởng / phó theo loại đơn vị.
- Phiếu TKSX (tab "Phiếu TKSX", trước là "Phiếu F01"): mỗi Ca/Tổ có phát sinh 1 khối theo `sort_order`; khối ca có giờ ca + sản
  lượng; QR nhỏ hơn 20%. `loadUserShiftAssignment` (màn quét TP) chỉ lấy ca A/B/C.
- Sau test 2026-11-24 (migration `20261211_attendance_unit_jobs.sql`, **chạy tay sau 20261210**). Người dùng chốt: nhóm nhân sự
  chỉ là nhóm CHUYÊN MÔN (KPI, người thực hiện biên bản, người trực xuất hàng) — màn điểm danh KHÔNG còn thẻ nhóm (migration tắt
  `hien_diem_danh`, Cài đặt → Điểm QR bỏ mục thẻ nhóm); trực ca chỉ `shift_check` chỉ thấy đúng Ca/Tổ được phân công, người thay
  mượn từ ca/tổ khác nằm ở thẻ "Khác" và chỉ nhận việc của Ca/Tổ đang điểm danh. Trực ca / Trực xuất hàng là NHIỆM VỤ, không phải tổ.
  `attendance_units.day_chuyen`: NULL = chọn khi điểm danh (Ca A/B/C, tổ độc lập Cơ điện / XLNT / Đội xe cơ khí `XE_CK` mới — mỗi
  dây chuyền phân công riêng, in ở cả TKSXMT lẫn TKSXMN, người có ở cả 2 thì in 2 phiếu, ngày công 1 lần); `Mủ tạp` (TN_MT) /
  `Mủ nước` (Tổ tiếp nhận mủ nước `TN_MN` mới) = khoá dây chuyền (RPC open chặn, màn điểm danh khoá nút). Việc:
  `attendance_job_types.unit_code` (việc của tổ, `day_chuyen` NULL được), việc ca = `unit_code` NULL + `ca_san_xuat` + dây chuyền;
  hàm `isJobOfUnit` / `jobsForUnit` (shift.ts). Migration chuyển việc tiếp nhận MT → TN_MT, MN → TN_MN, "Trực hồ XLNT" → XLNT,
  cơ điện → CD (bản Mủ nước trùng tên tắt). Cài đặt → Công việc: chip theo "Thuộc" (Ca sản xuất · dây chuyền / từng tổ).
### Sửa sau test production (2026-11-25, chờ chạy migration 20261212 + test tay)
- Lỗi 25/11 (TKSXMT-251126): mở màn điểm danh ⇒ RPC open tạo phiếu Ca A (đơn vị mặc định) + TỰ LƯU vị trí Ca trưởng mặc
  định ⇒ phiếu Ca A có 1 dòng ⇒ phiếu ngày không "đủ duyệt" ⇒ TKSX không có dấu duyệt; phải gửi Ca A với 21 người "có phép" (sai).
  Sửa: (a) màn điểm danh KHÔNG tự lưu khi chỉ điền sẵn vị trí / gợi ý phiếu trước — lần sửa đầu mới lưu; (b) phiếu ca TRỐNG
  (dang_lam, 0 dòng) không tính vào trạng thái phiếu ngày (`attendance_recompute_sheet`, migration
  `20261212_attendance_empty_sections.sql`) / dấu duyệt + mô hình TKSX (`sheet-report-actions.ts`) / danh sách + chi tiết;
  (c) RPC `attendance_discard_section` "Bỏ phiếu ca" (Ca/Tổ không làm việc): chưa duyệt ⇒ người lập / mark / mark_all / admin;
  đã duyệt ⇒ chỉ admin + lý do, ngày công tính lại như xoá phiếu ngày. Mọi `CREATE OR REPLACE attendance_recompute_sheet` chép từ 20261212.
  Dữ liệu 25/11: admin bấm "Bỏ phiếu ca" ở dòng Ca A (tab Phiếu TKSX, dòng xổ).
- Migration 20261212 xoá công việc ĐÃ TẮT chưa dòng / hồ sơ nào dùng (16 việc mẫu cũ, kiểm 2026-11-25: 0 tham chiếu).
- Màn điểm danh: thẻ việc hiện SỐ người đang nhận việc đó; "Gửi tất cả" (admin / mark / mark_all) gửi mọi phiếu ca đang lập /
  trả về có dòng của phiếu ngày — Ca A/B/C người chưa giao tự VẮNG CÓ PHÉP, tổ bỏ qua; phiếu thiếu lý do không phép không gửi
  (`shift/_components/send-all-dialog.tsx`). Bước gửi 1 phiếu: Ca ⇒ người chưa giao mặc định Vắng có phép, Tổ ⇒ mặc định Bỏ qua.
- Tab Phiếu TKSX: thao tác dòng = Xem · Tải PDF · Sửa (mở phiếu ca sửa được đầu tiên) · Xoá phiếu ngày (admin); dòng phiếu ca:
  Sửa · Bỏ phiếu ca. Tải PDF trên mobile lỗi "tải xuống không thành công" do thu hồi blob URL ngay sau click ⇒ `downloadF01`
  (`f01-client.ts`): bản cứng tải qua Signed URL có tên file, bản dựng trực tiếp giữ blob 60 giây.
- Cài đặt: Phân công điểm danh hiển thị dòng gọn sau khi lưu (Sửa / Xoá); Nhân sự gọn (chip tóm tắt, panel tài khoản thu gọn,
  ẩn tài khoản đã khoá, bảng `enterprise-table`, gộp 3 cột chức vụ); `.row-hover` bỏ `transform: scale` (làm bảng cuộn ngang giật).
- Sau test A–H (2026-11-25, chờ chạy migration `20261213_attendance_shift_end_by_scan.sql` + test tay):
  - Tấm chọn việc: mỗi thẻ việc hiện số + dòng tên "A, B +n" (PC rê chuột thấy đủ tên) — prop `jobPeople`.
  - Dropdown Ca/Tổ: đơn vị người đăng nhập được phân công in đậm + "★".
  - Mở phiếu Ca/Tổ có việc tên "Trực ca" (`findTrucCaJob`, hiện là Tổ cơ điện) ⇒ người đăng nhập tự có dòng "Trực ca" có mặt
    A (chỉ điền sẵn, lưu ở lần sửa đầu / khi Gửi).
  - `lot_transactions.quet_luc` = giờ quét kiện thật (giờ tạo nháp); `submit_confirm_draft_batch` chép từ 20261213 (mọi CREATE
    OR REPLACE về sau chép từ file này). TKSX: giờ kết thúc khối ca = kiện quét cuối của ca (`quet_luc ?? created_at`, dây
    chuyền của phiếu); không có kiện ⇒ giờ "Kết thúc ca".
  - Trigger `trg_attendance_guard_shift_approve`: phiếu Ca sản xuất (đơn vị loại ca) chỉ sang `da_duyet` khi ngày + ca có kiện
    TP thì ca đó đã "Phê duyệt" ở Thành phẩm (`product_shift_is_locked`, không tách dây chuyền). Dấu duyệt TKSX bỏ khi có kiện
    quét sau giờ duyệt (`hasScanAfter`, cảnh báo vàng). Chi tiết phiếu hiện "Thành phẩm: đã / chưa phê duyệt ca".
  - Ngăn trên TKSX = `ma_ngan` đầy đủ.
- Tài khoản test + đã khoá: `scripts/delete-disabled-accounts.mjs` (xem trước → `--apply`; bảng nghiệp vụ không ON DELETE
  ⇒ tài khoản có lịch sử tự bị giữ lại). ĐÃ `--apply` 2026-11-25: xoá 3 (Chau Kim Sêne, Nguyễn Trung Cường, User Test),
  giữ 6 (5 tài khoản E2E + Vương Nguyễn Phương Lâm — có lịch sử).
## C2b Truy vết nhân sự ca ở chi tiết lô (2026-11-25, chờ test tay)
Người dùng chốt: tab + thẻ tóm tắt; người chỉ có quyền Thành phẩm thấy Việc + Người + Xe; xếp loại A/B, người vắng, link
"Mở phiếu" CHỈ cho người có attendance.view|approve|mark_all|shift_check (hoặc admin); phiếu chưa duyệt vẫn hiện + nhãn vàng.
Không migration.
- Server action `product/lot/[id]/shift-staff-actions.ts` `loadLotShiftStaff(token, factoryId, lotId)` (service role — RLS
  attendance_* chặn người chỉ có product.view): giao dịch của lô gom theo (ngày, ca) → kiện, bành, kg; phiếu ngày theo
  dây chuyền của lô (`lots.day_chuyen || dayChuyenForCsr`) → phiếu Ca sản xuất cùng mã ca (bỏ phiếu ca trống). Giờ ca =
  sớm hơn giữa kiện quét đầu của CẢ ca và lúc mở phiếu → kiện quét cuối (dự phòng `ket_thuc_luc`).
- Quy tắc đọc dòng dùng chung F01/F02 + C2b: `src/lib/attendance/section-people.ts` (`linePerson`, `lineJobIds`,
  `slotHolderText`, `isEmptyOpenSection`). Sửa quy tắc người thay / việc ở đây.
- UI `product/lot/[id]/_components/lot-shift-staff.tsx`: tab "Nhân sự ca" (mỗi ngày + ca 1 khối, bảng Việc | Người | Xe |
  [Xếp loại], dòng Vắng) + thẻ "Ca sản xuất" cột phải (bấm ⇒ mở tab).
- C2b test PASS, commit `2baf33b` (2026-11-25). Giờ bắt đầu khối Ca trên TKSX nay = sớm hơn giữa kiện quét đầu của ca và
  `bat_dau_luc` (`startOf` trong `sheet-report-actions.ts`, người dùng chốt); tổ vẫn `bat_dau_luc`. Bản cứng cũ bất biến.
  Ca sản xuất KHÔNG quét kiện nào trong ngày ⇒ để TRỐNG cả giờ bắt đầu lẫn kết thúc (phiếu in "……"; giờ mở phiếu không phải
  giờ làm thật — người dùng chốt 2026-11-25).

## C3 Có mặt tự động cho NHÂN VIÊN (2026-11-25, migration 20261214 ĐÃ CHẠY, test PASS, đã push)
Người dùng chốt: chỉ thao tác GHI dữ liệu (tạo / ký / duyệt / ghi sổ) mới tính — đăng nhập / xem không tính; ngày đã chấm
Nghỉ (nguồn cao hơn) mà có thao tác ⇒ GIỮ chấm, gắn cờ mâu thuẫn; có mặt tự động KHÔNG có xếp loại A/B.
- Migration `20261214_attendance_c3_auto_presence.sql` (**chạy tay TRƯỚC deploy**): cột `attendance_records.hoat_dong` jsonb
  (`[{nguon, luc}]`, giờ sớm nhất mỗi nguồn); hàm chỉ đọc `attendance_collect_activity(factory, from, to)` (service_role) gom
  ~20 bảng nguồn (nhãn: dieu_xe, san_luong, thanh_pham, kiem_nghiem, xuat_hang, do_nhanh, bao_tri, kho, de_nghi_mua, ky_so, iso,
  ghi_chu, dong_ho, kpi, diem_danh) + `cham_diem_d` = người ĐƯỢC chấm `kpi_daily_evaluations` theo cột `ngay`; RPC
  `attendance_sync_auto(factory, from, to)` (cần `attendance.view`, ≤ 62 ngày, tới hôm nay): chỉ nhân viên có `profile_id`, trong
  khoảng vào làm – nghỉ việc; chưa có dòng ⇒ Có mặt nguồn `cham_diem_d` | `auto_app`; dòng tự động cập nhật nguồn (D > app) +
  `hoat_dong`, mất hết hoạt động ⇒ xoá; dòng `truc_ca` / `bo_sung_tay` chỉ cập nhật `hoat_dong`. Không ghi `attendance_logs`.
  Thêm bảng nguồn mới ⇒ thêm 1 nhánh `union all` + nhãn `ACTIVITY_LABEL` (`src/lib/attendance/calendar.ts`).
- Cờ mâu thuẫn KHÔNG lưu cột: `isAttendanceConflict` = trạng thái ≠ có mặt và `hoat_dong` không rỗng.
- Lịch công (`attendance-calendar.tsx`): mỗi lần tải tháng (đã bắt đầu) gọi sync trước; lỗi ⇒ dải vàng, lịch vẫn hiện; nút
  "Đồng bộ lại"; ô chấm D có chấm xanh nhỏ; ô mâu thuẫn viền cam; tooltip "Thao tác app: Sản lượng 08:15 · …"; thẻ "Ô mâu thuẫn"
  bấm để lọc. Đọc `select("*")` để chịu được khi chưa chạy migration.
- Bộ lọc Lịch công mặc định = phòng ban của người đăng nhập (đặt 1 lần sau lần tải đầu) + Loại "Nhân viên"; "Xóa lọc" về đúng
  mặc định đó, 2 giá trị mặc định không tính là đang lọc. `StatCard` có `onClick` (dùng chung mọi module): nổi lên khi rê, lún
  khi bấm, icon phễu góc phải, nền màu module khi đang lọc.
- Vận hành: xoá chấm tay một ngày có thao tác ⇒ lần đồng bộ sau tự thành Có mặt lại; muốn ghi vắng phải chấm Nghỉ (hiện cờ).
- Kiểm: `node --env-file=.env.local scripts/check-attendance-auto.mjs [--month=2026-11]` (chỉ đọc; đối chiếu 4 nguồn lớn bằng JS,
  liệt kê ô mâu thuẫn / ô tự động sẽ bị bỏ). Không có cron — C5 phải gọi sync trước khi "Tính điểm tháng".

## C4 Sổ phép thưởng + chuỗi 3 tháng (2026-11-25, migration 20261215 ĐÃ CHẠY, test PASS)
Người dùng chốt: chỉ NHÂN VIÊN quốc tịch VIỆT NAM (`maintenance_staff.quoc_tich` VN | KH | KHAC, để trống ⇒ chưa xét, admin tự
khai — Cài đặt → Nhân sự lọc "Chưa khai quốc tịch"); tháng đủ = có mặt MỌI ngày lịch (tua, phép, ô trống, vào làm / nghỉ việc giữa
tháng đều đứt chuỗi); đủ 3 tháng liên tiếp trong năm ⇒ +1 phép, đếm lại; dùng phép = người chấm tick "Dùng phép thưởng" khi chấm
Nghỉ có phép (phiếu ca duyệt không tự trừ); sửa ngược làm tháng hết đủ ⇒ tự thu hồi (dòng −1), đã dùng ⇒ số dư âm; chỉ admin
cộng / trừ tay (lý do); xem theo quyền Lịch công.
- Migration `20261215_attendance_c4_bonus_leave.sql` (**chạy tay TRƯỚC deploy**): `attendance_leave_ledger` (insert-only; loai
  tich_luy | thu_hoi | dieu_chinh; `chuoi_key` "2026-01..2026-03"; `hieu_luc_tu` = đầu tháng sau chuỗi, điều chỉnh = 01/01); hàm
  `attendance_leave_flags_internal` (nội bộ) / `attendance_leave_month_flags` (lọc người xem được), RPC `attendance_leave_recompute`
  (idempotent, so net theo chuỗi), `attendance_leave_adjust` (admin). `attendance_set_days` bản 7 tham số (`p_dung_phep_thuong`,
  bản 6 tham số đã DROP) — kiểm số dư theo năm + chỉ dùng phép đã có hiệu lực tới ngày đó. Mọi `CREATE OR REPLACE
  attendance_set_days` về sau chép từ file này.
- Số ngày ĐÃ DÙNG không ghi sổ: đếm `attendance_records.dung_phep_thuong` trong năm ⇒ đổi trạng thái / xoá chấm / duyệt phiếu ca
  đè ⇒ tự hoàn phép. Số dư = Σ sổ năm − đã dùng. Phép năm N chỉ dùng trong năm N (chuỗi T10–T12 hiệu lực 01/01 năm sau ⇒ mất).
- Thuần: `src/lib/attendance/leave.ts`. Lịch công gọi recompute mỗi lần tải tháng, hộp chấm có ô tick + số dư, ô dùng phép có chấm
  vàng. Tab "Sổ phép" (`?tab=leave`, `_components/bonus-leave-book.tsx`): 12 ô tháng, chuỗi hiện tại, Đạt / Thu hồi / Điều chỉnh /
  Đã dùng / Số dư, dòng xổ lịch sử sổ, "Xét lại chuỗi" (đồng bộ auto đầu tháng trước → nay rồi recompute), admin "Điều chỉnh".
- Kiểm: `node --env-file=.env.local scripts/check-attendance-leave.mjs [--nam=2026]` (chỉ đọc) — sau khi mở tab Sổ phép, lệch = 0.
- Lịch công (sau test mục 10, 2026-11-25): mọi thẻ số liệu bấm được để lọc (Nhân sự = bỏ lọc thẻ, Có mặt, Không phép, Chưa ghi
  nhận, Mâu thuẫn); bộ lọc Tìm → Tháng → Phòng ban (rộng) → … → Xóa lọc (hẹp).

## C5 KPI dùng hệ số chuyên cần mới (2026-11-25, migration 20261216 ĐÃ CHẠY localhost, test PASS)
Công thức + quy tắc: rule 27 mục "Hệ số chuyên cần". Migration `20261216_kpi_c5_attendance_factor.sql` (chạy tay TRƯỚC deploy):
- Lõi KHÔNG kiểm quyền `attendance_sync_auto_internal` / `attendance_leave_recompute_internal(…, p_actor)` (chỉ service_role +
  gọi nội bộ); `attendance_sync_auto` / `attendance_leave_recompute` thành vỏ kiểm quyền. Mọi `CREATE OR REPLACE` 2 lõi này về
  sau chép từ 20261216.
- `kpi_attendance_summary_internal(factory, nam, thang)` gom `attendance_records` theo tài khoản (1 hồ sơ / tài khoản: ưu tiên
  nhân viên, đang dùng); `kpi_attendance_month_summary` = bản giao diện (chính mình / admin / kpi.view_all / kpi.manage_config).
- `kpi_score_weights.so_ngay_nghi_tua_chuan`, `he_so_phat_khong_phep` (Cài đặt → KPI & 5S → Trọng số).
- Script chỉ đọc `scripts/compare-kpi-attendance-factor.mjs [--months=2026-10,2026-11]` (tự kiểm JS ↔ SQL; dòng v2 lệch).
- Lưu ý vận hành: ngày không thao tác app + chưa ai chấm ⇒ "chưa ghi nhận" ⇒ hệ số thấp (T10: nhiều người 0,75–0,84).

## Màn điểm danh — header 2 dòng + thẻ người (A1, 2026-11-26, test PASS)
- Header `attendance/shift/page.tsx` ĐÚNG 2 dòng, không cắt chữ: [icon "QR điểm danh"] … [ngày][1 nút ngôn ngữ hiện ngôn ngữ sẽ
  chuyển sang][vòng tròn chữ cái đầu tên → menu họ tên + chức vụ + Về trang chính + Đăng xuất] / [Ca/Tổ giãn ★][Mủ tạp|Mủ nước].
  Trạng thái phiếu + mã phiếu + điểm QR = dải đầu nội dung; trạng thái tự lưu ở thanh đáy. Thêm nút vào header phải kiểm 360 px + Khmer.
- Thẻ người: nhãn việc đủ chữ (≤ 2 dòng), huy hiệu khi đã giao việc, icon giữ màu giới tính; Nam → Nữ → chưa khai (`compareStaffOrder`).
- Việc "Vệ sinh tạp vụ" đổi tên "Vệ sinh dây chuyền" (migration `20261217_attendance_rename_ve_sinh.sql`, cả Mủ tạp + Mủ nước).
- Đã chốt chưa làm (bàn giao `ban-giao-cham-cong-ca-to.md` mục 14): A2 việc của tổ phải chọn ca (`ca_lam`), A3 sơ đồ dây chuyền
  kéo-thả theo quyền, B tua chuẩn theo tháng + thẻ Chuyên cần (chỉ số phụ KPI).
