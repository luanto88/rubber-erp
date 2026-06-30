---
description: Module xuất hàng, assignments, EUDR
---

# Module Xuất hàng

## Schema chính (`export_orders`)

```ts
{
  id: UUID,
  factory_id: UUID,
  ma_don: string,
  ngay: date,
  so_thong_bao: string,
  so_hoa_don: string,
  so_hop_dong: string,
  customer_id: UUID,
  chung_loai: string,
  loai_pallet: string,
  loai_banh: number,
  loai_boc: string,
  vehicles: Vehicle[],
  assignments: Assignment[],
  tong_banh: number,
  yeu_cau_chi_tieu: object[],
  files: object[],
}

type Vehicle = {
  id: string,
  loai_xe: string,
  bien_truoc: string,
  bien_sau: string,
  ghi_chu: string,
  image_url_1?: string,
  image_url_2?: string,
  image_url_3?: string,
}
```

## Rule `loai_pallet_xuat`

`du_lieu_nha_may.xlsx` là source cao nhất cho `loai_pallet_xuat`.

Rule chính thức:

- `loai_pallet_xuat` chỉ lọc theo `nhà máy`
- Giá trị mặc định ban đầu lấy từ Excel
- Giá trị mở rộng runtime được lưu vào database theo đúng nhà máy
- UI có nút `+` bên phải ô chọn để thêm mới
- Giá trị thêm mới phải được dùng lại cho lần sau của cùng nhà máy

### NMPHK

- `Rời`
- `Pallet sắt đế gỗ`

### NMCP

- `Rời`
- `PE đế gỗ`
- `PE đế nhựa`
- `Pallet gỗ`
- `MB4`
- `MB5`

## Rule `loai_boc`

- `loai_boc` phải filter theo `nhà máy + dây chuyền + chủng loại`
- Không dùng danh sách chung hard-code cho tất cả nhà máy

## Mã đơn

```ts
ma_don = `XH-${ma_kh}-${so_thong_bao}-${ddmmyy(ngay)}`;
```

- Read-only
- Chỉ auto tạo khi đủ thông tin
- Edit mode giữ nguyên mã đã lưu

## Chọn lô và remaining

- Hiển thị lô có `trang_thai IN ("Hoàn thành", "Xuất hàng")`
- Chỉ đưa lô vào panel nếu còn `remaining > 0`
- `remaining` = tổng số kiện của lô - tổng đã gán trong **TẤT CẢ** đơn khác (kể cả pending, không lọc chỉ approved)
- `lotsExt` useMemo trong `export/page.tsx` tính remaining từ `orders.filter(o => o.id !== editId)` — **không có `.filter(isApproved)`**.
- Nếu bộ lọc lot picker không ra lô, kiểm tra trước tiên:
  - chuỗi `trang_thai` của query có đúng tiếng Việt chuẩn
  - chuỗi `loai_boc`, `loai_pallet`, `chỉ tiêu` có bị sai chính tả hoặc lỗi mã hóa không
  - text tìm kiếm `ma_lo` có đang được normalize đúng không

## Server-side validation khi lưu đơn (2026-06-19)

Kể từ migration `20260619_export_validate_rpc.sql`, `handleSave()` trong `export/page.tsx` **phải gọi RPC `validate_export_assignments` trước khi upsert** `export_orders`.

```typescript
// Trong handleSave(), trước khi upsert
if (form.assignments.length > 0) {
  const { error: validErr } = await supabase.rpc("validate_export_assignments", {
    p_factory_id: factoryId,
    p_exclude_order_id: editId ?? null,
    p_assignments: form.assignments,
  })
  if (validErr) { showToast(validErr.message, "error"); return }
}
```

### Quy tắc RPC `validate_export_assignments`

- Tham số: `p_factory_id UUID`, `p_exclude_order_id UUID` (null khi tạo mới), `p_assignments JSONB`.
- Dùng `CROSS JOIN LATERAL jsonb_array_elements(eo.assignments)` để đếm kiện đã assign trong **tất cả** đơn còn lại (không chỉ approved).
- Raise exception với message tiếng Việt rõ ràng nếu tổng (đã assign + đơn này) vượt `kien_X` của lô.
- `SECURITY DEFINER` — `GRANT EXECUTE TO authenticated`.

## Quan hệ với Thành phẩm

- Xuất hết remaining -> lô chuyển `Xuất hàng`
- Còn remaining -> giữ `Hoàn thành`
- Xóa đơn hàng -> phải tính lại remaining của từng lô
- Nếu lô có hàng khả dụng trở lại sau khi xóa đơn -> quay về `Hoàn thành`

### Rule KN lại từ flow Xuất hàng

- Nếu người dùng kéo 1 lô `rớt hạng` trong form `Xuất hàng`, hệ thống được phép mở flow `Kiểm nghiệm lại`
- Draft form `Xuất hàng` chỉ được lưu tạm bằng `sessionStorage` để giữ UI state; đây không phải source of truth nghiệp vụ
- Sau khi lưu KN lại:
  - nếu flow được mở từ `Xuất hàng` thì quay lại form `Xuất hàng` và khôi phục draft
  - nếu kết quả KN lại `đạt hạng` thì lô đó tự động nằm lại trên đúng xe mà người dùng vừa định kéo vào
  - nếu kết quả vẫn `rớt hạng` thì vẫn quay lại form `Xuất hàng`, giữ draft nhưng không gán lô lên xe
- Nếu người dùng mở `Kiểm nghiệm lại` trực tiếp trong module `Kiểm nghiệm` thì save xong không được tự động quay về form `Xuất hàng`

### Rule đồng bộ khi xóa đơn xuất

- Khi xóa 1 `export_order`, **KHÔNG** update trạng thái lô theo kiểu cứng nhắc
- Bắt buộc reconcile từ `export_orders.assignments` thực tế trong DB:
  - Tính tổng `assigned = sum(kien_a+kien_b+kien_c+kien_d)` của lô đó qua **TẤT CẢ** đơn còn lại trong `factory_id`
  - `assigned > 0 && assigned >= tong_banh` → `Xuất hàng`
  - còn lại → `Hoàn thành`
- Kết quả tính lại phải phản ánh ngay ở module `Thành phẩm` theo hướng đồng bộ 2 chiều
- Tham chiếu implementation: `reconcileLotStatuses` trong `export/page.tsx`

### Rule đồng bộ khi xóa phiếu Kiểm nghiệm (2026-06-30)

Quy tắc reconcile **áp dụng đồng nhất** cho cả thao tác xóa phiếu KN trong `quality/page.tsx`, không chỉ khi xóa đơn xuất.

**Lý do:** `handleDelete` và `handleBulkDelete` ở `quality/page.tsx` trước đây set cứng `trang_thai = "Hoàn thành"` sau khi xóa `qc_results`. Điều này gây ra: nếu lô vẫn còn gán trong đơn xuất, lô sẽ bị downgrade nhầm về "Hoàn thành" dù không có remaining.

**Canonical reconcile pattern** — dùng thống nhất ở `quality/page.tsx`, `export/page.tsx`, và `product/page.tsx` (admin sync):

```typescript
// Sau khi xóa qc_results, thu thập affectedLotIds rồi:
const { data: allOrders } = await supabase
  .from("export_orders")
  .select("assignments")
  .eq("factory_id", factoryId)
const { data: lotsData } = await supabase
  .from("lots")
  .select("id, tong_banh, trang_thai")
  .eq("factory_id", factoryId)
  .in("id", affectedLotIds)
for (const lot of lotsData ?? []) {
  const assigned = (allOrders ?? []).reduce((sum, order) => {
    const assgns = (order.assignments as Array<{lot_id:string;kien_a:number;kien_b:number;kien_c:number;kien_d:number}>) ?? []
    return sum + assgns
      .filter(a => a.lot_id === lot.id)
      .reduce((s, a) => s + (a.kien_a||0) + (a.kien_b||0) + (a.kien_c||0) + (a.kien_d||0), 0)
  }, 0)
  const nextStatus = assigned > 0 && assigned >= Number(lot.tong_banh || 0)
    ? "Xuất hàng"
    : "Hoàn thành"
  if (lot.trang_thai !== nextStatus) {
    await supabase.from("lots").update({ trang_thai: nextStatus }).eq("id", lot.id)
  }
}
```

**Các trường hợp phải áp dụng:**
- `quality/page.tsx` `handleDelete` — xóa 1 phiếu KN
- `quality/page.tsx` `handleBulkDelete` — xóa nhiều phiếu KN cùng lúc
- `export/page.tsx` — khi xóa đơn xuất (`reconcileLotStatuses`)
- `product/page.tsx` `handleSyncAllLotStatuses` — admin batch sync (fix lô bị kẹt do xóa DB trực tiếp)

## Khách hàng

- Có thao tác tạo nhanh trong module `Xuất hàng`
- Đồng thời phải có trang quản trị đầy đủ trong `Cài đặt`

## EUDR

EUDR đã được triển khai, không còn là ý tưởng tương lai.

- Module: `/dashboard/eudr`
- Chuỗi truy xuất chính: `export_orders -> lots -> ngans -> dispatch_entries -> dispatch_delivery_points -> forest_plots`
- Từ `dispatch_entries.rows[].diem_gn` và `phiên`, hệ thống tra `dispatch_delivery_points` theo `factory_id` để suy ra tập mã lô vườn (`ten`)
- Mã `ten` được dùng để lấy polygon từ bảng `forest_plots` (DB) và render bản đồ
- Hỗ trợ QR code, zip file, file đính kèm

### Nguồn dữ liệu lô vườn (forest_plots)

- **Bảng DB**: `forest_plots` — source of truth runtime, filter theo `factory_id + is_active + ten IN [...]`
- **Fallback**: `/public/geojson/Lo cao su - 2026_Full.geojson` — chỉ dùng khi DB chưa có dữ liệu
- `EudrClient.tsx` thực hiện logic: query DB trước, fallback GeoJSON tĩnh nếu `plotRows` rỗng
- `dispatch_delivery_points.phien_X[]` vẫn lưu mảng `ten` codes — không thay đổi
- Seed dữ liệu ban đầu: `node --env-file=.env.local scripts/seed-forest-plots.mjs`
- Không được hard-code danh sách lô vườn trong code; mọi mở rộng phải vào DB

## Ngôn ngữ giao diện

- Session `Xuất hàng` phải hiển thị tiếng Việt có dấu, đúng chính tả
- Session `Xuất hàng` hiện tại phải đồng bộ cách gọi số lượng theo thuật ngữ nghiệp vụ là `bánh`
- Các nhãn quan trọng cần giữ đúng dạng chuẩn: `Xuất hàng`, `Tạo đơn xuất`, `Tổng bánh`, `Khách hàng`, `Lô hàng`, `Yêu cầu chỉ tiêu`
