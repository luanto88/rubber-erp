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
