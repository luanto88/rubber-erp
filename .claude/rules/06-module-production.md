---
description: Business logic các module sản xuất - Điều xe, Kho nguyên liệu, Thành phẩm
---

# Business Logic: Sản xuất

## 1. Rule chung

- Mọi query phải filter theo `factory_id`
- Mọi form CRUD phải có field `day_chuyen` đặt ở đầu form khi nghiệp vụ phụ thuộc dây chuyền
- Các dropdown phụ thuộc phải reset khi đổi `day_chuyen`
- Các option sản phẩm phải lấy từ matrix cấu hình nhà máy, không hard-code rải rác

## 2. Module Điều xe (`dispatch_entries`)

### Cập nhật 2026-06-01: tách dòng điều xe vật lý

- `dispatch_entries` hiện là header/chứng từ; chi tiết từng chuyến đã có bảng vật lý `dispatch_entry_rows`.
- Migration đã chạy: `supabase/migrations/20260601_dispatch_entry_rows.sql`.
- `dispatch_entry_rows` là nguồn chính cho các tính năng mới cần query/thống kê/PDF theo ngày, đội, xe, tài xế, km, sản lượng.
- `dispatch_entries.rows` chỉ còn là cache legacy tạm thời trong giai đoạn chuyển tiếp; mã nguồn mới không được đọc hay ghi trực tiếp cột này.
- Khi thêm/sửa/import điều xe trong `src/app/dashboard/dispatch/page.tsx`, chỉ ghi chi tiết vào `dispatch_entry_rows`; header `dispatch_entries` chỉ giữ metadata chứng từ.
- Khi đọc ở module điều xe, `dispatch_entry_rows` là nguồn duy nhất cho chi tiết từng chuyến.
- Helper mapping đặt tại `src/lib/dispatch-entry-rows.ts`.
- Helper thống kê đặt tại `src/lib/dispatch-analytics.ts`; helper PDF đặt tại `src/lib/dispatch-pdf.ts`.
- Mỗi dòng điều xe có `ghi_chu`; với dữ liệu vật lý lưu ở `dispatch_entry_rows.ghi_chu`, với legacy lưu trong `rows[].ghi_chu`.
- Tab `Thống kê` trong `/dashboard/dispatch` có lọc theo đội/xe và xuất PDF tổng/theo đội/theo xe.
- Màn hình chi tiết ngày điều xe có nút xuất PDF từng chuyến.

### Schema chính

```ts
{
  id: UUID,
  factory_id: UUID,
  ngay: string,
  chung_nhan: string,
  rows: DxRow[],
  created_at: string,
  ma_dx?: string,
}
```

### Rule quan trọng

- `ma_dx` format: `DX-ddmmyy/N`
- `chung_nhan` chỉ được là `PEFC CS`, `PEFC FM`, `Không`
- KL khô phải auto-calc từ KL tươi và DRC
- `chuyen` được auto-assign theo xe trong ngày
- `lo_trinh` chỉ hiển thị các điểm cùng `đội` với `diem_gn` đã chọn
- Danh mục `diem_gn` dùng bảng `dispatch_delivery_points`, filter theo `factory_id`
- `dispatch_entry_rows.diem_gn` lưu các mã điểm được chọn cho từng chuyến.
- `dispatch_entry_rows.lo_thu_hoach` phải được suy ra từ `diem_gn + phiên`.
- Nếu nhà máy chưa có master data mới, hệ thống chỉ được fallback tạm thời để tránh gãy màn hình

### Master data xe và tài xế

Phần quy định chi tiết về:

- xe
- tài xế
- tài xế chính theo xe
- dữ liệu thêm nhanh trong `Cài đặt / Cấu hình nhà máy`

xem tại:

- `.claude/rules/04-settings-master-data.md`

### Logic trên màn Điều xe

- Khi chọn xe, hệ thống phải tự điền `tài_xế` theo tài xế chính hiện hành của xe
- Người dùng vẫn được phép đổi sang tài xế khác trên từng dòng điều xe
- Việc đổi tài xế trên chứng từ chỉ thay đổi snapshot của chuyến đó, không được tự động thay master assignment
- Chứng từ lịch sử phải tiếp tục giữ giá trị `so_xe` và `tai_xe` đã lưu

## 3. Module Kho nguyên liệu (`ngans`)

### Trạng thái hợp lệ

- `Đang nhận`
- `Đóng`
- `Chờ sản xuất`
- `Đang sản xuất`
- `Đã sản xuất`

### Rule quan trọng

- Không có trạng thái `Hoàn thành` cho ngăn
- Ngăn đủ 21 ngày mới chuyển sang `Chờ sản xuất`
- Chỉ ngăn `Chờ sản xuất` mới được chọn trong `Thành phẩm`
- Chọn ngăn trong `Thành phẩm` -> cập nhật ngay sang `Đang sản xuất`
- Bấm `Lưu và đánh dấu đã sản xuất` -> cập nhật ngăn sang `Đã sản xuất`

## 4. Module Thành phẩm (`lots`)

- `lots` là bảng master tổng hợp theo `ma_lo`
- `lot_transactions` là lịch sử chi tiết theo từng ca / từng ngày / từng ngăn
- Một `ma_lo` có thể có nhiều dòng `lot_transactions`
- Trong cùng `factory_id`, chỉ được 1 dòng `lots` cho mỗi `ma_lo`
- `ma_lo` là định danh nghiệp vụ duy nhất trong cùng `factory_id`
- `tong_banh = kien_a + kien_b + kien_c + kien_d`
- `tong_kg = tong_banh * loai_banh`
- `ma_lo = ${num}${suffix}/${year}`

## 4.1 Sang kiện / Thay bọc

Tính năng cho phép chuyển pallet hoặc đổi bọc cho nhiều lô `Hoàn thành` cùng lúc từ overlay panel trong module Thành phẩm.

### Hai loại thao tác

| Loại | Trường thay đổi | Bảng lịch sử |
|------|----------------|--------------|
| **Sang kiện** | `lots.pallet[]` | `sk_history` |
| **Thay bọc** | `lots.boc` | `sk_history` |

### Flow xử lý

1. Người dùng mở overlay → chọn lô từ panel trái (chỉ lô `Hoàn thành`)
2. Click lô → lô xuất hiện ở panel phải với số bành từng kiện (A/B/C/D) điền sẵn bằng max
3. Người dùng chỉnh số bành từng kiện nếu cần sang một phần
4. Xác nhận → `handleSkSave` chạy cho từng lô trong hàng chờ

### Rule sang một phần (partial conversion)

Khi số bành chuyển < số bành hiện có của lô gốc:

- **Lô gốc**: cập nhật `kien_a/b/c/d`, `tong_banh`, `tong_kg`, `boc`/`pallet` sang giá trị mới
- **Lô tồn dư**: tạo mới với:
  - `suffix = lot.suffix + "r"` (VD: `05cs` → `05csr`)
  - `ma_lo = buildMaLo(num, suffix + "r", year)` (VD: `05csr/26`)
  - `kien_*` = phần còn lại (`lot.kien_* - converted_kien_*`)
  - `boc`, `pallet` = giá trị **cũ** của lô gốc
  - `trang_thai = "Hoàn thành"`
- Trước khi insert lô tồn dư: kiểm tra uniqueness qua Supabase query — nếu `ma_lo` đã tồn tại thì bỏ qua insert (edge case)

### Rule sang toàn bộ (full conversion)

Khi tất cả `kien_*` chuyển bằng `lot.kien_*`:
- Chỉ UPDATE lô gốc — không tạo lô tồn dư

### Lịch sử (`sk_history`)

Sau khi xử lý xong tất cả lô trong một phiên, insert 1 bản ghi vào `sk_history`:

```ts
{
  factory_id,
  ngay: "YYYY-MM-DD",
  loai: "Sang kiện" | "Thay bọc",
  chung_loai: skFilterLoai || skPending[0].lot.loai_csr,
  from_boc: null | string,       // Thay bọc: bọc cũ (từ filter hoặc lot đầu tiên)
  to_boc:   null | string,       // Thay bọc: bọc mới
  from_pallet: null | string,    // Sang kiện: pallet cũ (từ filter hoặc null)
  to_pallet:   null | string,    // Sang kiện: pallet mới (join ", ")
  lots: [{ id, ma_lo, converted: { a, b, c, d } }],  // JSONB
}
```

### Quan hệ với Xuất hàng

- Sang kiện / Thay bọc xảy ra **trước** khi xuất hàng
- Sau khi sang kiện, `lots.pallet` đã được cập nhật → Xuất hàng đọc giá trị mới trực tiếp
- Lô tồn dư tự động xuất hiện trong danh sách Thành phẩm với `trang_thai = "Hoàn thành"`
- Không cần sync thêm — chỉ cần `loadData(factoryId)` sau khi lưu

### Ràng buộc kỹ thuật

- Chỉ thao tác trên lô có `trang_thai = "Hoàn thành"` (qua `normalizeLotStatus`)
- Lô đang xử lý (trong hàng chờ panel phải) bị ẩn khỏi panel trái trong cùng phiên
- `skToPallet` là `string[]` — pallet mới có thể chọn nhiều giá trị từ `PALLET_OPTS`
- `getBocsForLoaiCSR(dc, loai_csr)` dùng để lấy danh sách bọc hợp lệ cho tab Thay bọc
- Toàn bộ logic nằm trong `src/app/dashboard/product/page.tsx` — không thêm file hay package mới
## Cập nhật 2026-06-10: chống import trùng sản lượng

- Module Sản lượng (`production_records`) phải coi khóa nghiệp vụ chuẩn là `factory_id + ngay + doi + so_xe + chuyen`.
- Preview import file sản lượng phải kiểm tra cả 2 nhóm trùng:
  - Trùng ngay trong cùng file import.
  - Trùng với dữ liệu đã có sẵn trong hệ thống.
- Khi preview phát hiện trùng với dữ liệu đang có, phải gắn cảnh báo rõ ràng để người dùng biết dòng đó sẽ ghi đè dữ liệu cũ nếu tiếp tục import.
- Không được `upsert` mù chỉ dựa vào giả định database luôn sạch. Import phải chủ động đọc trước các dòng hiện có theo ngày trong file, rồi:
  - `insert` cho dòng chưa tồn tại.
  - `update` cho dòng đã tồn tại đúng khóa nghiệp vụ.
  - dọn bớt các bản ghi trùng cũ nếu lịch sử dữ liệu đã bị lỗi tạo 2 dòng cùng khóa.
- Nếu file import tự chứa nhiều dòng trùng cùng khóa `ngày + đội + xe + chuyến`, phải chặn xác nhận import và yêu cầu người dùng sửa file trước.
- Sau khi import hoặc sửa/xóa thủ công trong module Sản lượng, vẫn phải gọi write-back để đồng bộ lại khối lượng sang Điều xe; không để Điều xe nhỏ hơn Sản lượng chỉ vì dữ liệu trùng.
- Các thao tác thêm/sửa/xóa từng dòng sản lượng trên UI chỉ dành cho tài khoản `admin`.
- Nút `Thêm mới` và các action sửa/xóa từng dòng phải ẩn với user không phải `admin`, đồng thời handler cũng phải chặn ở tầng logic để tránh lách bằng UI cũ.
## Cập nhật 2026-06-10: UI lọc và thống kê mới

### Điều xe

- `Điều xe/Danh sách` và `Điều xe/Thống kê` có thêm bộ lọc `Loại nguyên liệu` dạng `multi-select`.
- Bộ lọc này phải kết hợp được với `Ghi chú`.
- `Điều xe/Thống kê` hiển thị:
  - `Tổng bảng phân xe`
  - `Tổng chuyến xe`
  - `Tổng km di chuyển`
  - `Khối lượng tươi theo loại`
  - `Khối lượng khô theo loại`
- Không được để trùng 2 header thống kê giống nhau khi ở tab `Thống kê`.
- Mọi text hiển thị của `Điều xe` phải dùng tiếng Việt Unicode bình thường, không dùng text bị escape hoặc mojibake.

### Sản lượng

- `Sản lượng/Danh sách` và `Sản lượng/Thống kê` có thêm bộ lọc `Loại nguyên liệu` dạng `multi-select`.
- `Sản lượng/Danh sách` hiển thị theo `ngày`, bấm mở rộng mới hiện chi tiết từng dòng.
- Dòng header ngày phải chứa tổng `Tươi/Khô` và action của ngày.
- `Sản lượng/Thống kê` phải hiển thị được khối lượng các loại nguyên liệu tươi/khô.
