# Vật tư mua ngoài & Gia công ngoài cho Bảo trì — kế hoạch cho phiên sau

> Phiên trước (2026-10-17, nhánh `fix/ext-materials-inventory-items`, đã push) đã sửa lỗi FK
> `purchase_request_lines_item_id_fkey`: vật tư mua ngoài tạo mới giờ ghi `inventory_items`
> qua `POST /api/maintenance/external-items`. Kế hoạch dưới đây là đợt TIẾP THEO.

## Context — 4 việc người dùng yêu cầu + đã chốt
1. **Chọn kho, mặc định Kho tạm KT** — ở CẢ 2 bước: kho mặc định khi tạo mã vật tư mua ngoài,
   và kho nhập khi "Ghi nhận mua" của phiếu lập từ biên bản. Biên bản xuất đúng kho đã nhập.
2. **Ảnh vật tư = ảnh upload/chụp** (không phải link). **1 ảnh đại diện** (`inventory_items.image_url`, không migration).
3. **Modal tạo vật tư ở biên bản phải có chống trùng / gợi ý tương tự / lịch sử** như form Đề nghị mua.
4. **Gia công ngoài** (bấm ống thủy lực, vá vỏ, phục hồi turbo, đổi bình khí argon…): KHÔNG nhập kho.
   Chốt: vẫn là mã trong `inventory_items` nhưng có **cờ dịch vụ** (không tồn kho); đề nghị mua
   đóng bằng "Xác nhận hoàn thành", không qua nhập/xuất kho.

## Phát hiện khi đọc code (ảnh hưởng thiết kế)
- KT bị **khoá cứng ở 4 chỗ**: `api/purchase/requests/[id]/receive/route.ts:47-53` (phiếu có
  `maintenance_record_id` phải nhập KT); `src/lib/maintenance-kt.ts` `computeKtStatuses` (chỉ đọc
  `inventory_stock_balances` của KT, giữ hàng theo thứ tự tạo biên bản); `src/lib/maintenance-stock-issuance.ts:96`
  (`sourceWarehouseId = ben_ngoai ? ktWarehouseId : …`); UI khoá ô kho trong `purchase-fulfillment.tsx`.
  ⇒ Cho chọn kho khác mà không sửa đủ 4 chỗ = biên bản báo thiếu KT mãi / xuất sai kho.
- `purchase_receipts.warehouse_id` **đã có** (migration 20261008) — biết được hàng của dòng đề nghị
  nhập vào kho nào; không cần cột kho mới trên `purchase_request_lines`.
- `maintenance_materials.nguon` là TEXT **không CHECK** (`20260511_maintenance_module.sql:117`) ⇒ thêm
  `'gia_cong'` không cần đổi ràng buộc.
- `purchase_request_lines.item_id` **nullable** (`20261007:82`) nhưng `api/purchase/requests` bắt buộc
  item_id (dòng 222) ⇒ giữ bắt buộc; dịch vụ cũng có mã nên không cần dòng không mã.
- RPC `purchase_receive` (20261008 ~297) và `purchase_recompute_request` (tính `received` từ phiếu nhập
  kho) ⇒ dòng dịch vụ sẽ không bao giờ "đủ" → phiếu kẹt `da_duyet`. Cần nguồn "đã hoàn thành" riêng.
- `PurchaseImagePicker` (`purchase/_components/purchase-image-picker.tsx`) đã có chọn nhiều + chụp,
  upload qua `uploadInventoryImage` (HEIC → JPEG). Dùng `max={1}` cho ảnh đại diện.
- `ItemPicker` đã export (`purchase-form.tsx:143`) — có lọc phân loại, cảnh báo tên gần giống
  (`src/lib/similar-name.ts`), "tạo vật tư mới". `loadPurchaseItemInsight()` (`src/lib/purchase/server.ts`)
  + `api/purchase/item-insight` trả tồn/nhập/xuất/giá gần nhất. Modal biên bản hiện KHÔNG dùng gì
  trong số này, chỉ báo 409 sau khi bấm Lưu.
- Dropdown vật tư biên bản (`records/[id]/page.tsx`, custom dropdown) dùng chung danh sách
  `inventoryItems` cho cả `trong_kho` và `ben_ngoai`.
- Góp ý về đề xuất "thêm phân loại Gia công ngoài": **chỉ dùng phân loại thì chưa đủ** — phân loại đổi
  tên/xoá được, theo từng nhà máy, code không dựa vào đó để chặn nhập kho được. Dùng cờ cột (đã chốt);
  phân loại "Gia công ngoài" vẫn nên tạo để lọc/thống kê, nhưng không phải nguồn quyết định logic.
- Góp ý thêm: gia công thường có **vật tư gửi đi** (ống cũ, turbo cũ) và đôi khi gia công kèm thay linh
  kiện — đợt này KHÔNG theo dõi xuất/nhận hàng gửi gia công; chỉ ghi chi phí dịch vụ. Ghi rõ trong rule.

## Thay đổi

### A. Migration `supabase/migrations/2026MMDD_maintenance_service_items.sql` (chạy tay TRƯỚC deploy)
- `inventory_items.la_dich_vu BOOLEAN NOT NULL DEFAULT false` + index `(factory_id) WHERE la_dich_vu`.
- `purchase_request_lines.sl_hoan_thanh NUMERIC NOT NULL DEFAULT 0` (bản chụp dịch vụ đã hoàn thành).
- Bảng `purchase_service_completions` (id, factory_id, request_id, line_id, so_luong, don_gia, ngay,
  image_urls TEXT[], ghi_chu, created_by, created_at) — RLS SELECT như `purchase_receipts`, ghi chỉ service role.
- Sửa `purchase_effective_lines` / `purchase_recompute_request`: dòng có item `la_dich_vu` lấy
  `received` = SUM `purchase_service_completions.so_luong` (dòng gốc), còn lại như cũ.
- `purchase_receive`: chặn dòng `la_dich_vu` ("Dịch vụ gia công không nhập kho").
- Chặn ghi sổ kho: trigger/guard trong `inventory_post_*_document` từ chối dòng có item `la_dich_vu`
  (lưới an toàn cuối, UI đã ẩn).
- Seed phân loại "Gia công ngoài" (`inventory_item_categories`) cho mỗi nhà máy nếu chưa có (tuỳ chọn).

### B. API tạo mã — `src/app/api/maintenance/external-items/route.ts`
- Nhận thêm `warehouseId` (mặc định KT nếu trống; kiểm thuộc nhà máy) và `laDichVu` (bool).
  Dịch vụ: `default_warehouse_ids = []`, không tạo rule kho, `nguon_tao='bao_tri_gia_cong'`.
- `imageUrl`: chỉ nhận URL Storage của bucket ảnh nội bộ (kiểm tiền tố `NEXT_PUBLIC_SUPABASE_URL`),
  bỏ thông báo "link phải http".
- Thêm `GET ?q=` (hoặc dùng lại `api/purchase/items` GET nếu có) trả ứng viên gần giống trước khi tạo.

### C. Modal "Thêm vật tư mua ngoài / gia công" ở biên bản — `maintenance/records/[id]/page.tsx`
- Loại: [Mua ngoài (nhập kho)] / [Gia công ngoài (dịch vụ)].
- Ô Tên: gõ tới đâu hiện **vật tư gần giống** (`similar-name.ts`, ngưỡng 0,8, như form Đề nghị mua)
  kèm nút "Dùng mã này"; trùng tuyệt đối → chặn ngay ở client (server vẫn chặn 409).
- Chọn mã có sẵn hoặc vừa gõ → hiện **lịch sử** rút gọn: tồn theo kho, lần mua gần nhất (giá, ngày),
  qua `GET /api/purchase/item-insight` (tái dùng; tách `InsightPanel` khỏi `purchase-form.tsx` thành
  component dùng chung nếu cần — hiện panel đầy đủ đã có ở `purchase-insight-panel.tsx`).
- Kho mặc định (chỉ Mua ngoài): `<select>` danh sách kho, mặc định KT.
- Hình ảnh: `PurchaseImagePicker variant="inline" max={1}` (documentType mới `"inventory-items"` hoặc
  dùng `"purchase-requests"`), bỏ ô link.
- Dropdown chọn vật tư của dòng: nguồn `gia_cong` chỉ liệt kê item `la_dich_vu`; `trong_kho`/`ben_ngoai`
  ẩn item `la_dich_vu`. Thêm `gia_cong` vào select Nguồn (nhãn "Gia công ngoài").

### D. Cài đặt → Bảo trì → Vật tư mua ngoài — `settings/page.tsx`
- Cùng modal (Loại, Kho mặc định, ảnh upload, gợi ý gần giống). Danh sách lọc
  `nguon_tao IN ('bao_tri_mua_ngoai','bao_tri_gia_cong')` + cột Loại. Ghi chú: mã mua ngoài tạo từ
  nguồn khác (`de_nghi_mua`, nhập kho thường) không hiện ở tab này — có chủ đích, hoặc mở rộng lọc
  theo `default_warehouse_ids` chứa KT (hỏi lại nếu cần).

### E. Chọn kho nhập + giữ hàng theo kho — luồng KT tổng quát hoá
- `receive/route.ts`: bỏ ép KT; mặc định KT ở UI (`purchase-fulfillment.tsx` mở khoá ô kho, chọn sẵn KT),
  server chỉ kiểm kho thuộc nhà máy.
- `src/lib/maintenance-kt.ts` → tính theo **(kho, vật tư)**: kho của vật tư mua ngoài của biên bản =
  kho của `purchase_receipts` gần nhất thuộc phiếu đề nghị liên kết biên bản đó; chưa nhận hàng →
  kho mặc định của item (primary rule) → KT. Khả dụng = tồn kho đó − nhu cầu các biên bản tạo trước
  dùng cùng (kho, vật tư). Giữ tên hàm/kiểu trả về (thêm `warehouseId/Code` vào từng nhu cầu) để
  `KtShortageBanner`, `create-request` 409, `purchase-draft` không phải đổi nhiều; đổi nhãn "Kho tạm KT"
  thành "Kho {code}".
- `maintenance-stock-issuance.ts`: `ben_ngoai` xuất từ kho tính được như trên (cùng hàm helper), mã
  phiếu `X-BT-{ma_bb}-{KHO}` như cơ chế nhóm theo kho hiện có. `gia_cong` bị bỏ qua (không xuất kho).
- Rủi ro: hàng nhập kho thường (không phải KT) không được "giữ" — người khác có thể xuất mất trước khi
  ký biên bản. Chấp nhận, hiển thị cảnh báo khi khả dụng < cần.

### F. Gia công ngoài trong luồng biên bản ↔ đề nghị mua
- `computeKtStatuses` bỏ qua dòng `gia_cong` (không thiếu kho, không khoá "Gửi ký duyệt").
- "Lập đề nghị mua" (`purchase-draft/route.ts`): thêm dòng `gia_cong` chưa có đề nghị (SL = SL biên bản
  − SL đang đề nghị cho cùng item+biên bản), cùng phiếu với vật tư mua ngoài thiếu.
- Trang chi tiết đề nghị (`purchase-fulfillment.tsx`): dòng dịch vụ hiện nút **"Xác nhận hoàn thành"**
  (thay "Ghi nhận mua"): SL, đơn giá thực tế (cảnh báo lệch >10% như nhập kho), ngày, ảnh nghiệm thu, ghi chú
  → route mới `POST /api/purchase/requests/[id]/complete-service` (người đề nghị/admin, ghi
  `purchase_service_completions` + `purchase_recompute_request`). Đủ mọi dòng → `hoan_tat`.
- Ký biên bản KHÔNG chờ dịch vụ hoàn thành (thợ lắp ngay) — chỉ ghi chi phí vào biên bản.
- PDF đề nghị mua / biên bản (F06 vật tư): dòng gia công in như vật tư, cột Nguồn/ghi chú "Gia công ngoài".
- Thống kê chi phí (F07, `print/page.tsx`): giữ nguyên tính theo `chi_phi_dk + cong_tho`; nếu có cột
  vật tư thì cộng `gia_cong` như `ben_ngoai`.

### G. Ẩn dịch vụ khỏi kho
- `inventory/_components/inventory-data.ts` (nguồn danh mục cho Nhập/Xuất/Chuyển/Tồn/Thẻ kho) lọc
  `la_dich_vu = false`; `inventory/receipts/page.tsx` quick-add không tạo dịch vụ.
- `ItemPicker` Đề nghị mua trực tiếp: hiện cả dịch vụ, gắn nhãn "Dịch vụ"; `InsightPanel` với dịch vụ
  chỉ hiện "lần gia công gần nhất", ẩn tồn/tiêu hao.

### H. Tài liệu
- Cập nhật `.claude/rules/14-maintenance-module.md` (3 nguồn: trong_kho / ben_ngoai / gia_cong; kho nhập
  chọn được), `.claude/rules/28-purchase-module.md` (dòng dịch vụ, xác nhận hoàn thành),
  `.claude/rules/13-inventory-module.md` (`la_dich_vu` không tồn kho).

## Thứ tự làm (mỗi bước dừng cho người dùng test)
1. B + C + D phần **ảnh upload** và **gợi ý gần giống / lịch sử** (không migration) — rủi ro thấp.
2. A + E: chọn kho + tổng quát hoá KT (đụng luồng đang chạy production — test kỹ biên bản cũ).
3. A (phần dịch vụ) + F + G: Gia công ngoài.

## Verification
- `npx tsc --noEmit` + `npx eslint <file đã sửa>` (không `npm run build`).
- Test tay:
  1. Tạo mã mua ngoài ở biên bản: gõ tên gần giống mã có sẵn → hiện gợi ý, bấm "Dùng mã này" gán đúng;
     chụp ảnh trên điện thoại → `image_url` là URL Storage; kho mặc định đổi sang kho khác lưu đúng rule.
  2. Đề nghị mua từ biên bản → Ghi nhận mua chọn kho khác KT → biên bản hết báo thiếu, ký xong phiếu xuất
     `X-BT-…-{KHO}` trừ đúng kho đó. Biên bản cũ đã nhập KT vẫn chạy y như trước.
  3. Biên bản có dòng Gia công ngoài: gửi ký không bị khoá; Lập đề nghị mua có dòng dịch vụ; Xác nhận
     hoàn thành → phiếu `hoan_tat`; dịch vụ không xuất hiện ở Tồn kho/Nhập kho; gọi RPC nhập kho với dịch
     vụ bị chặn.
  4. Đề nghị mua trực tiếp vẫn tạo/nhập kho vật tư thường như cũ.
