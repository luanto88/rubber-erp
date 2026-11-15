# Kho vật tư — Tra cứu "Phiếu cũ" tháng 1–7/2026 (dữ liệu AppSheet) — ĐÃ CODE 2026-11-15 (xem rule 13 + rule 30)

> Đã chốt: Kho A = Kho Vật Tư, Kho B = Kho Hóa Chất; lồng vào tab Nhập/Xuất; có đưa vào đối soát định mức.
> Khác thiết kế dưới: KHÔNG migration (ánh xạ kho / chuẩn hoá người / ngày lập làm ở `src/lib/inventory-legacy.ts`),
> không công tắc — phiếu cũ luôn hiện khi khoảng ngày chạm tháng 1–7, lọc qua "Loại phiếu"; Sổ chi tiết KHÔNG lồng (thẻ kho
> có tồn lũy kế). Phần dưới giữ làm lịch sử thiết kế.

> Người dùng yêu cầu (2026-11-15): đưa các dòng tháng 1 → 7/2026 vào app để **lọc xem các phiếu** như phiếu thật.
> Ràng buộc giữ nguyên từ rule 13: dữ liệu cũ KHÔNG ghi vào `inventory_documents` / `inventory_stock_movements`, KHÔNG
> đụng tồn / thẻ kho / balance_after. Chỉ đọc từ `inventory_legacy_movements` (đã import 771 dòng, 2026-11-15).

## Hiện trạng dữ liệu (đo 2026-11-15)
- 771 dòng, 02/01 → 31/07/2026, **372 mã NX** (= 372 "phiếu" cũ; 1 mã NX gồm nhiều vật tư), 32 dòng nhập, 739 dòng xuất.
- 21 dòng số lượng = 0 (vd X300726170537: LP152, DCS, MT, AA) — AppSheet lưu dòng rỗng. Hiển thị nhưng làm mờ, có lọc "Ẩn dòng 0".
- Tên kho trong file ≠ tên kho app: `Kho A`, `Kho B`, `Kho dầu đội xe`, `Kho nguy hại`, `Kho dầu Biomass`, `Kho dầu máy phát lớn`
  (app: Kho Vật Tư, Kho Hóa Chất, Kho dầu đội xe, Kho dầu mủ tạp, Kho dầu máy phát lớn, Kho nguy hại, Kho nước thải…).
- Người NX lẫn chính tả: `Chau Nho` / `Châu Nho.` / `Nguyễn Hữu Thọ`.
- Mã NX dạng `X|N` + `ddmmyy` (NGÀY LẬP trên AppSheet) + `hhmmss` — khác `Ngày NX` (vd X290726091857 lập 29/07, ngày NX 26/07).
- 1 dòng đã loại (EXCLUDE trong script): DO750K "Lần 24" — trùng phiếu thật 27/07.

## Thiết kế đề xuất

### GĐ-L1 — Migration nhỏ (chạy tay, idempotent) `2026112x_inventory_legacy_lookup.sql`
1. Cột `warehouse_id UUID NULL REFERENCES inventory_warehouses(id)` + bảng ánh xạ tên kho cũ → kho app
   (`inventory_legacy_warehouse_map(factory_id, legacy_name, warehouse_id)`), seed: Kho A → Kho Vật Tư, Kho B → Kho Hóa Chất,
   các kho trùng tên ánh xạ thẳng (căn cứ: mã phiếu app `N-KA-…` thuộc Kho Vật Tư, `N-KB-…` thuộc Kho Hóa Chất — vẫn nhờ
   người dùng xác nhận). Cập nhật `warehouse_id` theo bảng ánh xạ.
2. Cột `nguoi_nx_chuan TEXT` (chuẩn hoá `Châu Nho.` → `Chau Nho`) — hoặc chuẩn hoá luôn trong script import (ít đụng DB hơn).
3. Cột `ngay_lap DATE` tách từ mã NX (ddmmyy) — cho biết phiếu lập trễ bao nhiêu ngày (hữu ích khi rà soát trùng lệch ngày).
4. Index `(factory_id, ma_nx)`. RLS SELECT giữ nguyên (`inventory.view`).
5. Script import: điền 3 cột trên khi upsert; vẫn tôn trọng `EXCLUDE`.

### GĐ-L2 — Hiển thị (đề xuất: lồng vào tab Nhập / Xuất, không mở tab mới)
- Tab **Xuất** (và **Nhập**): bộ lọc thêm công tắc **"Gồm phiếu cũ (trước 30/07/2026)"** — mặc định TẮT; tự BẬT khi khoảng
  ngày lọc chạm trước 30/07/2026 (gợi ý, người dùng tắt được).
- Khi bật: danh sách gộp phiếu thật + "phiếu cũ" (gom theo `ma_nx`), sắp theo ngày. Phiếu cũ có nhãn xám **"Dữ liệu cũ"**,
  số phiếu = mã NX, không có nút sửa / huỷ / ký / điều chỉnh; dòng xổ (rule 29) liệt kê vật tư · SL · ĐVT · ghi chú; con mắt
  mở chi tiết read-only (không PDF — chỉ bảng + nguồn file).
- Bộ lọc dùng chung: khoảng ngày (theo Ngày NX), kho (qua `warehouse_id` ánh xạ), vật tư (mã/tên), người NX, tìm mã NX.
  Lọc "Loại phiếu" (Sử dụng / Điều chỉnh tồn) thêm giá trị "Dữ liệu cũ".
- StatGrid: đếm riêng "phiếu cũ" để không lẫn số phiếu thật.
- Phân trang: phiếu cũ tải theo khoảng ngày lọc (.range + .order("id")), gom ở client; ≤ 1.000 dòng / 7 tháng nên tải 1 lần.
- **Sổ chi tiết**: thêm công tắc tương tự — dòng cũ hiện cột Nhập/Xuất nhưng cột **Tồn để trống** (không có balance), ghi chú
  "Dữ liệu cũ — không tính tồn". Excel xuất kèm cột "Nguồn".

Phương án khác đã cân nhắc: tab riêng "Phiếu cũ" trong nhóm Báo cáo — đơn giản hơn (không đụng `inventory-document-list.tsx`
~950 dòng) nhưng người dùng phải tra 2 nơi. Chọn khi muốn làm nhanh / ít rủi ro.

### GĐ-L3 — Kiểm & test
- Code thật: đếm phiếu cũ theo tháng = 372 mã NX; tổng xuất tháng 7 (lọc tab Xuất, gồm phiếu cũ, bỏ phiếu điều chỉnh) khớp
  báo cáo 55-BC/46-BC tháng 7 (TT 490, DCS 75, DOX 1.319, DOCZVC 485, B004VC10 1.620, DO750K 8.233).
- Test tay: lọc 01/03–31/03 chỉ có phiếu cũ; lọc 20/07–05/08 thấy cả 2 loại, ngày 24/07 có phiếu cũ + phiếu điều chỉnh;
  phiếu cũ không có nút thao tác; tồn / thẻ kho không đổi.

## Câu hỏi cần chốt trước khi code
1. Kho A = Kho Vật Tư, Kho B = Kho Hóa Chất — đúng không?
2. Lồng vào tab Nhập/Xuất (đề xuất) hay tab riêng "Phiếu cũ"?
3. Có cần đưa dữ liệu cũ vào **đối soát định mức** tháng 1–7 không (việc treo mục 5 — cần thêm sản lượng TP/NL tháng 1–7)?
