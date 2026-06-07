---
description: Module ISO - soát xét tài liệu, tiêu chuẩn áp dụng, đổi mã tài liệu, hủy hiệu lực tài liệu cũ
---

# Module ISO - Soát xét tài liệu

## Mục tiêu

Quy trình soát xét dùng khi một tài liệu hoặc hồ sơ ISO đã có hiệu lực cần được cập nhật, thay file mới, có thể đổi mã, và phải tự động đánh dấu bản cũ là hết hiệu lực sau khi bản mới được phê duyệt.

Tài liệu có thể áp dụng một hoặc nhiều tiêu chuẩn để phục vụ lọc và truy xuất.

---

## Tiêu chuẩn áp dụng

Bảng danh mục: `iso_standards`

Các tiêu chuẩn đang dùng:

- `ISO 9001:2015`
- `ISO 14001:2015`
- `PEFC ST 2002-1:2024`
- `ISO/IEC 17025:2017`
- `ISO 14067:2018`

Bảng nối: `iso_document_standards`

Quy tắc:

- Một tài liệu có thể chọn nhiều tiêu chuẩn
- UI lưu qua bảng nối, không ghép chuỗi trong `iso_documents`
- Frontend có thể có fallback constants, nhưng nguồn chính là DB

---

## Danh mục loại tài liệu cha/con

Bảng danh mục: `iso_document_types`

Quy tắc:

- `F` luôn là con
- `PL`, `HD` có thể là cha hoặc con
- `CS`, `OB`, `ST`, `QC`, `TC`, `QT`, `MT`, `QĐ` là cha

---

## Quyền soát xét

Permission chính: `iso.soat_xet`

Tương thích ngược:

- Có thể fallback `iso.xem_xet` cho dữ liệu/quyền cũ
- Seed mới phải cấp `iso.soat_xet`

Guard bắt buộc:

- Chỉ user được gán đúng vai trò và có quyền mới được thao tác bước soát xét
- Admin vẫn đi qua `hasPermission` như các màn khác

---

## Form soát xét

### Điều kiện chọn tài liệu nguồn

Chỉ cho chọn tài liệu/hồ sơ cũ khi:

- `trang_thai = 'co_hieu_luc'`
- cùng `factory_id`

### Bộ lọc theo tầng

1. Tiêu chuẩn
2. Phòng ban
3. Loại tài liệu / loại hồ sơ
4. Mã tài liệu / mã hồ sơ

### Dữ liệu bắt buộc

- `chon_quy_trinh = 'Soát xét'`
- `ly_do_soat_xet`
- `noi_dung_soat_xet`
- Nếu đổi mã: `ma_tai_lieu_moi`
- `ma_tai_lieu_cu` phải lưu đúng mã nguồn để truy vết và hủy hiệu lực bản cũ

### Quy tắc mã

- Nếu không đổi mã thì giữ nguyên mã nguồn
- Nếu đổi mã thì lưu đúng format user nhập sau `trim().toUpperCase()`
- Không được canonical hóa để làm mất dấu gạch hợp lệ

### Validate trùng mã

- Soạn thảo mới vẫn chặn trùng mã với mọi bản active khác trong cùng `factory_id`
- Soát xét được phép trùng mã nếu đó là đúng tài liệu/hồ sơ nguồn đang được soát xét
- Không mở rộng ngoại lệ này cho các bản active khác

---

## 4 trường hợp giao diện

### TH1: Soạn thảo - Tài liệu cha

Bắt buộc:

- Tiêu chuẩn
- Phòng ban
- Loại tài liệu cha
- Số hiệu
- Lần ban hành
- Tên tài liệu
- Cấp tài liệu
- Người ký đúng theo cấp

`Mã tài liệu` do hệ thống tự sinh, user không nhập tay.

### TH2: Soạn thảo - Hồ sơ con

Bắt buộc:

- Tiêu chuẩn
- Phòng ban
- Loại tài liệu cha
- Số hiệu tài liệu cha
- Loại hồ sơ
- Số hiệu hồ sơ
- Lần ban hành
- Tên hồ sơ
- Cấp hồ sơ
- Người ký đúng theo cấp

`Mã hồ sơ` do hệ thống tự sinh từ mã cha.

### TH3: Soát xét - Tài liệu cha

Bắt buộc:

- Tiêu chuẩn
- Phòng ban
- Loại tài liệu cha
- Mã tài liệu
- Tên tài liệu cũ read-only
- Lần sửa đổi
- Có/không đổi mã
- Mã tài liệu mới nếu đổi mã
- Tên tài liệu mới
- Lý do soát xét
- Nội dung soát xét
- Cấp tài liệu
- Người ký đúng theo cấp

### TH4: Soát xét - Hồ sơ con

Bắt buộc:

- Tiêu chuẩn
- Phòng ban
- Loại hồ sơ
- Mã hồ sơ
- Tên hồ sơ cũ read-only
- Lần sửa đổi
- Có/không đổi mã
- Mã hồ sơ mới nếu đổi mã
- Tên hồ sơ mới
- Lý do soát xét
- Nội dung soát xét
- Cấp hồ sơ
- Người ký đúng theo cấp

`reviewParentOptions` phải lọc theo đúng `form.phong_ban`.

---

## Workflow phê duyệt soát xét

### Sau action `phe_duyet`

1. Bản mới chuyển `co_hieu_luc`
2. Nếu đổi mã thì bản mới dùng `ma_tai_lieu_moi`
3. Tìm bản cũ liên quan theo `ma_tai_lieu_cu` và `factory_id`
4. Chuyển bản cũ `het_hieu_luc`
5. Nếu bản cũ là PDF thì gọi `POST /api/sign/restamp-pdf`

Quy tắc chặt:

- Không được để hơn 1 bản `co_hieu_luc` cùng mã sau khi hoàn tất
- Nếu đợt soát xét có cả tài liệu cha và hồ sơ con thì phải xử lý hết các mã liên quan trong cùng đợt

---

## Restamp PDF hết hiệu lực

API: `/api/sign/restamp-pdf`

Quy tắc:

- Ưu tiên `file_signed_pdf_url`, fallback `file_goc_url`
- Non-PDF thì bỏ qua an toàn
- Footer phải có dạng:

```text
{ma_tai_lieu} ({lan_ban_hanh}-{ngay_het_hieu_luc}) Hết hiệu lực
```

- `Hết hiệu lực` phải màu đỏ
- Nếu không nhận diện được template vẫn phải stamp an toàn để không làm gãy workflow

---

## Quy tắc ký và điền tag DOCX/XLSX

### Nguyên tắc chung

- Không biến DOCX/XLSX thành PDF để ký thay file gốc trong luồng Office bình thường
- Ký tiếp trên artifact mới nhất của bước trước
- Không quay lại template gốc nếu đã có artifact bước trước
- Tên người ký hệ thống chèn vào DOCX/XLSX phải dùng `Times New Roman`, size `12`

### Quét template

- DOCX: quét body, table, header, footer, drawing/textbox nếu text nằm trong XML Word
- XLSX: quét tất cả worksheet và cell string
- Tag đúng có trong file thì thay tất cả vị trí trùng khớp
- Tag đúng không có trong file thì bỏ qua
- Tag sai hoặc gần giống dạng `{{...}}` thì chặn và yêu cầu sửa template
- Office không có nút “bỏ qua tag sai”

### Tag chuẩn đang dùng

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

### Suy ra bước ký

Phải ưu tiên map theo `action`:

- `gui_xem_xet` -> `soan_thao`
- `gui_phe_duyet`, `gui_lai_phe_duyet` -> `xem_xet`
- `phe_duyet` -> `phe_duyet`

Chỉ fallback sang map theo `userId` khi không có `action`.

---

## Hồ sơ con

### PDF hồ sơ con

- Phải có footer trạng thái trên tất cả các trang
- Footer phản ánh trạng thái theo action hiện tại, không giữ trạng thái cũ
- Nếu PDF đã có footer cũ, được phép phủ footer cũ và ghi footer mới để đảm bảo đúng trạng thái

### DOCX/XLSX hồ sơ con

- Dùng bộ tag chuẩn ISO cộng `{{QR}}`
- Có tag đúng thì điền
- Không có tag đúng thì bỏ qua
- Nếu người dùng đã điền sẵn bằng chữ thường thay vì tag thì không ghi đè
- QR DOCX/XLSX hồ sơ con dùng khoảng `12mm x 12mm`
- Bước 2/3 không được tự chèn QR mặc định nếu artifact mới nhất không còn `{{QR}}`

---

## File phụ soát xét

### Quy tắc tổng quát

- File phụ gồm:
  - `Phiếu yêu cầu thay đổi`
  - `Đề nghị soát xét`
- File phụ không được xem như hồ sơ con để xử lý footer
- Không được chạm footer của file phụ ở cả:
  - `PDF`
  - `DOCX`
  - `XLSX`

### File phụ PDF

- Được phép điền nội dung ở phần thân nếu đọc được text template
- `Phiếu yêu cầu thay đổi`:
  - Nếu phát hiện `Lý do soát xét:` hoặc `Lý do thay đổi:` và phía sau dấu `:` chưa có giá trị thực thì chèn nội dung vào sau dấu `:`
  - Nếu đã có giá trị thì bỏ qua
- `Đề nghị soát xét`:
  - Nếu phát hiện `Nội dung soát xét:` hoặc `Nội dung thay đổi:` và phía sau dấu `:` chưa có giá trị thực thì chèn nội dung vào sau dấu `:`
  - Nếu đã có giá trị thì bỏ qua
- Nếu không đọc được text template thì không được vẽ footer fallback toàn trang

### File phụ DOCX/XLSX

- Không fallback chèn nội dung sau dấu `:`
- Chỉ thay theo tag hợp lệ có sẵn trong template
- Không giới hạn ở `{{LY_DO_SOAT_XET}}` và `{{NOI_DUNG_SOAT_XET}}`
- Các tag hợp lệ khác như `{{QR}}`, `{{MA_TAI_LIEU}}`, `{{LAN_BAN_HANH}}`, `{{NGAY_HIEU_LUC}}`, `{{TINH_TRANG}}`, tag tên người ký, tag chữ ký... nếu có trong template thì vẫn phải thay
- Tag đúng không có trong file thì bỏ qua
- Nếu người dùng đã điền sẵn bằng chữ thường thay vì tag thì không ghi đè

### Placement và QR của file phụ

- Chỉ bước `soan_thao` mới được hiện/đặt QR draggable cho file phụ
- Bước `xem_xet` và `phe_duyet` không được hiện lại QR draggable
- Tính năng nhân bản chữ ký cho file phụ phải nhân bản cả ô tên người ký

---

## Footer và phạm vi áp dụng

### Footer được phép xử lý ở đâu

- File `main`:
  - Được xử lý footer theo nghiệp vụ hiện hành
- File phụ `change_request` / `review_request`:
  - Không được xử lý footer

### Ngày hiệu lực trong footer và header PDF

- `effectiveDate` chỉ lấy ngày hiện tại khi `action === "phe_duyet"`.
- Với mọi action trung gian (`gui_xem_xet`, `gui_phe_duyet`): `dateStr = ""`.
- Khi `dateStr = ""`: header "Ngày hiệu lực" bị skip (check `!header.value`).
- Khi `dateStr = ""`: footer dùng chuỗi `"Ngày hiệu lực"` làm placeholder — tránh footer dị dạng `PHK-QT10 (01-)`.
- Footer trung gian có dạng: `PHK-QT10 (01-Ngày hiệu lực) Chờ xem xét`.
- `FOOTER_PENDING_DATE_RE` detect footer placeholder để bước ký tiếp theo (kể cả `phe_duyet`) nhận ra và cập nhật đúng.
- Tại `phe_duyet`: footer trở thành `PHK-QT10 (01-dd/mm/yyyy) Có hiệu lực`.
- Nếu `doc.ngay_hieu_luc` đã set (tài liệu phê duyệt trước): ưu tiên ngày đó cho mọi action.

### Khi đọc text PDF trên production

- `generate-pdf/route.ts` phải ưu tiên asset local của `pdfjs-dist` trong `node_modules` cho `cMap` và `standard_fonts`
- Không phụ thuộc CDN để đọc text PDF production
- Nếu `fillMetadataPlaceholders()` trả lỗi thì không được gọi `drawFooterOnAllPages()`

---

## Auto-fill từ tên file upload (form soát xét)

Khi user upload file trong form soát xét (`target === "main"`):

- Hàm `parseDocNameFromFileName(filename)` parse tên file theo pattern `{PB}-{LOAI}{SO} {TEN}`.
- `phong_ban`, `loai_tai_lieu`, `so_hieu`: chỉ fill khi trường đang trống (không override).
- `ten_tai_lieu` (trường "Tên tài liệu mới"): **luôn override** từ tên file nếu parse được, vì trường này đã bị pre-fill bằng tên tài liệu cũ từ tài liệu nguồn.
- Hàm `rebuildDraftCode` được gọi ngay sau khi điền (no-op với Soát xét nhưng vẫn phải gọi).

Quy tắc này áp dụng khác với Soạn thảo (điền khi trống). Không được dùng logic Soạn thảo cho Soát xét.

---

## File liên quan

- `src/app/dashboard/iso/documents/[id]/page.tsx`
- `src/app/api/sign/generate-pdf/route.ts`
- `src/app/api/sign/generate-office/route.ts`
- `src/app/api/sign/restamp-pdf/route.ts`
- `src/app/dashboard/iso/_components/iso-types.ts`
- `src/lib/auth.ts`

---

## Nguồn ưu tiên khi có mâu thuẫn

1. Code hiện tại trong route/UI
2. File rule này
3. Ghi chú lịch sử cũ

File này là bản rút gọn, UTF-8 sạch, đã bỏ các đoạn mâu thuẫn cũ.
