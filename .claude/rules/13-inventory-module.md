---
description: Quy tắc nghiệp vụ, UI, schema và kiến trúc đã triển khai cho module quản lý kho vật tư hóa chất
---

# Inventory Module Rules

## Phạm vi

Module kho vật tư / hóa chất là module riêng, không dùng chung với `storage` hiện tại vì `storage` đang quản lý ngăn lưu nguyên liệu.

Module này có route riêng trong `dashboard` và có khu vực thống kê riêng.

## Quy ước kho đã chốt

- `KA` = `Kho vật tư`
- `KB` = `Kho hóa chất`
- Hóa chất là nhóm ưu tiên quản lý `số lô` và `hạn sử dụng`
- Một vật tư có thể thuộc nhiều kho; dữ liệu kho chứa phải được chuẩn hóa theo danh sách kho chuẩn

## Kiến trúc đã triển khai (2026-05)

### Cây thư mục chính

```text
src/app/dashboard/inventory/
  page.tsx
  on-hand/page.tsx
  receipts/page.tsx
  issues/page.tsx
  transfers/page.tsx
  cards/page.tsx
  analytics/page.tsx
  print-report/page.tsx
  _components/
    inventory-ui.tsx
```

### Shared UI

- `src/app/dashboard/inventory/_components/inventory-ui.tsx` là nơi gom các component dùng chung cho module kho.
- Component dùng chung hiện tại:
  - `MultiSelectField`: dropdown chọn nhiều cho các trường enumlist, có ô tìm kiếm nhanh ngay trong menu
  - `CompactItemSelectorCard`: thẻ vật tư thu gọn có tick ở góc phải trên
  - `AddItemButton`: nút thêm nhanh danh mục hoặc vật tư
- Dropdown của `MultiSelectField` phải có `z-index` đủ cao để không bị chìm sau bảng dữ liệu, card sticky hoặc vùng scroll khác.
- Trường `Mã vật tư` ở các tab nghiệp vụ và thống kê phải ưu tiên dùng `MultiSelectField` để người dùng tìm nhanh theo mã hoặc tên vật tư.

## Rule dữ liệu

- Tất cả bảng của module kho phải có `factory_id`
- Các bảng dùng tiền tố `inventory_`
- `item_code` là duy nhất trong từng nhà máy
- `warehouse_code` là duy nhất trong từng nhà máy
- Nếu vật tư bật `manages_lot = true` thì phiếu nhập / xuất / chuyển phải lưu `lot_no`
- Dữ liệu thêm nhanh phải ghi vào master table tương ứng, không chỉ giữ ở state UI

## Rule tồn kho

- Không cho phép xuất kho nếu `số xuất > tồn hiện tại`
- Không cho phép xuất lô nếu `số xuất > tồn lô hiện tại`
- Cảnh báo tồn kho theo giới hạn dưới và giới hạn trên
- Cảnh báo tồn kho phải hỗ trợ theo từng kho và từng vật tư
- Cảnh báo hết hạn / sắp hết hạn trước 30 ngày, ưu tiên cho hóa chất
- Số tồn hiển thị trong màn chọn vật tư phải lấy từ `inventory_stock_balances`, không dùng fallback `opening_stock` để thay thế tồn thực tế

## Rule chứng từ

- Mã phiếu:
  - `N-MAKHO-DDMMYY/XXX` cho Nhập kho
  - `X-MAKHO-DDMMYY/XXX` cho Xuất kho
  - `C-MAKHO-DDMMYY/XXX` cho Chuyển kho
- QR in-app (`documentQrPath`) ưu tiên dùng `?documentId=<uuid>` để tránh lỗi encode ký tự `/` trong mã phiếu
- Print page phải hỗ trợ cả `documentId` lẫn `code` để tương thích dữ liệu cũ

## Rule hủy phiếu

- Chỉ phiếu `posted` mới được hủy
- Chỉ user có quyền `inventory.cancel` mới thấy nút `Hủy phiếu`
- Bắt buộc nhập lý do hủy (`cancel_reason`)
- `inventory_cancel_document` phải đảo ngược toàn bộ stock movements và set `status = 'cancelled'`
- Sau hủy: badge đỏ `Đã hủy`, mọi nút action chuyển sang disabled

## Rule print page (`print-report/page.tsx`)

- Màn in dùng chung cho `Tồn kho` và `Thẻ kho`
- Query params cần hỗ trợ:
  - `warehouses`
  - `categories`
  - `items`
  - `types`
  - `from`
  - `to`
  - `search`
- Báo cáo tồn kho và dữ liệu in phải nhóm, sắp xếp theo:
  - `Kho`
  - `Phân loại`
  - `Mã vật tư`

## Rule nhãn dòng chi tiết

- Nhãn `Dòng N` được thay bằng nhãn theo loại trong form Nhập / Xuất / Chuyển
- Ưu tiên dùng `category_name` trực tiếp làm tiền tố, không hardcode nhóm nghiệp vụ khi dữ liệu đã có sẵn trong danh mục

## Rule modal hủy phiếu

- Modal hủy phiếu render ngoài `InventoryPageShell`
- Không để modal bị cắt bởi overflow của shell hoặc panel cha

## Rule chọn vật tư, số lô và hạn sử dụng

- Với `Xuất kho` và `Chuyển kho`, phải chọn kho trước
- Danh sách vật tư phải lọc theo kho đã chọn, dựa vào `default_warehouse_ids` của vật tư
- Người dùng có thể lọc thêm theo `Phân loại vật tư`
- Người dùng có thể chọn nhiều vật tư cùng lúc ở phần header
- Sau khi chọn vật tư, hệ thống tự sinh hoặc đồng bộ các dòng chi tiết tương ứng bên dưới

## Rule kiến trúc module

- Module kho đi theo route riêng `/dashboard/inventory`
- Có 2 nhóm lớn:
  - `Nhập xuất tồn`
  - `Thống kê`
- `Nhập`, `Xuất`, `Chuyển`, `Tồn`, `Thẻ kho` là tab con của `Nhập xuất tồn`
- Không đưa `Cài đặt` vào điều hướng chính của module kho
- Danh mục kho, vật tư, định mức phải nằm trong `/dashboard/settings`

## Rule UI / UX

- Giao diện bám sát pattern UI hiện có của hệ thống
- Toàn bộ nội dung hiển thị bằng tiếng Việt có dấu
- Mọi section nên dùng component reveal hiện có của shell thay vì tự dựng animation rời rạc
- Grid KPI cards có thể dùng `.stagger-cards` để tạo hiệu ứng xuất hiện lần lượt
- Với các màn `Nhập / Xuất / Chuyển`:
  - Cụm nút hành động nằm trong document info header, cạnh QR
  - Trạng thái draft hoặc mới hiển thị `Lưu nháp` hoặc `Sửa phiếu` và `Ghi sổ`
  - Trạng thái `posted` hoặc `cancelled` ẩn hai nút lưu và ghi sổ
  - Không được ẩn nút chỉ vì form chưa hợp lệ; phải dùng `disabled`
  - Nút `Hủy phiếu` chỉ hiện khi phiếu đang `posted` và user có `inventory.cancel`
  - Không hiển thị trường `Người thực hiện`
  - Mỗi dòng chi tiết theo layout: tên vật tư + số lượng, số lô + hạn sử dụng, ảnh và ghi chú
  - `InventoryImageUpload` tự render label qua prop `label`, không bọc thêm label bên ngoài

## Rule thống kê (`analytics/page.tsx`)

- Có KPI cards, bộ lọc, bảng cảnh báo, biểu đồ, top vật tư và xuất XLSX
- Section `Giao dịch gần đây` hỗ trợ toggle 7/30 ngày
- Load dữ liệu giao dịch phải phụ thuộc `factoryId` và số ngày lọc
- Join `inventory_documents` để lấy `document_code` và `requester_name`
- Cảnh báo bất thường dùng công thức `stockBefore = balance_after + quantity_out`
- Nếu `quantity_out / stockBefore * 100 > threshold` thì hiển thị cảnh báo %
- Section cấu hình ngưỡng chỉ dành cho user có `inventory.settings`

## Rule định mức

- File tham chiếu: `cung_cap_dl/kho_bao_tri/dinh_muc.xlsx`
- Định mức phải lưu theo từng nhà máy
- Báo cáo tháng:
  - `định mức kế hoạch = thành phẩm trong kỳ * định mức`
  - `chênh lệch = thực tế - kế hoạch`

## Rule backend

- Backend là lớp chốt cuối cho các rule tồn kho
- Nếu UI có cảnh báo nhưng backend không chặn thì xem như chưa đạt
- Trigger hoặc function backend được phép dùng để chặn phát sinh xuất vượt tồn
- Trong các stored procedures như `inventory_post_export_document`, `inventory_post_import_document`, `inventory_post_transfer_document`, các cột `document_id` trong câu `JOIN` phải dùng table alias rõ ràng để tránh lỗi `column reference "document_id" is ambiguous`

## Rule riêng cho dầu dùng chung bồn

- Chỉ áp dụng cho các `mã Dầu` được bật cờ `uses_shared_oil_stock = true`
- Nhớt và vật tư khác vẫn giữ logic tồn riêng theo `warehouse_id + item_id`
- Với mã Dầu dùng chung bồn:
  - chứng từ vẫn bắt buộc chọn `mã vật tư`
  - nhập mã nào thì cộng vào tồn chung của kho dầu đó
  - xuất mã nào thì kiểm tra và trừ vào tồn chung của kho dầu đó
  - thẻ mã vật tư, cảnh báo dưới trường số lượng, tồn kho và số dư sau giao dịch phải hiển thị theo tồn chung của bồn
- Một mã Dầu dùng chung bồn có thể gắn nhiều kho; tại mỗi kho hệ thống dùng pool tồn riêng của chính kho đó
- Các kho dầu chỉ có `1 mã Dầu` vẫn dùng cùng logic này để thống nhất vận hành và mở rộng sau này

### Bật/tắt cờ trên giao diện (2026-11-02, chờ test tay)
- Bồn = 1 dòng `inventory_oil_stock_pools` theo **kho**; "gắn mã vào bồn" = bật `uses_shared_oil_stock` + chọn kho bồn
  trong `default_warehouse_ids`. Không có bảng gắn riêng.
- Cài đặt → Cấu hình nhà máy → Vật tư/Hóa chất (`settings/page.tsx`): ô "Dùng chung bồn dầu" (hiện tồn bồn + các mã
  dùng chung theo từng kho đã chọn), nhãn "Bồn dầu" ở danh sách. Trước đây form này KHÔNG có ô ⇒ mã dầu mới (vd DOVS,
  30/10) luôn tạo với cờ tắt ⇒ tồn = 0.
- Đổi cờ khi mã đã có `inventory_stock_movements` bị chặn ở form + trigger `trg_inventory_items_guard_shared_oil_flag`
  (migration `20261105_inventory_shared_oil_flag_guard.sql`, **chạy tay**, lỗi chứa `INV_SHARED_OIL_LOCKED`).
- (2026-11-09, chờ test tay) Ô chỉ bật được khi nhóm là nhiên liệu / dầu — `isFuelCategory` (`src/lib/inventory-fuel.ts`:
  mã nhóm `NL…` hoặc tên chứa "nhiên liệu"/"dầu", "đầu" không khớp). Đổi sang nhóm khác ⇒ tự bỏ tick (trừ mã đã có phát
  sinh — giữ khoá); Lưu chặn bật mới ở nhóm khác (mã cũ đã bật thì giữ). DB thật: chỉ NLCB khớp, 13/13 mã bồn đều ở NLCB.
- Đổi MÃ vật tư khi sửa (2026-11-09, chờ test tay): chỉ admin / `settings.manage_config`, chặn trùng mã, hỏi xác nhận. Liên
  kết theo `id` nên chứng từ cũ không gãy; đề nghị mua hiện mã hiện hành (rule 28).
- Nhập Excel vật tư KHÔNG có cột cờ: `upsert` không gửi cột ⇒ mã cũ giữ nguyên cờ, mã mới = tắt.
- Nhập Excel vật tư cũng không có cột Vị trí kho: trước khi xoá/tạo lại `inventory_item_warehouse_rules`, đọc
  `location_code` cũ theo kho và chép lại (trước đây bị xoá trắng mỗi lần import). Kho mới thêm ⇒ trống.

### Mapping đã chốt (2026-05-11)

- `KDDX`: `DOX`, `DOSXN`, `DON`, `DOXU12`, `DOFORD`, `DOFAT`, `DOCZNB`, `DOCZVC`, `DOXU3`
- `KDMN`: `DOSXMN`
- `KDMT`: `DOX`, `DOSXN`, `DON`, `DOXU12`, `DOFORD`, `DOFAT`, `DOCZNB`, `DOCZVC`, `DOXU3`, `DOSXT`, `DO750K`
- `KDMFL`: `DO750K`
- `KBO`: `DOXU3`

### Ghi chú vận hành

- `DO750K` trong database đang dùng kho `KDMFL` làm mã kho đúng; không dùng `KDMPL`
- Khi seed dữ liệu cho các mã trên, phải bật `uses_shared_oil_stock = true`
- Khi hiển thị trên UI, các mã Dầu cùng một kho phải cùng nhìn một số tồn chung của kho đó
- Lịch sử phát sinh, chứng từ nhập, chứng từ xuất và báo cáo sử dụng vẫn phải giữ theo đúng `mã vật tư` người dùng đã chọn

## Update 2026-05-09

### Chọn nhiều cho Phân loại vật tư và Mã vật tư

- Mọi màn có trường `Phân loại vật tư` và `Mã vật tư` phải hỗ trợ chọn nhiều (`enumlist`), không quay lại `select` đơn
- Các màn đang áp dụng:
  - `receipts/page.tsx`
  - `issues/page.tsx`
  - `transfers/page.tsx`
  - `on-hand/page.tsx`
  - `cards/page.tsx`
- Tập thẻ vật tư phía dưới phải hiển thị theo đúng bộ lọc hiện tại theo thứ tự:
  - `Phân loại vật tư`
  - `Mã vật tư`
- Nếu người dùng đã chọn `Mã vật tư` trên field thì thẻ tương ứng phải tick sẵn
- Khi người dùng tick hoặc bỏ tick trực tiếp trên thẻ, field `Mã vật tư` phải cập nhật ngay hai chiều
- Tương tác tick của thẻ phải dùng callback `onToggle`

### Quy cách thẻ vật tư dùng chung

- Thẻ item categories trong `Nhập / Xuất / Chuyển` phải thu gọn đồng đều
- Kích thước card khoảng 50% card cũ
- Bố cục thống nhất 3 dòng:
  - `Mã vật tư`
  - `Tên vật tư`
  - `Tồn`
- Tick chọn vẫn nằm ở góc phải trên
- Dòng tồn hiển thị dạng như `Tồn: 315 kg | KA: 300 | KB: 15`

### Nhập kho

- Có nút `Thêm mới` cho cả:
  - `Phân loại vật tư`
  - `Mã vật tư`
- Nút `Thêm mới` phải nằm cùng hàng với field tương ứng, canh phải như thiết kế tham chiếu
- Tạo nhanh `Phân loại vật tư` phải mở modal form và ghi trực tiếp vào bảng `inventory_item_categories`
- Tạo nhanh `Mã vật tư` phải mở modal form và ghi trực tiếp vào bảng `inventory_items`
- Khi tạo nhanh `Mã vật tư`, bắt buộc:
  - đã chọn kho nhập
  - đã chọn đúng 1 phân loại vật tư
  - lưu `default_warehouse_ids` theo kho đang chọn
- Sau khi tạo nhanh `Mã vật tư`, cần tạo luôn rule kho mặc định trong `inventory_item_warehouse_rules` theo kho nhập đang chọn
- `Nguồn nhập` là dữ liệu lưu tạm để gợi ý cho các lần sau, lấy từ lịch sử chứng từ nhập

### Xuất kho

- Có thêm trường `Mã vật tư` ở phần header
- Danh sách `Mã vật tư` phải lọc thông minh theo `Kho` và `Phân loại`
- Không có nút thêm mới `Phân loại vật tư` hoặc `Mã vật tư`
- Dropdown không được bị chìm sau bảng `Bảng tồn hiện tại`

### Chuyển kho

- Header dòng 2 có thêm trường `Mã vật tư`
- Bố cục dòng 2 phải canh lề phải hài hòa với dòng 1
- Không có nút thêm mới `Phân loại vật tư` hoặc `Mã vật tư`
- Dropdown không được bị chìm sau bảng hoặc khối dữ liệu phía dưới

### Tồn kho

- Ô `Tìm vật tư hoặc số lô` phải có danh sách gợi ý theo dữ liệu còn lại sau khi lọc `Kho` và `Phân loại`
- Các trường `Kho`, `Phân loại`, `Mã vật tư` đều hỗ trợ chọn nhiều
- Tất cả dropdown trong vùng bộ lọc phải nổi trên `Bảng tồn hiện tại`, không bị che bởi section bảng
- Dữ liệu hiển thị và dữ liệu in phải dùng cùng một logic lọc
- Báo cáo và file in phải sắp xếp theo `Kho -> Phân loại -> Mã vật tư`

### Thẻ kho

- Bổ sung bộ lọc:
  - `Từ ngày`
  - `Đến ngày`
  - `Loại phiếu` gồm `Nhập`, `Xuất`, `Chuyển`
- Các trường `Kho`, `Phân loại`, `Mã vật tư` đều hỗ trợ chọn nhiều giống `Tồn kho`
- Trường `Phân loại vật tư` trong dropdown chỉ hiển thị tên phân loại, không hiển thị UUID / id bên dưới
- Trường `Mã vật tư` trong dropdown phải có ô tìm kiếm nhanh
- Dropdown không được bị chìm sau bảng `Lịch sử phát sinh`
- Logic hiển thị và in phiếu phải dùng chung bộ lọc nhiều lựa chọn như `Tồn kho`
- Có nút `Xuất Excel` cạnh nút in phiếu
- File Excel phải bám mẫu `mau_the_kho.png`:
  - phần đầu có tên công ty, nhà máy, loại báo cáo
  - phần tham số có `Từ ngày`, `Đến ngày`, `Phân loại vật tư`, `Người báo cáo`, `Lúc`
  - phần trái là bảng chi tiết
  - phần phải là bảng `Tổng hợp`
- Bảng chi tiết của file Excel phải có các cột:
  - `Ngày`
  - `Mã vật tư`
  - `Tên vật tư`
  - `Đơn vị tính`
  - `Số lượng`
  - `Ghi chú`
- Bảng `Tổng hợp` của file Excel phải có các cột:
  - `Mã vật tư`
  - `Tên vật tư`
  - `Đơn vị tính`
  - `Tổng số lượng`

## Cập nhật 2026-08-10 — Tách "Tra cứu" khỏi "Thẻ kho" thật + Thẻ kho điện tử + Vị trí kho

Đã triển khai đúng kế hoạch (plan `k-ho-ch-m-i-tranquil-tarjan.md`): tab "Thẻ kho" cũ (lọc lịch sử
phát sinh + xuất Excel + in báo cáo, giữ nguyên 100% logic) đổi tên thành **"Tra cứu"**
(`cards/page.tsx` → `lookup/page.tsx`, route `/dashboard/inventory/lookup`). Route
`/dashboard/inventory/cards` được giải phóng cho tab **"Thẻ kho" mới** — in nhãn QR vật lý dán tại
vị trí lưu vật tư (`cards/page.tsx` mới + `src/lib/inventory-card-pdf.ts`, layout QR trái + khối
text nhiều dòng bên phải, khác layout QR-trên-text-dưới của `downloadStorageBulkQrPdf`). Vật tư Dầu
dùng chung bồn (`uses_shared_oil_stock`) gộp **1 nhãn/kho** (không phải 1 nhãn/mã), QR trỏ
`?warehouseId=` không kèm `code`.

- **Vị trí kho**: cột mới `inventory_item_warehouse_rules.location_code` (migration
  `20260810_inventory_item_warehouse_location.sql`, **cần chạy thủ công**). `InventoryWarehouseRule`
  (`inventory-data.ts`) thêm field này.
- **Phát hiện quan trọng khi code**: `/dashboard/inventory/settings/page.tsx` (nơi ban đầu định thêm
  UI Vị trí kho) **không được link từ bất kỳ đâu trong app** — đã grep xác nhận 0 kết quả. Trang admin
  vật tư/kho **thật sự đang dùng** là tab "Vật tư / Hóa chất" trong `Cấu hình nhà máy` của
  `src/app/dashboard/settings/page.tsx` (đúng theo rule kiến trúc "Danh mục kho, vật tư... phải nằm
  trong `/dashboard/settings`" ở đầu file này) — `InvItemForm`/`saveItem`-tương-đương ở đó có
  `rulesPayload` riêng, tách biệt hoàn toàn khỏi `inventory/settings/page.tsx`. Đã thêm UI "Vị trí kho
  theo từng kho" (input text theo từng kho đã tick, dưới khối "Kho chứa *") ở **cả 2 nơi** — giữ
  `inventory/settings/page.tsx` đồng bộ dù hiện chưa reachable, và bổ sung ở `dashboard/settings/page.tsx`
  vì đó là nơi admin thực sự dùng. Khi sửa tiếp tính năng liên quan `inventory_item_warehouse_rules`
  trong tương lai, **luôn kiểm tra cả 2 file** (grep `inventory_item_warehouse_rules`) — 2 implementation
  song song, không dùng chung state/hàm.
- **Thẻ kho điện tử** (`item/page.tsx`) redesign: đọc thêm `?warehouseId=` (ưu tiên đúng rule khớp
  kho đó cho Vị trí kho, fallback `is_primary` rồi rule đầu tiên); badge "TRỰC TUYẾN (REAL-TIME)";
  4 nút thao tác nhanh (Xuất/Nhập/Chuyển kho chỉ điều hướng, không prefill dòng vật tư; "Tiếp tục quét
  QR" tái dùng `QrScanner` từ `src/app/dashboard/product/confirm/qr-scanner.tsx` qua
  `next/dynamic({ssr:false})`); **chế độ Bồn dầu chung** khi có `warehouseId` mà không có `code` — tồn
  lấy qua `stockBalances` đã build sẵn bởi `buildEffectiveStockBalances` (mọi mã dùng chung 1 bồn có
  cùng `on_hand`, không cần query riêng `inventory_oil_stock_pools`), liệt kê các mã dùng chung, lịch
  sử giao dịch gộp theo `warehouseId` + tập item id dùng chung.
- `lookup/page.tsx`: link cột "Mã vật tư" trong bảng lịch sử phát sinh nay kèm thêm
  `&warehouseId=${movement.warehouse.id}` để Thẻ kho điện tử hiện đúng Vị trí kho ngay, không cần đoán.
- `analytics/page.tsx` ("Thống kê"): bảng "Giao dịch gần đây" rút gọn còn 8 dòng preview (giữ nguyên
  toggle 7/30 ngày + cảnh báo bất thường ⚠️ — tính năng riêng của Thống kê, không xóa), thêm link
  "Xem đầy đủ tại Tra cứu →" trỏ `/dashboard/inventory/lookup`. **Không** hydrate filter qua URL —
  `lookup/page.tsx` chưa đọc query param cho bộ lọc, nằm ngoài phạm vi đợt này.
- `npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch (đã fix thêm 2 call site khác trong repo
  từng tạo object literal khớp `InventoryWarehouseRule` mà thiếu `location_code`:
  `receipts/page.tsx`'s quick-add vật tư, và `dashboard/settings/page.tsx`'s `rulesPayload`).
- **Chưa test tay** — cần: chạy migration trên Supabase SQL Editor trước; ở `dashboard/settings/page.tsx`
  sửa 1 vật tư có ≥2 kho, nhập Vị trí kho khác nhau từng kho, lưu, mở lại xác nhận không lẫn; tab
  "Thẻ kho" mới chọn vài vật tư + xác nhận card bồn dầu gộp đúng theo mapping ở mục "Đầu dùng chung
  bồn" phía trên, in PDF đối chiếu layout; quét QR vật tư thường và QR bồn dầu bằng điện thoại (chưa
  đăng nhập → bị đá `/login` → đăng nhập xong vào đúng trang, đúng Vị trí kho theo đúng kho đã in);
  bấm đủ 4 nút thao tác nhanh, đặc biệt "Tiếp tục quét QR" mở camera đúng; xác nhận tab "Tra cứu"
  hoạt động y hệt "Thẻ kho" cũ; xác nhận "Thống kê" bảng giao dịch gần đây gọn lại và link hoạt động.

## Cập nhật 2026-10-03 — Sắp xếp lại tab + danh sách phiếu + kiểu action thống nhất

**Cấu trúc tab mới** (`_components/inventory-shell.tsx`, `TAB_GROUPS`):

| Nhóm | Thẻ con | Route |
|---|---|---|
| Nhập xuất tồn | Nhập · Xuất · Chuyển · Tồn | receipts · issues · transfers · on-hand (+ cards là trang con của Tồn) |
| Báo cáo | Tổng quan · Sổ chi tiết | analytics · lookup |

- `/dashboard/inventory` chuyển hướng về `receipts`. Không đổi route nào — QR/link cũ `?documentId=`/`?code=` vẫn chạy.
- `action` của `InventoryPageShell` nay nằm cùng hàng thẻ con (bên phải), không còn ở trên.

**Nhập / Xuất / Chuyển có DANH SÁCH phiếu** (`_components/inventory-document-list.tsx`):
- Trang `receipts|issues|transfers/page.tsx` là wrapper: có `documentId`/`code`/`mode=new` → mở form cũ; ngược lại → danh sách. Form cũ giữ nguyên logic (đổi tên thành `Inventory…PageForm`).
- Bộ lọc: Từ ngày/Đến ngày (mặc định đầu tháng → hôm nay theo múi giờ nhà máy), Kho (Chuyển: khớp kho đi HOẶC kho đến), Phân loại → Mã vật tư, Trạng thái, Phê duyệt (chỉ Nhập/Xuất).
- Thao tác trên dòng: Xem, In, **Duyệt** (Nhập/Xuất, phiếu đã ghi sổ chưa duyệt, theo `resolveCanApproveInventory`), **Hủy phiếu** (`inventory.cancel`, qua RPC `inventory_cancel_document`, bắt buộc lý do).
- Nút "Thêm" → `?mode=new`, gate `inventory.create`/`inventory.edit`/admin.

**Tồn**: nút "In nhãn QR" (mở `cards?warehouses=&items=` — trang Thẻ kho tự chọn sẵn nhãn khớp bộ lọc, chỉ áp 1 lần) + "In tồn kho". Thẻ kho có nút quay lại "Tồn kho".

**Báo cáo**: `analytics` đổi tên hiển thị "Tổng quan kho", `lookup` thành "Sổ chi tiết" (xuất Excel / in thẻ kho theo bộ lọc). Nút "Duyệt" ở Sổ chi tiết vẫn giữ (trùng với danh sách Nhập/Xuất, vô hại).

**Kiểu nút (cập nhật 2026-11-03, thay quy ước viên thuốc nhiều màu)** — mọi nút của module kho dùng `HeaderButton` (`_components/doc-ui/detail-page-header.tsx`): trắng viền xám; mỗi cụm tối đa MỘT nút `tone="brand"` (hành động chính: Ghi sổ / Duyệt / Xuất Excel / In nhãn / Thêm phiếu); `tone="danger"` cho Hủy phiếu; link dùng `href` (render `<a>`). `InventoryActionButton`/`InventoryActionLink` trong `inventory-ui.tsx` không còn call site nào (giữ lại, chưa xoá) — code mới không dùng.

Chưa làm: chuyển cấu hình ngưỡng cảnh báo sang Cài đặt; dùng chung bộ lọc giữa 2 thẻ Báo cáo qua URL; `inventory/settings/page.tsx` ĐÃ XOÁ 2026-11-09 (người dùng xác nhận, không link nào trỏ tới) — chỉ còn `dashboard/settings/page.tsx`.

**Cụm nút cân đối (cập nhật 2026-11-03)** — mọi cụm nút đặt trong `InventoryActionBar` (hoặc class `INVENTORY_ACTION_BAR_CLASS`): mobile lưới 2 cột (số nút lẻ thì nút cuối trải 2 cột, chữ dài xuống dòng trong nút); từ `md` các nút xếp ngang canh phải, rộng theo chữ, thiếu chỗ thì tự xuống hàng. **Không bao giờ cắt chữ "…"** trên `InventoryActionButton`/`InventoryActionLink` (nút `sm` trong bảng giữ 1 dòng, bảng cuộn ngang). `InventoryPageShell` tự bọc `action` bằng cụm này. Vẫn nên giữ nhãn nút ngắn: "Lưu", "Ghi sổ", "Ghi sổ N kho", "In nhãn (N)".

## Chuẩn hoá danh sách phiếu theo rule 29 (2026-10-17, chờ test tay)
`_components/inventory-document-list.tsx` (dùng chung Nhập/Xuất/Chuyển):
- Nội dung bọc `moduleThemeClass("amber")`; chip đếm → `StatGrid cols={4}`: Tổng phiếu · Nháp · Đã ghi sổ ·
  ô 4 = "Chờ phê duyệt" (Nhập/Xuất, bấm để lọc `approvalStates=["pending"]`, warn khi >0) hoặc "Đã hủy" (Chuyển).
- Bảng `enterprise-table dense min-w-[900px]` trong `ResponsiveTableWrapper`, mỗi phiếu là `ExpandableRow`
  (xổ bảng con #/Mã/Tên/SL/ĐVT; phiếu không có dòng ⇒ không xổ) + `ExpandAllToggle`. Đang tải/lỗi/rỗng = `ListState`.
- Trạng thái `StatusBadge domain="inventory"` (`cho_duyet` = posted && !approved_at với Nhập/Xuất), phiếu đã duyệt
  thêm badge "Đã phê duyệt" (tooltip người duyệt). Bỏ `STATUS_BADGE` cũ.
- Thao tác cuối: Duyệt (`RowAction approve` chữ) → view `Eye` (mở form phiếu) → print → cancel. Điều kiện quyền,
  modal duyệt/hủy, `handleApprove`/`handleCancel` không đổi.
- Chưa làm: trang chi tiết 70/30 (con mắt vẫn mở form `?documentId=`), Quét QR ở ô tìm.

## Trang chi tiết phiếu 70/30 + QR (2026-10-18, chờ test tay)
- Route mới `/dashboard/inventory/document/[type]/[id]` (`type` = receipt|issue|transfer): `DetailPageHeader`
  (mã phiếu, ngày, kho, Tải PDF, `HeaderQr`) + `DetailSplitLayout`; trái "Bản PDF" (`DocViewer loadBytes` =
  `buildInventoryDocumentPdfBytes`) / "Nội dung" (bảng dòng vật tư); phải `StatusSummaryBar domain="inventory"`
  → `SignActionBox` (Duyệt / Hủy phiếu cùng điều kiện quyền + RPC như danh sách; "Mở form phiếu" `?documentId=`).
- PDF `src/lib/inventory-document-pdf.ts`: A5 ngang, QR góc phải trên trỏ đúng trang chi tiết.
- Danh sách: con mắt + mã phiếu mở trang chi tiết (`inventoryDocumentDetailHref`); ô tìm có **Quét QR** — nhận
  URL trang chi tiết mới và cả QR cũ `?documentId=` / `?code=` (đã in trên giấy) rồi chuyển sang trang chi tiết.
- Form `?documentId=` / `?mode=new` không đổi.

## Tab Tồn: ô tìm + Quét QR + Từ–Đến ngày + file kiểm tồn + Tồn pallet (2026-10-27, chờ test tay)
- Bộ lọc lưới 12 cột: Tìm vật tư/số lô (đứng đầu, có nút **Quét QR**) · Từ ngày · Đến ngày / Kho · Phân loại · Mã vật tư.
- Quét QR thẻ kho (`/dashboard/inventory/item?code=…&warehouseId=…`, QR bồn dầu chỉ `warehouseId`, hoặc mã trần):
  quét liên tục, mỗi mã hợp lệ cộng vào bộ lọc "Mã vật tư" (gỡ lọc Phân loại/Kho nếu đang loại vật tư đó),
  thanh trên máy quét liệt kê kết quả + nút Xong. `QrScanPortal` có thêm prop `scanKey`/`header`.
- Từ–Đến ngày ⇒ thêm cột Tồn đầu kỳ / Nhập / Xuất / Tồn cuối kỳ: tồn cuối = tồn hiện tại − ròng phát sinh sau
  ngày cuối; đầu kỳ = cuối − nhập + xuất. Nhập = import + transfer_in, xuất = export + transfer_out. Phát sinh tải
  phân trang từ ngày đầu kỳ. Dầu dùng chung bồn gộp theo bồn của kho.
- "Xuất file kiểm tồn" (Excel, xlsx): STT, Kho, Phân loại, Mã, Tên, ĐVT, [cột kỳ], Tồn sổ sách, Tồn thực tế (trống),
  Chênh lệch (công thức), Ghi chú — 1 sheet duy nhất.
- "In nhãn QR" / "In tồn kho" chỉ bấm được khi đã chọn ≥1 mã vật tư.
- **Tồn pallet nằm TRONG "Bảng tồn hiện tại"** (2026-10-27, bỏ khối riêng): `palletMode` chỉ bật khi đã chọn phân loại
  có vật tư pallet ("Pallet các loại") hoặc chọn mã pallet; chưa chọn ⇒ KHÔNG gọi `loadPalletFlow`, mã pallet hiện như
  vật tư thường. Khi bật: mã pallet gộp **1 dòng/nhóm** (`palletTableRows`, PM = MUBEZ + MCH), Kho = "Tổng mọi kho"
  + chi tiết theo kho, **bỏ qua lọc Kho**; thêm cột Đang lưu dưới kiện TP · Mất XK từ mốc · Tổng sở hữu · Tồn trống
  (+ Xuất lưu / Trả về / Mất do xuất khẩu khi có kỳ); dòng thường để "—". Bấm dòng nhóm = chọn/bỏ mọi mã của nhóm.
  Excel 1 sheet: dòng pallet có thêm cột trên, Chênh lệch = Thực tế − **Tồn trống** (dòng thường vẫn − sổ sách).
  Công thức: Sổ sách = on_hand mọi kho; Mốc = phiếu nhập đầu tiên của nhóm;
  Tổng sở hữu = Sổ sách − Mất do xuất khẩu từ mốc; **Trống = Tổng sở hữu − Đang lưu dưới kiện TP** (âm ⇒ đỏ "Cần kiểm
  kê"). Chỉ tính, không ghi phiếu kho. Server action
  `inventory/pallet-flow-actions.ts` (`inventory.view`). Quy đổi + mã vật tư ở `src/lib/pallet-usage.ts`:
  DPH, PM (= MUBEZ + MCH gộp sắt mỏng), ĐG, ĐN (người dùng tự tạo), PMB5, PMB4, PG. Hình thức xuất theo
  `export_pallet_types` (rule 08). Kiện rời kho khi tổng bành gán đơn ≥ bành SX; đơn hoàn tất kiện quyết định hình thức.
  Trang cũ `/dashboard/product/pallet` đã XOÁ; banner Thành phẩm không còn link (gỡ 2026-10-27).

## Ghi chú Excel Sổ chi tiết + in thẻ kho (2026-11-02, chờ test tay)
- Lỗi cũ: Sổ chi tiết đọc `line_notes` / thông tin phiếu bằng 1 `.in()` vài trăm id ⇒ Bad Request, không kiểm lỗi
  ⇒ Excel cột Ghi chú chỉ còn "Xuất kho"/"Nhập kho", trạng thái duyệt có thể sai.
- Helper `loadMovementDocumentInfo` (`inventory-data.ts`, chia lô 200, lỗi thì ném ⇒ banner đỏ) +
  `movementNoteText`: **ghi chú dòng → ghi chú phiếu → "<loại phiếu> <mã phiếu>"** (người dùng chốt). Dùng ở Excel
  Sổ chi tiết và bản in thẻ kho (`print-report?kind=cards`, thêm cột Số phiếu + Ghi chú).
- `loadInventoryMovementData` nay phân trang (`fetchAllPaginated`, ngày → giờ tạo → id).

## U10 — Thẻ kho / Sổ chi tiết / Tổng quan theo rule 29 (2026-10-28, test pass)
- `InventoryPageShell` bọc `moduleThemeClass("amber")` (mọi trang kho); 2 hàng tab (nhóm + thẻ con) →
  `SegmentedTabs` có `href` (`/cards` vẫn sáng thẻ "Tồn" nhờ `extraPrefixes`).
- Sổ chi tiết (`lookup`): `StatGrid`/`StatCard`; bộ lọc `FilterBar layout="grid"` (giữ `relative z-40` cho
  dropdown); bảng `enterprise-table dense min-w-[1100px]`, số căn phải; Loại giao dịch + Trạng thái qua
  `StatusBadge` (đã duyệt = tone info "Đã phê duyệt", như danh sách phiếu); thao tác `RowAction` approve (text) →
  view = **trang chi tiết phiếu** `inventoryDocumentDetailHref` (trước mở form `?documentId=`); `ListState`.
- Tổng quan (`analytics`): `StatGrid`; `FilterBar` grid; cảnh báo có badge mức; 7/30 ngày = `SegmentedTabs`;
  bảng giao dịch `enterprise-table dense`; lỗi tải giao dịch nay hiện `ListState` lỗi + "Thử lại" (trước bị nuốt
  thành "Không có giao dịch").
- Thẻ kho (`cards`): `ListState` cho tải/rỗng; lưới thẻ chọn nhãn giữ nguyên.
- Không đổi truy vấn, quyền, Excel/in, điều kiện nút.

## Sửa / mở / thoát phiếu Nhập – Xuất – Chuyển (2026-11-03, chờ test tay)
- Quyền (người dùng chốt) — helper dùng chung `_components/inventory-edit-access.ts`:
  tạo mới = admin hoặc `inventory.create`; sửa/Lưu/Ghi sổ phiếu NHÁP = **chỉ người lập (`created_by`) hoặc admin**
  (phiếu cũ không có `created_by` ⇒ chỉ admin). Loader `fetchInventoryDocumentByReference` trả thêm `created_by`.
- Phiếu đã ghi sổ / đã hủy KHÔNG mở form nữa: `?documentId=` / `?code=` tự `router.replace` sang trang chi tiết
  (QR/link cũ vẫn chạy). Trang chi tiết đã bỏ nút "Mở phiếu (form)", "Sửa phiếu nháp" chỉ hiện cho người được sửa.
- Form khoá chỉ xem (`<fieldset disabled>` + banner lý do) khi không đủ quyền / phiếu không tìm thấy / vừa ghi sổ.
- "Danh sách" → **"Quay lại"** (phiếu đã lưu ⇒ trang chi tiết, mới ⇒ danh sách; hỏi nếu còn thay đổi chưa lưu).
  "Làm mới" của phiếu đã lưu → **"Hoàn tác"** = nạp lại bản đã lưu (không còn xoá trắng). Sau Ghi sổ: "Chi tiết phiếu" + "Phiếu mới".
- Lỗi đã sửa: Ghi sổ phiếu nháp đã có nay LUÔN lưu trước (trước ghi sổ theo bản lưu cũ, mất sửa đổi); đổi kho/ngày
  giữ `documentId` (trước tạo phiếu trùng); update chỉ khi `status = draft` (0 dòng ⇒ báo lỗi), không ghi đè
  `created_by`/`requester_name`; Lưu nháp phiếu mới đưa `?documentId=` lên URL (ref `loadedDocIdRef` chặn nạp lại);
  effect đồng bộ dòng KHÔNG lọc theo bộ lọc Phân loại nữa (trước chọn phân loại là mất dòng đã nhập);
  ngày mặc định theo giờ nhà máy (`getFactoryTodayISO`); trang bọc `Suspense`.
- Chỉ chặn ở tầng app (RLS `inventory_documents` không đổi).
- Header form (2026-11-03, sau test): 3 form dùng `InventoryFormHeader` (`_components/inventory-form-header.tsx`, dựng trên
  `DetailPageHeader`): mũi tên quay lại + tiêu đề + mã + `StatusBadge domain="inventory"` + mốc ghi sổ/phê duyệt. Nút =
  `HeaderButton` chuẩn chung (trắng viền xám; MỘT nút chính `tone="brand"`: Ghi sổ khi nháp, Duyệt khi chờ duyệt;
  Hủy phiếu `tone="danger"` — thêm mới cho `HeaderButton`). KHÔNG dùng `InventoryActionButton` nhiều màu cho header form.
- Ghi sổ luôn qua hộp nổi `PostConfirmDialog` (`_components/post-confirm-dialog.tsx`, portal; desktop giữa màn hình, mobile tấm trượt từ đáy): nêu tồn kho sẽ cộng/trừ ở kho nào, sau ghi
  sổ không sửa/xoá được (chỉ Hủy phiếu), chờ phê duyệt (Nhập/Xuất), số cảnh báo còn lại. Enter = xác nhận, Esc = để sau.
  Xuất nhiều kho: banner nêu số phiếu sẽ tạo + mã các kho.


## Việc treo sau 2116fb9 (2026-11-03, chờ test tay)
- Xuất nhiều kho KHÔNG có "Lưu" — đúng thiết kế (1 phiếu = 1 kho; Ghi sổ mới tạo N phiếu chung `batch_id`; phiên chỉ giữ
  tạm `localStorage` máy đó). Form hiện banner vàng giải thích.
- Banner shell của form = tên thẻ ("Nhập kho" / "Xuất kho" / "Chuyển kho"), header form mới ghi "Phiếu … kho" + mã.
- Mã phiếu: `fetchNextInventoryDocSeq` (`_components/inventory-doc-code.ts`) = số LỚN NHẤT cùng tiền tố + 1, bỏ qua chính
  phiếu đang sửa (trước: đếm + 1 ⇒ đổi kho rồi đổi lại nhảy +1, dãy có lỗ thì trùng). Đổi kho/ngày về đúng bản đã lưu ⇒
  `savedCodeFor` trả lại mã gốc. Dùng ở 3 form + nhánh xuất nhiều kho.
- RLS `20261106_inventory_documents_rls.sql` (**chạy tay**): 3 bảng phiếu bỏ "Allow all", theo nhà máy + authenticated;
  phiếu NHÁP (và dòng/đính kèm của nó) chỉ người lập/admin sửa/xoá; phiếu đã ghi sổ vẫn duyệt/huỷ được. 11 bảng
  `inventory_*` còn lại vẫn "Allow all".

## Thẻ chọn vật tư sau test xuất nhiều kho (2026-11-04, chờ test tay)
- `CompactItemSelectorCard` gọn lại (cao tối thiểu 76px, chữ cắt 1 dòng), hover nổi + viền xanh, prop mới `warehouseText`
  = mã kho hiện góc phải dưới thẻ. Lưới 3 form: `grid-cols-2 sm:grid-cols-4 xl:grid-cols-6` (≈ ½ bề rộng cũ).
- **Thay quy tắc 2026-05-09**: thẻ KHÔNG còn lọc theo "Mã vật tư" đã chọn — luôn hiện đủ thẻ theo kho + phân loại,
  thẻ đã chọn chỉ được tick (trước: chọn 1 mã là ẩn hết thẻ khác, phải chọn tiếp ở dropdown).
- Xuất: `itemWarehouseCodes` = các kho ĐANG CHỌN có chứa vật tư (`default_warehouse_ids`), hiện trên thẻ; chọn ≥2 kho thì
  dropdown "Mã vật tư" ghi thêm "· Kho KA, KBHLD" (tìm được theo mã kho). Nhập / Chuyển hiện mã kho nhập / kho đi.

## RLS 13 bảng kho còn lại — GĐ A (2026-11-04, đã chạy + test)
- `20261107_inventory_rls_factory_scope.sql` (**đã chạy tay**): bỏ "Allow all" trên warehouses, item_categories, items,
  item_warehouse_rules, stock_balances, lot_balances, stock_movements, oil_stock_pools, alert_thresholds và 4 bảng `*norm*`;
  mỗi bảng 4 policy TO authenticated theo `current_profile_factory_id()`. Chặn: chưa đăng nhập + chéo nhà máy.
- RPC ghi sổ / huỷ vẫn SECURITY INVOKER (qua RLS vì factory_id đúng). Test bằng tài khoản thật 43/43 PASS: anon 0 dòng,
  đọc đủ số dòng, nhập / chuyển / xuất / huỷ / xuất vượt tồn, dầu bồn, thêm nhanh vật tư + rule, ngưỡng cảnh báo, admin.
- Mọi insert danh mục từ trình duyệt PHẢI gửi `factory_id` (không có thì bị RLS từ chối).

## RLS GĐ B — khoá ghi thẳng tồn / phát sinh (2026-11-04, đã chạy + test 63/63)
- `20261108_inventory_rls_stock_lock.sql` (**đã chạy tay**): `stock_balances`, `lot_balances`, `stock_movements`,
  `oil_stock_pools` chỉ còn policy SELECT ⇒ trình duyệt không ghi thẳng được nữa, chỉ qua 4 RPC.
- 4 hàm thật trên production đã được ĐỔI TÊN thành `inventory_post_import/export/transfer_document_core`,
  `inventory_cancel_document_core` (logic giữ nguyên, INVOKER, không role ứng dụng nào gọi trực tiếp được). Hàm cùng tên cũ
  giờ là VỎ `SECURITY DEFINER` (cùng chữ ký, cùng kiểu trả về — app không đổi): kiểm quyền rồi gọi `*_core`.
  ⚠️ Sửa logic ghi sổ/huỷ về sau ⇒ `CREATE OR REPLACE` hàm `*_core`, KHÔNG phải hàm vỏ.
- Kiểm trong vỏ (`inventory_assert_can_post`, `inventory_rpc_is_trusted_caller`): service role / kết nối DB trực tiếp ⇒ cho
  qua (Bảo trì ký biên bản, `purchase_receive`). Người dùng: đăng nhập; `p_factory_id` = nhà máy của mình;
  `p_posted_by`/`p_cancelled_by` = chính `auth.uid()` (khác ⇒ lỗi, không tự thay); phiếu đúng nhà máy + đúng loại.
  Ghi sổ: phiếu NHÁP của chính mình hoặc admin. Huỷ: admin | `inventory.cancel` | phiếu `X-BT-%` + `maintenance.approve`.
  Gọi khi chưa đăng nhập ⇒ `permission denied`.
- Ghi danh mục (items/warehouses/categories/rules/thresholds) vẫn mở theo nhà máy — chưa quyết khoá.
- Test: `node --env-file=.env.local scripts/test-inventory-rls.mjs` (khối 9 = GĐ B; tự dọn dòng tồn `on_hand = 0` do Chuyển kho tạo).

## Huỷ phiếu không được làm tồn âm + quyền "hủy phiếu" (2026-11-04, chờ chạy migration + test)
- Lỗi thật: nhập 10 → xuất 1 → admin huỷ phiếu nhập ⇒ tồn -1. `*_core` huỷ chỉ cộng/trừ ngược theo phát sinh rồi xoá
  phát sinh; trigger chống âm chỉ bắt INSERT phát sinh nên không chặn được.
- `20261109_inventory_cancel_negative_guard.sql` (**chạy tay**): hàm vỏ `inventory_cancel_document` gọi
  `inventory_assert_cancel_keeps_stock` TRƯỚC core — khoá dòng tồn liên quan, tính phần bị trừ cho tồn thường (kho + vật tư),
  bồn dầu (kho) và tồn lô; sau huỷ < 0 ⇒ lỗi "Không thể huỷ phiếu …: vật tư … tại kho … hiện chỉ còn …, huỷ phiếu sẽ trừ …
  ⇒ tồn âm …". Áp cho MỌI người gọi kể cả service role. Huỷ phiếu xuất (cộng lại tồn) không bao giờ bị chặn. Muốn huỷ phiếu
  nhập/chuyển đã bị dùng ⇒ huỷ các phiếu xuất/chuyển sau nó trước.
- Quyền `inventory.cancel` trước đây KHÔNG có trong bảng `permissions` (Cài đặt → Phân quyền không có ô tick, chỉ admin huỷ
  được). Migration seed quyền + cấp admin; nhãn "hủy phiếu đã ghi sổ (hoàn tồn)", có trong `DEFAULT_PERMISSION_CODES`.
  Nút Huỷ phiếu (danh sách, form, trang chi tiết) đã gate `hasPermission(…, "inventory.cancel")` ⇒ người không có quyền không thấy nút.
- Dữ liệu đã âm trước bản vá: câu SQL kiểm ở cuối file migration; sửa bằng cách huỷ phiếu xuất gây âm (cộng lại) hoặc nhập bù.

## Quyền ghi sổ + khoá danh mục + thông báo hủy nêu phiếu giữ hàng (2026-11-04, chờ chạy `20261110` + test)
- Nguyên nhân "Không thể hủy phiếu" mù mờ: lỗi Supabase là `PostgrestError` (không phải `Error`) ⇒ mẫu
  `err instanceof Error ? err.message : "…"` luôn ra câu chung. Đã thay 29 chỗ trong module Kho bằng `getErrorMessage`
  (`src/lib/error-message.ts`, dùng chung; `operation-notes.ts`/`export-order-grants.ts` re-export). Code mới PHẢI dùng hàm này.
- Hủy bị chặn vì tồn âm: thông báo nêu tối đa 5 phiếu đang ghi sổ có phát sinh xuất/chuyển đi của cùng kho + vật tư / bồn /
  lô (`inventory_holding_docs_text`). Ví dụ thật N-KA-041126/003 bị chặn đúng vì X-KA-041126/005 còn ghi sổ.
- `20261110_inventory_post_perm_catalog_lock.sql` (**chạy tay TRƯỚC deploy**):
  - Ghi sổ cần admin | `inventory.post` (trước đây quyền này không được kiểm). Người có quyền ghi sổ ghi sổ được phiếu nháp
    của BẤT KỲ ai trong nhà máy; người chỉ có `inventory.create` chỉ lưu nháp. Service role vẫn cho qua.
  - UI: nút Ghi sổ (form Nhập / Xuất 1 kho + "Ghi sổ N kho" / Chuyển) ẩn khi thiếu quyền, hiện dòng nhắc
    `INVENTORY_POST_DENIED_HINT`; `canPostInventoryDocument` ở `_components/inventory-edit-access.ts`. Trang chi tiết phiếu
    có nút chính "Ghi sổ" cho phiếu nháp (gọi RPC trực tiếp, không lưu lại) — đường cho thủ kho ghi sổ phiếu người khác lập.
  - Ghi danh mục (RLS, vẫn theo nhà máy): kho = `settings.manage_config`; phân loại / vật tư / rule kho: INSERT =
    `settings.manage_config` | `inventory.create` (thêm nhanh trên phiếu nhập), UPDATE/DELETE = `settings.manage_config`;
    ngưỡng cảnh báo = `inventory.settings` | `settings.manage_config`. Nút "+" thêm nhanh ở phiếu nhập gate cùng điều kiện;
    trang cũ `inventory/settings` (không link) chỉ admin | `settings.manage_config`.
  - Câu SQL đầu kỳ (cuối file migration) liệt kê người có quyền tạo mà thiếu quyền ghi sổ — admin tick trước khi chạy.
- Test: khối 11 trong `scripts/test-inventory-rls.mjs`; các lượt ghi sổ trong test dùng `poster` (htho nếu có
  `inventory.post`, ngược lại admin).
