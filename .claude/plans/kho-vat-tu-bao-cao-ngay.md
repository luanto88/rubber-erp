# Kho vật tư — tab "Báo cáo": báo cáo sử dụng theo ngày (mẫu 55-BC VT HC, 46-BC Mẫu 12B dầu) — ĐÃ CODE 2026-11-15

> Đã chốt + đã làm: xem rule 13 mục "Báo cáo sử dụng theo ngày". Ký số 2 người; mẫu tick vật tư trong Kho; có Excel;
> dữ liệu cũ vào `inventory_legacy_movements`. Phần dưới giữ làm lịch sử thiết kế.

## Bối cảnh
Người dùng chốt (2026-11-15): 2 báo cáo theo ngày KHÔNG làm trong module Định mức KTKT (GĐ4 chỉ giữ Mẫu 8A + Mẫu 09),
mà làm ở tab **Báo cáo** của module Kho vật tư (`/dashboard/inventory`, nhóm "Báo cáo" hiện có Tổng quan · Sổ chi tiết).
Lý do: bản chất là bảng XUẤT KHO theo ngày × vật tư — dữ liệu thuần kho, không cần khung định mức.

Mẫu giấy: `cung_cap_dl/55-BC-NMCB BC.10.2026.NMCB. BÁO CÁO SỬ DỤNG VT HC.pdf`, `cung_cap_dl/46-BC-NMCB … BÁO CÁO SỬ DỤNG DẦU.pdf`.
Cả 2: A4 ngang, cột = vật tư / nhóm mục đích, dòng = mỗi ngày trong kỳ (kể cả ngày 0), dòng Tổng; ký "GIÁM ĐỐC NHÀ MÁY | LẬP BẢNG
(Nhân viên kỹ thuật)"; số báo cáo chung dãy Văn bản nội bộ BC-NMCB.

## Đã kiểm chứng bằng code thật (GĐ4, 2026-11-12, tháng 10/2026)
Logic dưới đây đã chạy thử trong GĐ4 rồi gỡ ra — số khớp giấy:
- 46-BC: Cấp xe vận chuyển (DOX+DOCZVC) 1.830 · Xe xúc (DOXU12+DOXUNL) 2.684 · Xe nâng (DON) 558 · Cozon nội bộ (DOCZNB) 453 ·
  Xúc Biomass (DOXU3) 160 — khớp tuyệt đối.
- 55-BC: Formic 06/10 = 420, 18/10 = 350; Bọc PE 0,04 theo ngày khớp.

Nguồn: `inventory_stock_movements` `movement_type='export'`, `movement_date` trong kỳ, cộng `quantity_out` theo (ngày, item_id) —
phân trang `.range()`. Phiếu huỷ đã bị xoá movement nên không cần lọc thêm.

## Thiết kế đề xuất (chờ người dùng duyệt)
1. Sổ đăng ký mẫu `inventory_report_templates` (factory_id, code, name, config JSON, phien_ban, is_active, sort_order):
   - Kiểu `cot_nhom` (12B): `columns: [{ label, codes[] }]` — cột = nhóm mục đích cấp dầu → mã vật tư. Seed 9 cột theo 46-BC
     (DOX+DOCZVC · DOXU12+DOXUNL · DON · DOCZNB · DOXU3 · xe văn phòng · máy phát sinh hoạt · vệ sinh trục cán · máy phát sản xuất).
   - Kiểu `tu_dong` (55): mọi mã thuộc các nhóm vật tư chọn sẵn (tái dùng `tech_norm_report_categories` hoặc bảng riêng) có xuất
     trong kỳ; LOẠI dầu DO (`isFuelCategory(cat) && /^DO/i.test(code)` — nhớt, mỡ vẫn thuộc 55); ghim thêm / loại mã; ẩn cột 0 cả kỳ.
2. Màn tab Báo cáo → "Báo cáo sử dụng theo ngày": chọn mẫu + kỳ → xem trước PDF (DocViewer loadBytes, A4 ngang, QR góc phải trên)
   → Lưu / Gửi ký 2 người (Lập bảng → Giám đốc `mac_dinh_ky`) qua `yeu_cau_ky` `modun='inventory'` (route riêng như purchase),
   hoặc chỉ in không ký (hỏi người dùng).
3. Cột > 14 ⇒ chữ 6pt; tên cột kèm ĐVT; dòng "Tổng" + "Tổng cộng" (chỉ 12B).

## Câu hỏi cần chốt trước khi code
- Có cần ký số không, hay chỉ xuất PDF / Excel để in ký tay?
- Nhóm vật tư của 55 dùng chung danh mục "Nhóm vật tư báo cáo" của Định mức hay danh mục riêng của Kho?
- Có cần bản Excel (bám mẫu) bên cạnh PDF?
