---
description: Source of truth và cấu hình nhà máy cho matrix sản phẩm
---

# Factory Config Matrix

## Source of truth

File:

- `cung_cap_dl/du_lieu_nha_may.xlsx`

là source of truth cao nhất cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`
- `loai_pallet_xuat`

## Cách diễn giải

- Excel = dữ liệu chuẩn ban đầu để seed và đối chiếu spec
- Database = nguồn chạy thực tế
- Giá trị mở rộng runtime của từng nhà máy được lưu vào database

Không ghi ngược giá trị runtime vào file Excel.

## Quy tắc lọc

### Theo nhà máy

- `loai_pallet_xuat`
- `dispatch_delivery_points`

### Theo nhà máy + dây chuyền + chủng loại SP

- `loai_banh`
- `loai_boc`
- `loai_tham`

### Theo matrix cấu hình nhà máy

- `loai_pallet_sx`

## Rule `loai_tham`

- Tên cột cấu hình: `loai_tham`
- Ý nghĩa: loại thảm ngăn cách các bánh mủ
- UI hiển thị: `Thảm`
- Là dropdown
- Dữ liệu sử dụng 2 giá trị chuẩn: `Cũ`, `Mới`
- Khi đọc dữ liệu cũ phải normalize các giá trị lệch về `Cũ` hoặc `Mới`

## Cấu hình mặc định theo Excel

### NMPHK

- `Mủ tạp / 10`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG CSR10`
  - `loai_pallet_sx`: `Pallet sắt đế gỗ`, `Pallet sắt mỏng`, `Pallet MB5`, `Pallet gỗ`
  - `loai_pallet_xuat`: `Rời`, `Pallet sắt đế gỗ`
- `Mủ tạp / 20`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG CSR20`
  - `loai_pallet_sx`: như trên
  - `loai_pallet_xuat`: như trên
- `Mủ nước / L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / 3L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / CV50`
  - `loai_banh`: `35`, `20`
- `Mủ nước / CV60`
  - `loai_banh`: `35`, `20`

### NMCP

- `Mủ tạp / 10`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG SVR10`
  - `loai_pallet_sx`: `Pallet sắt đế gỗ`, `Pallet sắt đế nhựa`, `Pallet sắt mỏng`, `Pallet MB5`, `Pallet gỗ`
  - `loai_pallet_xuat`: `Rời`, `PE đế gỗ`, `PE đế nhựa`, `Pallet gỗ`, `MB4`, `MB5`
- `Mủ tạp / 20`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG SVR20`
  - `loai_pallet_sx`: như trên
  - `loai_pallet_xuat`: như trên
- `Mủ nước / L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / 3L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / CV50`
  - `loai_banh`: `35`, `20`
- `Mủ nước / CV60`
  - `loai_banh`: `35`, `20`

## Cấu hình runtime trong database

Hệ thống phải có cấu hình nhà máy để vận hành thực tế, có thể thiết kế theo logic của Excel và cho phép chỉnh sửa toàn bộ.

Nhóm cấu hình này phải hỗ trợ:

- chỉnh `loai_banh`
- chỉnh `loai_boc`
- chỉnh `loai_tham`
- chỉnh `loai_pallet_sx`
- chỉnh `loai_pallet_xuat`
- lưu giá trị mở rộng theo từng nhà máy

## Điểm giao nhận trong cấu hình nhà máy

Danh mục điểm giao nhận thuộc nhóm cấu hình theo nhà máy, không phải danh mục dùng chung toàn hệ thống.

Rule chính thức:

- Dữ liệu lưu trong bảng `dispatch_delivery_points`
- Quản trị tại `Cài đặt -> Cấu hình nhà máy -> Điểm giao nhận`
- Mỗi điểm gồm tối thiểu: `ma_lo`, `doi`, `lat`, `lng`, `phien_a`, `phien_b`, `phien_c`, `phien_d`, `sort_order`, `is_active`
- Module `Điều xe` và `EUDR` phải đọc theo bảng này
- Khi chỉnh cấu hình điểm giao nhận, các lần điều xe và truy xuất sau đó phải dùng logic mới

## Lô vườn trong cấu hình nhà máy

Danh mục lô vườn cao su thuộc nhóm cấu hình theo nhà máy, quản lý data địa lý cho EUDR.

Rule chính thức:

- Dữ liệu lưu trong bảng `forest_plots`
- Quản trị tại `Cài đặt → Cấu hình nhà máy → Lô vườn`
- `ten` là key khớp với `dispatch_delivery_points.phien_X[]` — không được đổi sau khi seed
- `geometry` lưu GeoJSON Polygon JSONB — không select trong list, chỉ load khi sửa
- Import hàng loạt: upload file `.geojson`, dedup theo `ten`, upsert `onConflict: factory_id,ten`
- Vẽ polygon trực tiếp trên bản đồ trong modal form (leaflet + `@geoman-io/leaflet-geoman-free`)
- Bản đồ vẽ polygon (`src/app/dashboard/settings/_components/PolygonDrawMap.tsx`) có ô tìm kiếm địa điểm (Nominatim/OpenStreetMap, không cần API key, ưu tiên kết quả `countrycodes=kh,vn` vì nguồn nguyên liệu trải khắp Campuchia và Việt Nam) để bay nhanh tới vùng cần khoanh, không phải kéo/zoom tay từ tâm mặc định Kampong Thom — 2026-08-07
- Module EUDR query DB trước, fallback file GeoJSON tĩnh nếu bảng rỗng

## Mục tiêu chất lượng trong cấu hình nhà máy

Danh mục mục tiêu chất lượng theo năm thuộc nhóm cấu hình theo nhà máy, phục vụ Báo cáo thống kê chất lượng của module Kiểm nghiệm.

Rule chính thức:

- Dữ liệu lưu trong bảng `quality_targets`
- Quản trị tại `Cài đặt → Cấu hình nhà máy → Mục tiêu chất lượng`
- Khóa duy nhất `(factory_id, nam, chi_tieu, san_pham)`
- Ngưỡng mục tiêu (`nguong_min`/`nguong_max`) độc lập với ngưỡng chấm Kiểm nghiệm chính thức (TCCS 112:2022/TCVN 3769:2016) — không dùng chung nguồn
- Nếu năm hiện tại chưa có mục tiêu, báo cáo tự fallback dùng mục tiêu năm liền trước

Chi tiết đầy đủ: `.claude/rules/25-quality-targets-reports-module.md`.

## Nút thêm nhanh

Trong module nghiệp vụ, `loai_pallet_sx` và `loai_pallet_xuat` có thể có nút `+`.

Rule:

- Giá trị mới chỉ áp dụng cho nhà máy đang đăng nhập
- Lưu vào database
- Tự động bổ sung vào cấu hình nhà máy để dùng cho các lần sau

## Quy cách đóng gói thành phẩm theo nhà máy — GĐ1 (2026-11-08, chờ chạy migration + test tay)
- Bọc / Pallet sản xuất / Thảm KHÔNG còn hard-code: bảng `product_packaging_types` (migration
  `20261108_product_packaging_types.sql`, **chạy tay TRƯỚC deploy**). Quản trị: Cài đặt → Cấu hình nhà máy →
  **Quy cách đóng gói TP** (`settings/_components/product-packaging-tab.tsx`).
- Mỗi mục: tên (bọc có token `{CSR}`), Dây chuyền / Chủng loại (multi, rỗng = tất cả), Mã vật tư kho (multi, GĐ1 chỉ
  lưu), Thành phần pallet (pallet_sx, thay `RECIPES` của pallet-usage.ts), Mặc định, Đang dùng.
- Nguồn logic DUY NHẤT: `src/lib/product-packaging.ts` (thuần) + loader `product-packaging-client.ts` /
  `product-packaging-server.ts`. `getBocsForLoaiCSR(dc, csr, cfg?)` không truyền cfg = danh sách mặc định cũ.
  Bảng lỗi/rỗng ⇒ `DEFAULT_PACKAGING` (phải khớp seed migration).
- Chỉ áp cho phiếu MỚI: lô cũ giữ chuỗi đã lưu (`mergeWithLegacy` giữ giá trị cũ trong form sửa). Mục đã có lô
  dùng ⇒ không đổi tên/xoá, chỉ tắt; đổi tên = thêm mới + tắt cũ.
- GĐ1 test tay PASS (2026-11-08).

## Quy cách chủng loại theo nhà máy — GĐ2 (2026-11-08, chờ chạy migration + test tay)
- Bảng `product_grade_types` (migration `20261116_product_grade_types.sql`, **chạy tay TRƯỚC deploy**): mỗi dòng =
  (dây chuyền, chủng loại, loại bành, bành/kiện, mặc định, thứ tự, đang dùng). **Lô tròn = 4 × bành/kiện**, không lưu
  riêng. Seed = quy tắc cũ theo `factories.prefix` (CSR/SVR — cột có sẵn, không còn so tên "cuaparis").
  Quản trị: Cài đặt → Cấu hình nhà máy → **Quy cách chủng loại** (`settings/_components/product-grade-tab.tsx`).
- Nguồn logic DUY NHẤT: `src/lib/product-grade.ts` (thuần) + `product-lot-config.ts`
  (`getLoaiBanhConfig(csr, banh?, cfg?)`, `getLoaiBanhOptions(csr, cfg?, current?)`,
  `getLoaiCSRByDayChuyen(dc, prefix, cfg?)`, `dayChuyenForCsr(csr, cfg?)`). Loader: `product-grade-client.ts` /
  `product-grade-server.ts` / `loadGradeConfigWith(client, fid)`. Không truyền cfg / bảng lỗi / rỗng ⇒ quy tắc cũ y hệt.
  Có bảng: dòng đúng (csr, bành) KỂ CẢ đã tắt → dòng mặc định của csr → quy tắc cũ (CSR lạ, "Ngoại lệ").
- SQL: `product_grade_lo_tron(factory, csr, bành)` cùng thứ tự tra như JS; `sync_lot_master_snapshot` (chép từ
  20260929) và trigger `update_lot_master_totals` (chép từ 20260708) chỉ đổi dòng tính lô tròn. Mọi
  `CREATE OR REPLACE` 2 hàm này về sau PHẢI chép từ `20261116_product_grade_types.sql`.
- Trigger `trg_product_grade_types_guard`: dòng đã dùng (lots / lot_prediction_lots / product_confirm_drafts, đếm
  bằng `product_grade_usage_count`) ⇒ không đổi chủng loại / loại bành / bành-kiện, không xoá (lỗi
  `PRODUCT_GRADE_IN_USE`). Chỉ tắt, đổi thứ tự, dây chuyền, mặc định.
- Đã gộp 3 bản sao (product/page, export/page, warehouse getMaxBanh) + nối: màn quét QR (+ gói offline có `grade`,
  `ctx.grade` cho `computeKienLookup`), predict, server actions (admin sửa giao dịch, nháp, gửi nháp), nhãn QR, chi
  tiết ngăn / báo cáo kỳ, chi tiết lô. Trang công khai `/storage` không đọc được bảng (RLS) ⇒ dùng quy tắc cũ.
- Khác biệt duy nhất với hàm cũ khi đã có bảng: lô L/3L KHÔNG có loại bành ⇒ kg = 35 (cũ 33,33); bành/kiện, lô tròn
  không đổi. Kiểm 2026-11-08: 380/380 PASS; dữ liệu thật 2.030 lô (CSR10×35) ⇒ 0 lô đổi trạng thái.
- CHƯA làm (GĐ3): ánh xạ thành phần pallet → mã vật tư kho (`PALLET_COMPONENT_ITEMS`), cột `quality/page.tsx`
  vẫn suy tiền tố từ `FACTORY_CODE`. Bàn giao: `.claude/plans/quy-cach-thanh-pham-gd2.md`.

## Thành phần pallet theo nhà máy — GĐ3 phần A (2026-11-08, chờ chạy migration + test tay)
- Bảng `pallet_components` (migration `20261117_pallet_components.sql`, **chạy tay TRƯỚC deploy**): `code` (bất biến),
  `ten`, `group_code` (dòng ở Kho vật tư → Tồn), `inventory_item_ids`, `la_nap` (nắp), `co_nap` (pallet nền cần chọn
  nắp — sắt dày DPH). Seed 7 thành phần cũ + `nap_sat` (NS), `nap_go` (NG). Trigger chặn đổi mã / xoá khi đang dùng ở
  `product_packaging_types.thanh_phan` hoặc `export_pallet_types.mat_thanh_phan` (phần B thêm `lot_transactions.nap`).
- Quản trị: Cài đặt → Cấu hình nhà máy → **Thành phần pallet** (`settings/_components/pallet-components-tab.tsx`); thêm
  được thành phần mới (vd Đế sắt). Nguồn logic: `src/lib/pallet-components.ts` + loader client/server; bảng lỗi/rỗng ⇒
  DEFAULT (gắn vật tư theo mã như bảng cứng cũ). Nắp không hiện trong chip thành phần của pallet SX / loại pallet xuất.
- Kế hoạch đầy đủ + phần B (nắp theo kiện): `.claude/plans/quy-cach-thanh-pham-gd3-nap.md`.

## Nắp pallet theo kiện + Xuất kèm nắp — GĐ3 phần B (2026-11-08, chờ chạy migration + test tay)
- Migration `20261118_lot_nap.sql` (**chạy tay TRƯỚC deploy**): `lot_transactions.nap` JSONB {"a":"nap_sat"},
  `product_confirm_drafts.nap`, `export_orders.xuat_nap`; hàm `pallet_names_need_nap` / `lot_nap_sanitize`. Mọi
  `CREATE OR REPLACE` submit_confirm_draft_batch / admin_update_lot_transaction / perform_sang_kien_thay_boc về sau PHẢI
  chép từ file này.
- Ô Nắp chỉ hiện khi pallet có thành phần `co_nap` (Sắt đế gỗ/nhựa); lựa chọn = thành phần `la_nap`. Nguồn logic:
  `src/lib/pallet-nap.ts`. Cảnh báo (không chặn) khi lô > `MAX_NAP_PER_LOT` = 2 nắp.
- Nơi nhập: Thành phẩm (Thêm phiếu theo block, Sửa giao dịch admin), màn quét QR (Lưu tạm, sửa nháp, hàng đợi offline,
  Lịch sử ca dòng 1 kiện). Hiển thị: chi tiết lô, F11. Xuất hàng: "Xuất kèm nắp" khi pallet xuất ≠ Rời.
- Tồn nắp (Kho vật tư → Tồn): như pallet — rời kho bằng đơn khác Rời + tick ⇒ mất; còn lại ⇒ trả về.
- Chi tiết + test tay: `.claude/plans/quy-cach-thanh-pham-gd3-nap.md` mục "Phần B".
