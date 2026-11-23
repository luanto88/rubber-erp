# Bàn giao Chấm công — C2 làm lại "lưới ô người", GĐ 2 + 3 (viết 2026-11-23)

Kế hoạch gốc đã duyệt: `C:\Users\Software\.claude\plans\pasted-content-id-e8fb-test-elegant-lighthouse-of-e10e4a32-e35b-4700-a249-6ee9ab730ab6.md`.
Rule: 31 (mục GĐ C2 + mục "C2 làm lại"), 29. Mẫu giấy: `cung_cap_dl/NMCB-QT01-F01_new.pdf`, `cung_cap_dl/NMCB-QT01-F02 _new.pdf`,
danh sách công nhân `cung_cap_dl/DS_CN.pdf`.

## Trạng thái
- GĐ1 code + test PASS 2026-11-23: migration `20261206_attendance_c2b_grid.sql` ĐÃ CHẠY; `seed-attendance-catalog.mjs --update --apply`
  (48 việc theo mẫu mới, tắt việc mẫu cũ); `import-worker-gender.mjs --apply` (44/44 công nhân có giới tính; Khean Sok Khoeun /
  Binh Ban = tổ trưởng ca A / B); form Nhân sự có "Vai trò trong tổ"; Cài đặt → Chấm công → Điểm QR có "Thẻ nhóm ở màn điểm danh".
- GĐ1 đã commit `0efb49f` (2026-11-23, chưa push).
- GĐ2 code xong 2026-11-23 (tsc + eslint sạch, CHƯA commit). Test desktop có 4 lỗi ⇒ kế hoạch sửa + prompt phiên sau:
  `.claude/plans/ban-giao-cham-cong-c2-sua-sau-test-gd2.md` (ưu tiên file đó).

## Ý nghĩa "Thẻ nhóm ở màn điểm danh" (đã giải thích cho người dùng 2026-11-23)
- Tick nhóm = nhóm đó hiện thành 1 THẺ (tab) TRONG CÙNG màn điểm danh của trực ca. KHÔNG phải mỗi nhóm 1 màn / 1 phiếu riêng.
- Lý do: người cơ điện / bảo trì không thuộc ca A/B (không có `ca_mac_dinh`), nhưng mục 2 "Cơ điện – nâng hàng" của F01/F02 cần
  ghi tên họ. Trực ca chuyển sang thẻ "Cơ điện" để giao việc (Vận hành lò sấy, Bảo trì máy…) cho họ, vẫn chung phiếu ca.
- QR không gắn với nhóm: mọi điểm QR mở cùng 1 màn; tick nhóm áp dụng cho MỌI phiếu ca của nhà máy.
- 1 người cơ điện có thể được giao ở cả phiếu ca A lẫn ca B cùng ngày ⇒ ngày công gộp theo quy tắc Q4 (có mặt nếu có mặt ≥ 1 nơi,
  B nếu bất kỳ nơi nào B).

## Mô hình dữ liệu (đã có sau migration 20261206)
- Phiếu ngày `attendance_daily_sheets` (ngày + dây chuyền, mã F01-ddmmyy / F02-ddmmyy). Phiếu CA = `attendance_sheet_sections`
  với `loai = 'ca_san_xuat'`, `ca` A/B/C — mở bằng RPC `attendance_open_section(factory, ngay, day_chuyen, 'ca_san_xuat', ca)`.
- Dòng `attendance_sheet_lines` (UNIQUE phiếu ca + người): `cong_viec_ids uuid[]` (nhiều việc), `vehicle_id`, `xep_loai` (chỉ khi
  có mặt), `diem_danh` co|vang, `vang_loai` (NULL được lúc nháp, BẮT BUỘC khi gửi), `ly_do_id` / `ly_do` (bắt buộc khi không phép),
  `thay_the_staff_id` / `thay_the_ten` (chỉ trên dòng VẮNG; tên gõ tay không tạo nhân sự, không ghi ngày công), `ghi_chu`.
  Cột cũ `cong_viec_id` = phần tử đầu (RPC tự ghi), `thay_cho_staff_id` bỏ dùng.
- RPC: `attendance_save_section(section_id, {ghi_chu}, lines[])` thay toàn bộ dòng; `attendance_submit_section` (chặn nếu người vắng
  chưa chọn có / không phép); `attendance_review_sections(ids, 'duyet'|'tra_ve', ly_do)` (người thay có staff_id ⇒ có mặt A);
  `attendance_close_shift(factory, ngay, ca)` ghi `ket_thuc_luc`.
- `maintenance_staff.gioi_tinh` ("Nam"/"Nữ"), `to_vai_tro` (to_truong|to_pho), `to_pham_vi` (tiep_nhan|co_dien|ca_san_xuat).
- `personnel_groups.hien_diem_danh` + `personnel_group_members(group_id, staff_id)`.
- `export_orders.nguoi_xuat_hang_ids uuid[]` (chưa có UI).

## GĐ 2 — Màn lưới trực ca + văn phòng duyệt
### Màn `/dashboard/attendance/shift` (viết lại; layout đã bypass sidebar)
1. **Header** (sticky, gradient như hiện tại): menu tài khoản (Về trang chính / Đăng xuất), tên trực ca, chip Ca (tự theo
   `production_shift_assignments` của tài khoản, chạm để đổi + cảnh báo ngoài phân công), chip Dây chuyền (mặc định
   `day_chuyen_mac_dinh` hồ sơ nhân sự của trực ca, chạm để đổi), ngày (nhỏ, mặc định `getFactoryTodayISO`), VI / ខ្មែរ.
   Mở màn ⇒ tự gọi `attendance_open_section` (không còn nút "Mở điểm danh", không chọn phần). `?section=<id>` (từ chuông) ⇒ nạp đúng phiếu.
2. **Bộ đếm** dưới header: Có / Vắng / Chưa giao + nút lọc "Chỉ chưa giao".
3. **Thẻ**: "Ca A" (công nhân `ca_mac_dinh` = ca, `day_chuyen_mac_dinh` = dây chuyền hoặc trống, còn làm việc, `cho_xac_nhan` = false)
   + 1 thẻ / nhóm `hien_diem_danh` (thành viên nhóm). Dùng `SegmentedTabs` hoặc chip cuộn ngang.
4. **Lưới ô người** (`_components/worker-tile.tsx`, 3 cột điện thoại / 5–6 cột màn rộng): icon `gender-icon.tsx` (SVG xanh nam / hồng
   nữ / xám chưa rõ) + tên (2 dòng, cắt …). Trạng thái ô:
   - chưa giao: viền đứt xám;
   - có mặt: viền xanh + 1 chip việc ngắn (tên việc đầu, "+N" nếu nhiều), góc phải "B" khi xếp B;
   - vắng có người thay: icon mờ + gạch chéo đỏ + dòng nhỏ "→ tên người thay";
   - vắng không người thay: chip đỏ "Vắng".
5. **Chạm ô ⇒ tấm chọn từ dưới lên** (`job-sheet.tsx`, portal ra body):
   - Danh sách việc của dây chuyền nhóm theo tổ (tiếp nhận / cơ điện – nâng hàng / ca SX), chạm chọn NHIỀU (chip bật/tắt), tên
     song ngữ `bilingual()`.
   - A / B (mặc định A).
   - Xe: chỉ khi 1 việc đã chọn có `loai_xe`, mặc định xe người đó là tài xế chính / phụ (`dispatch_drivers.staff_id` →
     `dispatch_vehicle_driver_assignments` / `dispatch_vehicle_secondary_drivers`, như code C2 hiện tại).
   - Người thay thế: ô tìm nhanh trên danh sách công nhân CA KHÁC + thành viên các nhóm (trừ chính người này và người đã có trong
     phiếu); gõ tên không có ⇒ nút "Dùng tên '…' (tạm)" ⇒ `thay_the_ten`. Chọn người thay ⇒ dòng thành VẮNG, các việc là việc người
     thay làm. Không chọn người thay ⇒ CÓ MẶT.
   - Nút "Vắng — không có người thay", "Bỏ giao (xoá)", "Xong".
6. **Gợi ý theo ngày gần nhất**: phiếu ca mới (chưa có dòng) ⇒ đọc phiếu cùng dây chuyền + ca có `ngay` < hôm nay gần nhất (bất kỳ
   trạng thái trừ không có dòng), chép `cong_viec_ids` + `vehicle_id` cho người còn trong danh sách (KHÔNG chép vắng / người thay /
   xếp loại). Banner "Gợi ý theo phiếu dd/mm" + nút "Xoá hết việc".
7. **Tự lưu nháp**: debounce 2 s sau thay đổi cuối ⇒ `attendance_save_section` (chỉ gửi người có việc hoặc vắng). Thanh trạng thái
   "Đã lưu hh:mm" / "Đang lưu…" / lỗi mạng (giữ dữ liệu trên màn, thử lại). Không dùng localStorage cho dữ liệu.
8. **Gửi chấm công** (`submit-review.tsx`, toàn màn): danh sách (a) người vắng — Có phép / Không phép (mặc định Có phép), Không phép
   bắt buộc lý do (danh mục `attendance_absence_reasons` + thêm nhanh); (b) người chưa giao việc — chọn "Vắng" (cùng xử lý phép) hoặc
   "Quay lại giao". Xác nhận ⇒ save (dòng cuối) ⇒ `attendance_submit_section`. Sau gửi: khoá, hiện "Chờ duyệt". Bị trả về ⇒ banner lý
   do, sửa + gửi lại. Đã duyệt ⇒ khoá vĩnh viễn (chỉ xem).
9. Hàm thuần mới trong `src/lib/attendance/shift.ts`: `classifyTile(line)`, `countRoster(roster, lines)`,
   `suggestFromPrevious(prevLines, rosterIds)`, `linesToPayload`. Bỏ `buildDefaultLines` / `validateLines` cũ khi không còn dùng.
   Chữ mới vào `khmer-ui.json` (+ chạy `node scripts/export-attendance-khmer.mjs`).
10. Quyền: như C2 (người lập phiếu có `shift_check`, hoặc mark / mark_all / admin; chỉ khi `dang_lam | tra_ve`).

### Văn phòng
- `sheet-review-list.tsx`: dòng = phiếu ngày, dòng xổ = phiếu ca (Ca A/B/C), cột Có / Vắng / Người thay.
- `sheet/[id]/page.tsx`: mỗi phiếu ca 1 khối, bảng: Người · Việc (nhiều, tên ngắn) · Xe · Điểm danh (Có A/B · Vắng có / không phép +
  lý do) · Người thay (tên, "(tạm)" nếu gõ tay) · Ghi chú. Duyệt / Trả về từng ca + "Duyệt mọi ca đã gửi" (giữ nguyên RPC).
- Chuông `getAttendanceTasks` giữ nguyên.

## GĐ 3 — Đơn xuất + giờ kết thúc ca + phiếu F01/F02
1. **Đơn xuất** (`src/app/dashboard/export/page.tsx` form + `export/[id]` chi tiết): ô chọn nhiều "Người trực xuất hàng" =
   thành viên nhóm `code = 'xuat_hang'` (`personnel_group_members`), lưu `nguoi_xuat_hang_ids`. Không bắt buộc. Chi tiết đơn hiện tên.
   Người dùng chốt: chọn NGƯỜI (không chọn xe nâng).
2. **Kết thúc ca** (`src/app/dashboard/product/confirm/page.tsx`, luồng "Kết thúc ca"): sau khi kết thúc thành công gọi
   `supabase.rpc("attendance_close_shift", { p_factory_id, p_ngay: ngaySx, p_ca })` best-effort (lỗi chỉ log, không chặn).
3. **Phiếu F01 / F02** `src/lib/attendance/f01-sheet.ts` — dựng bằng **Canvas 2D** (jsPDF không ghép chữ Khmer; mẫu tham chiếu
   `src/lib/dispatch-plan-image.ts`, font `public/fonts/NotoSansKhmer-Regular.ttf` + font Việt hiện có) → mỗi trang A4 = 1 ảnh PNG/JPEG →
   ghép jsPDF A4 dọc. QR góc phải trên → `/dashboard/attendance/sheet/{id}`. Mã tài liệu chân trang "NMCB-QT01-F01 (03-01/8/2026)".
   - Đầu phiếu: tên nhà máy (Khmer `factories.ten_khmer` + Việt), tiêu đề song ngữ (F01: CSR10, 20; F02: L, 3L, 5, CV50, 60), Ngày SX,
     Chỉ thị sx (`lot_transactions.chi_thi` của ngày, nối), Ngăn (F01; mã ngăn của giao dịch trong ngày).
   - Mục 1 Tổ tiếp nhận, mục 2 Cơ điện – nâng hàng: gom dòng ĐÃ DUYỆT (hoặc mọi dòng nếu xem trước) của MỌI phiếu ca trong ngày,
     theo `to_nhom` của việc. Mục 3: mỗi ca 1 khối — "Ca n: giờ bắt đầu – giờ kết thúc" (`gui_luc` – `ket_thuc_luc`), "Sản xuất CSR /
     bành / bọc" từ `lot_transactions` (ngay_nhap + ca), gom như F09 (`loadShiftReportData` ở `product/confirm/actions.ts`; đọc ở
     server action có kiểm quyền hoặc truy vấn client theo RLS).
   - Mỗi việc 1 dòng; nhiều người chung 1 ô (mỗi người 1 dòng trong ô), cột Xếp loại cùng thứ tự. Người thay hiện thay cho người vắng
     (ghi "(thay X)"). CHỈ in việc có người. Tổ trưởng / tổ phó: nhân sự có `to_vai_tro` + `to_pham_vi` (ca SX theo `ca_mac_dinh`,
     dây chuyền khớp hoặc trống); thiếu ⇒ KHÔNG in dòng đó. "Trực xuất hàng" = người điểm danh việc đó ∪ `nguoi_xuat_hang_ids` của
     đơn xuất ĐÃ DUYỆT cùng ngày có CSR thuộc dây chuyền (`dayChuyenForCsr`).
   - Có thêm bảng "Vắng" cuối mỗi ca (tên, có / không phép, lý do, người thay) — hỏi người dùng có muốn không trước khi làm.
   - Trang chi tiết phiếu: tab "Phiếu F01/F02" nhúng `DocViewer loadBytes`, nút Tải PDF.

## Kiểm tra mỗi GĐ
`npx tsc --noEmit` + `npx eslint <file>` (không `npm run build`). Test tay trên điện thoại thật / DevTools 390px:
quét QR ⇒ header đúng; giao 2 việc cho 1 người; người thay (có trong danh sách + gõ tay); tự lưu, tải lại trang giữ nguyên; ngày sau
có gợi ý + "Xoá hết việc"; gửi ⇒ xử lý phép, lý do bắt buộc; văn phòng duyệt ⇒ Lịch công đúng (người thay có mặt A), khoá sửa;
F01/F02: chữ Khmer đúng, nhiều người chung ô, giờ ca, CSR / bành / bọc, tổ trưởng thiếu không in, dòng Trực xuất hàng từ đơn xuất.

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 29, rule 31 và .claude/plans/ban-giao-cham-cong-c2-luoi.md (đọc hết).
Trạng thái: GĐ1 (migration 20261206, danh mục 48 việc, giới tính + tổ trưởng, thẻ nhóm) đã chạy + test PASS 2026-11-23.
Làm GĐ 2: viết lại màn /dashboard/attendance/shift dạng lưới ô người + tấm chọn việc + tự lưu + bước gửi xử lý phép,
cập nhật văn phòng duyệt theo phiếu ca. Đọc lại đúng file trước khi sửa. Xong: tsc + eslint, hướng dẫn test tay, DỪNG cho tôi test.
Sau đó GĐ 3 (đơn xuất chọn người xuất hàng, Kết thúc ca ghi giờ, phiếu F01/F02 Canvas). Hỏi tôi trước khi commit/push.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối).
```
