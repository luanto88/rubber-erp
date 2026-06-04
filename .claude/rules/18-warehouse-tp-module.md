---
description: Module Quản lý kho thành phẩm — sơ đồ kho, vị trí kiện, drag-and-drop, tích hợp Thành phẩm và Xuất hàng
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

Hệ thống **cảnh báo** khi kéo lô sai kho (ví dụ lô Mủ nước vào KHO 1) nhưng **không chặn cứng**.

---

## Schema

### `warehouse_slots` — master data vị trí kho

```sql
id, factory_id, warehouse_code, slot_code, row_label, col_number,
is_restricted BOOLEAN,   -- true = ô nét đỏ đứt (khuyến cáo không để)
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

Unique indexes:
- `(factory_id, warehouse_code, slot_code, stack_level) WHERE removed_at IS NULL` — slot+tầng chỉ có 1 kiện active
- `(factory_id, lot_id, kien_label) WHERE removed_at IS NULL` — 1 kiện chỉ active ở 1 slot

Migration: `supabase/migrations/20260605_warehouse_tp.sql`

---

## Layout slot codes

### KHO 1

- **Hàng A**: 1A–12A, 13A–15A (tất cả regular)
- **Hàng B**: 1B–12B (regular), 13B–16B (is_restricted=true)

### KHO 2

- **Hàng A**: 1A–14A (regular), 15A–16A (restricted), 17A–21A (regular)
- **Hàng B**: 1B–7B (regular), 8B–12B (regular), 13B (restricted), 14B–15B (regular)

---

## Quy tắc nghiệp vụ

### Lô nào hiển thị trong panel phải

- `lots.trang_thai = 'Hoàn thành'`
- `lots.tong_banh IN (144, 240)` — chỉ lô tròn đầy 4 kiện
  - loai_banh 35/33.33: max 36 bánh/kiện × 4 = 144
  - loai_banh 20: max 60 bánh/kiện × 4 = 240
- Lô "Dở dang" chưa đủ 4 kiện KHÔNG hiển thị để kéo vào kho
- Kiện có `kien_X = 0` (đã xuất hết) ẩn khỏi panel

### Kiện đã xuất hàng (kien_X = 0)

- Placement giữ nguyên với `removed_at` set + `export_order_id`
- Hiển thị mờ (opacity-40) với badge "Xuất" trong slot
- User click → popup cho phép "Dọn" (DELETE) hoặc "Xem đơn xuất"
- Sau khi Dọn: DELETE placement record, slot slot trống hoàn toàn

### Stack tầng

- max_stack mặc định = 3
- Tầng 1 = dưới cùng (được đặt vào trước)
- Khi drop vào slot → auto-assign tầng thấp nhất còn trống
- Slot đầy (active placements = max_stack) → từ chối + toast lỗi

### Kéo thả (Drag & Drop)

- Dùng HTML5 native DnD (không thêm package)
- Drag source: kiện card trong panel phải — `draggable="true"`
- Drop target: slot cell trong sơ đồ — `onDragOver` + `onDrop`
- Data transfer: `e.dataTransfer.setData("kien", JSON.stringify(DragKienData))`
- Kiện đã có placement active: popup xác nhận di chuyển trước khi insert

---

## Hiển thị 3D Layer Slices

Mỗi slot có thể hiển thị tối đa max_stack kiện chồng nhau theo hiệu ứng 3D:
- **Compact** (không hover): cards chồng, mỗi card lộ ~5px phía trên card bên dưới
- **Expand** (hover): cards tách ra, hiện rõ từng tầng (~26px/tầng)
- Badge `T1/T2/T3` ở góc trái dưới mỗi card

---

## Tích hợp module khác

### Thành phẩm → Kho

- Khi lô chuyển `trang_thai = 'Hoàn thành'` + lô tròn: tự hiện trong panel phải
- Dùng Supabase Realtime subscribe `lots` + `warehouse_lot_placements`

### Kho → Xuất hàng

- Khi `lots.kien_X = 0` (kiện bị xuất hết): `removed_at` được set trên placement
- Kiện hiển thị mờ trong sơ đồ cho đến khi user Dọn
- Xóa đơn xuất → `kien_X` tăng lại → user có thể đặt lại vào kho (placement cũ đã removed, cần kéo lại)

---

## Cấu trúc file

```
src/app/dashboard/warehouse/
  page.tsx
  _components/
    warehouse-types.ts       -- Types, helpers, layout configs (KHO1_LAYOUT, KHO2_LAYOUT)
    warehouse-floor-plan.tsx -- Sơ đồ kho (grid slots + drop zones)
    warehouse-slot-cell.tsx  -- Ô slot (3D stack display, click popup)
    lot-panel.tsx            -- Panel lô bên phải (filter + drag sources)
    warehouse-kpi.tsx        -- KPI header (thống kê tồn kho)
```

---

## Permissions

```
warehouse.view    -- Xem sơ đồ kho
warehouse.manage  -- Kéo thả kiện, dọn kho
```
