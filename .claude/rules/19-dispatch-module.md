# Module Điều Xe

## Cập nhật mới nhất (2026-06-05)

- Nút `PDF đội` và `PDF xe` phải bấm được ngay, không phụ thuộc việc đã chọn filter `Đội` hoặc `Xe`.
- Nếu dataset export rỗng thì phải chặn xuất và báo toast rõ ràng, không tạo file PDF rỗng.
- Thứ tự export phải ổn định:
  - `PDF đội`: `Ngày ASC` rồi `Đội ASC`.
  - `PDF xe`: `Ngày ASC` rồi `Số xe ASC` rồi `Chuyến ASC`.
- Tên file export đội/xe phải ổn định và tách biệt, tránh trùng hoặc khó nhận biết.
- Filter `Ghi chú` phải đi vào đúng dataset dùng cho thống kê và export PDF. Khi người dùng chọn một ghi chú, các nút `PDF tổng`, `PDF đội`, `PDF xe` chỉ được in đúng phần dữ liệu khớp ghi chú đó.
- Bộ lọc `Đội` và `Xe` được ưu tiên đặt cùng cụm header với `Từ ngày`, `Đến ngày`, `Ghi chú` để người dùng nhìn toàn bộ điều kiện lọc ở một chỗ.
- Khi thêm tham số mới cho export, phải cập nhật đồng bộ type/interface ở cả nơi gọi và helper PDF. Ví dụ: thêm `selectedNote` ở `page.tsx` thì phải cập nhật ngay type của `downloadDispatchStatsPdf` trong `src/lib/dispatch-pdf.ts`, nếu không `npm run build` sẽ lỗi TypeScript.

## Handoff cho session tiếp theo

- Vào trước các file:
  - `src/app/dashboard/dispatch/page.tsx`
  - `src/lib/dispatch-analytics.ts`
  - `src/lib/dispatch-pdf.ts`
- Cần rà lại phần UI thống kê để xóa hẳn block filter `Đội/Xe` cũ; hiện mục tiêu là chỉ giữ filter ở header.
- Cần chuẩn hóa dần các chuỗi tiếng Việt đang lỗi mã hóa trong module điều xe/PDF để tránh lẫn lộn giữa text đúng dấu và text mojibake.

## Lỗi deploy gần nhất cần nhớ

```text
Type error: Object literal may only specify known properties, and 'selectedNote' does not exist in type '{ analytics: DispatchAnalytics; factoryName: string; from?: string | undefined; to?: string | undefined; mode: "doi" | "all" | "vehicle"; selectedDoi?: string | undefined; selectedVehicle?: string | undefined; makerName?: string | undefined; }'.
  688 |         selectedDoi: statsDoi,
  689 |         selectedVehicle: statsVehicle,
> 690 |         selectedNote: filterGhiChu,
      |         ^
  691 |         makerName,
  692 |       })
  693 |     } catch (err) {
Next.js build worker exited with code: 1 and signal: null
Error: Command "npm run build" exited with 1
```
## Cập nhật 2026-06-10: đối soát với Sản lượng

- Dữ liệu Điều xe và Sản lượng phải luôn khớp theo cùng khóa nghiệp vụ `ngày + đội + số xe + chuyến` trong phạm vi `factory_id`.
- Khi module Sản lượng import lại file đã có dữ liệu cũ, hệ thống phải cập nhật lại đúng dòng hiện có thay vì tạo thêm bản ghi trùng; nếu lịch sử đã có nhiều dòng cùng khóa thì phải dọn trùng trước khi write-back sang Điều xe.
- Cảnh báo trùng dữ liệu ở bước preview import là bắt buộc để người dùng biết dòng nào sẽ ghi đè dữ liệu cũ.
- Sau mọi thao tác import, thêm, sửa hoặc xóa ở module Sản lượng, phải chạy write-back để cập nhật lại khối lượng trên `dispatch_entry_rows` trước; `dispatch_entries.rows` chỉ được sync lại như cache legacy nếu hệ thống còn giữ cột này.
- Không chấp nhận trạng thái Điều xe nhỏ hơn Sản lượng chỉ vì dữ liệu trùng ở `production_records`.
## Cập nhật 2026-06-10: lọc loại nguyên liệu và UI thống kê

- Bộ lọc `Loại nguyên liệu` ở `/dashboard/dispatch` là `multi-select`, không còn `single select`.
- Bộ lọc `Loại nguyên liệu` phải hoạt động đồng thời với `Ghi chú`, `Đội`, `Xe`, `Từ ngày`, `Đến ngày`.
- Khi người dùng chọn nhiều loại nguyên liệu, dữ liệu `Danh sách`, `Thống kê`, `PDF tổng`, `PDF đội`, `PDF xe`, `PDF ngày` đều phải chỉ lấy các chuyến có ít nhất một loại khớp với tập đã chọn.
- `Tab Thống kê` phải hiển thị được các KPI:
  - `Tổng bảng phân xe`
  - `Tổng chuyến xe`
  - `Tổng km di chuyển`
  - `Khối lượng tươi theo loại`
  - `Khối lượng khô theo loại`
- Không được render trùng 2 cụm KPI giống nhau khi đang ở tab `Thống kê`.
  - Cụm KPI đầu trang chỉ hiển thị ở tab `Danh sách`.
  - Cụm KPI trong tab `Thống kê` là cụm duy nhất khi người dùng đang xem thống kê.
- Nếu có thay đổi text/filter UI ở `dispatch/page.tsx`, phải rà lại hiển thị tiếng Việt thực tế trên giao diện.
  - Không để placeholder hoặc label hiện dạng escape như `T\\u1ea5t...`
  - Không để text mojibake như `Má»§`, `ChĂ©n`, `KhĂ´ng`

## Handoff bổ sung cho session tiếp theo

- Nếu sửa tiếp `src/app/dashboard/dispatch/page.tsx`, ưu tiên giữ text hiển thị bằng tiếng Việt Unicode bình thường.
- Khi thêm component dùng chung cho filter, phải kiểm tra cả text trong chính component đó, không chỉ text ở nơi gọi.
## Update 2026-06-11: dispatch source of truth

- `dispatch_entry_rows` la source of truth cho chi tiet dieu xe.
- Sau moi thao tac import/them/sua/xoa o module San luong, `writeBackToDispatch` phai cap nhat `dispatch_entry_rows` truoc.
- `dispatch_entries.rows` neu con ton tai chi duoc sync lai nhu cache legacy; code moi khong duoc xem cot nay la nguon chinh.

## Cập nhật 2026-06-29: Xóa xe hàng loạt, fix clone ngày, phiên riêng từng điểm

### Nút "Xóa xe" ở header (thay thế per-row)

- **Không còn** nút `UserX` icon ở cột actions từng dòng điều xe.
- Thay bằng **1 nút duy nhất "Xóa xe"** nằm trong cụm action header, cùng hàng với "Nhập KL / GeoJSON / Thêm ghi chú / Thêm xe".
- Hàm `clearAllVehicles()` xóa `so_xe`, `tai_xe`, reset `chuyen: 0` trên **TẤT CẢ** dòng cùng lúc.
- Giữ nguyên: `diem_gn`, `phien`, `stops_detail`, `lo_trinh`, `lo_thu_hoach`, `doi`, `so_km` và tất cả cột KL.
- Dùng khi người dùng muốn giữ nguyên tuyến đường nhưng thay toàn bộ xe cho một ngày mới.

```typescript
// clearAllVehicles trong page.tsx
const clearAllVehicles = useCallback(() => {
  setFormRows(rows => rows.map(r => ({ ...r, so_xe: "", tai_xe: "", chuyen: 0 })))
}, [])
```

### Fix openAdd() — luôn clone ngày mới nhất

**Bug cũ**: `openAdd()` dùng `.order("ngay", { ascending: false }).limit(5)` nhưng `ngay` lưu dạng text `"dd/mm/yyyy"`. Sort lexicographic khiến `"31/12/2025" > "29/06/2026"` (vì `'3' > '2'`) → `limit(5)` trả về 5 ngày **cũ nhất** thay vì mới nhất. Sau đó JS re-sort bằng `toISO()` không cứu được vì pool ban đầu đã sai.

**Fix**: Đổi sang `.order("created_at", { ascending: false })`. `created_at` là timestamp chuẩn, luôn cho kết quả đúng bất kể format của cột `ngay`.

```typescript
// Trước (bug):
.order("ngay", { ascending: false }).limit(5)

// Sau (fix):
.order("created_at", { ascending: false }).limit(5)
```

**Quy tắc chung**: Không được dùng `.order()` trên cột `ngay` của `dispatch_entries` để lấy "mới nhất" hay "cũ nhất" — luôn dùng `created_at`. Cột `ngay` dạng text "dd/mm/yyyy" chỉ dùng để hiển thị và so sánh sau khi đã normalize qua `toISO()`.

### Phiên riêng từng điểm (`stops_detail`)

Cho phép một chuyến xe đi nhiều điểm, mỗi điểm có phiên khác nhau (ví dụ: xe 1A đi E1 Phiên A và G3 Phiên B trong cùng chuyến 1).

**Migration** (cần chạy thủ công trong Supabase SQL Editor):

```sql
-- supabase/migrations/20260629_dispatch_stops_detail.sql
ALTER TABLE dispatch_entry_rows
  ADD COLUMN IF NOT EXISTS stops_detail JSONB DEFAULT NULL;
```

**Quy tắc**:
- `stops_detail = NULL` → dùng `phien[]` phẳng chung cho tất cả điểm (backward-compatible, không phá vỡ dữ liệu cũ).
- `stops_detail` có giá trị → mỗi điểm trong `diem_gn[]` có `phien[]` riêng, ví dụ:
  ```json
  [{"diem": "E1", "phien": ["Phiên A"]}, {"diem": "G3", "phien": ["Phiên B"]}]
  ```
- Khi `stops_detail` có giá trị, `buildLoThuHoach()` trong `dispatch-master.ts` dùng phiên từ `stops_detail` để suy ra `lo_thu_hoach` chính xác từng điểm, không dùng `phien[]` phẳng.

**Các file đã cập nhật**:
- `src/lib/dispatch-entry-rows.ts` — `LegacyDispatchRow.stops_detail`; `dispatchDbRowToLegacy()` và `legacyDispatchRowToDb()` đều xử lý field này.
- `src/lib/dispatch-master.ts` — `buildLoThuHoach(diemGnCodes, phienCodes, deliveryPoints, stops_detail?)` — tham số thứ 4 optional.
- `src/app/dashboard/dispatch/page.tsx` — `DxRow.stops_detail`, `toggleStopsDetailMode`, `updateStopPhien`, UI toggle per-point phiên trên từng dòng.

**Lưu ý quan trọng**: Migration `20260629_dispatch_stops_detail.sql` phải được chạy thủ công trên Supabase SQL Editor trước khi tính năng `stops_detail` hoạt động trên production.

## Cập nhật 2026-07-01: Đánh lại số chuyến khi nhân bản / xóa dòng trong form Điều xe

### Bug đã fix

- **Nhân bản dòng** (`cloneRow`): dòng nhân bản copy nguyên `chuyen` của dòng gốc qua spread `{...src}`. Nhân bản dòng "10A chuyến 1" tạo ra dòng mới cũng là "10A chuyến 1" thay vì "10A chuyến 2".
- **Xóa dòng** (nút X trong cột hành động): chỉ `setFormRows(r => r.filter((_,i) => i !== idx))`, không đánh lại `chuyen` của các dòng còn lại cùng xe. Xóa "10A chuyến 1" khi còn "10A chuyến 2" thì dòng còn lại phải tụt xuống "10A chuyến 1", nhưng trước fix vẫn giữ nguyên `chuyen: 2`.

### Fix

Thêm helper dùng chung trong `src/app/dashboard/dispatch/page.tsx`, đặt cạnh `cloneRow`:

```typescript
// Đánh lại số "chuyến" tuần tự (1,2,3...) cho tất cả các dòng cùng so_xe,
// giữ nguyên thứ tự xuất hiện trong mảng. Dòng chưa chọn xe (so_xe rỗng) không đổi.
const renumberChuyenForVehicle = (rows: DxRow[], so_xe: string): DxRow[] => {
  if (!so_xe) return rows
  const total = rows.filter(r => r.so_xe === so_xe).length
  let seq = 0
  return rows.map(r => {
    if (r.so_xe !== so_xe) return r
    seq += 1
    return {
      ...r,
      chuyen: seq,
      _warn: total >= 3 ? `Xe ${so_xe} đã có ${total - 1} chuyến trong ngày này!` : undefined,
    }
  })
}
```

- `cloneRow` gọi `renumberChuyenForVehicle` ngay sau khi chèn dòng nhân bản vào mảng — dòng gốc, dòng nhân bản, và bất kỳ dòng nào khác đã có sẵn cùng `so_xe` đều được đánh số lại tuần tự trong một lần duyệt.
- Nút xóa dòng không còn gọi `setFormRows(r => r.filter(...))` trực tiếp trong JSX; thay bằng hàm `removeRow(idx)` — filter bỏ dòng xong thì gọi lại helper cho đúng `so_xe` của dòng vừa xóa.
- Renumber áp dụng cho toàn bộ dòng cùng `so_xe` bất kể `locked` hay không, nhất quán với cách `updateRow` đếm `sameXe` khi auto-assign lúc chọn xe (không phân biệt `locked`).
- Dòng chưa chọn `so_xe` (rỗng) không bị đụng tới — không xung đột với `clearAllVehicles()` (mục "Xóa xe hàng loạt" phía trên), vì hàm đó reset `so_xe = ""` nên helper renumber sẽ bỏ qua các dòng đó ngay từ điều kiện `if (!so_xe) return rows`.

### Quy tắc chung (thay thế mọi mô tả cũ về clone/xóa dòng không renumber)

- Bất kỳ thao tác nào làm thay đổi tập hợp dòng của một xe trong ngày (nhân bản dòng, xóa dòng, và các thao tác tương lai nếu có) đều phải chạy qua `renumberChuyenForVehicle` để đảm bảo `chuyen` luôn là dãy liên tục 1,2,3... theo từng xe, không hở số và không trùng số.
- Không được để logic nhân bản/xóa dòng copy hoặc giữ nguyên `chuyen` của dòng khác mà không tính lại theo nhóm cùng `so_xe`.
