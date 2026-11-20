# Kế hoạch cải tiến hệ thống Đánh giá KPI & 5S (đối chiếu các hệ thống chuyên nghiệp)

## Context
Người dùng hoãn U11 (giao diện KPI). Yêu cầu mới: tìm hiểu cách các hệ thống ERP/HRM chuyên nghiệp đánh giá KPI và
5S (khoa học, công bằng, dễ thao tác) rồi lập kế hoạch cải tiến module `/dashboard/kpi` hiện tại (rule 27).
Tài liệu này là KẾ HOẠCH để duyệt — chưa sửa code. Mỗi giai đoạn sẽ có plan chi tiết riêng + migration riêng khi làm.

## 1. Hệ thống chuyên nghiệp làm gì (tóm tắt nghiên cứu)
| Chủ đề | Thực hành phổ biến |
|---|---|
| Mục tiêu có trọng số | SAP SuccessFactors / Oracle / Odoo (add-on): mỗi mục tiêu có trọng số, tổng 100%; điểm = Σ trọng số × mức đạt |
| Ngưỡng – Mục tiêu – Vượt | Mỗi chỉ tiêu định trước 3 mốc (thường 80–90% / 100% / 110–120%), điểm theo dải, có trần (cap) để 1 chỉ tiêu vượt không "gánh" cả bảng |
| Hiệu chuẩn (calibration) | Trước khi chốt, các quản lý họp so phân bố điểm giữa người chấm/phòng ban; điểm lệch phải có bằng chứng. SAP hiển thị phân bố khuyến nghị (chỉ cảnh báo, không chặn) |
| Chống thiên lệch người chấm | Thang neo hành vi (BARS — mỗi mức có mô tả cụ thể), đào tạo cùng khung tham chiếu, thống kê người chấm "dễ/khó/toàn trung bình" |
| Phản hồi liên tục + 360 | Ghi nhận phản hồi trong kỳ, tự đánh giá, đồng nghiệp đánh giá (Odoo 360 qua Surveys); nhân viên xác nhận đã xem kết quả |
| 5S chuyên nghiệp | Checklist theo TỪNG S (Sàng lọc · Sắp xếp · Sạch sẽ · Săn sóc · Sẵn sàng), thang 1–5 có định nghĩa chữ từng mức, quy ra %; giữ thang cố định để so xu hướng |
| 5S bằng chứng & khắc phục | Bắt buộc ảnh khi trừ điểm; mục điểm thấp tự sinh việc khắc phục có người + hạn; biểu đồ xu hướng theo khu vực |
| 5S công bằng | Tự đánh giá hằng tuần + đánh giá chính thức; người khu vực cùng tham gia; luân phiên/chéo người đánh giá |

## 2. Đối chiếu với module hiện tại
**Đã tốt (giữ):** công thức A/B/C/D có trọng số cấu hình; renormalize khi thiếu dữ liệu; log bất biến; khiếu nại 3 loại
(5S có quy trình 3 bước); khoá sổ + điều chỉnh có lý do; 5S bắt buộc ảnh, snapshot người chịu trách nhiệm theo tuần,
người dọn ≠ người chấm; chặn chấm sớm; nhóm chính ×10 / nhóm choàng ×5 chuẩn hoá theo ngày.

**Khoảng trống (theo mức ảnh hưởng tới công bằng):**
1. **Chuyên cần phụ thuộc người chấm**: hệ số = số ngày CÓ BẢN CHẤM D ÷ 24 ⇒ quản lý quên chấm là nhân viên bị trừ.
2. **Mọi công việc nặng như nhau**: A/B là trung bình đơn giản — việc 5 phút = việc 2 tuần. Không có độ khó/trọng số việc.
3. **A dùng % tự báo cáo** khi chưa nghiệm thu ⇒ dễ khai cao.
4. **D chấm 3 mức không có mô tả neo** và **không có thống kê người chấm** ⇒ không phát hiện ai chấm "Đạt" cho tất cả.
5. **Không có bước hiệu chuẩn** trước khoá sổ (chỉ có Tính điểm → Khoá).
6. **5S chỉ 1 kết quả/tuần (Đạt/Tương đối/Không đạt)** — không biết hỏng ở S nào, khó so xu hướng, khó tranh luận khi khiếu nại.
7. **5S không có hành động khắc phục tự động** (việc đột xuất phải giao tay); không có tự đánh giá; người chấm cố định lâu dài.
8. **Chưa dùng số liệu khách quan sẵn có trong ERP** (đúng hạn ký biên bản bảo trì, phiếu KN đúng ngày, nhập sản lượng đủ xe…).
9. **Thiếu xếp loại + xu hướng**: không có dải Xuất sắc/Tốt/Đạt/Cần cải thiện, không có biểu đồ điểm theo tháng, nhân viên không xác nhận đã xem.

## 3. Lộ trình đề xuất (mỗi GĐ dừng cho test, có migration chạy tay riêng)

### K1 — Công bằng cốt lõi (ưu tiên cao, ít xáo trộn)
- **Chuyên cần tách khỏi việc chấm** — ngày có mặt gồm 2 lớp (người dùng chốt 2026-11-19):
  - **Lớp 1 — tự động từ thao tác trên app.** Ngày có mặt = ngày (giờ nhà máy) có ÍT NHẤT 1 thao tác thật, tính theo
    THỜI ĐIỂM THAO TÁC (`created_at`), KHÔNG theo ngày nghiệp vụ của chứng từ — nhập phiếu ngày 15 vào ngày 18 thì ngày
    có mặt là 18. Kèm màn "Phân tích thao tác" (biểu đồ tần suất theo ngày/tháng + chỉ số chất lượng thao tác):
    - Dồn cuối tháng: % thao tác rơi vào 5 ngày cuối tháng; số ngày có thao tác / số ngày làm việc.
    - Nhập trễ: độ trễ = ngày thao tác − ngày nghiệp vụ (sản lượng `ngay`, thành phẩm `ngay_nhap`, điều xe, KN `ngay_kn`,
      đo nhanh…); thống kê số phiếu trễ ≥ 1 / ≥ 3 ngày, trễ trung bình.
    - Thiếu nghĩa vụ chéo module: vd ngày có thành phẩm mà không có phiếu đo nhanh; cấu hình "nghĩa vụ hằng ngày" theo
      nhóm chuyên môn (điều kiện kích hoạt + bảng phải có dữ liệu) — phần này gần với K6.
  - **Lớp 2 — chấm công tay trên lịch tháng** (Cài đặt, cho nhân viên ít thao tác app): người có quyền chấm công tick
    hằng ngày; quản lý phòng / GĐ nhà máy / admin bổ sung hoặc sửa ngày đã qua (vd cuối tháng) — BẮT BUỘC lý do. Mọi
    tick / bỏ tick / sửa ghi nhật ký bất biến (ai, lúc nào, giá trị cũ → mới, lý do). Khoá khi tháng đã khoá sổ điểm.
  - **Hợp nhất:** có mặt = Lớp 1 HOẶC Lớp 2 "có mặt". Lớp 2 ghi vắng/nghỉ mà Lớp 1 có thao tác ⇒ cờ mâu thuẫn (dấu hiệu
    dùng chung tài khoản), hiện cho lãnh đạo, không tự trừ điểm.
  - **Phát hiện dùng chung tài khoản** (chỉ là tín hiệu nghi vấn, không kết luận tự động): ghi nhật ký phiên dùng app
    (thời điểm, mã thiết bị ngẫu nhiên lưu trên trình duyệt, IP, trình duyệt/hệ điều hành) 1 lần/ngày/thiết bị.
    Nghi vấn khi: 1 thiết bị dùng bởi ≥ 2 tài khoản trong cùng ngày; 1 tài khoản dùng đồng thời ở 2 thiết bị; thao tác
    trong ngày Lớp 2 ghi nghỉ. IP yếu (máy trong nhà máy chung 1 IP, 4G đổi IP) — chỉ dùng bổ trợ.
  - Ngày có mặt mà chưa được chấm D ⇒ hiện "Thiếu bản chấm" cho người chấm (chuông + bảng), KHÔNG trừ nhân viên.
  - Bước đầu K1: khảo sát từng bảng nghiệp vụ có `created_by` / `created_at` / ngày nghiệp vụ hay không.
  - Chốt thêm 2026-11-19: (a) chỉ số chất lượng thao tác CHỈ CẢNH BÁO (biểu đồ phân tích + bước hiệu chuẩn K3), không tự
    trừ điểm; (b) ngày chuẩn chuyên cần = **26** (đổi mặc định 24 → 26 ở `kpi_score_weights`; tháng đã khoá sổ không
    tính lại); (c) ghi nhật ký thiết bị + IP 1 lần/ngày/thiết bị, CÔNG KHAI với nhân viên, chỉ admin / lãnh đạo xem báo cáo
    nghi vấn, không dùng GPS. (d) lịch chấm công tay có 4 trạng thái: Có mặt / Nghỉ tua / Nghỉ phép / Nghỉ không
    phép; (e) không về tua mà đủ công 3 tháng ⇒ được bù 1 ngày có phép (chi tiết quy tắc đang chờ chốt).
- **Độ khó công việc** (`kpi_tasks.do_kho` 1/2/3, mặc định 1, người giao chọn): A và B tính bình quân có trọng số theo độ khó.
- **A chỉ tính % đã nghiệm thu**; việc đã đến hạn mà chưa nghiệm thu ⇒ lấy % tự báo nhưng gắn cờ, người giao bị nhắc.
- Cần sửa RPC `kpi_compute_monthly_scores` (bản sao từ migration mới nhất 20260827) — quy tắc giữ nguyên ngoài 3 điểm trên.

### K2 — Chấm chuyên môn có neo + thống kê người chấm
- Mỗi tiêu chí trong `kpi_criteria_templates` thêm mô tả cho 3 mức (Đạt / Tương đối / Chưa đạt) hiện ngay khi chấm.
- Mức "Chưa đạt" bắt buộc ghi chú (tuỳ chọn ảnh) — giống 5S "Không đạt" phải có lý do.
- Báo cáo "Thống kê người chấm" (tháng): số lượt, % Đạt/Tương đối/Chưa đạt theo từng người chấm và phòng ban; cảnh báo
  khi một người chấm ≥ 95% "Đạt" hoặc lệch xa trung bình nhà máy (chỉ cảnh báo, không chặn).

### K3 — Hiệu chuẩn trước khi khoá sổ
- Trạng thái điểm tháng thêm bước: Nháp → **Đang hiệu chuẩn** → Đã khoá.
- Màn hiệu chuẩn: phân bố điểm theo phòng ban/người chấm (biểu đồ), danh sách người lệch, điều chỉnh có lý do (dùng lại
  `kpi_score_adjustments`), biên bản hiệu chuẩn (người tham gia, ngày).
- **Xếp loại** theo dải cấu hình (vd ≥90 Xuất sắc, 75–89 Tốt, 60–74 Đạt, <60 Cần cải thiện); phân bố khuyến nghị chỉ cảnh báo.
- Nhân viên **xác nhận đã xem** điểm + ghi ý kiến (mở khiếu nại trong N ngày sau khoá); biểu đồ xu hướng 6–12 tháng.

### K4 — 5S theo checklist 5 chữ S
- Khung checklist cấu hình được: mỗi S vài mục, thang 1–5 có định nghĩa chữ từng mức (Cài đặt → KPI & 5S).
- Một lần chấm = điểm từng mục → điểm từng S → % tổng. Mục ≤ 2 bắt buộc ảnh + tự sinh **việc khắc phục** (dùng lại "việc
  đột xuất 5S": người dọn, hạn mặc định cấu hình, ảnh before = ảnh chấm).
- Điểm C dùng % tổng thay cho 100/50/0. Dữ liệu cũ 3 mức giữ nguyên, quy đổi Đạt=100/Tương đối=50/Không đạt=0 (không migrate).
- Biểu đồ xu hướng theo vị trí/khu vực và theo từng S; QR vị trí vẫn như cũ.

### K5 — 5S công bằng hơn
- **Tự đánh giá** của người dọn (không tính điểm, so với điểm chính thức để thấy chênh lệch).
- **Luân phiên người chấm**: tuỳ chọn mỗi tháng/quý tự đề xuất người chấm khác khu vực (dùng lại "Phân công thông minh").
- **Kiểm tra chéo ngẫu nhiên**: X% lượt chấm được người thứ 2 chấm lại; lệch lớn ⇒ cảnh báo cho lãnh đạo.

### K6 — KPI khách quan từ dữ liệu ERP (tuỳ chọn, cần chốt nghiệp vụ)
- Thư viện "chỉ số tự động" gắn được vào nhóm chuyên môn như 1 tiêu chí D hoặc thành phần E: vd % biên bản bảo trì ký đúng
  hạn, % phiếu KN nhập trong ngày, % xe điều xe có sản lượng, số lỗi bị trả về… Mỗi chỉ số có ngưỡng/mục tiêu/vượt + trần.
- Làm sau cùng vì cần chốt từng chỉ số với từng phòng ban.

## 4. Quyết định đã chốt (2026-11-19)
1. Ngày có mặt = **suy từ hoạt động trên app** (có thao tác KPI/5S/nhập liệu nghiệp vụ trong ngày theo giờ nhà máy).
   K1 cần chốt tiếp danh sách nguồn hoạt động + cách xử lý người ít dùng app (đề xuất: quản lý được bổ sung tay ngày có mặt, có lý do + log).
2. KPI **dùng tính thưởng** ⇒ K3 (hiệu chuẩn bắt buộc trước khoá sổ, xếp loại theo dải, nhân viên xác nhận đã xem) là bắt buộc, không phải tuỳ chọn.
3. Độ khó việc: **3 mức Dễ/Thường/Khó = 1/2/3**.
4. 5S: **checklist từng S, thang 1–5** có mô tả chữ từng mức (K4).
5. Thứ tự đề xuất: K1 → K4 → K2 → K3 → K5 → K6 (K3 có thể kéo lên trước K2 nếu cần chốt thưởng sớm).

## 5. Nguyên tắc khi triển khai
- Không đổi dữ liệu đã khoá sổ; điểm các tháng cũ giữ nguyên công thức cũ (lưu phiên bản công thức trong `chi_tiet`).
- Mọi `CREATE OR REPLACE` RPC chép từ migration mới nhất; RLS dùng `current_profile_has_permission`.
- Kiểm bằng `npx tsc --noEmit` + `npx eslint`; script kiểm RPC gọi code thật trên dữ liệu thật (so trước/sau từng người).
- U11 (giao diện KPI) làm SAU khi chốt K1–K4 để khỏi làm lại giao diện.
