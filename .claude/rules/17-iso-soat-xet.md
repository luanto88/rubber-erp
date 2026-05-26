---
description: Module ISO - quy trinh soat xet, tieu chuan ap dung, doi ma tai lieu, huy hieu luc tai lieu cu
---

# Module ISO - Soat xet tai lieu

## Muc tieu

Quy trinh soat xet dung khi mot tai lieu ISO da co hieu luc can duoc cap nhat, thay file moi, co the doi ma tai lieu, va phai tu dong danh dau tai lieu cu la het hieu luc sau khi tai lieu moi duoc phe duyet.

Moi tai lieu co the ap dung mot hoac nhieu tieu chuan de phuc vu loc va truy xuat sau nay.

---

## Tieu chuan ap dung

Bang danh muc: `iso_standards`

| id | tieu_chuan | ten_tieu_chuan |
|----|------------|----------------|
| 1 | ISO 9001:2015 | He thong quan ly chat luong |
| 2 | ISO 14001:2015 | He thong quan ly moi truong |
| 3 | PEFC ST 2002-1:2024 | Cac yeu cau doi voi viec trien khai He thong tham dinh chi tiet PEFC EUDR (PEFC EUDR DDS) |
| 4 | ISO/IEC 17025:2017 | Tieu chuan phong thi nghiem |
| 5 | ISO 14067:2018 | Truy van dau vet cacbon |

Bang noi nhieu-nhieu: `iso_document_standards`

```sql
doc_id UUID -> iso_documents.id
standard_id INTEGER -> iso_standards.id
factory_id UUID
PRIMARY KEY (doc_id, standard_id)
```

Quy tac:
- Mot tai lieu co the chon nhieu tieu chuan.
- UI phai luu bang noi, khong luu chuoi ghep trong `iso_documents`.
- Khi doc danh sach tai lieu, hydrate `standards[]` de hien thi va loc.
- Fallback frontend co the dung `ISO_STANDARD_FALLBACK`, nhung nguon chinh la DB.

---

## Danh muc loai tai lieu Cha/Con

Bang danh muc: `iso_document_types`

```sql
code TEXT PRIMARY KEY
name TEXT
can_parent BOOLEAN
can_child BOOLEAN
force_child BOOLEAN
allowed_departments TEXT[]
is_active BOOLEAN
sort_order INTEGER
```

Quy tac:
- `F` luon la Con: `force_child = true`.
- `PL`, `HD` co the la Cha hoac Con.
- `CS`, `OB`, `ST`, `QC`, `TC`, `QT`, `MT`, `QD`/`QĐ` la Cha.
- UI nen doc danh muc tu DB; neu DB chua co migration thi fallback ve constants trong `iso-types.ts`.

---

## Quyen soat xet

Permission chinh: `iso.soat_xet`

Tuong thich nguoc:
- Neu he thong cu dang dung `iso.xem_xet`, UI/API co the fallback sang `iso.xem_xet`.
- Khi seed migration, user nao co `iso.xem_xet` nen duoc cap them `iso.soat_xet`.

Guard bat buoc:
- Chi user duoc gan vao `xem_xet_user_id` va co `iso.soat_xet` moi duoc thao tac buoc soat xet.
- Admin van co full permission qua `hasPermission`.

---

## Form soat xet

Nguoi dung chi duoc chon tai lieu cu de soat xet khi:
- `trang_thai = 'co_hieu_luc'`
- cung `factory_id`

Bo loc theo tang:
1. Tieu chuan
2. Phong ban
3. Loai tai lieu
4. Ma tai lieu

Quy tac loc tieu chuan:
- Chon "Tat ca tai lieu": khong loc theo tieu chuan.
- Chon mot tieu chuan cu the: chi hien tai lieu co `iso_document_standards.standard_id` tuong ung.
- Vi du chon `ISO 9001:2015` thi lay tai lieu co danh sach tieu chuan chua `ISO 9001:2015`.
- Cac tieu chuan khac tuong tu: `ISO 14001:2015`, `PEFC ST 2002-1:2024`, `ISO/IEC 17025:2017`, `ISO 14067:2018`.

Truong bat buoc/bo sung:
- `chon_quy_trinh = 'Soát xét'`
- `doi_ma_tai_lieu BOOLEAN`
- Neu `doi_ma_tai_lieu = true`: bat buoc nhap `ma_tai_lieu_moi`.
- Neu `doi_ma_tai_lieu = false`: `ma_tai_lieu_moi = null`, giu ma tai lieu hien tai.
- Luu ma tai lieu cu vao `ma_tai_lieu_cu` de truy vet va invalidate dung tai lieu goc.

File:
- `file_goc_url`: file tai lieu moi duoc upload de ky va ban hanh.
- `file_phieu_yeu_cau_thay_doi_url`: phieu yeu cau thay doi.
- `file_de_nghi_soat_xet_url`: de nghi soat xet.
- `file_soat_xet_url` cu co the giu lam alias/backward compatible cho `file_de_nghi_soat_xet_url`.

Noi dung soat xet:
- `ly_do_soat_xet`: ly do can soat xet/thay doi.
- `noi_dung_soat_xet`: tom tat noi dung soat xet/thay doi.
- Hien tai UI upload va luu URL file dinh kem. Logic ky/dien tag cho file dinh kem la thiet ke tiep theo, xem muc "Ky nhieu file trong mot buoc soat xet".
- Khi trien khai ky file dinh kem PDF, route generate PDF phai co the dien 2 truong nay vao dung tag/nhan.
- Cac tag khuyen nghi trong file dinh kem:
  - `Ly do soat xet:` hoac `Lý do soát xét:`
  - `Noi dung soat xet:` hoac `Nội dung soát xét:`

---

## Logic hien thi form thong tin tai lieu

Nguyen tac chung:
- Chi thay doi hien thi, required validation va cach lay option theo tung truong hop.
- Khong lam thay doi helper sinh ma hien co: `buildMaTaiLieu`, `buildMaTaiLieuCon`, `parseMaTaiLieuCon`, `parseParentCode`.
- Khong lam thay doi workflow ky duyet hien co: Cap 1/Cap 2, PIN, placement, generate PDF, notify.
- Tat ca truong trong form thong tin tai lieu theo tung truong hop deu bat buoc nhap/chon, tru truong he thong tu sinh/read-only.
- `Tieu chuan` luon la dropdown multi select, luu vao `iso_document_standards`.
- Neu la "Soan thao", nguoi dung nhap/sinh ma moi.
- Neu la "Soat xet", nguoi dung chon tu danh sach tai lieu/ho so dang `co_hieu_luc`; cac truong phu thuoc duoc hydrate tu tai lieu cu.
- Cac field ten cu trong soat xet chi de xem doi chieu, khong sua; field ten moi moi la field user co the sua.

### TH1: Soan thao - Tai lieu (Cha)

Hien thi theo thu tu:
1. `Tieu chuan`: dropdown multi select.
2. `Ma tai lieu`: tu sinh, read-only.
3. `Phong ban`: dropdown.
4. `Loai tai lieu`: dropdown chi cac loai co the la Cha.
5. `So hieu`: input so, dung de sinh `ma_tai_lieu`.
6. `Lan ban hanh`: input so.
7. `Ten tai lieu`: nhap tay.
8. `Cap tai lieu`: dropdown `Cap 1` / `Cap 2`.
9. `Ghi chu`: textarea.
10. Phan chon nguoi xem xet / phe duyet.

Validation:
- Bat buoc: tieu chuan, phong ban, loai tai lieu, so hieu, lan ban hanh, ten tai lieu, cap tai lieu, nguoi ky theo cap.
- `Ma tai lieu` bat buoc co gia tri sau khi sinh, nhung user khong nhap tay.

### TH2: Soan thao - Ho so (Con)

Hien thi theo thu tu:
1. `Tieu chuan`: dropdown multi select.
2. `Ma tai lieu`: tu sinh theo ma cha + loai ho so + so hieu ho so, read-only.
3. `Phong ban`: dropdown.
4. `Loai tai lieu`: dropdown loai tai lieu Cha dung de sinh ma cha.
5. `So hieu tai lieu`: input so hieu cua tai lieu Cha.
6. `Loai ho so`: dropdown chi cac loai co the la Con (`PL`, `HD`, `F` theo danh muc DB).
7. `So hieu ho so`: input so, dung de sinh ma con.
8. `Lan ban hanh`: input so.
9. `Ten tai lieu`: nhap tay.
10. `Cap tai lieu`: dropdown `Cap 1` / `Cap 2`.
11. `Ghi chu`: textarea.
12. Phan chon nguoi xem xet / phe duyet.

Validation:
- Bat buoc: tieu chuan, phong ban, loai tai lieu cha, so hieu tai lieu, loai ho so, so hieu ho so, lan ban hanh, ten tai lieu, cap tai lieu, nguoi ky theo cap.
- `Ma tai lieu` bat buoc co gia tri sau khi sinh, nhung user khong nhap tay.

### TH3: Soat xet - Tai lieu (Cha)

Hien thi theo thu tu:
1. `Tieu chuan`: dropdown multi select, dung de loc tai lieu dang co hieu luc.
2. `Phong ban`: dropdown, loc tiep theo tieu chuan.
3. `Loai tai lieu`: dropdown chi hien cac loai tai lieu Cha dang ton tai voi `trang_thai = 'co_hieu_luc'` theo tieu chuan + phong ban da chon.
4. `Ma tai lieu`: dropdown, loc theo tieu chuan + phong ban + loai tai lieu, chi lay tai lieu Cha dang `co_hieu_luc`.
5. `Ten tai lieu`: hien ten tai lieu cu theo ma da chon, read-only.
6. `Lan sua doi`: input so, bat buoc.
7. `Thay doi ma tai lieu`: dropdown/radio `Co` / `Khong`.
8. `Ma tai lieu moi`: nhap tay, chi hien va bat buoc khi thay doi ma = `Co`.
9. `Ten tai lieu moi`: mac dinh/goi y tu ten cu, user co the sua tay.
10. `Ly do soat xet`: textarea.
11. `Noi dung soat xet`: textarea.
12. `Cap tai lieu`: dropdown `Cap 1` / `Cap 2`.
13. `Ghi chu`: textarea.
14. Phan chon nguoi xem xet / phe duyet.

Logic khi chon `Ma tai lieu`:
- Hydrate `ten_tai_lieu` cu vao field read-only `Ten tai lieu`.
- Set `Ten tai lieu moi` mac dinh bang ten cu.
- Luu `ma_tai_lieu_cu = ma_tai_lieu` cua tai lieu duoc chon.
- Luu/clone tieu chuan cua tai lieu cu vao multi select, user co the dieu chinh neu can.
- Chi cho chon tai lieu cu co `phan_loai_tl = 'cha'` hoac khong phai `F`.

Validation:
- Bat buoc tat ca truong hien thi.
- Neu `Thay doi ma tai lieu = Khong`: `Ma tai lieu moi` khong hien/khong required, sau phe duyet giu ma cu.
- Neu `Thay doi ma tai lieu = Co`: `Ma tai lieu moi` bat buoc. Kiem tra trung ma voi tai lieu dang co hieu luc la rule nen bo sung o buoc tiep theo neu nghiep vu yeu cau.

### TH4: Soat xet - Ho so (Con)

Hien thi theo thu tu:
1. `Tieu chuan`: dropdown multi select, dung de loc ho so dang co hieu luc.
2. `Phong ban`: dropdown, loc tiep theo tieu chuan.
3. `Loai ho so`: dropdown chi hien cac loai ho so Con dang ton tai voi `trang_thai = 'co_hieu_luc'` theo tieu chuan + phong ban da chon.
4. `Ma ho so`: dropdown, loc theo tieu chuan + phong ban + loai ho so, chi lay ho so Con dang `co_hieu_luc`.
5. `Ten ho so`: hien ten ho so cu theo ma da chon, read-only.
6. `Lan sua doi`: input so, bat buoc.
7. `Thay doi ma ho so`: dropdown/radio `Co` / `Khong`.
8. `Ma ho so moi`: nhap tay, chi hien va bat buoc khi thay doi ma = `Co`.
9. `Ten ho so moi`: mac dinh/goi y tu ten cu, user co the sua tay.
10. `Ly do soat xet`: textarea.
11. `Noi dung soat xet`: textarea.
12. `Cap ho so`: dropdown `Cap 1` / `Cap 2`.
13. `Ghi chu`: textarea.
14. Phan chon nguoi xem xet / phe duyet.

Logic khi chon `Ma ho so`:
- Hydrate `ten_tai_lieu` cu vao field read-only `Ten ho so`.
- Set `Ten ho so moi` mac dinh bang ten cu.
- Luu `ma_tai_lieu_cu = ma_tai_lieu` cua ho so duoc chon.
- Luu/clone tieu chuan cua ho so cu vao multi select, user co the dieu chinh neu can.
- Chi cho chon ho so cu co `phan_loai_tl = 'con'` hoac loai `F`.

Validation:
- Bat buoc tat ca truong hien thi.
- Neu `Thay doi ma ho so = Khong`: `Ma ho so moi` khong hien/khong required, sau phe duyet giu ma cu.
- Neu `Thay doi ma ho so = Co`: `Ma ho so moi` bat buoc. Kiem tra trung ma voi ho so dang co hieu luc la rule nen bo sung o buoc tiep theo neu nghiep vu yeu cau.

### Nguyen tac khong anh huong logic khac

- Khong doi `trang_thai` khi user chi thay doi filter/hien thi.
- Khong auto invalidate tai lieu cu khi user chua phe duyet.
- Khong auto doi `ma_tai_lieu` cua document hien tai khi moi chon tai lieu cu; chi cap nhat ma moi sau action `phe_duyet`.
- Khong thay doi `created_by`, `soan_thao_user_id`, `xem_xet_user_id`, `phe_duyet_user_id` ngoai thao tac luu form.
- Khong xoa file cu khi upload file moi; chi cap nhat URL tuong ung trong ban ghi.
- Cac dropdown loc soat xet chi doc tai lieu dang co hieu luc, khong sua du lieu nguon.

---

## Workflow phe duyet soat xet

Workflow ky duyet van dung luong ISO hien co:

Cap 1:
`draft -> cho_xem_xet -> cho_phe_duyet -> co_hieu_luc`

Cap 2:
`draft -> cho_phe_duyet -> co_hieu_luc`

Khi action `phe_duyet` thanh cong va `chon_quy_trinh = 'Soát xét'`:

1. Tai lieu moi:
   - `trang_thai = 'co_hieu_luc'`
   - `ky_phe_duyet_at = now()`
   - `ngay_hieu_luc = now()`
   - Neu doi ma: `ma_tai_lieu = ma_tai_lieu_moi`
   - Neu khong doi ma: giu `ma_tai_lieu`

2. Tim tai lieu cu can huy:
   - Dung `ma_tai_lieu_cu` neu co, fallback `ma_tai_lieu`.
   - Dieu kien:
     - cung `factory_id`
     - `ma_tai_lieu = ma_tai_lieu_cu`
     - `trang_thai = 'co_hieu_luc'`
     - `id <> docId`
   - Sap xep:
     - `ngay_hieu_luc DESC NULLS LAST`
     - `updated_at DESC`
   - Chi lay 1 ban ghi gan nhat.

3. Cap nhat tai lieu cu:
   - `trang_thai = 'het_hieu_luc'`
   - `ngay_het_hieu_luc = now()`

4. Restamp PDF tai lieu cu:
   - Goi `POST /api/sign/restamp-pdf`
   - Body: `{ docIds: invalidatedIds, factoryId }`
   - API bo qua an toan neu file khong phai PDF.
   - PDF phai hien "Hết hiệu lực" mau do o footer va co dau hieu o header.

Khong duoc huy hang loat tat ca tai lieu cung ma. Chi huy tai lieu co hieu luc gan nhat theo ngay hieu luc.

---

## Restamp PDF het hieu luc

API: `/api/sign/restamp-pdf`

Quy tac:
- Dung `file_signed_pdf_url` neu co, fallback `file_goc_url`.
- Neu source khong phai PDF: tra ok cho doc do va bo qua.
- Dung font Times New Roman neu co trong `public/fonts/TimesNewRoman.ttf`.
- Footer can co dang:

```text
{ma_tai_lieu} ({lan_ban_hanh}-{ngay_het_hieu_luc}) Hết hiệu lực
```

- Chu "Hết hiệu lực" phai mau do.
- Neu khong the nhan dien tag trong template, van stamp footer an toan de khong lam gay workflow.

---

## Cac file lien quan

- Migration: `supabase/migrations/20260526_iso_standards_review.sql`
- Types/constants: `src/app/dashboard/iso/_components/iso-types.ts`
- Danh sach tai lieu: `src/app/dashboard/iso/documents/page.tsx`
- Form/Workflow chi tiet: `src/app/dashboard/iso/documents/[id]/page.tsx`
- Restamp PDF: `src/app/api/sign/restamp-pdf/route.ts`
- Permission defaults: `src/lib/auth.ts`

---

## Kiem tra bat buoc khi sua tiep

Chay it nhat:

```bash
npx tsc --noEmit
npx eslint src/app/dashboard/iso/_components/iso-types.ts src/app/dashboard/iso/documents/page.tsx "src/app/dashboard/iso/documents/[id]/page.tsx" src/app/api/sign/restamp-pdf/route.ts src/lib/auth.ts
```

Neu chay `npm run lint` toan repo fail do file ngoai module ISO, can ghi ro do la loi ton tai truoc do va khong tu y sua ngoai pham vi.

---

## Tom tat session moi - cap nhat 2026-05-26

Da hoan thanh:
- Migration `20260526_iso_standards_review.sql` them `iso_standards`, `iso_document_standards`, `iso_document_types`, cac cot soat xet/doi ma/file dinh kem va permission `iso.soat_xet`.
- Danh muc tieu chuan gom dung `ISO 14067:2018` (khong phai 14068).
- Form ISO chi tiet da tach logic hien thi theo 4 truong hop TH1-TH4.
- `Tieu chuan` la dropdown multi-select va luu qua bang noi.
- Soan thao moi tu sinh ma tai lieu/ho so bang helper hien co.
- Soat xet chi loc tai lieu/ho so `co_hieu_luc` theo tang `Tieu chuan -> Phong ban -> Loai -> Ma`.
- Khi chon ma soat xet, form luu `ma_tai_lieu_cu`, hien ten cu read-only, goi y ten moi bang ten cu va cho sua.
- Required validation da bao gom tieu chuan, phong ban, loai, ma/so hieu, ten, lan ban hanh/sua doi, cap, ghi chu, nguoi ky theo cap, ly do/noi dung soat xet, ma moi khi doi ma.
- Sau phe duyet soat xet, logic chi invalidate 1 ban ghi cu `co_hieu_luc` gan nhat theo `ma_tai_lieu_cu`, khong huy hang loat tat ca tai lieu cung ma.
- `/api/sign/restamp-pdf` restamp "Het hieu luc" mau do, bo qua non-PDF an toan.
- `iso.soat_xet` la permission chinh; UI/API co fallback `iso.xem_xet` de tuong thich cu.

Can lam tiep neu tiep tuc module nay:
- Ap dung migration tren Supabase neu chua chay.
- Kiem tra UI thuc te tai `/dashboard/iso/documents/new-doc` voi 4 truong hop.
- Neu nghiep vu yeu cau, bo sung validate trung `ma_tai_lieu_moi`/`ma_ho_so_moi`.
- Trien khai ky nhieu file trong mot action soat xet bang bang `iso_document_file_signatures` va hang doi placement rieng tung file.

---

## Ky nhieu file trong mot buoc soat xet

Trang thai hien tai:
- Da co cot DB va UI upload/lưu URL cho 2 file dinh kem soat xet.
- Chua hoan tat hang doi ky nhieu file trong cung mot action.
- Chua hoan tat bang `iso_document_file_signatures`.
- Chua hoan tat generate PDF rieng cho `change_request` / `review_request`.

Truong hop soat xet co the can ky 2 hoac 3 file:
- File tai lieu moi (`file_goc_url`)
- Phieu yeu cau thay doi (`file_phieu_yeu_cau_thay_doi_url`)
- De nghi soat xet (`file_de_nghi_soat_xet_url`)

Khong nen chuyen trang thai sau khi moi chi ky xong 1 file neu buoc do yeu cau ky tat ca file. Cach xu ly dung:

1. Xac dinh danh sach file can ky cho buoc hien tai:
   - Luon co tai lieu moi neu la PDF.
   - Co them phieu/de nghi neu user da upload va file la PDF.
   - Non-PDF duoc ghi nhan la `skipped`, khong mo placement.

2. Mo placement modal theo hang doi:
   - User xac nhan vi tri ky file 1.
   - Sau do mo tiep file 2, file 3 neu co.
   - Chi khi tat ca file trong hang doi da co ket qua `ok/skipped`, moi goi transition trang thai.

3. Luu placement rieng theo file:
   - Khong dung chung `soan_thao_placement/xem_xet_placement/phe_duyet_placement` cho moi file.
   - Nen tao bang rieng:

```sql
iso_document_file_signatures (
  id UUID PRIMARY KEY,
  doc_id UUID REFERENCES iso_documents(id),
  factory_id UUID,
  file_kind TEXT, -- main | change_request | review_request
  step TEXT,      -- soan_thao | soat_xet | phe_duyet
  signer_user_id UUID,
  placement JSONB,
  signed_pdf_url TEXT,
  skipped BOOLEAN DEFAULT false,
  signed_at TIMESTAMPTZ
)
```

4. Dien metadata cho file dinh kem:
   - Route generate PDF can nhan them `fileKind`.
   - Neu `fileKind = change_request` hoac `review_request`, route dien them:
     - `ly_do_soat_xet`
     - `noi_dung_soat_xet`
   - Cac tag khong tim thay thi can tra warning, khong lam hong workflow.

5. UI hien thi tien do:
   - "Can ky 3 file"
   - "Da ky 1/3"
   - "Dang ky: De nghi soat xet"

Quy tac quan trong: mot action ky duyet la mot giao dich nghiep vu, nhung co the gom nhieu tac vu ky file. Trang thai tai lieu chi duoc cap nhat sau khi tat ca tac vu ky file bat buoc cua action da hoan thanh.

---

## Nguyên tắc ký và điền tag DOCX/XLSX

Trạng thái hiện tại:
- Đã thêm API `/api/sign/generate-office` để ký file DOCX/XLSX theo tag.
- DOCX dùng `jszip` để quét `word/document.xml`, header và footer; thay tag chữ, chèn QR/chữ ký PNG tại vị trí tag.
- XLSX dùng `exceljs` để quét toàn bộ worksheet và cell; thay tag chữ, chèn QR/chữ ký PNG vào cell chứa tag.
- Đã thêm migration `20260527_iso_office_signing.sql` để lưu URL file Office đã ký.
- Cần chạy migration này trên Supabase trước khi dùng thật.

Quy tắc nghiệp vụ:
- Không biến file DOCX/XLSX thành PDF để ký thay cho file gốc.
- File tài liệu/hồ sơ chính (`file_goc_url`) là template có hiệu lực và được dùng lại nhiều lần để tạo báo cáo/phiếu ghi chép sau này.
- Khi người dùng sử dụng mẫu, hệ thống phải tạo bản sao từ `file_goc_url`, điền tag/QR/chữ ký vào bản sao, không ghi đè template chính.
- File đề nghị soát xét và phiếu yêu cầu thay đổi chỉ dùng để xem, ký xác nhận và hợp thức hóa hồ sơ soát xét; không dùng làm mẫu lập báo cáo lặp lại.

Quy tắc tag DOCX/XLSX:
- Sử dụng tag dạng `{{TEN_TAG}}`.
- Tag phải nằm nguyên vẹn trong một paragraph/run hợp lệ của DOCX hoặc một cell của XLSX.
- Không tách tag bằng xuống dòng, không tách bởi format từng phần, không merge nhiều cell để tạo một tag.
- Engine phải quét toàn bộ file:
  - DOCX: quét body, table, header/footer nếu xử lý an toàn.
  - XLSX: quét tất cả worksheet và tất cả cell có giá trị string.
- Nếu một tag hợp lệ xuất hiện nhiều lần, phải thay thế tất cả vị trí trùng khớp chính xác.
- Chỉ thay thế tag trùng khớp chính xác. Không thay thế fuzzy/gần đúng.
- Nếu phát hiện tag gần giống hoặc viết sai, phải trả diagnostics/cảnh báo để người dùng sửa template.
- DOCX/XLSX không có nút "Bỏ qua, không điền tag này". Khác với PDF header/footer, Office template phải được sửa đúng tag trước khi ký/điền.
- Nếu thiếu tag bắt buộc của bước ký hiện tại, không được chuyển trạng thái workflow.
- Nếu thiếu tag không bắt buộc (ví dụ QR trong mẫu không cần QR), có thể cảnh báo theo cấu hình nhưng không tự ý chèn vào vị trí đoán.

Tag hiện đang hướng dẫn trong UI:
- Thông tin chính: `{{MA_TAI_LIEU}}`, `{{TEN_TAI_LIEU}}`, `{{PHONG_BAN}}`, `{{LOAI_TAI_LIEU}}`, `{{LAN_BAN_HANH}}`, `{{LAN_SUA_DOI}}`, `{{NGAY_HIEU_LUC}}`, `{{TINH_TRANG}}`, `{{QR}}`
- Soát xét: `{{MA_TAI_LIEU_CU}}`, `{{MA_TAI_LIEU_MOI}}`, `{{LY_DO_SOAT_XET}}`, `{{NOI_DUNG_SOAT_XET}}`
- Chữ ký: `{{CHU_KY_SOAN_THAO}}`, `{{TEN_SOAN_THAO}}`, `{{CHU_KY_XEM_XET}}`, `{{TEN_XEM_XET}}`, `{{CHU_KY_PHE_DUYET}}`, `{{TEN_PHE_DUYET}}`

Kết quả ký:
- File chính DOCX/XLSX đã ký lưu vào `file_signed_office_url`, loại file lưu vào `file_signed_office_type`.
- Phiếu yêu cầu thay đổi đã ký lưu vào `file_phieu_yeu_cau_thay_doi_signed_url`.
- Đề nghị soát xét đã ký lưu vào `file_de_nghi_soat_xet_signed_url`.
