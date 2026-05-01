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
│   ├── inventory-document-loader.ts  ← fetch document by ID / code
│   ├── inventory-image-upload.tsx    ← upload ảnh lên Supabase Storage bucket
│   └── inventory-qr-card.tsx        ← QR code card; prop compact=true cho header phiếu
├── receipts/page.tsx                 ← Nhập kho: CRUD + ghi sổ (stored procedure)
├── issues/page.tsx                   ← Xuất kho: CRUD + ghi sổ
├── transfers/page.tsx                ← Chuyển kho: CRUD + ghi sổ
├── on-hand/page.tsx                  ← Tồn kho hiện tại + tồn theo lô
├── cards/page.tsx                    ← Thẻ kho / lịch sử xuất nhập
├── analytics/page.tsx                ← Thống kê, cảnh báo, biểu đồ, xuất XLSX
├── item/page.tsx                     ← Chi tiết vật tư theo item code
├── print/page.tsx                    ← In phiếu A4 + QR code
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

- **Migration**: `supabase/migrations/inventory_combined_migration.sql` — 14 bảng, idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
- **Seed**: `scripts/seed-inventory.mjs` — chạy `node --env-file=.env.local scripts/seed-inventory.mjs`
- **Factory seed**: Phước Hòa KPT (`0268ab41-a564-4538-acf1-6297ac372f57`); 2 kho, 3 nhóm, 10 vật tư, 4 phiếu nhập + 2 phiếu xuất đã ghi sổ
- **Stored procedures**: `inventory_post_import_document`, `inventory_post_export_document`, `inventory_post_transfer_document`
- **Trigger**: `inventory_prevent_negative_stock` — chặn xuất vượt tồn ở tầng DB
- **RLS**: "Allow all" cho tất cả bảng inventory (MVP, cần tighten sau)

### Permissions

`inventory.view`, `.create`, `.edit`, `.delete`, `.post`, `.analytics`, `.settings`

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
- QR phiếu chỉ nên lưu URL tra cứu, không nhồi toàn bộ dữ liệu vào mã QR
- Người thực hiện phiếu là người đang đăng nhập
- Người phê duyệt phiếu là người đang đăng nhập và có quyền phê duyệt
- Trường người thực hiện không cần hiển thị trên form nghiệp vụ

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

## Rule thống kê

- Trang analytics: KPI cards, bộ lọc kho/trọng tâm, bảng cảnh báo, biểu đồ, top vật tư, xuất XLSX
- Xuất file gồm 3 sheet: Tồn hiện tại, Cảnh báo, Lịch sử nhập xuất chuyển

## Rule định mức

- File tham chiếu: `cung_cap_dl/kho_bao_tri/dinh_muc.xlsx`
- Định mức phải lưu theo từng nhà máy
- Báo cáo tháng: `định mức kế hoạch = thành phẩm trong kỳ * định mức`; `chênh lệch = thực tế - kế hoạch`

## Rule backend

- Backend là lớp chốt cuối cho các rule tồn kho
- Nếu UI có cảnh báo nhưng backend không chặn thì xem như chưa đạt
- Trigger / function backend được phép dùng để chặn phát sinh xuất vượt tồn