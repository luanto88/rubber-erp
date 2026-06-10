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
- Sau mọi thao tác import, thêm, sửa hoặc xóa ở module Sản lượng, phải chạy write-back để cập nhật lại khối lượng trên `dispatch_entries.rows` và `dispatch_entry_rows`.
- Không chấp nhận trạng thái Điều xe nhỏ hơn Sản lượng chỉ vì dữ liệu trùng ở `production_records`.
