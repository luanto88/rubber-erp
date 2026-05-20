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
- Danh mục `diem_gn` là master data riêng trong bảng `dispatch_delivery_points`, filter theo `factory_id`
- `dispatch_entries.rows[].diem_gn` chỉ lưu các mã điểm được chọn cho từng chuyến, không thay thế bảng master
- `dispatch_entries.rows[].lo_thu_hoach` phải được suy ra từ `diem_gn + phiên` dựa trên cấu hình phiên A/B/C/D của `dispatch_delivery_points`
- Nếu nhà máy chưa có dữ liệu master mới, hệ thống chỉ được fallback tạm thời về dữ liệu mặc định trong code để tránh gãy màn hình; nguồn chuẩn vẫn là database

### Master data xe và tài xế

- Danh sách xe dùng bảng `dispatch_vehicles`
- Danh sách tài xế dùng bảng `dispatch_drivers`
- Quan hệ xe - tài xế chính dùng bảng `dispatch_vehicle_driver_assignments`
- Dữ liệu seed hiện tại chỉ áp dụng cho nhà máy `Phước Hòa Kampong Thom` (`factories.code = 'phuochoa_kt'`)

### Logic tài xế chính

- Mỗi xe có thể có nhiều dòng lịch sử gán tài xế trong `dispatch_vehicle_driver_assignments`
- Tại một thời điểm chỉ nên có 1 dòng hiện hành cho mỗi xe với `is_current = true`
- Khi đổi tài xế chính:
  - đóng dòng hiện hành bằng `effective_to`
  - set dòng cũ `is_current = false`
  - tạo dòng mới với `effective_from` mới và `is_current = true`
- Không sửa đè lịch sử cũ nếu mục tiêu là lưu vết thay đổi tài xế chính

### Logic trên màn Điều xe

- Khi chọn xe, hệ thống phải tự điền `tài_xế` theo tài xế chính hiện hành của xe
- Người dùng vẫn được phép đổi sang tài xế khác trên từng dòng điều xe
- Việc đổi tài xế trên chứng từ chỉ thay đổi snapshot của chuyến đó, không được tự động thay master assignment
- Chứng từ lịch sử phải tiếp tục giữ giá trị `so_xe` và `tai_xe` đã lưu, kể cả khi master data đổi sau này

## 3. Module Kho nguyên liệu (`ngans`)

### Trạng thái hợp lệ

- `Đang nhận`
- `Đóng`
- `Chờ sản xuất`
- `Đang sản xuất`
- `Đã sản xuất`

Chi tiết state machine xem thêm trong `storage.md`.

### Rule quan trọng

- Không có trạng thái `Hoàn thành` cho ngăn
- Ngăn đủ 21 ngày mới chuyển sang `Chờ sản xuất`
- Chỉ ngăn `Chờ sản xuất` mới được chọn trong `Thành phẩm`
- Chọn ngăn trong `Thành phẩm` -> cập nhật ngay sang `Đang sản xuất`
- Bấm `Lưu và đánh dấu đã sản xuất` -> cập nhật ngăn sang `Đã sản xuất`
- Module `Ngăn lưu` không đọc trực tiếp bảng `dispatch_delivery_points`; nó vẫn tiêu thụ dữ liệu từ `dispatch_entries`

### Loại nguyên liệu

Phải filter theo nhà máy và dây chuyền:

- `Mủ tạp`: sử dụng các loại nguyên liệu hợp lệ của nhà máy
- `Mủ nước`: chỉ được `Mủ nước`

## 4. Module Thành phẩm (`lots`)

### Schema chính

```ts
{
  id: UUID,
  factory_id: UUID,
  day_chuyen: string,
  ma_lo: string,
  num: number,
  suffix: string,
  year: string,
  ngay_sx: date,
  ngay_ht: date | null,
  loai_csr: string,
  loai_banh: number,
  boc: string,
  tham: string,
  pallet: string[],
  tong_banh: number,
  tong_kg: number,
  trang_thai: string,
}
```

### Schema chi tiết giao dịch lô (`lot_transactions`)

```ts
{
  id: UUID,
  lot_id: UUID,
  ngan_id: UUID,
  ca: string,
  ngay_nhap: date,
  kien_a: number,
  kien_b: number,
  kien_c: number,
  kien_d: number,
  so_banh: number,
  so_kg: number,
}
```

- `lots` là bảng master tổng hợp theo `ma_lo`
- `lot_transactions` là lịch sử chi tiết theo từng ca / từng ngày / từng ngăn
- Một `ma_lo` có thể có nhiều dòng `lot_transactions`
- Trong cùng `factory_id`, chỉ được 1 dòng `lots` cho mỗi `ma_lo`

### Source of truth cho option

`du_lieu_nha_may.xlsx` là source cao nhất cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`

Quy tắc lọc:

- `loai_banh`, `loai_boc`, `loai_tham`: theo `nhà máy + dây chuyền + chủng loại SP`
- `loai_pallet_sx`: theo cấu hình nhà máy, có thể mở rộng runtime và lưu DB

### Quy tắc lô tròn

- Bánh `35` và `33.33`: 4 kiện, mỗi kiện 36 bánh -> lô tròn `144`
- Bánh `20`: 4 kiện, mỗi kiện 60 bánh -> lô tròn `240`

### Quy tắc ngôn ngữ hiển thị trong Thành phẩm

- Tên field kỹ thuật và schema DB giữ nguyên dạng `banh` / `loai_banh` / `tong_banh`
- UI nghiệp vụ của module `Thành phẩm` phải hiển thị theo cách gọi `bánh`

### Trạng thái lô

- `Hoàn thành`
- `Dở dang`
- `Xuất hàng`

### Quy tắc ngày của lô

- `ngay_sx`: ngày mở lô ban đầu
- `ngay_ht`: ngày tròn lô / ngày hoàn tất lô
- Nếu lô được nhập qua nhiều ca hoặc nhiều ngày:
  - `ngay_sx` không đổi
  - `ngay_ht` chỉ được set khi lô chuyển sang `Hoàn thành` hoặc `Xuất hàng`
- Các module downstream cần ưu tiên `ngay_ht` khi cần ngày thành phẩm hoàn tất

### Xác định trạng thái

```ts
if (loai_banh === 20) {
  lo_tron = 240;
} else {
  lo_tron = 144;
}
trang_thai = tong_banh >= lo_tron ? "Hoàn thành" : "Dở dang";
```

### Auto-calc

- `tong_banh = kien_a + kien_b + kien_c + kien_d`
- `tong_kg = tong_banh * loai_banh`
- `ma_lo = ${num}${suffix}/${year}`

### Quy tắc dãy số lô

- Dãy số lô phải liên tục trong từng nhóm `loại thành phẩm + loại bánh`
- Dãy số lô trong năm không phụ thuộc `suffix`, `bọc`, `thảm`, `pallet` hay các thuộc tính khác
- Người dùng tự chủ động reset về `01` khi sang năm mới, nên `year` là điểm cắt dãy số
- Tại thời điểm giao thoa cuối năm, `số lô max` giữ `/năm cũ` và `số lô 01` dùng `/năm mới`, không phụ thuộc tuyệt đối vào `ngay_sx` là `31/12` hay `01/01`
- Khi người dùng nhập số lô nhảy cóc trong cùng nhóm trên, UI phải cảnh báo các số lô còn trống
- Gợi ý `số lô gần nhất` và logic xác định lô tiếp theo phải tính theo cùng nhóm `loại thành phẩm + loại bánh`

### Kiện tối đa theo loại bánh

```ts
const maxKienValue = loai_banh === 20 ? 60 : 36;
```

### Rule `thảm`

- Field kỹ thuật: `tham`
- Cấu hình nguồn: `loai_tham`
- UI hiển thị: `Thảm`
- Dữ liệu cũ phải được normalize về 2 giá trị chuẩn: `Cũ`, `Mới`

### Rule lô kế thừa

Khi lô cuối ca trước đang dở:

- Kiện đã đủ từ ca trước -> read-only, không tính vào sản lượng ca này
- Kiện chưa đủ -> nhập tiếp, chỉ tính phần delta thêm vào
- Nếu lô vừa đạt tròn trong lần nhập tiếp:
  - update chính bản ghi `Dở dang` hiện có
  - không tạo bản ghi `lots` mới cùng `ma_lo`
  - set `ngay_ht = ngay_sx` của lần nhập hoàn tất
  - lưu thêm 1 dòng vào `lot_transactions` cho ca đang nhập

### Quy tắc duy nhất `ma_lo`

- Trong cùng `factory_id`, `ma_lo` là định danh nghiệp vụ duy nhất
- Không được tồn tại đồng thời 2 bản ghi `lots` cùng `ma_lo` với các trạng thái khác nhau
- Nếu lô `Dở dang` đã tồn tại, thao tác sau phải tiếp tục cập nhật bản ghi đó, không được tạo lô mới

### Rule xóa dòng sản xuất

- Xóa trong session thành phẩm là xóa theo từng dòng `lot_transactions`
- Không xóa cả `lots` khi vẫn còn ít nhất 1 giao dịch
- Không được map theo `lot.id` khi người dùng đang chọn 1 dòng session; phải map theo `lot_transactions.id`
- Có thể xóa bất kỳ dòng `lot_transactions` nào được chọn trong session, không còn rule chặn "chỉ xóa transaction mới nhất"
- Khi xóa xong phải tính lại `lots`:
  - `tong_banh`, `tong_kg`
  - `trang_thai` (`Dở dang` / `Hoàn thành`)
