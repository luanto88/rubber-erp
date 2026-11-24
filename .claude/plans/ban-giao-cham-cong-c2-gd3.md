# Bàn giao Chấm công C2 — GĐ3 + L4 (viết 2026-11-23, sau khi GĐ2 + sửa sau test đã PASS và commit)

Đọc kèm (theo thứ tự): CLAUDE.md, rule 29, rule 31 (mục "C2 làm lại" → "Sửa sau test GĐ2"), rule 06 mục 4.15 (bản cứng
F09/F11/F12 — mẫu cho bản cứng F01/F02), `.claude/plans/ban-giao-cham-cong-c2-luoi.md` mục "GĐ 3" (yêu cầu gốc F01/F02),
`.claude/plans/ban-giao-cham-cong-c2-sua-sau-test-gd2.md` mục L4 + "Người dùng chốt 4 câu".
Mẫu giấy: `cung_cap_dl/NMCB-QT01-F01_new.pdf`, `cung_cap_dl/NMCB-QT01-F02 _new.pdf`.

## Trạng thái
- GĐ1 commit `0efb49f`; GĐ2 + sửa sau test (L1–L3, quyền, Khmer, header, Cài đặt điểm QR) đã commit (cùng commit chứa file
  này). CHƯA push — hỏi người dùng trước khi push.
- Migration `20261207_attendance_tabs_snapshots.sql` ĐÃ CHẠY (localhost = production DB). Đã có sẵn cho GĐ3:
  bảng `attendance_sheet_snapshots` (sheet_id, approval_key, storage_path, file_name, sha256, size_bytes, duyet_ten,
  duyet_luc, created_by; trigger bất biến; RLS chỉ SELECT), bucket private `attendance-sheet-reports`,
  RPC `attendance_reopen_section(p_section_id, p_ly_do)` (chỉ admin).
- Test tay PASS 2026-11-23: chặn người không quyền / chưa phân công ca, Khmer thẻ + dây chuyền, nam trước nữ sau, màn chờ
  đăng xuất, icon xám = chưa khai giới tính. Header: tiêu đề "QR điểm danh <tên điểm QR>" + mã phiếu; góc phải = tên người
  đăng nhập + chức vụ thật (`chuc_vu_chinh_quyen || chuc_vu`, dự phòng "Trực ca"), bấm ⇒ menu. Cài đặt → Chấm công → Điểm QR:
  xem QR có "Tải PNG" (dùng lại `OrderQrDownload`), admin có nút xoá (hard delete — không bảng nào tham chiếu điểm QR).
  (Header + xoá/PNG mới code, người dùng chưa test lại — kiểm nhanh đầu phiên.)

## Tiến độ 2026-11-24
- Mục 1–5 ĐÃ CODE (tsc + eslint sạch, CHƯA commit). 4 câu mục 1b đã chốt: (a) giữ vị trí = có mặt A; (b) người gốc bị thay ⇒
  tự vắng, chọn phép lúc gửi; (c) cả 3 tổ; (d) Ca trưởng = Tổ trưởng ca. Chi tiết: rule 31 mục "GĐ3".
- Migration mới `20261208_attendance_section_positions.sql` — CHƯA chạy (bắt buộc trước khi mở màn chấm công).
- Giờ ca trên F01/F02 = giờ mở phiếu ca (`bat_dau_luc`) – giờ bấm "Kết thúc ca" (`ket_thuc_luc`) — người dùng xác nhận khi test.
- Chưa kiểm được bằng trình duyệt thật (vẽ Canvas chỉ chạy trên trình duyệt).

## Người dùng đã chốt (KHÔNG hỏi lại)
1. Thành viên nhóm có thẻ riêng không hiện ở thẻ Ca.
2. Admin mở lại phiếu ca đã duyệt — CÓ (RPC đã có, cần UI).
3. Dấu duyệt chỉ F09 + F01/F02; KHÔNG F11/F12.
4. F01/F02 có bảng "Vắng" cuối mỗi ca (tên, có / không phép, lý do, người thay).
5. Đơn xuất chọn NGƯỜI trực xuất hàng (không chọn xe nâng), không bắt buộc.
6. Bản cứng giống phiếu thành phẩm: sinh ở lần render đầu SAU KHI đủ điều kiện, mở lại dùng đúng bản đó.

## Việc GĐ3 (làm theo thứ tự, mỗi bước tsc + eslint)
### 1. UI admin mở lại phiếu ca đã duyệt
- `src/app/dashboard/attendance/sheet/[id]/page.tsx`: mỗi khối phiếu ca `da_duyet` có nút nguy hiểm "Mở lại để sửa" — chỉ
  `user.role === 'admin'`; `ReasonConfirmDialog` (`src/app/dashboard/_components/reason-confirm-dialog.tsx`, lý do bắt buộc) ⇒
  `supabase.rpc("attendance_reopen_section", { p_section_id, p_ly_do })` ⇒ toast số ngày công cập nhật / xoá, tải lại.
- Màn trực ca đã hiện banner "bị trả về" theo `tra_ve_ly_do` (RPC ghi "Mở lại sau duyệt: …").

### 1b. Ca trưởng / Tổ trưởng / Tổ phó trên phiếu ca (yêu cầu mới 2026-11-23)
Người dùng: "Ca trưởng / tổ trưởng có thể KHÔNG được phân công việc, nhưng tên họ MẶC ĐỊNH nằm ở vị trí ca trưởng / tổ trưởng.
Khi người khác thay họ (họ nghỉ, người khác làm thay), người điểm danh chọn vị trí đó và gán người khác (người thay có thể
cũng không được phân việc)."
- Đã có cột trên `attendance_sheet_sections`: `ca_truong_ten` (text, RPC open điền từ `production_shift_names`),
  `to_truong_staff_id`, `to_pho_staff_id`. Chưa có UI và RPC save chưa ghi 2 cột staff (header chỉ nhận `ghi_chu`).
- Đề xuất: khối "Vị trí phụ trách" trên đầu lưới (trên thẻ): Ca trưởng · Tổ trưởng · Tổ phó (mỗi vị trí theo phạm vi:
  ca SX theo `to_pham_vi = 'ca_san_xuat'` + `ca_mac_dinh`; tổ tiếp nhận / cơ điện nếu cần). Mặc định = người có
  `to_vai_tro` tương ứng; chạm ⇒ chọn người khác trong danh sách (tìm nhanh). F01/F02 in đúng người đã chọn.
- Có thể cần migration mới: `ca_truong_staff_id` (ca trưởng hiện chỉ là tên text từ `production_shift_names`) và RPC
  `attendance_save_section` nhận thêm header `ca_truong_staff_id / to_truong_staff_id / to_pho_staff_id` (chép từ 20261206).
- HỎI người dùng trước khi làm (ngôn ngữ nghiệp vụ + ví dụ):
  (a) Người giữ vị trí nhưng không giao việc có được tính CÓ MẶT (ngày công A) không? Ví dụ tổ trưởng Khean Sok Khoeun chỉ
      điều hành, không có việc ⇒ có chấm công cho ông ấy không?
  (b) Người trưởng gốc bị thay ⇒ tự thành VẮNG (cần chọn có / không phép) hay để trực ca tự đánh dấu?
  (c) Vị trí áp dụng cho những tổ nào: chỉ ca sản xuất, hay cả Tổ tiếp nhận và Cơ điện – nâng hàng (mẫu F01 có dòng tổ trưởng
      từng mục)?
  (d) "Ca trưởng" và "Tổ trưởng ca" là 1 người hay 2 vị trí khác nhau trên phiếu?

### 2. Đơn xuất — người trực xuất hàng
- `src/app/dashboard/export/page.tsx` (form tạo/sửa đơn): ô chọn nhiều (`FilterMultiSelect fullWidth`) "Người trực xuất hàng" =
  thành viên nhóm `personnel_groups.code = 'xuat_hang'` (`personnel_group_members` → `maintenance_staff.ten`), lưu
  `export_orders.nguoi_xuat_hang_ids` (cột có từ 20261206). Không bắt buộc. Đọc lại đúng file trước khi sửa (file rất lớn).
- `src/app/dashboard/export/[id]/page.tsx`: thẻ Thông tin đơn hiện tên.
- Kiểm: nhóm `xuat_hang` có tồn tại không (query DB); không có ⇒ HỎI người dùng tạo nhóm hay dùng nguồn khác.

### 3. Kết thúc ca ghi giờ
- `src/app/dashboard/product/confirm/page.tsx`, luồng "Kết thúc ca": sau khi thành công gọi best-effort
  `supabase.rpc("attendance_close_shift", { p_factory_id, p_ngay: ngaySx, p_ca })` (lỗi chỉ console.warn, không chặn, không
  chạy khi offline).

### 4. Phiếu F01/F02 (Canvas 2D → PDF)
- File mới `src/lib/attendance/f01-sheet.ts` (client). jsPDF KHÔNG ghép chữ Khmer ⇒ vẽ từng trang A4 dọc bằng Canvas 2D
  (mẫu `src/lib/dispatch-plan-image.ts`, font `public/fonts/NotoSansKhmer-Regular.ttf` + font Việt đang dùng ở đó), rồi
  `jsPDF.addImage` JPEG mỗi trang (nền trắng `fillRect` trước). QR góc phải trên → `/dashboard/attendance/sheet/{id}`.
  Chân trang "NMCB-QT01-F01 (03-01/8/2026)" / F02 tương ứng (kiểm đúng mã trên mẫu giấy).
- Nội dung (đối chiếu mẫu giấy, in song ngữ):
  - Đầu: tên nhà máy (Khmer `factories.ten_khmer` + Việt), tiêu đề (F01: CSR10, 20; F02: L, 3L, 5, CV50, 60), Ngày SX,
    Chỉ thị SX (`lot_transactions.chi_thi` của ngày, nối duy nhất), Ngăn (F01; mã ngăn các giao dịch trong ngày).
  - Mục 1 Tổ tiếp nhận, mục 2 Cơ điện – nâng hàng: gom dòng của MỌI phiếu ca trong ngày theo `to_nhom` của việc. Mục 3: mỗi ca
    1 khối "Ca n: giờ bắt đầu – giờ kết thúc" (`gui_luc`… hoặc `bat_dau_luc` – `ket_thuc_luc`; thống nhất với người dùng nếu
    mơ hồ), "Sản xuất CSR / bành / bọc" gom như F09 (`loadShiftReportData` ở `product/confirm/actions.ts` — đọc qua server
    action có kiểm quyền; nếu cần, viết server action mới trong module attendance kiểm `attendance.view`).
  - Mỗi việc 1 dòng; nhiều người chung 1 ô (mỗi người 1 dòng), cột Xếp loại cùng thứ tự; người thay ghi "(thay X)". CHỈ in việc
    có người. Việc `an_diem_danh` (Trực xuất hàng) = người trong `nguoi_xuat_hang_ids` của đơn xuất ĐÃ DUYỆT cùng ngày có CSR
    thuộc dây chuyền (`dayChuyenForCsr`) ∪ người điểm danh việc đó (nếu có).
  - Tổ trưởng / tổ phó: nhân sự có `to_vai_tro` + `to_pham_vi` (ca SX theo `ca_mac_dinh`, dây chuyền khớp hoặc trống); thiếu ⇒
    KHÔNG in dòng.
  - Bảng "Vắng" cuối mỗi ca (tên, có / không phép, lý do, người thay) — đã chốt CÓ.
  - Xem trước (chưa đủ duyệt): in mọi dòng hiện có, không dấu duyệt, chữ "BẢN XEM TRƯỚC".
- Trang chi tiết phiếu: tab "Phiếu F01/F02" nhúng `DocViewer loadBytes` + nút Tải PDF (rule 29 mục G).

### 5. L4 — dấu duyệt + bản cứng
- Helper dấu: `src/lib/pdf-approval-stamp.ts` (jsPDF: tick xanh bằng 2 `line`, KHÔNG ký tự ✓ — font thiếu glyph) + bản Canvas
  cho F01/F02. Vị trí: góc PHẢI cuối trang cuối. Nội dung: tick + "Đã duyệt: {Tên}" + `dd/mm/yy HH:mm:ss` giờ nhà máy
  (`Intl.DateTimeFormat` timeZone `Asia/Ho_Chi_Minh`, năm 2 chữ số).
- F01/F02 bản cứng: điều kiện = MỌI phiếu ca của phiếu ngày `da_duyet` (và có ≥1 phiếu ca). Người duyệt = `duyet_boi` của phiếu
  ca có `duyet_luc` muộn nhất (tra `profiles.full_name` ở server). `approval_key` = sha256 của các `section_id:duyet_luc` đã sắp.
  Server actions `src/app/dashboard/attendance/sheet-snapshots.ts` ("use server", service role, mirror
  `product/confirm/report-snapshots.ts`): `loadSheetSnapshotState(sheetId, token)`, `prepareSheetSnapshotUpload` (signed upload
  URL), `finalizeSheetSnapshot` (tải lại object, kiểm `%PDF`, tự tính sha256, từ chối nếu đã có bản cùng key),
  `getSheetSnapshotUrl` (signed 120s). Xác thực token + quyền `attendance.view | approve | mark_all | admin` + đúng nhà máy.
  Đã có bản cùng key ⇒ mọi người mở lại nhận đúng bản đó. Admin mở lại ⇒ key đổi ⇒ bản cũ hết hiệu lực, giữ lịch sử.
  Lỗi lưu bản cứng KHÔNG chặn xem PDF (cảnh báo vàng).
- F09 (`product/confirm/shift-report-pdf.ts`): thêm dấu duyệt khi ngày đã khoá đủ ca — tên = `locked_by` (profiles.full_name)
  của khoá active có `locked_at` muộn nhất trong ngày, giờ = `locked_at`. `loadDayLockState` (report-snapshots.ts) trả thêm
  `lastLockName`, `lastLockAt`. Chỉ vẽ trong luồng sinh bản cứng (ngày khoá đủ); bản cứng đã lưu trước đó BẤT BIẾN, không dựng lại.
  KHÔNG thêm cho F11/F12.

### 6. Cuối GĐ3
- Cập nhật rule 31 (mục GĐ3), CLAUDE.md "Việc còn treo", file bàn giao; tsc + eslint; hướng dẫn test tay; DỪNG cho người dùng
  test; hỏi trước khi commit/push.

## Lưu ý kỹ thuật
- Không `npm run build`; lỗi Turbopack "Failed to restore task data" ⇒ tắt dev, xoá `.next/dev/cache/turbopack`, chạy lại.
- Chữ Khmer mới ⇒ `khmer-ui.json` / `khmer-catalog.json` + `node scripts/export-attendance-khmer.mjs`.
- Bảng lớn ⇒ `fetchAllPaginated` + `.order()` ổn định; `.in()` chia lô 200.
- Ngày nghiệp vụ: `getFactoryTodayISO()`; không `toISOString().slice(0,10)`.
- Việc treo KHÔNG làm khi chưa được nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối).

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 29, rule 31, rule 06 mục 4.15, và ĐỌC HẾT .claude/plans/ban-giao-cham-cong-c2-gd3.md
(kèm 2 file nó dẫn: ban-giao-cham-cong-c2-luoi.md mục GĐ3, ban-giao-cham-cong-c2-sua-sau-test-gd2.md mục L4).
Trạng thái: GĐ1 + GĐ2 + sửa sau test đã commit (chưa push), migration 20261207 đã chạy.
Đầu phiên: tôi test nhanh header màn điểm danh (QR điểm danh … + tên/chức vụ góc phải) và Cài đặt → Điểm QR (Tải PNG, admin xoá).
Làm GĐ3 theo đúng thứ tự mục 1→6 trong file bàn giao: UI admin mở lại phiếu đã duyệt, vị trí Ca trưởng / Tổ trưởng / Tổ phó
mặc định + đổi người thay (mục 1b — HỎI tôi 4 câu (a)–(d) trước khi code), đơn xuất chọn người trực xuất hàng,
Kết thúc ca ghi giờ, phiếu F01/F02 Canvas (có bảng Vắng), dấu duyệt + bản cứng F01/F02 và dấu duyệt F09 (không F11/F12).
Đọc lại đúng file trước khi sửa; điểm nào chưa rõ thì HỎI tôi (ngôn ngữ nghiệp vụ + ví dụ), không tự quyết.
Mỗi bước tsc + eslint; xong hướng dẫn test tay, DỪNG cho tôi test; hỏi tôi trước khi commit/push.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối).
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build.
```
