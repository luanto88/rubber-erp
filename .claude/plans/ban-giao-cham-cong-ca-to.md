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

## 9. Cập nhật 2026-11-25 (khuya) — C2b test PASS, commit `2baf33b` (chưa push); C3 đã code (CHƯA commit)
- TKSX: giờ bắt đầu khối Ca = sớm hơn giữa kiện quét đầu và lúc mở phiếu (người dùng chốt).
- C3 Có mặt tự động (rule 31 mục "C3"): migration `20261214_attendance_c3_auto_presence.sql` — **chạy TRƯỚC khi test**.
  Kế hoạch đã duyệt: `C:\Users\Software\.claude\plans\c-claude-md-rule-31-misty-waffle-of-5def5b89-e08b-439d-b530-ba415f96ac21.md`.
- Sau migration chạy `node --env-file=.env.local scripts/check-attendance-auto.mjs --month=2026-11` (chỉ đọc) — "RPC thiếu / thừa"
  phải = 0.
- Test tay C3: (1) Lịch công tháng 11 ⇒ nhân viên có thao tác có ô xanh, công nhân không đổi, dòng xám "Đồng bộ Có mặt tự động:
  thêm N ô"; (2) rê chuột ô ⇒ "Thao tác app: …" + giờ; (3) chấm tay Nghỉ 1 ngày có thao tác ⇒ viền cam, thẻ "Ô mâu thuẫn" +1, bấm
  thẻ ⇒ chỉ còn người đó; (4) xoá phiếu duy nhất của 1 ngày rồi "Đồng bộ lại" ⇒ ô tự động mất; (5) ngày được chấm D ⇒ chấm xanh
  nhỏ, nguồn "Được chấm điểm chuyên môn"; (6) TKSX 25/11 Ca B (chưa có bản cứng) ⇒ giờ bắt đầu = giờ kiện đầu.
- Kế tiếp: C4 Sổ phép + chuỗi 3 tháng (kế hoạch mục 0 #3–5) → C5 KPI (gọi `attendance_sync_auto` trước khi tính).

## 10. Cập nhật 2026-11-25 (cuối phiên) — C3 test 1–7 PASS, sửa sau test, ĐÃ commit + push main
- Migration 20261214 ĐÃ CHẠY, script check-attendance-auto PASS.
- Sửa sau test: thẻ bấm được (`StatCard` onClick, dùng chung) có hover nổi / bấm lún / icon phễu / nền khi đang lọc; Lịch công
  lọc mặc định phòng ban của người đăng nhập + Nhân viên ("Xóa lọc" về mặc định); TKSX ca sản xuất không có kiện ⇒ giờ ca để trống.
- Chờ test lại trên production: 3 điểm trên. TKSX 25/11 Ca A nếu ĐÃ có bản cứng thì vẫn in 16:26 (bản cứng bất biến) — xem ngày
  khác chưa có bản cứng, hoặc admin mở lại + duyệt lại để tạo bản mới.

## 12. Cập nhật 2026-11-25 (cuối phiên) — test PASS, ĐÃ commit
- Migration 20261215 ĐÃ CHẠY; test thẻ lọc + bộ lọc Lịch công PASS; C4 test 1–8 PASS (người test Chau Nho, năm 2025).
- Dữ liệu test: đã xoá 92 ô ngày công T9–T12/2025 của Chau Nho. Sổ phép (4 dòng nam 2025) + 93 dòng nhật ký T9–T12/2025 có
  trigger chặn xoá — xoá bằng SQL Editor (khối SQL trong câu trả lời phiên 2026-11-25), chưa xác nhận đã chạy.
- Kế tiếp: C5 KPI dùng chuyên cần mới (kế hoạch `cham-cong-2026-11-19.md` mục 0 #1–2, 7–8, mục 5 dòng C5).

## 13. Cập nhật 2026-11-26 — C5 KPI dùng hệ số chuyên cần mới: test localhost PASS, CHƯA commit
- Migration `20261216_kpi_c5_attendance_factor.sql` ĐÃ CHẠY localhost (rule 27 "Hệ số chuyên cần", rule 31 "C5").
  Production: chạy migration TRƯỚC deploy.
- File đổi: migration 20261216; `src/lib/kpi-scores.ts` (2 cột cấu hình, `chi_tiet` v2, `fetchKpiAttendanceSummary`);
  `settings/_components/kpi-score-weights-tab.tsx` (ô "Ngày nghỉ tua chuẩn / tháng" + "Trừ / ngày nghỉ không phép");
  `kpi/scores/page.tsx` (khối "Hệ số chuyên cần (từ Chấm công)", dòng tóm tắt v2, tooltip cột Hệ số CC);
  `src/lib/kpi-score-breakdown.ts` (chú thích); `scripts/compare-kpi-attendance-factor.mjs`; rule 27, rule 31.
- Script so sánh T10–T11: lỗi công thức JS ↔ SQL = 0; T10–T11 chưa có dòng điểm KPI nào. Nhiều người hệ số 0,75–0,84 do
  ngày "chưa ghi nhận" (không thao tác app + chưa ai chấm) — đúng quy tắc đã chốt, người dùng chưa yêu cầu đổi.
- Dữ liệu test C4 của Chau Nho: đã kiểm = 0 (không cần chạy SQL xoá).

### Việc tiếp theo (đã chốt yêu cầu 2026-11-26, CHƯA làm)
**A. Header màn điểm danh mobile** (`src/app/dashboard/attendance/shift/page.tsx` ~dòng 865–950; ảnh lỗi
`cung_cap_dl/kq_test/mobile.jpg`). Hiện tại: dòng 1 = icon + "QR điểm danh <tên điểm QR> <mã phiếu>" bị cắt "…", nút VI/ខ្មែរ,
khối tên + chức vụ (cắt chữ); dòng 2–3 = ô Ca/Tổ, nút Mủ tạp/Mủ nước, ô ngày, badge trạng thái, badge lưu — rớt 3 dòng, lệch.
Yêu cầu người dùng:
- Gọn trên ĐÚNG 2 dòng, cân trái–phải, mọi nút / ô cùng chiều cao.
- Tiêu đề chỉ "QR điểm danh" (bỏ tên điểm QR + mã phiếu khỏi header — chuyển mã phiếu xuống chỗ khác nếu cần, vd dưới banner
  trạng thái hoặc trong bước gửi).
- Người đăng nhập = vòng tròn CHỮ CÁI ĐẦU của tên; bấm ⇒ menu hiện họ tên đầy đủ + chức vụ + Về trang chính + Đăng xuất.
- Các trường phải đủ chữ, KHÔNG cắt "…" (ô Ca/Tổ "Tổ tiếp nhận mủ tạp", nút Mủ tạp/Mủ nước, ngày dd/mm/yyyy, badge trạng thái).
- Giữ nguyên logic: `flushThen` trước khi đổi ca/dây chuyền/ngày, khoá dây chuyền theo đơn vị, ★ đơn vị được phân công,
  `max` ngày = hôm nay giờ nhà máy, badge tự lưu, chữ Khmer qua `T()` / `bilingual()` (chữ mới ⇒ `khmer-ui.json` + export).
- Gợi ý bố cục 360–390 px: dòng 1 [icon + "QR điểm danh" + badge trạng thái] … [VI|ខ្មែរ][avatar]; dòng 2 lưới
  [Ca/Tổ (giãn)] [Mủ tạp|Mủ nước] [ngày] cùng h-9. Nếu ở 360 px không đủ chỗ cho chữ đầy đủ ⇒ HỎI người dùng (vd rút nhãn
  dây chuyền "MT/MN", hay cho ô Ca/Tổ xuống chữ 2 dòng), không tự cắt chữ.
- Cũng xem thẻ người (`_components/worker-tile.tsx`): nhãn việc đang cắt "Xé nhỏ - lưu …", "Vận hành xe x…" — HỎI người dùng
  có muốn cho xuống 2 dòng không (yêu cầu "các trường phải đủ text").
- Kiểm bằng DevTools 360 / 390 / 430 px + desktop, cả tiếng Khmer (chữ dài hơn).

**B. Cấu hình chuyên cần THEO THÁNG** (người dùng: có tháng vận động ở lại — tua ít, có tháng cho về 7–8 ngày).
- Hiện trạng: `kpi_score_weights` theo nhóm chính / mặc định, KHÔNG theo thời gian. Tháng ĐÃ KHOÁ an toàn: không có RPC mở
  khoá (`kpi_monthly_score_lock` chỉ khoá; sửa điểm khoá đi qua `kpi_monthly_score_adjust` có audit), `kpi_compute_monthly_scores`
  bỏ qua dòng `da_khoa`. RỦI RO THẬT: tháng cũ CHƯA khoá, bấm "Tính điểm tháng" lại sau khi đổi cấu hình ⇒ tính theo cấu hình
  mới (A–D lẫn tua chuẩn). `chi_tiet` đã lưu `trong_so` + `chuyen_can.tua_chuan` nên đối chiếu được, nhưng không chặn.
- Hướng đề xuất (CHỜ người dùng chốt trước khi code): thêm cấu hình có hiệu lực theo tháng, vd cột `ap_dung_tu DATE`
  (ngày 1 của tháng) vào `kpi_score_weights`, UNIQUE (factory, group, ap_dung_tu); RPC + `kpi_attendance_summary_internal`
  chọn dòng `ap_dung_tu ≤ tháng tính` mới nhất (theo nhóm, rồi mặc định). Dòng cũ = `ap_dung_tu` 2020-01-01. Mọi
  `CREATE OR REPLACE` chép từ 20261216.
- Câu hỏi cần hỏi (ngôn ngữ nghiệp vụ + ví dụ): (1) Theo tháng chỉ "ngày nghỉ tua chuẩn" hay cả trọng số A/B/C/D, mức trừ,
  min/max? (2) Đặt theo tháng cho mọi người, hay theo từng nhóm chuyên môn / phòng ban? (vd T12 Phòng X về 8 ngày, nhóm khác 6)
  (3) Tháng không cấu hình riêng ⇒ dùng cấu hình tháng gần nhất trước đó, hay luôn về mặc định 6? (4) Có chặn sửa cấu hình
  của tháng đã có điểm khoá không? (5) Có cần ghi lý do / nhật ký khi đặt cấu hình tháng?
- Giao diện gợi ý: Cài đặt → KPI & 5S → Trọng số: thêm ô "Áp dụng từ tháng" + danh sách theo tháng (mới nhất trên); tab Chi
  tiết cách tính điểm ghi "Cấu hình áp dụng: từ tháng MM/YYYY".
- Script so sánh cập nhật theo cấu hình tháng; test: T11 tua 6 / T12 tua 8 ⇒ công chuẩn 24 / 23.

## 14. Cập nhật 2026-11-26 (cuối phiên) — C5 ĐÃ commit `ef099a4`; A1 test PASS, ĐÃ commit; CHƯA push
- A1 (header + thẻ người + đổi tên việc): migration `20261217_attendance_rename_ve_sinh.sql` ĐÃ CHẠY localhost
  ("Vệ sinh tạp vụ" → "Vệ sinh dây chuyền", Mủ tạp + Mủ nước). Production: chạy 20261216 + 20261217 TRƯỚC deploy.
- Header màn điểm danh (`attendance/shift/page.tsx`): đúng 2 dòng — dòng 1 [icon "QR điểm danh"] … [ngày] [1 nút ngôn ngữ hiện
  ngôn ngữ SẼ chuyển sang: VI ⇒ "ខ្មែរ", Khmer ⇒ "VI"] [vòng tròn chữ cái đầu tên]; dòng 2 [Ca/Tổ giãn ★][Mủ tạp|Mủ nước],
  cùng chiều cao. Menu vòng tròn: họ tên + chức vụ + Về trang chính + Đăng xuất. Trạng thái phiếu + mã phiếu + điểm QR = dải
  đầu nội dung; trạng thái tự lưu ở thanh đáy (trên nút Gửi). Key mới `qrDiemDanhNgan` (khmer-ui.json).
- Thẻ người (`worker-tile.tsx`): nhãn việc đủ chữ (tối đa 2 dòng), huy hiệu vàng (Briefcase) khi đã giao việc, icon giữ màu
  giới tính. Đã bỏ dùng `shortJobLabel` ở màn này.
- Bản mẫu người dùng: `cung_cap_dl/so_sanh_bo_cuc_diem_danh_mobile.html` (+ `cung_cap_dl/kq_test/Sơ đồ mới_app.png`) — nguồn
  bố cục + 19 icon SVG nét mảnh cho sơ đồ dây chuyền (A3).

### Đã chốt với người dùng 2026-11-26 (CHƯA làm)
**A2 — Mọi việc của TỔ phải chọn ca (chọn được nhiều).** "Phân công bất kỳ công việc nào cũng phải chọn ca, có thể chọn cả 2 vì
XLNT, sửa chữa cơ khí, bảo trì trực cả ngày." Migration mới: `attendance_sheet_lines.ca_lam text[]` (mã đơn vị loại `ca`);
`CREATE OR REPLACE attendance_save_section` chép từ migration MỚI NHẤT có hàm này (grep, hiện 20261210): section của đơn vị
loại `to` ⇒ dòng có mặt bắt buộc `ca_lam` khác rỗng, giá trị = đơn vị `ca` đang dùng; section ca ⇒ bỏ qua. `job-sheet.tsx` thêm
chip "Làm ca" A/B/C (nhiều) + "Cả ngày"; `shift.ts` (`SheetLineDraft.ca_lam`, `lineToPayload`, `dbLineToDraft`,
`suggestFromPrevious`); bước gửi + "Gửi tất cả" chặn dòng tổ thiếu ca; TKSX in "(Ca A, B)" / "Cả ngày"; chi tiết phiếu cột "Ca".
Dòng tổ cũ `ca_lam` NULL hiện "—".

**A2b — Mở ngày mới lấy ngày gần nhất của Ca, KỂ CẢ người thay** (người dùng nhắc 2026-11-26). Hiện `suggestFromPrevious`
(`src/lib/attendance/shift.ts`) chỉ chép việc + xe cho người CÓ trong danh sách Ca/Tổ, bỏ qua: (a) người mượn từ ca/tổ khác đã
làm thay (thẻ "Khác"), (b) dòng vắng có người thay (`thay_the_staff_id` / `thay_the_ten`). Yêu cầu: phiếu ca/tổ mới chưa có dòng ⇒
chép NGUYÊN bố trí của phiếu gần nhất cùng Ca/Tổ + dây chuyền: việc, xe, người thay (cả người mượn ngoài danh sách — hiện ở thẻ
"Khác"; tên gõ tay "(tạm)"), người vắng được thay (để trực ca chỉ cần xác nhận lại). KHÔNG chép xếp loại A/B, lý do vắng, có / không
phép (người vắng vẫn chọn ở bước gửi). Người đã nghỉ việc / ngoài khoảng làm việc ⇒ bỏ. Banner "Xoá hết việc" giữ nguyên.
Làm cùng A2 (chép luôn `ca_lam` cho dòng tổ). Kiểm: Ca A hôm qua có X thay Y (X mượn Ca B) ⇒ mở Ca A hôm nay thấy Y vắng → X, X ở
thẻ "Khác" có đúng việc.

**A3 — Khung "Sơ đồ dây chuyền" (Mủ tạp) dưới lưới thẻ người**, bố cục + icon theo file HTML mẫu: hàng trực (Trực ca, Vận hành
lò sấy, Bảo trì máy, Trực hồ XLNT, Sửa chữa cơ khí, Lái xe nâng); Tiếp nhận mủ tạp (Vận hành xe xúc → Xé nhỏ - Lưu kho → Vệ
sinh kho); Ca 3 dải viên thuốc + mũi tên cong: (Xe xúc tiếp liệu → Tiếp liệu & vận hành máy xé → Vận hành máy cán) / (Vận hành
băm tinh → Phả mủ → Ra lò → Cân ép bành mủ) / (Vệ sinh dây chuyền ← Cắt mẫu - Vô kiện ← Vô bao dán nhãn).
- Gắn ô ↔ việc: cột `attendance_job_types.so_do_vi_tri` (seed theo tên, khớp 1-1 danh mục F01 Mủ tạp), ô chọn "Vị trí trên sơ
  đồ" ở Cài đặt → Chấm công → Công việc. Việc không gắn ⇒ khung "Việc khác"; Mủ nước ⇒ "Chưa có sơ đồ". Nếu Đội xe cơ khí chưa
  có việc "Sửa chữa cơ khí" ⇒ báo người dùng thêm (không tự tạo).
- Chip Ca A/B/C đầu sơ đồ: đổi ca ⇒ cập nhật TOÀN BỘ tổ + tiếp nhận + dải Ca theo giá trị thực của ca đó (tổ: dòng có `ca_lam`
  chứa ca; vị trí không đổi người thì giữ nguyên).
- Kéo-thả / chạm-chọn-rồi-chạm-ô THEO QUYỀN: chỉ có quyền ca mình (shift_check + phân công) ⇒ chỉ thả trong Ca/Tổ đó; quyền chấm
  công tất cả (mark_all / mark / admin) ⇒ thả mọi ô (khác section ⇒ open + save cả 2 section; vào ô tổ ⇒ `ca_lam` = [ca đang xem]).
  Phiếu đã gửi/duyệt ⇒ khoá. Thẻ người: huy hiệu đổi thành icon vị trí sơ đồ.
- Đọc mọi section + dòng của phiếu ngày: kiểm RLS cho người chỉ có shift_check; bị chặn ⇒ RPC chỉ đọc SECURITY DEFINER.
- File dự kiến: `src/lib/attendance/diagram.ts` (thuần), `shift/_components/diagram-icons.tsx`, `shift/_components/line-diagram.tsx`.

**B — Tua chuẩn theo tháng + chỉ số phụ "Chuyên cần".** Người dùng chốt: (1) chỉ "ngày nghỉ tua chuẩn" theo tháng (trọng số
A–D, mức trừ, min/max vẫn chung); (2) toàn nhà máy + riêng theo nhóm chuyên môn (nhóm chính); (3) tháng không đặt ⇒ về cấu
hình chung (6); (4) CHẶN sửa/xoá cấu hình tháng đã có điểm KPI khoá; (5) bắt buộc lý do + nhật ký (insert-only).
- "Ô mâu thuẫn" tách 2 thẻ ở Lịch công: **Chuyên cần** = ngày Nghỉ tua mà vẫn thao tác app ĐÚNG việc của NHÓM CHÍNH (viền
  xanh); **Mâu thuẫn** = Nghỉ có phép / không phép mà có thao tác (viền cam). Nghỉ tua + thao tác ngoài nhóm chính ⇒ chỉ tooltip.
- Chuyên cần là CHỈ SỐ PHỤ (không vào công thức hệ số) — dùng so sánh khi 2 người bằng điểm: bảng xếp hạng ORDER BY diem_tong
  DESC, ngay_chuyen_can DESC.
- Migration dự kiến: `kpi_attendance_month_config` (factory, group NULL = chung, thang = ngày 1, so_ngay_nghi_tua_chuan 0..10,
  ly_do NOT NULL) + `kpi_attendance_month_config_logs`; RPC save/delete (admin | kpi.manage_config, chặn tháng có da_khoa);
  `personnel_groups.nguon_hoat_dong text[]` (nguồn thao tác app của nhóm — nhãn `ACTIVITY_LABEL`, chọn ở Cài đặt → Nhân sự;
  trống ⇒ không đếm); `kpi_attendance_summary_internal` + `kpi_attendance_month_summary` + `kpi_compute_monthly_scores` chép
  từ 20261216, CHỈ đổi phần chọn tua (coalesce tháng-nhóm → tháng-chung → trọng số nhóm → trọng số chung → 6) + thêm
  `tua_nguon`, `tua_ly_do`, `ngay_chuyen_can` vào kết quả / `chi_tiet.chuyen_can`; RPC xếp hạng (gốc 20260814) thêm tie-break.
- UI: Cài đặt → KPI & 5S → Trọng số khối "Tua chuẩn theo tháng" (lý do qua `ReasonConfirmDialog`, dòng xổ nhật ký); KPI scores
  ghi "Cấu hình áp dụng: tháng MM/YYYY — lý do" + "Ngày chuyên cần"; script so sánh dùng cấu hình tháng (T11 tua 6 / T12 tua 8 ⇒
  công chuẩn 24 / 23).

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 29, rule 31 (mục "C2", "Ca / Tổ điểm danh", "C5"), rule 27 (mục "Hệ số chuyên cần"), và ĐỌC HẾT
.claude/plans/ban-giao-cham-cong-ca-to.md mục 14 (trạng thái mới nhất + đã chốt A2, A3, B). Mở file mẫu
cung_cap_dl/so_sanh_bo_cuc_diem_danh_mobile.html (bố cục + icon SVG sơ đồ dây chuyền) và cung_cap_dl/kq_test/Sơ đồ mới_app.png.
C5 (ef099a4) + A1 đã commit, CHƯA push — đầu phiên hỏi tôi có push không (production phải chạy migration 20261216 + 20261217
TRƯỚC deploy).

Làm lần lượt, mỗi giai đoạn DỪNG cho tôi test, hỏi trước khi commit/push:
1. A2 — mọi việc của tổ phải chọn ca (ca_lam, chọn nhiều / "Cả ngày"). Đọc lại đúng attendance_save_section bản MỚI NHẤT
   trước khi viết migration. Kèm A2b: mở ngày mới chép bố trí ngày gần nhất của Ca/Tổ KỂ CẢ người thay (mục 14).
2. A3 — khung "Sơ đồ dây chuyền" Mủ tạp + kéo-thả theo quyền + đổi Ca A/B cập nhật toàn bộ. Đưa tôi phác thảo bố cục 360 px
   trước khi code; chỗ nào thiếu việc trong danh mục (vd "Sửa chữa cơ khí") thì HỎI.
3. B — tua chuẩn theo tháng + thẻ Chuyên cần / Mâu thuẫn + chỉ số phụ. Liệt kê bảng / RPC / màn hình để tôi duyệt trước khi code;
   các hàm KPI chép từ migration 20261216, chỉ đổi phần chọn cấu hình.
Mỗi bước: npx tsc --noEmit + npx eslint <file>, hướng dẫn test tay (360/390/430 px + Khmer với màn điểm danh).
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối); U11 KPI; C6 Bảng công tháng.
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build. Lỗi Turbopack ⇒ tắt dev, xoá .next/dev/cache/turbopack.
```

## 15. Cập nhật 2026-11-26 (phiên sau) — A2 LÀM LẠI (khung giờ / giờ giao việc) + A2b ĐÃ CODE, CHƯA commit, CHƯA push
- Bản A2 đầu (20261218, chip Ca A/B) bỏ — xem rule 31 mục "A2". Chạy `20261219_attendance_unit_time_frames.sql` NGAY trên localhost
  (20261218 làm hỏng MỌI lần lưu phiếu). Production: 20261215 → 20261219 TRƯỚC deploy (20261218 vẫn chạy, 20261219 ghi đè hàm).
- 4 commit cũ (C4, C5, A1, bàn giao) vẫn CHƯA push.
- A3 cần lưu ý: tổ theo khung không gắn ca ⇒ sơ đồ đổi Ca A/B: tổ theo khung hiện theo khung ngày/đêm; tổ khác lọc theo ca tính từ
  `giao_luc`. Kế tiếp: A3 (phác thảo 360 px trước), rồi B.
- 2026-11-26 (sau test A2): bỏ khung ngày/đêm → giờ làm từng người (migration 20261220, chạy sau 20261219); chặn quét thành phẩm
  khi Ca chưa điểm danh. Production phải chạy 20261215 → 20261220 TRƯỚC deploy. Vẫn CHƯA commit/push.
- 2026-11-27: sửa PDF TKSX 0 byte (DocViewer), cảnh báo Gửi tất cả theo QR, người thay cùng ca. Không migration. CHƯA commit/push.

## 16. Cập nhật 2026-11-27 (cuối phiên) — A2 + A2b + sửa sau test lần 2: test PASS, ĐÃ commit + push main
- Đã push cả 4 commit cũ (C4, C5, A1, bàn giao) + commit A2. Production PHẢI chạy (Supabase SQL Editor, theo thứ tự) nếu chưa:
  20261215 → 20261216 → 20261217 → 20261218 → 20261219 → 20261220. Chưa chạy ⇒ Lịch công / Sổ phép / KPI tính điểm / màn điểm
  danh / chi tiết phiếu lỗi (thiếu cột gio_bd, unit_codes, khung_mac_dinh…). Quét thành phẩm không bị chặn nhầm khi bảng thiếu
  (shift-attendance.ts lỗi ⇒ không áp).
- Mô hình A2 cuối cùng (rule 31 mục "A2" + "Sửa sau test A2" + "lần 2"): Ca A/B/C = ĐỘI; tổ ghi giờ làm (TN_MT auto theo giờ điểm
  danh, XLNT 05:00–05:00, XE_CK 05:00–17:00) ⇒ "Giờ làm" từng người (`gio_bd/gio_kt`); tổ khác xếp vào Ca A/B trên TKSX theo
  `giao_luc` so với khung kiện quét của ca; QR `unit_codes` giới hạn Ca/Tổ + khoá dây chuyền; phải điểm danh Ca trước khi quét
  thành phẩm; người cùng ca thay được người vắng của chính ca. Không có nút "Lưu tạm" (tự lưu 2 giây — người dùng chốt).
- Lưu ý cho A3: tổ ghi giờ làm KHÔNG gắn ca ⇒ sơ đồ đổi Ca A/B: tổ ghi giờ hiện theo giờ làm của từng người (ngày 05–17 / đêm
  17–05 / 24h); tổ khác lọc theo `assignToProductionCa(giao_luc, khung kiện quét)` (shift.ts). Kéo người sang ô tổ ghi giờ ⇒ điền
  `defaultWorkHours(khung_mac_dinh)`. `viec_theo_khung`, `khung_gio`, `ca_lam` = LEGACY (không đọc).
- Kế tiếp: A3 (phác thảo 360 px trước khi code), rồi B (mục 14).

## Prompt phiên sau (2026-11-27, thay prompt cũ ở trên)
```
Đọc CLAUDE.md, rule 29, rule 31 (mục "C2", "Ca / Tổ điểm danh", "C5", "A2", "Sửa sau test A2", "Sửa sau test A2 lần 2"),
rule 27 (mục "Hệ số chuyên cần"), và .claude/plans/ban-giao-cham-cong-ca-to.md mục 14 (đã chốt A3, B) + mục 16 (trạng thái mới
nhất). Mở cung_cap_dl/so_sanh_bo_cuc_diem_danh_mobile.html (bố cục + icon SVG sơ đồ dây chuyền) và
cung_cap_dl/kq_test/Sơ đồ mới_app.png. A2 + A2b đã push main 2026-11-27 — đầu phiên hỏi tôi production đã chạy đủ migration
20261215 → 20261220 chưa.

Làm lần lượt, mỗi giai đoạn DỪNG cho tôi test, hỏi trước khi commit/push:
1. A3 — khung "Sơ đồ dây chuyền" Mủ tạp dưới lưới thẻ người + kéo-thả / chạm-chọn theo quyền + chip Ca A/B đổi toàn bộ. Tổ ghi
   giờ làm hiện theo giờ làm từng người, tổ khác theo giao_luc (mục 16). Đưa tôi phác thảo bố cục 360 px TRƯỚC khi code; việc nào
   thiếu trong danh mục (vd "Sửa chữa cơ khí", "Vận hành lò sấy") thì HỎI, không tự tạo. Đọc attendance_save_section bản mới nhất
   (20261220) trước khi viết migration nếu cần.
2. B — tua chuẩn theo tháng + thẻ Chuyên cần / Mâu thuẫn + chỉ số phụ. Liệt kê bảng / RPC / màn hình để tôi duyệt trước khi
   code; hàm KPI chép từ migration 20261216, chỉ đổi phần chọn cấu hình.
Mỗi bước: npx tsc --noEmit + npx eslint <file>, hướng dẫn test tay (360/390/430 px + Khmer với màn điểm danh).
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối); U11 KPI; C6 Bảng công tháng.
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build. Lỗi Turbopack ⇒ tắt dev, xoá .next/dev/cache/turbopack.
```

## 17. Cập nhật 2026-11-27 (phiên sau) — A3 Sơ đồ dây chuyền: test localhost PASS, ĐÃ commit + push main
- Production đã chạy đủ 20261215 → 20261220 (người dùng xác nhận đầu phiên).
- Migration `20261221_attendance_job_diagram.sql` ĐÃ CHẠY localhost (19 dòng `so_do_vi_tri`). Production: PHẢI chạy trên Supabase
  SQL Editor (Vercel tự deploy khi push main ⇒ chạy NGAY; chưa chạy thì màn điểm danh vẫn mở được nhưng sơ đồ trống ô — mọi việc rơi
  vào "Việc khác" — và Cài đặt ẩn ô "Vị trí trên sơ đồ").
- Sau test: gỡ người khỏi ô bằng dấu X trên tên hoặc kéo tên ra khoảng trống khung sơ đồ (rule 31 mục A3).
- Chi tiết + quyết định: rule 31 mục "A3". Kế hoạch phiên: `C:\Users\Software\.claude\plans\pasted-content-id-00b9-c-clau-elegant-newell-of-3a944494-5f2e-47c3-9f5c-b970da2fa9af.md`.
- Kế tiếp sau khi A3 test PASS: B (liệt kê bảng / RPC / màn hình cho người dùng duyệt trước khi code — mục 14).

## Prompt phiên sau (2026-11-27, sau A3 — thay các prompt cũ ở trên)
```
Đọc CLAUDE.md, rule 29, rule 31 (mục "A2", "Sửa sau test A2 lần 2", "A3", "C5"), rule 27 (mục "Hệ số chuyên cần"), và
.claude/plans/ban-giao-cham-cong-ca-to.md mục 14 (đã chốt B) + mục 17 (trạng thái mới nhất). A3 (sơ đồ dây chuyền Mủ tạp) đã
push main 2026-11-27 — đầu phiên hỏi tôi production đã chạy migration 20261221_attendance_job_diagram.sql chưa, và test A3 trên
production (360/390/430 px + Khmer) có lỗi gì không.

Việc tiếp theo: B — tua chuẩn theo tháng + thẻ Chuyên cần / Mâu thuẫn ở Lịch công + chỉ số phụ "ngày chuyên cần" (tie-break xếp
hạng KPI). TRƯỚC khi code: liệt kê bảng / cột / RPC / màn hình / script để tôi duyệt (mục 14: kpi_attendance_month_config + logs,
RPC lưu/xoá chặn tháng có điểm khoá + lý do bắt buộc, personnel_groups.nguon_hoat_dong, 3 hàm KPI chép từ migration 20261216 chỉ
đổi phần chọn tua chuẩn, RPC xếp hạng gốc 20260814 thêm tie-break). Hỏi tôi bằng ngôn ngữ nghiệp vụ + ví dụ nếu còn chỗ chưa rõ.
Dừng cho tôi test, hỏi trước khi commit/push.
Mỗi bước: npx tsc --noEmit + npx eslint <file>, hướng dẫn test tay.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối); U11 KPI; C6 Bảng công tháng.
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build. Lỗi Turbopack ⇒ tắt dev, xoá .next/dev/cache/turbopack.
```
