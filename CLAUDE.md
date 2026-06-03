# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Lenh phat trien

```bash
# Chay dev server (Next.js App Router, port 3000)
npm run dev

# Build san pham
npm run build

# Lint (ESLint v9)
npm run lint

# Kiem tra TypeScript (khong emit)
npx tsc --noEmit
```

Khong co test suite. De kiem tra thay doi, su dung `npm run build` + `npx tsc --noEmit`.

### Scripts seed / migration

Scripts yeu cau bien moi truong trong `.env.local`:

```bash
# Seed lo vuon (forest_plots) tu file GeoJSON
node --env-file=.env.local scripts/seed-forest-plots.mjs

# Import vat tu kho tu file Excel
node --env-file=.env.local scripts/import-inventory-items.mjs

# Migration user cu (bang users cu -> profiles + auth)
node --env-file=.env.local scripts/migrate-legacy-users.mjs
```

Migration SQL chay tay trong Supabase SQL Editor (`supabase/migrations/`). Khong co Supabase CLI trong project.

### Bien moi truong bat buoc

File `.env.local` can:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # chi API routes server-side
SIGN_JWT_SECRET=                  # module ISO ky chu ky so
TELEGRAM_BOT_TOKEN=               # thong bao bao tri
TELEGRAM_CHAT_ID=
ISO_TELEGRAM_BOT_TOKEN=           # thong bao ISO (nhom rieng)
ISO_TELEGRAM_CHAT_ID=
GMAIL_USER=                       # email thong bao
GMAIL_APP_PASSWORD=
NEXT_PUBLIC_APP_URL=
```

---

## Kien truc he thong

### Routing va trang

- **Next.js App Router** — tat ca trang la Server Component mac dinh, trang client dung `"use client"`.
- Dashboard layout (`src/app/dashboard/layout.tsx`): Client component, xu ly toan bo session sync (bootstrap, SIGNED_IN, interval 60s, focus/visibility). Day la noi duy nhat cai dat `onAuthStateChange`.
- Trang in bao tri (`/dashboard/maintenance/print/`) bypass sidebar — layout kiem tra `pathname.includes("/print")` va render `{children}` thang.
- Route API (`src/app/api/`): Server-side, dung `getSupabaseAdmin()` tu `src/lib/supabase-admin.ts` de bypass RLS khi can.

### Hai Supabase client

| Client | File | Dung o dau |
|--------|------|-----------|
| Anon (browser) | `src/lib/supabase.ts` | Moi page/component client |
| Service role | `src/lib/supabase-admin.ts` | Chi API routes (`/api/*`) |

**Khong dung `supabase-admin` trong component** — chi server-side.

### Auth va session

- `src/lib/auth.ts` la noi tap trung toan bo logic auth: `getActiveFactoryId()`, `hydrateActiveSession()`, `getFreshAuthSession()`, `hasPermission()`.
- `localStorage.erp_user` va `localStorage.erp_factory` la cache UI — khong phai source of truth.
- Uu tien `getActiveFactoryId()` trong moi page, khong doc `localStorage` truc tiep.
- Supabase JS v2 **khong throw exception** khi loi DB — luon check `error` object sau moi query.

### Pattern page chuan (Client Component)

1. `useEffect([], [])` — bootstrap: chi goi `getActiveFactoryId()`, khong goi `loadData`.
2. `useEffect([factoryId, loadData])` — xu ly load dau va reload khi filter thay doi.
3. `loadData` dung `useCallback` voi `try/finally` de ha loading.
4. `setSaving(false)` luon nam trong `finally` cua ham save.

### Module ISO & Chu ky so

- PDF generation: `src/app/api/sign/generate-pdf/route.ts` — dung `pdf-lib` + `pdfjs-dist` + font `public/fonts/`.
- Ky DOCX/XLSX: `src/app/api/sign/generate-office/route.ts` — dung `jszip` (DOCX) + `exceljs` (XLSX).
- Placement chu ky (drag-and-drop): `react-draggable` + `re-resizable`, yeu cau `nodeRef` vi React 19 da xoa `findDOMNode`.
- Storage bucket `iso-documents` (public): path `{factory_id}/iso/...`, `signatures/{factory_id}/{user_id}/chu_ky.png`.

### Kho vat tu (Inventory)

- RPC Supabase (`inventory_post_*_document`, `inventory_cancel_document`) de dam bao toan ven ton kho — khong UPDATE `on_hand` truc tiep.
- Dau dung chung bon: vat tu co `uses_shared_oil_stock = true` dung pool ton theo kho, khong theo ma vat tu.

---

# CLAUDE.md - Rubber ERP · PTCS Phuoc Hoa

## Tong quan

Rubber ERP la he thong quan ly san xuat cao su cho:

- Cong ty: CONG TY TNHH PTCS PHUOC HOA KAMPONG THOM
- Deploy: https://qlsxkpt.vercel.app
- GitHub: https://github.com/luanto88/rubber-erp
- Backend: Supabase
- Stack: Next.js App Router, TypeScript, Tailwind CSS

## Vai tro cua file nay

File nay la entrypoint tong quan cho AI/dev.
Chi giu cac nguyen tac he thong, source of truth, va chi dan den rules chi tiet.
Khong lap lai business logic dai dong o day.

## Cau truc thu muc chinh

```text
src/
  app/
    page.tsx
    dashboard/
      page.tsx
      dispatch/page.tsx
      storage/page.tsx
      product/page.tsx
      quality/page.tsx
      export/page.tsx
      eudr/
      settings/page.tsx
  lib/
    supabase.ts

.claude/rules/
  01-project-overview.md
  02-safety-rules.md
  03-database-schema.md
  04-code-patterns.md
  05-ui-components.md
  06-module-production.md
  07-module-quality.md
  08-module-export.md
  09-auth-session.md
  10-roadmap.md
  11-factory-config.md
  12-settings-permissions.md
  13-inventory-module.md
  storage.md
```

## Invariants bat buoc

### 1. Multi-tenant theo nha may

- Moi query Supabase phai filter theo `factory_id`
- `factory_id` lay tu session hien tai
- Khong hien thi hoac thao tac du lieu khac nha may dang dang nhap

### 2. Day chuyen la truc loc chinh

Tat ca module nghiep vu phai filter theo:

`Nha may -> Day chuyen -> Chung loai SP -> Loai banh / Loai boc / Loai tham / Pallet`

### 3. Source of truth cho cau hinh san pham

File `cung_cap_dl/du_lieu_nha_may.xlsx` la source of truth cao nhat cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`
- `loai_pallet_xuat`

Quy tac van hanh:

- Excel la nguon chuan ban dau de seed va doi chieu spec
- Database la nguon chay thuc te cua he thong
- Cac gia tri mo rong runtime theo nha may phai luu vao database
- Khong hard-code danh sach nay rai rac trong tung page

### 4. Quy tac loc theo nha may

- `loai_pallet_xuat`: loc theo `nha may`
- `loai_banh`, `loai_boc`, `loai_tham`: loc theo `nha may + day_chuyen + chung loai SP`
- `loai_pallet_sx`: su dung matrix cau hinh theo nha may va to hop san pham tu nguon cau hinh

### 5. Quy tac lo tron

- Banh `35` va `33.33`: 4 kien, moi kien 36 banh -> lo tron `144` banh
- Banh `20`: 4 kien, moi kien 60 banh -> lo tron `240` banh

### 6. Quan he Thanh pham va Xuat hang

- Lo `Hoan thanh` duoc hien thi tai module `Xuat hang`
- Khi xuat het remaining, lo chuyen trang thai `Xuat hang`
- Khi xoa don hang, phai tinh lai remaining cua lo
- Neu lo con hang kha dung sau khi xoa don, trang thai lo quay ve `Hoan thanh`

### 6.1. Quy tac ngay thanh pham va KN

- `lots.ngay_sx`: ngay mo lo
- `lots.ngay_ht`: ngay tron lo / hoan tat lo
- `qc_results.ngay_sx` phai phan anh ngay thanh pham hoan tat:
  - uu tien `lots.ngay_ht`
  - fallback `lots.ngay_sx`
- Neu lo ke thua qua nhieu ngay, khong duoc dung ngay mo lo de dai dien cho ngay hoan tat KN

### 7. Cai dat la noi quan tri tap trung

Module `Cai dat` la noi quan tri tap trung cho:

- Xe
- Hau to
- Khach hang
- Cau hinh nha may / matrix san pham
- Cac gia tri mo rong them nhanh trong module nghiep vu
- Nguoi dung va phan quyen

Quy tac:

- Co the giu thao tac them nhanh trong module nghiep vu
- Moi du lieu them nhanh phai dong bo ve danh muc tuong ung trong `Cai dat`
- `Cai dat` duoc to chuc theo nhieu tab de admin thao tac ro rang

Mac dinh cac tab lon:

- `Cong ty`
- `Nguoi dung`
- `Phan quyen`
- `Cau hinh nha may`
- `Danh muc`

Nguyen tac xep chuc nang:

- Matrix quy tac van hanh theo nha may -> `Cau hinh nha may`
- Master data / danh muc dung chung -> `Danh muc`
- Neu mot domain lon len du nhieu bang con, co the tach thanh tab rieng sau

Vi du:

- `Bao tri` o giai doan dau dua vao `Danh muc`
- Khi module `Bao tri` du lon, co the tach tab `Bao tri` rieng trong `Cai dat`

### 8. Dang ky, duyet tai khoan, phan quyen

- He thong dang nhap dung `Supabase Auth`
- Username duoc anh xa sang email noi bo hop le theo dang `username@auth.rubber-erp.example.com`
- Khong tao tai khoan moi voi domain `.local`
- Tai khoan dang ky moi mac dinh `pending`
- Admin duyet tai khoan trong `Cai dat`
- Phan quyen theo `module + action chuan`, them mot so action dac biet
- Quyen phai duoc check o ca UI va logic thao tac
- Tai khoan `disabled` khong duoc phep vao ung dung

### 8.1. Quy tac session va loading

- `Supabase Auth session` la source of truth cho dang nhap
- `erp_user` va `erp_factory` trong `localStorage` chi la cache session cho UI
- Khi can `factory_id`, uu tien helper `getActiveFactoryId()` thay vi doc thang `localStorage`
- Khi can ca `factory_id` lan `user` (nhu settings page), dung `getActiveFactoryId()` + `hydrateActiveSession()`
- App phai chu dong refresh session neu token sap het han; `SESSION_REFRESH_LEEWAY_SECONDS = 300` (5 phut truoc khi het han)
- Dashboard layout phai tu dong dong bo lai session khi:
  - bootstrap (full hydration — fetch profile + permissions)
  - SIGNED_IN event (full hydration, chi khi `bootstrapDone = false`)
  - focus lai cua so (lightweight — chi verify token, khong DB query)
  - tab quay lai visible (lightweight)
  - heartbeat dinh ky 60 giay (lightweight)
- Bootstrap layout phai boc trong `Promise.race` voi timeout 10s de tranh spinner treo do mang cham
- Bootstrap phai set `bootstrapDone = true` trong `finally` — SIGNED_IN handler chi duoc goi full hydration khi `!bootstrapDone`, tranh double hydration (3-4 DB query thua) khi Supabase fire SIGNED_IN cho session dang co ngay luc layout mount
- Interval va focus sync phai dung lightweight (`getFreshAuthSession()` only) — goi `hydrateActiveSession()` moi 60s se lam 4-5 DB query, loi nao do co the xoa user sai
- `onAuthStateChange` SIGNED_OUT handler:
  - phai co `isLoggingOutRef.current` check — neu dang logout thu cong thi skip (handleLogout se navigate)
  - neu khong phai logout thu cong, thu `getFreshAuthSession()` truoc khi redirect — Supabase co the fire SIGNED_OUT khi network blip, gay false-positive kick user ra
- `handleLogout` phai set `isLoggingOutRef.current = true` truoc khi goi `signOutEverywhere()`
- Tat ca redirect trong `syncSession` va fallback `useEffect` phai dung `window.location.replace` thay vi `router.replace` — dam bao hard navigation ngay lap tuc
- Sau bootstrap, neu `!loading && !user`, phai redirect ve `/login` bang `useEffect` voi `window.location.replace`
- Cac ham load du lieu co bat `loading` phai co `try/finally` hoac co che ha loading tuong duong
- Ham save trong modal: `setSaving(false)` PHAI nam trong `finally`; sau save thanh cong dung `void loadData()` (fire-and-forget), KHONG `await loadData()` — neu `loadData` nam trong `try` va bi treo, `finally` khong chay, button "Dang luu..." bi treo mai mai
- Khong duoc de page roi vao trang thai gia:
  - session loi nhung hien `Khong co du lieu phu hop`
  - request loi nhung spinner treo `Dang tai...`

## Rules can doc khi lam viec

- Tong quan: `.claude/rules/01-project-overview.md`
- An toan: `.claude/rules/02-safety-rules.md`
- Schema DB: `.claude/rules/03-database-schema.md`
- Code patterns: `.claude/rules/04-code-patterns.md`
- UI patterns: `.claude/rules/05-ui-components.md`
- San xuat: `.claude/rules/06-module-production.md`
- Kiem nghiem: `.claude/rules/07-module-quality.md`
- Xuat hang + EUDR: `.claude/rules/08-module-export.md`
- Auth + session: `.claude/rules/09-auth-session.md`
- Roadmap: `.claude/rules/10-roadmap.md`
- Factory config: `.claude/rules/11-factory-config.md`
- Settings + permissions: `.claude/rules/12-settings-permissions.md`
- Inventory: `.claude/rules/13-inventory-module.md`
- Bao tri: `.claude/rules/14-maintenance-module.md`
- San luong: `.claude/rules/15-output-module.md`
- Logic ngan luu chi tiet: `.claude/rules/storage.md`
- ISO và hồ sơ con: đọc `.claude/rules/16-iso-vanban-module.md` và `.claude/rules/17-iso-soat-xet.md`; ưu tiên các mục "Cập nhật mới nhất (2026-05-28)" nếu có mâu thuẫn với logic cũ.

## Ghi chu cap nhat module kho (2026-05-09)

- Tab `Nhap kho`:
  - Nut `Them moi` cua `Phan loai vat tu` va `Ma vat tu` phai nam cung hang voi field tuong ung, canh phai dung layout.
  - `Them moi` cua `Phan loai vat tu` mo modal form va ghi vao `inventory_item_categories`.
  - `Them moi` cua `Ma vat tu` mo modal form va ghi vao `inventory_items`.
  - Khi tao nhanh `Ma vat tu`, phai tao kem rule kho mac dinh theo kho nhap dang chon trong `inventory_item_warehouse_rules`.
- Tat ca dropdown `Ma vat tu` cua module kho uu tien dung component co o `Tim nhanh` ngay trong menu.
- Tab `Ton kho` va `The kho`:
  - Dropdown bo loc phai noi tren bang du lieu, khong bi chim duoi `Bang ton hien tai` hoac `Lich su phat sinh`.
  - `Phan loai vat tu` trong `The kho` chi hien thi ten phan loai, khong hien thi UUID / id ben duoi.
  - Xuat Excel `The kho` phai bam theo mau `cung_cap_dl/mau_the_kho.png`.

## Ghi chu cap nhat module dieu xe (2026-06-01)

- Migration `supabase/migrations/20260601_dispatch_entry_rows.sql` da chay.
- `dispatch_entries` la header/chung tu; `dispatch_entry_rows` la bang vat ly chi tiet tung chuyen.
- `dispatch_entries.rows` van duoc giu va cap nhat song song de tuong thich legacy.
- Module dieu xe doc uu tien `dispatch_entry_rows`, fallback `dispatch_entries.rows`.
- Khi them/sua/import dieu xe, phai ghi song song header legacy va bang vat ly qua `replaceDispatchEntryRows`.
- Helper moi:
  - `src/lib/dispatch-entry-rows.ts`
  - `src/lib/dispatch-analytics.ts`
  - `src/lib/dispatch-pdf.ts`
- `/dashboard/dispatch` co tab `Thong ke`, loc theo doi/xe, KPI, bang tong hop theo doi/xe, PDF tong/PDF doi/PDF xe.
- Chi tiet ngay dieu xe co nut PDF tung chuyen.
- `writeBackToDispatch` cap nhat ca `dispatch_entries.rows[]` va `dispatch_entry_rows`.
- Kiem tra da pass: ESLint scoped cac file dieu xe/output moi va `npx tsc --noEmit --pretty false`.
- `npm run lint` toan repo con fail do loi cu ngoai pham vi o `page.tsx` va `src/app/test-sodo/page.tsx`.

## Ghi chu cap nhat module ISO (2026-06-03)

- Migration `supabase/migrations/20260603_iso_lan_ban_hanh_text.sql` da chay.
- `iso_documents.lan_ban_hanh` da doi sang `TEXT`; trong code va UI phai xem day la chuoi, khong parse/ep buoc ve numeric.
- Gia tri hop le dang duoc nghiep vu chap nhan: `NN` hoac `NN/NN` (vi du `00`, `01`, `01/01`).
- Khi soat xet:
  - Tai lieu/ho so dang `01` thi auto-increment thanh `02`.
  - Tai lieu/ho so dang `01/01` thi auto-increment thanh `01/02`.
- File phu soat xet (`Phiếu yêu cầu thay đổi`, `Đề nghị soát xét`) ky noi tiep tren ban `*_signed_url` moi nhat, khong quay lai file goc.
- Preview nut mat o 2 section `Tài liệu soát xét` uu tien mo file da ky:
  - `file_phieu_yeu_cau_thay_doi_signed_url || reviewChangeFileUrl`
  - `file_de_nghi_soat_xet_signed_url || reviewRequestFileUrl`
- Luong `Soat xet tai lieu cha` da bat dau code trong `src/app/dashboard/iso/documents/[id]/page.tsx`:
  - Co panel `Soát xét hồ sơ con hiện có`
  - Co panel `Thêm hồ sơ con mới`
  - Da noi validate/lưu cho ca 2 nhom nay khi luu parent review
- Chua test tay nghiep vu ISO sau thay doi tren 3 case revision: `00`, `01`, `01/01`.

## Ghi chu cap nhat module ISO (2026-06-03, bo sung session sau)

- `Soat xet` duoc phep luu ma trung voi dung tai lieu/ho so nguon dang duoc soat xet; `Soan thao moi` van chan trung ma nhu cu.
- Khi `phe_duyet` luong `Soat xet`, phai ha `het_hieu_luc` tat ca ban `co_hieu_luc` trung ma lien quan truoc khi nang ban moi len `co_hieu_luc`; khong con dung rule "chi invalidate 1 ban gan nhat".
- Quy tac tren ap dung cho ca tai lieu cha va cac ho so con trong cung dot soat xet, de tranh loi unique constraint `uniq_iso_documents_factory_ma_tai_lieu_active`.
- 2 file phu soat xet (`file_phieu_yeu_cau_thay_doi_*`, `file_de_nghi_soat_xet_*`) chi hien/cho dat QR o buoc `soan_thao`; buoc `xem_xet` va `phe_duyet` khong hien lai QR draggable.
- Tinh nang `Nhan ban chu ky` cho file phu phai nhan ban ca o ten nguoi ky; o ten ban sao phai drag/resize duoc va luu dung vi tri user dat.

## Nho ky

- Khong xoa file hay xoa du lieu khi chua duoc xac nhan
- Supabase JS v2 khong throw DB error -> luon check `error`
- Khong dung `localStorage` de luu data nghiep vu
- Tai lieu chi tiet uu tien nam trong `rules`, khong nhan ban day lai vao file nay
- Mac dinh giao dien va noi dung trong app phai viet bang tieng Viet co dau
- Tren web, luon dam bao tieng Viet co dau, dung chinh ta, ngoai tru khi nguoi dung yeu cau khac
- Chi thay doi ngon ngu hien thi khi nguoi dung yeu cau ro rang
- Với module ISO, tài liệu cha và hồ sơ con `parent_doc_id` là một bộ tài liệu khi xem xét/phê duyệt; không tách thành nhiều đầu việc riêng lẻ trong `Việc của tôi`.
- Hồ sơ con PDF phải có footer trạng thái trên tất cả trang; hồ sơ con DOCX/XLSX chỉ chặn khi có tag `{{...}}` sai/gần giống, còn tag đúng nhưng thiếu thì bỏ qua.
- QR DOCX hồ sơ con dùng khoảng 12mm x 12mm và phải thay được cả khi `{{QR}}` đứng độc lập hoặc nằm chung dòng với tiêu đề trong header.
- Trong `/dashboard/product`, canh bao `lo do dang` dang hien thi theo tat ca lo do dang cung day chuyen, khong phu thuoc nam thanh pham
- Neu doi rule loc `lo do dang`, phai cap nhat dong bo ca canh bao ngoai list va canh bao trong form tao moi
- Trong `/dashboard/export`, bo loc lo va cac query theo `trang_thai` phai dung chuoi tieng Viet chuan (`Hoan thanh`, `Xuat hang` theo gia tri nghiep vu), tranh mojibake lam mat lo kha dung

## Ghi chú ISO mới nhất (2026-05-31)

Các dòng dưới đây thay thế các ghi chú ISO cũ phía trên nếu có mâu thuẫn:

- Hồ sơ con là bản ghi riêng trong `iso_documents`, liên kết cha bằng `parent_doc_id`.
- Tài liệu cha kèm hồ sơ con được tạo cùng form là một bộ khi xem xét/phê duyệt; `Việc của tôi` và badge sidebar gom thành một đầu việc.
- Hồ sơ con soạn thảo mới cho quy trình/tài liệu cha đã có hiệu lực là đầu việc độc lập cho tới khi phê duyệt. Sau khi lưu mở trang hồ sơ vừa tạo, không mở trang cha.
- Trang tài liệu cha đang có hiệu lực chỉ hiển thị hồ sơ con đã có hiệu lực; hồ sơ nháp/chờ xem xét/chờ phê duyệt không tự nhảy vào panel file của cha.
- `ma_tai_lieu` phải duy nhất trong cùng `factory_id` cho cả tài liệu cha và hồ sơ con; chặn trùng trong các dòng nháp và trong DB.
- DOCX/XLSX hồ sơ con dùng toàn bộ bộ tag chữ chuẩn của ISO cộng `{{QR}}`: tag đúng có thì điền, tag đúng thiếu thì bỏ qua, tag sai/gần giống dạng `{{...}}` thì chặn và yêu cầu thay file.
- Hồ sơ cấp 2 gửi thẳng phê duyệt phải tạo artifact Office với trạng thái `Chờ phê duyệt`.
- Nút xem file ưu tiên `file_signed_pdf_url`, rồi `file_signed_office_url`, rồi `file_goc_url`; UI không hiển thị trùng hai dòng Office có cùng nội dung.
- Draft rows hồ sơ con chỉ xuất hiện 1 nơi trong right panel; không có panel soạn thảo thứ hai bên trái.
- XLSX QR kích thước 46×46px (~12mm tại 96 DPI); DOCX QR vẫn dùng 432000×432000 EMU (~12mm).
- `auto_convert_pdf` (BOOLEAN, DB column): khi true, sau phê duyệt file Office tự convert sang PDF qua CloudConvert; CloudConvert lỗi thì toast lỗi nhưng không block workflow.
- `showSignature` trong `SignPlacement`: hồ sơ con (`isCon=true`) có thể ẩn cả chữ ký lẫn tên trong modal placement; tài liệu cha chỉ ẩn được tên.
- `handleFileUpload` dùng `rebuildDraftCode` sau khi điền trường từ tên file — mã tự sinh ngay sau upload.
- Form soạn thảo hồ sơ riêng lẻ (`isNew && phan_loai_tl === "con"`) dùng multi-row table (`childDraftRows`) giống tài liệu cha; không còn section đơn "File hồ sơ" với `ref.click()`. Lưu tạo N `iso_documents` từ các dòng, navigate tới doc đầu tiên.
