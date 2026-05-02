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
- Một vật tư có thể thuộc nhiều kho; dữ liệu `kho_chứa` phải được chuẩn hóa theo danh sách kho chuẩn

---

## Kiến trúc đã triển khai (2026-05)

### Cây thư mục

```
src/app/dashboard/inventory/
├── page.tsx                          ← redirect → /dashboard/inventory/on-hand
├── _components/
│   ├── inventory-shell.tsx           ← InventoryPageShell, ScrollReveal, ScrollRevealSection
│   ├── inventory-data.ts             ← loadInventoryAdminData / SnapshotData / MovementData
│   │                                    + getLineTypeLabel, InventoryAlertThreshold, DEFAULT_ALERT_THRESHOLDS
│   ├── inventory-document-loader.ts  ← fetchInventoryDocumentByReference
│   │                                    (trả về audit fields + posted_by_name từ profiles)
│   ├── inventory-image-upload.tsx    ← upload ảnh lên Supabase Storage bucket
│   └── inventory-qr-card.tsx        ← QR code card; prop compact=true cho header phiếu
├── receipts/page.tsx                 ← Nhập kho: CRUD + ghi sổ + hủy phiếu
├── issues/page.tsx                   ← Xuất kho: CRUD + ghi sổ + hủy phiếu
├── transfers/page.tsx                ← Chuyển kho: CRUD + ghi sổ + hủy phiếu
├── on-hand/page.tsx                  ← Tồn kho hiện tại + tồn theo lô
├── cards/page.tsx                    ← Thẻ kho / lịch sử xuất nhập
├── analytics/page.tsx                ← Thống kê, cảnh báo, giao dịch gần đây, ngưỡng cảnh báo, xuất XLSX
├── item/page.tsx                     ← Chi tiết vật tư theo item code
├── print/page.tsx                    ← In phiếu A4 + QR code; banner draft/cancelled; posted_by info
├── print-report/page.tsx             ← In báo cáo hàng loạt (on-hand)
└── settings/page.tsx                 ← Cài đặt: kho, danh mục, vật tư, định mức
```

### Shell và Navigation (`inventory-shell.tsx`)

`InventoryPageShell` là wrapper dùng cho mọi sub-page:

- **Tab lớn**: icon `Layers` (Nhập xuất tồn) + `BarChart3` (Thống kê), `px-6 rounded-2xl`
- **Tab nhỏ** (Nhập / Xuất / Chuyển / Tồn / Thẻ kho): icon từ lucide-react, `px-6 py-3.5 rounded-xl`

Mapping icon tab nhỏ:
| Tab | Icon |
|---|---|
| Nhập kho | `PackagePlus` |
| Xuất kho | `PackageMinus` |
| Chuyển kho | `ArrowRightLeft` |
| Tồn kho | `Boxes` |
| Thẻ kho | `ScrollText` |

Wrapper components được export từ shell (mỗi cái có IntersectionObserver riêng):
- `ScrollReveal` — render `<div>` với `scroll-reveal`
- `ScrollRevealSection` — render `<section>` với `scroll-reveal section-hover`

Dùng `<ScrollReveal className="stagger-cards grid ...">` cho grid KPI cards để có hiệu ứng stagger.

### Pattern QR compact trong header phiếu

`InventoryQrCard` có prop `compact`:
- `compact=false` (default): card đứng 220px, dùng standalone
- `compact=true`: layout ngang (QR 72px | text), dùng trong header Thông tin phiếu

**QR phiếu luôn trỏ về print page** (không trỏ về CRUD form):
```typescript
hrefPath = `/dashboard/inventory/print?type=import&code=${encodeURIComponent(code)}`
// type = "import" | "export" | "transfer"
```

Pattern header phiếu chuẩn (receipts / issues / transfers):
```tsx
<div className="flex items-start justify-between gap-4 border-b ...">
  <div>{/* eyebrow + title + description */}</div>
  <div className="flex flex-col items-end gap-3">
    <div className="flex flex-wrap justify-end gap-2">{/* action buttons */}</div>
    <InventoryQrCard title="..." caption="..." hrefPath={...} valueText={...} compact />
  </div>
</div>
```

### SummaryCard pattern (on-hand & analytics)

Cards KPI dùng viền trái màu accent + nền icon màu theo `tone`:

```tsx
const [iconBg, borderAccent] = tone.includes("amber")
  ? ["bg-amber-50 text-amber-600", "border-l-amber-400"]
  : tone.includes("rose")
    ? ["bg-rose-50 text-rose-600", "border-l-rose-400"]
    : tone.includes("blue")
      ? ["bg-blue-50 text-blue-600", "border-l-blue-400"]
      : tone.includes("violet")
        ? ["bg-violet-50 text-violet-600", "border-l-violet-400"]
        : ["bg-emerald-50 text-emerald-600", "border-l-emerald-400"]

<div className={`rounded-2xl border border-slate-200 border-l-4 ${borderAccent} bg-white p-5 shadow-sm hover-lift`}>
  <div className={`rounded-xl p-3 ${iconBg}`}>{icon}</div>
  ...
</div>
```

### Database

- **Migration nền**: `supabase/migrations/inventory_combined_migration.sql` — 14 bảng, idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
- **Migration audit (2026-05-02)**: `supabase/migrations/20260502_inventory_audit_and_alerts.sql`
  - Thêm cột audit vào `inventory_documents`: `posted_by`, `posted_at`, `cancelled_by`, `cancelled_at`, `cancel_reason`
  - Tạo bảng `inventory_alert_thresholds` (ngưỡng cảnh báo per factory, UNIQUE `factory_id, code`)
  - Cập nhật 3 stored procedures ghi sổ để ghi `posted_by / posted_at`
  - Thêm `inventory_cancel_document` — đảo ngược stock movements + set `status = 'cancelled'`
- **Seed**: `scripts/seed-inventory.mjs` — chạy `node --env-file=.env.local scripts/seed-inventory.mjs`
- **Factory seed**: Phước Hòa KPT (`0268ab41-a564-4538-acf1-6297ac372f57`); 2 kho, 3 nhóm, 10 vật tư, 4 phiếu nhập + 2 phiếu xuất đã ghi sổ
- **Stored procedures**:
  - `inventory_post_import_document(p_factory_id, p_document_id, p_posted_by)`
  - `inventory_post_export_document(p_factory_id, p_document_id, p_posted_by)`
  - `inventory_post_transfer_document(p_factory_id, p_document_id, p_posted_by)`
  - `inventory_cancel_document(p_factory_id, p_document_id, p_cancelled_by, p_cancel_reason)`
- **Trigger**: `inventory_prevent_negative_stock` — chặn xuất vượt tồn ở tầng DB
- **RLS**: "Allow all" cho tất cả bảng inventory (MVP, cần tighten sau)

### Bảng `inventory_alert_thresholds`

```sql
id UUID PK, factory_id UUID, code TEXT, label TEXT, value NUMERIC, unit TEXT, updated_at TIMESTAMPTZ
UNIQUE(factory_id, code)
```

Hai `code` mặc định:
- `export_pct` = 50 → cảnh báo khi 1 lần xuất > 50% tồn hiện tại của vật tư
- `transfer_pct` = 70 → cảnh báo khi 1 lần chuyển > 70% tồn kho nguồn

### Audit trail trên `inventory_documents`

```sql
posted_by    UUID REFERENCES auth.users(id)
posted_at    TIMESTAMPTZ
cancelled_by UUID REFERENCES auth.users(id)
cancelled_at TIMESTAMPTZ
cancel_reason TEXT
```

Vòng đời trạng thái: `draft` → `posted` → `cancelled` (không thể quay lại)

### Permissions

`inventory.view`, `.create`, `.edit`, `.delete`, `.post`, `.cancel`, `.analytics`, `.settings`

- `inventory.cancel` — hủy phiếu đã ghi sổ (chỉ admin mặc định)
- `inventory.settings` — xem/lưu cấu hình ngưỡng cảnh báo

**Fallback ROLE_DEFAULTS**: `src/lib/auth.ts` → `fetchPermissionCodesForUser()` có fallback dùng `ROLE_DEFAULTS` khi bảng `role_permissions` chưa có dữ liệu seed. Đảm bảo module vẫn hiển thị đúng trên sidebar kể cả khi migration chưa chạy xong.

---

## Rule dữ liệu

- Tất cả bảng của module kho phải có `factory_id`
- Các bảng dùng tiền tố `inventory_`
- `item_code` là duy nhất trong từng nhà máy
- `warehouse_code` là duy nhất trong từng nhà máy
- Nếu vật tư bật `manages_lot = true` thì phiếu nhập / xuất / chuyển phải lưu `lot_no`
- Nếu vật tư bật `manages_expiry = true` thì phiếu nhập / xuất / chuyển phải lưu `expiry_date`

## Rule tồn kho

- Không cho phép xuất kho nếu `số xuất > tồn hiện tại`
- Không cho phép xuất lô nếu `số xuất > tồn lô hiện tại`
- Cảnh báo tồn kho theo giới hạn dưới và giới hạn trên
- Cảnh báo tồn kho phải hỗ trợ theo từng kho và từng vật tư
- Cảnh báo hết hạn / sắp hết hạn trước 30 ngày — ưu tiên cho hóa chất
- Khi `nhập kho`, phải kiểm tra tồn sau nhập của kho đích với `giới hạn trên` và `giới hạn dưới`
- Khi `chuyển kho`, phải kiểm tra:
  - kho nguồn sau xuất có thấp hơn `giới hạn dưới` không
  - kho đích sau nhập có vượt `giới hạn trên` không
- Mặc định giai đoạn MVP: hiển thị cảnh báo trước khi ghi sổ; không tự động chặn chỉ vì vượt min-max

## Rule chứng từ

- Mã phiếu:
  - `N-MAKHO-DDMMYY/XXX` — Nhập kho
  - `X-MAKHO-DDMMYY/XXX` — Xuất kho
  - `C-MAKHO-DDMMYY/XXX` — Chuyển kho
- **QR phiếu luôn trỏ về `/dashboard/inventory/print?type=...&code=...`** — read-only, không trỏ về CRUD form
- QR trên bản in A4 cũng self-link về print page (không trỏ về CRUD)
- Người thực hiện phiếu là người đang đăng nhập
- Trường người thực hiện không cần hiển thị trên form nghiệp vụ
- Khi ghi sổ phải truyền `p_posted_by = currentUser.id` vào RPC; sau đó hiển thị `✅ Đã ghi sổ lúc HH:MM ngày DD/MM/YYYY bởi [Tên]`

## Rule hủy phiếu

- Chỉ phiếu `posted` mới được hủy
- Chỉ user có `inventory.cancel` mới thấy nút Hủy phiếu
- Bắt buộc nhập lý do hủy (cancel_reason)
- `inventory_cancel_document` đảo ngược tất cả stock movements nguyên tử + set `status = 'cancelled'`
- Sau hủy: badge đỏ "Đã hủy", tất cả nút action disabled

## Rule print page (`print/page.tsx`)

- Phiếu `draft`: banner vàng "Phiếu chưa ghi sổ — Giao dịch này chưa ảnh hưởng đến tồn kho"
- Phiếu `cancelled`: banner đỏ "Phiếu đã bị hủy" + lý do hủy
- Phiếu `posted`: ô Trạng thái hiển thị `posted_at · posted_by_name`
- `inventory-document-loader.ts` tự resolve `posted_by UUID → profiles.full_name` trước khi return

## Rule nhãn dòng chi tiết

Nhãn "Dòng N" được thay bằng nhãn theo loại trong form Nhập / Xuất / Chuyển:

```typescript
getLineTypeLabel(item, index, allItems)  // từ inventory-data.ts
// category_name.toLowerCase().includes("hóa chất") → "Hóa chất N"
// còn lại → "Vật tư N"  (đánh số riêng từng loại)
```

## Rule modal hủy phiếu (layout)

Modal hủy phiếu render **ngoài** `<InventoryPageShell>`, vì vậy phần `return` phải bọc fragment:
```tsx
return (
  <>
    <InventoryPageShell>...</InventoryPageShell>
    {cancelModal ? <div className="fixed inset-0 z-50 ...">...</div> : null}
  </>
)

## Rule chọn vật tư, số lô và hạn sử dụng

- Với `Xuất kho` và `Chuyển kho`, phải chọn `kho` trước
- Danh sách vật tư phải lọc theo kho đã chọn
- Người dùng có thể chọn nhiều vật tư cùng lúc ở phần header
- Sau khi chọn vật tư, hệ thống tự sinh các dòng chi tiết tương ứng bên dưới
- Nếu cùng một vật tư cần xuất / chuyển từ nhiều lô, phải dùng thao tác `Tách lô`
- Chỉ hiển thị các `số lô` còn tồn trong kho; không hiển thị lô đã hết
- Mỗi cặp `số lô - hạn sử dụng` phải đồng bộ đúng theo dữ liệu tồn lô
- Với `Nhập kho`, `số lô` và `hạn sử dụng` là dữ liệu nhập mới; không lấy từ danh sách tồn lô hiện có

## Rule kiến trúc module

- Module kho đi theo route riêng `/dashboard/inventory`
- Chỉ có 2 tab lớn: `Nhập xuất tồn` và `Thống kê`
- `Nhập`, `Xuất`, `Chuyển`, `Tồn`, `Thẻ kho` là tab con của `Nhập xuất tồn`
- Không đưa `Cài đặt` vào điều hướng chính của module kho
- Danh mục kho, vật tư, định mức phải nằm trong `/dashboard/settings`

## Rule UI / UX

- Giao diện bám sát pattern UI hiện có của hệ thống (rounded-2xl cho cards, border-l-4 accent)
- Toàn bộ nội dung hiển thị bằng tiếng Việt có dấu
- Card KPI: icon (colored bg), số liệu lớn, text mô tả ngắn, viền trái màu theo trạng thái
- Mọi section phải dùng `ScrollRevealSection` hoặc `ScrollReveal` từ shell — không dùng `ref+className` thủ công
- Grid KPI cards dùng thêm `.stagger-cards` để các card xuất hiện lần lượt
- Với các màn Nhập / Xuất / Chuyển kho:
  - QR compact tích hợp vào header bên cạnh nút hành động
  - Không hiển thị trường `Người thực hiện`
  - Mỗi dòng chi tiết: hàng 1 (Tên vật tư + Số lượng), hàng 2 (Số lô + Hạn sử dụng), hàng 3-4 (ảnh, ghi chú)

## Rule thống kê (`analytics/page.tsx`)

- KPI cards, bộ lọc kho/trọng tâm, bảng cảnh báo, biểu đồ, top vật tư, xuất XLSX
- **Section "Giao dịch gần đây"**: bảng toggle 7/30 ngày; cột Thời gian / Loại / Mã phiếu / Vật tư / SL / Kho / Người thực hiện / ⚠️
  - Load riêng với `factoryId` + `transactionDays` dependency
  - Join `inventory_documents` để lấy `document_code` và `requester_name`
- **Cảnh báo bất thường**: `stockBefore = balance_after + quantity_out`; nếu `quantity_out / stockBefore * 100 > threshold` → ⚠️ + %
- **Section cấu hình ngưỡng** (chỉ `inventory.settings`): 2 input `export_pct` / `transfer_pct`; lưu bằng `supabase.upsert(..., { onConflict: "factory_id,code" })`
- Xuất file gồm 3 sheet: Tồn hiện tại, Cảnh báo, Lịch sử nhập xuất chuyển

## Rule định mức

- File tham chiếu: `cung_cap_dl/kho_bao_tri/dinh_muc.xlsx`
- Định mức phải lưu theo từng nhà máy
- Báo cáo tháng: `định mức kế hoạch = thành phẩm trong kỳ * định mức`; `chênh lệch = thực tế - kế hoạch`

## Rule backend

- Backend là lớp chốt cuối cho các rule tồn kho
- Nếu UI có cảnh báo nhưng backend không chặn thì xem như chưa đạt
- Trigger / function backend được phép dùng để chặn phát sinh xuất vượt tồn