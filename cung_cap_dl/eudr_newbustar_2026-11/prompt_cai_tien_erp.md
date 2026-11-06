# Prompt cải tiến module Xuất hàng / EUDR (phiên sau)

Dán nguyên khối dưới đây để mở phiên làm việc mới.

```
Đọc CLAUDE.md, rule 08 (Xuất hàng + EUDR), memory eudr-area-recovery và eudr_geometry_gotchas.
Bối cảnh: khách Newbustar (4500009691.geojson) phản hồi GeoJSON EUDR. Đã đo bằng pipeline thật
(traceExportOrderGeoChain + serializeEudrGeoJson) trên 11 đơn XH-NBS-* ngày 05/11/2026: đã hết lỗi
thiếu Producer/Country, toạ độ 3D, >6 số lẻ, điểm trùng, MultiPolygon. CÒN 5 lỗi sau, cần sửa trong code:

1. Bí danh mã lô (bảng forest_plot_code_aliases, 28 dòng, người dùng đã chốt 20/09/2026 — KHÔNG đổi):
   Đ/T chỉ là lịch cạo mủ: G13, G14, G16, H14, H15, J15, K13, K14, I-13→I13, I-14→I14, I-15→I15
   (điều xe ghi H14Đ hoặc H14T ⇒ lô H14); G15Đ→G15T, H13Đ→H13T, L6D→L6T, G8→G8N (G8B không liên
   quan); M6→M6S+M6T. Lỗi hiện tại: đơn chứa cả H14Đ và H14T (hoặc G15Đ và G15T…) xuất 2 feature
   cùng 1 polygon ⇒ ~311 ha / 17 cặp chồng lấn mỗi đơn. Sửa buildEudrFeatureCollection/
   combineAliasSources (src/lib/eudr-feature-collection.ts): quy MỌI mã của đơn về tập lô bản đồ
   (canonical) TRƯỚC khi dựng feature, khử trùng theo canonical — mỗi lô bản đồ xuất đúng 1 lần, kể cả
   khi đơn có cả mã bí danh lẫn chính mã gốc (vd G15Đ + G15T; M6 + M6S). ProductionPlace = ma_lo_full của
   lô bản đồ, Area của lô bản đồ, ghi các mã vận hành vào thuộc tính Ma_lo_van_hanh ("H14Đ, H14T").
   Không bao giờ xuất ProductionPlace dạng mã ngắn (G14Đ…). Đây là thay đổi so với nguyên tắc cũ trong
   migration 20260919 ("luôn dán nhãn bằng alias_ten") — người dùng đã chốt dùng lô gốc.
2. Lô nhiều mảnh rời xuất 2–3 feature cùng ProductionPlace (22–26 mã trùng/đơn) ⇒ đổi thành mã phụ
   <ma_lo_full>-1, -2, -3, mỗi mảnh 1 Polygon (KHÔNG dùng MultiPolygon — khách từ chối), giữ Ma_lo_goc.
3. Area: dùng diện tích trắc địa của chính polygon (2 số lẻ) thay cho dien_tich_ha sổ sách
   (29 lô lệch >10%, 8 lô >30%; tệ nhất 5.14PH.04.12.304 M5 khai 14,89 ha / polygon 4,34 ha).
   Giữ diện tích sổ sách trong ERP; xuất kèm CSV đối chiếu trong ZIP.
4. ProducerName đang hard-code trong src/lib/eudr-plot-merge.ts (mergePlotProperties) ⇒ đọc
   factories.full_name_en (truyền từ eudr-trace.ts và EudrClient.tsx). Admin sẽ cập nhật full_name_en
   thành tên pháp nhân tiếng Anh ở Cài đặt → Thông tin công ty.
5. File giao khách còn ~30 trường nội bộ ⇒ serialize "customer" chỉ giữ ProducerName, ProducerCountry,
   ProductionPlace, Area, PlotName, Ma_lo_goc/Ma_lo_van_hanh, export_date. Bản đồ trong app vẫn đủ trường.

Thêm:
- Lô con nằm trong lô khác (vd H6S ⊂ H6T, J6S ⊂ J6T trong forest_plots) ⇒ khoét lô con khỏi lô lớn khi
  xuất (Polygon có vòng trong), cắt mảnh vụn ranh giới (<0,01 m² … vài m²) do làm tròn 6 số lẻ; sau khi
  làm tròn phải kiểm lại chồng lấn (đỉnh có thể lọt lại vào polygon kề).
- Validator src/lib/eudr-validator.ts thêm mã chặn: DUPLICATE_PRODUCTION_PLACE, PLOT_OVERLAP (>0,01 ha,
  lọc bbox + polygon-clipping), Z_COORDINATE; cảnh báo AREA_MISMATCH >10% (chặn >30% khi bật block).
- scripts/check-eudr-customer-rules.mjs: chạy pipeline thật trên mọi đơn XH-NBS-*, in số mã trùng, cặp
  chồng lấn, lệch diện tích, Z, số lẻ, MultiPolygon, số thuộc tính. Kỳ vọng sau sửa: tất cả = 0.
- DDS (src/app/dashboard/eudr/dds-generator.ts): Plot ID = ProductionPlace, toạ độ tâm polygon 6 số lẻ,
  Area = Area của GeoJSON (cùng số với file), dòng tổng số lô/diện tích + tên file GeoJSON đi kèm.

Tham khảo cách làm đã chạy đúng cho bộ hồ sơ riêng XH52291025110:
cung_cap_dl/eudr_newbustar_2026-11/ (GeoJSON 434 mảnh / 406 lô, tự kiểm toàn 0).
Lên plan liệt kê từng thay đổi để tôi duyệt trước. Xong: npx tsc --noEmit + npx eslint, chạy
check-eudr-customer-rules.mjs và verify-eudr-export-chain.mjs, hướng dẫn test tay, hỏi trước khi commit.
```
