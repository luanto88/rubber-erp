# Module Định mức Kinh tế Kỹ thuật (`/dashboard/norms`) — GĐ1 (2026-11-10, migration đã chạy, test localhost PASS)

Kế hoạch + quyết định: `.claude/plans/dinh-muc-ktkt-2026-11-10.md`. Nguồn: `cung_cap_dl/dinh_muc_2026.pdf`, `cung_cap_dl/dm.png` (2025, tách NT/TM).

## Mô hình (migration `20261121_tech_norms_module.sql`, chạy tay TRƯỚC deploy)
- `tech_norm_items` — danh mục chỉ tiêu theo nhà máy; ánh xạ vật tư kho bằng `inventory_item_ids` (theo **id**);
  `actual_source` kho | dong_ho (Điện/Nước); chỉ tiêu vận chuyển có `vehicle_types` (khớp `dispatch_vehicles.vehicle_type`).
  Bọc 0,04 = 1 chỉ tiêu gắn MỌI mã `B004%` (định mức chung theo CSR, thực tế cộng mọi mã).
- `tech_norm_versions` — "khung" có `effective_from`/`effective_to`; 1 năm nhiều khung. `draft` → `active` → `locked`
  (GĐ4, khi đã có báo cáo ký). Trigger: active/locked không chồng ngày (`NORM_VERSION_OVERLAP`); đổi trạng thái cần
  `norms.approve`, sửa nội dung cần `norms.manage_config` + khung Nháp; chỉ xoá khung Nháp.
- `tech_norm_version_items` — cột của khung: chỉ tiêu + cơ sở tính (`tan_tp` / `tan_nl_kho` / `tan_nl_tuoi` / `km100`) + đơn vị.
  Cơ sở tính/đơn vị theo TỪNG KHUNG (đổi khung sau không đổi lịch sử).
- `tech_norm_rows` — dòng: dây chuyền + csr_codes[] (mã đầy đủ CSRCV50…) + nguon_codes[] (`cong_ty`/`thu_mua`/`gia_cong`/
  `thanh_ly`, rỗng = mọi nguồn). 1 (dây chuyền, CSR, nguồn) chỉ thuộc 1 dòng/khung (`NORM_ROW_OVERLAP`).
- `tech_norm_matrix_values` — ô (cột × dòng), cột km100 thì `row_id` NULL. `merge_key` = ô gộp (vd Điện 95 cả dây chuyền).
- Bảng con chỉ sửa khi khung Nháp (trigger). RPC `tech_norm_copy_version` sao chép sâu sang khung Nháp mới.
- Không dùng 4 bảng `inventory_consumption_norms*` (lỗi thời).

## Quy ước nghiệp vụ đã chốt
- Tấn TP tính MỌI nguồn, định mức theo dòng CSR × nguồn; Gia công theo dòng NT; Thanh lý / CSR chưa có dòng ⇒ "không có
  định mức" (UI cảnh báo vàng theo Quy cách chủng loại).
- Thay bọc tiêu hao thêm 1 lần: cho phép += khối lượng thay × định mức bọc (GĐ3).
- Kỳ [F,T] tính trọn cả 2 đầu; đầu kỳ = kiểm kê cuối ngày F−1; kỳ sau từ T+1 (GĐ2/3).
- Dữ liệu ngày đã nằm trong báo cáo đã ký: khoá cứng, sai thì điều chỉnh kỳ sau (GĐ2/4).
- Ký báo cáo (GĐ4): như biên bản bảo trì, Giám đốc mặc định `maintenance_staff.mac_dinh_ky`, thêm bước kiểu Văn bản chèn
  giữa, Giám đốc ký cuối; PDF có QR góc phải trên.

## Code
- Lib thuần `src/lib/norms/`: `types.ts` (nhãn, `nguonCodeFromLabel` map từ `makeNguonResolver`), `matrix.ts` (bố cục,
  rowSpan, `findRowOverlap`/`findVersionOverlap` khớp trigger, `findUncoveredCombos`), `resolve.ts`
  (`versionForDate`, `resolveNormValue` — Nháp không bao giờ dùng). Loader `client.ts`.
- UI dùng chung `src/app/dashboard/norms/_components/norms-config.tsx` ở `/dashboard/norms` (guard `norms.view`, theme moss)
  và Cài đặt → Cấu hình nhà máy → "Định mức KTKT" (hiện khi có `norms.view`). Sửa ô tại chỗ (Enter/Esc), gộp/tách ô.
- Quyền: `norms.view`, `norms.manage_config`, `norms.approve`, `norms.periodic_entry` (GĐ2), `norms.report` (GĐ4) — seed cho admin.
- Seed: danh mục chỉ tiêu + khung "Định mức KTKT 2026" Nháp (từ 01/01/2026), dòng L,3L,5 / CV50 / CV60 / 10,20 × NT(+GC) / TM,
  số PDF 2026 chép vào cả NT và TM, L/3L/5 trống, Điện/Nước/Xe nâng Mủ nước + dầu nhớt mỡ/Điện/Nước Mủ tạp gộp ô; Cozon VC 26,
  Isuzu VC 28 lít/100 km; Cozon nội bộ không số. Mã kho seed: DCS, AF, AM, HAS, LP152, MT, NA, TT, B004%, DON, DOXU12,
  N50/68/90, MOTH, MOCN, DOCZVC, DOX, DOCZNB (chỉ gắn khi tồn tại). Bọc 0,13 chưa có mã.

## Ma trận — chọn nhiều ô (2026-11-10)
- Bấm ô = sửa. **Ctrl/⌘ + bấm** thêm/bớt ô; **Shift + bấm** chọn vùng chữ nhật từ ô neo. Thanh xanh: Gộp / Tách ô đã chọn / Bỏ chọn (Esc).
- Gộp CHỈ dọc theo từng cột (`planMergeSelection`, matrix.ts): ô chọn thuộc nhóm gộp sẵn ⇒ lấy cả nhóm; dòng phải liền nhau;
  số = ô trên cùng có số; khoá = khoá sẵn đầu tiên hoặc mới; ô trống trong vùng được chèn. Tách = `planSplitSelection` (giữ số).
- Lưới kẻ rõ: class `norm-matrix` (globals.css), vạch đậm `line-start` giữa 2 dây chuyền, ô chọn `cell-selected`.

## Còn lại
GĐ2 nhập kiểm kê/đồng hồ theo ngày · GĐ3 đối soát động (driver NL quy khô/tươi theo nguồn cần hỏi lại) · GĐ4 báo cáo kỳ + ký số.
