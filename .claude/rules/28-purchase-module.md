# Module Đề nghị mua vật tư hàng hóa (`/dashboard/purchase`) — GĐ1 (2026-10-04)

Kế hoạch đầy đủ (GĐ1-3): `C:\Users\Software\.claude\plans\nghi-n-c-u-c-c-m-eager-donut.md`.

## Quyết định đã chốt (không tự đổi)
- Ký số dùng chung (`yeu_cau_ky`, `modun='purchase'`, `loai_tai_lieu='purchase_request'`), thứ tự CỨNG:
  Người đề nghị (10, ky) → Giám đốc (20, ky) → Kế toán (30, phe_duyet). Người đề nghị = user đang tạo.
- Người ký gợi ý theo chức vụ thật (`maintenance_staff.chuc_vu_chinh_quyen || chuc_vu`), chỉ NMCB, đổi được:
  Giám đốc = chức vụ chứa "giám đốc" (gồm PGĐ, loại "tổng"); Kế toán = chứa "kế toán"/"nhân viên".
  Không có ai trong NMCB → nới ra toàn nhà máy (cờ `*Fallback`). Không lọc theo quyền.
- Số phiếu `NN/ĐNMVT`, **quay về 01 mỗi năm** (`get_next_purchase_so(factory, nam)`, năm theo giờ nhà máy),
  cấp khi lưu lần đầu, **không có xoá — chỉ huỷ**, phiếu huỷ giữ số.
- Đề nghị bao nhiêu mua bấy nhiêu. Mua thêm → phiếu mới. Đổi mã/giá lệch >10% sau duyệt → phiếu điều chỉnh (GĐ2).
- Huỷ: người đề nghị khi Nháp/Bị trả về; **admin mọi trạng thái** trừ Huỷ/Hoàn tất, lý do bắt buộc;
  phiếu đã duyệt huỷ thì `yeu_cau_ky` giữ `hoan_tat` (PDF đã ký giữ làm bằng chứng).
- Vật tư chưa có → tạo thẳng `inventory_items` (`nguon_tao='de_nghi_mua'`), chặn trùng tuyệt đối ở server,
  cảnh báo tên gần giống ở client (`src/lib/similar-name.ts`, ngưỡng 0,8 — chỉ cảnh báo, người dùng xác nhận).
- Đơn giá gợi ý: đề nghị đã duyệt gần nhất của chính vật tư → trung vị cùng nhóm (365 ngày) → `inventory_items.don_gia`;
  quy đổi tiền qua `convertCurrency`. Lệch >10% → viền đỏ + bắt buộc lý do (kiểm cả client lẫn server).
- QR trên PDF → `/dashboard/purchase/{id}`, chưa đăng nhập → `/login?next=` (layout đã có). Trang chi tiết KHÔNG
  gate `purchase.view` — quyền xem do API kiểm (người liên quan / `purchase.view_all` / admin).
- PDF A5 dọc (`src/lib/purchase-pdf.ts`) bám mẫu `cung_cap_dl/mau_dn_mua_vthh.pdf`. Tên người ký KHÔNG in sẵn.

## Kiến trúc
- Migration `20261007_purchase_requests.sql` (**chạy tay**): `purchase_requests`, `purchase_request_lines`,
  `purchase_request_logs` (chặn UPDATE), `purchase_request_sequences`, quyền `purchase.view/create/view_all`.
  RLS chỉ SELECT — mọi ghi qua API service role.
- API: `api/purchase/approvers`, `item-insight`, `items` (tạo vật tư), `requests` (GET list scope mine|todo|all,
  POST lưu), `requests/[id]` (chi tiết + perms), `[id]/submit`, `[id]/cancel`. Xác thực dùng `resolveIsoActor`.
- Gửi lại sau "Trả về": huỷ `yeu_cau_ky` cũ rồi tạo yêu cầu MỚI với PDF dựng lại (lõi không dựng lại nội dung).
- Trạng thái phiếu đồng bộ từ ký qua `syncPurchaseFromSigning()` (`src/lib/purchase/server.ts`), gọi trong
  `api/signing/sign-field` và `api/signing/return-request` (no-op với module khác).
- Thông báo: lõi ký gửi chuông + Telegram + email; module này dùng nhóm `QL_CHI_PHI_TOKEN`/`QL_CHI_PHI_ID`
  (`TELEGRAM_BY_MODUN.purchase`), kèm tóm tắt phiếu (`buildPurchaseSummary`). Admin huỷ → `scheduleModuleBroadcast`.
  Email tra theo `maintenance_staff.email` (profile_id).
- Dashboard: thẻ đầu "Đề nghị mua vật tư" (`purchase.create`, `animate-ping`). Chuông: `getPurchaseTasks`.

## GĐ2 (2026-10-05) — mua thực tế, nhập kho, điều chỉnh, đóng phiếu
Migration `20261008_purchase_receive_adjust.sql` (**chạy tay**, sau 20261007). Người dùng đã chốt:
nhập kho NGAY trên trang chi tiết phiếu (không qua màn Nhập kho), ảnh đính kèm chọn nhiều/chụp trực tiếp,
quyền = người đề nghị + `inventory.create` (+ admin) — **GĐ2f đã bỏ `inventory.create`, xem dưới**, phiếu điều chỉnh ký lại đủ 3 bước.
- Nguồn sự thật "đã mua" = tổng `inventory_document_lines.quantity` của phiếu nhập `posted` trỏ
  `purchase_request_line_id` = dòng GỐC. `sl_da_mua` chỉ là bản chụp. Huỷ phiếu nhập ở module Kho → trigger
  `trg_purchase_on_inventory_doc_status` (SECURITY DEFINER) tự tính lại + hạ trạng thái.
- Thông số hiệu lực mỗi dòng gốc: RPC `purchase_effective_lines` = dòng phiếu điều chỉnh `hoan_tat` mới nhất
  (`parent_line_id`) hoặc chính dòng gốc; `pending_adjust` = đang có điều chỉnh nháp/đang ký/trả về.
- RPC `purchase_receive` (chỉ service_role, gọi từ `api/purchase/requests/[id]/receive`): MỘT giao dịch khoá
  phiếu + từng dòng, chặn vượt SL còn lại, lệch giá > 10% so giá hiệu lực, dòng đang điều chỉnh, thiếu số lô;
  tự tạo + ghi sổ phiếu nhập `N-<KHO>-DDMMYY/XXX` (gọi `inventory_post_import_document`), ghi
  `purchase_receipts` (ảnh) + `inventory_document_attachments`, rồi `purchase_recompute_request`.
  Trạng thái phiếu gốc: có nhập → `dang_mua`, đủ mọi dòng → `hoan_tat`.
- Phiếu điều chỉnh (`api/.../adjust`): chỉ người đề nghị, phiếu `da_duyet|dang_mua`, mỗi phiếu gốc tối đa 1
  điều chỉnh đang chờ. Số mới cùng dãy ĐNMVT, `loai='dieu_chinh'`, dòng chụp `truoc_*`. SL = TỔNG duyệt mới:
  ≥ đã nhập, KHÔNG được tăng (mua thêm = phiếu mới). Đổi mã chỉ khi dòng chưa nhập gì. Không sửa bằng form
  thường (bị trả về → huỷ, lập lại). Duyệt xong → `hoan_tat` ("đã áp dụng") + tính lại phiếu gốc
  (`syncPurchaseFromSigning`). PDF chế độ điều chỉnh: cột "Trước điều chỉnh" + lý do.
- Đóng phiếu (`api/.../close`): chỉ `dang_mua`, người đề nghị/admin, lý do bắt buộc, không khi đang điều chỉnh.
  Chưa nhập gì → admin Huỷ. Huỷ bị chặn khi `dang_mua`/`dong`.
- UI: `_components/purchase-fulfillment.tsx` (bảng tình hình mua, lịch sử nhập có ảnh, 3 modal).

## GĐ2b (2026-10-05) — cải tiến sau test tay GĐ2
Migration `20261009_purchase_bo_phan_images.sql` (**chạy tay**, sau 20261008): `purchase_requests.bo_phan`
+ index `(factory_id, bo_phan)`, `purchase_request_lines.image_urls TEXT[]`. Không backfill.
- **Bộ phận bắt buộc**: danh sách `BO_PHAN_LIST` chuyển sang file thuần `src/lib/bo-phan.ts` (dùng được ở API
  route); `maintenance-data.ts` re-export. Form (card Người ký duyệt) + POST kiểm `isBoPhan`; phiếu điều chỉnh
  copy từ phiếu gốc. PDF in "Bộ phận: X" bên phải dòng Người đề nghị; Telegram tóm tắt có dòng Bộ phận.
  Danh sách: cột + `FilterMultiSelect`, lọc ở server `?bo_phan=a,b` (áp mọi tab); phiếu cũ NULL hiện "—".
- **Mục đích sử dụng bắt buộc** (form + server). Phiếu điều chỉnh copy `muc_dich` + `image_urls` từ dòng gốc.
- **Ảnh theo TỪNG DÒNG vật tư** (không có ảnh cấp phiếu, không in lên PDF): component dùng chung
  `_components/purchase-image-picker.tsx` (`PurchaseImagePicker` chọn nhiều + chụp `capture="environment"`,
  `ImageLightbox`), cũng dùng cho modal Ghi nhận mua. Sau khi gửi ký/duyệt vẫn sửa được ảnh: route
  `POST /api/purchase/requests/[id]/line-images` — người đề nghị/admin, phiếu ≠ huỷ, tối đa 10, lọc http(s)
  (`sanitizeImageUrls`), log `cap_nhat_anh`; quyền UI `perms.canEditImages`. Lưu ý POST lưu phiếu xoá + chèn
  lại dòng ⇒ ảnh phải đi kèm payload dòng.
- **Tải PDF ở danh sách**: GET trả `file_hien_tai` (đọc `yeu_cau_ky`, chia lô 100); icon Download qua
  `buildStorageDownloadUrl` + `purchaseDownloadBaseName` ("Phiếu đề nghị mua 01-ĐNMVT (2026)").
- **Nút tồn kho**: thanh tiêu đề panel tham khảo (nền sky, viền trái, Chevron), không còn giống ô nhập.
- **PDF mở "to như A4" trong Foxit**: file vốn đã A5, lỗi do jsPDF mặc định `OpenAction /FitH`. Nay
  `setDisplayMode("fullpage","single")` (`/Fit`) + `viewerPreferences({ PrintScaling: "None",
  PickTrayByPDFSize: true })`. Chỉ áp cho phiếu dựng mới; file đã ký trước đó bất biến.
- **Phân loại "Rotyl" nhập nhầm**: `scripts/delete-mistaken-categories.mjs` (mặc định xem, `--apply` xoá; chỉ
  xoá id tên đúng Rotyl và 0 tham chiếu ở `inventory_items` / `maintenance_external_materials`). Chống tái
  phát: `_components/category-name-clash.tsx` cảnh báo khi tạo phân loại trùng/gần giống tên VẬT TƯ (modal
  Nhập kho + tab Nhóm vật tư ở Cài đặt khi tạo mới) — tick xác nhận là lưu được, không chặn cứng.

## GĐ2c (2026-10-05) — panel tồn kho nổi bật + nút Ảnh cuối dòng
Không migration. Migration 20261009 người dùng đã xác nhận đã chạy; script xoá Rotyl CHƯA chạy `--apply`
(người dùng chọn để sau).
- `InsightPanel` (`purchase-form.tsx`): 4 thẻ nền trắng, viền trái 4px + icon theo màu nhấn — Tồn thực tế
  (emerald, Boxes; chip theo kho "KA: 8"), Nhập kho (sky, ArrowDownToLine), Xuất dùng (amber,
  ArrowUpFromLine), Tiêu hao 90 ngày (violet, TrendingDown; giữ "Đủ dùng ~N ngày", đỏ khi ≤14).
  Lưới `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. `MovementList` là component cấp module (không định nghĩa
  trong render).
- `api/purchase/item-insight`: trả thêm `recentImports`/`recentExports` (`{ ngay, soLuong }[]`, 3 movement
  gần nhất theo `movement_date` rồi `created_at`; import dùng `quantity_in`, export dùng `quantity_out`). Giữ
  `lastImportDate`/`lastExportDate` (= phần tử đầu). Không cần lọc phiếu huỷ: `inventory_cancel_document`
  XOÁ hẳn movement của phiếu huỷ. Dầu dùng chung bồn vẫn theo đúng `item_id`, không gộp bồn.
- Trang chi tiết: cột cuối "Ảnh" — nút `ImagePlus` (có quyền `perms.canEditImages`) hoặc `Images` (không quyền,
  chỉ khi dòng có ảnh), badge số ảnh. Thumbnail bỏ khỏi cột Vật tư. Modal: có quyền → `PurchaseImagePicker`
  + Lưu; không quyền → lưới thumbnail chỉ xem (bấm phóng to). Route `line-images` không đổi.

## GĐ2d (2026-10-05) — Mua tại / Thời gian có hàng / Thời gian cần hàng
Migration `20261010_purchase_line_supply_dates.sql` (**chạy tay TRƯỚC khi deploy** — GET danh sách select
cột `ngay_can_hang`, thiếu cột là danh sách lỗi). Người dùng chốt: 3 trường theo TỪNG DÒNG, dòng mới tự lấy
giá trị dòng trước; 2 trường thời gian là NGÀY (mục đích: biết mức độ gấp để ưu tiên duyệt); chỉ bắt buộc
"Thời gian cần hàng".
- Cột dòng: `mua_tai TEXT`, `ngay_co_hang DATE`, `ngay_can_hang DATE`; phiếu: `ngay_can_hang` = ngày cần
  SỚM NHẤT các dòng (bản chụp do POST lưu / route adjust ghi). Phiếu điều chỉnh copy 3 trường từ dòng gốc.
- Kiểm tra (client + server): `ngay_can_hang` bắt buộc, không trước hôm nay (giờ nhà máy); `ngay_co_hang`
  tuỳ chọn. Có hàng sau ngày cần → chỉ cảnh báo vàng ở form, không chặn.
- Helper thuần ở `lib/purchase/types.ts`: `normalizeIsoDate`, `minIsoDate`, `daysBetweenIso`,
  `purchaseUrgency` (quá hạn / gấp ≤3 ngày / sắp ≤7 ngày / bình thường), `isPurchaseActive`.
- Form: 3 ô dưới Mục đích/Ghi chú, datalist "Mua tại" từ các dòng khác, nút "Áp dụng 3 thông tin này cho
  mọi dòng", nhãn mức gấp ngay dưới ô ngày.
- PDF: KHÔNG thêm cột (A5 đã chật) — mỗi vật tư thêm 1 hàng phụ chữ xám 6pt "Mua tại … · Có hàng … · Cần
  hàng …" trải 8 cột, ô STT `rowSpan: 2`. Dòng cũ không có thông tin nào → không có hàng phụ.
- Danh sách: cột "Cần hàng" + nhãn gấp (chỉ phiếu đang xử lý); tab "Chờ tôi xử lý" sắp theo ngày cần hàng
  tăng dần. Chi tiết: banner "Cần hàng sớm nhất" + dòng phụ dưới tên vật tư. Telegram/email tóm tắt có dòng
  "Cần hàng: dd/mm/yyyy (nhãn)", thêm 🔥 khi gấp/quá hạn.

## GĐ2e (2026-10-05) — bằng chứng cho người duyệt + PDF gọn + màn ký
Migration `20261011_purchase_line_insight_snapshot.sql` (**chạy tay TRƯỚC khi deploy** — submit kiểm cột này):
`purchase_request_lines.insight_snapshot JSONB`.
- **Bản chụp, không join sống**: lúc gửi ký, client gọi `POST /api/purchase/requests/[id]/insight-snapshot`
  (chỉ người đề nghị, phiếu Nháp/Trả về) → server tính bằng `loadPurchaseItemInsight()`
  (`src/lib/purchase/server.ts`, logic tách nguyên từ `api/purchase/item-insight`, route đó giờ chỉ gọi hàm
  này) cho từng dòng, ghi `insight_snapshot` kèm `capturedAt`, trả về để in PDF. Submit chặn 409 nếu dòng
  nào thiếu bản chụp hoặc cũ hơn `PURCHASE_SNAPSHOT_MAX_AGE_MIN` (30 phút). Gửi lại sau Trả về → chụp lại.
  Phiếu điều chỉnh không copy bản chụp (tự chụp khi gửi ký). POST lưu phiếu xoá/chèn lại dòng ⇒ bản chụp mất,
  đúng ý (sửa xong phải gửi lại).
- Type + helper thuần ở `types.ts`: `PurchaseItemInsight`, `PurchaseInsightSnapshot`,
  `PURCHASE_STOCK_PLENTY_DAYS = 60`, `insightDaysLeft`, `insightWarnings` (tồn đủ dùng > 60 ngày, hoặc còn tồn
  mà 90 ngày không xuất dùng; vật tư đang có trong phiếu khác chưa hoàn tất).
- **PDF**: không thêm cột; mỗi vật tư tối đa 2 hàng phụ (nơi mua/ngày; bằng chứng), ô STT `rowSpan` theo số
  hàng phụ. Bằng chứng: "Tồn: 8 Bộ · Dùng 90 ngày: 12 · Đủ ~20 ngày · Mua gần nhất dd/mm/yyyy: 2 × 7 USD";
  có cảnh báo → chữ đỏ + tiền tố "(!) …" (không dùng bold — NotoSans bold trỏ cùng file Regular; không dùng ⚠).
- **Đầu phiếu**: QR 10mm (trước 17mm) cùng hàng tiêu đề, góc phải; tên nhà máy `factoryHeading()` =
  "NHÀ MÁY CHẾ BIẾN " + `factories.name` viết hoa (không lặp nếu tên đã bắt đầu "NHÀ MÁY").
- File PDF đã có `/OpenAction /Fit` + `ViewerPreferences` (từ GĐ2b). Foxit/Acrobat mở thấy trọn trang A5;
  trình xem PDF của Chrome/Edge **bỏ qua OpenAction** (luôn vừa bề ngang) — giới hạn của trình xem, không hack.
  Phiếu đã ký trước đó bất biến.
- **Panel cho người duyệt**: `_components/purchase-insight-panel.tsx` (`PurchaseInsightPanel`, tách từ form;
  `capturedAt` → hiện mốc chụp + khung cảnh báo đỏ; `compact` → tối đa 2 cột cho ngăn kéo). Trang chi tiết:
  nút "Bằng chứng" dưới tên mỗi vật tư (phiếu ≠ nháp) mở hàng panel. Màn ký: nút "Bằng chứng tồn kho" trên
  topbar (chỉ `modun === "purchase"`), ngăn kéo phải, tải qua `authFetch('/api/purchase/requests/{ban_ghi_id}')`
  (KHÔNG import purchase-client để khỏi kéo jsPDF vào màn ký).
- Xem trước bố cục: `cung_cap_dl/preview_phieu_dnmvt_thuong.png`, `..._dieu_chinh.png` (script gọi thẳng
  `buildPurchasePdfForSigning` + render pdfjs/Playwright).

## GĐ2f (2026-10-05) — A5 ngang, 1 dòng phụ, ngày cần hàng mặc định, quyền nhập kho
Không migration.
- **PDF khổ A5 NGANG** (`purchase-pdf.ts`, 210×148mm, `orientation: "landscape"`): tên nhà máy, ngay dưới là
  "Số: NN/ĐNMVT" (cùng lề trái), QR 10mm cùng hàng tiêu đề; cột bảng (tổng 194mm) STT 6 · Tên 50 · Mã 18 ·
  ĐVT 10 · SL 12 · Đơn giá 18 · Thành tiền 20 · Mục đích/Trước ĐC 36 · Ghi chú 24; `rowPageBreak: "avoid"` giữ
  vật tư + dòng phụ chung trang; hàng ký ~30mm, không đủ chỗ thì sang trang 2 (`boxesByRole.page` theo trang).
  Thực đo: ~5 vật tư có dòng phụ + ghi chú vừa 1 trang cùng khối ký; 6-9 vật tư → khối ký sang trang 2.
- **MỘT dòng phụ** dưới vật tư (`subRowText`): CHỈ "Tồn: 8 Bộ · Mua gần nhất dd/mm/yyyy: 2 × 7 USD" (bản chụp lúc
  gửi ký); có `insightWarnings` → cả dòng đỏ, tiền tố "(!) <cảnh báo> — …". Ô STT `rowSpan: 2`. Mua tại / ngày có
  hàng / ngày cần hàng / tiêu hao 90 ngày KHÔNG in nữa (xem ở trang chi tiết + ngăn kéo Bằng chứng).
  Ảnh xem trước: `cung_cap_dl/preview_phieu_dnmvt_*_v2.png`.
- Màn ký không sửa: 595pt × `PX_PER_PT` = 672px nên A5 ngang hiển thị đúng bề rộng tối đa.
- In: PDF có MediaBox A5 ngang + `PickTrayByPDFSize` + `PrintScaling: None` + `/Fit`. Foxit/Acrobat chọn khổ
  theo trang; hộp thoại in của Chrome/Edge có thể vẫn lấy khổ mặc định của máy in — PDF không có cơ chế chuẩn
  nào khác để ép khổ giấy, không hack. Phiếu đã ký trước GĐ2f bất biến (vẫn A5 dọc).
- Form: dòng vật tư ĐẦU TIÊN có Thời gian cần hàng = hôm nay (`getFactoryTodayISO`); dòng sau copy dòng trước;
  phiếu đang sửa giữ giá trị cũ.
- **Ghi nhận mua / nhập kho CHỈ người đề nghị + admin** (`perms.canReceive`, route `receive` trả 403 cho người khác,
  kể cả có `inventory.create`). RPC `purchase_receive` chỉ service_role nên không cần migration.

## Chưa làm
- GĐ3: thống kê chi phí; gợi ý giá theo giá mua thực tế (`inventory_document_lines.don_gia`); nút "Lập đề nghị
  bổ sung" điền sẵn vật tư khi vượt SL.

## GĐ2g (2026-10-06) — Đề nghị mua lập từ biên bản bảo trì (kho tạm KT)
Migration `20261012_purchase_maintenance_link.sql` (**chạy tay TRƯỚC deploy**): `purchase_requests.maintenance_record_id`
(FK ON DELETE SET NULL) + `lap_boi_id`. Chi tiết luồng: rule 14 mục "Vật tư mua ngoài qua Kho tạm KT".
- Phiếu lập từ biên bản: người tạo biên bản lập NHÁP (tạm đứng tên người đề nghị). Người có `purchase.create`
  bấm **"Nhận xử lý"** (= Lưu) để thêm/bớt dòng, tăng SL → trở thành người đề nghị (log `nhan_xu_ly`), gửi ký
  bước 1, và là người duy nhất (+ admin) ghi nhận mua.
- Ghi nhận mua của phiếu liên kết biên bản **bắt buộc kho KT** (UI khoá ô kho, `receive` trả 400 nếu kho khác).
- Trang chi tiết có banner "Lập từ biên bản bảo trì" + link; banner `KtShortageBanner` ở đầu danh sách.
- Phiếu `00/ĐNMVT` = dữ liệu lịch sử do script backfill tạo (không ký số).
