# Module Bảo trì

## Phạm vi

Module quản lý toàn bộ vòng đời sự cố / bảo dưỡng thiết bị & xe tại nhà máy:

- Biên bản kiểm tra sự cố (Sửa chữa) và biên bản bảo dưỡng (Bảo dưỡng)
- Quản lý vật tư sử dụng: trong kho hoặc mua ngoài
- Tự động tạo phiếu xuất kho khi biên bản được phê duyệt
- Lý lịch thiết bị / xe (lịch sử bảo trì theo từng thiết bị)
- In biên bản theo 8 type: F13, F10+F15, F13+F10+F15+Ảnh, F03+F15+Ảnh, F03+F15+F06+Ảnh, F08+F15SmallXe+F06, F01, F02

Route riêng: `/dashboard/maintenance`  
Tất cả bảng có `factory_id`, mọi query đều filter theo `factory_id`.

---

## Hai loại biên bản

| Hạng mục    | Mô tả                            | Chọn thiết bị                 |
| ----------- | -------------------------------- | ----------------------------- |
| `Sửa chữa`  | Sự cố xảy ra, cần sửa / thay thế | 1 hoặc nhiều                  |
| `Bảo dưỡng` | Bảo trì định kỳ                  | Nhiều thiết bị (multi-select) |

**Bảo dưỡng**: Chọn nhiều thiết bị cùng lúc → mỗi thiết bị hiển thị 1 form nhập liệu riêng bên dưới,  
giống pattern multi-item trong Nhập/Xuất kho (`inventory/receipts`, `inventory/issues`).

---

## Phân loại sửa chữa Lớn / Nhỏ

Chỉ áp dụng khi `hang_muc = Sửa chữa`.

Ngưỡng: **200 USD** (quy đổi từ loại tiền thực tế).

```typescript
const usdEquiv =
  loai_tien === "USD"
    ? chi_phi_dk
    : loai_tien === "KHR"
      ? chi_phi_dk / 4000
      : loai_tien === "VND"
        ? chi_phi_dk / 26500
        : 0;
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

### Asset picker theo bộ phận

| Bộ phận | Nguồn danh sách                            | FK lưu vào line       |
| ------- | ------------------------------------------ | --------------------- |
| Đội xe  | `dispatch_vehicles` (active, theo factory) | `dispatch_vehicle_id` |
| Còn lại | `maintenance_assets` (filter `bo_phan`)    | `asset_id`            |

Khi bộ phận = `Đội xe`:

- Dropdown picker load từ `dispatch_vehicles` thay vì `maintenance_assets`
- Tự điền `ten_tai_xe` từ tài xế hiện hành (`dispatch_vehicle_driver_assignments.is_current = true`)
- Dòng line lưu `dispatch_vehicle_id`, `asset_id = null`

---

## Nội dung chung cho Bảo dưỡng nhiều thiết bị

Khi `hang_muc = Bảo dưỡng` và chọn ≥ 2 thiết bị, form hiển thị card nội dung chung với nút "+ Nhập nội dung chung".

### 4 trường chung (mirror cấu trúc của từng dòng thiết bị)

| Trường DB             | Label UI                                          | Dùng trong mẫu in                        |
| --------------------- | ------------------------------------------------- | ---------------------------------------- |
| `noi_dung_chung`      | 1/ Nội dung bảo dưỡng chung                       | F03 — "1/ Nội dung bảo dưỡng"            |
| `nguyen_nhan_chung`   | 2/ Lý do bảo dưỡng chung                          | F03 — "2/ Lý do bảo dưỡng"               |
| `cac_khac_phuc_chung` | 3/ Cách khắc phục / Khối lượng đã bảo dưỡng chung | F15 — "Khối lượng đã bảo dưỡng"          |
| `image_urls_chung`    | 4/ Ảnh chung (6 slot)                             | Trang ảnh — section "Ảnh chung" đứng đầu |

### Rule kết hợp nội dung khi in

```typescript
function mergeNoidung(common: string | null, own: string | null): string {
  return [common, own].filter(Boolean).join("\n");
}
```

- **F03 — Nội dung bảo dưỡng**: `mergeNoidung(noi_dung_chung, line.noi_dung)`
- **F03 — Lý do bảo dưỡng**: `mergeNoidung(nguyen_nhan_chung, line.nguyen_nhan)`
- **F15 — Khối lượng đã bảo dưỡng**: `mergeNoidung(cac_khac_phuc_chung, line.cac_khac_phuc)` (fallback về noi_dung nếu trống)
- **Ảnh chung** in trước ảnh riêng từng thiết bị trong `PrintImagesPage`

### UX

- Nút ẩn/hiện form nội dung chung; auto-hiện khi load biên bản có dữ liệu chung
- Khi form ẩn, hiện dòng preview tóm tắt + số lượng ảnh chung
- Mỗi dòng thiết bị hiển thị gợi ý "Để trống = dùng nội dung chung" khi có dữ liệu chung
- Ảnh chung dùng màu amber để phân biệt với ảnh riêng (màu slate/orange)

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

| Nhóm          | Điều kiện                              | Dùng cho trường                        |
| ------------- | -------------------------------------- | -------------------------------------- |
| `bgdStaff`    | `chuc_vu` chứa `"giám đốc"`            | BGĐ phụ trách, Giám đốc                |
| `nvStaff`     | `chuc_vu` chứa `"nhân viên"`           | Nhân viên phụ trách, Phụ trách bảo trì |
| `workerStaff` | còn lại (Tổ trưởng, Công nhân, Bảo vệ) | Người thực hiện (chips)                |

```typescript
const bgdStaff = staffList.filter((s) =>
  s.chuc_vu?.toLowerCase().includes("giám đốc"),
);
const nvStaff = staffList.filter((s) =>
  s.chuc_vu?.toLowerCase().includes("nhân viên"),
);
const workerStaff = staffList.filter((s) => {
  const cv = s.chuc_vu?.toLowerCase() || "";
  return !cv.includes("giám đốc") && !cv.includes("nhân viên");
});
```

**Quy tắc loại trừ**: `bgd_phu_trach` và `giam_doc` không được chọn cùng một người — dropdown của field này lọc bỏ giá trị đã chọn ở field kia.

### `maintenance_external_materials` — Vật tư ngoài (master list)

```sql
id            UUID PK
factory_id    UUID
ten_vat_tu    TEXT  -- lưu lâu dài để tái sử dụng
dvt           TEXT
code          TEXT  -- mã vật tư (unique per factory khi không null)
specification TEXT  -- quy cách / đặc tính
category_id   UUID REFERENCES inventory_item_categories  -- nhóm vật tư
is_active     BOOLEAN DEFAULT true
created_at    TIMESTAMPTZ
```

Index: `UNIQUE (factory_id, code) WHERE code IS NOT NULL`

**Lưu ý**: Bảng này dùng làm gợi ý tên vật tư bên ngoài. UI hiện tại không còn dùng `<datalist>` — xem mục Vật tư trong Quy tắc UI.

### `maintenance_records` — Biên bản (document header)

```sql
id                    UUID PK
factory_id            UUID
ma_bb                 TEXT     -- MT-DDMMYY/XXX (auto, read-only sau khi tạo)
hang_muc              TEXT     -- Sửa chữa | Bảo dưỡng
ngay                  DATE
tu_gio                TIME     -- khi tạo mới mặc định giờ hiện tại "HH:mm"
den_gio               TEXT     -- datetime-local "YYYY-MM-DDTHH:mm"; TEXT thay TIME để hỗ trợ sửa nhiều ngày
                               -- khi tạo mới mặc định thời điểm hiện tại; cảnh báo "Giờ kết thúc đang sớm hơn giờ bắt đầu" khi den_gio < tu_gio
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

-- Nội dung chung (Bảo dưỡng nhiều thiết bị) — mirror 3 trường nội dung của từng dòng + ảnh chung
noi_dung_chung        TEXT     -- F03: 1/ Nội dung bảo dưỡng chung
nguyen_nhan_chung     TEXT     -- F03: 2/ Lý do bảo dưỡng chung
cac_khac_phuc_chung   TEXT     -- F15: Khối lượng đã bảo dưỡng chung
image_urls_chung      TEXT[]   -- 6 slot ảnh chung

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
asset_id              UUID → maintenance_assets    -- NULL khi Đội xe dùng dispatch_vehicle_id
dispatch_vehicle_id   UUID → dispatch_vehicles     -- NULL khi không phải Đội xe
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

-- Xe nhỏ (Sửa chữa nhỏ Đội xe — dùng cho F08 và F15SmallVehicle)
km_dong_ho            NUMERIC  -- chỉ số đồng hồ Km/giờ
chat_luong            TEXT     -- "Đạt" | "Không đạt" — lưu bằng radio button, mặc định "Đạt"

-- Ảnh per thiết bị (tối đa 6)
image_urls            TEXT[]
```

Ảnh upload lên bucket `order-files` với path `{factory_id}/maintenance/{timestamp}_{filename}`.  
Upload nhiều file cùng lúc; code tự append vào `image_urls` theo thứ tự, tối đa 6. Click ảnh → xem full. Nút × → xóa từng ảnh.

### `maintenance_materials` — Vật tư per dòng thiết bị

```sql
id                    UUID PK
line_id               UUID → maintenance_record_lines
record_id             UUID → maintenance_records   -- dễ query tổng hợp
factory_id            UUID
nguon                 TEXT    -- trong_kho | ben_ngoai
inventory_item_id     UUID    -- → inventory_items (nullable); lưu cho CẢ trong_kho VÀ ben_ngoai
ten_vat_tu            TEXT    -- snapshot tên tại thời điểm lưu
dvt                   TEXT
so_luong              NUMERIC
don_gia               NUMERIC    -- chỉ ben_ngoai
loai_tien             TEXT       -- chỉ ben_ngoai
thanh_tien            NUMERIC    -- so_luong * don_gia
sort_order            INTEGER
```

**Quan trọng**: `inventory_item_id` được lưu cho cả hai loại nguồn (`trong_kho` và `ben_ngoai`) — không chỉ `trong_kho`. Lý do: vật tư bên ngoài cũng được chọn từ `inventory_items` thông qua `<select>`. `ten_vat_tu` vẫn là snapshot bất biến.

### Quan hệ bảng

```
maintenance_records (1 biên bản)
  └── maintenance_record_lines (N dòng thiết bị)
        └── maintenance_materials (N vật tư per dòng)
```

---

## Mã biên bản

Format: `XX-DDMMYY/XXX` — trong đó `XX` là ký hiệu viết tắt theo **bộ phận**.  
Ví dụ: `DX-110426/001` (Đội xe), `MT-110426/002` (Mủ tạp)

### Bảng ký hiệu bộ phận

| Bộ phận   | Ký hiệu |
| --------- | ------- |
| Mủ tạp    | `MT`    |
| Mủ nước   | `MN`    |
| Đội xe    | `DX`    |
| Nước thải | `NT`    |
| Biomass   | `BO`    |
| Văn phòng | `VP`    |
| Khác      | `K`     |

- Tự sinh khi save lần đầu, read-only sau đó
- Đếm tuần tự **trong ngày + bộ phận** theo `factory_id` (mỗi bộ phận đếm riêng)
- Fallback về `MT` nếu bộ phận không khớp bảng trên
- QR trỏ về URL đầy đủ của trang chi tiết: `{origin}/dashboard/maintenance/records/{uuid}`
- QR hiển thị ở trang chi tiết (góc trên trái) và trong các mẫu in (góc trên phải)

```typescript
const BO_PHAN_PREFIX: Record<string, string> = {
  "Mủ tạp": "MT", "Mủ nước": "MN", "Đội xe": "DX",
  "Nước thải": "NT", "Biomass": "BO", "Văn phòng": "VP", "Khác": "K",
}
// prefix = `${BO_PHAN_PREFIX[boPhan] || "MT"}-${dd}${mm}${yy}`
// like query: `${prefix}/%` để đếm tuần tự theo prefix
```

---

## Quyền chỉnh sửa biên bản

Biên bản `cho_duyet` chỉ được sửa bởi:

- **Người tạo biên bản** (`nguoi_tao` khớp với `full_name` hoặc `username` của user hiện tại), **hoặc**
- **User có quyền `maintenance.approve`**

Biên bản `da_duyet`: read-only với tất cả, **ngoại trừ Admin** (`user.role === "admin"`).  
Biên bản `huy`: read-only hoàn toàn với mọi người.

```typescript
const isAdmin = user?.role === "admin";
const isCreator =
  isNew ||
  (record?.nguoi_tao != null &&
    (record.nguoi_tao === user?.full_name ||
      record.nguoi_tao === user?.username));
const isReadOnly =
  record?.trang_thai === "huy" ||
  (record?.trang_thai === "da_duyet" && !isAdmin) ||
  (!isNew && !isCreator && !isAdmin);
```

**Quy tắc `isAdmin`**: Dùng `user?.role === "admin"` (không dùng permission code riêng). Admin có thể thêm/sửa/xóa vật tư và chỉnh sửa biên bản đã duyệt. Biên bản `huy` là trường hợp duy nhất admin cũng không sửa được.

---

## Workflow phê duyệt

```
Tạo → cho_duyet
  └─ handleSave kiểm tra tồn kho vật tư trong_kho TRƯỚC khi gọi API (chặn nếu không đủ)
Phê duyệt (maintenance.approve) → da_duyet
  └─ handleApprove kiểm tra lại tồn kho (tồn có thể thay đổi giữa lúc save và approve)
  └─ Nếu có vật tư trong_kho:
      → Tạo inventory_documents (loại Xuất kho, status = posted)
      → Ghi sổ inventory stock movements
      → Lưu inventory_issue_doc_id vào maintenance_records
Hủy (maintenance.approve) → huy
```

Sau phê duyệt, biên bản và phiếu xuất kho đều không chỉnh sửa được.

UX: Save / Phê duyệt / Hủy đều **ở lại trang hiện tại** và hiện success toast tự dismiss sau 4 giây.  
Chỉ khi tạo biên bản **mới** mới redirect sang trang chi tiết sau khi save lần đầu.

### Phiếu xuất kho auto-tạo khi phê duyệt

- 1 phiếu duy nhất gom toàn bộ vật tư `trong_kho` của cả biên bản (tất cả lines)
- Ghi chú phiếu xuất: `"Xuất kho cho biên bản sửa chữa/bảo trì số: {ma_bb}"`
- `document_code`: `X-BT-{ma_bb}`
- Kiểm tra tồn kho tại thời điểm phê duyệt, không tại thời điểm tạo biên bản
- Nếu không đủ tồn: hiển thị lỗi, chặn phê duyệt
- Tồn kho lấy từ cột `on_hand` trong bảng `inventory_stock_balances` (không phải `quantity_on_hand`)
- Vật tư `ben_ngoai` **không** tạo phiếu xuất kho (mua ngoài, không qua kho)

**Flow tạo phiếu xuất đúng** (thứ tự bắt buộc):

```
1. getFreshAuthSession() → lấy session.user.id (UUID Auth)
2. Tạo inventory_documents { status: "draft", notes: "Xuất kho cho biên bản...số: {ma_bb}" }
3. Insert inventory_document_lines (item_id, quantity, line_notes = ten_vat_tu)
4. rpc("inventory_post_export_document", { p_factory_id, p_document_id, p_posted_by: session.user.id })
   → phiếu chuyển "posted", on_hand bị trừ, tạo inventory_stock_movements
5. Lưu inventory_issue_doc_id vào maintenance_records
```

**Retry-safe**: Nếu phiếu đã tồn tại (duplicate document_code), reset về draft, xóa dòng cũ, insert lại rồi post lại.

**Hủy phê duyệt** (hoàn tồn kho):

```
1. getFreshAuthSession() → lấy session.user.id
2. rpc("inventory_cancel_document", { p_factory_id, p_document_id: inventory_issue_doc_id,
     p_cancelled_by: session.user.id, p_cancel_reason: "Hủy phê duyệt biên bản {ma_bb}" })
   → phiếu chuyển "cancelled", on_hand hoàn nguyên, stock_movements đảo ngược
3. Cập nhật maintenance_records: trang_thai = "cho_duyet", inventory_issue_doc_id = null
```

**Không** dùng `supabase.from("inventory_documents").update({ status: "cancelled" })` trực tiếp — phải dùng RPC để đảm bảo stock movements được đảo ngược đúng.

---

## Tích hợp Điều xe

- Thiết bị loại `xe` trong `maintenance_assets.loai = 'xe'`
- Xe được seed từ bảng `vehicles` / `dispatch_entries`
- Khi `bo_phan = Đội xe` → asset picker chỉ hiện xe
- Mỗi dòng xe: hiển thị thêm trường `Tên tài xế` (chọn từ danh sách hoặc nhập tay)
- Sau phê duyệt: dữ liệu tự cập nhật vào lý lịch xe (query từ `maintenance_record_lines`)

---

## Lý lịch thiết bị / xe

Bảng tổng hợp lịch sử bảo trì per thiết bị, 5 cột theo mẫu F01:

| Thời gian | Nội dung sửa chữa, thay thế phụ tùng | Giá trị | Người thực hiện | Người theo dõi |
| --------- | ------------------------------------ | ------- | --------------- | -------------- |

- `Người theo dõi` = `nv_phu_trach` của biên bản
- `Giá trị` = `chi_phi_dk` + ký hiệu tiền (`$`, `៛`, `₫`)
- Chỉ hiển thị biên bản `da_duyet`
- Xuất PDF bám mẫu F01 (`KHXD-QT02-F01.docx`)

### UI tab Lý lịch thiết bị (`history/page.tsx`)

**Asset picker multi-select** (giống form tạo biên bản):

- Button trigger hiển thị số lượng thiết bị đã chọn
- Dropdown mở ra gồm: filter Bộ phận (select) + ô tìm kiếm nhanh (input) + danh sách checkbox
- Danh sách checkbox: mỗi item hiện `ma_tb` (monospace) + `ten_tb` + bộ phận + loại (Xe/Máy)
- Thiết bị đã chọn hiển thị dưới dạng chip tags với nút × bỏ chọn riêng lẻ
- Nút "Chọn tất cả (N)" và "Bỏ chọn tất cả" trong dropdown
- Dropdown đóng khi click ngoài (`useRef` + `mousedown` listener)

**Nút "In lý lịch"** luôn hiển thị (không ẩn/hiện điều kiện):

- Chưa chọn thiết bị: xám `bg-slate-200 text-slate-400 cursor-not-allowed`, không navigate
- Đã chọn thiết bị: đen đậm `bg-slate-700 hover:bg-slate-800 text-white`, click mở tab in
- Luôn dùng một element `<Link>` duy nhất, chỉ thay className — **không toggle giữa `<span>` và `<Link>`** (gây mount mới → `bg-slate-700` mất CSS, chỉ thấy khi hover)
- URL khi active: `?type=ly_lich&asset_ids=id1,id2,...&from=...&to=...`
- Label: "In lý lịch (N thiết bị)"
- Mỗi thiết bị được in 1 trang F01 riêng với page break

**Kỹ thuật query**: Do Supabase JS v2 không hỗ trợ `.order("related_table(col)")` cross-table, lịch sử phải dùng two-step query:

1. Query `maintenance_records` với filter/order trước → lấy danh sách `id`
2. Query `maintenance_record_lines` với `.in("record_id", ids)` và `.in("asset_id", selectedAssetIds)` nếu có chọn
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

## In biên bản (8 type)

| `?type=`          | Mẫu in                                | Áp dụng                                                   |
| ----------------- | ------------------------------------- | --------------------------------------------------------- |
| `su_co`           | F13 — Biên bản kiểm tra sự cố         | Sửa chữa + Đội xe + `loai_sua_chua = lon` (nút "Sự cố")   |
| `de_nghi`         | F10 + F15 — Giấy đề nghị + Nghiệm thu | Sửa chữa + Đội xe + `loai_sua_chua = lon` (nút "Đề nghị") |
| `su_co_nho`       | F13 + F10 + F15 + Ảnh gộp 1 PDF       | Sửa chữa **ngoài** Đội xe                                 |
| `bao_duong`       | F03 + F15 + Ảnh                       | Bảo dưỡng **ngoài** Đội xe                                |
| `bao_duong_xe`    | F03 + F15 + F06 + Ảnh                 | Bảo dưỡng + Đội xe                                        |
| `sua_chua_nho_xe` | F08 + F15SmallVehicle + F06 + Ảnh     | Sửa chữa + Đội xe + `loai_sua_chua = nho`                 |
| `ly_lich`         | F01 — Lý lịch máy móc / thiết bị      | Thiết bị **ngoài** Đội xe, từ tab Lý lịch                 |
| `ly_lich_xe`      | F02 — Lý lịch xe máy (3 section)      | Xe Đội xe (`dispatch_vehicles`), từ tab Lý lịch           |

Tất cả dùng chung `print/page.tsx`, phân nhánh theo `type` và `record_id` / `asset_ids` / `vehicle_id` query param.

### Nút in trên trang chi tiết — Sửa chữa + Đội xe (sau khi da_duyet)

| `loai_sua_chua` | Nút hiển thị                                     |
| --------------- | ------------------------------------------------ |
| `nho`           | 1 nút "Sửa chữa nhỏ" → `sua_chua_nho_xe`         |
| `lon`           | 2 nút "Sự cố" → `su_co` và "Đề nghị" → `de_nghi` |
| chưa rõ (null)  | 2 nút "Sự cố" + "Đề nghị" (fallback về `lon`)    |

### F08 — Giấy đề nghị sửa chữa nhỏ thường xuyên (KHXD-QT02-F08)

- Subtitle: "(Áp dụng cho sửa chữa nhỏ, thường xuyên)"
- Fields per line: Xe/Thiết bị, Biển số, **Chỉ số đồng hồ Km/giờ** (`km_dong_ho`), Họ tên lái xe
- Nội dung: 1/ Mức độ hư hỏng (`noi_dung`), 2/ Lý do hư hỏng (`nguyen_nhan`), 3/ Hướng sửa chữa + tạm tính (`cac_khac_phuc`)
- Ký 3 cột: Giám đốc NM | Nhân viên phụ trách | Tài xế

### F15SmallVehicle — Biên bản nghiệm thu sửa chữa nhỏ (KHXD-QT02-F15 variant nhỏ)

- Subtitle: "(Áp dụng cho sửa chữa nhỏ, thường xuyên)"
- Participants: GĐ NM, BGĐ phụ trách, Nhân viên phụ trách, **Đội trưởng đội xe** (`phu_trach_bao_tri`), **Tài xế** (`ten_tai_xe`)
- Section "Chất lượng:" → `chat_luong`
- Ký 4 cột: BGĐ | NV phụ trách | Tài xế | GĐ NM

### F02 — Lý lịch xe máy (KHXD-QT02-F02)

URL: `?type=ly_lich_xe&vehicle_id=<uuid>&from=<date>&to=<date>`

- **Section I**: Lịch sử người vận hành — query từ `dispatch_vehicle_driver_assignments` JOIN `dispatch_drivers`
  - Columns: STT | Họ tên | Từ ngày | Đến ngày | Ghi chú
- **Section II**: Bảo trì-Bảo dưỡng — `maintenance_records` filter `hang_muc = Bảo dưỡng` + `dispatch_vehicle_id`
  - Columns: Ngày | Cấp bảo dưỡng Km/giờ (`km_dong_ho`) | Nội dung | Giá trị | Người thực hiện | Người theo dõi
- **Section III**: Sửa chữa — `maintenance_records` filter `hang_muc = Sửa chữa` + `dispatch_vehicle_id`
  - Columns: Ngày | Chỉ số đồng hồ Km/giờ (`km_dong_ho`) | Nội dung | Giá trị | Người thực hiện | Người theo dõi
- Ký 4 cột: Người lập | Tài xế | BGĐ phụ trách | GĐ NM
- Footer: `KHXD-QT02-F02 (01-15/05/2026)`

**Trang in bypass sidebar**: `dashboard/layout.tsx` kiểm tra `pathname.includes("/print")` và render `{children}` trực tiếp, không có sidebar.

### Nút in trên trang chi tiết biên bản

Logic điều kiện hiển thị nút in (`records/[id]/page.tsx`):

| `hang_muc` | `bo_phan`    | Khi `da_duyet`                                 | Khi chưa duyệt |
| ---------- | ------------ | ---------------------------------------------- | -------------- |
| Sửa chữa   | ngoài Đội xe | 1 nút "In biên bản" → `su_co_nho`              | 1 nút disabled |
| Sửa chữa   | Đội xe       | 2 nút "Sự cố" + "Đề nghị" → `su_co`, `de_nghi` | 2 nút disabled |
| Bảo dưỡng  | ngoài Đội xe | 1 nút "In biên bản" → `bao_duong`              | 1 nút disabled |
| Bảo dưỡng  | Đội xe       | 1 nút "In biên bản" → `bao_duong_xe`           | 1 nút disabled |

Nút in clickable (`<Link>`) khi `trang_thai === "da_duyet"`; trạng thái khác là `<span>` cursor-not-allowed có tooltip.

### Cấu trúc mẫu in

**F13 (`PrintSuCo`)** — Biên bản kiểm tra sự cố (KHXD-QT02-F13):

- Header: Tên NM (12px, màu #000000) + Bộ phận | QR code góc trên phải; tiêu đề 13pt
- "Hôm nay vào lúc ... giờ, ngày ... tháng ... năm ..."
- "Chúng tôi gồm:" — thứ tự cố định từ lớn đến nhỏ:
  1. `giam_doc` → chức vụ từ `staffMap` hoặc "Giám đốc nhà máy"
  2. `bgd_phu_trach` → chức vụ từ `staffMap` hoặc "BGĐ phụ trách"
  3. `nv_phu_trach` (nếu có) → chức vụ từ `staffMap` hoặc "Nhân viên phụ trách"
  4. `phu_trach_bao_tri` (nếu có) → chức vụ từ `staffMap` hoặc "Phụ trách bảo trì"
  5. **Tổ trưởng cơ điện từ `nguoi_thuc_hien`** (nếu có): lọc `staffMap.get(name)` chứa "tổ trưởng" **VÀ** "cơ điện" → thêm người thật vào cuối danh sách với tên và chức vụ thật
  - Nếu cả 3, 4 đều trống **VÀ** không tìm được Tổ trưởng cơ điện từ `nguoi_thuc_hien` → thêm placeholder `"................................."` – Tổ trưởng cơ điện
  - **Không** thêm `nguoi_tao`, **Không** thêm `nguoi_thuc_hien` (trừ Tổ trưởng cơ điện như trên)
  - Placeholder name="" hiển thị dòng gạch để ký tay

```typescript
const toTruongCoDien = record.nguoi_thuc_hien.filter((name) => {
  const role = staffMap.get(name)?.toLowerCase() || "";
  return role.includes("tổ trưởng") && role.includes("cơ điện");
});
const participants: { name: string; role: string }[] = [];
if (record.giam_doc)
  participants.push({
    name: record.giam_doc,
    role: staffMap.get(record.giam_doc) || "Giám đốc nhà máy",
  });
if (record.bgd_phu_trach)
  participants.push({
    name: record.bgd_phu_trach,
    role: staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách",
  });
if (record.nv_phu_trach)
  participants.push({
    name: record.nv_phu_trach,
    role: staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách",
  });
if (record.phu_trach_bao_tri)
  participants.push({
    name: record.phu_trach_bao_tri,
    role: staffMap.get(record.phu_trach_bao_tri) || "Phụ trách bảo trì",
  });
for (const name of toTruongCoDien) {
  participants.push({ name, role: staffMap.get(name) || "Tổ trưởng cơ điện" });
}
if (
  !record.nv_phu_trach &&
  !record.phu_trach_bao_tri &&
  toTruongCoDien.length === 0
)
  participants.push({ name: "", role: "Tổ trưởng cơ điện" });
```

- Per thiết bị: Tên máy, số hiệu, Tình trạng sự cố, Nguyên nhân, Cách khắc phục, vật tư
  - Nội dung sau dấu hai chấm viết liền trên **cùng dòng** với label: "Tình trạng sự cố: [nội dung]"
  - Nếu trống: label hiện trước, blank lines bên dưới để ký tay
  - **Không hiển thị chi phí ước tính** trong F13 (chi phí thuộc F10)
  - **"Vật tư sử dụng:"** và trạng thái nằm trên **cùng 1 dòng**:
    - Có vật tư → hiện `MaterialsTable` ngay bên dưới label
    - Không có → `<span className="italic">Không có</span>` inline ngay sau label
- **"Kết luận và những kiến nghị..."**: label + nội dung viết **inline cùng dòng**:
  - Có `ghi_chu` → in nội dung liền sau label
  - Trống → `<BlankLine count={3} />` bên dưới label
- Ký tên 4 cột: BGĐ phụ trách | Nhân viên kỹ thuật | Tổ cơ điện | Giám đốc nhà máy
- Footer: `KHXD-QT02-F13 (01-15/05/2026)`

**Kỹ thuật `staffMap` (dùng cho F13, F15, F15BaoDuong)**:

- Sau khi load record, fetch `maintenance_staff` theo `factory_id` của record
- Build `Map<string, string>` với key = `ten`, value = `chuc_vu`
- Truyền vào `PrintSuCo`, `PrintF15`, `PrintF15BaoDuong` qua prop `staffMap`
- Wrappers `PrintDeNghi`, `PrintSuCoNho`, `PrintBaoDuong`, `PrintBaoDuongXe` nhận và truyền tiếp `staffMap` xuống
- **Dùng để tra chức vụ**: `staffMap.get(name)` → tên chức vụ thật; fallback là label mặc định theo vai trò
- **Lọc Tổ trưởng cơ điện**: `staffMap.get(name)?.toLowerCase()` chứa `"tổ trưởng"` **VÀ** `"cơ điện"` → người thật; không phụ thuộc string so sánh cứng

**F10 (`PrintF10`)** — Giấy đề nghị sửa chữa (KHXD-QT02-F10):

- "Kampong Thom, ngày ... tháng ... năm ..." (căn phải)
- "Kính gửi: Giám đốc Nhà máy..."
- Đề nghị cho sửa chữa: tên máy, đính kèm biên bản số
- Thời gian, người thực hiện, bảng nội dung thay thế
- Vật tư: dòng label **"Vật tư thay thế:"** + nội dung trên **cùng 1 dòng**:
  - Nếu có vật tư → hiện `MaterialsTable` ngay bên dưới label
  - Nếu không có → `<span className="italic text-slate-500">Không có</span>` inline ngay sau label
  - **Không** dùng bảng rỗng 3 hàng, **không** để "Không có" xuống dòng riêng
- Ký tên 3 cột: Giám đốc nhà máy | NV kỹ thuật | BGĐ phụ trách
- Footer: `KHXD-QT02-F10 (01-15/05/2026)`

**F15 (`PrintF15`)** — Biên bản nghiệm thu (KHXD-QT02-F15):

- "Xe/máy/thiết bị: ... Biển số/số hiệu: ..."
- "Căn cứ: Giấy đề nghị sửa chữa số ..."
- "Hôm nay, ngày ... Tại ..."
- "Chúng tôi gồm:" — thứ tự giống F13 (format "Ông: [Tên] – [Chức vụ]"):
  1. `giam_doc` → staffMap hoặc "Giám đốc Nhà máy"
  2. `bgd_phu_trach` → staffMap hoặc "BGĐ phụ trách"
  3. `nv_phu_trach` (nếu có) → staffMap hoặc "Nhân viên phụ trách"
  4. `phu_trach_bao_tri` (nếu có) → staffMap hoặc "Phụ trách bảo trì"
  - Nếu cả 3 và 4 đều trống → thêm dòng `Ông: "................................." – Tổ trưởng cơ điện`
  - **Không** hiển thị `nguoi_thuc_hien` trong F15
- **"Khối lượng đã sửa chữa, thay thế phụ tùng:"** viết **inline** cùng dòng với nội dung (`cac_khac_phuc` hoặc `noi_dung`):
  - 1 thiết bị: `<span>Khối lượng đã sửa chữa...: </span>[nội dung]` trên cùng 1 dòng
  - Nhiều thiết bị: mỗi device có số thứ tự + tên, rồi label + nội dung inline bên dưới
  - Bảng vật tư (nếu có) hiện bên dưới từng device (không hiện Đơn giá / Nguồn)
- Checkbox ☐ Đạt yêu cầu / ☐ Không đạt
- Giá trị sửa chữa
- **Kết luận**: 2 dòng kẻ, mỗi dòng cao `2rem` (1.5x line-height chuẩn) với `border-bottom` nhạt để ký tay
- Ký tên **3 cột** (đã bỏ "Người nghiệm thu"): BGĐ phụ trách | Nhân viên phụ trách | Giám đốc nhà máy
- Footer: `KHXD-QT02-F15 (01-15/05/2026)`

**F03 (`PrintF03`)** — Giấy đề nghị bảo trì - sửa chữa (KHXD-QT02-F03):

- Dùng cho **cả 2 type bảo dưỡng** (`bao_duong` và `bao_duong_xe`)
- "Kampong Thom, ngày ... tháng ... năm ..." (căn phải)
- Tiêu đề: "GIẤY ĐỀ NGHỊ BẢO TRÌ - SỬA CHỮA" (13pt, uppercase, căn giữa)
- Dòng Mã thiết bị + Tên thiết bị per line
- "Kính gửi: Giám đốc nhà máy chế biến."
- "Kính đề nghị giám đốc nhà máy cho bảo dưỡng xe, máy móc, thiết bị như sau:"
- Per thiết bị (đánh số nếu nhiều):
  - "1/ Nội dung bảo dưỡng:" + `line.noi_dung` hoặc `BlankLine(3)` nếu trống
  - "2/ Lý do bảo dưỡng:" + `line.nguyen_nhan` hoặc `BlankLine(3)` nếu trống
- Ký tên 4 cột: BGĐ phụ trách | Nhân viên phụ trách | Giám đốc nhà máy | Tổ cơ điện
- Footer: `KHXD-QT02-F03 (01-15/05/2026)`

**F15BaoDuong (`PrintF15BaoDuong`)** — Biên bản nghiệm thu cho Bảo dưỡng (KHXD-QT02-F15):

- Dùng thay cho `PrintF15` trong 2 type bảo dưỡng; **không dùng cho Sửa chữa**
- Sub-title: "(Áp dụng cho bảo dưỡng định kỳ)"
- Căn cứ: Giấy đề nghị bảo trì số …
- "Chúng tôi gồm:" — participants theo bộ phận:
  - **Non-Đội xe**: giam_doc → bgd_phu_trach → nv_phu_trach (→ placeholder tổ trưởng nếu thiếu cả nv/phu_trach_bao_tri)
  - **Đội xe**: giam_doc → bgd_phu_trach → nv_phu_trach → ten_tai_xe của dòng đầu tiên (vai trò "Lái xe")
- Label: "Khối lượng **đã bảo dưỡng**, thay thế phụ tùng:" (khác F15 sửa chữa)
- Ký tên:
  - Non-Đội xe: 3 cột — BGĐ phụ trách | Nhân viên phụ trách | Giám đốc nhà máy
  - Đội xe: 4 cột — BGĐ phụ trách | Nhân viên phụ trách | Tài xế | Giám đốc nhà máy
- Footer: `KHXD-QT02-F15 (01-15/05/2026)`

**F06 (`PrintF06`)** — Phiếu hoàn thành công việc bảo trì (KHXD-QT02-F06):

- Chỉ dùng cho type `bao_duong_xe` (Bảo dưỡng Đội xe)
- Sub-title: "(Áp dụng cho xe ôtô vận chuyển mủ)"
- Biển số / Tên lái xe per dòng xe
- Căn cứ giấy đề nghị bảo trì số {ma_bb}
- "Kết quả bảo dưỡng bao gồm:" — bảng per dòng xe: STT | Hạng mục | ĐVT | Số lượng | Thành tiền | Ghi chú
  - Hàng 1: Nhiên liệu bảo dưỡng (`line.nhien_lieu_su_dung`, `dvt_do`, `so_luong_do`)
  - Hàng 2..N: Phụ tùng thay thế (từng `line.materials[]`)
  - Hàng cuối trước cộng: Công thợ (`line.cong_tho`)
  - Hàng Cộng: tổng thành tiền tất cả dòng
- Ký tên 4 cột: BGĐ phụ trách | Nhân viên phụ trách | Tài xế | Giám đốc nhà máy
- Footer: `KHXD-QT02-F06 (01-15/05/2026)`

**F01 (`PrintLyLich`)** — Lý lịch máy móc / thiết bị (KHXD-QT02-F01):

- **Section I**: Thông tin thiết bị (Tên, Mã, Bộ phận, Năm sử dụng, Biển số nếu là xe)
- **Section II**: "BẢO TRÌ, SỬA CHỮA, THAY THẾ PHỤ TÙNG" — bảng 6 cột: STT | Thời gian | Nội dung | Giá trị | Người thực hiện | Người theo dõi
- Ký tên 4 cột: Người lập | Tổ cơ điện | BGĐ phụ trách | Giám đốc nhà máy
- Footer: `KHXD-QT02-F01 (01-15/05/2026)`

**Component `DocumentFooter`**: render ở cuối mỗi mẫu in — mã tài liệu + ngày ban hành dạng `(01-15/05/2026)`, canh trái, viền trên mỏng. **Không** hiển thị "Lần ban hành: 01" riêng bên phải.

**Cấu trúc `SignatureRow`**: Chức vụ → khoảng trắng `h-16` (≈2.5 cm để ký tay) → Tên → "(Ký và ghi rõ họ tên)". **Không có đường kẻ ngang** giữa khoảng ký và tên (`border-t` đã bỏ).

**`CompanyHeader`**: font `12px`, màu `#000000`, không có `tracking-wide`. Tên công ty in đậm uppercase, dòng bộ phận bên dưới cùng cỡ chữ.

**Typography toàn mẫu**:

- Body text: `font-size: 12pt` (CSS `@page`), `leading-5`, `space-y-0.5`
- Tiêu đề h2: `font-size: 13pt` (inline style)
- Khoảng cách giữa section: `mt-2` (giảm từ `mt-4`)

**Divider giữa các mẫu** (PrintSuCoNho, PrintDeNghi): chỉ dùng `page-break-before-always` + margin, **không** có `border-t-2 border-dashed`.

### Print URL params

| Param        | Mô tả                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `type`       | `su_co` \| `de_nghi` \| `su_co_nho` \| `bao_duong` \| `bao_duong_xe` \| `sua_chua_nho_xe` \| `ly_lich` \| `ly_lich_xe` |
| `record_id`  | UUID biên bản (dùng cho su_co / de_nghi / su_co_nho / bao_duong / bao_duong_xe / sua_chua_nho_xe)                      |
| `asset_id`   | UUID 1 thiết bị (ly_lich đơn)                                                                                          |
| `asset_ids`  | Danh sách UUID cách nhau dấu phẩy — **multi-device ly_lich**                                                           |
| `vehicle_id` | UUID xe từ `dispatch_vehicles` (ly_lich_xe)                                                                            |
| `from`       | Ngày bắt đầu lọc (ly_lich / ly_lich_xe)                                                                                |
| `to`         | Ngày kết thúc lọc (ly_lich / ly_lich_xe)                                                                               |

Multi-device ly_lich: `?type=ly_lich&asset_ids=uuid1,uuid2,uuid3&from=...&to=...` → mỗi thiết bị 1 trang F01, ngăn cách bằng `page-break-before-always`.

Xe ly_lich_xe: `?type=ly_lich_xe&vehicle_id=uuid&from=...&to=...` → 1 trang F02 per xe.

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

Tab `Bảo trì` trong `/dashboard/settings` có 4 sub-tab:

- `Thiết bị`: CRUD `maintenance_assets` (filter theo bộ phận, phân loại máy móc/xe)
- `Nhân sự bảo trì`: CRUD `maintenance_staff`
- `Xe & Tài xế`: CRUD `dispatch_vehicles` + `dispatch_vehicle_driver_assignments` — chuyển từ tab "Cấu hình nhà máy" (2026-05), dữ liệu và logic không thay đổi
- `Vật tư ngoài`: CRUD `maintenance_external_materials` — fields: mã (`code`), tên, ĐVT, quy cách (`specification`), nhóm vật tư (`category_id` → `inventory_item_categories`), trạng thái (`is_active`)

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
  print/page.tsx             -- In biên bản (6 type: su_co/de_nghi/su_co_nho/bao_duong/bao_duong_xe/ly_lich), không có sidebar
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
- **Không dùng `overflow-hidden` trên wrapper của dòng thiết bị** — để dropdown vật tư (`position: absolute, bottom-full`) có thể nổi lên phía trên mà không bị cắt; thay bằng `rounded-t-xl` trực tiếp trên header

#### Ảnh hiện trường per dòng (tối đa 6)

- Hiển thị dạng thumbnail nhỏ (`w-14 h-14`, object-cover) + nút × góc trên phải để xóa từng ảnh
- Nút **"Thêm ảnh"** (màu cam) cho phép chọn **nhiều file cùng lúc** (`<input multiple>`)
- Code tự động phân bổ: các URL được append vào `image_urls` theo thứ tự upload, tối đa 6
- Nút "Thêm ảnh" ẩn khi đã đủ 6 ảnh
- Upload qua shared hidden `<input type="file" multiple>` + `activeSlotRef` (chỉ track `lineId`, không track số slot)
- State upload: `uploadingSlot: string | null` (lineId của dòng đang upload)
- Ảnh upload lên bucket `order-files` với path `{factory_id}/maintenance/{timestamp}_{filename}`

**Rule in ảnh (`PrintImagesPage`)**: ảnh in theo `grid-cols-2` (không dùng `grid-cols-3`) để ảnh lớn hơn ~50%.

### Vật tư

- **Cả hai loại** `trong_kho` và `ben_ngoai` đều chọn từ **`inventory_items`** — không dùng `maintenance_external_materials` cho dropdown
- Dropdown chọn vật tư là **custom dropdown** (không phải `<select>` native) gồm:
  - Trigger button hiển thị tên vật tư đã chọn hoặc "— Chọn vật tư —"
  - Panel nổi (`z-50`, `shadow-2xl`) gồm ô tìm kiếm nhanh phía trên + danh sách scroll bên dưới (`max-h-72`, ~10 dòng)
  - Ô tìm kiếm nằm **bên trong dropdown**, không phải trường riêng ngoài form
  - Lọc theo mã hoặc tên vật tư; kết hợp với bộ lọc **Nhóm** (native `<select>`) phía trước
  - Click ngoài dropdown → đóng (dùng `pointerdown` document listener + `matDropdownRef`)
  - State: `activeMaterialDropdown: string | null` (mat.id đang mở)
- Hiển thị khác nhau theo nguồn:
  - `trong_kho`: hiện "Tồn: X" ở bên phải mỗi item trong dropdown
  - `ben_ngoai`: không hiện tồn
- `inventory_item_id` được lưu cho **cả** `trong_kho` và `ben_ngoai` — payload save không phân biệt loại nguồn
- Tồn kho lấy từ `inventory_stock_balances.on_hand` (không phải `quantity_on_hand`)
- **Cảnh báo inline**: Khi `so_luong > currentStock`, ô nhập chuyển viền đỏ và hiện text đỏ bên dưới: `"Vượt (X)"`
- **Chặn SAVE**: `handleSave` validate toàn bộ vật tư `trong_kho` trước khi gọi API; nếu có vật tư vượt tồn → hiện `saveError` đa dòng liệt kê từng vi phạm, không gọi Supabase
- **Chặn phê duyệt**: `handleApprove` validate lại lần nữa (tồn kho có thể thay đổi giữa lúc save và approve); hiện `saveError` và return sớm nếu bất kỳ vật tư nào vượt tồn
- Dropdown vật tư mở **lên trên** (`bottom-full mb-1`) — không dùng `top-full`; bắt buộc vì wrapper dòng thiết bị không có `overflow-hidden`
- `ben_ngoai` vẫn có trường Đơn giá và Loại tiền; `trong_kho` chỉ có Số lượng (không có Đơn giá)
- Mỗi loại có nút **"+ Thêm mới"** mở modal tạo vật tư mới trực tiếp vào `inventory_items`; sau khi lưu tự động chọn vào dòng và đóng modal

#### Chiều rộng các trường vật tư

| Trường     | Chiều rộng  | Ghi chú                        |
| ---------- | ----------- | ------------------------------ |
| Nguồn      | `w-[88px]`  |                                |
| Nhóm       | `w-[180px]` | native `<select>`              |
| Tìm/Chọn  | `flex-1`    | custom dropdown, min `180px`   |
| ĐVT        | `w-[42px]`  |                                |
| Số lượng   | `w-[50px]`  |                                |
| Đơn giá    | `w-[72px]`  | chỉ `ben_ngoai`                |
| Tiền tệ    | `w-[74px]`  | chỉ `ben_ngoai`                |

Font tất cả labels và inputs vật tư: `text-xs` (không dùng `text-[10px]`).

### Nhiên liệu sử dụng (Đội xe only)

- Trường `nhien_lieu_su_dung` hiển thị `<select>` load từ `inventory_items` thuộc nhóm danh mục có tên chứa `"nhiên liệu"` (so sánh case-insensitive)
- Khi chọn từ dropdown: `dvt_do` tự điền theo `unit` của item đã chọn và bị disabled (không chỉnh tay)
- Nút **"+ Nhập tên khác"** (styled border, hover cam) cho phép nhập text tự do; khi ở mode nhập tay nút đổi thành "← Chọn danh sách" để quay lại
- Khi load biên bản cũ: nếu `nhien_lieu_su_dung` không khớp với tên bất kỳ item nào trong danh sách → tự chuyển sang mode nhập tay (`fuelManualModes[lineId] = true`)
- Khi ở mode nhập tay: `dvt_do` có thể nhập tay; không ảnh hưởng tồn kho (chỉ lưu tên để đồng bộ tên gọi)

### Chất lượng sau sửa chữa (Đội xe — Sửa chữa only)

- Trường `chat_luong` dùng 2 radio button inline: **"Đạt"** và **"Không đạt"**
- Mặc định "Đạt" khi tạo mới (emptyLine/emptyLineFromVehicle khởi tạo `chat_luong = "Đạt"`)
- Logic `checked`: `line.chat_luong !== "Không đạt"` → Đạt; `line.chat_luong === "Không đạt"` → Không đạt
- Màu emerald cho "Đạt", màu đỏ cho "Không đạt"

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
