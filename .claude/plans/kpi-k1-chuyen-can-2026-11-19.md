# K1 — Chuyên cần tự động + chấm công tay + sổ phép thưởng (kế hoạch chi tiết, 2026-11-19)

> ĐÃ ĐƯỢC THAY THẾ bởi `cham-cong-2026-11-19.md` (module Chấm công riêng). Giữ file này cho mục 0 (bảng nguồn hoạt động app).

Nguồn yêu cầu: `cung_cap_dl/kpi_chuyen_can_prompt.txt` (người dùng chốt 6 quyết định). Lộ trình chung: `kpi-5s-cai-tien-2026-11-19.md`.
Trạng thái: CHỜ DUYỆT — chưa code.

## 0. Khảo sát dữ liệu thật (2026-11-19, phuochoa_kt, 60 ngày gần nhất)

Tên bảng trong yêu cầu được đổi sang bảng THẬT (`storage_logs`, `process_logs`, `chat_luong_lo`, `maintenance_reports` không tồn tại):

| Nguồn "Có mặt" | Bảng · cột người · cột thời điểm | Dòng 60 ngày / thiếu người |
|---|---|---|
| Điều xe | `dispatch_entries.created_by` · `created_at` | 78 / 0 |
| Sản lượng | `production_records.created_by` · `created_at` | 1.110 / 0 |
| Thành phẩm (nhập, quét QR) | `lot_transactions.created_by`, `product_confirm_drafts.created_by` | 2.049 / 0 · 6 / 0 |
| Thành phẩm (admin sửa) | `lot_admin_edits.actor_id` | — |
| Kiểm nghiệm | `qc_results.created_by` | 495 / 0 |
| Xuất hàng | `export_orders.created_by`, `approved_by` + `approved_at` | 15 / 0 |
| Kiểm soát quá trình | `quick_measurements.created_by` (`process_params.logged_by` luôn trống — BỎ) | 46 / 0 |
| Bảo trì | `maintenance_records.created_by` | 112 / 0 |
| Kho vật tư | `inventory_documents.created_by`/`created_at`, `posted_by`/`posted_at`, `approved_by`/`approved_at` (`inventory_stock_movements` KHÔNG có cột người) | 364 / 0 |
| Đề nghị mua | `purchase_request_logs.user_id` | 349 / 4 |
| Ký số (mọi module) | `nhat_ky_ky.user_id`, `doc_approval_log.user_id` (ISO, Văn bản) | 258 / 0 |
| ISO thực hiện hồ sơ | `iso_form_instance_logs.user_id` | 23 / 0 |
| Ghi chú nhanh, đồng hồ định mức | `operation_notes.created_by`, `tech_norm_meter_readings.created_by` | ít |
| KPI | `kpi_task_logs.nguoi_thuc_hien_id`, `kpi_task_evidence_links.member_user_id`, `kpi_5s_evaluations.nguoi_cham_id`, `kpi_daily_evaluations` (cả `user_id` và `nguoi_cham_id`) | 87 · — · 31 · **0** |

Hệ quả:
- **Chỉ ghi nhận được thao tác TẠO / ký / duyệt**, không ghi nhận được thao tác SỬA của người khác (các bảng không có `updated_by`). Bảng nhật ký (đề nghị mua, ký số, ISO, KPI) thì đủ mọi thao tác.
- Import Excel hàng loạt (Sản lượng) chỉ tính cho người bấm import — đúng ý.
- `kpi_daily_evaluations` = 0 dòng trong 60 ngày ⇒ hệ số chuyên cần hiện tại thực chất luôn ở sàn/không có ⇒ K1 là cần thiết.
- Múi giờ: dùng `Asia/Ho_Chi_Minh` như toàn app (cùng UTC+7 với `Asia/Phnom_Penh`).

## 1. Migration `20261201_kpi_attendance_and_bonus_leave.sql` (chạy tay TRƯỚC deploy)

(Đặt số 20261201 để đứng sau migration mới nhất 20261130; tên trong yêu cầu là 20261119 — đã có file 20261119 khác.)

1. `kpi_score_weights`: `so_ngay_nghi_tua_chuan INTEGER NOT NULL DEFAULT 6`, `he_so_phat_khong_phep NUMERIC(5,3) NOT NULL DEFAULT 0.020`.
   `ngay_chuan_chuyen_can` giữ cột (tháng cũ đã khoá vẫn đọc được trong `chi_tiet`) nhưng công thức mới không dùng.
2. `kpi_attendance_records` — đúng như yêu cầu (UNIQUE factory+user+ngày; `trang_thai` 4 giá trị; `nguon` auto_app | cham_diem_d |
   bo_sung_tay; `dung_phep_thuong`; `ly_do`). Thêm cột `nguon_chi_tiet TEXT[]` (vd `{san_luong,ky_so}`) để lịch hiện "Nhập sản lượng".
   CHECK: `dung_phep_thuong` chỉ khi `nghi_co_phep`; `ly_do` NOT NULL khi `bo_sung_tay`.
3. `kpi_attendance_logs` — insert-only (trigger chặn UPDATE/DELETE), đúng cột yêu cầu.
4. `kpi_bonus_leave_ledger` — đúng cột yêu cầu; UNIQUE `(factory_id, user_id, chuoi_thang)` WHERE `loai_giao_dich='tich_luy_3_thang'`;
   UNIQUE `(factory_id, user_id, ngay_su_dung)` WHERE `loai_giao_dich='su_dung_bu_phep'`. Insert-only.
5. RLS: SELECT = chính mình / admin / `kpi.view_all` / `kpi.manage_config` / lãnh đạo phòng ban của nhân viên (`kpi_is_department_leader`).
   Không có INSERT/UPDATE/DELETE cho client — mọi ghi qua RPC.
6. RPC (`SECURITY DEFINER`, kiểm `auth.uid()` trong hàm):
   - `kpi_collect_auto_presence_days(factory, nam, thang)` → bảng (user_id, ngay, nguon_chi_tiet[]) gom từ mọi nguồn ở mục 0,
     ngày = `(thời điểm AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`. Chỉ đọc.
   - `kpi_sync_attendance(factory, nam, thang)`: upsert ngày `auto_app` / `cham_diem_d` thành `co_mat`; KHÔNG đụng dòng `bo_sung_tay`;
     xoá dòng auto không còn nguồn (vd phiếu bị xoá). Rồi xét chuỗi 3 tháng (mục 3). Gọi khi bấm "Tính điểm tháng" và khi mở lịch.
   - `kpi_set_attendance(factory, user_ids[], ngays[], trang_thai, dung_phep_thuong, ly_do)`: quyền admin / `kpi.manage_config` /
     lãnh đạo phòng ban của TỪNG nhân viên; lý do bắt buộc; chặn tháng đã khoá sổ của người đó; dùng phép thưởng ⇒ kiểm số dư năm của
     ngày đó > 0 rồi ghi ledger −1; bỏ dùng phép / đổi trạng thái khỏi `nghi_co_phep` ⇒ ghi ledger +1 (`dieu_chinh_tay`) hoàn lại.
     Mỗi ngày 1 dòng `kpi_attendance_logs`.
   - `kpi_bonus_leave_adjust(...)`: admin cộng/trừ tay sổ phép, lý do bắt buộc.
   - `kpi_compute_monthly_scores`: chép từ 20260827, CHỈ đổi khối hệ số chuyên cần (mục 2) + ghi thêm vào `chi_tiet`. A/B/C/D,
     renormalize, xoá dòng mồ côi, bỏ qua tháng đã khoá: giữ nguyên.

## 2. Công thức (đúng yêu cầu)

```
Công_chuẩn = Số_ngày_lịch − so_ngay_nghi_tua_chuan (6)          → 30 ngày: 24 · 31: 25 · 28: 22 · 29: 23
Tỷ_lệ_công = (Có_mặt + Phép_thưởng_bù) ÷ Công_chuẩn
Hệ_số_chuyên_cần = CLAMP(Tỷ_lệ_công − Nghỉ_không_phép × 0,02 ; 0,75 ; 1,10)
```
- Ngày không có dòng nào (không thao tác, không ai chấm) = "Chưa ghi nhận": không cộng tử số, KHÔNG phạt. Chỉ ngày được đánh dấu
  `nghi_khong_phep` mới bị trừ 0,02.
- Nghỉ tua / Nghỉ có phép không bù: không cộng tử số, không phạt.
- `chi_tiet` thêm: so_ngay_lich, ngay_chuan, so_ngay_co_mat (tự động / bổ sung tay), so_ngay_phep_thuong_bu, so_ngay_co_phep,
  so_ngay_khong_phep, so_ngay_nghi_tua, so_ngay_chua_ghi_nhan, muc_phat, cong_thuc_version = 2.
- Tháng đã khoá sổ giữ nguyên số cũ (không tính lại).

## 3. Chuỗi 3 tháng & sổ phép thưởng
- Tháng "đủ 100%" = tháng ĐÃ KẾT THÚC, mọi ngày lịch đều `co_mat` (không tua, không phép kể cả có bù, không không phép, không ngày trống).
- Chuỗi trong cùng năm dương lịch; tháng không đủ ⇒ reset 0/3; đủ 3 ⇒ ledger +1 (`chuoi_thang = '2026-01..2026-03'`), đếm lại từ 0.
- Số dư năm N = Σ ledger `nam = N`; phép thưởng chỉ dùng cho ngày thuộc năm N; qua 31/12 tự hết (không cần job, vì chỉ đọc theo năm).
- Xét chuỗi chạy trong `kpi_sync_attendance` (độc lập với việc có điểm A–D hay không).

## 4. Giao diện
- **Tab mới "Chấm công"** trong KPI (`/dashboard/kpi/attendance`), không nhồi vào Bảng điểm / Chấm chuyên môn (2 trang đó đã nặng):
  - Bảng tháng: hàng = nhân viên (lọc phòng ban), cột = ngày; ô màu: xanh lá tự động · tím bổ sung tay · xanh dương tua · vàng có phép
    (+ dấu bù phép) · đỏ không phép · xám trống; viền cam = mâu thuẫn (đánh dấu nghỉ nhưng có thao tác app). Tooltip: nguồn / người /
    lúc / lý do. Cột cuối: Có mặt · Công chuẩn · Hệ số dự kiến.
  - Kéo chọn nhiều ô (cùng 1 người hoặc nhiều người) → "Chấm công tay": trạng thái, "Dùng 1 ngày phép thưởng" (ẩn khi không phải
    Nghỉ có phép; số dư 0 ⇒ khoá + cảnh báo vàng), lý do bắt buộc.
  - Khung dưới: nhật ký điều chỉnh (`kpi_attendance_logs`) theo bộ lọc.
  - Nhân viên thường chỉ thấy lịch của chính mình (chỉ xem).
- **Thẻ "Sổ phép thưởng & chuỗi chuyên cần"** ở Bảng điểm KPI → Điểm của bạn: "Chuỗi tháng đủ 100% ngày: 2/3 (T1, T2)", "Số dư phép
  thưởng năm 2026: X ngày (hết hạn 31/12/2026)".
- **Chi tiết cách tính điểm** (`kpi-score-breakdown.ts`): thay dòng chuyên cần bằng công thức mục 2 với số thật.
- Chuông KPI: lãnh đạo thấy "N ngày mâu thuẫn chấm công" (sau, nếu cần).

## 5. Thứ tự làm & kiểm
1. Migration + RPC → script kiểm gọi RPC thật cho 1 tháng: so số ngày có mặt từng người với số đếm tay từ các bảng nguồn.
2. Tab Chấm công + chấm tay + nhật ký.
3. Sổ phép, chuỗi 3 tháng, thẻ hiển thị.
4. Đổi hệ số trong `kpi_compute_monthly_scores` + breakdown; script so hệ số cũ/mới từng người tháng 10–11/2026 (chưa khoá).
5. `npx tsc --noEmit` + `npx eslint`, hướng dẫn test tay, hỏi trước commit.

## 6. Để sau (đã chốt trước đó, KHÔNG làm trong K1 này)
- K1b: nhật ký thiết bị + IP 1 lần/ngày, báo cáo nghi dùng chung tài khoản; màn "Phân tích thao tác" (dồn cuối tháng, nhập trễ, thiếu
  nghĩa vụ chéo module) — chỉ cảnh báo.
- K1c: độ khó việc 1/2/3 + A chỉ tính % đã nghiệm thu.
