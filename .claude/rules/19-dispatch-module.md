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

## Cập nhật 2026-07-01 (bổ sung): Đội/Xe trong tab Thống kê là multi-select

- `statsDoi` và `statsVehicle` trong `src/app/dashboard/dispatch/page.tsx` nay là `string[]` (trước đây là `string` đơn), dùng chung component `FilterMultiSelect` (`src/app/dashboard/_components/filter-multi-select.tsx`) giống hệt pattern của `Loại nguyên liệu` — dropdown checkbox + ô tìm kiếm, thay cho `<select>` đơn cũ.
- `FilterMultiSelect` có thêm prop optional `searchPlaceholder` (mặc định `"Tìm loại..."`) để đổi placeholder ô tìm kiếm theo ngữ cảnh dùng lại (`"Tìm đội..."`, `"Tìm xe..."`).
- Filter `Đội` và `Xe` phải hoạt động đồng thời với `Loại nguyên liệu`, `Ghi chú`, `Từ ngày`, `Đến ngày` — áp dụng cho `Danh sách`, `Thống kê`, `PDF tổng`, `PDF đội`, `PDF xe`.
- `buildDispatchAnalytics()` trong `src/lib/dispatch-analytics.ts` nhận `filters.dois?: string[]` và `filters.vehicles?: string[]` (đổi từ `doi?: string` / `vehicle?: string`). Lọc đội dùng `dois.some(...)` khớp bất kỳ giá trị nào trong tập đã chọn; lọc xe đổi từ so khớp substring sang exact-match theo `Set` (vì giá trị chọn luôn đến từ danh sách option cố định, không phải nhập tay).
- `downloadDispatchStatsPdf()` và `buildStatsContext()` trong `src/lib/dispatch-pdf.ts` nhận `selectedDois?: string[]` / `selectedVehicles?: string[]`. Context line PDF ghép nhiều giá trị bằng `", "`; tên file PDF ghép nhiều giá trị đã `safeName()` hoá bằng `-`.
- Khi sửa tiếp các hàm này, phải đồng bộ type ở tất cả nơi gọi (`page.tsx` ↔ `dispatch-analytics.ts` ↔ `dispatch-pdf.ts`) — đúng bài học lỗi build `selectedNote` đã ghi ở trên.

## ⚠️ Đính chính quan trọng 2026-07-21 — `dispatch_entries.rows` (JSONB) mới là nguồn thật, KHÔNG phải `dispatch_entry_rows` (bảng vật lý)

Toàn bộ mô tả "`dispatch_entry_rows` là source of truth, `dispatch_entries.rows` chỉ là cache legacy" ở phía trên (và ở `.claude/rules/03-database-schema.md`, `01-project-overview.md`) **đã lỗi thời kể từ migration `supabase/migrations/20260612_restore_dispatch_entries_rows_source.sql`**. Đã xác nhận bằng cách đọc trực tiếp code hiện tại và verify bằng script query dữ liệu thật (2026-07-21):

- `20260611_drop_dispatch_entries_rows.sql` từng DROP cột `dispatch_entries.rows` (với comment "runtime code now hydrates trip rows directly from dispatch_entry_rows").
- Ngay hôm sau, `20260612_restore_dispatch_entries_rows_source.sql` phải **thêm lại** cột này, backfill 1 lần từ `dispatch_entry_rows`, và ghi rõ comment DB: `'SOURCE OF TRUTH for dispatch trip rows. Application runtime must read/write this column only.'` — tức là bản drop ngày 11 đã gây lỗi và bị rollback ngay ngày 12.
- Code hiện tại đúng như comment đó: `writeBackToDispatch()` (`src/app/dashboard/output/_components/output-types.ts`) và `loadDispatchEntriesWithResolvedRows()` (`src/lib/dispatch-entry-rows.ts`) đều **chỉ đọc/ghi `dispatch_entries.rows` (JSONB)** — không đụng tới bảng vật lý `dispatch_entry_rows` ở bất kỳ đâu trong 2 hàm này.
- Hệ quả: bảng vật lý `dispatch_entry_rows` **đã bị đóng băng (stale) kể từ 2026-06-12** — mọi thay đổi điều xe/sản lượng sau ngày đó chỉ phản ánh trong JSONB, không còn ghi vào bảng vật lý. Bất kỳ code/script nào query trực tiếp `dispatch_entry_rows` để lấy dữ liệu "hiện tại" sẽ nhận về số liệu cũ/thiếu (đã verify: tổng `kl_dck` tháng 6/2026 từ bảng vật lý chỉ ra ~498k kg, trong khi JSONB + `production_records` khớp đúng ~1.117k kg).
- **Quy tắc cho code mới**: đọc/ghi chi tiết chuyến điều xe phải qua `loadDispatchEntriesWithResolvedRows()` (đọc `dispatch_entries.rows`) hoặc trực tiếp `dispatch_entries.select("id,ngay,rows")` — **không** query `dispatch_entry_rows` nữa cho dữ liệu runtime. Không xóa bảng vật lý (có thể vẫn được tham chiếu ở đâu đó hoặc giữ cho mục đích lịch sử), nhưng không coi nó là nguồn tin cậy.
- Ref liên kết trip vào ngăn lưu (`ngans.trips[]`, `buildDispatchTripRef`) dùng `rowId = row.row_id || row.uid` lấy từ chính JSONB — nếu đối chiếu bằng script, phải dùng đúng field này (giá trị dạng `"r47_0"` kiểu cũ), không phải `dispatch_entry_rows.id` (UUID) hay `uid_legacy`.

## Bug nghiêm trọng đã fix 2026-07-11: `cloneRow`/`cloneRowsTemplate` làm trùng `row_id`, gây "mất" chuyến xe ở module Kho nguyên liệu

### Triệu chứng

Người dùng báo: khi tạo/sửa ngăn ở Kho nguyên liệu và chọn "Chuyến xe từ Điều xe", chỉ chuyến 1 của một số xe hiển thị được để chọn, các chuyến sau (chuyến 2, 3...) "biến mất" khỏi danh sách — ví dụ ngăn N21 (07/07/2026, "Mủ đông chén") thiếu hẳn `7A` chuyến 2 và `22A` chuyến 2, khiến tổng KL của ngăn bị thiếu so với thực tế.

### Nguyên nhân gốc

`cloneRow()` (nút "Nhân bản dòng") và `cloneRowsTemplate()` (dùng bởi "Nhân bản phiếu này" / mở form "Thêm mới" tự động clone từ phiếu gần nhất) trong `src/app/dashboard/dispatch/page.tsx` khi nhân bản 1 dòng chỉ sinh `uid` mới nhưng **không reset `row_id` cũ** — dòng clone giữ nguyên `row_id` của dòng nguồn. Vì `ref` liên kết trip trong module Kho nguyên liệu = `` `${dispatchEntryId}::${rowId}` `` (`buildDispatchTripRef` trong `src/lib/storage-detail.ts`), khi 2-3 dòng vật lý khác nhau (khác xe, khác chuyến, khác KL) trong CÙNG 1 phiếu chia sẻ chung `row_id`, code dedupe-theo-ref (`loadDispatchTripsByDateRange`/`loadDispatchTripsByUids`) chỉ giữ được dòng đầu tiên gặp trong mảng — các dòng trùng còn lại bị "nuốt mất" khỏi danh sách chọn chuyến.

KL từng dòng (`kl_dct`, `kl_dck`...) không hề bị hỏng — `writeBackToDispatch` (module Sản lượng) ghi KL theo khóa nghiệp vụ `so_xe:chuyen` (không phải `row_id`) nên không bị ảnh hưởng. Chỉ có `row_id` (dùng để liên kết trip vào `ngans.trips[]`) là bị trùng.

### Fix code (đã áp dụng)

`cloneRowsTemplate()` và `cloneRow()` giờ thêm `row_id: undefined` vào object spread khi tạo dòng clone (cạnh `uid: ...` đã có). Khi lưu, `legacyDispatchRowToDb()` (`src/lib/dispatch-entry-rows.ts`) có fallback `row_id: row.row_id || row.uid || ...` — nếu `row_id` là falsy, nó tự dùng `uid` mới (đã unique) làm `row_id`.

### Data repair đã chạy (2026-07-11)

Quét toàn bộ factory `phuochoa_kt` phát hiện **12/165 phiếu điều xe đã bị trùng `row_id`, 67 dòng bị ảnh hưởng** (dữ liệu lịch sử phát sinh từ trước khi có fix trên). Đã viết `scripts/fix-duplicate-dispatch-row-ids.mjs` (dry-run mặc định, cần flag `--apply` để ghi DB thật — in ra toàn bộ danh sách thay đổi dự kiến trước khi ghi) và đã chạy `--apply` thành công: 12 phiếu được sửa, 34 dòng được cấp `row_id` mới (giữ nguyên `row_id` của dòng đầu tiên trong mỗi nhóm trùng, không đổi `so_xe`/`chuyen`/`uid`/KL). Quét lại xác nhận 0/165 phiếu còn trùng `row_id`.

**Quan trọng**: script chỉ khôi phục tính duy nhất của `row_id` và tính lại `tong_tuoi`/`tong_kho` của ngăn theo đúng các trip đã có sẵn trong `ngans.trips[]` — nó **không tự động thêm** chuyến trước đây bị ẩn vào `trips[]` của ngăn nào cả (hệ thống không thể tự suy luận người dùng có muốn gộp thêm đúng chuyến đó vào đúng ngăn đó hay không). Sau khi chạy repair, người dùng phải tự vào `Kho nguyên liệu → Sửa ngăn` để tick chọn bổ sung các chuyến giờ đã hiển thị lại được.

### Quy tắc chung cho code mới

Bất kỳ hàm nào nhân bản/duplicate 1 dòng `DxRow` trong tương lai đều phải reset `row_id` (set `undefined`) giống `uid` — không được spread `{...src}` rồi chỉ đổi `uid` mà quên `row_id`, nếu không sẽ tái tạo đúng bug này.

## Ghi chú từng dòng chuyến bắt buộc chọn từ danh mục (Cập nhật 2026-07-22)

Chi tiết đầy đủ cơ chế + component dùng chung xem `.claude/rules/04-settings-master-data.md` mục "4.11. Ghi chú bắt buộc". Tóm tắt riêng phạm vi Điều xe:

- Ô "Ghi chú" của từng dòng chuyến trong bảng điều xe (`dispatch_entry_rows.ghi_chu`, qua JSONB `dispatch_entries.rows[].ghi_chu`) đổi từ `<input list="dispatch-required-notes">` sang `RequiredNoteSelect` (`src/app/dashboard/_components/required-note-select.tsx`) — chỉ chọn được từ `required_notes`, có quick-add tích hợp riêng cho từng dòng.
- Nút toolbar "+ Thêm ghi chú" sẵn có (gọi `handleAddRequiredNote`, chỉ thêm vào danh mục, không gán vào dòng nào) **vẫn giữ nguyên, không xóa** — không xung đột với quick-add tích hợp trong component mới, cả 2 cùng ghi vào chung bảng `required_notes`.
- Kỹ thuật định vị dropdown: vì ô này nằm trong `<td>` của bảng có thể cuộn ngang/nhiều dòng, `RequiredNoteSelect` dùng `createPortal` + `position: fixed` (mirror đúng kỹ thuật của `SmartMultiSelect` đã có sẵn trong file này) để panel không bị cắt hình bởi bảng — không dùng `position: absolute` kiểu `FilterMultiSelect` (sẽ bị kẹt trong vùng nhìn thấy của dòng/bảng).
- Filter "Ghi chú" (`filterGhiChu`, `<select>` Pattern A ở tab Danh sách/Thống kê) **không đổi** — vẫn build option từ `required_notes` như cũ, không liên quan tới thay đổi này.
- `tripNoteOptions` trong module Kho nguyên liệu (`storage/page.tsx`, phần "Chuyến xe từ Điều xe" khi tạo/sửa ngăn) đổi nguồn thành hợp `required_notes ∪ giá trị lịch sử còn tồn tại trong dữ liệu điều xe` — xem `.claude/rules/storage.md` mục liên quan.
