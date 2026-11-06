# EUDR — Quyết định đã chốt & kế hoạch xử lý triệt để (Kumho + Newbustar)

Cập nhật: 06/11/2026. Nguồn: bảng `forest_plot_code_aliases` (28 dòng, xác nhận To Thanh Luan
19–20/09/2026 khi xử lý phản hồi Kumho), migration `20260919_forest_plot_code_aliases.sql`,
`20260920_forest_plot_code_aliases_seed2.sql`, và rà soát phản hồi Newbustar 05/11/2026.

## A. Quyết định đã chốt (không đo lại, không đổi)

| Mã trong điều xe | Lô dùng trên bản đồ | Lý do |
|---|---|---|
| G13Đ, G13T | G13 | Đ/T chỉ là lịch cạo mủ Đông/Tây, đất là 1 lô |
| G14Đ, G14T | G14 | như trên |
| G16Đ, G16T | G16 | như trên |
| **H14Đ, H14T** | **H14** | như trên |
| H15Đ, H15T | H15 | như trên |
| J15Đ, J15T | J15 | như trên |
| K13Đ, K13T | K13 | như trên |
| K14Đ, K14T | K14 | như trên |
| I-13Đ, I-13T | I13 | như trên (mã điều xe có gạch nối, mã bản đồ không) |
| I-14Đ, I-14T | I14 | như trên |
| I-15Đ, I-15T | I15 | như trên |
| G15Đ | G15T | Phần thiếu là suối + bìa rừng; G15S là lô khác |
| H13Đ | H13T | H13S là lô khác |
| L6D | L6T | L6S bị ngăn bởi suối, là lô khác |
| G8 | G8N | G8B cách bởi suối ~52 m, không liên quan |
| M6 | M6S + M6T | Chạm biên liền mạch = 1 thửa; giống/năm trồng theo M6T |

Quy ước khác:
- Hậu tố hướng: Đông = Đ/D/Ð/E · Tây = T/W · Nam = S · Bắc = B · N không tự quy đổi.
- Lô S/T/B/N/Đ **có polygon riêng** trên bản đồ (vd H6S, H6T, C5Đ, C5T) là thửa riêng — chỉ những
  mã trong bảng trên mới là bí danh.
- Khi xuất EUDR: mọi mã của 1 đơn quy về lô bản đồ, mỗi lô bản đồ xuất **đúng 1 lần**, mã
  `ProductionPlace` = mã đầy đủ của lô bản đồ (H14Đ + H14T → 1 lô H14). (Thay nguyên tắc cũ "giữ
  nhãn bí danh".)
- Hồ sơ gửi khách: Polygon (không MultiPolygon), 2D, 6 số lẻ, lô nhiều mảnh tách `-1/-2/-3`,
  Area = diện tích polygon, chỉ giữ ProducerName / ProducerCountry / ProductionPlace / Area / PlotName.
- ProducerName = `factories.full_name_en` (hiện "PHUOC HOA KAMPONG THOM PROCESSING FACTORY").
- Cổng chặn xuất EUDR vẫn ở chế độ theo dõi (`NEXT_PUBLIC_EUDR_EXPORT_BLOCK=false`) cho tới khi quyết định bật.

## B. Đã xử lý cho Newbustar (lô hàng XH52291025110)
- Dựng lại GeoJSON + 2 DDS từ bản đồ 2026: 406 lô / 434 polygon / 7.575,58 ha, áp đúng quyết định
  mục A (G8 → G8N). Tự kiểm: 0 trùng mã, 0 chồng lấn, 0 cao độ, 0 MultiPolygon.
- Lô 1080cs bổ sung ngày; "1677cs" sửa thành 1077cs.

## C. Việc của đội thực địa (chi tiết trong `viec_can_lam_doi_thuc_dia.xlsx`)
| Ưu tiên | Việc |
|---|---|
| Cao | H6S nằm trọn trong H6T, J6S nằm trong J6T — xác nhận lô con, đo lại H6T/J6T đã trừ lô con |
| Cao | 9 lô lệch diện tích >30% (đứng đầu M5: sổ sách 14,89 ha / polygon 4,34 ha; T11, I5, V2S, H4S, D13, H3D, V10, V6S) |
| Trung bình | 21 lô lệch 10–30% (sheet 2) |
| Thấp | Tuỳ chọn đo dải thiếu của G15Đ/H13Đ/L6D; xác nhận giống/năm trồng M6S/M6T |
| Không cần | Mọi mã ở mục A — đã chốt, không đo tách Đ/T |

Kết quả đo nộp phòng Kỹ thuật cập nhật vào Cài đặt → Cấu hình nhà máy → Lô vườn.

## D. Việc của ERP (prompt chi tiết: `prompt_cai_tien_erp.md`)
1. Khử trùng theo lô bản đồ khi xuất (hết ~311 ha / 17 cặp chồng lấn mỗi đơn NBS).
2. Lô nhiều mảnh → mã `-1/-2/-3`, Polygon.
3. Area theo polygon + CSV đối chiếu.
4. ProducerName đọc `factories.full_name_en`.
5. File giao khách chỉ giữ trường bắt buộc.
6. Khoét lô con nằm trong lô khác (H6S/H6T, J6S/J6T) và cắt mảnh vụn ranh giới khi xuất.
7. Validator chặn trùng mã / chồng lấn / cao độ; cảnh báo lệch diện tích.
