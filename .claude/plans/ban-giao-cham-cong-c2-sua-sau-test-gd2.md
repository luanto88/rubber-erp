# Chấm công C2 — sửa sau test GĐ2 (desktop localhost) + mở rộng GĐ3 (viết 2026-11-23)

Đọc kèm: `.claude/plans/ban-giao-cham-cong-c2-luoi.md` (mô hình + GĐ3 gốc), rule 31 mục "C2 làm lại" + "GĐ2 màn lưới",
rule 06 mục 4.15 (bản cứng F09/F11/F12 — mẫu cho bản cứng F01/F02).

## Trạng thái code
- GĐ1 đã commit `0efb49f` (chưa push).
- GĐ2 (màn lưới, tấm chọn việc, tự lưu, bước gửi, văn phòng) CHƯA COMMIT — nằm trong working tree:
  `src/app/dashboard/attendance/shift/page.tsx` + `shift/_components/{gender-icon,worker-tile,job-sheet,submit-review}.tsx`,
  `src/lib/attendance/shift.ts`, `khmer-ui.json`, `sheet/[id]/page.tsx`, `_components/sheet-review-list.tsx`, rule 31, file bàn giao.
- Kết quả test tay desktop: mặc định đúng ca + dây chuyền của trực ca ✅. 4 lỗi / yêu cầu bên dưới.

## Lỗi / yêu cầu từ test + nguyên nhân + cách sửa

### L1. Thẻ "Ca X" hiện cả việc bảo trì / tiếp nhận / xe
- Nguyên nhân: `jobsForSheet()` (`shift/page.tsx`) đưa vào `JobSheet` MỌI việc của dây chuyền, không lọc theo thẻ.
- Người dùng chốt:
  - Thẻ Ca ⇒ CHỈ việc `to_nhom = 'ca_san_xuat'` (GIỮ "Xe xúc tiếp liệu" — thuộc mục 3 F01, vẫn chọn xe).
  - Tạo nhóm "Tổ tiếp nhận" ⇒ thẻ đó chỉ việc `tiep_nhan` (vd Mủ tạp: Xé nhỏ – Lưu kho, Vận hành xe xúc, Vệ sinh kho).
  - Thẻ Cơ điện / Bảo trì ⇒ chỉ việc `co_dien` (Trực ca, Lái xe nâng, Vận hành lò sấy, Bảo trì máy / trực bảo trì).
  - "Trực xuất hàng" KHÔNG giao ở màn điểm danh — người tạo đơn xuất chọn ở module Xuất hàng (`export_orders.nguoi_xuat_hang_ids`),
    phiếu F01/F02 chốt tên khi dựng bản cứng.
- Migration đề xuất `20261207_attendance_tab_jobs.sql` (chạy tay, idempotent):
  ```sql
  alter table public.personnel_groups add column if not exists diem_danh_to_nhom text
    check (diem_danh_to_nhom in ('tiep_nhan', 'co_dien', 'ca_san_xuat'));
  update public.personnel_groups set diem_danh_to_nhom = 'co_dien'
    where code in ('co_dien', 'bao_tri') and diem_danh_to_nhom is null;
  insert into public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order, hien_diem_danh, diem_danh_to_nhom)
  select f.id, 'tiep_nhan', 'Tổ tiếp nhận', 'Thẻ Tổ tiếp nhận ở màn điểm danh ca', true, true, 5, true, 'tiep_nhan'
  from public.factories f
  on conflict do nothing;   -- unique (factory_id, code)
  alter table public.attendance_job_types add column if not exists an_diem_danh boolean not null default false;
  update public.attendance_job_types set an_diem_danh = true where ten = 'Trực xuất hàng';
  ```
  Lưu ý: bảng `personnel_groups` có dòng trùng tên kiểu `co-dien` / `co_dien` (dữ liệu cũ) — CHỈ đụng code có gạch dưới.
  Kiểm unique index `(factory_id, lower(name))`: "Tổ tiếp nhận" chưa có ⇒ insert được.
- Code:
  - `RosterGroup` thêm `toNhom: string | null`; `loadCatalog` select `diem_danh_to_nhom`; `buildRosterTabs` gắn `toNhom` vào
    `RosterTab` ("ca" ⇒ `ca_san_xuat`, nhóm ⇒ `diem_danh_to_nhom`, null ⇒ mọi tổ trừ ca; "Khác" ⇒ mọi tổ).
  - `sheetFor` lưu kèm `tabKey` lúc chạm ô; `jobsForSheet(line, toNhom)` = việc cùng dây chuyền, `is_active`, `!an_diem_danh`,
    đúng `to_nhom` của thẻ — CỘNG việc đang có trên dòng (dòng cũ / gợi ý) để không mất dữ liệu.
  - `AttendanceJobType` thêm `an_diem_danh?: boolean`; Cài đặt → Chấm công → công việc: ô tick "Ẩn ở màn điểm danh";
    Cài đặt → Điểm QR / thẻ nhóm: chọn "Loại việc của thẻ" cho nhóm đã tick `hien_diem_danh`.
  - `suggestFromPrevious`: bỏ việc `an_diem_danh`.
  - Người có `ca_mac_dinh` nhưng thuộc nhóm Tổ tiếp nhận ⇒ hiện ở cả thẻ Ca lẫn thẻ Tiếp nhận (1 dòng / người / phiếu ca) —
    chấp nhận, ô hiện cùng trạng thái ở 2 thẻ. Tuỳ chọn: loại thành viên nhóm khỏi thẻ Ca — HỎI người dùng trước.

### L2. Thẻ công việc (chip trong tấm chọn việc) không cân 2 lề
- Nguyên nhân: `job-sheet.tsx` dùng `flex flex-wrap` ⇒ hàng cuối lệch trái, mép phải răng cưa.
- Sửa: lưới đều cột `grid grid-cols-2 sm:grid-cols-3 gap-2`, mỗi thẻ `w-full min-h-[44px]` chữ canh giữa, xuống tối đa 2 dòng
  (`line-clamp-2`), dấu ✓ góc phải trên khi chọn. Áp cùng kiểu cho nút A/B và 2 nút đáy (đã là grid).
- Lưới ô người: kiểm lại `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6` trên desktop rộng — giữ `max-w-5xl mx-auto`.

### L3. Màn "Kiểm tra trước khi gửi" trống
- Nguyên nhân: `submit-review.tsx` chỉ render 2 khối "Người vắng" và "Chưa giao việc"; khi không ai vắng và công nhân ca đã
  giao hết ⇒ cả 2 khối ẩn ⇒ màn trắng chỉ còn nút "Xác nhận gửi".
- Sửa: thêm khối TÓM TẮT luôn hiện ở đầu: Dây chuyền · Ca · Ngày · mã phiếu; số Có mặt / Vắng / Người thay; bảng gọn theo việc
  (tên việc → danh sách người, "B" khi xếp B; người thay ghi "(thay X)"), câu `xacNhanGui`. Khi 2 danh sách vắng / chưa giao
  rỗng ⇒ dòng xanh "Không có người vắng hay chưa giao việc". Props thêm `presentLines`, `jobById`, `meta`.
  Chữ mới vào `khmer-ui.json` + chạy `node scripts/export-attendance-khmer.mjs`.

### L4. Dấu duyệt + bản cứng F01/F02 và F09 (người dùng chốt: giống phiếu thành phẩm — đóng khi render lần đầu sau khi duyệt)
- Dấu: góc PHẢI cuối trang cuối, tick xanh (vẽ bằng đường, KHÔNG ký tự ✓ — font không có glyph) + "Đã duyệt: {Tên người duyệt}"
  + `dd/mm/yy HH:mm:ss` (giờ nhà máy, `formatFactoryDateTimeVN` hoặc tương đương 2 chữ số năm).
- F01/F02: điều kiện bản cứng = MỌI phiếu ca của phiếu ngày đã `da_duyet`; render lần đầu sau đó ⇒ dựng PDF (Canvas, GĐ3) có
  dấu duyệt, upload, ghi snapshot; mọi lần mở sau dùng đúng bản đó, không dựng lại. Người duyệt = `duyet_boi` của phiếu ca có
  `duyet_luc` muộn nhất (tra `profiles.full_name`). Admin mở lại (trả về — hiện RPC chặn trả về phiếu đã duyệt; nếu cần mở lại
  phải có RPC riêng, HỎI người dùng) ⇒ bộ duyệt đổi ⇒ bản cũ hết hiệu lực, giữ lịch sử.
  Migration (gộp vào 20261207 hoặc file riêng): bucket private `attendance-sheet-reports`, bảng `attendance_sheet_snapshots`
  (sheet_id, approval_key = hash các (section_id, duyet_luc), storage_path, sha256, duyet_ten, duyet_luc, created_by, created_at;
  trigger chặn UPDATE/DELETE; RLS chỉ SELECT). Server action mirror `product/confirm/report-snapshots.ts`
  (`prepare…Upload` signed upload URL, `finalize…` tải lại kiểm `%PDF` + tự tính sha256, `get…Url` signed 120s).
- F09 (Phiếu thành phẩm, `confirm/shift-report-pdf.ts`): thêm dấu duyệt cùng kiểu. "Duyệt" = khoá ca (`product_shift_locks`):
  tên = `locked_by` của khoá active có `locked_at` muộn nhất trong ngày, thời gian = `locked_at` đó. Chỉ vẽ khi ngày đã khoá đủ
  ca (đúng điều kiện bản cứng 4.15) ⇒ dấu nằm trong bản cứng lần render đầu. Bản cứng đã lưu trước đó BẤT BIẾN (không có dấu) —
  không dựng lại. `loadDayLockState` trả thêm tên + giờ người khoá cuối. Cân nhắc cùng cho F11/F12 — HỎI người dùng.
- Helper dùng chung: `src/lib/pdf-approval-stamp.ts` (jsPDF: tick bằng 2 `line`, chữ xanh) + bản Canvas cho F01/F02.

## Người dùng chốt 4 câu "HỎI" (2026-11-23)
1. Thành viên nhóm có thẻ riêng (Tổ tiếp nhận, Cơ điện…) KHÔNG hiện ở thẻ Ca — CÓ (đã làm, `buildRosterTabs`).
   Lúc gửi, công nhân của ca nằm ở thẻ nhóm vẫn vào danh sách "chưa giao việc".
2. RPC riêng cho admin mở lại phiếu ca đã duyệt — CÓ (`attendance_reopen_section` trong 20261207; UI nút ở chi tiết phiếu — làm ở GĐ3).
3. Dấu duyệt cho F11/F12 — KHÔNG (chỉ F09).
4. Bảng "Vắng" cuối mỗi ca trên F01/F02 — CÓ (GĐ3).

## Tiến độ 2026-11-23 (phiên sau test GĐ2)
- Migration `20261207_attendance_tabs_snapshots.sql` đã viết (CHƯA chạy): `personnel_groups.diem_danh_to_nhom`, nhóm Tổ tiếp
  nhận, `attendance_job_types.an_diem_danh` (Trực xuất hàng), bucket + bảng `attendance_sheet_snapshots`,
  RPC `attendance_reopen_section` (admin, lý do bắt buộc; tính lại ngày công từ phiếu ca khác đã duyệt, không còn ⇒ xoá
  ngày công nguồn truc_ca; chấm tay giữ nguyên; log `mo_lai_phieu`; chuông trực ca).
- L1, L2, L3 + Cài đặt đã code (tsc + eslint sạch), CHỜ test tay. L4 + GĐ3 chưa làm.

## Thứ tự làm phiên sau
1. Migration 20261207 (L1 + bảng snapshot L4) → đưa người dùng chạy tay.
2. L1 code + Cài đặt; L2; L3. tsc + eslint, hướng dẫn test, DỪNG cho người dùng test.
3. Hỏi commit GĐ2 + sửa (1 commit).
4. GĐ3 (bản gốc) + L4: đơn xuất chọn người trực xuất hàng; Kết thúc ca → `attendance_close_shift`; phiếu F01/F02 Canvas có
   dấu duyệt + bản cứng; dấu duyệt F09.

## Kiểm tra
- Thẻ Ca: tấm chọn việc chỉ có việc ca SX (Mủ tạp: Xe xúc tiếp liệu … Vệ sinh tạp vụ); thẻ Tổ tiếp nhận chỉ việc tiếp nhận;
  thẻ Cơ điện / Bảo trì chỉ Trực ca, Lái xe nâng, Vận hành lò sấy, Bảo trì máy; không thẻ nào có "Trực xuất hàng".
- Chip việc lưới đều 2–3 cột, 2 lề thẳng hàng trên 390px và desktop.
- Gửi khi không ai vắng: màn xác nhận có tóm tắt đầy đủ.
- F01/F02 + F09: duyệt / khoá đủ ca → mở lần đầu có dấu tick xanh + tên + dd/mm/yy HH:mm:ss góc phải cuối trang; mở lại ra
  đúng bản cũ (sha256 không đổi).

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 29, rule 31, rule 06 mục 4.15, và ĐỌC HẾT 2 file:
.claude/plans/ban-giao-cham-cong-c2-luoi.md và .claude/plans/ban-giao-cham-cong-c2-sua-sau-test-gd2.md.
Trạng thái: GĐ1 commit 0efb49f (chưa push). GĐ2 màn lưới đã code, CHƯA commit, test desktop có 4 lỗi L1–L4 trong file sửa.
Làm theo "Thứ tự làm phiên sau": (1) viết migration 20261207 (thẻ nhóm ↔ loại việc, nhóm Tổ tiếp nhận, an_diem_danh cho
Trực xuất hàng, bảng + bucket bản cứng F01/F02) — đưa tôi chạy tay; (2) sửa L1 (lọc việc theo thẻ), L2 (chip việc lưới
cân 2 lề), L3 (màn xác nhận có tóm tắt), cập nhật Cài đặt; tsc + eslint, hướng dẫn test tay, DỪNG cho tôi test.
Đọc lại đúng file trước khi sửa. Các điểm ghi "HỎI người dùng" phải hỏi, không tự quyết. Hỏi tôi trước khi commit/push.
Sau đó GĐ3 + L4 (dấu duyệt + bản cứng F01/F02 và F09).
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối).
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build.
```
