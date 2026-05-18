# Module Bảo trì

## Phạm vi

Module quản lý toàn bộ vòng đời sự cố / bảo dưỡng thiết bị & xe tại nhà máy:
- Biên bản kiểm tra sự cố (Sửa chữa) và biên bản bảo dưỡng (Bảo dưỡng)
- Quản lý vật tư sử dụng: trong kho hoặc mua ngoài
- Tự động tạo phiếu xuất kho khi biên bản được phê duyệt
- Lý lịch thiết bị / xe (lịch sử bảo trì theo từng thiết bị)
- In biên bản theo 3 mẫu chuẩn

Route riêng: `/dashboard/maintenance`  
Tất cả bảng có `factory_id`, mọi query đều filter theo `factory_id`.

---

## Hai loại biên bản

| Hạng mục | Mô tả | Chọn thiết bị |
|---|---|---|
| `Sửa chữa` | Sự cố xảy ra, cần sửa / thay thế | 1 hoặc nhiều |
| `Bảo dưỡng` | Bảo trì định kỳ | Nhiều thiết bị (multi-select) |

**Bảo dưỡng**: Chọn nhiều thiết bị cùng lúc → mỗi thiết bị hiển thị 1 form nhập liệu riêng bên dưới,  
giống pattern multi-item trong Nhập/Xuất kho (`inventory/receipts`, `inventory/issues`).

---

## Phân loại sửa chữa Lớn / Nhỏ

Chỉ áp dụng khi `hang_muc = Sửa chữa`.

Ngưỡng: **200 USD** (quy đổi từ loại tiền thực tế).

```typescript
const usdEquiv =
  loai_tien === "USD" ? chi_phi_dk :
  loai_tien === "KHR" ? chi_phi_dk / 4100 :
  loai_tien === "VND" ? chi_phi_dk / 25000 : 0;
const suggested = usdEquiv > 200 ? "lon" : "nho";
```

Hệ thống tự gợi ý `Lớn` / `Nhỏ` nhưng user có thể override thủ công.  
Ba loại tiền: `USD` ($), `KHR` (៛), `VND` (₫).

---

## Bộ phận

```
Mủ tạp | Mủ nước | Nước thải | Biomass | Đội xe | Văn phòng | Khác
```

Bộ phận quyết định danh sách thiết bị khả dụng (filter `maintenance_assets.bo_phan`).  
Bộ phận `Đội xe` hiển thị thêm trường `Tên tài xế` trên mỗi dòng thiết bị.

---

## Bảng dữ liệu

### `maintenance_assets` — Danh mục thiết bị / xe

```sql
id           UUID PK
factory_id   UUID
ma_tb        TEXT  UNIQUE per factory
ten_tb       TEXT
bo_phan      TEXT  -- Mủ tạp|Mủ nước|Nước thải|Biomass|Đội xe|Văn phòng|Khác
loai         TEXT  -- may_moc | xe
nam_sd       TEXT  -- năm sản xuất / mua
bien_so      TEXT  -- biển số (chỉ xe)
mo_ta        TEXT
trang_thai   TEXT  -- active | inactive
created_at, updated_at
```

Seed từ `cung_cap_dl/kho_bao_tri/bao_tri/danh_muc_thiet_bi_goc.xlsx` (151 items).  
Xe lấy thêm từ `vehicles` / `dispatch_entries`.

### `maintenance_staff` — Nhân sự bảo trì

```sql
id        UUID PK
factory_id UUID
ten        TEXT
chuc_vu    TEXT
email      TEXT    -- dùng cho thông báo email BGĐ (thêm bằng migration)
active     BOOLEAN DEFAULT true
created_at
```

SQL migration (chạy trong Supabase SQL Editor):
```sql
ALTER TABLE maintenance_staff ADD COLUMN IF NOT EXISTS email TEXT;
```

Seed từ `cung_cap_dl/kho_bao_tri/bao_tri/danh_sach_nm.xlsx` (14 người).

Phân loại nhân sự theo `chuc_vu` (dùng trong UI):

| Nhóm | Điều kiện | Dùng cho trường |
|---|---|---|
| `bgdStaff` | `chuc_vu` chứa `"giám đốc"` | BGĐ phụ trách, Giám đốc |
| `nvStaff` | `chuc_vu` chứa `"nhân viên"` | Nhân viên phụ trách, Phụ trách bảo trì |
| `workerStaff` | còn lại (Tổ trưởng, Công nhân, Bảo vệ) | Người thực hiện (chips) |

```typescript
const bgdStaff = staffList.filter(s => s.chuc_vu?.toLowerCase().includes("giám đốc"))
const nvStaff = staffList.filter(s => s.chuc_vu?.toLowerCase().includes("nhân viên"))
const workerStaff = staffList.filter(s => {
  const cv = s.chuc_vu?.toLowerCase() || ""
  return !cv.includes("giám đốc") && !cv.includes("nhân viên")
})
```

**Quy tắc loại trừ**: `bgd_phu_trach` và `giam_doc` không được chọn cùng một người — dropdown của field này lọc bỏ giá trị đã chọn ở field kia.

### `maintenance_external_materials` — Vật tư ngoài (master list)

```sql
id           UUID PK
factory_id   UUID
ten_vat_tu   TEXT  -- lưu lâu dài để tái sử dụng
dvt          TEXT
created_at
```

**Auto-save**: Khi lưu biên bản, mọi tên vật tư `ben_ngoai` chưa có trong master list sẽ được tự động insert vào bảng này để hiện ra ở datalist lần sau.

### `maintenance_records` — Biên bản (document header)

```sql
id                    UUID PK
factory_id            UUID
ma_bb                 TEXT     -- MT-DDMMYY/XXX (auto, read-only sau khi tạo)
hang_muc              TEXT     -- Sửa chữa | Bảo dưỡng
ngay                  DATE
tu_gio                TIME
den_gio               TIME
bo_phan               TEXT

-- Nhân sự chung (snapshot tên tại thời điểm tạo)
nguoi_tao             TEXT
nguoi_thuc_hien       TEXT[]
nv_phu_trach          TEXT
phu_trach_bao_tri     TEXT
bgd_phu_trach         TEXT
giam_doc              TEXT

-- Workflow
trang_thai            TEXT     -- cho_duyet | da_duyet | huy
nguoi_duyet           TEXT
ngay_duyet            TIMESTAMPTZ
inventory_issue_doc_id UUID    -- link phiếu xuất kho auto-tạo khi duyệt

ghi_chu               TEXT
created_at, updated_at
```

### `maintenance_record_lines` — Dòng thiết bị trong biên bản

Một biên bản có N dòng thiết bị (N ≥ 1).

```sql
id                    UUID PK
record_id             UUID → maintenance_records
factory_id            UUID
sort_order            INTEGER

-- Thiết bị (snapshot tại thời điểm tạo)
asset_id              UUID → maintenance_assets
ten_tb                TEXT
ma_tb                 TEXT
ten_tai_xe            TEXT     -- Đội xe only

-- Nội dung
noi_dung              TEXT
nguyen_nhan           TEXT     -- chỉ Sửa chữa
cac_khac_phuc         TEXT

-- Chi phí per dòng
loai_sua_chua         TEXT     -- lon | nho (auto gợi ý, overrideable)
chi_phi_dk            NUMERIC
loai_tien             TEXT     -- USD | KHR | VND
cong_tho              NUMERIC

-- Nhiên liệu (Đội xe only)
nhien_lieu_su_dung    TEXT
dvt_do                TEXT
so_luong_do           NUMERIC

-- Ảnh per thiết bị (tối đa 6)
image_urls            TEXT[]
```

Ảnh upload lên bucket `order-files` với path `{factory_id}/maintenance/{timestamp}_{filename}`.  
Mỗi dòng có 6 slot cố định — click slot trống để upload, click ảnh để xem full, nút × để xóa.

### `maintenance_materials` — Vật tư per dòng thiết bị

```sql
id                    UUID PK
line_id               UUID → maintenance_record_lines
record_id             UUID → maintenance_records   -- dễ query tổng hợp
factory_id            UUID
nguon                 TEXT    -- trong_kho | ben_ngoai
inventory_item_id     UUID    -- → inventory_items (nullable, chỉ trong_kho)
ten_vat_tu            TEXT    -- snapshot tên
dvt                   TEXT
so_luong              NUMERIC
don_gia               NUMERIC    -- chỉ ben_ngoai
loai_tien             TEXT       -- chỉ ben_ngoai
thanh_tien            NUMERIC    -- so_luong * don_gia
sort_order            INTEGER
```

### Quan hệ bảng

```
maintenance_records (1 biên bản)
  └── maintenance_record_lines (N dòng thiết bị)
        └── maintenance_materials (N vật tư per dòng)
```

---

## Mã biên bản

Format: `MT-DDMMYY/XXX`  
Ví dụ: `MT-110426/001`

- Tự sinh khi save lần đầu, read-only sau đó
- Đếm tuần tự trong ngày theo `factory_id`
- QR trỏ về URL đầy đủ của trang chi tiết: `{origin}/dashboard/maintenance/records/{uuid}`
- QR hiển thị ở trang chi tiết (góc trên trái) và trong các mẫu in (góc trên phải)

---

## Quyền chỉnh sửa biên bản

Biên bản `cho_duyet` chỉ được sửa bởi:
- **Người tạo biên bản** (`nguoi_tao` khớp với `full_name` hoặc `username` của user hiện tại), **hoặc**
- **User có quyền `maintenance.approve`**

Biên bản `da_duyet` hoặc `huy`: read-only với tất cả mọi người.

```typescript
const isCreator = isNew || (
  record?.nguoi_tao != null &&
  (record.nguoi_tao === user?.full_name || record.nguoi_tao === user?.username)
)
const isReadOnly =
  record?.trang_thai === "da_duyet" ||
  record?.trang_thai === "huy" ||
  (!isNew && !isCreator && !canApprove)
```

---

## Workflow phê duyệt

```
Tạo → cho_duyet
Phê duyệt (maintenance.approve) → da_duyet
  └─ Kiểm tra tồn kho vật tư trong_kho (chặn nếu không đủ)
  └─ Nếu có vật tư trong_kho:
      → Tạo inventory_documents (loại Xuất kho, status = posted)
      → Ghi sổ inventory stock movements
      → Lưu inventory_issue_doc_id vào maintenance_records
Hủy (maintenance.approve) → huy
```

Sau phê duyệt, biên bản và phiếu xuất kho đều không chỉnh sửa được.

UX: Save / Phê duyệt / Hủy đều **ở lại trang hiện tại** và hiện success toast tự dismiss sau 4 giây.  
Chỉ khi tạo biên bản **mới** mới redirect sang trang chi tiết sau khi save lần đầu.

### Phiếu xuất kho auto-tạo

- 1 phiếu duy nhất gom toàn bộ vật tư `trong_kho` của cả biên bản (tất cả lines)
- `note` phiếu xuất: `"Sửa chữa/Bảo dưỡng thiết bị: [ten_tb line1], [ten_tb line2]..."`
- `document_code`: `X-BT-{ma_bb}`
- Kiểm tra tồn kho tại thời điểm phê duyệt, không tại thời điểm tạo biên bản
- Nếu không đủ tồn: hiển thị lỗi, chặn phê duyệt
- Tồn kho lấy từ cột `on_hand` trong bảng `inventory_stock_balances` (không phải `quantity_on_hand`)

---

## Tích hợp Điều xe

- Thiết bị loại `xe` trong `maintenance_assets.loai = 'xe'`
- Xe được seed từ bảng `vehicles` / `dispatch_entries`
- Khi `bo_phan = Đội xe` → asset picker chỉ hiện xe
- Mỗi dòng xe: hiển thị thêm trường `Tên tài xế` (chọn từ danh sách hoặc nhập tay)
- Sau phê duyệt: dữ liệu tự cập nhật vào lý lịch xe (query từ `maintenance_record_lines`)

---

## Lý lịch thiết bị / xe

Bảng tổng hợp lịch sử bảo trì per thiết bị, 5 cột theo mẫu `ll_xe.pdf` / `ll_may.pdf`:

| Ngày | Nội dung sửa chữa, thay thế phụ tùng | Giá trị | Người thực hiện | Người theo dõi |
|---|---|---|---|---|

- `Người theo dõi` = `nv_phu_trach` của biên bản
- `Giá trị` = `chi_phi_dk` + ký hiệu tiền (`$`, `៛`, `₫`)
- Chỉ hiển thị biên bản `da_duyet`
- Xuất PDF bám mẫu `ll_xe.pdf` (cho xe) và `ll_may.pdf` (cho máy)

**Kỹ thuật query**: Do Supabase JS v2 không hỗ trợ `.order("related_table(col)")` cross-table, lịch sử phải dùng two-step query:
1. Query `maintenance_records` với filter/order trước → lấy danh sách `id`
2. Query `maintenance_record_lines` với `.in("record_id", ids)`
3. Client-side sort kết quả cuối

---

## Thông báo BGĐ

Nút **"Thông báo BGĐ"** hiển thị khi biên bản ở trạng thái `cho_duyet`. Gọi API route `POST /api/maintenance/notify` với `{ recordId, factoryId }`.

### Kênh 1 — Telegram

- Gửi đến group cấu hình bởi `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`
- Nội dung HTML có: mã biên bản, hạng mục, bộ phận, ngày, người tạo, thiết bị, BGĐ phụ trách, Giám đốc
- Link "Xem và phê duyệt biên bản" trỏ về `{NEXT_PUBLIC_APP_URL}/dashboard/maintenance/records/{id}`

### Kênh 2 — Email (Gmail SMTP)

- Lấy email của `bgd_phu_trach` và `giam_doc` từ bảng `maintenance_staff.email`
- Gửi qua `nodemailer` với Gmail SMTP, xác thực bằng App Password (không phải mật khẩu thường)
- Email HTML có header cam, bảng thông tin biên bản, nút CTA link về trang chi tiết

### Biến môi trường cần thiết

```
TELEGRAM_BOT_TOKEN=<bot token>
TELEGRAM_CHAT_ID=<group chat id (âm)>
GMAIL_USER=<gmail gửi đi>
GMAIL_APP_PASSWORD=<Google App Password — bật 2FA trước, tạo tại Google Account → Security → App passwords>
NEXT_PUBLIC_APP_URL=https://qlsxkpt.vercel.app  (fallback nếu không có)
```

### Xử lý lỗi

- Hai kênh hoạt động độc lập — lỗi một kênh không ảnh hưởng kênh còn lại
- HTTP 207 trả về khi có lỗi một phần, kèm mảng `errors`
- Nếu `GMAIL_APP_PASSWORD` trống → bỏ qua email, không báo lỗi

### Thiết lập email nhân sự

Sau khi chạy migration thêm cột `email`, vào **Cài đặt → Bảo trì → Nhân sự bảo trì** để điền email cho từng BGĐ / Giám đốc.

---

## In biên bản (3 mẫu)

| `?type=` | Mẫu in | Tham chiếu |
|---|---|---|
| `su_co` | Biên bản kiểm tra sự cố | `bb_mu_tap.pdf`, `bb_dx.pdf` |
| `de_nghi` | Giấy đề nghị sửa chữa + Biên bản nghiệm thu | `bb_bd_mt.pdf`, `bb_bd_xe.pdf` |
| `ly_lich` | Lý lịch thiết bị | `ll_xe.pdf`, `ll_may.pdf` |

Tất cả dùng chung `print/page.tsx`, phân nhánh theo `type` và `record_id` query param.

**Trang in bypass sidebar**: `dashboard/layout.tsx` kiểm tra `pathname.includes("/print")` và render `{children}` trực tiếp, không có sidebar.

Mỗi mẫu in `su_co` / `de_nghi` có QR code ở góc trên phải, trỏ về trang chi tiết biên bản (dùng `QRCodeSVG` từ `qrcode.react`, size=64).

Cấu trúc biên bản `su_co` / `de_nghi`:
- Header: số biên bản + QR, ngày, địa điểm
- Danh sách tham dự (4 vị trí: Giám đốc, Phó GĐ, NV kỹ thuật, Tổ bảo trì)
- Thông tin thiết bị + nội dung xử lý
- Khối ký tên (3-4 cột)

**Cấu trúc `SignatureRow`**: Chức vụ → khoảng trắng `h-16` (≈2.5 cm để ký tay) → đường kẻ ngang → Tên → "(Ký và ghi rõ họ tên)".

**Nút in chỉ sáng khi `da_duyet`**: Khi biên bản ở trạng thái `cho_duyet` hoặc `huy`, nút in hiển thị dưới dạng `<span>` không thể click (cursor-not-allowed, tooltip giải thích). Khi `da_duyet`, nút in là `<Link>` mở trang in.

---

## Permissions

```
maintenance.view
maintenance.create
maintenance.edit
maintenance.delete
maintenance.approve
maintenance.print
maintenance.export_file
```

Guard bắt buộc ở cả UI và logic thao tác.

---

## Settings (Cài đặt)

Tab `Bảo trì` trong `/dashboard/settings` (tab riêng từ đầu vì module đủ lớn):

- `Thiết bị`: CRUD `maintenance_assets` (filter theo bộ phận, phân loại máy móc/xe)
- `Nhân sự bảo trì`: CRUD `maintenance_staff`
- `Vật tư ngoài`: CRUD `maintenance_external_materials`

---

## Cấu trúc thư mục

```text
src/app/dashboard/maintenance/
  page.tsx                   -- Overview: KPI cards (BB tháng, chờ duyệt, chi phí)
  records/
    page.tsx                 -- Danh sách biên bản + bộ lọc
    new/page.tsx             -- Redirect sang [id] với id="new"
    [id]/page.tsx            -- Form tạo / chỉnh sửa / xem chi tiết
  history/page.tsx           -- Lý lịch thiết bị / xe
  print/page.tsx             -- In biên bản (3 mẫu), không có sidebar
  _components/
    maintenance-shell.tsx    -- Shell layout sidebar
    maintenance-data.ts      -- Types, data loaders, helpers
```

---

## Quy tắc UI

### Asset picker
- Dùng card picker inline (không tách component riêng) theo kiểu `CompactItemSelectorCard` của inventory
- Mỗi card: `ma_tb` (monospace), `ten_tb` (2-line clamp), loại (Xe / Máy + biển số nếu có)
- Viền cam + dấu check cam khi đã chọn; badge đếm số đã chọn ở tiêu đề; nút "Bỏ chọn tất cả"
- Ô tìm kiếm lọc theo mã hoặc tên, nổi phía trên grid card — container ô tìm kiếm phải có `z-10` để không bị thẻ card đè lên
- Grid: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`

### Dòng thiết bị
- Mỗi dòng là 1 block expand/collapse với header cam
- Header hiển thị tên + mã + badge Lớn/Nhỏ (Sửa chữa)
- 6 slot ảnh cố định per dòng — upload qua shared hidden `<input type="file">` + `activeSlotRef` track slot đang upload

### Vật tư
- `ben_ngoai`: `<input>` với `<datalist>` từ `maintenance_external_materials`; tên mới tự động được lưu vào master khi save biên bản
- `trong_kho`: `<select>` từ `inventory_items` với thông tin tồn kho
- Tồn kho lấy từ `inventory_stock_balances.on_hand` (không phải `quantity_on_hand`)
- **Cảnh báo inline**: Khi `so_luong > currentStock`, ô nhập chuyển viền đỏ và hiện text đỏ bên dưới: `"Vượt tồn (X)"`
- **Chặn phê duyệt**: `handleApprove` validate toàn bộ vật tư `trong_kho` trước khi tạo phiếu xuất; hiện `saveError` và return sớm nếu bất kỳ vật tư nào vượt tồn

### Nhân sự
- `nguoi_thuc_hien`: chip multi-select, chỉ hiển thị `workerStaff`
- `nv_phu_trach` / `phu_trach_bao_tri`: `<select>` từ `nvStaff`
- `bgd_phu_trach`: `<select>` từ `bgdStaff`, loại trừ giá trị đã chọn ở `giam_doc`
- `giam_doc`: `<select>` từ `bgdStaff`, loại trừ giá trị đã chọn ở `bgd_phu_trach`

### QR code
- Dùng `QRCodeSVG` từ package `qrcode.react` (đã có trong project)
- Trang chi tiết: QR compact (size=56) hiện ngay sau khi biên bản có `ma_bb`
- Trang in: QR (size=64) ở góc trên phải mỗi mẫu, cạnh tiêu đề + số biên bản

### Toàn bộ giao diện tiếng Việt có dấu
