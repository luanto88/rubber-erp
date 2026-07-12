# Module Ngan Luu va Thanh Pham

## 1. Trang thai ngan hop le

Chi co 5 trang thai hop le:

- `Dang nhan (Can cap nhat)`
- `Cho san xuat`
- `Dang san xuat`
- `Da san xuat`
- `Dong`

Khong co trang thai `Hoan thanh` cho ngan.

## 2. Rule tao ngan

- Vi tri ngan goi y theo danh sach `N1 -> N24`
- Phai an cac ngan dang duoc su dung o cac trang thai:
  - `Dang nhan (Can cap nhat)`
  - `Cho san xuat`
  - `Dang san xuat`
  - `Dong`
- Cho phep nhap tay ten ngan, toi da 10 ky tu
- `ma_ngan` la field tu sinh, khong cho sua tay
- `KL tuoi` va `KL kho` la field read-only, tu tinh tu danh sach xe da chon
- Sau khi tao / sua ngan, `tong_tuoi` va `tong_kho` co the duoc cap nhat lai tu dong boi `writeBackToDispatch` trong module San luong khi san luong thay doi (xem muc 9)

### Quyen sua ngan theo trang thai (cap nhat 2026-07-07)

- User thuong (`storage.create`/`storage.edit`) chi duoc sua ngan khi trang thai la `Dang nhan (Can cap nhat)`, `Dong`, hoac `Cho san xuat`.
- Admin duoc sua ngan o **moi trang thai**, ke ca `Dang san xuat` va `Da san xuat` — dung de dong bo lai khoi luong nguyen lieu (them/bot chuyen, doi ngay) khi du lieu dieu xe co sai lech phat sinh sau khi ngan da vao san xuat.
- Nut "Sua" o tab "Dang hoat dong" (card) va tab "Lich su" (bang, chi gom ngan `Da san xuat`) deu ap dung dung rule nay — `openEdit()` va dieu kien hien nut deu check `isAdmin` truoc khi check trang thai.
- Code: `src/app/dashboard/storage/page.tsx` — ham `openEdit()` va bien `canEditThisNgan` (tab Dang hoat dong) / nut Sua trong bang tab Lich su.

## 3. Tinh khoi luong theo loai nguyen lieu

Khi tao / sua ngan, chi duoc cong dung cot KL cua dung loai nguyen lieu da chon:

- `Mu chen` -> `kl_ct`, `kl_ck`
- `Mu dong chen` -> `kl_dct`, `kl_dck`
- `Mu dong khoi` -> `kl_dkt`, `kl_dkk`
- `Mu day` -> `kl_dt`, `kl_dk`
- `Mu nuoc` -> `kl_mn`, `kl_mnk`

Helper tham chieu trong code: `getKLFromTrip(...)` tai `src/app/dashboard/storage/page.tsx`.

## 4. Auto-transition ngan

- Chi co `ngay_bd`, chua co `ngay_kt` -> `Dang nhan (Can cap nhat)`
- Co ca `ngay_bd` va `ngay_kt` -> `Cho san xuat` sau khi du dieu kien dong me theo UI hien tai
- Ngan du 21 ngay moi duoc xem la san sang dua vao san xuat
- Module thanh pham chi duoc chon cac ngan hop le theo rule nghiep vu hien hanh

## 5. Quan he ngan va thanh pham

### Khi tao lo thanh pham

- Chon ngan trong module thanh pham -> ngan chuyen sang `Dang san xuat`
- Bam `Luu va danh dau da san xuat` -> ngan chuyen sang `Da san xuat`

### Khi xoa lo thanh pham

- Neu xoa het lo cua ngan -> ngan quay ve `Cho san xuat`

### Khi sua lo thanh pham va doi sang ngan khac

Truoc khi luu:

- Neu ty le lap day du kien cua ngan dich > `110%` -> chan thao tac

Sau khi luu:

- Tinh lai ca `ngan cu` va `ngan moi`
- Neu ngan khong con lo nao -> `Cho san xuat`
- Neu ty le lap day `< 100%` -> `Dang san xuat`
- Neu ty le nam trong `100% - 110%` -> giu nguyen trang thai hien tai

## 6. Rule ty le lap day

- Ty le lap day = `tong tong_kg cac lo trong ngan / tong_kho ngan * 100`
- Muc `100% - 110%` la vung hop le de tiep tuc giu trang thai hien tai
- Vuot `110%` thi khong cho chuyen lo sang ngan do trong form sua

## 7. Chi tiet ngan luu tren UI

Khi bam `Xem chi tiet` trong module ngan luu:

- Luon hien thi `Thong tin ngan` truoc
- Phan thanh pham khong hien danh sach dai ngay tu dau
- Phai gom nhom thanh pham theo:
  - `loai thanh pham + loai banh + loai boc`
- Moi nhom chi hien 1 header tong hop:
  - ten nhom
  - tong `kg`
  - tong so `lo`
  - tong so `ngay san xuat`
- Khi click vao header nhom -> mo danh sach `ngay san xuat`
- Moi ngay san xuat chi hien 1 dong tong hop:
  - ngay
  - ten nhom
  - tong `kg`
  - tong so `lo`
- Khi click vao tung ngay -> moi hien danh sach `lo thanh pham` chi tiet

Muc tieu UI:

- Khong de modal thanh mot danh sach dai va cung
- Uu tien tong quan truoc, chi tiet sau
- Nguoi dung di tu `ngan -> nhom thanh pham -> ngay san xuat -> lo chi tiet`

## 8. Code references

- UI ngan luu: `src/app/dashboard/storage/page.tsx`
- UI thanh pham: `src/app/dashboard/product/page.tsx`
- Rule sync trang thai ngan khi sua lo: `handleEditSave`
- Rule chi tiet ngan theo nhom / ngay / lo: `openView`, `groupedViewLots`
- KL mapping dispatch → ngan: `getKLFromTrip(...)` tai `storage/page.tsx` — phai dong bo voi `getNganKL(...)` trong `output-types.ts`

## 9. Tu dong dong bo KL ngan tu module San luong

`tong_tuoi` va `tong_kho` cua ngan khong chi duoc tinh khi tao / sua ngan.
Chung con duoc **cap nhat lai tu dong** moi khi san luong thay doi, thong qua ham `writeBackToDispatch` trong module San luong.

### Chuoi xu ly

```
production_records thay doi (import / save / delete)
  → writeBackToDispatch(factoryId, ngay, supabase)
    → cap nhat dispatch_entry_rows truoc (kl_* / drc_*)
    → sync lai dispatch_entries.rows[] neu con bat cache legacy
    → tim ngan co trips[] chua bat ky uid nao thuoc ngay do
    → load lai toan bo dispatch (moi ngay) de build uid→KL map chinh xac
    → tinh lai tong_tuoi / tong_kho cho tung ngan bi anh huong
    → UPDATE ngans
```

### Quy tac quan trong

- Ngan tich luy KL tu nhieu ngay. Buoc tinh lai phai dung **toan bo trips cua ngan** (khong chi ngay hien tai) — vi vay `writeBackToDispatch` load lai toan bo dispatch sau khi da update xong ngay do.
- Neu ngay do khong co uid nao thuoc ngan → ngan khong bi anh huong → khong co UPDATE.
- Nguoi dung **khong can mo lai form ngan** de cap nhat KL — he thong tu dong xu ly.
- Ham `getNganKL` trong `output-types.ts` phai mirror chinh xac `getKLFromTrip` trong `storage/page.tsx`. Neu sua mot ham, phai sua ca hai.

## 10. Cập nhật session 2026-06-06 - Ngăn lưu

### Phạm vi đã chốt

- Đã chạy migration thêm 2 cột `xe_tu_ngay`, `xe_den_ngay` vào bảng `ngans`.
- View dashboard ngăn và PDF chi tiết ngăn hiện đã hoạt động lại sau khi DB có đủ cột.
- QR tra cứu ngăn dùng route chi tiết `/dashboard/storage/[id]`.

### Rule nghiệp vụ đã áp dụng

- `Xé từ ngày = ngay_bd + 1`
- `Xé đến ngày = ngay_kt + 1`
- Báo cáo theo kỳ chỉ lấy các ngăn có:
  - `ngay_bd >= tu_ngay`
  - `ngay_kt <= den_ngay`
- Ngăn chưa có `ngay_kt` thì không vào báo cáo kỳ.

### Rule UI chi tiết ngăn

- Danh sách thành phẩm trong modal chi tiết vẫn đi theo luồng:
  - `ngăn -> nhóm thành phẩm -> ngày sản xuất -> lô chi tiết`
- Khi danh sách dài, modal phải có vùng cuộn riêng để không làm kẹt nút đóng.
- Hành động trên card dashboard hiện có thêm:
  - mở QR / tra cứu
  - xuất PDF chi tiết
  - xuất GeoJSON
  - xem chi tiết
  - sửa
  - xóa

### Rule xuất GeoJSON của ngăn

- Nút `GeoJSON` nằm cạnh nút `Xuất PDF` trên card ngăn ở dashboard.
- GeoJSON lấy theo toàn bộ `trip uid` đã gắn trong `ngans.trips`.
- Nguồn dữ liệu lô vườn:
  - ưu tiên `forest_plots`
  - fallback file tĩnh `/geojson/Lo cao su - 2026_Full.geojson`
- Nếu ngăn chưa có `lo_thu_hoach` từ các chuyến đã gắn thì không xuất file, phải báo lỗi rõ cho người dùng.

### Rule PDF chi tiết ngăn

- QR của phiếu chi tiết ngăn phải nằm gọn trong header màu xanh, góc phải.
- Không để QR rơi xuống vùng bảng `Thông tin ngăn lưu`.
- Header phiếu hiện gồm:
  - tên nhà máy
  - dòng mô tả báo cáo
  - tiêu đề phiếu
  - dòng thời gian nguyên liệu
  - QR góc phải

### File chính đã chạm trong session này

- `src/app/dashboard/storage/page.tsx`
- `src/lib/storage-detail.ts`
- `src/lib/storage-pdf.ts`
- `supabase/migrations/20260606_storage_xe_dates.sql`
- `supabase/schema.sql`
- `src/types/index.ts`

## 11. Cập nhật 2026-07-03 — Tab "Đang hoạt động" / "Lịch sử" (mobile UX)

- Danh sách ngăn ở `/dashboard/storage` tách thành 2 tab, state `nganTab: "active" | "history"`:
  - `Đang hoạt động` (mặc định): card grid như cũ (`columns-1 lg:columns-2 2xl:columns-3`), chỉ chứa ngăn có `trang_thai !== "Đã sản xuất"`.
  - `Lịch sử`: toàn bộ ngăn `trang_thai === "Đã sản xuất"`, hiển thị dạng bảng (`ResponsiveTableWrapper`), không có QR, chỉ cột thông tin chính (Mã ngăn, Loại NL, KL tươi/khô, TP/QK %, Ngày lưu ủ, Hành động).
  - Cả 2 tab đều dẫn xuất từ cùng `filtered` (đã áp `dcLoaiNL`, `filterTT`, `filterGhiChu`, `search`, khoảng ngày báo cáo) — không tạo query/state lọc riêng cho từng tab.
  - Dropdown lọc trạng thái (`filterTT`) không còn option "Đã sản xuất" và bị disable khi đang ở tab Lịch sử (trạng thái đã cố định theo tab).
- Ngăn tự "chuyển tab" khi trạng thái đổi vì cả 2 mảng đều derive lại từ `filtered` mỗi render — không cache riêng theo tab.
- Nút "Về đang SX" (chỉ admin, business rule bắt buộc giữ — xem `.claude/rules/06-module-production.md` mục Kho nguyên liệu) vẫn tồn tại ở tab Lịch sử dưới dạng nút gọn trong cột "Hành động" của bảng, gọi đúng `handleNganStatusToggle(n.id, STORAGE_STATUS_IN_PRODUCTION)` như card cũ — không đổi logic quyền/nghiệp vụ.
- Card tab Đang hoạt động: đã bỏ khối QR to ở footer (chỉ còn icon QR ở header dẫn tới `/dashboard/storage/[id]`); icon nút "Thu gọn" đổi từ `X` xám sang `Minus` để không còn giống hệt icon `X` đỏ của nút "Xóa"; card dùng `shadow-sm` (không còn `shadow-md` + viền cứng); các nút hành động (QR/PDF/GeoJSON/Xem/Sửa/Xóa — không gồm nút toggle trạng thái) chỉ mờ đi ở desktop khi không hover (`md:opacity-0 md:group-hover:opacity-100`), luôn hiện rõ trên mobile vì thiết bị cảm ứng không có hover.

## 12. Cập nhật 2026-07-07 — Trạng thái nổi bật trên trang tra cứu công khai `/storage`

- Trang tra cứu công khai (`src/app/storage/page.tsx` → `StorageDetailClient` tại `src/app/dashboard/storage/_components/storage-detail-client.tsx`) trước đây **không hiển thị `trang_thai` của ngăn ở đâu cả** — người quét QR ngoài hiện trường chỉ thấy loại nguyên liệu/khối lượng, không biết ngăn đang ở trạng thái gì. Đã fix bằng cách thêm 1 badge trạng thái nổi bật ngay dưới tiêu đề.
- Helper dùng chung mới trong `src/lib/storage-status.ts` (không đổi hành vi của các hàm cũ, chỉ thêm mới):
  - `getStorageStatusLabelEn(status)` — bảng dịch tiếng Anh cố định cho 5 trạng thái hợp lệ (`Receiving`, `Closed`, `Awaiting production`, `In production`, `Produced`).
  - `getStorageStatusTheme(status)` — trả `{ badge, dot, gradient }` dùng chung màu sắc với `badgeClass`/`headerStyle` đã có sẵn trong `storage/page.tsx` (không refactor lại 2 hàm cũ đó để tránh rủi ro, chỉ thêm bản mới dùng riêng cho trang public).
- `StorageDetailClient` hiển thị badge dạng pill full-width, có chấm màu + nhãn tiếng Việt in đậm + nhãn tiếng Anh nhạt hơn ngay sau (`{statusLabelVi} · {statusLabelEn}`), đặt trong khối riêng ngay dưới hàng tiêu đề/nút "Xuất PDF chi tiết" — luôn hiển thị đầy đủ trên cả mobile (full width, wrap) và desktop (inline, không bị nút PDF che khuất vì đã tách hàng riêng).
- Khối "Thông tin ngăn lưu" (card gradient chứa Loại nguyên liệu/Ngày nguyên liệu/KL...) đổi từ gradient `emerald→cyan` cố định sang `statusTheme.gradient` động theo đúng trạng thái hiện tại của ngăn — nhất quán với cách `headerStyle()` tô màu card theo trạng thái ở `/dashboard/storage`.

## 13. Cập nhật 2026-07-07 — Tab "In QR hàng loạt" (nhãn cắt dán hiện trường)

- Thêm tab thứ 3 ở `/dashboard/storage` cạnh "Đang hoạt động" / "Lịch sử": `nganTab: "active" | "history" | "print"`. Phạm vi chọn = dùng chung `activeNgans` (mọi trạng thái trừ `Đã sản xuất`) — không tạo query/filter riêng.
- UI: action bar ("Chọn tất cả (N)" / "Bỏ chọn tất cả" / đếm đã chọn / nút "In QR đã chọn (N)") + grid card chọn gọn (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6`), mỗi card là 1 `<button>` toggle toàn bộ khi click (phong cách giống `CompactItemSelectorCard` ở `src/app/dashboard/inventory/_components/inventory-ui.tsx` — border/bg đổi màu tím `violet` khi chọn + badge check tròn góc phải trên), hiển thị `ten_ngan` đậm, `ma_ngan` nhỏ (`break-all`), badge trạng thái dùng `badgeClass` sẵn có. State chọn `selectedPrintIds: Set<string>` độc lập với filter — đổi filter không tự bỏ chọn ngăn đã chọn trước đó; "Chọn tất cả" chỉ áp dụng theo `activeNgans` đang hiển thị.
- Hàm PDF mới `downloadStorageBulkQrPdf(ngans)` trong `src/lib/storage-pdf.ts` — tạo 1 file PDF A4 portrait chứa lưới nhãn QR **35×35mm đúng kích thước vật lý**, mỗi QR kèm dòng `ma_ngan` đầy đủ in bên dưới (không phải `ten_ngan` ngắn — đã chốt với người dùng vì mục đích là nhãn nhận diện tại hiện trường, chấp nhận chuỗi dài ~25-30 ký tự có dấu tiếng Việt), có khung viền nét đứt quanh mỗi nhãn làm đường cắt tham khảo (`doc.setLineDashPattern`).
  - Lưới tự tính theo kích thước trang thật qua `computeBulkQrGridLayout(doc)`: mặc định ra **4 cột × 5 hàng = 20 nhãn/trang** trên A4, tự phân trang (`doc.addPage()`) khi vượt `perPage`, tiêu đề mỗi trang tối giản 1 dòng (`renderBulkQrPageHeader`) — **không** dùng banner `renderHeader`/`renderFooter` sẵn có (quá to, lãng phí diện tích in nhãn).
  - `ma_ngan` dài được wrap tối đa 2 dòng qua `doc.splitTextToSize(label, QR_LABEL_SIZE_MM)` (đã xác nhận jsPDF wrap đúng chuỗi dài không khoảng trắng dạng `"N8-NT-ĐC-X-16/06/26-18/06/26"`), dòng cuối bị cắt bớt kèm `…` nếu vẫn dư sau 2 dòng. Fallback nhãn: `ma_ngan || ten_ngan || "—"`.
  - QR payload mỗi ngăn dùng `buildStorageLookupUrl(ngan.id, ngan.ma_ngan)` — giống hệt QR đơn lẻ ở trang chi tiết/tra cứu, quét ra đúng `/storage?id=...`.
- Không thêm permission mới — dùng chung guard `storage.view` sẵn có của trang.

Xem thêm quyết định thiết kế/plan implementation gốc tại lịch sử phiên làm việc nếu cần đối chiếu chi tiết công thức layout.

## 14. Fix nghiêm trọng 2026-07-07 — `/storage` (trang tra cứu công khai) bị lỗi 500 do SSR crash với `leaflet`

- **Phát hiện khi test tab "In QR hàng loạt"** ở mục 13: quét bất kỳ QR ngăn nào (kể cả QR cũ đã in trước đây) đều dẫn tới lỗi 500 — đã xác nhận lỗi này tồn tại ở **cả dev lẫn production** (`qlsxkpt.vercel.app/storage` cũng 500 tại thời điểm phát hiện), tức là toàn bộ tính năng tra cứu qua QR ngoài hiện trường đã bị hỏng từ trước, không liên quan gì đến tính năng in QR hàng loạt.
- **Nguyên nhân**: `src/app/dashboard/storage/_components/storage-geojson-map.tsx` `import L from "leaflet"` ở top-level — thư viện `leaflet` đọc `window` ngay khi module được load (không đợi render). File này được `storage-detail-client.tsx` import **tĩnh** (`import { StorageGeoJsonMap } from ...`), nên khi Next.js server-render trang `/storage` (client component vẫn được render ra HTML ban đầu trên server), toàn bộ cây module bị load kể cả `leaflet` → `ReferenceError: window is not defined` → crash toàn trang.
- **Fix**: đổi sang `next/dynamic` với `ssr: false` trong `storage-detail-client.tsx`:
  ```ts
  const StorageGeoJsonMap = dynamic(
    () => import("@/app/dashboard/storage/_components/storage-geojson-map").then(m => m.StorageGeoJsonMap),
    { ssr: false, loading: () => <div>Đang tải bản đồ...</div> },
  )
  ```
  Nhờ vậy `leaflet` chỉ được load ở client, không bao giờ chạy trong quá trình SSR.
- Đã verify: `/storage` và `/storage?id=...` trả về 200 sau fix (trước đó 500), nội dung trang render đúng ("Tra cứu ngăn lưu nguyên liệu"...). Chỉ có **1 nơi duy nhất** import `StorageGeoJsonMap` trong toàn repo (`storage-detail-client.tsx`) nên fix này đã bao phủ đủ mọi route dùng chung component này (cả `/storage` công khai lẫn mọi trang dashboard nào render lại `StorageDetailClient`).
- **Quy tắc cho code mới**: bất kỳ thư viện nào phụ thuộc trực tiếp vào `window`/`document` ở top-level module (leaflet, các thư viện vẽ bản đồ/canvas khác) khi dùng trong cây component có khả năng bị Next.js server-render (page không đánh dấu client-only ở tầng route) đều phải import qua `next/dynamic({ ssr: false })`, không import tĩnh trực tiếp.
- **Chưa deploy lên production** — fix này mới nằm trong working tree (`git status` sẽ thấy `storage-detail-client.tsx` modified), cần commit + deploy để khôi phục tính năng tra cứu QR trên `qlsxkpt.vercel.app`.

## 15. Cập nhật 2026-07-11 — Bug "chuyến xe bị ẩn" đã fix (nguồn gốc thật ở Điều xe, không phải Storage), + 3 tính năng bổ sung

### Bug "chỉ chuyến 1 hiển thị" khi chọn chuyến xe cho ngăn

Đã điều tra và xác nhận: nguyên nhân **không nằm trong code Storage** (mọi nơi trong `storage/page.tsx`/`storage-detail.ts` đều đọc cột `chuyen` trực tiếp, không parse từ chuỗi `so_xe`). Nguồn gốc thật là bug `row_id` bị trùng khi nhân bản dòng ở module Điều xe (`cloneRow`/`cloneRowsTemplate` trong `dispatch/page.tsx`) — chi tiết đầy đủ, cách fix code, và data repair đã chạy xem tại `.claude/rules/19-dispatch-module.md` mục "Bug nghiêm trọng đã fix 2026-07-11". Đã chạy `scripts/fix-duplicate-dispatch-row-ids.mjs --apply` thành công trên factory `phuochoa_kt` (12 phiếu, 34 dòng được cấp `row_id` mới), xác nhận 0/165 phiếu còn trùng.

**Lưu ý nghiệp vụ**: repair script chỉ khôi phục `row_id` duy nhất, không tự thêm chuyến bị ẩn trước đây vào `ngan.trips[]` — sau khi chạy repair, người dùng phải tự vào `Sửa ngăn` để tick chọn bổ sung các chuyến giờ đã hiển thị lại được (dùng bộ lọc Ghi chú mới — xem mục dưới — để tìm nhanh nếu số lượng chuyến trong ngày nhiều).

### Filter "Ghi chú" trong bảng chọn "Chuyến xe từ Điều xe" (tạo/sửa ngăn)

- `StorageTripItem` (`src/lib/storage-detail.ts`) thêm field `ghi_chu: string`, populate trong `mapTripRow()` từ `row.ghi_chu` (dispatch row).
- `storage/page.tsx` thêm state `tripNoteFilter: string[]` (multi-select, dùng `FilterMultiSelect` + `matchesNoteFilterMulti` từ `src/lib/note-filter.ts`), **mặc định rỗng = hiển thị tất cả** — reset về `[]` mỗi khi mở modal "Thêm mới" hoặc "Sửa" (trong `openAdd()`/`openEdit()`).
- `tripNoteOptions` (options cho dropdown) và `noteFilteredTrips` (danh sách trip đã lọc) là 2 `useMemo` tính từ `dispatchTrips` (danh sách trip đã gộp linked+available).
- Bảng "Chuyến xe từ Điều xe" render theo `noteFilteredTrips` (không phải `dispatchTrips` thô nữa), thêm cột "Ghi chú"; nút "Chọn tất cả" chỉ chọn các trip đang hiển thị theo filter hiện tại (không chọn cả các trip bị ẩn bởi filter).
- Nếu `dispatchTrips` không rỗng nhưng `noteFilteredTrips` rỗng (filter Ghi chú quá hẹp), hiện thông báo riêng "Không có chuyến xe nào khớp bộ lọc Ghi chú đang chọn" (khác với "Không có chuyến xe trong khoảng ngày này").

### Nút "Đồng bộ nhanh" sản lượng trên thẻ ngăn

- Icon `RefreshCw` (màu teal) trên mỗi thẻ ngăn ở tab "Đang hoạt động", cạnh nút "Sửa" — chỉ hiện khi `canEditThisNgan`.
- `handleQuickSyncNgan(ngan)` gọi lại `resolveStorageNgansActualTotals(factoryId, [ngan], { persist: true })` **chỉ cho 1 ngăn** (không tải lại toàn bộ trang) — tính lại `tong_tuoi`/`tong_kho` theo đúng các trip đã có sẵn trong `ngan.trips[]`, cập nhật state `ngans` tại chỗ.
- Không tự thêm/bớt trip nào khỏi `ngan.trips[]` — chỉ recompute KL từ tập trip hiện có, dùng để đồng bộ lại số liệu khi dữ liệu Điều xe/Sản lượng đổi sau khi ngăn đã tạo (ví dụ sau khi chạy repair script `row_id` ở trên, hoặc sau khi ai đó sửa/import lại Sản lượng).
- Thông báo kết quả (`nganSyncMessage[nganId]`, tự ẩn sau 5s) hiện ngay dưới dòng "KL tươi / khô" trên thẻ — dạng "Đã đồng bộ — không có thay đổi" hoặc "Đã đồng bộ — KL khô X → Y kg".
- State: `nganSyncingId` (đang đồng bộ, disable nút + icon xoay `animate-spin`), `nganSyncMessage: Record<string, string>`.

### Ngưỡng admin đánh dấu "Đã sản xuất" đổi từ `100%-110%` sang `>= 50%`

- `canMarkProduced` trong `storage/page.tsx` (nút "Đã SX" trên thẻ ngăn, chỉ admin thấy) đổi điều kiện từ `tpPct >= 100 && tpPct <= 110` sang `tpPct >= 50` (không giới hạn trên).
- **Chỉ áp dụng cho nút thủ công này** — ngưỡng `100%-110%` của banner hậu lưu trong module Thành phẩm (`product/page.tsx`, sau khi lưu phiếu thành phẩm) giữ nguyên không đổi, đây là 2 cơ chế độc lập nhau. Chi tiết xem `.claude/rules/06-module-production.md` mục "Rule lưu thành phẩm và trạng thái ngăn".
