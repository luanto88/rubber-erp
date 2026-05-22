# Module Sản lượng (Production Output)

## Phạm vi

Module quản lý sản lượng mủ cao su nhập về theo xe / chuyến / đội / ngày.

- Route: `/dashboard/output`
- Permission: `output.view`, `output.create`, `output.edit`, `output.delete`, `output.import`
- Dữ liệu nguồn: bảng `production_records`
- Liên kết: `dispatch_entries` (điều xe), `dispatch_delivery_points` (điểm giao nhận → đội)

---

## Schema bảng `production_records`

```sql
id               UUID PK
factory_id       UUID → factories
ngay             DATE
doi              INTEGER (1–12)
so_xe            TEXT    -- mã xe cơ sở đã normalize, e.g. "1A"
chuyen           INTEGER -- số chuyến (≥ 1)
tai_xe           TEXT    -- snapshot tên tài xế từ dispatch

-- Khối lượng theo loại mủ (mỗi loại: tuoi, drc, kho)
mn_tuoi/mn_drc/mn_kho       -- Mủ nước
ct_tuoi/ct_drc/ct_kho       -- Mủ chén
dct_tuoi/dct_drc/dct_kho    -- Mủ đông chén
dkt_tuoi/dkt_drc/dkt_kho    -- Mủ đông khối
dt_tuoi/dt_drc/dt_kho       -- Mủ dây

dispatch_entry_id  UUID → dispatch_entries (nullable)
warn_codes         TEXT[]  -- mảng mã cảnh báo
import_batch_id    UUID    -- nhóm import cùng file
ghi_chu            TEXT
created_by         UUID → auth.users
created_at, updated_at TIMESTAMPTZ

UNIQUE (factory_id, ngay, so_xe, chuyen, doi)
```

**Quan trọng**: Unique constraint gồm cả `doi` — một xe có thể chở 2 đội trong cùng 1 chuyến (cân 2 lần), tạo 2 bản ghi riêng với `doi` khác nhau.

---

## Quy tắc nghiệp vụ

### Mã xe và chuyến

File Excel mã hóa chuyến trong cột Số xe:
- `1A` = xe 1A chuyến 1
- `1A2` = xe 1A chuyến 2
- `1A3` = xe 1A chuyến 3
- `01A` hoặc `01A2` = normalize về `1A` / `1A2` (bỏ số 0 đầu)

Hàm parse chuẩn: `parseVehicleCode(raw)` trong `output-types.ts`:
```typescript
function parseVehicleCode(raw: string): { base_xe: string; chuyen: number } {
  const s = raw.trim().toUpperCase().replace(/^0+(\d)/, "$1")
  const m = s.match(/^(\d+[A-Z]+)(\d+)?$/)
  if (!m) return { base_xe: s, chuyen: 1 }
  return { base_xe: m[1], chuyen: m[2] ? parseInt(m[2]) : 1 }
}
```

### Đội (doi) và điểm giao nhận

- Trong file Excel: cột B là số nguyên 1–12 (số đội)
- Trong `dispatch_entries.rows[].diem_gn`: mảng mã điểm giao nhận như "E1", "G3"
- Trong `dispatch_delivery_points`: mỗi điểm có trường `doi` (số đội tương ứng)
- **DOI_MISMATCH**: khi `doi` trong file ≠ `doi` của bất kỳ điểm giao nhận nào trong dispatch của xe đó

### KL khô tự tính

Nếu cột Khô = 0 nhưng Tươi và DRC% có giá trị → tự tính: `kho = tuoi * drc / 100`

---

## Mã cảnh báo (warn_codes)

| Code | Mô tả | Màu |
|------|-------|-----|
| `NO_DISPATCH_DATE` | Không có bảng điều xe ngày này | Đỏ |
| `VEHICLE_NOT_FOUND` | Xe không có trong điều xe | Đỏ |
| `CHUYEN_NOT_FOUND` | Xe có trong điều xe nhưng không có chuyến này | Cam |
| `DOI_MISMATCH` | Đội trong file ≠ đội của điểm giao nhận trong dispatch | Cam |
| `ZERO_KL` | Tất cả khối lượng = 0 | Xám |
| `DUPLICATE_IN_FILE` | Trùng xe+chuyến+đội trong cùng file | Cam |

Bản ghi có cảnh báo vẫn được lưu — `warn_codes` là metadata để review sau, không chặn import.

---

## Import file Excel (sl_mau.xlsx)

### Cấu trúc file (18 cột A–R, bỏ 2 dòng header)

| Cột | Nội dung |
|-----|---------|
| A | Ngày (Excel serial date) |
| B | Đội (1–12) |
| C | Số xe (1A, 1A2, 1A3...) |
| D–F | Mủ nước: Tươi / DRC% / Khô |
| G–I | Mủ chén: Tươi / DRC% / Khô |
| J–L | Mủ đông chén: Tươi / DRC% / Khô |
| M–O | Mủ đông khối: Tươi / DRC% / Khô |
| P–R | Mủ dây: Tươi / DRC% / Khô |

### Matching algorithm

1. Build `dispatchIndex: Map<"YYYY-MM-DD", Map<"baseXe:chuyen", { entryId, tai_xe, diem_gn[] }>>` từ `dispatch_entries`
2. Build `doiByMaLo: Map<ma_lo, doi>` từ `dispatch_delivery_points`
3. Với mỗi dòng Excel: lookup dispatch → assign `dispatch_entry_id`, `tai_xe`, `warn_codes`
4. Duplicate detection: key = `ngay:base_xe:chuyen:doi`

### Upsert

```typescript
supabase.from("production_records").upsert(rows, {
  onConflict: "factory_id,ngay,so_xe,chuyen,doi"
})
```

Upsert idempotent — upload cùng file 2 lần không tạo duplicate.

---

## Form thêm mới thủ công

- Chọn ngày → form tự fetch `dispatch_entries` cho ngày đó (xử lý cả format "YYYY-MM-DD" và "dd/mm/yyyy")
- Dropdown **Số xe** chỉ hiển thị xe từ điều xe của ngày đã chọn; fallback sang `dispatch_vehicles` nếu không có điều xe
- **Tài xế** tự điền từ dispatch khi chọn xe + chuyến (readonly, override được)
- **Chuyến**: select nếu xe có nhiều chuyến trong dispatch; text input nếu 1 chuyến
- **Banner tiến độ**: hiển thị ngay sau phần ngày/đội
  - Amber + cảnh báo: còn xe chưa nhập
  - Emerald: tất cả xe từ điều xe đã nhập
  - Slate: không có điều xe ngày đó

Banner đếm đúng theo dispatch: so sánh `dispatch_entries.rows` với `production_records` ngày đó theo key `so_xe:chuyen`.

---

## Cấu trúc file

```
src/app/dashboard/output/
  page.tsx                     -- Main: 3 tab (Danh sách / Thống kê / Hướng dẫn import)
  _components/
    output-types.ts            -- Types, parseVehicleCode, warn codes, helpers
    output-import.tsx          -- Upload → Preview → Confirm (3 bước)
    output-form.tsx            -- Modal thêm/sửa thủ công

supabase/migrations/
  20260521_production_records.sql   -- Tạo bảng + RLS
  20260521_production_permissions.sql -- Permissions (output.*)
  20260522_fix_production_records_unique.sql -- Fix unique thêm doi
```

---

## Ghi ngược sản lượng vào phiếu điều xe (Write-back)

Sau khi import Excel hoặc lưu / xóa thủ công, hệ thống tự động tổng hợp sản lượng từ `production_records` và ghi ngược vào các trường KL của `dispatch_entries.rows[]`.

### Hàm `writeBackToDispatch`

```typescript
// output-types.ts
export async function writeBackToDispatch(
  factoryId: string,
  ngay: string,            // ISO "YYYY-MM-DD"
  supabase: SupabaseClient
): Promise<void>
```

**Luồng xử lý:**

1. Fetch toàn bộ `production_records` cho `(factory_id, ngay)`
2. Group theo `(so_xe, chuyen)`, **cộng gộp KL qua tất cả `doi`**
   - Ví dụ: xe 2A ch1 đi đội E1 (2350 kg) + đội J7 (1350 kg) → tổng 3700 kg ghi vào 1 dòng dispatch
3. Fetch `dispatch_entries` cho ngày đó — dùng `.or()` để match cả 2 format ngày
4. Với mỗi `dispatch_entries.rows[]`:
   - Normalize `row.so_xe` qua `parseVehicleCode()` để lấy `base_xe`
   - Lookup group `"${base_xe}:${chuyen}"` → nếu có, ghi các trường KL; nếu không có, giữ nguyên dòng
5. Chỉ `UPDATE` nếu có ít nhất 1 dòng thay đổi (`changed = true`)

### Mapping trường

| `production_records` (tổng) | `dispatch_entries.rows[]` |
|---|---|
| `mn_tuoi` | `kl_mn` |
| `mn_kho` | `kl_mnk` |
| `(mn_kho/mn_tuoi*100)` | `drc_mn` |
| `ct_tuoi` | `kl_ct` |
| `ct_kho` | `kl_ck` |
| `(ct_kho/ct_tuoi*100)` | `drc_c` |
| `dct_tuoi` | `kl_dct` |
| `dct_kho` | `kl_dck` |
| `(dct_kho/dct_tuoi*100)` | `drc_dc` |
| `dkt_tuoi` | `kl_dkt` |
| `dkt_kho` | `kl_dkk` |
| `(dkt_kho/dkt_tuoi*100)` | `drc_dk` |
| `dt_tuoi` | `kl_dt` |
| `dt_kho` | `kl_dk` |
| `(dt_kho/dt_tuoi*100)` | `drc_d` |

Tất cả giá trị ghi vào dispatch dưới dạng **string** (dispatch lưu KL là string). DRC% tính theo `sum_kho / sum_tuoi * 100`; nếu `sum_tuoi = 0` thì ghi `"0"`.

### Khi nào trigger

| Sự kiện | Nơi gọi |
|---|---|
| Import Excel confirm | `output-import.tsx` — sau upsert thành công; gọi cho tất cả ngày unique trong batch |
| Lưu thủ công (thêm/sửa) | `page.tsx handleSave` — gọi cho `form.ngay` |
| Xóa bản ghi | `page.tsx handleDelete` — lấy `ngay` từ record trước khi xóa, gọi sau khi xóa xong |

**Quan trọng**: Khi xóa, hệ thống re-aggregate từ các records còn lại. Nếu không còn record nào cho xe đó → group trống → dòng dispatch **không bị reset** (giữ nguyên giá trị cũ). Chỉ các dòng có group mới bị ghi đè.

### Pattern gọi

```typescript
// Fire-and-forget — lỗi không chặn UI
void writeBackToDispatch(factoryId, ngay, supabase)

// Import: nhiều ngày song song
void Promise.all(
  uniqueNgays.map(ngay => writeBackToDispatch(factoryId, ngay, supabase).catch(() => {}))
)
```

---

## Thống kê

- KPI cards: tổng KL tươi, tổng KL khô, số bản ghi, số cảnh báo
- Biểu đồ bar: KL khô theo đội (1–12)
- Bảng pivot: xe + tài xế + chuyến × KL tươi / KL khô
- Bộ lọc: từ ngày / đến ngày / đội / mã xe / chỉ hiển thị cảnh báo

---

## Quy tắc quan trọng

- Mọi query phải filter `factory_id`
- `warn_codes` là thông tin tham khảo — không chặn nghiệp vụ
- Unique key phải luôn gồm `doi` — KHÔNG dùng `(factory_id, ngay, so_xe, chuyen)` cũ
- Upsert `onConflict` phải khớp với unique constraint: `"factory_id,ngay,so_xe,chuyen,doi"`
- `WarnBadge` hiển thị `WARN_LABELS[code]` (tiếng Việt), không phải `code.replace(/_/g, " ")`
- Dispatch `ngay` có thể là "YYYY-MM-DD" hoặc "dd/mm/yyyy" — query phải dùng `.or()` để match cả 2
