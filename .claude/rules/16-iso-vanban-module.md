## description: Module ISO & Văn bản nội bộ — workflow ký duyệt, chữ ký số PIN, PDF generation

# Module ISO & Văn bản Nội bộ

## Phạm vi

Module này thay thế AppSheet + Google Apps Script cho 2 nhóm nghiệp vụ:

- `ISO` tại `/dashboard/iso/`
- `Văn bản nội bộ` tại `/dashboard/documents/`

Tài liệu cũ không migration ngược. Chỉ quản lý tài liệu tạo mới trong ERP.
Mọi dữ liệu phải gắn `factory_id` và lọc theo nhà máy đang đăng nhập.

---

## Migrations ISO đang dùng

- `20260522_iso_vanban_module.sql`
- `20260523_iso_phan_loai_tl.sql`
- `20260524_iso_signature_placement.sql`
- `20260526_iso_standards_review.sql`
- `20260527_iso_office_signing.sql`
- `20260530_iso_auto_convert_pdf.sql`
- `20260603_iso_lan_ban_hanh_text.sql`
- `20260609_iso_distribution.sql` — Tạo bảng `iso_distribution_batches`, `iso_distribution_recipients`; indexes; RLS; seed `iso.distribute` vào `permissions` và cấp mặc định cho `admin`, `manager` trong `role_permissions`

Các migration đánh dấu “chạy thủ công” trong lịch sử phải được xác nhận đã áp dụng ở môi trường production trước khi kết luận lỗi là do code.

---

## Bảng `iso_documents`

Các cột quan trọng đang được dùng trong nghiệp vụ:

- `ma_tai_lieu`, `ten_tai_lieu`, `loai_tai_lieu`, `phong_ban`, `cap_tl`
- `phan_loai_tl`: `cha` | `con`
- `chon_quy_trinh`: `Soạn thảo` | `Soát xét`
- `trang_thai`: `draft` | `cho_xem_xet` | `cho_phe_duyet` | `co_hieu_luc` | `het_hieu_luc` | `tra_ve` | `bi_tu_choi_phe_duyet`
- `soan_thao`, `xem_xet`, `phe_duyet`
- `soan_thao_user_id`, `xem_xet_user_id`, `phe_duyet_user_id`
- `ky_soan_thao_at`, `ky_xem_xet_at`, `ky_phe_duyet_at`
- `soan_thao_placement`, `xem_xet_placement`, `phe_duyet_placement`
- `file_goc_url`, `file_signed_pdf_url`
- `file_signed_office_url`, `file_signed_office_type`
- `file_phieu_yeu_cau_thay_doi_url`, `file_phieu_yeu_cau_thay_doi_signed_url`
- `file_de_nghi_soat_xet_url`, `file_de_nghi_soat_xet_signed_url`
- `auto_convert_pdf`
- `ma_tai_lieu_cu`, `ma_tai_lieu_moi`, `ly_do_soat_xet`, `noi_dung_soat_xet`
- `ngay_hieu_luc`, `ngay_het_hieu_luc`, `ghi_chu`, `qr_url`
- `parent_doc_id`

---

## Quy tắc mã tài liệu

### Phân loại cha/con

- `F` luôn là hồ sơ con.
- `PL`, `HD` có thể là cha hoặc con.
- Các loại còn lại là tài liệu cha.

Logic chuẩn trong code:

```ts
const isCon = phan_loai_tl === "con" || loai_tai_lieu === "F"
```

### Format mã

- Tài liệu cha: `{PB}-{LOAI}{SO}`
  - Ví dụ: `NMCB-QT01`
- Hồ sơ con: `{MA_CHA}-{LOAI}{SO}`
  - Ví dụ: `NMCB-QT01-F01`

### Nguyên tắc lưu mã khi soát xét

- `normalizeDocumentCode()` chỉ dùng để so sánh trùng mã.
- Khi lưu `ma_tai_lieu` hoặc `ma_tai_lieu_moi`, phải giữ nguyên format user nhập sau `trim().toUpperCase()`.
- Không được xóa dấu gạch hoặc biến mã ISO thành chuỗi liền.

---

## Permissions

Permissions hiệu lực:

- `iso.view`, `iso.create`, `iso.edit`, `iso.delete`
- `iso.soat_xet`, `iso.xem_xet`, `iso.phe_duyet`, `iso.print`
- `iso.signature`
- `iso.distribute` — phân phối tài liệu đến người dùng; cấp mặc định cho `admin` và `manager`
- `documents.view`, `documents.create`, `documents.edit`, `documents.delete`
- `documents.ky_phong_ban`, `documents.phe_duyet`, `documents.print`
- `settings.master_data`, `settings.maintenance_config`

`iso.soat_xet` là permission chính cho bước soát xét/xem xét. Có thể fallback `iso.xem_xet` để tương thích dữ liệu cũ, nhưng phân quyền mới phải cấp `iso.soat_xet`.

---

## Workflow ISO

### Cấp 1

`draft -> cho_xem_xet -> cho_phe_duyet -> co_hieu_luc -> het_hieu_luc`

Nhánh phụ:

- `cho_xem_xet -> tra_ve`
- `cho_phe_duyet -> bi_tu_choi_phe_duyet`
- `bi_tu_choi_phe_duyet -> cho_phe_duyet`
- `bi_tu_choi_phe_duyet -> draft`

### Cấp 2

`draft -> cho_phe_duyet -> co_hieu_luc -> het_hieu_luc`

Nhánh phụ:

- `cho_phe_duyet -> tra_ve`

### Mapping action -> trạng thái đích trong file

- `gui_xem_xet` -> `Chờ xem xét`
- `gui_phe_duyet` -> `Chờ phê duyệt`
- `gui_lai_phe_duyet` -> `Chờ phê duyệt`
- `phe_duyet` -> `Có hiệu lực`
- `tra_ve`, `khong_xem_xet`, `tra_ve_nhap` -> `Trả về`
- `tu_choi_phe_duyet` -> `Phê duyệt từ chối`

Khi tính tag tên/chữ ký trong `generate-office` và `generate-pdf`, phải ưu tiên suy ra bước ký từ `action` trước, chỉ fallback sang so khớp theo `userId` nếu không có `action`.

---

## Soát xét

### Điều kiện chọn tài liệu nguồn

- Chỉ cho chọn tài liệu/hồ sơ có `trang_thai = 'co_hieu_luc'`
- Cùng `factory_id`
- Lọc theo tầng:
  - Tiêu chuẩn
  - Phòng ban
  - Loại tài liệu / loại hồ sơ
  - Mã tài liệu / mã hồ sơ

### Bắt buộc khi tạo hồ sơ soát xét

- `ly_do_soat_xet`
- `noi_dung_soat_xet`
- Nếu `doi_ma_tai_lieu = true` thì bắt buộc `ma_tai_lieu_moi`

### Quy tắc trùng mã

- Soạn thảo mới vẫn chặn trùng mã với mọi bản ghi active khác trong cùng `factory_id`.
- Soát xét được phép lưu mã trùng nếu trùng đúng với tài liệu/hồ sơ nguồn đang được soát xét.
- Quy tắc này áp dụng cho cả tài liệu cha và hồ sơ con.

### Sau khi phê duyệt soát xét

- Bản mới chuyển `co_hieu_luc`
- Bản cũ gần nhất theo `ma_tai_lieu_cu` bị chuyển `het_hieu_luc`
- Nếu bản cũ là PDF thì gọi `restamp-pdf`
- Không được để tồn tại hơn 1 bản `co_hieu_luc` cùng mã sau khi hoàn tất

---

## Hồ sơ con

### Nguyên tắc nghiệp vụ

- Mỗi hồ sơ con là một bản ghi riêng trong `iso_documents`
- Liên kết với tài liệu cha bằng `parent_doc_id`
- Có mã, QR, trạng thái, lịch sử ký riêng

### Hồ sơ con PDF

- Phải có footer trạng thái trên tất cả các trang
- Footer phải phản ánh trạng thái theo action hiện tại, không giữ trạng thái cũ
- Nếu footer mẫu đã điền một phần, hệ thống chỉ thay phần còn thiếu và giữ lại ngày hợp lệ đã có

### Hồ sơ con DOCX/XLSX

- Dùng bộ tag chuẩn ISO cộng thêm `{{QR}}`
- Tag đúng có trong file thì thay
- Tag đúng không có trong file thì bỏ qua, không chặn workflow
- Tag sai hoặc gần giống dạng `{{...}}` thì chặn và yêu cầu sửa template
- DOCX phải quét body, bảng, header, footer và text trong drawing/textbox nếu nằm trong XML Word
- `{{QR}}` trong DOCX phải thay được cả khi đứng độc lập hoặc chung run/chung dòng với tiêu đề
- QR hồ sơ con dùng kích thước khoảng `12mm x 12mm`
- Ở bước 2/3 của Office, không được tự chèn QR mặc định nếu artifact mới nhất không còn tag `{{QR}}`
- Tên người ký hệ thống chèn vào DOCX/XLSX phải dùng `Times New Roman`, size `12`

### Nguyên tắc artifact nhiều bước cho Office

- Hồ sơ Office ký nhiều bước phải ký tiếp trên artifact mới nhất
- Không được tạo lại từ template gốc nếu đã có artifact bước trước
- Không được xóa tag tên/chữ ký của bước sau chỉ vì giá trị bước hiện tại đang rỗng
- Nếu snapshot `xem_xet` / `phe_duyet` rỗng, phải fallback lấy tên từ `profiles`

---

## File phụ soát xét

File phụ soát xét gồm:

- `Phiếu yêu cầu thay đổi`
- `Đề nghị soát xét`

### Quy tắc chung

- File phụ không được xem như hồ sơ con để xử lý footer
- Không được chạm vào footer của file phụ ở cả 3 định dạng:
  - `PDF`
  - `DOCX`
  - `XLSX`
- Placement modal cho file phụ vẫn được dùng để đặt chữ ký/QR theo luồng hiện tại
- Ở file phụ, QR draggable chỉ xuất hiện ở bước `soan_thao`
- Tính năng nhân bản chữ ký của file phụ phải nhân bản cả ô tên người ký

### File phụ PDF

- Được phép đọc text template để điền dữ liệu trong phần thân nếu phát hiện đúng nhãn nghiệp vụ
- `Phiếu yêu cầu thay đổi`:
  - Nếu phát hiện `Lý do soát xét:` hoặc `Lý do thay đổi:` và phía sau dấu `:` chưa có giá trị thực, chèn nội dung vào sau dấu `:`
  - Nếu đã có giá trị thực thì bỏ qua
- `Đề nghị soát xét`:
  - Nếu phát hiện `Nội dung soát xét:` hoặc `Nội dung thay đổi:` và phía sau dấu `:` chưa có giá trị thực, chèn nội dung vào sau dấu `:`
  - Nếu đã có giá trị thực thì bỏ qua
- Nếu không đọc được text template thì không được vẽ footer fallback toàn trang

### File phụ DOCX/XLSX

- Không dùng fallback chèn nội dung sau dấu `:`
- Chỉ thay theo tag hợp lệ có sẵn trong template
- Không giới hạn chỉ `{{LY_DO_SOAT_XET}}` và `{{NOI_DUNG_SOAT_XET}}`
- Các tag hợp lệ khác như `{{QR}}`, `{{MA_TAI_LIEU}}`, `{{LAN_BAN_HANH}}`, `{{NGAY_HIEU_LUC}}`, `{{TINH_TRANG}}`, tag tên người ký, tag chữ ký... nếu có trong template thì vẫn phải thay
- Tag đúng không có trong file thì bỏ qua
- Nếu người dùng đã điền sẵn bằng chữ thường thay vì tag thì không ghi đè

---

## PDF generation

### Auto-fill trường form từ tên file upload

Hàm `parseDocNameFromFileName(filename)` tại `documents/[id]/page.tsx` parse tên file theo pattern:

```
{PHONG_BAN}-{LOAI}{SO_HIEU} {TEN_TAI_LIEU}
Ví dụ: "PHK-QT22 Quy trình kiểm soát" → phong_ban=PHK, loai=QT, so_hieu=22, ten=Quy trình kiểm soát
```

Quy tắc áp dụng khi upload file chính (`target === "main"`):

- **Soạn thảo**: chỉ điền vào trường đang trống (không override nếu user đã nhập)
- **Soát xét**: luôn override `form.ten_tai_lieu` (= trường "Tên tài liệu mới") từ tên file nếu parse được, vì pre-fill từ tài liệu nguồn đã lấp đầy trường này bằng tên cũ
- Các trường `phong_ban`, `loai_tai_lieu`, `so_hieu` vẫn chỉ fill khi trống (cả Soạn thảo lẫn Soát xét)
- Hàm `rebuildDraftCode` được gọi ngay sau khi điền để tự sinh mã tài liệu

Với upload file hồ sơ con soát xét (`handleReviewRowFileUpload`):

- `ten_tai_lieu_moi` trong `ChildReviewRow` được fill từ tên file nếu đang trống và parse được

### Nguồn tài nguyên pdfjs trên production

- `generate-pdf/route.ts` phải ưu tiên dùng asset local của `pdfjs-dist` trong `node_modules` cho `cMap` và `standard_fonts`
- Không phụ thuộc CDN để đọc text PDF trên production
- Nếu local asset không sẵn mới fallback tối giản

### Ngày hiệu lực trong header và footer PDF

- `effectiveDate` chỉ được lấy ngày hiện tại khi `action === "phe_duyet"`.
- Với mọi action khác (`gui_xem_xet`, `gui_phe_duyet`): `dateStr = ""`.
- Khi `dateStr = ""`: header "Ngày hiệu lực" tự động bị skip (check `!header.value`).
- Khi `dateStr = ""`: footer dùng chuỗi `"Ngày hiệu lực"` làm placeholder thay vì để ngày rỗng, tránh footer dị dạng như `PHK-QT10 (01-) Chờ xem xét`.
- Footer trung gian sẽ có dạng: `PHK-QT10 (01-Ngày hiệu lực) Chờ xem xét`.
- Regex `FOOTER_PENDING_DATE_RE` detect footer đã có placeholder "Ngày hiệu lực" để các bước ký tiếp theo (kể cả `phe_duyet`) nhận ra và cập nhật đúng.
- Tại `phe_duyet`: footer trở thành `PHK-QT10 (01-dd/mm/yyyy) Có hiệu lực` với ngày thật.
- Nếu `doc.ngay_hieu_luc` đã được set (tài liệu đã phê duyệt, dùng lại route): ưu tiên ngày đó cho mọi action.

### Footer fallback

- Nếu `fillMetadataPlaceholders()` trả `metaResult.error`, route PDF không được gọi `drawFooterOnAllPages()`
- Quy tắc này áp dụng cho các trường hợp thật sự có xử lý footer

### Phạm vi được chạm footer

- File `main`:
  - Được xử lý footer theo nghiệp vụ hiện hành
- File phụ `change_request` / `review_request`:
  - Không được xử lý footer

---

## Office signing

### Quy tắc chung

- Không biến DOCX/XLSX thành PDF để ký thay cho file gốc trong các bước ký Office thông thường
- File chính đã ký lưu vào `file_signed_office_url` + `file_signed_office_type`
- File phụ Office đã ký lưu vào:
  - `file_phieu_yeu_cau_thay_doi_signed_url`
  - `file_de_nghi_soat_xet_signed_url`

### Tag hợp lệ đang dùng

- Thông tin chính:
  - `{{MA_TAI_LIEU}}`
  - `{{TEN_TAI_LIEU}}`
  - `{{PHONG_BAN}}`
  - `{{LOAI_TAI_LIEU}}`
  - `{{LAN_BAN_HANH}}`
  - `{{LAN_SUA_DOI}}`
  - `{{NGAY_HIEU_LUC}}`
  - `{{TINH_TRANG}}`
  - `{{QR}}`
- Soát xét:
  - `{{MA_TAI_LIEU_CU}}`
  - `{{MA_TAI_LIEU_MOI}}`
  - `{{LY_DO_SOAT_XET}}`
  - `{{NOI_DUNG_SOAT_XET}}`
  - `{{LY_DO_THAY_DOI}}`
  - `{{NOI_DUNG_THAY_DOI}}`
- Chữ ký:
  - `{{CHU_KY_SOAN_THAO}}`
  - `{{TEN_SOAN_THAO}}`
  - `{{CHU_KY_XEM_XET}}`
  - `{{TEN_XEM_XET}}`
  - `{{CHU_KY_PHE_DUYET}}`
  - `{{TEN_PHE_DUYET}}`

---

## Văn bản nội bộ

Văn bản nội bộ tiếp tục dùng workflow riêng của module documents.
File rule này chỉ giữ lại các nguyên tắc chung đã ổn định:

- Có `factory_id`
- Có workflow ký/phê duyệt riêng
- Có `file_goc_url`, `file_signed_pdf_url`
- Có audit trail qua `doc_approval_log`
- Guard permission phải có ở cả UI và API

Các quy tắc chi tiết riêng của văn bản nội bộ nếu phát sinh thêm nên tách sang file rule riêng để tránh lẫn với module ISO.

---

## Phân phối tài liệu ISO

### Bảng dữ liệu

- `iso_distribution_batches`: mỗi lần bấm "Phân phối" tạo 1 batch — `id`, `factory_id`, `distributed_by` (UUID auth.users), `distributed_at`, `ghi_chu`
- `iso_distribution_recipients`: mỗi row = 1 tài liệu × 1 người nhận — `id`, `batch_id`, `iso_document_id`, `factory_id`, `recipient_user_id`, `first_viewed_at`, `first_downloaded_at`

### Permission

- `iso.distribute` — cấp mặc định cho `admin` và `manager`
- Guard ở cả UI (nút Phân phối) và API route

### API routes

- `GET /api/iso/distribute?factoryId=xxx&docIds=id1,id2` — trả về danh sách active profiles kèm `alreadyReceived`, department đã resolve
- `POST /api/iso/distribute` — tạo batch, insert recipients, gửi in-app notification + Telegram + Email
- Các route con: `track/`, `notify-obsolete/`, `recipient/[recipientId]/`

### Quy tắc RLS quan trọng

RLS của bảng `profiles` chỉ cho `admin` đọc tất cả profiles trong factory (policy `profiles read own or admin same factory`). Role `manager` bị chặn khi query trực tiếp từ browser client.

**Bắt buộc**: mọi query lấy danh sách users trong factory phải dùng API route server-side với `supabaseAdmin`, **không được** dùng `supabase` browser client trực tiếp trong component. Quy tắc này áp dụng cho cả `DistributionModal` và bất kỳ feature nào cần xem danh sách người dùng mà không phải trang Settings (Settings chỉ dành cho admin).

### UI — DistributionModal

- Bước 1: Chọn tài liệu (filter theo loại + search)
- Bước 2: Chọn người nhận — load qua `GET /api/iso/distribute` (không query profiles trực tiếp)
- Người đã nhận tài liệu đó hiển thị mờ + badge "Đã nhận", checkbox disabled
- Nút "Chọn tất cả" chỉ chọn người chưa nhận
- Sau phân phối: in-app notification + Telegram + Email

---

## Hợp nhất eye-icon chữ ký/tên + tiền tố ký thay KT/TM/TL/TUQ cho toàn bộ module ISO (2026-07-13, ĐÃ CODE XONG)

**Cập nhật 2026-07-13 (phiên tiếp theo)**: Toàn bộ mục dưới đây đã được triển khai — cả 2 module ISO (Soạn thảo ISO lẫn Thực hiện hồ sơ ISO). Phạm vi cuối cùng đã chốt qua 2 câu hỏi xác nhận trực tiếp với người dùng (khác một chút so với bản nháp ban đầu ghi ở dưới — giữ nguyên phần dưới làm lịch sử quyết định, phần này là tóm tắt những gì THỰC SỰ đã code):

- **Tên file hiển thị ở "Thực hiện hồ sơ ISO"** (`iso/forms/[id]/page.tsx`): xác nhận giữ nguyên — nhãn "Tên file" trên thẻ file luôn hiển thị `instance.tieu_de` (tiêu đề hồ sơ), không phải tên file gốc đã upload. Đây là thiết kế cố ý (đã ghi trong mục "Download filename" phía trên), không phải bug — không cần thêm cột lưu tên file gốc.
- **Phạm vi bước áp dụng tiền tố**: **chỉ bước Phê duyệt**, không áp dụng cho Soạn thảo/Xem xét, giống Văn bản nội bộ (loại trừ bước `ca_nhân`).
- **Ẩn/hiện chữ ký ở tài liệu cha (Soạn thảo ISO)**: giữ nguyên rule cũ — tài liệu cha chỉ ẩn được "tên", không ẩn được "chữ ký" (chỉ hồ sơ con/file phụ mới ẩn được cả 2). Thay đổi chỉ là trình bày (nút chữ → icon mắt tròn overlay góc trên-phải khung kéo-thả, mirror `forms/[id]/page.tsx`), không đổi điều kiện `placementDocIsCon`.
- **Tiền tố**: không thêm eye-icon riêng cho khung tiền tố — giữ cơ chế của Văn bản (chọn radio "Trực tiếp" = ẩn khung, chọn KT/TM/TL/TUQ = hiện khung kéo-thả).

### Migration cần chạy thủ công

`supabase/migrations/20260713_iso_phe_duyet_sign_as.sql` — thêm cột `phe_duyet_sign_as TEXT` vào cả `iso_documents` và `iso_form_instances`. **Chưa chạy trên Supabase** — phải chạy trước khi deploy code, nếu không action `phe_duyet` ở cả 2 module sẽ lỗi update (cột không tồn tại).

### Thay đổi theo file

- `src/app/dashboard/iso/_components/iso-types.ts`: thêm `SignAsType`, `SIGN_AS_OPTIONS`, `SIGN_AS_LABEL` (mirror đúng Văn bản — `documents-types.ts`); thêm `phe_duyet_sign_as?: SignAsType | null` vào cả `IsoDocument` và `IsoFormInstance`.
- `src/app/api/sign/generate-pdf/route.ts` (Soạn thảo ISO — PDF stamping): `SignPlacement` type thêm `showPrefix?/prefixX?/prefixY?/prefixWidth?/prefixHeight?`. Tính `prefixText` một lần từ `doc.phe_duyet_sign_as` (đọc trực tiếp từ DB, **không** truyền qua request body — vì `doTransition` phía client đã ghi cột này vào DB **trước** khi gọi generate-pdf, nên route luôn đọc được giá trị mới nhất tại thời điểm stamp). Vẽ `prefixText` trong CẢ 2 vòng lặp vẽ chữ ký/tên (vòng chính + vòng fallback khi tải PDF lần 2), gated theo `placement.showPrefix` — áp dụng đồng nhất cho cả file main lẫn file phụ (change_request/review_request) vì dùng chung 1 vòng lặp `allPlacements`.
- `src/app/api/iso/forms/[id]/finalize/route.ts` (Thực hiện hồ sơ ISO): import `SIGN_AS_OPTIONS`/`SignAsType` từ `iso-types.ts` (cross-import từ API route vào `src/app/dashboard/...` — đã có tiền lệ ở `src/app/api/documents/sign/route.ts`). `SignPlacement` thêm prefix fields. `stampPdf()` nhận thêm `prefixText?: string | null` per-entry trong mảng `placements`. Nhánh `action === "phe_duyet"`: đọc `sign_as` từ request body, validate bằng `isValidSignAs`, tính `prefixTextPD`, gắn vào entry `{ userId, placement, signerName, prefixText: prefixTextPD }` (chỉ entry phê duyệt, không phải soạn thảo/xem xét), lưu `phe_duyet_sign_as` vào `updates`. **Không** áp dụng cho nhánh Office (DOCX/XLSX) — đúng quyết định "không cần cho Office".
- `src/app/dashboard/iso/forms/[id]/page.tsx`: `FullPlacement` thêm prefix fields. `SignPlacementModal` thêm state `signAs`/`prefixState`/`prefixNodeRef`; `showSignAsPicker = action === "phe_duyet" && showCanvas`; radio picker + khung kéo-thả viền xanh emerald (chỉ hiện khi `signAs !== "none"`); `onConfirm` đổi signature thành `(pin, placement, signAs)`. `handleSignConfirm` nhận thêm `signAs`, gửi `sign_as` trong body POST `/api/iso/forms/[id]/finalize`. Timeline "Phê duyệt" hiển thị `signAsPrefixLabel(instance.phe_duyet_sign_as)` trước tên.
- `src/app/dashboard/iso/documents/[id]/page.tsx` (Soạn thảo ISO — phần lớn thay đổi, do kiến trúc hàng đợi nhiều file):
  - `SignPlacement` (type cục bộ) thêm prefix fields.
  - State `placementModal` thêm `prefixX/prefixY/prefixW/prefixH` (reset theo từng file trong hàng đợi, giống `sigX/sigY`).
  - State `signAs: SignAsType` đặt **NGOÀI** `placementModal` (không reset khi `openPlacementForTask` chuyển sang file tiếp theo trong hàng đợi) — để 1 lựa chọn ký thay áp dụng nhất quán cho toàn bộ các file (main + file phụ + hồ sơ con) ký trong cùng 1 lượt Phê duyệt. Reset về `"none"` mỗi khi bắt đầu lượt ký mới (đầu `handlePinConfirm`, ngay sau khi đóng PIN modal).
  - Toolbar trong modal đặt chữ ký: 2 nút chữ "Ẩn/Hiện chữ ký"/"Ẩn/Hiện tên" cũ đã bị xóa, thay bằng radio "Ký thay" (chỉ hiện khi `placementModal.action === "phe_duyet"`).
  - Khung chữ ký: thêm icon mắt overlay góc trên-phải (chỉ hiện khi `placementDocIsCon`, giữ đúng rule cũ) + placeholder "Ẩn chữ ký" khi đang ẩn.
  - Khung tên: đổi từ unmount-khi-ẩn (không thể bật lại từ trong khung) sang always-mounted + toggle eye-icon (mirror đúng pattern `forms/[id]/page.tsx`) — nút "(X)" cũ (chỉ ẩn, không hiện lại được) đã bị thay thế hoàn toàn.
  - Khung tiền tố mới (viền emerald) chỉ hiện khi `action === "phe_duyet" && signAs !== "none"`.
  - `handlePlacementConfirm`: thêm `showPrefix/prefixX/prefixY/prefixWidth/prefixHeight` vào `placement` khi action là phe_duyet và đã chọn ký thay; gọi `doTransition(..., signAs)`.
  - `doTransition`: thêm tham số `transitionSignAs: SignAsType = "none"`; nhánh `phe_duyet` ghi `phe_duyet_sign_as` vào cả update chính (`docId`) lẫn 2 nhánh update hồ sơ con (`childReviewUpdates` và `remainingChildIds`).
  - UI: badge nhỏ hiện tiền tố (`signAsPrefixLabel(doc?.phe_duyet_sign_as)`) ngay cạnh label "Người phê duyệt" trong form soạn thảo.

`npx tsc --noEmit`, `npx eslint` (toàn bộ file đã sửa), và `npm run build` đều sạch (0 lỗi; các warning hiện có đều là warning cũ không liên quan tới thay đổi này).

**Chưa test tay** — cần, theo đúng thứ tự:
1. Chạy migration `20260713_iso_phe_duyet_sign_as.sql` trên Supabase SQL Editor trước.
2. Soạn thảo ISO: phê duyệt 1 tài liệu cha PDF, chọn "TM." trong toolbar modal đặt chữ ký → xác nhận khung tiền tố kéo-thả xuất hiện, kéo được, PDF sau ký có "TM." đúng vị trí; xác nhận nút ẩn/hiện chữ ký chỉ xuất hiện với hồ sơ con/file phụ (không xuất hiện với tài liệu cha); xác nhận nút ẩn/hiện tên bật/tắt được nhiều lần qua lại (không còn bug "ẩn xong không bật lại được").
3. Soạn thảo ISO: phê duyệt 1 bộ có cả tài liệu cha + hồ sơ con (nhiều file trong hàng đợi) với "KT." đã chọn — xác nhận CẢ hai file (cha lẫn con) đều có tiền tố "KT." trong PDF sau ký (không chỉ file đầu tiên).
4. Thực hiện hồ sơ ISO: phê duyệt 1 hồ sơ PDF chọn "TL." — xác nhận khung tiền tố hiện đúng, PDF sau ký có tiền tố, timeline hiển thị "TL. {tên}".
5. Thực hiện hồ sơ ISO: phê duyệt 1 hồ sơ Office (DOCX/XLSX) — xác nhận KHÔNG có picker "Ký thay" hiện ra (đúng thiết kế), workflow vẫn hoạt động bình thường.
6. Xác nhận badge tiền tố cạnh "Người phê duyệt" trong form Soạn thảo ISO hiển thị đúng sau khi phê duyệt xong và load lại trang.

---

## Kế hoạch ban đầu (lịch sử quyết định — đã triển khai theo bản tóm tắt ở trên)

**CHƯA LÀM** — đây là kế hoạch đã rà soát và chốt phạm vi với người dùng, để session sau triển khai. Không tự ý code phần này nếu chưa đọc kỹ mục "Việc cần làm ở ĐẦU session sau" bên dưới.

### Bối cảnh

Người dùng yêu cầu thống nhất toàn bộ logic ký PDF trong module ISO theo đúng pattern đã ổn định ở Văn bản nội bộ (`.claude/rules/22-documents-module.md`, mục "Tổng quát hóa 'KT.' thành 4 lựa chọn KT./TM./TL./TUQ." và "PDF nhiều trang trong SignPlacementModal"): mọi khung ký (chữ ký, tên, tiền tố chức danh) đều dùng eye-icon để ẩn/hiện, và hỗ trợ đặt chữ ký ở bất kỳ trang nào (đã xong — xem mục "Fix 2026-07-13" trong `.claude/rules/20-iso-forms-module.md`).

### Đã rà soát và xác nhận hiện trạng (2026-07-13)

- **Thực hiện hồ sơ ISO** (`iso/forms/[id]/page.tsx`, `SignPlacementModal`): đã có eye-icon (`Eye`/`EyeOff`) thật cho cả chữ ký lẫn tên, đã hỗ trợ đặt chữ ký nhiều trang (fix cùng ngày). **Chưa có** khái niệm tiền tố ký thay (KT./TM./TL./TUQ.) ở bất kỳ đâu.
- **Soạn thảo ISO** (`iso/documents/[id]/page.tsx`, modal đặt chữ ký inline): `placementModal` state **đã có sẵn** `showSignature`/`showSignerName` (không phải thiếu như nghi ngờ ban đầu), đã hỗ trợ nhiều trang. Nhưng nút ẩn/hiện hiện là **nút chữ** ("Ẩn chữ ký (X)"/"Hiện chữ ký", "Ẩn tên (X)"/"Hiện tên", dòng ~4286-4299), không phải icon mắt. Nút "Ẩn chữ ký" chỉ render khi `placementDocIsCon` (dòng 754-762: hồ sơ con hoặc file phụ soát xét `change_request`/`review_request`) — tài liệu cha chỉ thấy nút "Ẩn tên", không có nút ẩn chữ ký. **Chưa có** khái niệm tiền tố ký thay ở đâu cả (đã grep `KT\.|signAs|SignAsType|phe_duyet_is_kt|prefixText|prefixX` trong cả `documents/[id]/page.tsx` lẫn `src/app/api/sign/generate-pdf/route.ts` — 0 kết quả).
- `SignPlacement`/`ExtraSignPlacement` type trong `src/app/api/sign/generate-pdf/route.ts` (dòng 66-86) đã có `showSignature?`/`showSignerName?` (dùng đúng, check tại dòng ~1490/1502/1535/1545 và bản sao thứ 2 ~1668/1680) nhưng **chưa có** field `prefixX/Y/width/height` như `ExtraSignPlacement` của Văn bản (`src/app/api/documents/sign/route.ts` dòng 31-37).
- `iso_documents` và `iso_form_instances` **chưa có cột `sign_as`/`is_kt` nào** — khác với `van_ban_documents` đã có `phe_duyet_sign_as` (migration `20260706_van_ban_sign_as.sql`) — nghĩa là đây là tính năng hoàn toàn mới cho ISO, không cần lo tương thích ngược với dữ liệu `is_kt` cũ như Văn bản từng phải xử lý.

### Quyết định đã chốt với người dùng (2026-07-13)

1. **Phạm vi KT/TM/TL/TUQ**: áp dụng cho **cả 2 module ISO** (Soạn thảo ISO lẫn Thực hiện hồ sơ ISO), không chỉ Soạn thảo.
2. **Ẩn chữ ký ở tài liệu cha (Soạn thảo ISO)**: **GIỮ NGUYÊN** quy tắc cũ — tài liệu cha vẫn chỉ ẩn được "tên", không ẩn được "chữ ký" (chỉ hồ sơ con mới ẩn được cả 2). Việc "hợp nhất eye-icon" ở đây **chỉ là đổi trình bày** (nút chữ → icon mắt thật, mirror đúng UI pattern của `forms/[id]/page.tsx`), **không đổi điều kiện quyền** `placementDocIsCon` đang gate nút ẩn chữ ký.
3. **Eye-icon riêng cho khung tiền tố**: **KHÔNG thêm** — giữ nguyên cơ chế của Văn bản (chọn "Không chọn"/`signAs="none"` = ẩn khung tiền tố; chọn KT/TM/TL/TUQ = hiện khung kéo-thả). Không cần trạng thái `showPrefix` độc lập với `signAs`.
4. **Đồng bộ ngược Văn bản**: vì mục 3 chọn giữ cơ chế cũ (không có pattern mới nào phát sinh), **không có việc gì cần backport vào Văn bản** — Văn bản giữ nguyên làm reference implementation, không đụng vào.

### Việc cần làm

#### A. Hợp nhất UI eye-icon ở Soạn thảo ISO (thuần túy trình bày, không đổi logic quyền)

- `iso/documents/[id]/page.tsx` dòng ~4286-4299: đổi 2 nút chữ thành nút icon tròn nhỏ overlay góc trên-phải khung kéo-thả (mirror đúng style đã dùng trong `forms/[id]/page.tsx` `SignPlacementModal`, ví dụ khung chữ ký dòng ~415-420: `className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-white border border-slate-200 rounded-full shadow flex items-center justify-center hover:bg-slate-50"`, icon `{showSig ? <EyeOff size={10}/> : <Eye size={10}/>}`).
- Giữ nguyên điều kiện `{placementDocIsCon && (...)}` cho nút ẩn chữ ký, không có điều kiện cho nút ẩn tên — chỉ đổi phần render bên trong.
- `Eye`/`EyeOff` đã import sẵn trong file (dùng ở chỗ khác) — không cần thêm import.

#### B. Tiền tố ký thay KT./TM./TL./TUQ. — chỉ bật ở bước Phê duyệt (cần xác nhận lại — xem mục C)

Mirror kiến trúc Văn bản (`src/app/api/documents/sign/route.ts`, `.claude/rules/22-documents-module.md` mục "2. Tổng quát hóa 'KT.'"):

**B1. Soạn thảo ISO (`iso_documents`)**
- Migration mới: `ALTER TABLE iso_documents ADD COLUMN phe_duyet_sign_as TEXT` — không cần cột `is_kt` (không có dữ liệu cũ phải tương thích ngược).
- `SignPlacement` (`generate-pdf/route.ts` dòng ~80-86) thêm `prefixX?/prefixY?/prefixWidth?/prefixHeight?`.
- Cần đọc lại chính xác luồng gọi API của action `phe_duyet` trong `iso/documents/[id]/page.tsx` trước khi code (route đích, request shape hiện tại) — plan này suy đoán dựa trên cấu trúc `generate-pdf/route.ts` đã biết, chưa xác nhận trực tiếp cách `documents/[id]/page.tsx` gọi route này cho action `phe_duyet`.
- `placementModal` state thêm `signAs: SignAsType`, `prefixX/Y/W/H` — chỉ hiển thị radio picker + khung kéo-thả tiền tố khi placement hiện tại là bước Phê duyệt.
- Hàm vẽ chữ ký trong `generate-pdf/route.ts` thêm tham số `prefixText: string | null`, vẽ vào khung riêng tại `prefixX/Y/W/H` khi có tọa độ — mirror `stampPdfStep` của Văn bản (`documents/sign/route.ts` dòng ~317-386). **Không** ghép prefix vào `signerName` dùng cho tag DOCX/XLSX (giữ nguyên tắc "tiền tố chỉ áp dụng khi ký PDF" đã chốt cho Văn bản).
- UI hiển thị tên phê duyệt (trang chi tiết, timeline) thêm tiền tố theo `sign_as` — mirror `signAsPrefixLabel()` của Văn bản.

**B2. Thực hiện hồ sơ ISO (`iso_form_instances`)**
- Migration mới: `ALTER TABLE iso_form_instances ADD COLUMN phe_duyet_sign_as TEXT`.
- `SignPlacement`/`FullPlacement` (cả `forms/[id]/page.tsx` lẫn `finalize/route.ts`) thêm `prefixX?/prefixY?/prefixWidth?/prefixHeight?`.
- `SignPlacementModal` (`forms/[id]/page.tsx`) thêm state `signAs: SignAsType`, `prefixState: ElemState` — radio picker + khung kéo-thả viền emerald (mirror Văn bản) chỉ hiện khi `action === "phe_duyet"`.
- `handleConfirm`/`handleSignConfirm` gửi thêm `sign_as` trong body POST `/api/iso/forms/[id]/finalize` (hiện tại body chỉ có `token, action, placement, cap_tl`).
- `finalize/route.ts`, nhánh `action === "phe_duyet"` trong `stampPdf` (đã đọc kỹ ở phiên trước, dòng ~79-170): đọc `sign_as` từ body, tính `prefixText = signAs !== "none" ? \`${signAs}.\` : null`, vẽ vào khung riêng, lưu `phe_duyet_sign_as` vào DB cùng lúc set `trang_thai = "da_phe_duyet"`.
- UI hiển thị tên phê duyệt (card "Tiến trình & Lịch sử") thêm tiền tố tương tự.

#### C. Việc cần làm ở ĐẦU session sau (trước khi code bất cứ gì)

1. **Xác nhận lại phạm vi bước áp dụng tiền tố**: plan này giả định tiền tố KT/TM/TL/TUQ chỉ bật ở bước **Phê duyệt** cho cả 2 module (không bật ở Soạn thảo/Xem xét) — suy luận từ cách Văn bản chỉ bật `allowSignAs` cho step `phong_ban` + toàn bộ `phê duyệt`, loại trừ step `ca_nhân` (soạn thảo/xem xét ISO có bản chất gần với "cá nhân tự ký" hơn là "ký thay đại diện phòng ban"). **Đây là suy luận của tôi, chưa phải câu trả lời trực tiếp từ người dùng** — phải hỏi lại xác nhận trước khi code, đặc biệt nếu người dùng muốn tiền tố áp dụng luôn cho cả 3 bước.
2. Đọc lại chính xác `iso/documents/[id]/page.tsx` để xác định route/luồng gọi API thật của action `phe_duyet` trước khi sửa (mục B1 đang dựa trên suy đoán cấu trúc, chưa verify trực tiếp).
3. Sau khi code xong, chạy `npx tsc --noEmit` + `npx eslint` + `npm run build`, và ghi rõ "chưa test tay" — đúng quy ước của rule này.

---

## Fix 2026-07-24 — Soát xét ISO mất "Tài liệu cha"/"Người soạn thảo" sau khi load lại

Đã điều tra bằng cách đọc trực tiếp code `src/app/dashboard/iso/documents/[id]/page.tsx`
và xác nhận 3 bug độc lập, cả 3 đều là lỗi hiển thị (dữ liệu DB luôn đúng, chỉ UI đọc sai
sau mỗi lần load trang), không phải lỗi theo quyền/phiên đăng nhập của người xem:

1. **TH4 (Soát xét hồ sơ con) — "Tài liệu cha (bộ quy trình)" luôn rỗng**: state
   `reviewParentDocId` chưa từng được hydrate từ `d.parent_doc_id` trong `loadDoc()` (chỉ
   `selectedParentDocId` — dùng cho Soạn thảo — được nạp lại). Đã fix: thêm
   `setReviewParentDocId(d.parent_doc_id || "")` ngay sau dòng hydrate
   `selectedParentDocId` trong `loadDoc()`.
2. **TH3 (Soát xét tài liệu cha) — "{codeLabel}" luôn rỗng**: select dùng
   `value={reviewDocId || form.ma_tai_lieu_cu}` nhưng option lại là UUID
   (`<option value={item.id}>`) — `form.ma_tai_lieu_cu` là mã dạng text, không bao giờ
   khớp UUID nên select luôn rơi về placeholder. Đã fix: đổi fallback sang
   `parentReviewSourceDocId` (biến đã có sẵn trong file, tự resolve đúng UUID bằng cách
   match mã tài liệu) — đúng idiom đã dùng ở chỗ khác trong cùng file (`allowExistingCodeForDoc`).
3. **"Người soạn thảo" chỉ hiển thị đúng cho chính người soạn thảo, người khác thấy
   "— Chọn người —"**: option của select này (`profilesAll`) được nạp bằng query
   client-side trực tiếp `supabase.from("profiles")...`, bị RLS chặn (policy `"profiles
   read own or admin same factory"` — non-admin chỉ đọc được đúng dòng của chính mình).
   `profilesXemXet`/`profilesPheDuyet` (2 select còn lại) đã bypass RLS đúng cách qua
   route `/api/iso/profiles-by-permission` từ trước — chỉ `profilesAll` bị bỏ sót. Đã fix:
   - `route.ts` của `/api/iso/profiles-by-permission` nới điều kiện: `permCode` rỗng/thiếu
     → trả về toàn bộ active profiles của nhà máy (không lọc quyền), dùng service-role
     client như nhánh permCode cũ.
   - `loadProfiles()` đổi sang gọi `loadProfilesByPermission(fid, "")` để lấy
     `profilesAll`, chạy song song với 3 lời gọi permission-based hiện có.

Cả 3 fix áp dụng đồng nhất cho **cả tài liệu cha lẫn hồ sơ con, cả luồng Soạn thảo lẫn
Soát xét, không phân biệt Cấp 1/Cấp 2** — không có nhánh code nào giới hạn phạm vi theo
các chiều này. `npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch. **Chưa test
tay** — cần: soát xét cả tài liệu cha (TH3) lẫn hồ sơ con (TH4) ở cả Cấp 1/Cấp 2, xác nhận
field nguồn soát xét giữ nguyên giá trị sau khi Lưu và khi người phê duyệt khác mở lại;
xác nhận "Người soạn thảo" hiện đúng tên cho người xem xét/phê duyệt không phải admin.

## Cập nhật 2026-08-01 — Điều tra bug "trả về không thay được file" ở module Văn bản +
tài liệu ISO không có mã (tùy chọn)

Điều tra chéo phát sinh từ bug "Trả về không thay được file" ở module Văn bản nội bộ (xem
`.claude/rules/22-documents-module.md` mục "Cập nhật 2026-08-01") — đã xác nhận **module
này KHÔNG bị lỗi tương tự**: `iso/documents/[id]/page.tsx`'s `isEditable` (dòng ~798 tại
thời điểm điều tra: `isNew || ((draft || tra_ve) && isSoanThao) || (bi_tu_choi_phe_duyet &&
canXemXet)`) đã đúng, bao trùm cả sửa metadata lẫn thay file — nút "Thay file"/ô upload đã
gate theo đúng cờ này từ trước, không cần sửa gì. `iso/forms/[id]/page.tsx` tương tự
(`isEditable = draft || tra_ve`, cả "Thay file" lẫn dropzone upload đều gate đúng theo cờ
này). Ghi lại đây để tránh điều tra lặp lại nếu có báo cáo tương tự trong tương lai.

### Tài liệu ISO (tài liệu cha, soạn thảo mới) không có mã

Người dùng xác nhận: tài liệu/hồ sơ ISO không có mã (VD: "Danh sách được cấp giấy chứng
nhận đào tạo ISO 9001, 14001") **vẫn đi qua đúng luồng xem xét/phê duyệt hiện tại, chỉ bỏ
qua yêu cầu bắt buộc phải có mã**. Đã xác nhận `iso_documents.ma_tai_lieu` đã nullable sẵn
ở DB, và unique index `uniq_iso_documents_factory_ma_tai_lieu_active`
(`20260531_fix_iso_unique_constraint.sql`) đã **cố ý loại trừ mã rỗng** từ trước (thiết kế
sẵn cho đúng trường hợp này) — không cần migration.

**Phạm vi cố ý thu hẹp — chỉ TH1 (Tài liệu Cha, Soạn thảo mới)**: không đụng "Hồ sơ (Con)"
(mã con luôn phụ thuộc mã cha — không có khái niệm hồ sơ con đứng độc lập không mã, và
`handleFileUpload` cho hồ sơ con đã có sẵn guard `if (!form.ma_tai_lieu) { ... }` chặn đúng
tự nhiên nếu tài liệu cha chưa có mã) và không đụng "Soát xét" (bản chất soát xét là sửa
lại mã đã có sẵn, không áp dụng cho tài liệu chưa từng có mã).

- `iso-types.ts`'s `IsoDocumentForm` thêm `khong_co_ma: boolean` (không phải cột DB — chỉ
  là cờ UI, mặc định `false` trong `emptyIsoForm()`). Khi load lại 1 tài liệu cha đã có sẵn
  không mã để sửa, cờ này được suy ra tự động (`!isCon && !d.ma_tai_lieu`) để checkbox hiển
  thị đúng trạng thái.
- `iso/documents/[id]/page.tsx`: checkbox "Tài liệu này không có mã" đặt ngay trên field
  "Số hiệu" (chỉ hiện ở nhánh `!isReviewForm && !isCon`) — khi tick, `patchDraftForm({
  khong_co_ma: true, so_hieu: "" })` (ẩn hẳn input Số hiệu); khối "Mã tự sinh" đổi
  placeholder thành "Không áp dụng mã cho tài liệu này". **Không cần sửa
  `rebuildDraftCode()`/`buildMaTaiLieu()`** — hàm gốc đã tự trả về `""` khi `so_hieu` rỗng,
  nên `ma_tai_lieu` tự động rỗng qua đúng cơ chế có sẵn.
- `validateForm()`'s `draftErrors` (nhánh không phải `con`): bỏ qua `requireValue(so_hieu)`/
  `requireValue(ma_tai_lieu)` khi `form.khong_co_ma`. `validateUniqueDocumentCodes()` không
  cần sửa — đã có sẵn điều kiện `if (form.phan_loai_tl !== "con" && mainCode)`, tự bỏ qua
  khi `mainCode` rỗng.
- Reset `khong_co_ma: false` khi chuyển sang "Soát xét" hoặc "Hồ sơ (Con)" — cờ này chỉ có
  ý nghĩa ở đúng nhánh Soạn thảo mới + Tài liệu Cha.
- Giữ nguyên bắt buộc `loai_tai_lieu`/`phong_ban`/`ten_tai_lieu`/`lan_ban_hanh` — chỉ số
  hiệu + mã trở thành tùy chọn, đúng "chỉ bỏ qua mã".
- **Không đụng module "Thực hiện hồ sơ ISO"** (`iso/forms/`) — `iso_form_instances.
  template_doc_id` bắt buộc NOT NULL trỏ vào 1 `iso_documents` đã có, và tính năng này là
  "form lặp lại nhiều lần", không khớp ngữ cảnh "1 tài liệu tham chiếu tĩnh không mã".

`npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch. **Chưa test tay** — cần: tạo 1
tài liệu ISO cha, tick "Không có mã", để trống Số hiệu → lưu thành công → đi qua đúng luồng
Xem xét/Phê duyệt bình thường như tài liệu có mã; mở lại tài liệu đó để sửa → xác nhận
checkbox tự động tick đúng; xác nhận danh sách/chi tiết/kho ISO hiện đúng "(chưa có mã)"/
"—" thay vì lỗi (các nơi hiển thị `ma_tai_lieu` đã có sẵn fallback từ trước, không sửa gì
thêm).

## Nguồn ưu tiên khi có mâu thuẫn

Khi có mâu thuẫn giữa tài liệu lịch sử, ưu tiên theo thứ tự:

1. Code hiện tại trong các route và UI đang chạy
2. Các mục “đính chính / cập nhật mới nhất” trong rule
3. Nội dung lịch sử cũ

File này là bản đã gộp và làm sạch. Các quy tắc cũ mâu thuẫn xem như hết hiệu lực.
