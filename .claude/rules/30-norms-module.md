# Module Định mức Kinh tế Kỹ thuật (`/dashboard/norms`) — GĐ1–GĐ3b PASS (2026-11-12, migration 20261121–20261123 đã chạy)

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

## GĐ2 — Nhập liệu theo ngày (2026-11-11, test PASS 2026-11-12)
Kế hoạch GĐ2–4: `C:\Users\Software\.claude\plans\pasted-content-id-0c49-c-claude-md-silly-milner.md` (chốt 4 câu + chọn mẫu báo cáo).
- Migration `20261122_tech_norms_entry.sql` (**chạy tay TRƯỚC deploy** — loader chỉ tiêu GĐ1 nay select `kiem_ke_ton_xuong`):
  `tech_norm_meters` (ký hiệu, khu vực in báo cáo, loại điện/nước/nước thải, hệ số, tick `dung_dinh_muc` + chỉ tiêu + dây chuyền +
  hiệu lực), `tech_norm_meter_readings` (theo NGÀY, hệ số CHỤP theo lần ghi, `thay_dong_ho` + `chi_so_chot_cu`, ảnh, `nhap_qua`,
  `client_id` cho offline sau), `tech_norm_floor_locations` + `tech_norm_floor_counts` (kiểm kê cuối ngày), cột
  `tech_norm_items.kiem_ke_ton_xuong`. Seed 15 đồng hồ Mẫu 09 cho `phuochoa_kt` (ĐH-01/02/05 → Điện × Mủ tạp, ĐH-03/04 → Điện ×
  Mủ nước, ĐHN-01/02 → Nước). Lần ghi không CASCADE khi xoá đồng hồ (đồng hồ đã ghi chỉ ngừng dùng).
- Khoá ngày: `tech_norm_entry_locked()` là STUB (false) + trigger `NORM_DAY_LOCKED` — GĐ4 thay bằng kiểm báo cáo đã ký.
- RLS: lần ghi / kiểm kê ghi = `norms.periodic_entry`; đồng hồ / vị trí ghi = `norms.manage_config`; đọc = `norms.view`.
- Lib thuần `src/lib/norms/meters.ts`: tiêu thụ = (mới − cũ) × hệ số lần ghi sau; thay ĐH ⇒ đoạn đó = chốt cũ − cũ;
  `consumptionBetween` cộng từng đoạn (đúng khi thay ĐH / đổi hệ số giữa kỳ); `suggestMeterPeriod` (cũ ≤ F−1, mới ≤ T — người lập
  báo cáo đổi được); cảnh báo giảm chỉ số (đỏ) / lệch > 30% TB 3 kỳ (vàng); tem QR `/dashboard/norms/meter/{id}`. Kiểm 17/17 PASS.
- UI tab "Nhập liệu" (`?tab=entry`): Chỉ số đồng hồ (lưới theo ngày gom khu vực, lưu cả bảng, ảnh, lịch sử xổ, Quét QR) · Kiểm kê
  tồn xưởng (chỉ tiêu tick × vị trí) · Danh mục (đồng hồ, vị trí, In tem QR — `buildQrLabelsPdf` chung với tem thiết bị). Trang
  nhập nhanh mobile `/dashboard/norms/meter/[id]`. Form chỉ tiêu GĐ1 có tick "Có kiểm kê tồn xưởng".

## Chốt cho GĐ3–4 (2026-11-11)
- Thực tế = xuất kho trong kỳ; chỉ tiêu tick kiểm kê ⇒ + tồn đầu (kiểm kê F−1) − tồn cuối (kiểm kê T).
- Tấn NL khô/tươi: `production_records` theo Từ–Đến ngày + Loại NL (multi) + Ký hiệu KT (multi); bỏ "TM" = chỉ nông trường.
- Dầu xe xúc tách mã: `DOXU12` sản xuất, `DOXUNL` cào xé NL. Km theo phân loại xe Điều xe (logic km chưa chuẩn, sửa sau).
- Báo cáo chỉ hiện dòng > 0. Bộ báo cáo kỳ: tick mẫu (8A tháng, 09 điện nước, VT HC theo ngày, 12B dầu), mỗi mẫu 1 chứng từ + 1
  yêu cầu ký, chung 1 snapshot; sổ đăng ký mẫu `tech_norm_report_templates` (kiểu cấu hình `bang_ngay`/`dong_ho` thêm không cần
  code, kiểu cố định `thang_8a`). Mục 8 của 8A chỉ in tiêu đề.

## GĐ3 — Đối soát động (2026-11-11, test PASS)
- Lib thuần `src/lib/norms/compute.ts` (`computeReconciliation`): cho phép = Σ theo NGÀY của cơ sở × định mức khung hiệu lực
  ngày đó. tấn TP → `resolveNormValue` (dây chuyền, CSR, nguồn); tấn NL → `resolveLineValue` (dây chuyền theo loại mủ + nguồn, mọi
  CSR; các dòng khác số ⇒ lấy dòng đầu + ghi chú); 100 km → ô km theo `vehicle_types`; Thay bọc → cộng cho `THAY_BOC_ITEM_CODES`
  (BOC_004). Thực tế kho = xuất kho (+ tồn đầu F−1 − tồn cuối T nếu tick kiểm kê, thiếu ⇒ 0 + cảnh báo); đồng hồ = Σ đồng hồ tick
  theo kỳ đồng hồ người chọn. Chỉ tiêu đồng hồ tách dòng theo dây chuyền, trừ khi có đồng hồ gắn chỉ tiêu mà không chọn dây
  chuyền. Bỏ dòng 0/0.
- Loader trình duyệt `src/lib/norms/reconcile-loader.ts` (`loadReconcile`): `lot_transactions` + lô mồ côi, `sk_history` Thay bọc,
  `production_records` (lọc loại mủ + ký hiệu KT `ghi_chu`, nguồn theo `ma_nguon`), `loadDispatchEntriesWithResolvedRows` + loại xe,
  `inventory_stock_movements` export, kiểm kê F−1/T, đồng hồ. "Xuất kho chưa gắn định mức" = mã cùng nhóm vật tư với mã đã gắn.
  `useDraft` = xem thử bằng khung Nháp khi chưa có khung áp dụng (banner cảnh báo).
- Tab "Đối soát" (`?tab=reconcile`, `norms-reconcile.tsx`): FilterBar (kỳ, loại mủ, ký hiệu KT, kỳ đồng hồ gợi ý tự động), StatGrid,
  bảng nhóm theo cơ sở tính, dòng xổ = chi tiết theo dòng định mức. Không ghi DB.
- Kiểm bằng code thật trên tháng 10/2026 (khung Nháp): TP 1.485,19 t, NL khô 1.342,792 t (bỏ TM), Dầu CS 135/148,5 (−9,1%),
  Bọc 0,04 2.100/2.227,8 (−5,74%), Xe nâng 558/668,3, Isuzu 3.929 km 1.030/1.100,2 — khớp báo cáo 54-BC. Cozon lệch vì 2 xe 13B,
  14B loại "Cozon" (không phải "Cozon vận chuyển").

## GĐ3b — Mọi số đều hiển thị, chỉ số được tick mới so sánh (2026-11-11, test PASS 2026-11-12)
Người dùng chốt: tick 2 mức + phạm vi theo nhóm vật tư chọn sẵn.
- Migration `20261123_tech_norms_report_scope.sql` (**chạy tay**): `tech_norm_report_categories` (nhóm vật tư thuộc báo cáo, seed
  lần đầu = nhóm của các mã đã gắn; ghi `norms.manage_config`) + `tech_norm_export_exclusions` (1 dòng xuất kho KHÔNG tính định
  mức + lý do bắt buộc, `movement_id` UNIQUE, CASCADE khi phiếu huỷ, khoá theo `tech_norm_entry_locked`; ghi `norms.report`).
  Loader chịu được khi 2 bảng chưa có (coi như rỗng).
- `computeReconciliation` trả `lines` (CHỈ dòng có định mức cho phép > 0 — so sánh) + `outside` (chỉ hiển thị) 4 loại:
  `khong_dinh_muc` (chỉ tiêu có phát sinh nhưng kỳ không có định mức, vd Formic khi chỉ SX mủ tạp, hoặc chỉ tiêu chưa có trong
  khung), `loai_tru` (dòng xuất bị bỏ tick, kèm lý do), `chua_gan` (mã thuộc nhóm vật tư báo cáo chưa gắn chỉ tiêu), `dong_ho`
  (đồng hồ không tick / hết hiệu lực — theo khu vực). Đồng hồ tick luôn ở phần so sánh kể cả khi chưa chọn kỳ đồng hồ.
- UI Đối soát: dòng xổ của chỉ tiêu kho liệt kê từng phiếu xuất (link chi tiết phiếu) với ô "Tính ĐM"; bỏ tick ⇒ hộp nhập lý do,
  tính lại tại chỗ (`recomputeWithExclusion`, không tải lại). Mục "Phát sinh ngoài định mức" dưới bảng so sánh.
  Nhập liệu → Danh mục có thẻ "Nhóm vật tư báo cáo".
- Kiểm code thật: tháng 10 bỏ tick 1 dòng Bọc 0,04 (60) ⇒ thực tế 2.100 → 2.040, dòng sang `loai_tru`; tháng 8 kỳ đồng hồ 27/07 →
  27/08 ⇒ Điện XLNT (ĐH-06) 23.603 kWh khớp 51-BC.

## GĐ4 — Báo cáo kỳ + ký số, CHỈ Mẫu 8A (54-BC) + Mẫu 09 (51-BC) (2026-11-15, chờ chạy migration + test tay)
Người dùng chốt: số báo cáo = dãy Văn bản nội bộ (BC-NMCB, năm, thời gian thực); ký 2 người Người lập → BGĐ (`mac_dinh_ky`), cần
nhiều người ⇒ "Ký nhiều bước qua Văn bản nội bộ" (tạo văn bản nháp đúng số + PDF); 8A dùng đúng nguồn Sản lượng / F12; mục 1 = MỌI
NL (kể cả TM), mục 6 = NL khô nông trường (lọc ký hiệu KT mặc định bỏ "TM"); khoá ngày chỉ khi 8A/09 Chờ ký / Đã ký; 8A đã ký ⇒
khung định mức đã áp → `locked`. Mẫu 55 / 46 (bảng ngày) chuyển sang Kho vật tư — `.claude/plans/kho-vat-tu-bao-cao-ngay.md`.
- Migration `20261124_tech_norms_reports.sql` (**chạy tay TRƯỚC test**): `tech_norm_report_templates` (seed 8A + 09, config 8A
  `thanhPhan` + `xlntItemCodes`), `tech_norm_report_batches` (snapshot JSON dùng chung + `du_lieu_hash`), `tech_norm_reports`
  (số, trạng thái nhap|cho_ky|da_ky|tra_ve|huy, giải trình, kiến nghị, `yeu_cau_ky_id` | `van_ban_document_id`, `khoa_tu/den`).
  RPC `tech_norm_report_reserve_number` (service role, advisory lock, max(van_ban BC-NMCB năm, báo cáo) + 1, chặn trùng),
  `tech_norm_report_used_numbers` (cho Văn bản nội bộ không cấp trùng), `tech_norm_entry_locked()` thay STUB. RLS tách 4 policy.
- Lib: `report-types.ts` (snapshot, hash sha256 canonical), `report-loader.ts` (`buildReportSnapshot` từ bundle đối soát + NL theo
  Đội × loại mủ, TP xuất kho từ `export_orders` đã duyệt, chỉ số cũ/mới đồng hồ), `report-templates.ts` (`build8a`, `buildDongHo`,
  `overLines`; mục 7 = mã cấu hình + tên có "nước thải"/"XLNT" + nhóm Khác), `report-pdf.ts` (A4 dọc, QR góc phải trên, khối ký
  GIÁM ĐỐC NHÀ MÁY | LẬP BIỂU), `report-client.ts`, `server.ts` (đồng bộ trạng thái từ ký số / văn bản, khoá khung).
- API `/api/norms/approvers`, `/api/norms/reports/[id]/{reserve-number,submit,to-van-ban,cancel}`, `/api/norms/reports/sync`.
  Hook: `sign-field`, `return-request` (`syncNormReportFromSigning`), `api/documents/sign` gui_ky/phe_duyet/tra_ve
  (`syncNormReportFromVanBan`). Modun `norms`: labels, notify (tóm tắt mẫu/kỳ/số dòng vượt), file-url (`norms.view`), màn ký nút Đóng,
  chuông (`getNormsTasks`), registry `norms_report`.
- UI tab "Báo cáo" (`norms-reports.tsx`: Danh sách · Lập bộ báo cáo kỳ · Mẫu báo cáo), hộp gửi ký `norms-report-send.tsx`,
  trang chi tiết `/dashboard/norms/report/[id]` (70/30, PDF đã ký / bản chưa ký, kiểm "Đã ký — dữ liệu đã đổi" bằng tính lại hash).
- Kiểm code thật: 8A tháng 10/2026 TP 1.485,19 · NL khô mọi nguồn 1.440,981 · NL khô NT 1.342,792 · xuất kho 814,8 · Dầu CS 135/148,5 ·
  Bọc 2.100/2.227,8 · Xe nâng 558/668,3 · Isuzu 1.030/1.100,2 (khớp 54-BC); 09 kỳ 27/07→27/08 ĐH-06 23.603 kWh (khớp 51-BC, các đồng
  hồ khác chưa nhập lần ghi).

## Còn lại
GĐ4 test PASS 2026-11-15; sau test: header 3 dòng (dòng 3 đậm, `src/lib/pdf-company-heading.ts`), biểu ngữ đậm, QR 12,8 mm +
mã mẫu trên QR, Thành phần chọn từ nhân sự thật (`/api/norms/staff-options`, config `thanhPhanList`, chức vụ mặc định chính
quyền, in 2 cột), tiêu đề mục giữ cùng bảng + lặp tiêu đề bảng khi sang trang, xem trước chỉ dựng lại khi bấm "Cập nhật".
Người ký dùng chung `src/app/api/_lib/report-approvers.ts`; số BC-NMCB nay tính cả báo cáo kho (migration 20261125).
Còn: GĐ2b ghi đồng hồ offline. Báo cáo ngày 55/46 đã làm ở Kho vật tư (rule 13).
