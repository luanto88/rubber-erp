# Bàn giao — Vật tư mua ngoài & Gia công ngoài: Bước 2 và Bước 3

Kế hoạch gốc (đã được người dùng duyệt): `.claude/plans/vat-tu-mua-ngoai-gia-cong-2026-10-18.md`.
Nhánh: `fix/ext-materials-inventory-items`.

## Đã xong — Bước 1 (2026-10-18, chờ test tay)
Mục B (một phần) + C (một phần) + D (một phần) của kế hoạch gốc — không migration:
- `maintenance/_components/ext-material-modal.tsx` (`ExtMaterialModal`) dùng chung biên bản + Cài đặt:
  gợi ý vật tư gần giống khi gõ tên, nút Lịch sử (`/api/purchase/item-insight`), "Dùng mã này", chặn trùng
  tên/mã ở client, ảnh upload/chụp 1 ảnh, chọn kho mặc định (mặc định KT).
- `api/maintenance/external-items`: nhận `warehouseId`, ảnh chỉ nhận URL Storage của dự án.
- Chi tiết: `.claude/rules/14-maintenance-module.md` mục cuối "Modal vật tư mua ngoài dùng chung".

Chưa làm trong Bước 1 (cố ý, thuộc Bước 3): ô "Loại: Mua ngoài / Gia công ngoài" của modal, nguồn
`gia_cong`, cột Loại ở danh sách Cài đặt.

## Bước 2 — Chọn kho nhập + tổng quát hoá Kho tạm KT (mục E, không cần migration)
Đụng luồng đang chạy production ⇒ test kỹ biên bản cũ đã nhập KT.

1. `src/app/api/purchase/requests/[id]/receive/route.ts` (~dòng 47-53): bỏ ép KT cho phiếu có
   `maintenance_record_id`; chỉ kiểm kho thuộc nhà máy.
2. `src/app/dashboard/purchase/_components/purchase-fulfillment.tsx`: mở khoá ô kho của "Ghi nhận mua",
   chọn sẵn KT (hoặc kho mặc định của vật tư nếu muốn — hỏi người dùng).
3. `src/lib/maintenance-kt.ts` `computeKtStatuses`: tính theo **(kho, vật tư)**. Kho của vật tư mua ngoài
   của 1 biên bản = kho của `purchase_receipts` gần nhất thuộc phiếu đề nghị liên kết biên bản đó
   (`purchase_receipts.warehouse_id` đã có từ 20261008); chưa nhận hàng → kho chính của vật tư (rule
   `is_primary`) → KT. Khả dụng = tồn kho đó − nhu cầu các biên bản tạo trước cùng (kho, vật tư).
   Giữ tên hàm/kiểu trả về, thêm `warehouseId/warehouseCode` vào từng nhu cầu ⇒ `KtShortageBanner`,
   `create-request` (409), `purchase-draft` ít phải sửa. Đổi nhãn "Kho tạm KT" → "Kho {code}".
4. `src/lib/maintenance-stock-issuance.ts` (~dòng 96): `ben_ngoai` xuất từ kho tính ở bước 3 (dùng chung
   helper), mã phiếu `X-BT-{ma_bb}-{KHO}` theo cơ chế nhóm theo kho sẵn có.
5. Bỏ câu cảnh báo "biên bản vẫn nhập/xuất qua KT" trong `ext-material-modal.tsx` (khối `selectedWh.code !== KT_CODE`).
6. Rủi ro chấp nhận: hàng nhập kho thường không được "giữ" ⇒ cảnh báo khi khả dụng < cần.

Test: phiếu từ biên bản → Ghi nhận mua kho khác KT → biên bản hết báo thiếu, ký xong phiếu xuất
`X-BT-…-{KHO}` trừ đúng kho; biên bản cũ nhập KT chạy y như cũ.

## Bước 3 — Gia công ngoài (mục A phần dịch vụ + F + G)
1. Migration `supabase/migrations/2026MMDD_maintenance_service_items.sql` (chạy tay TRƯỚC deploy):
   `inventory_items.la_dich_vu`, `purchase_request_lines.sl_hoan_thanh`, bảng `purchase_service_completions`
   (RLS SELECT như `purchase_receipts`, ghi service role), sửa `purchase_effective_lines` /
   `purchase_recompute_request` (dòng dịch vụ `received` = SUM completions), `purchase_receive` chặn dòng
   dịch vụ, guard `inventory_post_*_document` từ chối item dịch vụ, seed phân loại "Gia công ngoài" (tuỳ chọn).
   ⚠️ Chép thân hàm từ migration MỚI NHẤT của từng RPC, không dựng lại từ bản cũ.
2. API `external-items`: nhận `laDichVu` ⇒ `default_warehouse_ids = []`, không tạo rule kho,
   `nguon_tao='bao_tri_gia_cong'`.
3. `ExtMaterialModal`: thêm Loại [Mua ngoài (nhập kho)] / [Gia công ngoài (dịch vụ)]; ẩn Kho khi dịch vụ.
   Cài đặt: lọc `nguon_tao IN ('bao_tri_mua_ngoai','bao_tri_gia_cong')` + cột Loại.
4. Biên bản: thêm `gia_cong` vào select Nguồn (nhãn "Gia công ngoài"); dropdown vật tư `gia_cong` chỉ liệt
   kê `la_dich_vu`, `trong_kho`/`ben_ngoai` ẩn dịch vụ. `maintenance_materials.nguon` là TEXT không CHECK.
5. `computeKtStatuses` bỏ qua `gia_cong`; `purchase-draft` thêm dòng `gia_cong` chưa có đề nghị.
6. `purchase-fulfillment.tsx`: dòng dịch vụ có nút "Xác nhận hoàn thành" → route mới
   `POST /api/purchase/requests/[id]/complete-service` (SL, đơn giá thực tế cảnh báo lệch >10%, ngày, ảnh,
   ghi chú). Đủ mọi dòng → `hoan_tat`. Ký biên bản KHÔNG chờ dịch vụ hoàn thành.
7. Ẩn dịch vụ khỏi kho: `inventory/_components/inventory-data.ts` lọc `la_dich_vu = false`; quick-add nhập
   kho không tạo dịch vụ. `ItemPicker` Đề nghị mua gắn nhãn "Dịch vụ"; `InsightPanel` với dịch vụ ẩn tồn/tiêu hao.
8. PDF đề nghị mua / F06 / F07: dòng gia công in như vật tư, ghi "Gia công ngoài".
9. Tài liệu: rule 14, 28, 13.

## Quy tắc cho phiên sau
- Mỗi bước dừng cho người dùng test trước khi sang bước tiếp.
- Chỉ `npx tsc --noEmit` + `npx eslint <file>`; không `npm run build`.
- Container mới: chạy `npm ci --ignore-scripts` trước khi kiểm tra (không có `node_modules`).
- `tsc` báo `Cannot find name 'PageProps'` ở 2 trang storage là do thiếu `.next/types` — không phải lỗi code.

## Prompt gợi ý mở đầu phiên sau
```
Đọc .claude/plans/ban-giao-vat-tu-mua-ngoai-buoc-2-3.md và kế hoạch gốc
.claude/plans/vat-tu-mua-ngoai-gia-cong-2026-10-18.md (nhánh fix/ext-materials-inventory-items).
Bước 1 đã xong. Hỏi tôi kết quả test tay Bước 1 trước; có lỗi thì sửa trước.
Sau đó làm Bước 2 (chọn kho nhập + tổng quát hoá Kho tạm KT), dừng cho tôi test trước khi sang Bước 3.
```
