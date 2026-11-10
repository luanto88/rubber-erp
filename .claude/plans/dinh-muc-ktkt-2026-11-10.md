# Kế hoạch module "Định mức Kinh tế Kỹ thuật Chế biến" (`/dashboard/norms`) — 2026-11-10

Nguồn yêu cầu: `cung_cap_dl/dinh_muc.txt` (prompt gốc) + `cung_cap_dl/dinh_muc_2026.pdf` (văn bản giao định mức).
Trạng thái: CHƯA CODE. Đã đánh giá prompt, thăm dò DB thật (chỉ đọc) và chốt 4 câu với người dùng (mục 2).

## 1. Đánh giá prompt gốc — các điểm SAI / THIẾU phải sửa khi làm

| # | Prompt gốc | Thực tế / sửa thành |
|---|---|---|
| E1 | Migration `20261116_tech_norms_module.sql` | Số `20261116` đã dùng (`product_grade_types`). Dùng số kế tiếp chưa dùng (hiện mới nhất `20261120`) ⇒ `20261121_tech_norms_module.sql` |
| E2 | Seed hàng "L, 3L, 5": Formic 8.2, NH3 9.5, Meta 0.35… | PDF: hàng L/3L/5 **TRỐNG** ở cột Hóa chất / Vật tư / Dầu nhớt (người dùng xác nhận). Ô Điện 95 / Nước 11 là ô GỘP cho cả dây chuyền Mủ nước (gồm L/3L/5). **Không seed số bịa**; Meta 0.35 không có trong văn bản |
| E3 | `unit` 'kg' cho dầu/nhớt | Người dùng chốt: Dầu DO + dầu nhớt = **lít/tấn** hoặc **lít/100km**; mỡ = **kg/tấn**; kho xuất cùng đơn vị ⇒ KHÔNG quy đổi tỷ trọng |
| E4 | Km lấy từ `dispatch_entry_rows` | Bảng này ĐÓNG BĂNG từ 2026-06-12 (rule 19). Nguồn thật = `dispatch_entries.rows` (JSONB) qua `loadDispatchEntriesWithResolvedRows()`; `ngay` có thể là text dd/mm/yyyy ⇒ lọc ngày ở client sau khi chuẩn hoá |
| E5 | `inventory_item_codes` ví dụ AF, NH3, DOX… | Mã thật: Formic `AF`, NH3 = **`AM`** (Amoniac), Meta = **`MT`**, Sút = **`NA`**, HAS `HAS`, Thảm trong `TT`, Nhớt `N50/N68/N90`, Mỡ thường `MOTH`, Mỡ chịu nhiệt `MOCN`, Xe nâng `DON`, Xe xúc `DOXU12`, Cozon VC `DOCZVC`, Isuzu VC `DOX` (cần xác nhận). **Chưa thấy mã**: LP152, Dầu CS, Bọc 0,13 (chỉ có `B013H` "Mẫu hủy") ⇒ ánh xạ để trống, màn đối soát báo "chưa gắn mã kho" |
| E6 | Bọc 0,04 = 1 chỉ tiêu | Kho có nhiều mã bọc 0,04 theo nhãn CSR (`B004VC10`, `B004VRC10`, `B004K`, `B004VC60`…). Ánh xạ 1 chỉ tiêu ↔ NHIỀU mã (TEXT[]) — đúng hướng prompt. Nên lấy gợi ý từ `product_packaging_types.inventory_item_ids` (Quy cách đóng gói TP, rule 11) |
| E7 | RLS chỉ theo `current_profile_factory_id()` | Ghi phải theo quyền: `current_profile_has_permission('norms.manage_config' / 'norms.periodic_entry' / 'norms.approve')` (rule 15 bài học RLS). Đọc theo nhà máy + `norms.view` |
| E8 | 4 bảng định mức cũ "giữ lại không xoá" | `inventory_consumption_norms*` (4 bảng, migration 20260501) — **0 dòng**, không code nào dùng ⇒ giữ nguyên, ghi chú "lỗi thời", không đọc/ghi. Không DROP khi chưa hỏi |
| E9 | `basis_type` 'per_ton_raw' (tấn nguyên liệu) | PDF không có chỉ tiêu nào tính theo tấn nguyên liệu; mọi cột là "/tấn thành phẩm" (theo CSR hoặc theo dây chuyền) + "/100km". Giữ enum nhưng KHÔNG seed |
| E10 | "Kỳ" = bảng `tech_norm_periods` cố định tuần/tháng, số liệu gắn kỳ | Người dùng chốt (mục 2, Q4): **kỳ tự chọn từ ngày – đến ngày**, mỗi người một kỳ riêng, nhiều báo cáo chồng kỳ, file nào cũng gửi ký được ⇒ dữ liệu gốc phải lưu THEO NGÀY, không gắn kỳ (xem mục 3) |
| E11 | Thiếu ký số | Báo cáo kỳ phải dựng PDF + gửi ký qua hệ thống ký dùng chung (`yeu_cau_ky`, `modun='norms'`) |
| E12 | Dữ liệu sai sẵn | `DOSXN` (Dầu lò sấy mủ nước) đơn vị "cái" — sai, cần người dùng sửa thành lít trước khi đối soát dầu lò sấy |

## 2. Quyết định đã chốt với người dùng (2026-11-10)
- Q1 Seed theo PDF: L/3L/5 trống ở nhóm theo CSR; Điện/Nước/Xe nâng Mủ nước là theo DÂY CHUYỀN (áp cho mọi CSR Mủ nước).
- Q2 Đơn vị: dầu/nhớt lít/tấn hoặc lít/100km; mỡ kg/tấn; kho cùng đơn vị, không quy đổi.
- Q3 Thực tế = Tồn xưởng đầu kỳ + Xuất kho trong kỳ − Tồn xưởng cuối kỳ. Người dùng chọn từ ngày – đến ngày khi xuất báo cáo; MẪU báo cáo làm ở giai đoạn sau.
- Q4 Người có quyền tạo báo cáo chọn kỳ → dựng PDF → gửi ký. Mỗi nhân viên một kỳ / mỗi công việc một kỳ (vd 26 → 25, 01 → cuối tháng). Số liệu phải đúng với BẤT KỲ kỳ nào và PDF ghi rõ "Kỳ: dd/mm/yyyy – dd/mm/yyyy".

## 3. Đánh giá rủi ro logic "kỳ tự chọn" + cách thiết kế

| Rủi ro | Hệ quả nếu làm theo prompt gốc | Thiết kế đề xuất |
|---|---|---|
| R1 Tồn xưởng là ảnh chụp tại 1 ngày | Kỳ tự chọn (vd 26→25) không trùng ngày kiểm kê ⇒ không có tồn đầu/cuối | Bảng `tech_norm_floor_counts` lưu KIỂM KÊ THEO NGÀY (ngày, chỉ tiêu, vị trí bồn/xưởng, số lượng, ảnh). Báo cáo [F,T]: đầu kỳ = kiểm kê ngày F−1 (hoặc F 00:00 — chốt quy ước "cuối ngày"), cuối kỳ = kiểm kê ngày T. Không có đúng ngày ⇒ dùng 0 + cảnh báo đỏ "chưa kiểm kê ngày …" trên màn và PDF. KHÔNG nội suy |
| R2 Chỉ số đồng hồ điện/nước | Như R1 | `tech_norm_meter_readings` theo NGÀY (+ giờ). Tiêu thụ [F,T] = đọc ngày T − đọc ngày F−1, × hệ số. Thiếu mốc ⇒ dùng mốc gần nhất TRƯỚC/SAU và ghi rõ ngày dùng + cảnh báo "kỳ đồng hồ khác kỳ báo cáo"; không chia bình quân ngầm |
| R3 Phiên bản định mức đổi giữa kỳ | Kỳ cắt qua `effective_from` ⇒ áp 1 định mức cho cả kỳ là sai | Tính THEO NGÀY: định mức cho phép = Σ_ngày(driver ngày × định mức của phiên bản hiệu lực ngày đó). PDF liệt kê các phiên bản đã áp |
| R4 Nhiều báo cáo chồng kỳ, sửa dữ liệu nguồn sau khi ký | PDF ký rồi số trên màn khác | Mỗi báo cáo là 1 chứng từ `tech_norm_reports` (from, to, phạm vi chỉ tiêu, người lập) lưu **snapshot JSON** số liệu lúc dựng PDF + `du_lieu_hash` (mirror Điều xe, rule 19) ⇒ badge "Đã ký — dữ liệu đã đổi". PDF đã ký bất biến |
| R5 Ngày theo múi giờ | Lệch 00:00–06:59 | Mọi "ngày" theo giờ nhà máy (`getFactoryTodayISO`, rule CLAUDE.md); movement_date của kho là DATE |
| R6 Sản lượng TP nào là "driver" | Gộp cả hàng thu mua/gia công làm định mức chế biến phình ra | Driver = TP nhập theo `lot_transactions.ngay_nhap` (+ lô mồ côi theo `lots.tong_kg`, rule 06), tách theo CSR + dây chuyền, **chỉ nguồn "Công ty"** (hậu tố `suffixes.nguon`, `makeNguonResolver` ở `src/lib/lot-source.ts`) — CẦN XÁC NHẬN (câu O1) |
| R7 Thực tế hóa chất không tách theo CSR | Kho xuất AF chung cho cả dây chuyền, không biết của CV50 hay CV60 | Đối soát ở mức (chỉ tiêu × dây chuyền): cho phép = Σ_CSR(tấn CSR × định mức CSR); thực tế = xuất kho mã ánh xạ. Bảng chi tiết vẫn hiện định mức từng CSR để giải thích |
| R8 Xuất kho không phải tiêu hao | Chuyển kho / huỷ phiếu bị tính | Chỉ `movement_type = 'export'` của phiếu đã ghi sổ (huỷ phiếu đã xoá movement); KHÔNG tính transfer. Dầu dùng chung bồn: vẫn theo `item_id` (mã đã tách theo mục đích: DON, DOXU12…) |
| R9 Km theo loại xe | `so_km` trên chuyến, loại xe ở `dispatch_vehicles.vehicle_type` | Ghép `rows[].so_xe` ↔ `dispatch_vehicles.code`. Loại xe thực tế: "Cozon vận chuyển", "Isuzu vận chuyển", "Cozon" (2 xe chưa phân loại rõ), "Cozon nội bộ". Xe không khớp loại có định mức ⇒ liệt kê riêng "km không có định mức" |
| R10 Thay bọc tiêu hao bọc | Bỏ sót | Thêm driver phụ: số bành Thay bọc trong kỳ (`sk_history`, ngày thao tác) × khối lượng bọc/bành? — CHƯA có định mức cho thay bọc trong PDF ⇒ chỉ hiển thị tham khảo (câu O3) |
| R11 Kỳ báo cáo theo người/công việc | Mỗi lần chọn tay dễ sai | `tech_norm_report_profiles`: tên công việc (vd "Hóa chất mủ nước", "Điện nước", "Dầu vận chuyển"), nhóm chỉ tiêu, người phụ trách, chu kỳ mặc định (ngày bắt đầu kỳ, vd 26), người ký mặc định. Tạo báo cáo ⇒ điền sẵn kỳ theo hồ sơ, sửa được |

## 4. Mô hình dữ liệu đề xuất (thay 6 bảng của prompt)
Tất cả có `factory_id`, RLS đọc theo nhà máy + `norms.view`, ghi theo quyền (E7). Mọi query bảng lớn phân trang `.range()`.

1. `tech_norm_versions` — như prompt (`nam, code, name, decision_no, effective_from, effective_to, status draft|active|locked`). Ràng buộc không chồng kỳ hiệu lực giữa các bản `active`: EXCLUDE USING gist (cần `btree_gist`) hoặc trigger kiểm — chọn TRIGGER (không phụ thuộc extension).
2. `tech_norm_items` — như prompt + `inventory_item_ids UUID[]` (liên kết theo id, không theo mã — mã đổi được, rule 13) thay cho `inventory_item_codes`; `unit` ('lít' | 'kg' | 'kWh' | 'm3'); `basis_type` ('per_ton_csr' | 'per_ton_line' | 'per_100km'); `norm_group`.
3. `tech_norm_matrix_values` — như prompt; `csr_group` KHÔNG lưu chuỗi "L, 3L, 5" mà lưu `csr_codes TEXT[]` (khớp `lots.loai_csr` / `product_grade_types`); `vehicle_type` khớp `dispatch_vehicles.vehicle_type`. UNIQUE (version_id, norm_item_id, day_chuyen, csr_codes, vehicle_type).
4. `tech_norm_floor_counts` — kiểm kê tồn xưởng theo NGÀY (thay `floor_*_qty` gắn kỳ).
5. `tech_norm_meter_readings` — chỉ số đồng hồ theo NGÀY (thay `utility_readings` gắn kỳ): `ngay, day_chuyen, resource_code DIEN|NUOC|MAY_PHAT, reading, multiplier, evidence_urls`.
6. `tech_norm_report_profiles` — hồ sơ công việc báo cáo (R11).
7. `tech_norm_reports` — chứng từ báo cáo kỳ: `profile_id, from_date, to_date, scope (norm_item_ids[] / day_chuyen[]), status nhap|cho_ky|da_ky|huy, snapshot JSONB, du_lieu_hash, yeu_cau_ky_id, explanations JSONB (giải trình theo dòng vượt ngưỡng), created_by`.
   ⇒ Bỏ `tech_norm_periods` + `tech_norm_reconciliation_lines` của prompt: đối soát tính động theo [from,to]; chỉ lưu snapshot khi tạo/gửi ký.

Quyền: `norms.view`, `norms.manage_config`, `norms.periodic_entry` (kiểm kê + đồng hồ), `norms.approve` (đổi tên ngữ nghĩa → "tạo & gửi ký báo cáo định mức" hoặc thêm `norms.report`; câu O4). Seed `permissions` + `role_permissions` admin + `DEFAULT_PERMISSION_CODES`, nhãn ở `settings/page.tsx`.

## 5. Giai đoạn (mỗi GĐ: tsc + eslint, dừng cho người dùng test)
- **GĐ1 — Cấu hình định mức**: migration bảng 1–3 + quyền; seed ĐÚNG PDF 2026 (Mục 6 dưới); màn `/dashboard/norms` tab "Cấu hình định mức (Matrix)" theo rule 29 (bảng ma trận đúng bố cục PDF, sửa inline, ánh xạ vật tư kho bằng chọn nhiều có tìm), phiên bản theo năm + "Sao chép sang đợt/năm mới". Nhúng sub-tab ở Cài đặt → Cấu hình nhà máy (component dùng chung). Menu sidebar nhóm sản xuất, gate `norms.view`.
- **GĐ2 — Nhập liệu theo ngày**: bảng 4–5; tab "Nhập liệu" (lưới kiểm kê tồn xưởng theo ngày, lưới chỉ số đồng hồ theo ngày, ảnh bằng chứng dùng `prepareImageForUpload`); khoá sửa dòng đã nằm trong báo cáo đã ký (hoặc cảnh báo — câu O5).
- **GĐ3 — Đối soát động**: lib thuần `src/lib/norms/compute.ts` (driver theo ngày, áp phiên bản theo ngày, cho phép vs thực tế, % lệch, ngưỡng cảnh báo 2%/5%); server loader dùng `computeStock`/`lot_transactions` (Thành phẩm), `loadDispatchEntriesWithResolvedRows` (km), `inventory_stock_movements` (xuất kho). Tab "Đối soát & Cảnh báo": chọn from–to, StatGrid, bảng theo 3 nhóm (theo tấn CSR / theo dây chuyền / theo 100km), đỏ khi vượt ngưỡng, dòng cảnh báo thiếu kiểm kê/đồng hồ/mã kho. Kiểm chứng bằng script gọi code thật trên 1 tháng dữ liệu.
- **GĐ4 — Báo cáo kỳ + ký số**: bảng 6–7; hồ sơ công việc báo cáo; tạo báo cáo (kỳ điền sẵn theo hồ sơ), giải trình dòng vượt ngưỡng, PDF có QR góc phải trên + "Kỳ: … – …" + danh sách phiên bản định mức + cảnh báo dữ liệu thiếu; gửi ký qua `yeu_cau_ky` `modun='norms'` (thêm nhánh quyền trong `api/signing/create-request`, nhãn `labels.ts`, fingerprint dữ liệu, chuông + Telegram); trang chi tiết 70/30. Xuất Excel.
- **GĐ5 — Mẫu báo cáo**: các mẫu PDF theo biểu mẫu nhà máy (người dùng nói làm sau).

## 6. Seed chuẩn 2026 (đọc từ PDF, đơn vị theo Q2)
Theo tấn TP theo CSR — Mủ nước CV50: Dầu CS 0,1 · Formic 8,2 · NH3 9,5 · HAS 1,5 · LP152 0,18 · Meta 0,1 · Sút 0,1 · Thảm trong 1,9 · Bọc 0,04 1,9 · Bọc 0,13 4,5.
Mủ nước CV60: như CV50 nhưng LP152 0,1. Mủ nước L, 3L, 5: TRỐNG. Mủ tạp 10, 20: Dầu CS 0,1 · Sút 0,1 · Thảm trong 1,2 · Bọc 0,04 2 · Bọc 0,13 4,5.
Theo tấn TP của dây chuyền — Mủ nước: Xe nâng 1,2 lít · Điện 95 kWh · Nước 11 m3. Mủ tạp: Xe nâng 0,45 lít · Xe xúc 1,3 lít · Nhớt 50/68/90 mỗi loại 0,2 lít · Mỡ thường 0,01 kg · Mỡ chịu nhiệt 0,003 kg · Điện 160 kWh · Nước 16 m3.
Theo 100 km — Cozon vận chuyển 26 lít · Isuzu vận chuyển 28 lít.
⚠️ Xe nâng Mủ nước in ở hàng CV50/CV60 nhưng cột ghi "theo số tấn dây chuyền" ⇒ seed theo dây chuyền (kiểm lại với người dùng khi test GĐ1).

## 7. Câu hỏi mở (hỏi ĐẦU phiên sau, trước khi code GĐ liên quan)
- O1 (GĐ3) Driver tấn TP: chỉ hàng chế biến (nguồn "Công ty"), hay cả thu mua/gia công?
- O2 (GĐ1) Mã kho cho LP152, Dầu CS, Bọc 0,13 (không thấy trong danh mục); Isuzu vận chuyển dùng mã dầu `DOX`?; 2 xe loại "Cozon" và 1 xe trống loại ⇒ thuộc Cozon vận chuyển?
- O3 (GĐ3) Bọc dùng cho Thay bọc có tính vào thực tế tiêu hao bọc không / có định mức riêng không?
- O4 (GĐ4) Người ký báo cáo kỳ: mặc định Người lập → Trưởng bộ phận → Giám đốc? Hay chọn theo hồ sơ công việc?
- O5 (GĐ2) Kiểm kê / đồng hồ của ngày đã nằm trong báo cáo đã ký: khoá sửa hay cho sửa kèm cảnh báo?
- O6 (GĐ2) Quy ước tồn đầu kỳ = kiểm kê cuối ngày F−1 (khuyến nghị) hay đầu ngày F?

## 8. Prompt mở đầu phiên sau

```
Đọc CLAUDE.md, rule 29, rule 05 và .claude/plans/dinh-muc-ktkt-2026-11-10.md (đánh giá prompt định mức +
thiết kế đã chốt). Hỏi tôi các câu mở O1–O6 trong mục 7 bằng AskUserQuestion (ngôn ngữ nghiệp vụ, có ví dụ),
rồi làm GĐ1 "Cấu hình định mức": migration 20261121_tech_norms_module.sql (tech_norm_versions, tech_norm_items,
tech_norm_matrix_values + quyền norms.*; RLS ghi theo current_profile_has_permission; seed ĐÚNG mục 6, hàng
L/3L/5 trống), lib thuần src/lib/norms/, trang /dashboard/norms tab "Cấu hình định mức" theo rule 29 (ma trận
đúng bố cục PDF cung_cap_dl/dinh_muc_2026.pdf, sửa inline, ánh xạ vật tư kho bằng id, sao chép phiên bản sang
năm mới), sub-tab ở Cài đặt → Cấu hình nhà máy, menu sidebar gate norms.view. Không đụng 4 bảng
inventory_consumption_norms* (0 dòng, lỗi thời). Chỉ npx tsc --noEmit + npx eslint, không npm run build.
Không ghi/xoá DB khi chưa hỏi. Dừng cho tôi test sau GĐ1, hỏi trước khi commit. Sau đó GĐ2 → GĐ4 theo mục 5,
mỗi GĐ dừng test.
```
