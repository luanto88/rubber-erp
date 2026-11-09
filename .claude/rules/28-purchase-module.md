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

## GĐ2h (2026-10-07) — bố cục dòng vật tư, lọc phân loại, sửa gợi ý giá, backfill KT
Không migration. tsc + eslint sạch, CHƯA test tay, CHƯA commit.
- **Bố cục mỗi dòng** (`purchase-form.tsx`): hàng đầu GIỮ NHƯ CŨ [Vật tư (5/12) | ĐVT | SL | Đơn giá | Thành
  tiền] → giá gợi ý → Dòng 1 [Mục đích * | Mua tại | Ghi chú] → Dòng 2 [Có hàng | Cần hàng * | Ảnh] — 2 dòng
  sau `grid-cols-1 md:grid-cols-3`, mobile 1 cột. Field/payload/kiểm tra KHÔNG đổi.
- Chip mức gấp nằm TRONG ô "Cần hàng" (`absolute right-9`, chừa icon lịch): `PurchaseUrgency.shortLabel`
  mới ("Quá hạn"/"Gấp"/"Sắp tới"/null). `label` và ngưỡng KHÔNG đổi — danh sách/chi tiết/Telegram vẫn dùng `label`.
- `PurchaseImagePicker` thêm `variant: "default"|"compact"|"inline"` + `title`; `compact` boolean cũ vẫn chạy.
  `inline` = 2 nút nền màu (sky "Chọn ảnh" có badge số ảnh, violet "Chụp ảnh") cao bằng ô nhập, ảnh hiện dưới.
- **Lọc phân loại** nằm TRONG dropdown `ItemPicker` (prop optional `categories`, state nội bộ `cat`, không lưu
  DB): `<select>` cạnh ô tìm (mobile xếp dọc); mở dropdown → mặc định nhóm của vật tư đang chọn; đổi nhóm chỉ
  lọc danh sách; `onCreateNew(name, categoryId)` điền sẵn nhóm cho "tạo vật tư mới". `purchase-fulfillment.tsx`
  (modal điều chỉnh) không truyền `categories` ⇒ không có ô này.
- **Gợi ý giá — thứ tự mới**: lần mua gần nhất của CHÍNH vật tư ("theo phiếu NN/ĐNMVT (ngày)") → giá danh mục
  của CHÍNH vật tư (`don_gia > 0`) → trung vị nhóm chỉ khi ≥3 mẫu từ ≥2 phiếu (`categorySamples[].requestId`
  mới trong `loadPurchaseItemInsight`; bản chụp cũ thiếu requestId thì chỉ xét ≥3 mẫu).
- **Nguyên nhân "luôn 3$"** (điều tra DB 2026-10-07): nhóm "Thiết bị phụ tùng thay thế" chỉ có 2 phiếu đã duyệt
  — 03/ĐNMVT (12.000 KHR ≈ 2,93$) và 04/ĐNMVT (2 × 3$), đều là phiếu test; trung vị nhóm đứng trước giá danh
  mục nên cả nhóm ra ≈3$. Phiếu 05 ("Test app", 7 × 3$) là hệ quả. Người dùng chốt huỷ 03, 04, 05 (tự huỷ trên
  UI bằng admin). 350/390 vật tư có `don_gia = 0` (đã lọc, không phải nguyên nhân).
- **Backfill KT đã `--apply`** (actor Administrator `21d59cc2-…`, kho KT = "Kho xưởng cơ khí" — người dùng xác
  nhận đúng): 23/23 biên bản, phiếu `00/ĐNMVT` (2026) `hoan_tat` id `3e1f53b0-6afe-4226-a375-8dac8d64e5f8`,
  13 dòng; tồn KT ròng 13 vật tư = 0; chạy lại = 0 việc mới. Bỏ qua: Lọc nhớt 6505510.5020B (quản lý lô).
- **Vật tư mua ngoài chưa gắn mã**: 481 dòng (424 trên biên bản đã duyệt, 57 chờ duyệt), 384 nhóm tên. Đã xuất
  CSV đề xuất (chỉ đọc) `C:\Users\Software\rubber-erp-backups\doi-chieu-vat-tu-mua-ngoai-2026-10-06.csv`: Chắc 27
  · Gần — cần xem 188 · Không khớp 169; cột "Mã CHỐT" để người dùng điền. CHƯA ghi `inventory_item_id` — phiên
  sau: script gán theo CSV đã duyệt rồi chạy lại backfill (biên bản đã duyệt) cho các dòng mới có mã. Cẩn thận
  cặp gần giống khác hàng thật (UC 208 ≠ UCP 208, B45 ≠ B46).

## U4 giao diện (2026-10-14, chờ test tay)
Danh sách + chi tiết theo rule 29 (mục F). GET danh sách trả thêm `lines` rút gọn (dòng xổ). Chi tiết
70/30: file ký qua `/api/signing/requests/{yeu_cau_ky_id}/file-url` (quyền: người ký /
`purchase.view_all` / admin), Nháp xem bản chưa ký `buildPurchaseDraftPdfBytes` (dùng bản chụp bằng
chứng đã lưu, KHÔNG gọi insight-snapshot). Mọi điều kiện quyền/nút giữ nguyên `detail.perms`.

## Sửa gợi ý giá cho vật tư MỚI (2026-10-16)
Vật tư chưa từng mua + danh mục `don_gia = 0` từng tự điền trung vị nhóm (vd 0,75$) và cảnh báo lệch giá.
Nay `Suggestion.binding`: chỉ giá của CHÍNH vật tư (lần mua gần nhất / giá danh mục) mới tự điền + kiểm lệch
>10%; trung vị nhóm chỉ hiện "Tham khảo: … (vật tư khác nhau, không kiểm tra lệch giá)".

## Lập đề nghị từ biên bản — vật tư mua ngoài phải có mã kho (2026-10-17)
`purchase-draft` chặn 400 khi vật tư mua ngoài của biên bản chưa có mã trong `inventory_items` (trước
đây lỗi FK `purchase_request_lines_item_id_fkey` + phiếu tự "Đã hủy"). Chi tiết: rule 14 mục cuối.

## Dịch vụ gia công ngoài (2026-10-23, chờ test tay)
Dòng có vật tư `la_dich_vu` (`nguon_tao='bao_tri_gia_cong'`) không nhập kho: modal Ghi nhận mua bỏ qua, người đề
nghị/admin dùng nút "Xác nhận hoàn thành" (`perms.canCompleteService`, bảng `purchase_service_completions`,
log `hoan_thanh_dich_vu`). Xem rule 14 mục "Bước 2–3".

## Panel chọn người ký khi gửi (2026-10-26, chờ test tay)
- "Gửi ký duyệt" mà phiếu thiếu Giám đốc/Kế toán (luôn đúng với phiếu lập từ biên bản) hoặc người xem đang
  nhận xử lý phiếu từ biên bản ⇒ mở `PurchaseApproverModal` (điền sẵn người đã lưu, trống thì
  `defaultGiamDocId`/`defaultKeToanId` của `/api/purchase/approvers` — hiện là Tô Thành Luân / Neang Ry Ta).
- Lưu qua route mới `PATCH /api/purchase/requests/[id]/approvers` (chỉ đổi 2 cột, KHÔNG xoá/chèn lại dòng
  ⇒ giữ ảnh + bản chụp). Người gọi = người đề nghị, hoặc nhận xử lý (phiếu từ biên bản + `purchase.create`,
  set người đề nghị + log `nhan_xu_ly`). Log `chon_nguoi_ky`. Rồi `submitPurchaseForSigning` như cũ.
- Nút "Gửi ký duyệt" hiện khi `canSubmit || canTakeOver`. Form sửa phiếu cũng điền gợi ý khi approver NULL.

## Sau duyệt: nhắc bước tiếp + wizard + tab Gia công ngoài (2026-10-26, chờ test tay)
- `da_duyet` hiển thị "Đã duyệt · Chờ ghi nhận mua" tông pending (registry + `PURCHASE_STATUS_LABEL/CLASS`).
- GET danh sách trả `nextStep` (`nhap_kho|gia_cong|ca_hai`, theo `sl_da_mua` + `la_dich_vu`) và `myFulfillTurn`
  (người đề nghị/admin). Badge danh sách ghi "Đã duyệt · Chờ nhập kho / Chờ xác nhận gia công…", chip
  "Tới lượt BẠN"; tab "Chờ tôi xử lý" gồm cả phiếu này; chuông thêm "Phiếu chờ bạn ghi nhận mua / xác nhận gia
  công"; trang chi tiết có banner amber nhắc.
- 2 nút cũ gộp 1: "Ghi nhận mua & hoàn thành" (wizard `FulfillStep`): Bước 1 nhập kho (`ReceiveModal`) →
  Bước 2 gia công (`CompleteServiceModal`), tiêu đề "Bước i/n — Xác nhận nhập kho vật tư / hoàn thành gia
  công"; xong bước 1 nạp lại phiếu rồi mở bước 2 nếu vẫn còn quyền. Kết thúc, phiếu từ biên bản không còn
  phần chờ ⇒ thông báo "Bây giờ bạn có thể quay lại biên bản số … để gửi phê duyệt" (có link). Route
  `receive`/`complete-service` không đổi.
- Tab **"Gia công ngoài"** (`_components/service-completions-view.tsx`, API `GET /api/purchase/service-completions`):
  lọc ngày/bộ phận/đơn vị gia công/tìm, tổng quy USD (tỷ giá nhà máy), link phiếu + biên bản, ảnh, xuất Excel.
  Phạm vi: `purchase.view_all`/admin toàn nhà máy, còn lại phiếu mình liên quan.

## Sửa lỗi theo `bug.md` — GĐ1 (2026-10-31, chờ test tay)
Kế hoạch 4 GĐ: `C:\Users\Software\.claude\plans\c-file-bug-md-x-c-quizzical-meerkat.md`. Không migration.
- **Huỷ**: admin huỷ được phiếu `da_duyet` chưa nhập kho lần nào (trước đây treo vĩnh viễn — nút ẩn, API
  Đóng chỉ nhận `dang_mua`). Nút Huỷ trang chi tiết dùng thẳng `perms.canCancel` (server tính đủ). API huỷ:
  người đề nghị chỉ huỷ phiếu `tra_ve` khi chưa ai ký (khớp giao diện).
- **Quyền mua**: người đứng tên đề nghị mà không có `purchase.create` (người tạo biên bản lập nháp hộ) KHÔNG
  sửa / chọn người ký / gửi ký được (`canEdit`, `canSubmit`, route `submit`, `approvers` đều kiểm), trang
  hiện `perms.needsBuyer` → banner chờ người có quyền "Nhận xử lý". `submit` chặn dòng đơn giá = 0.
- **GET không tự ghi DB nữa**: danh sách + chi tiết khi `yeu_cau_ky = hoan_tat` mà phiếu còn `cho_ky/tra_ve`
  ⇒ gọi `syncPurchaseFromSigning()` (có nhật ký + tính lại phiếu gốc của phiếu điều chỉnh). Bỏ điều kiện
  "đủ chữ ký nhưng yêu cầu ký chưa hoàn tất".
- Modal "Tạo vật tư mới" trong form đề nghị có lựa chọn **Dịch vụ gia công ngoài** (`/api/purchase/items`
  nhận `laDichVu` → `la_dich_vu=true`, `nguon_tao='bao_tri_gia_cong'`, không kho, không rule kho).
- Banner phiếu lập từ biên bản bỏ câu cứng "kho tạm KT".

## Sửa lỗi theo `bug.md` — GĐ2 (2026-10-31, chờ test tay)
Ký biên bản an toàn (bug 3, 4, C1, C2) — chi tiết ở rule 14 mục "Ký biên bản an toàn". Liên quan module này:
"Lập đề nghị mua" từ biên bản mở cho người tạo biên bản, NV phụ trách, người có `purchase.create`, admin
(trước: chỉ người tạo có `maintenance.create` / admin). Người không có `purchase.create` lập nháp xong vẫn cần
người có quyền "Nhận xử lý" (GĐ1).
Sau test tay (2026-11-01): biên bản đổi SL khi đã có phiếu NHÁP liên kết ⇒ "Cập nhật đề nghị nháp" (cùng route
`purchase-draft`) chỉ TĂNG SL / thêm dòng trên nháp, không giảm, không xoá dòng; log `cap_nhat_tu_bao_tri`.
Phiếu `tra_ve` không đồng bộ. Chi tiết: rule 14 mục "Ký biên bản an toàn".

## Nhóm phụ trách biên bản — "người gửi ký đầu tiên chiếm quyền" (2026-11-01, chờ test tay)
Người dùng chốt phương án A (plan `C:\Users\Software\.claude\plans\purchase-dong-xu-ly-bien-ban-2026-11-01.md`).
- Nhóm = người tạo biên bản + NV phụ trách (`isRecordTeamMember` / `isMaintenanceRecordTeam` trong
  `src/lib/purchase/server.ts`, so tên profile — dùng chung với `purchase-draft`).
- Phiếu gốc lập từ biên bản, đang `nhap`/`tra_ve`: người trong nhóm có `purchase.create` thao tác NGANG người đề
  nghị — "Sửa phiếu", "Gửi ký duyệt", "Huỷ phiếu" (huỷ khi chưa ai ký). Sửa phiếu KHÔNG đổi người đề nghị.
- Người trong nhóm bấm "Gửi ký duyệt" phiếu người khác đứng tên (`perms.claimOnSubmit`) ⇒ luôn qua panel chọn
  người ký; PATCH `approvers` chuyển `nguoi_de_nghi_id` sang người gửi, log `nhan_xu_ly` "Đảm nhận phiếu khi gửi
  ký (người phụ trách biên bản)". Sau khi gửi, chỉ người đề nghị thao tác; bị trả về thì nhóm lại can thiệp được.
- Người NGOÀI nhóm có `purchase.create`: chỉ "Nhận xử lý" (Lưu ⇒ thành người đề nghị), rồi mới gửi ký. Không còn
  nút gửi ký thẳng; PATCH `approvers` từ chối 403 "Bấm Nhận xử lý trước".
- Trang phiếu hiện "Người lập" (`lap_boi_id`) khi khác "Người đề nghị". Không migration.
- Sửa sau test (2026-11-01, chờ test lại):
  - Lưu ở form sửa ⇒ trang TẢI LẠI phiếu (await) rồi mới đóng form; nút "Gửi ký" khoá khi đang tải. "Lưu & gửi ký"
    của người trong nhóm (`claimOnSubmit`) mở panel (điền sẵn người ký vừa lưu) thay vì gửi thẳng — gửi thẳng từng
    bị 403 vì người lưu chưa đứng tên đề nghị.
  - `PurchaseApproverModal`: giá trị = lựa chọn của người dùng, chưa chọn thì người đã lưu trên phiếu (cập nhật theo
    prop), trống mới dùng gợi ý. Câu "đứng tên người đề nghị" hiện theo `claimOnSubmit`.
  - Nút "Mở màn ký" chỉ hiện cho người ký / người đề nghị / admin (RLS `yeu_cau_ky_select`); người khác xem PDF +
    tiến trình ngay trên trang (người dùng chốt phương án A).

## GĐ3 — liên kết biên bản THEO DÒNG + lưu phiếu 1 giao dịch (2026-11-02, chờ test tay)
Migration `20261102_purchase_line_maintenance_link.sql` (**chạy tay TRƯỚC deploy** — `computeKtStatuses` đọc cột
mới, thiếu cột thì khối vật tư biên bản + gửi ký biên bản lỗi).
- `purchase_request_lines.maintenance_record_id` (NULL = dự trữ kho); backfill = biên bản của phiếu, dòng điều
  chỉnh theo dòng gốc. Phiếu điều chỉnh chép liên kết từ dòng gốc.
- Form: mỗi dòng có ô **"Cho biên bản"** khi có lựa chọn — biên bản của phiếu, biên bản đang gắn, biên bản đang
  thiếu đúng mã (`GET /api/maintenance/kt-shortages`, nay trả `itemId`), hoặc "Dự trữ kho". Dòng mới lấy biên bản
  của dòng trước. Cùng vật tư được tách dòng nếu khác biên bản (khoá trùng = vật tư + biên bản).
- POST lưu: kiểm biên bản mới gắn thuộc nhà máy + chưa duyệt/huỷ (liên kết đã lưu giữ nguyên); ghi qua RPC
  `purchase_save_lines` (1 giao dịch, giữ dòng theo `id` ⇒ giữ ảnh; bản chụp bằng chứng chỉ xoá ở dòng đổi
  vật tư/SL/giá). Phiếu mới lỗi lưu dòng ⇒ huỷ phiếu vừa cấp số.
- Danh sách: `nextStep` theo SL hiệu lực (`purchase_effective_lines`) − đã nhận.
- Chi tiết: API trả `lineRecords`; dòng gắn biên bản khác biên bản của phiếu hiện "Cho biên bản …" (link).
- `isMaintenanceRecordTeam` / phiếu nháp để đồng bộ vẫn theo `purchase_requests.maintenance_record_id` (biên bản
  gốc của phiếu), không theo từng dòng.
- ⚠️ Triển khai: chạy 20261102 → deploy → chạy NGAY `20261103_purchase_line_link_rebackfill.sql` (điền lại
  dòng NULL của phiếu lập từ biên bản trong khoảng giữa; lỗi đã gặp ở localhost: hàng nhập không giữ cho
  biên bản, biên bản báo thiếu sai, sinh phiếu trùng).
- Xuất kho vật tư mua ngoài CHỈ khi biên bản ký hoàn tất — "đủ hàng / gửi ký được" chưa trừ tồn.
- Form (sửa sau test 2026-11-02): ô "Cho biên bản" hiện cả khi dòng chưa chọn vật tư; ô chọn vật tư chỉ khoá
  vật tư đã có dòng CÙNG biên bản ("Dự trữ kho" là 1 nhóm); Lưu kiểm trùng (vật tư + biên bản) như server.
- Test tay GĐ3 bước 1–7 ĐẠT (2026-11-02). 4 lỗi nhỏ còn lại đã sửa (2026-11-02, chờ test tay):
  (1) `KtItemStatus.pendingRequests` (phiếu + SL còn chờ) ⇒ câu chặn gửi ký / khối biên bản / banner nói "chờ nhập
  kho theo đề nghị NN/ĐNMVT" hoặc "cần lập thêm đề nghị cho N" (`describeKtShortage`);
  (2) bằng chứng có `reservedStock`/`reservedRecords` (= phần chia cho biên bản chưa duyệt, `computeReservedStock`
  trong maintenance-kt, tính 1 lần cho cả phiếu khi chụp) ⇒ "Tồn còn nhiều" + "đủ dùng N ngày" theo TỒN TRỐNG
  (`insightFreeStock`); bản chụp cũ không có trường ⇒ như trước;
  (3)+(4) "phiếu khác còn mở" gom theo phiếu gốc, SL = hiệu lực − đã nhận (`purchase_effective_lines`), phiếu đã nhận
  đủ vật tư thì không còn liệt kê. Giá biên bản (5) đã làm ở GĐ4.
- Test + bàn giao: `C:\Users\Software\.claude\plans\purchase-gd3-test-va-ban-giao-2026-11-01.md`.

## GĐ4 A1–A3 — giá biên bản ↔ đề nghị (2026-11-02, chờ test tay)
Giá trên dòng đề nghị gắn biên bản là nguồn giá của biên bản (phiếu gần nhất, trừ Huỷ). Lưu / huỷ phiếu,
lập nháp từ biên bản, duyệt phiếu điều chỉnh ⇒ đồng bộ giá về biên bản chưa gửi ký. Gợi ý giá form dùng
`pickReferencePrice` chung với biên bản. Chi tiết: rule 14 mục "GĐ4 — giá vật tư mua ngoài".

## Tab "Hướng dẫn" (2026-11-02)
`_components/purchase-guide.tsx` — luồng Biên bản ↔ Đề nghị ↔ Kho, 3 nguồn vật tư, lập từ biên bản / nhóm phụ trách,
ghi nhận mua, giữ hàng 2 tầng, thứ tự giá, sửa giá / điều chỉnh, ngưỡng Lớn/Nhỏ, tình huống thường gặp. Mô tả đúng code
hiện tại — đổi logic ở rule 14/28 thì cập nhật cả trang này.

## Nút ghi nhận trên danh sách + Enter ở màn ký (2026-11-02, chờ test tay)
- Cột Thao tác danh sách: `myFulfillTurn` ⇒ nút "Ghi nhận nhập kho" / "Xác nhận gia công" / "Ghi nhận mua" (theo
  `nextStep`, cạnh "Ký ngay") → `/dashboard/purchase/{id}?fulfill=1`; trang chi tiết tự mở wizard 1 lần theo
  `perms.canReceive/canCompleteService` rồi bỏ tham số khỏi URL.
- Màn ký chung `/dashboard/ky/[id]`: ô PIN Enter = Xác nhận ký (khi có PIN, không đang ký), Esc = Để sau.

## GĐ4 A5 — sửa giá sau khi nhập kho (2026-11-02, chờ test tay)
Migration `20261103_purchase_actual_price.sql` (**chạy tay TRƯỚC deploy**).
- RPC `purchase_update_actual_price` (service_role): sửa `inventory_document_lines.don_gia` (phiếu nhập đã ghi
  sổ, tính lại `purchase_receipts.tong_tien`) hoặc `purchase_service_completions.don_gia`; lệch ≤10% giá duyệt
  hiệu lực. Route `POST /api/purchase/requests/[id]/actual-price` `{kind: receipt|service, targetId, donGia,
  lyDo}` — người đề nghị/admin, lý do bắt buộc, log `sua_gia`. Không đổi SL/tồn (movement không lưu giá).
- Lệch >10%: phiếu điều chỉnh. Nay mở cho phiếu `hoan_tat` + dòng đã nhập đủ khi CHỈ đổi giá (route `adjust` +
  `AdjustModal` khoá vật tư/SL). Duyệt xong ⇒ `onPurchaseAdjustmentApproved` (áp giá qua RPC
  `purchase_apply_line_price` cho mọi lần nhập + gia công của dòng gốc, log `sua_gia`, rồi đồng bộ biên bản).
  ⚠️ Gọi trong `signField` (`lib/signing/requests.ts`, nhánh purchase) — chính nó chuyển phiếu sang hoàn tất khi
  ký bước cuối, nên `syncPurchaseFromSigning` (gọi sau ở route) luôn thoát sớm. Việc "sau khi duyệt" phải đặt ở
  `signField`, không chỉ ở `syncPurchaseFromSigning` (lỗi đã gặp khi test 2026-11-02, phiếu 81 bù tay bằng script).
- Huỷ xác nhận gia công: `POST …/service-completions/[cid]/cancel` `{lyDo}`; chặn khi biên bản gắn dòng đã
  duyệt hoặc có `yeu_cau_ky` đang luân chuyển/hoàn tất; xoá bản ghi → `purchase_recompute_request`, log
  `huy_hoan_thanh_dich_vu`.
- UI: nút "Sửa giá" trên từng dòng lịch sử nhập + lần gia công, "Huỷ xác nhận" trên lần gia công
  (`perms.canEditActualPrice`); `canAdjust` thêm nhánh phiếu Hoàn tất.

## Mã vật tư: nhập khi tạo mới + hiện mã hiện hành (2026-11-09, chờ test tay)
- Modal "Tạo vật tư mới" có ô Mã (tuỳ chọn, in hoa, bỏ khoảng trắng; trống ⇒ server tự sinh theo phân loại như cũ). Trùng
  mã ⇒ báo đỏ ngay + nút "Dùng vật tư này"; server vẫn chặn 409.
- `purchase_request_lines.item_code` là bản chụp. `loadCurrentItemCodes()` (`lib/purchase/server.ts`) gắn `current_item_code`
  vào dòng ở GET danh sách + chi tiết; màn hình hiện mã hiện hành kèm "(mã lúc lập: …)" khi khác. PDF dựng mới (nháp/gửi
  ký lại) in mã hiện hành; POST lưu phiếu ghi bản chụp theo mã hiện hành. PDF đã ký bất biến, không ghi đè dữ liệu cũ.

## Gia công ngoài B1–B4 (2026-11-09, B1–B3 test localhost PASS, B4 chờ test)
Kế hoạch: `.claude/plans/gia-cong-ngoai-2026-11-09.md`. Không migration. Người dùng chốt Q1 giữ tiêu đề PDF + dòng phụ,
Q2 chung dãy ĐNMVT, Q3 badge chỉ cho phiếu gia công / hỗn hợp.
- Dịch vụ nhận diện bằng `isServiceItem` (`lib/purchase/types.ts`): `la_dich_vu` là nguồn sự thật, `nguon_tao` chỉ dự phòng.
  Loại phiếu `purchaseRequestKind` = `vat_tu | gia_cong | hon_hop`, tính từ các dòng, KHÔNG lưu DB.
- API danh sách: `requestKind` + `lines[].la_dich_vu`, lọc `?kind=a,b`, `scope=visible` (= all nếu có view_all, ngược lại mine).
  API chi tiết: `requestKind`.
- Tab "Gia công ngoài": thẻ con "Phiếu gia công" (bảng chung, `scope=visible&kind=gia_cong,hon_hop`) + "Sổ hoàn thành"
  (`service-completions-view.tsx`). Link `?tab=gia_cong&sub=so`.
- Badge `StatusBadge tone="accent"` (tông tím mới trong `status-registry.ts`, dành cho nhãn PHÂN LOẠI) ở danh sách, dòng xổ,
  trang chi tiết; bộ lọc "Loại phiếu" (ở tab Gia công chỉ 2 lựa chọn).
- PDF: `purchaseKindSubtitle` in "(Gia công ngoài)" / "(Gồm gia công ngoài)" dưới tiêu đề; dòng dịch vụ có "GC" ở Ghi chú.
  Chỉ PDF dựng mới; PDF đã ký bất biến.
- Form: dòng dịch vụ đổi nhãn 3 ô (Đơn vị nhận gia công / Ngày dự kiến xong / Ngày cần hoàn thành — cùng cột mua_tai /
  ngay_co_hang / ngay_can_hang). `/dashboard/purchase/new?mode=gia_cong` (nút "Lập phiếu gia công" ở tab Gia công): banner
  riêng, `ItemPicker serviceDefault` bật nút "Chỉ dịch vụ", "tạo mới" mặc định dịch vụ. Sửa phiếu loại gia công cũng mở mode này.
- Sau test B4 (2026-11-09, chờ test): người đề nghị GIỮ như cũ (người dùng chốt). Giám đốc mặc định: `maintenance_staff.mac_dinh_ky`
  (migration `20261119_maintenance_staff_mac_dinh_ky.sql`, **chạy tay**; tick ở Cài đặt → Nhân sự "Người ký mặc định khi trùng
  chức vụ"). `/api/purchase/approvers` chọn người tick trong nhóm cùng chức vụ (Giám đốc / Kế toán), chưa tick ⇒ người đầu theo
  tên (lý do: Chau Chók và Tô Thành Luân cùng chức vụ chính quyền "Giám đốc"). Form vẫn bỏ gợi ý nếu trùng người đang lập.
- Icon gia công = `_components/gia-cong-icon.tsx` (bánh răng + tia lửa điện, kiểu `LucideIcon`): banner tab Gia công / lập / sửa
  phiếu gia công, nút "Xác nhận gia công", lịch sử hoàn thành, thẻ hướng dẫn.
