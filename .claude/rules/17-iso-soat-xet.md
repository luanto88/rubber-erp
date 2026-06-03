---
description: Module ISO - quy trinh soat xet, tieu chuan ap dung, doi ma tai lieu, huy hieu luc tai lieu cu
---

# Module ISO - Soat xet tai lieu

## Muc tieu

Quy trinh soat xet dung khi mot tai lieu ISO da co hieu luc can duoc cap nhat, thay file moi, co the doi ma tai lieu, va phai tu dong danh dau tai lieu cu la het hieu luc sau khi tai lieu moi duoc phe duyet.

Moi tai lieu co the ap dung mot hoac nhieu tieu chuan de phuc vu loc va truy xuat sau nay.

## Cap nhat moi nhat (2026-06-03)


### Bo sung Office ky nhieu buoc (2026-06-03)

- Ho so Office (`.docx`, `.xlsx`) ky nhieu buoc phai giu lai artifact cua buoc truoc; B2/B3 khong duoc ghi de QR hoac chu ky cua buoc truoc.
- B2/B3 khong duoc tu chen them QR mac dinh neu artifact da khong con `{{QR}}`; QR mac dinh cho ho so Office chi duoc chen o buoc `soan_thao`.
- Tag ten cua cac buoc sau khong duoc bi xoa chi vi gia tri buoc hien tai dang rong.
- Neu snapshot ten `xem_xet` / `phe_duyet` trong document dang rong thi route phai fallback lay ten tu `profiles` qua `xem_xet_user_id` / `phe_duyet_user_id`.
- Ten nguoi ky do he thong chen vao Office phai dung `Times New Roman`, size `12` cho ca DOCX va XLSX.

- Validate trung ma:
  - `Soan thao moi` van chan trung ma voi moi ban ghi khac trong cung `factory_id`.
  - `Soat xet` duoc phep luu ma trung neu ma do trung voi dung tai lieu/ho so nguon dang duoc soat xet.
  - Ngoai le tren khong mo rong cho bat ky tai lieu active khac nao.
- File phu soat xet (`file_phieu_yeu_cau_thay_doi_*`, `file_de_nghi_soat_xet_*`):
  - Chi buoc `soan_thao` moi hien/cho dat QR.
  - Buoc `xem_xet` va `phe_duyet` khong hien lai QR draggable tren placement modal.
- Tinh nang `Nhan ban chu ky` cua file phu phai nhan ban ca o ten nguoi ky:
  - User phai thay duoc o ten ngay trong modal.
  - O ten ban sao phai co drag/resize rieng va luu dung vi tri da dat.

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

2. Tim cac tai lieu/ho so cu can huy:
   - Thu thap toan bo ma lien quan cua dot soat xet:
     - `ma_tai_lieu_cu` cua tai lieu/ho so dang duoc phe duyet
     - `ma_tai_lieu_moi` neu co doi ma
     - fallback `ma_tai_lieu` hien tai neu can
   - Dieu kien:
     - cung `factory_id`
     - `trang_thai = 'co_hieu_luc'`
     - `ma_tai_lieu IN (...)` voi tap ma thu thap duoc
     - loai tru cac ban ghi dang duoc nang len `co_hieu_luc` trong dot hien tai
   - Muc tieu la ha het cac ban active trung ma lien quan truoc khi nang ban moi.

3. Cap nhat tai lieu cu:
   - `trang_thai = 'het_hieu_luc'`
   - `ngay_het_hieu_luc = now()`

4. Restamp PDF tai lieu cu:
   - Goi `POST /api/sign/restamp-pdf`
   - Body: `{ docIds: invalidatedIds, factoryId }`
   - API bo qua an toan neu file khong phai PDF.
   - PDF phai hien "Hết hiệu lực" mau do o footer va co dau hieu o header.

Khong duoc de ton tai hon 1 ban `co_hieu_luc` cung ma sau khi phe duyet soat xet. Neu dot soat xet gom ca tai lieu cha va ho so con, quy tac ha hieu luc phai ap dung cho tat ca ma trung lien quan trong cung dot.

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
---

## Cập nhật 2026-05-28 - hồ sơ con, QR và footer

### Hồ sơ con của tài liệu cha
- Một tài liệu cha có thể có nhiều hồ sơ con/phụ lục/biểu mẫu như `NMCB-QT01-F01`, `NMCB-QT01-F02`, `NMCB-QT01-F03`.
- Khi người dùng đang soạn thảo tài liệu cha `NMCB-QT01` và chọn hồ sơ con là `F`/Biểu mẫu, mã hiển thị mặc định phải là `NMCB-QT01-F` trước khi nhập số hiệu con.
- Sau khi nhập số hiệu con, mã đầy đủ được sinh bằng helper `buildMaTaiLieuCon`, ví dụ số `01` thành `NMCB-QT01-F01`.
- Không cho người dùng nhập tay mã hồ sơ con nếu có đủ dữ liệu để hệ thống tự sinh.

### File hồ sơ con
- Mỗi hồ sơ con là một bản ghi riêng để có mã, QR, footer, trạng thái và lịch sử ký riêng.
- Nếu một quy trình có nhiều biểu mẫu con, hướng xử lý nghiệp vụ đúng là tạo nhiều hồ sơ con riêng dưới cùng tài liệu cha.
- Khi đang soạn thảo tài liệu cha, có khối `Hồ sơ con của tài liệu này` để chọn loại hồ sơ con và upload nhiều file cùng lúc.
- Khối hồ sơ con dùng nút `Thêm hồ sơ`; mỗi dòng có `Mã hồ sơ`, `Tên hồ sơ`, `Loại hồ sơ`, `Số hiệu`, `Lần ban hành`, `Ghi chú`, `File hồ sơ`.
- Không upload nhiều file vào một input chung. Mỗi dòng upload đúng một file riêng.
- Khi lưu tài liệu cha, mỗi dòng hồ sơ con tạo một bản ghi con tương ứng và gắn `parent_doc_id` về tài liệu cha.
- Mỗi file con có thể là PDF, DOCX hoặc XLSX:
  - PDF: hỗ trợ tự chèn QR mặc định góc trên bên phải, kích thước 12mm x 12mm nếu không có tag QR/vị trí QR thủ công.
  - DOCX/XLSX: ưu tiên chèn QR theo tag `{{QR}}`; nếu thiếu tag thì tự đặt QR mặc định góc trên bên phải nội dung trang/sheet đầu, kích thước 12mm x 12mm.

### Footer hồ sơ con
- Footer của hồ sơ con dùng cùng cấu trúc với tài liệu cha:

```text
Mã tài liệu (Lần ban hành-Ngày hiệu lực) Tình trạng
```

- Với hồ sơ con, `Mã tài liệu` là mã hồ sơ con đã sinh, ví dụ:

```text
NMCB-QT01-F01 (01-03/04/2026) Chờ phê duyệt
```

- Nếu người dùng đã điền sẵn một phần footer, ví dụ:

```text
Mã tài liệu (Lần ban hành-03/04/2026) Tình trạng
```

  thì hệ thống phải giữ ngày hiệu lực `03/04/2026`, không thay bằng ngày hiện tại, và chỉ điền các phần còn thiếu.
- Tình trạng trong footer phải được cập nhật theo bước workflow sau mỗi lần ký/phê duyệt.

### Nguyên tắc không ghi đè tag đã điền
- Áp dụng cho tất cả tag header/footer PDF: nếu tag đã có giá trị thật thì bỏ qua.
- Không được nối thêm giá trị mới sau giá trị người dùng đã nhập.
- Ví dụ sai cần tránh: `Ngày hiệu lực: 03/04/2026 28/05/2026`.
- Cảnh báo tag không khớp chỉ dùng cho nhãn thật sự sai cấu trúc, không cảnh báo footer mẫu đã có sẵn ngày hiệu lực hợp lệ.

## Cập nhật mới nhất (2026-05-28) - thay thế logic Office/PDF cũ

Mục này thay thế các quy tắc cũ trong file này nếu có mâu thuẫn, đặc biệt các dòng cũ nói tag DOCX phải nằm nguyên trong một run hoặc thiếu tag đúng thì phải chặn workflow.

### Nguyên tắc chung cho hồ sơ con trong bộ tài liệu
- Hồ sơ con là bản ghi riêng của bảng `iso_documents`, liên kết với tài liệu cha bằng `parent_doc_id`.
- Khi tài liệu cha được gửi xem xét/phê duyệt, các hồ sơ con đi kèm phải được xử lý cùng bộ, nhưng không làm tăng số đầu việc riêng lẻ trên `Việc của tôi`.
- Người xem xét/phê duyệt phải thấy rõ mình đang xử lý `Bộ tài liệu + N hồ sơ`.
- Danh sách hồ sơ con nằm trong panel phải của trang chi tiết, dưới khu vực `File tài liệu`/`PDF có chữ ký`.
- Mỗi hồ sơ con có nút xem, tải và thay file. Nút xem luôn mở bản xử lý mới nhất, ưu tiên `file_signed_pdf_url`, rồi `file_signed_office_url`, rồi mới tới `file_goc_url`.

### Trạng thái hiển thị trong file theo từng bước
- Gửi xem xét: `Chờ xem xét`.
- Gửi phê duyệt hoặc gửi phê duyệt lại: `Chờ phê duyệt`.
- Phê duyệt: `Có hiệu lực`.
- Trả về hoặc không xem xét: `Trả về`.
- Từ chối phê duyệt: `Phê duyệt từ chối`.
- Các route generate file phải nhận `action` để tính trạng thái mục tiêu. Không được chỉ dùng `doc.trang_thai` hiện tại vì DB có thể chưa chuyển trạng thái tại thời điểm generate.

### PDF hồ sơ con
- PDF hồ sơ con phải mở lần lượt trong modal để người dùng đặt vị trí QR/chữ ký nếu cần.
- Footer chuẩn phải được ghi trên tất cả các trang:

```text
MÃ_HỒ_SƠ (LẦN_BAN_HÀNH-NGÀY_HIỆU_LỰC) TÌNH_TRẠNG
```

- Ví dụ:

```text
NMCB-QT01-F01 (03-28/05/2026) Chờ xem xét
```

- Nếu PDF đã có footer cũ, hệ thống được phép phủ vùng footer cũ và ghi footer mới để bảo đảm trạng thái theo bước luôn chính xác.

### DOCX/XLSX hồ sơ con
- Bộ tag hợp lệ của hồ sơ con:
  - `{{QR}}`
  - `{{MA_TAI_LIEU}}`
  - `{{LAN_BAN_HANH}}`
  - `{{NGAY_HIEU_LUC}}`
  - `{{TINH_TRANG}}`
- Có tag đúng thì điền. Không có tag đúng thì bỏ qua.
- Nếu người dùng đã tự điền bằng chữ thường thay vì tag, hệ thống không ghi đè.
- Nếu phát hiện tag trong dạng `{{...}}` nhưng gần giống hoặc sai tên, phải chặn và báo lỗi để người dùng thay file/sửa template.
- Không được báo thiếu tag đúng như lỗi fatal đối với hồ sơ con Office. Chỉ tag sai/gần giống mới chặn.
- DOCX phải lấy text hiển thị từ `w:t`/`a:t` để kiểm tra tag, không regex trực tiếp trên XML thô.
- DOCX phải quét toàn bộ `word/**/*.xml`, gồm body, table, header, footer và text trong drawing/textbox nếu nằm trong XML.
- Tag `{{QR}}` có thể nằm độc lập hoặc chung dòng/chung run với tiêu đề. Nếu nằm chung run, phải tách run để chèn ảnh QR vào đúng vị trí tag.
- QR DOCX của hồ sơ con dùng kích thước khoảng `12mm x 12mm`.
- Nếu không có `{{QR}}`, có thể chèn QR mặc định góc phải trên cho hồ sơ con.

### Artifact sau mỗi bước
- Sau mỗi bước ký/generate, phải lưu URL bản đã xử lý:
  - PDF: `file_signed_pdf_url`.
  - DOCX/XLSX: `file_signed_office_url`, kèm `file_signed_office_type`.
- Frontend phải cập nhật state `childDocs` ngay sau khi generate thành công để nút con mắt mở bản mới, không chờ reload và không mở nhầm file upload gốc.

---

## Cập nhật mới nhất (2026-05-28, phiên chốt) - soạn thảo hồ sơ con

Mục này thay thế mọi quy tắc cũ trong file này nếu có mâu thuẫn với logic hồ sơ con.

- Hồ sơ con luôn là bản ghi riêng trong `iso_documents`, liên kết cha bằng `parent_doc_id`.
- Hồ sơ con tạo cùng lúc với tài liệu cha mới là một phần của bộ tài liệu cha khi xem xét/phê duyệt. Badge sidebar và `Việc của tôi` gom bộ này thành một đầu việc.
- Hồ sơ con soạn thảo mới cho một quy trình/tài liệu cha đã có hiệu lực là đầu việc độc lập cho tới khi hồ sơ đó được phê duyệt. Sau khi lưu hồ sơ mới phải điều hướng tới trang chi tiết hồ sơ, không điều hướng về trang cha.
- Trang tài liệu cha đang có hiệu lực chỉ hiển thị hồ sơ con đã có hiệu lực. Hồ sơ con nháp/chờ xem xét/chờ phê duyệt không được tự nhảy vào panel file của tài liệu cha.
- Trong `Việc của tôi`, hồ sơ con độc lập phải ghi rõ `Cần xem xét N hồ sơ của quy trình {MA_CHA}` hoặc `Cần phê duyệt N hồ sơ của quy trình {MA_CHA}`, không ghi nhầm là `Bộ tài liệu + N hồ sơ`.
- Mã tài liệu/hồ sơ (`ma_tai_lieu`) phải duy nhất trong cùng `factory_id` cho cả tài liệu cha và hồ sơ con. Form phải chặn trùng mã trong các dòng nháp và chặn trùng với dữ liệu đã có trong `iso_documents`.
- Với hồ sơ DOCX/XLSX, engine dùng toàn bộ bộ tag chữ chuẩn của ISO cộng `{{QR}}`; tag đúng có thì điền, tag đúng thiếu thì bỏ qua, tag sai/gần giống dạng `{{...}}` thì chặn và yêu cầu thay file.
- Với hồ sơ cấp 2 gửi thẳng phê duyệt, artifact DOCX/XLSX phải ghi trạng thái `Chờ phê duyệt`, không ghi `Chờ xem xét`.
- Nút xem file ưu tiên `file_signed_pdf_url`, rồi `file_signed_office_url`, rồi `file_goc_url`; UI không hiển thị trùng hai dòng Office có cùng nội dung.

---

## Cập nhật 2026-05-31 — Fix TH4 soát xét hồ sơ con

### Lọc dropdown "Tài liệu cha" theo phòng ban

`reviewParentOptions` trong TH4 phải filter thêm `item.phong_ban === form.phong_ban`. Nếu không, dropdown hiển thị tài liệu cha của mọi phòng ban dù đã chọn PHK hay phòng ban khác.

### handleSave TH4 — branch điều kiện

Branch `isNew && phan_loai_tl === "con"` dùng `saveChildDraftRecords` (tạo batch). Với TH4 (soát xét hồ sơ con), cần thêm điều kiện `&& form.chon_quy_trinh !== "Soát xét"` để TH4 fall-through sang luồng upsert đơn ở `isNew` branch bên dưới.

### parent_doc_id cho TH4

Payload `parent_doc_id` dùng `selectedParentDocId || reviewParentDocId`. TH4 chỉ set `reviewParentDocId` (dropdown "Tài liệu cha" trong form soát xét), không set `selectedParentDocId` (dùng cho TH2).

### Labels

Xem nguyên tắc tổng quát trong rule 16 mục "Label tài liệu/hồ sơ". Đặc biệt với TH4: codeLabel, titleLabel đã dynamic; typeLabel thêm mới nhưng không hiển thị trong TH4 (section `!isCon` ẩn); fileSectionLabel áp dụng cho header card "File tài liệu" ở right panel.

---

## C?p nh?t 2026-06-03 (b? sung) � So�t x�t gi? format m?

### So tr�ng m? vs l�u m?

- `normalizeDocumentCode()` ch? d�ng cho so s�nh canonical/tr�ng m?.
- Khi l�u `ma_tai_lieu` ho?c `ma_tai_lieu_moi` trong lu?ng so�t x�t, ph?i gi? nguy�n format user nh?p sau khi `trim().toUpperCase()`.
- Kh�ng ��?c d�ng canonical �? x�a k? t? ph�n c�ch �? ghi DB, v? s? l�m sai nghi�m tr?ng c�c m? ISO nh�:
  - `PHK-QT22-F01` -> `PHKQT22F01`
  - c�c m? c� d?u g?ch/format chu?n ISO th�nh chu?i li?n.

### Rule nghi?p v? ch?t

- So�t x�t ��?c gi? nguy�n m? c?a t�i li?u/h? s� ngu?n n?u kh�ng ch?n �?i m?.
- N?u ch?n �?i m?, h? th?ng ph?i l�u m? m?i ��ng format user nh?p, kh�ng chu?n h�a m?t d?u g?ch hay k? t? ph�n t�ch h?p l?.
- Canonical form v?n ��?c d�ng cho:
  - detect tr�ng m? trong danh s�ch draft,
  - detect tr�ng m? v?i record `co_hieu_luc`,
  - x�c �?nh b?n c? c?n chuy?n `het_hieu_luc`.

### File ph? so�t x�t

- Khi k? `change_request`/`review_request`, b�?c ch�n tag ch? k?/t�n ph?i suy ra theo `action`, kh�ng ch? theo `userId`.
- V?i PDF file ph?, n?u kh�ng �?c ��?c text template th? kh�ng ��?c v? footer fallback to�n trang.
