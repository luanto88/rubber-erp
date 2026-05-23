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
- `dispatch_entries.rows[].diem_gn` chỉ lưu các mã điểm được chọn cho từng chuyến
- `dispatch_entries.rows[].lo_thu_hoach` phải được suy ra từ `diem_gn + phiên`
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
