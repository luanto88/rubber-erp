---
description: Module Quản lý kho thành phẩm — sơ đồ kho theo ô/khung, drag-and-drop kiện và lô, filter highlight, tích hợp Thành phẩm và Xuất hàng
---

# Module Quản lý Kho Thành Phẩm

## Phạm vi

Module theo dõi vị trí vật lý từng **kiện** (A/B/C/D) của lô thành phẩm trong kho theo sơ đồ thực tế.

- Route: `/dashboard/warehouse`
- Permission: `warehouse.view`, `warehouse.manage`
- Tất cả bảng có `factory_id`, mọi query filter theo `factory_id`

---

## Hai kho

| Kho | Tên | Dây chuyền phù hợp |
|-----|-----|-------------------|
| `kho1` | KHO 1 — Mủ tạp | Mủ tạp |
| `kho2` | KHO 2 — Mủ nước | Mủ nước |

Hệ thống **cảnh báo** khi kéo lô sai kho nhưng **không chặn cứng**.

---

## Schema

### `warehouse_slots` — master data vị trí kho (v2)

```sql
id, factory_id, warehouse_code, 
slot_code TEXT,      -- "1A-R1C1" (frame-row-col)
frame_code TEXT,     -- "1A" — khung chứa ô này
row_label TEXT,      -- 'A' | 'B'
col_number INTEGER,  -- frame number (1-21)
frame_row INTEGER,   -- hàng trong khung: 1=phía trước (gần lối đi)
frame_col INTEGER,   -- cột trong khung: 1=trái, 2=phải
is_restricted BOOLEAN,
max_stack INTEGER DEFAULT 3,
is_active BOOLEAN, sort_order
UNIQUE(factory_id, warehouse_code, slot_code)
```

### `warehouse_lot_placements` — kiện đang ở đâu

```sql
id, factory_id, warehouse_code, slot_code,
stack_level INTEGER,     -- 1 = tầng dưới cùng
lot_id UUID → lots,
kien_label TEXT,         -- 'A' | 'B' | 'C' | 'D'
placed_at, placed_by,
removed_at,              -- NULL = đang trong kho; IS NOT NULL = đã rời/xuất
removed_by,
export_order_id          -- link đơn xuất nếu removed do xuất hàng
```

Migrations:
- `supabase/migrations/20260605_warehouse_tp.sql` — tạo bảng + schema ban đầu
- `supabase/migrations/20260606_warehouse_tp_v2.sql` — thêm frame_code/frame_row/frame_col, reseed slots mới

---

## Định nghĩa ô và khung

### Slot_code format
```
{frameCode}-R{row}C{col}
Ví dụ: "1A-R1C1", "1A-R1C2", "11A-R3C1"
```
- `frameCode` = nhãn khung ("1A", "2A", …)
- `row` = hàng trong khung, R1 = phía trước (gần lối đi), Rmax = phía sau
- `col` = cột trong khung, C1 = trái, C2 = phải (khung nhỏ chỉ có C1)

### Khung lớn vs khung nhỏ

**KHO 1 (6 hàng sâu):**
- **Khung lớn** (2 cột × 6 hàng = 12 ô): 1A-10A, 14A, 15A, 1B-10B, 13B, 15B, 16B
- **Khung nhỏ** (1 cột × 6 hàng = 6 ô): 11A, 12A, 13A, 11B, 12B, 14B
- **Restricted** (đỏ đứt): 13B-16B

**KHO 2 (8 hàng sâu):**
- **Khung lớn** (2 cột × 8 hàng = 16 ô): 1A-14A, 17A-21A, 1B-6B, 8B-12B, 13B (restricted), 14B-15B
- **Khung nhỏ** (1 cột × 8 hàng = 8 ô): 15A (restricted), 16A (restricted), 7B

Tổng: KHO1 ≈ 336 slots, KHO2 ≈ 552 slots = ~888 slots/nhà máy

---

## Quy tắc nghiệp vụ

### Lô nào hiển thị trong panel

- `lots.trang_thai IN ('Hoàn thành', 'Xuất hàng')`
- Có ít nhất 1 kiện còn bánh (`kien_a/b/c/d > 0`)
- Lô dở dang được chấp nhận (không còn check `tong_banh IN [144, 240]`)
- Kiện có `kien_X = 0` ẩn trong panel

### Kiện đã xuất hàng (kien_X = 0)

- Placement giữ nguyên với `removed_at` set + `export_order_id`
- Ô hiển thị mờ (grayscale) trong sơ đồ
- Click ô → popup cho phép "Dọn" (DELETE) hoặc "Xem đơn xuất"

### Stack tầng

- max_stack = 3 tầng tại mỗi ô
- Tầng 1 = dưới cùng; khi drop vào ô → auto-assign tầng thấp nhất còn trống
- Ô đầy → từ chối drop + toast lỗi

### Kéo thả (Drag & Drop)

Hai chế độ:

1. **Kéo từng kiện**: Kéo kiện card trong panel → thả vào ô cụ thể trong sơ đồ
   - `e.dataTransfer.setData("kien", JSON.stringify(DragKienData))`
   - Drop target: ô (WarehouseSlotCell)

2. **Kéo cả lô**: Kéo header lô → thả vào khung (frame)
   - `e.dataTransfer.setData("lot", JSON.stringify(DragLotData))`
   - Drop target: khung (WarehouseFrame)
   - Tự phân bổ 4 kiện theo quy tắc sap_kien

### Quy tắc sap_kien (auto-phân bổ)

**Khung lớn (2 cột):**
- Tìm hàng R (từ R1=phía trước): cả C1 và C2 phải có stack trống
- Row 1 (front): A → (R, C1), B → (R, C2)
- Row 2: D → (R2, C1), C → (R2, C2)

**Khung nhỏ (1 cột):**
- Tìm 4 hàng liên tiếp có C1 trống (từ R1)
- A → R1, B → R2, C → R3, D → R4

---

## Layout sơ đồ kho

### KHO 1

```
[orange border container]
  Hàng A: [1A][2A]...[10A][11A][12A] | lối đi | [13A][14A][15A]         Cửa
  ─── Lối đi chính ───
  Hàng B: [1B]...[10B][11B][12B] | lối đi | [13B][14B][15B][16B]        Cửa
Cửa                                                     Cửa      Khu sản xuất
```

### KHO 2

```
[orange border container]
  Hàng A: [1A]...[14A][15A!][16A!] | lối đi | [17A]...[21A]              Cửa
  ─── Lối đi chính ───
  Hàng B: [1B]...[6B][7B] | lối đi | [8B]...[12B][13B!][14B][15B]        Cửa
Cửa                       Cửa                 Cửa              Khu sản xuất
```

`[!]` = restricted (đỏ đứt)

Labels Cửa/Lối đi/Khu sản xuất hiển thị mờ nhỏ (`text-[9px] text-slate-300`) để không rối mắt.

---

## Filter highlight

FilterState:
```ts
{ csrTypes: string[], banhValues: string[], bocValues: string[],
  maLo: string, ghiChu: string, ngayFrom: string, ngayTo: string }
```

Khi filter active:
- Lô/kiện KHỚP filter: hiển thị bình thường
- Lô/kiện KHÔNG khớp: mờ `opacity-30`
- Filter bar hiện màu sky-50, badge "Filter đang bật" trong header sơ đồ

---

## Cấu trúc file

```
src/app/dashboard/warehouse/
  page.tsx
  _components/
    warehouse-types.ts       -- Types, FrameConfig, KHO1_FRAMES, KHO2_FRAMES, helpers
    warehouse-floor-plan.tsx -- Sơ đồ kho (render frames + labels + aisles)
    warehouse-frame.tsx      -- Khung (grid ô + lot drop target)
    warehouse-slot-cell.tsx  -- Ô slot (compact 18px, 3D via layers, popup)
    lot-panel.tsx            -- Panel lô ngang bên dưới KPI (drag kiện/lô)
    warehouse-filter-bar.tsx -- Filter bar (CSR chips, bành, bọc, mã lô, ngày)
    warehouse-kpi.tsx        -- KPI header (thống kê tồn kho)

supabase/migrations/
  20260605_warehouse_tp.sql  -- Schema ban đầu
  20260606_warehouse_tp_v2.sql -- v2: frame columns + reseed 888 slots
```

---

## Layout page.tsx

```
[Header] [Tab chọn kho]
[WarehouseKpi]
[LotPanel — horizontal strip]
[WarehouseFilterBar]
[WarehouseFloorPlan — full width, overflow-x-auto]
```

---

## Permissions

```
warehouse.view    -- Xem sơ đồ kho
warehouse.manage  -- Kéo thả kiện, dọn kho
```
