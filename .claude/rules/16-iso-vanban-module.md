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

### Nguồn tài nguyên pdfjs trên production

- `generate-pdf/route.ts` phải ưu tiên dùng asset local của `pdfjs-dist` trong `node_modules` cho `cMap` và `standard_fonts`
- Không phụ thuộc CDN để đọc text PDF trên production
- Nếu local asset không sẵn mới fallback tối giản

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

## Nguồn ưu tiên khi có mâu thuẫn

Khi có mâu thuẫn giữa tài liệu lịch sử, ưu tiên theo thứ tự:

1. Code hiện tại trong các route và UI đang chạy
2. Các mục “đính chính / cập nhật mới nhất” trong rule
3. Nội dung lịch sử cũ

File này là bản đã gộp và làm sạch. Các quy tắc cũ mâu thuẫn xem như hết hiệu lực.
