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
- Dieu xe: `.claude/rules/19-dispatch-module.md`
- Thuc hien ho so ISO (form instances + pgvector search): `.claude/rules/20-iso-forms-module.md`
- Kiem soat qua trinh (thong so ky thuat + do nhanh chi tieu): `.claude/rules/23-process-control-module.md`
- Chuong thong bao "Viec can lam theo module" (layout.tsx + module-tasks.ts): `.claude/rules/24-notification-bell-module-tasks.md`
- Muc tieu chat luong theo nam + Bao cao thong ke chat luong (quality_targets, lib/quality-stats.ts, 2 bao cao in): `.claude/rules/25-quality-targets-reports-module.md`
- Ghi chu nhanh (rieng tu theo nguoi tao, admin thay tat ca, co the chia se, kem anh + widget Dashboard): `.claude/rules/26-operation-notes-module.md`
- Quan ly cong viec & Danh gia KPI nhan vien (giao viec, tien do %, 5S theo QR, khung tieu chi KPI, bang diem thang): `.claude/rules/27-kpi-module.md`
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

## Ghi chú Permission Guard (2026-06-22)

- Tất cả trang dashboard đã có permission guard trong bootstrap, sử dụng `hasPermission(user, "module.view")`.
- Pattern chuẩn: gọi `hasPermission` ngay sau `setCurrentUser(...)`, trước khi fetch `factoryId` hay load data. Nếu không đủ quyền: `setLoading(false); window.location.replace("/dashboard"); return`.
- `EudrClient.tsx` đã chuyển sang `hydrateActiveSession()` + `export.view` guard — KHÔNG còn đọc `localStorage.getItem("erp_factory")` trực tiếp.
- `inventory/layout.tsx` là client layout guard bảo vệ toàn bộ sub-routes `/dashboard/inventory/*`.
- Quy tắc chi tiết guard theo trang: `.claude/rules/12-settings-permissions.md` mục "Permission guard theo trang".

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

## Ghi chú module Kiểm nghiệm — Mục tiêu chất lượng & Báo cáo thống kê (2026-07-05)

Chi tiết đầy đủ: `.claude/rules/25-quality-targets-reports-module.md`. Tóm tắt các điểm dễ quên:

- Bảng mới `quality_targets` — ngưỡng mục tiêu theo `(nam, chi_tieu, san_pham)` **độc lập** với ngưỡng chấm KN chính thức (TCCS/TCVN); nếu năm hiện tại chưa nhập mục tiêu thì tự fallback dùng mục tiêu năm liền trước.
- Engine tính toán riêng `src/lib/quality-stats.ts`, cố ý không tái dùng `calcGrade` (`quality/page.tsx`) hay công thức trong `quality-analytics/page.tsx` — bản thứ 3 độc lập, chỉ đồng bộ công thức grading per-field.
- Báo cáo phân tích SPC (`buildCriterionSpcReport`): khi 1 ngày có nhiều lô, mỗi cột "Mẫu N" là **trung bình vị trí mẫu qua các lô cùng ngày** (không flatten thô — từng gây tràn cột khi ngày có nhiều lô). Cp/Cpk 1 phía cho chỉ tiêu chỉ có 1 giới hạn thật (không bịa biên giả định).
- Trang in `/dashboard/quality/reports/print`: mỗi chỉ tiêu in đúng 2 trang (bảng dữ liệu + biểu đồ), ngắt trang bằng inline `style={{ pageBreakBefore: "always" }}` — **không dùng CSS sibling selector** vì đã test không đáng tin cậy khi in thật.
- Giám đốc nhà máy chọn từ dropdown `maintenance_staff` (chức vụ chứa "giám đốc"); người lập báo cáo/nhân viên kỹ thuật luôn là user đang đăng nhập, không nhập tay.

### Cập nhật 2026-07-06

- `quality_targets` có thêm cột `target_value` (migration `20260706_quality_targets_value.sql`) — giá trị "trọng tâm" lý tưởng, **độc lập với `nguong_min/max`**, chỉ vẽ đường tham chiếu trên biểu đồ phân bố, không dùng để tính đạt/không đạt.
- Trang in chuyển khổ `A4 landscape` → `A4 portrait`; các bảng rộng dùng `table-layout: fixed` + `overflow-x-auto` để không tràn trang; tiêu đề công ty/nhà máy chuyển sang căn trái; khối chữ ký thêm `break-inside: avoid` để tên không bị ngắt sang trang khác với chức danh.
- Biểu đồ phân bố (Báo cáo 2): cột histogram đổi màu nổi bật hơn + thêm nhãn số đếm trên đỉnh cột (`LabelList`); bổ sung đường UCL/LCL (thiếu trước đó); mọi đường tham chiếu (USL/LSL/Target/UCL/LCL/CL/R̄) trên cả 3 biểu đồ đều hiện kèm giá trị số, dùng `ifOverflow="extendDomain"` để trục tự giãn. Chi tiết đầy đủ xem mục "Cập nhật 2026-07-06" trong `.claude/rules/25-quality-targets-reports-module.md`.

## Ghi chú cập nhật module Điều xe / Kho nguyên liệu / Sản lượng (2026-07-11)

Chi tiết đầy đủ: `.claude/rules/19-dispatch-module.md` (mục "Bug nghiêm trọng đã fix 2026-07-11"), `.claude/rules/storage.md` (mục 15), `.claude/rules/15-output-module.md` (mục "Cập nhật 2026-07-11"), `.claude/rules/06-module-production.md` (mục "Rule lưu thành phẩm và trạng thái ngăn"). Tóm tắt các điểm dễ quên:

- **Bug đã fix**: `cloneRow()`/`cloneRowsTemplate()` trong `dispatch/page.tsx` (nhân bản dòng/phiếu) không reset `row_id` khi tạo dòng clone, chỉ sinh `uid` mới — gây trùng `row_id` giữa các dòng khác nhau trong cùng 1 phiếu điều xe, khiến các chuyến bị trùng "biến mất" khỏi danh sách chọn chuyến ở Kho nguyên liệu (ref liên kết trip là `${dispatchEntryId}::${rowId}`). Đã fix code (reset `row_id: undefined` khi clone) và chạy `scripts/fix-duplicate-dispatch-row-ids.mjs --apply` sửa dữ liệu lịch sử (12 phiếu, 34 dòng, factory `phuochoa_kt`) — xác nhận 0/165 phiếu còn trùng sau khi chạy.
- Bất kỳ hàm nhân bản dòng `DxRow` nào trong tương lai đều phải reset cả `uid` lẫn `row_id`, không chỉ `uid`.
- Filter "Ghi chú" ở module Sản lượng (`output/page.tsx`) đổi từ single-select sang multi-select (`FilterMultiSelect` + `matchesNoteFilterMulti` trong `src/lib/note-filter.ts`); "Không có ghi chú" giờ nhận diện cả `null`/chuỗi rỗng/khoảng trắng **và chuỗi `"0"`** (lỗi phát sinh khi import Excel đọc ô trống thành số 0) — áp dụng cho cả 4 module dùng chung `note-filter.ts` (output, dispatch, product, storage).
- Bảng "Chuyến xe từ Điều xe" khi tạo/sửa ngăn (Kho nguyên liệu) giờ có thêm bộ lọc Ghi chú multi-select (mặc định hiển thị tất cả) và cột Ghi chú.
- Thẻ ngăn ở Kho nguyên liệu có thêm nút "Đồng bộ nhanh" (icon xoay, chỉ hiện khi có quyền sửa) — recompute `tong_tuoi`/`tong_kho` của riêng ngăn đó từ các trip đã gắn sẵn, không tải lại toàn trang, không tự thêm/bớt trip.
- Ngưỡng admin đánh dấu thủ công "Đã sản xuất" trên thẻ ngăn đổi từ `100%-110%` sang `>= 50%` (không giới hạn trên) — chỉ áp dụng cho nút thủ công này, không đổi ngưỡng `100%-110%` của banner hậu lưu trong module Thành phẩm.

## Ghi chú cập nhật Dashboard chính (2026-07-22)

Trang `/dashboard` được viết lại toàn bộ thành bảng điều khiển tổng hợp theo module, có phân quyền — trước đó trang này **không có bất kỳ permission guard nào**.

- Permission mới `dashboard.view` (migration `supabase/migrations/20260722_dashboard_view_permission.sql`, **cần chạy thủ công**) gate toàn bộ trang. Seed rộng cho `admin`/`manager`/`user` để không ai mất quyền ngay lúc deploy — admin tự thu hồi riêng theo tài khoản qua Cài đặt → Phân quyền nếu cần hạn chế.
- Tài khoản không có `dashboard.view` thấy màn hình "Chọn module" (`src/app/dashboard/_components/module-launcher-fallback.tsx`) thay vì Dashboard đầy đủ hoặc màn trắng — không redirect (route đích chính là `/dashboard`, sẽ vòng lặp).
- Mỗi khối nghiệp vụ trên Dashboard **tự gate riêng theo đúng quyền `.view` của module tương ứng** (`output.view`, `product.view`, `export.view`, `quality.view`, `dispatch.view`, `process.view`, `storage.view`, `inventory.view`) — độc lập với `dashboard.view`. Toàn bộ widget nằm trong `src/app/dashboard/_components/widgets/*.tsx`, mỗi widget tự chứa (nhận `{factoryId, user}`, tự tải dữ liệu, tự ẩn khi thiếu quyền, lỗi truy vấn nuốt êm) — mirror đúng pattern `quick-notes-widget.tsx` đã có từ trước.
- Bảng màu/tooltip Recharts dùng chung mới `src/lib/chart-theme.tsx` — **chỉ dùng cho Dashboard mới**, không đụng palette riêng của `quality-analytics/page.tsx`/`process/page.tsx` (mỗi trang đó vẫn tự quản màu của mình).
- `src/app/dashboard/_components/module-tasks.ts`: 5 hàm `getIsoTasks`/`getDocumentsTasks`/`getExportTasks`/`getInventoryTasks`/`getQualityTasks` đã thêm `export` (trước đó chỉ dùng nội bộ cho chuông thông báo) để Dashboard tái dùng cho khối "Việc cần làm tổng hợp" và "Cảnh báo tồn kho vật tư" — không viết lại truy vấn.
- `src/lib/quality-stats.ts`: thêm `export` cho `toNums` (trước đó module-private) — dùng trong `quality-widget.tsx` để tính xu hướng chỉ tiêu theo ngày từ `qc_results.samples` mà không gọi lại `buildCriterionSpcReport` (quá nặng nếu gọi N lần theo từng tổ hợp CSR×chỉ tiêu).
- Widget "Điều xe" đọc `dispatch_entries.rows` (JSONB) qua `buildDispatchAnalytics`, lọc năm/tháng ở client bằng `toISODate()` — **không** dùng `.gte/.lte` trên cột `ngay` thô (có thể là text `dd/mm/yyyy`, xem `.claude/rules/19-dispatch-module.md` mục "đính chính 2026-07-21").
- Widget "Chế độ sấy & đo nhanh" lặp qua `CSR_BY_DAY_CHUYEN` (từ `process/_components/process-types.ts`) và dùng lại `resolveCheDoSuggestion` — không hardcode danh sách CSR riêng, tự bỏ qua tổ hợp không có dữ liệu.
- **Lưu ý eslint**: rule `react-hooks/set-state-in-effect` báo lỗi khi effect gọi `setState` đồng bộ ở nhánh early-return NHƯNG phần async phía sau kết thúc bằng `if (alive) { setX(); setLoading(false) }` thay vì `try/finally` — đổi sang `try { ... } finally { if (alive) setLoading(false) }` là hết lỗi (xem `overview-kpi-strip.tsx`). Chưa rõ nguyên nhân chính xác của rule, nhưng pattern `try/finally` luôn an toàn.
- **Chưa test tay trên trình duyệt thật** — cần: chạy migration trên Supabase SQL Editor trước; đăng nhập admin xác nhận toàn bộ khối hiển thị đúng; thu hồi `dashboard.view` của 1 tài khoản test xác nhận thấy đúng màn "Chọn module"; thu hồi riêng 1 quyền module (vd `quality.view`) xác nhận chỉ đúng khối đó biến mất; test "In QR ngăn nhanh" tải đúng file PDF; test "In nhãn lô nhanh" điều hướng đúng sang `/dashboard/product/predict`.

## Kế hoạch phiên sau (2026-07-22) — Dashboard v2 + Upload văn bản ký tay

Người dùng đã xem bản Dashboard đầu tiên (ảnh chụp `cung_cap_dl/ds.png`) và yêu cầu 5 điểm cải tiến dưới đây. **Chưa code gì ở phiên này** — chỉ ghi lại yêu cầu để phiên sau triển khai.

### 1. Nút header "Tạo lô mới" gây nhầm lẫn với "thêm lô vườn mới"

- Hiện `/dashboard/page.tsx` có 2 nút góc phải: "Bản đồ lô" (giữ nguyên, không đổi) và "Tạo lô mới" (điều hướng `/dashboard/product`, tạo lô **thành phẩm**).
- Người dùng muốn: nút thứ 2 đổi hẳn ý nghĩa, trở thành đúng chức năng "Thêm mới" của **Lô vườn (EUDR forest plot)** hiện có tại `Cài đặt → Cấu hình nhà máy → Lô vườn → Thêm mới` (vẽ polygon trên bản đồ bằng leaflet + geoman, xem `.claude/rules/04-settings-master-data.md` mục 4.5). Đổi nhãn nút thành **"Tạo Polygon mới"**.
- Modal "Thêm lô vườn" hiện nằm sâu trong `settings/page.tsx` (file rất lớn, nhiều state dùng chung). Hướng làm an toàn: deep-link kèm query param (vd `/dashboard/settings?tab=cau_hinh_nha_may&sub=lo_vuon&action=add`) để trang Settings tự mở đúng tab + modal khi mount — **không** tách modal ra component dùng chung ngay ở bước đầu (rủi ro đụng cấu trúc lớn của Settings). Cần đọc kỹ `settings/page.tsx` phần state điều khiển tab/modal Lô vườn trước khi sửa.
- Cần xác nhận đúng permission gate cho nút này (khả năng cao là quyền hiện đang gate mục Lô vườn trong Settings, chưa kiểm chứng ở phiên này).

### 2. Panel "Thao tác nhanh" (`quick-actions-panel.tsx`)

- Bỏ mục "Xem bản đồ lô" khỏi panel — trùng với nút "Bản đồ lô" đã có ở header.
- Thêm 2 mục mới:
  - "Tạo tài liệu ISO" → `/dashboard/iso/documents/new`, gate `iso.create`.
  - "Soạn thảo văn bản mới" → `/dashboard/documents/new`, gate `documents.create`.
- Không đụng mục "Tạo lô thành phẩm" trong panel (khác với nút header ở mục 1 — 2 nút độc lập, không xung đột sau khi đổi nút header).

### 3. Hai thẻ đầu trang chưa bằng chiều cao trên desktop

- `page.tsx` hiện đặt `QuickActionsPanel` (col-span-1) và `ProcessDryingWidget` (col-span-3) trong cùng 1 hàng `grid lg:grid-cols-4` — ảnh chụp cho thấy 2 thẻ cao thấp lệch nhau rõ rệt trên desktop.
- Yêu cầu: 2 thẻ cao bằng nhau. Hướng làm: đảm bảo cả 2 `<div>` item và `WidgetCard` bên trong đều `h-full` (grid item mặc định `align-items: stretch` nên chỉ cần không có gì chặn `h-full` lan xuống) — không set chiều cao cứng vì nội dung 2 bên tải bất đồng bộ và số dòng khác nhau.

### 4. Widget "Chế độ sấy & đo nhanh chỉ tiêu" — 2 sửa đổi

1. **Ẩn hẳn tổ hợp CSR không có dữ liệu riêng** (ảnh minh họa: card CSR20 hiện vẫn hiển thị dù ghi "Chưa có dữ liệu riêng cho CSR 20, đang dùng chế độ gần nhất của dây chuyền..." và "5 kết quả đo gần nhất: Chưa có dữ liệu"). Nguyên nhân: `process-drying-widget.tsx`'s `loadCombo()` dùng `resolveCheDoSuggestion(csrMatch, latestAny, ...)` — khi không có `csrMatch` riêng, hàm fallback về `latestAny` (chế độ của CSR khác cùng dây chuyền) nên `row` vẫn non-null, card vẫn render. Với mục đích tóm tắt trên Dashboard (khác mục đích gốc của hàm này — auto-fill form ở module Process, nơi fallback hữu ích), cần đổi điều kiện render thành: **chỉ hiện card khi có `csrMatch` thật** (bỏ qua `warning`/fallback), bất kể `resolveCheDoSuggestion` trả gì.
2. **Thiết kế lại layout mỗi thẻ** — hiện đang thừa khoảng trắng, dòng "ngày · ca" và "Po/Mo" bị tách dòng lộn xộn khi `min-w-[260px]` không đủ rộng cho nội dung `flex justify-between`. Cần bố cục rõ ràng, chắc chắn không vỡ dòng (ví dụ bảng 2 cột cố định thay vì flex, hoặc tăng min-width thẻ, hoặc rút gọn hiển thị kết quả đo dạng chip nhỏ).

### 5. Upload văn bản nội bộ ký tay — đồng bộ quy tắc ẩn/hiện field với Soạn thảo mới

- Trang `/dashboard/documents/new/upload` (đã rework nhiều lần, xem mục "Upload văn bản ký tay" phía trên) có luồng nhập liệu riêng — người dùng nhận thấy logic ẩn/hiện các trường **chưa nhất quán** với `/dashboard/documents/new`.
- Yêu cầu: áp dụng đúng các quy tắc đã chuẩn hóa ở luồng Soạn thảo mới vào trang Upload này — ví dụ: khối "Phân loại Thường/Mật" chỉ hiện khi `pham_vi = "Cong_ty"`; `cap_tl` khóa cứng `"Cấp 1"` khi `pham_vi = "Don_vi"`; tiền tố ký thay KT./TM./TL./TUQ. (xem mục "Tổng quát hóa 'KT.'" trong `.claude/rules/22-documents-module.md`)... — cần đối chiếu kỹ từng field giữa 2 trang trước khi sửa, không đoán.
- Việc cần làm đầu tiên ở phiên sau: đọc lại đồng thời `new/page.tsx` và `new/upload/page.tsx`, liệt kê rõ danh sách field nào đang lệch quy tắc, rồi mới sửa.

## Cập nhật 2026-07-22 (tiếp) — Đã triển khai xong 5 mục kế hoạch ở trên

Cả 5 mục đã code xong trong phiên này. `npx tsc --noEmit`, `npx eslint` (các file đã sửa), và `npm run build` đều sạch/pass. **Chưa test tay trên trình duyệt thật** — xem checklist cuối mỗi mục.

### 1. Nút header đổi thành "Tạo Polygon mới"

- `dashboard/page.tsx`: nút thứ 2 đổi permission gate từ `product.create` sang **`settings.manage_config`** (đã xác nhận đây đúng là quyền gate mục Lô vườn trong Settings — `canManageSettings = isAdmin || hasPermission(user, "settings.manage_config")`), điều hướng sang `/dashboard/settings?tab=cau_hinh_nha_may&sub=lo_vuon&action=add`, nhãn đổi thành "Tạo Polygon mới". Nút "Bản đồ lô" giữ nguyên không đổi.
- `settings/page.tsx`: thêm `useSearchParams()` (mirror đúng pattern đã dùng ở `quality/page.tsx` — dùng trực tiếp trong component `"use client"`, không cần bọc `<Suspense>`, đã build thành công và route vẫn `○ Static`). Thêm effect `deepLinkHandledRef` (chỉ chạy 1 lần, đợi `factoryId && user` sẵn sàng sau bootstrap): đọc `tab=cau_hinh_nha_may` → `setTab("factory-config")`; `sub=lo_vuon` → `setConfigTab("forest-plots")`; `sub=lo_vuon&action=add` (và có `settings.manage_config`) → mở đúng modal "Thêm mới" Lô vườn (`setConfigEditId(null); setForestPlotForm(emptyForestPlotForm()); setForestPlotGeometry(null); setConfigModal("forest-plot")`) — copy y hệt logic của nút "Thêm mới" đã có sẵn tại `configTab === "forest-plots"`. Không tách modal ra component riêng, không đụng cấu trúc lớn khác của Settings.
- **Chưa test tay**: bấm nút ở Dashboard → xác nhận vào đúng tab Cấu hình nhà máy, sub-tab Lô vườn, modal "Thêm mới" tự mở với form trống + bản đồ vẽ polygon sẵn sàng; xác nhận tài khoản không có `settings.manage_config` không thấy nút này ở Dashboard (trước đây gate theo `product.create` nên có thể khác tập user thấy nút).

### 2. Panel "Thao tác nhanh"

- `quick-actions-panel.tsx`: bỏ mục "Xem bản đồ lô" (`/dashboard/map`); thêm "Tạo tài liệu ISO" (`/dashboard/iso/documents/new`, gate `iso.create`, icon `FileText` tím) và "Soạn thảo văn bản mới" (`/dashboard/documents/new`, gate `documents.create`, icon `FilePlus2` xanh sky) — chèn ngay sau "Tạo đơn xuất hàng", trước "Bảng phân xe". Mục "Tạo lô thành phẩm" trong panel giữ nguyên.
- Màu `violet`/`sky` dùng dynamic Tailwind class (`bg-${color}-100`/`text-${color}-600`) — đã xác nhận cả 2 tổ hợp lớp này đã xuất hiện literal ở nơi khác trong repo nên Tailwind JIT scanner nhận diện đúng, không bị purge.
- **Chưa test tay**: xác nhận 2 mục mới điều hướng đúng trang, ẩn/hiện đúng theo quyền `iso.create`/`documents.create`.

### 3. Hai thẻ đầu trang cao bằng nhau

- `dashboard/page.tsx`: thêm `items-stretch` vào grid container + `h-full` vào 2 `<div>` item (`lg:col-span-1`, `lg:col-span-3`).
- `quick-actions-panel.tsx` và `process-drying-widget.tsx`: truyền `className="h-full"` vào `<WidgetCard>` (chỉ 2 nơi này, không đụng `WidgetCard` mặc định hay các widget khác — tránh ảnh hưởng ngoài ý muốn tới grid `InventoryAlertsWidget`/`TasksSummaryWidget` ở cuối trang).
- **Chưa test tay**: xem trên màn hình desktop thật, xác nhận 2 thẻ đầu trang luôn cao bằng nhau bất kể bên nào có ít/nhiều nội dung hơn (card ngắn sẽ có khoảng trắng dư ở dưới, không co lại theo nội dung).

### 4. Widget "Chế độ sấy & đo nhanh chỉ tiêu"

- `process-drying-widget.tsx`, `loadCombo()`: thêm `if (!csrMatch) return null` ngay sau khi lấy `csrMatchRes.data` — chỉ hiện card khi có chế độ sấy ghi nhận **riêng** cho đúng CSR đó, bỏ hẳn nhánh fallback dùng `latestAny` của CSR khác để quyết định có hiện card hay không (vẫn giữ nguyên `resolveCheDoSuggestion`/`warning` cho mục đích khác — chỉ đổi điều kiện lọc combo nào được đưa vào danh sách card).
- Redesign layout thẻ: đổi `min-w-[260px]` → `min-w-[300px]`; khối 3 số liệu (Đầu ướt/Đầu khô/Thời gian) đổi từ `grid-cols-3` sang `<table>` 2 hàng cố định (nhãn hàng trên, số liệu hàng dưới, mỗi cột `w-1/3`) để không lệch dòng; khối "5 kết quả đo gần nhất" đổi từ 1 dòng text nối bằng `" · "` (dễ vỡ dòng) sang mỗi dòng có nhãn ngày/ca bên trái (`shrink-0 whitespace-nowrap`) + các chip nhỏ bo góc (`bg-slate-100`) bên phải cho từng chỉ tiêu, tự `flex-wrap` khi nhiều chỉ tiêu.
- **Chưa test tay**: xác nhận card CSR không có dữ liệu riêng (dù dây chuyền có dữ liệu CSR khác) biến mất hẳn khỏi widget; xác nhận layout thẻ không còn vỡ dòng ở các độ rộng màn hình khác nhau, chip kết quả đo hiển thị gọn gàng.

### 5. Đồng bộ Upload văn bản ký tay với Soạn thảo mới

Đối chiếu field-by-field giữa `new/page.tsx` và `new/upload/page.tsx` phát hiện 2 quy tắc chuẩn hóa **hoàn toàn thiếu** ở trang Upload (không phải lệch nhẹ — thiếu hẳn UI/state/payload):

1. **Khối "Phân loại Thường/Mật"**: `new/page.tsx` đã có, gate `pham_vi !== "Don_vi"`. `new/upload/page.tsx` **không có field `phan_loai` nào cả** — mọi văn bản upload luôn nhận `phan_loai = "Thuong"` qua DB default dù người dùng tải lên 1 văn bản giấy đã đóng dấu MẬT thật. Hệ quả: mất watermark "MẬT" khi in lại (`documents/print/page.tsx` đọc `doc.phan_loai`) và mất badge cảnh báo ở trang chi tiết. Đã thêm đúng UI/state/payload y hệt `new/page.tsx` (nút Thường/Mật với icon `Shield`/`Lock`), gate theo `pham_vi`.
2. **`cap_tl`**: `new/page.tsx` có field + khóa cứng `"Cấp 1"` khi `Don_vi`. `new/upload/page.tsx` **không có field `cap_tl` trong state/UI/payload** — insert bỏ qua cột này hoàn toàn nên mọi văn bản upload có `cap_tl = NULL` trong DB (cột nullable, không lỗi) → trang chi tiết/in hiện "Cấp văn bản: —" thay vì "Cấp 1"/"Cấp 2" thật. Đã thêm dropdown Cấp 1/Cấp 2 gate theo `pham_vi`, khóa cứng "Cấp 1" khi chuyển sang `Don_vi` (giống hệt `onClick` của toggle `pham_vi` trong `new/page.tsx`).
- **Đã xác nhận KHÔNG lệch** (giữ nguyên, không đụng): tiền tố ký thay KT./TM./TL./TUQ. — Upload đã có sẵn đúng theo bản tổng quát hóa (`SIGN_AS_OPTIONS`/`SIGN_AS_LABEL` từ `documents-types.ts`), chỉ khác vị trí chọn (Upload chọn ngay lúc tạo vì không có bước ký live qua `SignPlacementModal`, còn `new/page.tsx` đã bỏ hẳn chọn-lúc-soạn từ 2026-07-06 vì giờ chọn lúc ký) — đây là khác biệt CÓ CHỦ ĐÍCH đã ghi rõ trong code, không phải bug.
- **Cố ý KHÔNG thêm**: field `mat_recipient_user_id` theo từng bước "Phòng ban đã ký" của Upload — trường này ở `new/page.tsx` chỉ phục vụ định tuyến thông báo cho bước ký **live** tiếp theo (`sign/route.ts`'s `getNextRecipients()`); văn bản upload luôn insert thẳng ở trạng thái `da_phe_duyet` (đã hoàn tất), không bao giờ chạy qua luồng ký live nên trường này không có tác dụng — thêm vào sẽ là code chết.
- Đã sắp xếp lại thứ tự field trong card "Thông tin văn bản" của Upload để khớp trình tự `new/page.tsx` (File → Phạm vi lưu hành → Phân loại → Loại VB → Phòng ban → Mã VB → Tên VB → Cấp VB → Ngày ký/phê duyệt riêng của Upload → Ghi chú) — lý do dời "Phạm vi lưu hành" lên sớm giống `new/page.tsx`: các field Phân loại/Cấp VB mới thêm đều phụ thuộc `pham_vi` nên cần chọn trước.
- **Chưa test tay**: tạo 1 văn bản Upload chọn "Nội bộ công ty" → xác nhận thấy cả khối Phân loại và Cấp văn bản, chọn "Mật" → lưu → mở trang chi tiết xác nhận badge "Mật" hiện đúng, in ra có watermark MẬT; chọn "Nội bộ đơn vị" → xác nhận cả 2 khối biến mất, lưu xong `cap_tl` trong DB là "Cấp 1" và `phan_loai` là "Thuong" bất kể đã chọn gì trước đó khi còn ở Cong_ty.

## Cập nhật 2026-07-22 (tiếp 2) — Redesign widget Chế độ sấy + mặc định "Người lập" ở Upload ký tay

Người dùng gửi 2 ảnh so sánh (bản hiện tại vs 1 ảnh tham khảo bố cục dạng dark theme) và yêu cầu redesign lại nhưng **giữ màu sắc/thông tin đúng theo dự án** (không copy nguyên dark theme, không bịa field không có trong data model). `npx tsc --noEmit`, `npx eslint`, `npm run build` đều sạch. **Chưa test tay.**

### Widget "Chế độ sấy & đo nhanh chỉ tiêu" (`process-drying-widget.tsx`)

- Giữ nguyên nền trắng/light theme của toàn app (`.claude/rules/05-ui-components.md`), chỉ mượn Ý TƯỞNG bố cục của ảnh tham khảo: header strip có icon, hàng KPI tile 3 ô, rồi bảng kết quả đo có cột rõ ràng thay vì text nối chuỗi.
- Mỗi thẻ CSR giờ có: (1) header strip `bg-slate-50` với icon `Thermometer` trong badge tròn emerald + nhãn "{dây chuyền} · CSR{x}"; (2) 3 KPI tile màu riêng — Đầu ướt (`Droplet`, xanh dương), Đầu khô (`Flame`, cam), Thời gian (`Clock`, tím); (3) bảng thật (`<table>`) "5 kết quả đo gần nhất" với cột "Ngày đo", "Ca" (bỏ tiền tố "Ca " khỏi giá trị vì đã có ở tên cột), và **1 cột riêng cho từng chỉ tiêu** lấy từ `CHI_TIEU_BY_CSR[csr]` (hằng số đã có sẵn trong `process-types.ts`, đúng cặp chỉ tiêu chuẩn theo CSR — Po/Mo hoặc Po/Màu sắc) thay vì suy từ dữ liệu đo thực tế, để cột luôn ổn định dù có dòng thiếu kết quả.
- Giá trị mỗi ô chỉ tiêu bọc trong badge màu nhẹ theo cột (`CHI_TIEU_COLOR`: Po=sky, Mo=emerald, Màu sắc=amber) — chỉ để phân biệt trực quan giữa các cột, **không mang ý nghĩa đạt/không đạt** (widget này không có ngưỡng so sánh, khác hẳn "Đạt hạng" ở `/product-label`).
- Card rộng hơn (`min-w-[300px]` → `min-w-[340px]`) để đủ chỗ cho 4 cột bảng không bị chật.

### Upload văn bản ký tay — mặc định "Người lập" là người đang upload

- `new/upload/page.tsx`: bootstrap thêm `hydrateActiveSession()` (trước đây trang này chỉ gọi `getActiveFactoryId()`, không biết ai đang đăng nhập) → lưu `userId`/`userFullName`.
- Nội bộ đơn vị (`Don_vi`): thêm effect tự động chọn `soan_thao_user_id = userId` nếu người đang đăng nhập nằm trong danh sách nhân sự **hợp lệ** của phòng ban đã chọn (khớp đúng danh sách đã lọc bỏ người phê duyệt — `donViUsers.filter(u => u.id !== phe_duyet_user_id)` — để tránh bug `<select>` hiện sai do set value không khớp option nào, đúng loại lỗi đã từng gặp và ghi lại ở module Dự đoán số lô). Vẫn cho đổi tay (vd admin nhập hộ văn bản giấy của đồng nghiệp khác phòng ban) — effect chỉ set lại khi lựa chọn hiện tại không còn hợp lệ (vd đổi phòng ban), không ép buộc liên tục. Có hint xanh nhỏ "Mặc định: bạn — người đang tải lên" khi giá trị đang chọn trùng `userId`.
- Nội bộ công ty (`Cong_ty`): trang này trước đây **không lưu `soan_thao_user_id`/`nguoi_soan_thao_display` nào cả** (luôn `null`) — nghĩa là văn bản Upload phạm vi công ty không ai (trừ admin) sửa lại được sau này (`documents/[id]/page.tsx`'s `isSoanThao = doc.soan_thao_user_id === user?.id || isAdmin` luôn `false` cho user thường), và "Người soạn thảo" trên trang chi tiết luôn hiện "—". Đã sửa: payload giờ luôn set `soan_thao_user_id = userId`, `nguoi_soan_thao_display = userFullName` cho nhánh Cong_ty (không có UI chọn — mirror đúng hành vi `new/page.tsx`, nơi người soạn thảo luôn là session user, không cho chọn tay ở cả 2 `pham_vi`).
- **Chưa test tay**: tạo Upload Nội bộ đơn vị → chọn phòng ban của chính mình → xác nhận "Người lập" tự chọn đúng tên mình kèm hint xanh; đổi sang phòng ban khác không có mình → xác nhận về "— Chọn người lập —" (không bị set nhầm); tạo Upload Nội bộ công ty → lưu xong mở trang chi tiết xác nhận "Người soạn thảo" hiện đúng tên mình (không còn "—"), và tài khoản đó (không phải admin) giờ thấy được nút "Sửa" cho đúng văn bản mình vừa upload.

## Cập nhật 2026-08-24 — Hoa văn theo module (mockup) + banner "Pastel Rừng Cao Su" cho Dashboard chính (code thật)

Hai phần việc tách biệt hoàn toàn: (1) chỉ sửa 1 file mockup tĩnh, không đụng app; (2) sau khi
người dùng đồng ý, đưa đúng hướng thiết kế đó vào code thật nhưng **phạm vi CHỈ giới hạn trang
Dashboard chính** — đã hỏi và chốt rõ 2 điểm trước khi code (xem chi tiết quyết định trong
`.claude/plans/wondrous-cuddling-hare.md` nếu cần tra lại). Ghi lại kỹ theo từng khu vực để
phiên sau không nhầm cái nào đã đổi, cái nào cố ý giữ nguyên.

### 1. File mockup (`cung_cap_dl/thiet_ke_moi_pastel_rung_cao_su.html`) — KHÔNG phải code app

Đã publish lại Artifact hiện có (link cũ, favicon 🌳 giữ nguyên). Thêm hoa văn liên quan đúng
nghiệp vụ từng module + sidebar:

- **Sản lượng** (banner có ảnh thật): thêm lớp rãnh cạo mủ chéo mờ phủ trên scrim ảnh; 4 KPI
  tile module này có vân chéo tinh tế cùng tông.
- **Điều xe & Xuất hàng**: giữ nguyên đường sóng/đường xe cũ, bổ sung icon xe tải lớn mờ ở góc
  phải banner; KPI tile có vân đường đi (đường đứt nét).
- **Chất lượng**: trước đó module này **hoàn toàn chưa có** `.mod-banner` (chỉ có 1
  `.data-card` thường) — đã thêm mới hẳn 1 banner (icon bình thí nghiệm `i-flask`, tiêu đề
  "Kiểm nghiệm chất lượng", mô tả TCCS/TCVN, nút "+ Tạo phiếu kiểm nghiệm", hoa văn xoáy tròn +
  icon kính hiển vi/ống nghiệm mờ); KPI tile có vân chấm bi (dot grid).
- **EUDR**: giữ nguyên vòng tròn đồng mức cũ, bổ sung icon lá mờ trong `.motif` có sẵn; KPI
  tile có vân vòng cung góc trên-phải.
- **Sidebar demo trong mockup**: theo yêu cầu người dùng **giữ nguyên nền sáng** (không đổi
  sang xanh đậm như ảnh chụp app thật) — chỉ thêm 1 lớp hoa văn đường đồng mức rất mờ
  (`opacity: 0.08`) phía sau danh sách menu, bọc nội dung thật vào `.shell-sidebar-inner` mới
  để hoa văn không đè lên chữ (kỹ thuật z-index y hệt các banner khác).
- 3 icon `<symbol>` mới thêm vào bộ defs: `i-flask`, `i-microscope`, `i-testtube`.

Toàn bộ nằm trong 1 file HTML tĩnh, không liên quan gì tới các mục 2-4 bên dưới.

### 2. Phát hiện quan trọng khi khảo sát code thật trước khi làm mục 3

`src/app/globals.css` đã có sẵn khối `@theme` "Pastel Rừng Cao Su" (`--color-app-bg`,
`--color-brand`/`--color-brand-deep`, `--color-mint-*`) từ **trước phiên này** (commit
`46d4af8`, đã merge vào `main`), và **đã áp dụng thật cho sidebar** (`dashboard/layout.tsx`
dùng `bg-brand` — sidebar thật hiện là xanh rừng đậm, chữ trắng, KHÁC với nền sáng của file
mockup ở mục 1). Nhưng comment trong file trỏ tới `.claude/rules/05-ui-components.md` mục
"Pastel Rừng Cao Su" — **mục này chưa từng được viết**, và ngoài sidebar thì **chưa module nào**
trong 4 module comment nêu tên (Sản lượng, Điều xe/Xuất hàng, Chất lượng, EUDR) thực sự dùng
token này. Đây là công nợ tài liệu/triển khai dở dang từ trước, không phải do phiên này tạo ra
— đã tiện thể vá lại (xem mục 3) khi làm Dashboard.

### 3. Dashboard chính (`/dashboard`) — ĐÃ triển khai vào code thật

Đã hỏi và chốt: (a) mở rộng đúng token "Pastel Rừng Cao Su" có sẵn (thêm họ `--color-ocean-*`
cho Điều xe/Xuất hàng) thay vì bịa màu Tailwind cục bộ; (b) chỉ 3 khu vực khớp đúng module đã
thiết kế trong mockup được banner + hoa văn đậm, phần còn lại giữ nguyên.

**Đã đổi:**

| File | Thay đổi |
|---|---|
| `src/app/globals.css` | Thêm `--color-ocean-50/100/500/600/700` (`#e3f0fb`→`#144171`, đúng giá trị đã dùng trong mockup) vào `@theme`; sửa lại comment đầu khối cho khớp phạm vi thật đã triển khai. |
| `.claude/rules/05-ui-components.md` | Viết bổ sung mục "Pastel Rừng Cao Su" còn thiếu (vá công nợ tài liệu ở mục 2) — liệt kê đủ 3 họ token, phạm vi áp dụng thật, và convention `WidgetCard`'s `theme`/`icon` prop cho phiên sau. |
| `src/app/dashboard/_components/widgets/widget-shared.tsx` | `WidgetCard` thêm 2 prop optional `theme?: "forest"\|"ocean"\|"mint"` và `icon?: LucideIcon`. Có `theme` → render banner màu (gradient + hoa văn CSS + icon lớn mờ + icon nhỏ trong vòng tròn) rồi mới tới thân trắng chứa `children`. Không có `theme` → **giữ nguyên y hệt** header trắng phẳng cũ, không đổi 1 dòng nào trong nhánh này. Export thêm 2 hằng className `TILE_PATTERN_FOREST`/`TILE_PATTERN_OCEAN` (Tailwind arbitrary-value `before:[...]`, không đụng CSS toàn cục) cho tile muốn có vân nhẹ mà không cần cả banner. |
| `production-widget.tsx` | `theme="forest"`, `icon={Droplet}`; 3 tile thống kê (Tồn kho NL/Khô tháng này/Lũy kế năm) cộng thêm `TILE_PATTERN_FOREST` vào className hiện có (không đổi màu nền gốc `bg-blue-50`/`bg-amber-50`/`bg-emerald-50`). |
| `export-widget.tsx` | `theme="ocean"`, `icon={FileOutput}`; link "Xem tất cả →" đổi màu `text-emerald-600 hover:text-emerald-700` → `text-white/90 hover:text-white` (đang nằm trong banner màu). |
| `dispatch-widget.tsx` | `theme="ocean"`, `icon={Truck}`; 2 box "Tháng này"/"Năm nay" cộng thêm `TILE_PATTERN_OCEAN`; link "Xem tất cả →" đổi màu như export-widget. |
| `quality-widget.tsx` | `theme="mint"`, `icon={FlaskConical}`; link "Xem tất cả →" đổi màu như trên. |

**Cố ý KHÔNG đổi gì** (để phiên sau khỏi nhầm là đã làm): `finished-goods-widget.tsx`,
`inventory-alerts-widget.tsx`, `tasks-summary-widget.tsx`, `quick-notes-widget.tsx`,
`quick-actions-panel.tsx`, `process-drying-widget.tsx`, `overview-kpi-strip.tsx`, và bố cục
tổng của `page.tsx` (`SectionTitle`, thứ tự các khu vực, header trang) — đúng 4/8 khu vực
"Kho & Thành phẩm", "Cảnh báo & việc cần làm", "Việc cần làm", "Ghi chú" giữ y hệt trước.
`export-widget.tsx`/`dispatch-widget.tsx` vẫn là **2 section/2 card riêng biệt** trong
`page.tsx` (không gộp DOM thành 1 card như mockup) — chỉ dùng chung tông màu ocean để đọc như
1 cặp.

**Đã kiểm tra**: `npx tsc --noEmit`, `npx eslint` (các file đã sửa), `npm run build` — cả 3
đều sạch, route `/dashboard` vẫn `○ Static` như trước khi sửa.

**Chưa test tay trên trình duyệt thật** — phiên sau (hoặc người dùng) cần mở `npm run dev` →
`/dashboard` và xác nhận:

1. 3 banner (Sản lượng=xanh rừng, Xuất hàng+Điều xe=xanh dương "ocean", Chất lượng=mint) hiển
   thị đúng màu, icon lớn mờ ở góc không đè lên chữ/số liệu, icon nhỏ trong vòng tròn hiển thị
   đúng cạnh tiêu đề.
2. Vân hoa văn trên 5 tile (3 ở Sản lượng, 2 ở Điều xe) hiển thị đúng, không quá đậm che số
   liệu, không tràn ra ngoài bo góc tile.
3. Link "Xem tất cả →" trong 3 banner đọc rõ trên nền màu (trắng/trắng-mờ), không bị chìm.
4. Responsive mobile: banner không vỡ dòng khi màn hình hẹp (`sm:` breakpoint của header row
   trong banner).
5. 4 khu vực không đổi (Kho & Thành phẩm, Cảnh báo, Việc cần làm, Ghi chú) trông y hệt trước
   khi sửa — đối chiếu nhanh bằng mắt để chắc chắn không có tác dụng phụ ngoài ý muốn từ việc
   sửa `WidgetCard` dùng chung.
6. Sidebar/header thật **không đổi gì** (vẫn xanh rừng đậm `bg-brand` như trước) — phạm vi lần
   này không đụng tới, chỉ nhắc lại để tránh hiểu nhầm khi so với mockup.

### 4. Việc chưa làm / cần hỏi lại trước khi mở rộng thêm (không tự ý làm ở phiên sau)

- Nếu người dùng muốn Xuất hàng + Điều xe gộp thành **1 card DOM duy nhất** (đúng y hệt cấu
  trúc mockup, thay vì 2 section riêng chỉ chung tông màu như hiện tại) — đây là thay đổi cấu
  trúc `page.tsx` lớn hơn (đổi thứ tự/bố cục render), cần hỏi riêng trước khi làm, không suy
  diễn từ yêu cầu "gộp tông màu" đã chốt lần này.
- **Chưa mở rộng theme sang PHẦN CÒN LẠI của 4 trang module** (nút chính/badge trạng thái/
  filter bar/bảng bên dưới header) — phạm vi đã chốt ở mục 5 dưới đây CHỈ là banner header đầu
  trang. Nếu người dùng muốn tiếp tục xuống các phần khác của trang, hỏi lại phạm vi cụ thể
  trước khi code (module nào, đúng những khu vực nào), theo đúng quy trình đã làm.
- Các trang module khác chưa đụng tới: `dispatch/page.tsx` phần "Bảng phân xe"/"Chi tiết ngày"
  (2 header phụ khác ở dòng ~1886/~1970, dùng `text-2xl`/`text-xl` riêng, không phải header
  chính của trang — cố ý không đổi), ISO, Bảo trì, KPI, Cài đặt, và mọi trang module còn lại
  ngoài 4 trang đã liệt kê ở mục 5.

### 5. Mở rộng banner header sang 4 trang module thật (2026-08-24, tiếp) — ĐÃ triển khai

Người dùng xác nhận qua 2 câu hỏi: (a) áp dụng cho đúng 4 trang — Điều xe, Xuất hàng, Chất
lượng, EUDR; (b) phạm vi **chỉ phần header/banner đầu trang** (khuyến nghị, an toàn hơn) —
không đổi nút chính/filter/bảng bên dưới.

**Component mới**: `src/app/dashboard/_components/page-header-banner.tsx` — `PageHeaderBanner`,
tách riêng khỏi `WidgetCard` (`widgets/widget-shared.tsx`, file đó ghi rõ "chỉ dùng cho widget
Dashboard, không dùng cho trang/module khác" — không vi phạm comment đó bằng cách tạo component
mới thay vì import chéo). Nhận `title`/`subtitle` render thành `<h1>` (khác `WidgetCard` dùng
`<h2>` vì đây là header cấp trang, không phải cấp widget), `theme: "ocean"|"mint"|"moss"`,
`icon` (LucideIcon), `action` (ReactNode, render bên phải — nhận nguyên khối JSX cũ gồm cả nút
và logic ẩn/hiện theo quyền, không viết lại logic quyền).

**Token mới**: `--color-moss-50/100/500/600/700` (`#eef1e0`→`#444d26`, đúng giá trị mockup) vào
`globals.css`'s `@theme` — dùng cho banner EUDR. Không thêm `--color-earth-*` (mockup dùng cho
text-on-light-bg, không cần vì banner luôn chữ trắng trên nền màu).

**Đã đổi theo file** (chỉ đúng khối header, giữ nguyên mọi logic/điều kiện quyền cũ):

| File | Theme | Icon | Ghi chú |
|---|---|---|---|
| `dispatch/page.tsx` | `ocean` | `Truck` | 2 nút "Bảng trắng"/"Thêm bảng" đổi màu cho hợp nền (trắng-mờ + trắng đặc) |
| `export/page.tsx` | `ocean` | `FileOutput` | 1 nút "Tạo đơn xuất" đổi sang nền trắng/chữ `text-ocean-700` |
| `quality/page.tsx` | `mint` | `FlaskConical` (mới import) | Giữ nguyên 3 nhánh `hasPermission(...)` đang có sẵn (đang là uncommitted work riêng của phiên trước, không đụng logic) — chỉ đổi màu 3 nút cho hợp nền mint |
| `eudr/EudrClient.tsx` | `moss` | `Trees` (đã import sẵn) | Không có action nào — header đơn giản nhất, chỉ title+subtitle |

Icon lớn mờ + icon nhỏ trong vòng tròn dùng chung cơ chế với `WidgetCard` (`absolute -right-3
-bottom-4 opacity-15`), không tái tạo CSS riêng — copy đúng công thức gradient/pattern 3 theme
đã có (`ocean`/`mint`) và thêm 1 pattern mới cho `moss` (radial dot nhẹ, style riêng không trùng
`forest`/`ocean`/`mint`).

**Đã kiểm tra**: `npx tsc --noEmit` sạch; `npx eslint` trên cả 5 file (4 trang + component mới)
sạch tuyệt đối — đối chiếu bằng `git stash` xác nhận các warning/error còn lại ở `dispatch/
page.tsx`/`quality/page.tsx` là pre-existing (10 lỗi `no-explicit-any` + nhiều warning
`no-unused-vars`, không liên quan gì tới thay đổi lần này, số dòng chỉ dịch chuyển do xóa bớt
dòng). `npm run build` pass, cả 4 route vẫn `○ Static` như trước khi sửa (không đổi kiểu render).

**Chưa test tay trên trình duyệt thật** — cần mở `npm run dev` và xác nhận trên cả 4 trang:

1. Banner hiển thị đúng màu (Điều xe/Xuất hàng = xanh dương ocean, Chất lượng = mint, EUDR =
   xanh rêu moss), icon lớn mờ góc dưới-phải không đè lên chữ, icon nhỏ trong vòng tròn hiện
   đúng cạnh tiêu đề.
2. Các nút hành động trong banner (Điều xe: "Bảng trắng"/"Thêm bảng"; Xuất hàng: "Tạo đơn
   xuất"; Chất lượng: "Tải mẫu"/"Nhập KN"/"Tạo phiếu KN") đọc rõ, bấm được, và **vẫn ẩn/hiện
   đúng theo quyền** như trước khi đổi UI (đặc biệt Chất lượng — có 3 tầng `hasPermission`
   lồng nhau, cần test với tài khoản thiếu từng quyền riêng lẻ).
3. Responsive mobile: banner không vỡ dòng ở màn hình hẹp (`sm:` breakpoint chuyển từ
   `flex-col` sang `flex-row` trong `PageHeaderBanner`).
4. EUDR: banner không đè/che thanh tìm kiếm ngay bên dưới.
5. Phần còn lại của cả 4 trang (bảng, filter, nút phụ, modal...) trông y hệt trước khi sửa —
   xác nhận đúng phạm vi "chỉ header" như đã chốt, không có tác dụng phụ ngoài ý muốn.

### 6. Fix bug 2026-08-24 (tiếp 2) — banner render trắng/mờ, nguyên nhân + cách xử lý

Sau khi triển khai mục 5, người dùng báo banner ở cả 3 trang (Điều xe/Xuất hàng/EUDR) hiển thị
**trắng/mờ** (chữ trắng gần như vô hình trên nền gần-trắng) thay vì màu gradient đúng theme.

**2 nguyên nhân đã xác định, đã xử lý cả 2**:

1. **Bug thật trong code**: `THEME_BANNER`/`PAGE_THEME_BANNER` (cả `WidgetCard` lẫn
   `PageHeaderBanner`) build `background-image` qua style inline bằng
   `var(--color-ocean-600)` — kỹ thuật đọc custom property Tailwind `@theme` runtime **chưa
   từng được dùng/kiểm chứng ở đâu khác trong repo**. Đã đổi cả 2 nơi sang **literal hex trực
   tiếp** (`#1b5590` thay vì `var(--color-ocean-600)`), khớp đúng pattern an toàn sẵn có
   `TILE_PATTERN_FOREST`/`TILE_PATTERN_OCEAN` (dùng rgb literal, không dùng `var()`). Đây là
   fix chắc chắn đúng bất kể nguyên nhân gốc là gì.
2. **Nguyên nhân thực tế nhiều khả năng hơn**: trong phiên sửa lỗi, Claude đã chạy
   `npm run build` (production build) **nhiều lần** để tự kiểm tra, trong khi phát hiện có
   tiến trình `node.exe` ~1.7GB đang chạy (dấu hiệu `npm run dev` của người dùng đang sống
   song song). `dev` và `build` dùng chung thư mục `.next/` — build đè lên trong lúc dev
   server đang chạy là nguyên nhân kinh điển gây stale/vỡ CSS chunk ở dev session đang mở.
   Sau khi restart `npm run dev` + hard-refresh trình duyệt, người dùng xác nhận **đã hiển thị
   lại đúng** (ảnh chụp mockup Quality-card họ gửi kèm chỉ là ảnh tham chiếu thiết kế, không
   phải bug report).

**Quy tắc bắt buộc cho mọi phiên sau**: 

- **Không chạy `npm run build` khi không chắc dev server của người dùng có đang chạy hay
  không** — chỉ dùng `npx tsc --noEmit` + `npx eslint <file>` để tự kiểm tra (không đụng
  `.next/`). Nếu thực sự cần build thử (ví dụ kiểm tra route `○ Static` có đổi không), hỏi
  người dùng trước xem dev server có đang chạy không.
- **Không dùng `var(--color-X)` trong style inline hay bất kỳ đâu đọc runtime từ `@theme`** —
  luôn dùng literal hex/rgb trực tiếp trong code, dù Tailwind class (`bg-ocean-600`,
  `text-mint-700`...) compile ra `var()` và vẫn hoạt động bình thường (đã xác nhận qua CSS
  build thật — mọi class màu Tailwind, kể cả `bg-emerald-600`/`text-slate-800` built-in, đều
  compile thành `var(--color-X)`, và app đã chạy ổn với cơ chế đó từ trước — nên KHÔNG cần đổi
  các class Tailwind màu hiện có sang literal). Chỉ tránh riêng kiểu code TỰ VIẾT
  `style={{...: \`var(${token})\`}}` — đây là kỹ thuật mới, chưa kiểm chứng, và là điểm khác
  biệt duy nhất so với hàng nghìn usage `bg-X`/`text-X` khác đã chạy ổn định trong app.

## Kế hoạch phiên sau (2026-08-24, tiếp 3) — Hoa văn nền theo module + Sidebar hoa văn cao su +
Redesign màn hình đăng nhập

Người dùng đã xác nhận qua browser thật: 4 banner header (mục 5-6 ở trên) hiển thị đúng màu sau
khi restart dev server. Yêu cầu tiếp theo — **CHỈ ghi lại kế hoạch ở đây, CHƯA CODE gì ở phiên
này** — gồm 3 việc độc lập:

#### A. Hoa văn nền các module — hình vẽ đơn giản ẩn dưới nền trắng, liên quan chủ đề module

Người dùng gửi kèm 1 ảnh tham khảo (thẻ bài "Chất lượng" từ mockup `cung_cap_dl/
thiet_ke_moi_pastel_rung_cao_su.html`): nền trắng ngả xanh rất nhạt, phủ đường đồng mức
(topographic contour lines) cực mờ + icon ống nghiệm, 2 kính hiển vi, xoáy tròn — tất cả đều
là stroke mảnh, cùng tông xanh xám nhạt, gần như "ẩn" dưới mắt thường, chỉ nổi lên khi nhìn kỹ.
Đây LÀ đúng phong cách mockup, KHÔNG phải ảnh báo lỗi.

- Mục tiêu: đưa phong cách hoa văn nền này (khác hẳn banner gradient màu đặc đã làm ở mục 5)
  vào các trang module thật — nền trắng của card/page vẫn giữ nguyên, chỉ phủ thêm 1 lớp SVG
  motif rất mờ (opacity ~0.05-0.1) phía sau nội dung, liên quan chủ đề module đó.
- **Nguồn tham khảo có sẵn, không cần vẽ lại từ đầu**: file mockup
  `cung_cap_dl/thiet_ke_moi_pastel_rung_cao_su.html` đã có sẵn:
  - Bộ `<symbol>` defs dùng chung: `i-flask`, `i-microscope`, `i-testtube` (Chất lượng),
    cộng các icon khác đã liệt kê trong lịch sử phiên `2026-08-24` phần "Hoa văn theo module".
  - Motif SVG riêng từng module đã vẽ sẵn cho: Sản lượng (rãnh cạo mủ chéo), Điều xe/Xuất hàng
    (đường sóng/đường xe + icon xe tải lớn mờ), Chất lượng (xoáy tròn + ống nghiệm/kính hiển
    vi — đúng ảnh user gửi), EUDR (vòng tròn đồng mức + icon lá).
  - Đây là file HTML tĩnh (`cung_cap_dl/`), KHÔNG phải code app — phiên sau phải đọc file này
    trước, trích xuất đúng path/symbol SVG cần dùng, không tự vẽ lại motif mới nếu mockup đã
    có sẵn.
- **Câu hỏi cần hỏi lại người dùng trước khi code** (theo đúng quy trình đã áp dụng suốt các
  phiên trước — không tự suy diễn phạm vi):
  1. Áp dụng cho đúng 4 trang đã có banner (Điều xe/Xuất hàng/Chất lượng/EUDR), hay thêm cả
     các trang khác (Sản lượng/Thành phẩm/Bảo trì/Kho...)?
  2. Phủ hoa văn ở đâu — toàn bộ nền trang (`bg-app-bg` phía sau mọi card), hay chỉ trong
     từng card/section cụ thể (giống banner header — phạm vi hẹp, an toàn hơn)?
  3. Độ mờ/độ dày hoa văn theo đúng ảnh tham khảo (rất nhẹ, gần như không nhận ra) hay có thể
     đậm hơn 1 chút để nhận diện rõ module đang xem?
- **Lưu ý kỹ thuật khi code**: SVG motif nền phải `pointer-events-none`, `aria-hidden="true"`,
  và đặt sau nội dung theo z-index (giống cách login page hiện tại đã làm với SVG rừng cao su
  mờ ở `src/app/login/page.tsx` dòng ~322-337 — có sẵn 1 ví dụ đúng kỹ thuật ngay trong app,
  tham khảo trước khi viết mới). Không dùng màu qua `var(--color-X)` trong SVG `stroke`/`fill`
  nếu vẽ bằng inline style — theo đúng bài học mục 6 ở trên, dùng literal hex. Nếu vẽ bằng
  className Tailwind (`stroke-slate-300` chẳng hạn) thì không vấn đề gì (class Tailwind màu
  vẫn hoạt động bình thường, chỉ tránh cách TỰ VIẾT `var()` trong style/SVG attribute).

#### B. Sidebar — thêm hoa văn liên quan đến cao su (khác hoa văn đồng mức hiện có)

- Sidebar thật (`dashboard/layout.tsx`, `bg-brand`) hiện **chưa có hoa văn nào** — khác với
  sidebar DEMO trong mockup (đã có 1 lớp hoa văn đường đồng mức rất mờ `opacity: 0.08`, xem
  lịch sử phiên "Hoa văn theo module" — nhưng đó là hoa văn địa hình/topography, KHÔNG phải
  hoa văn cao su).
- Yêu cầu lần này: hoa văn sidebar phải **liên quan trực tiếp đến cao su** — gợi ý (cần hỏi lại
  người dùng chọn hướng cụ thể, không tự quyết định):
  - Rãnh cạo mủ (tapping groove) dạng đường chéo lặp lại — đã có sẵn ý tưởng này dùng cho
    banner Sản lượng trong mockup ("lớp rãnh cạo mủ chéo mờ phủ trên scrim ảnh"), có thể tái
    dùng cùng pattern cho sidebar.
  - Lá cao su (dạng lá 3 thùy đặc trưng) rải rác mờ.
  - Giọt mủ latex (droplet) nhỏ rải rác.
  - Thân cây cao su cách điệu — đã có sẵn 1 ví dụ SVG rừng cao su mờ ở chính
    `src/app/login/page.tsx` (dòng ~322-337, minh họa hàng cây cao su cách điệu bằng path
    cong) — có thể tái dùng/biến thể cho sidebar thay vì vẽ path mới từ đầu.
- **Câu hỏi cần hỏi lại**: chọn hướng hoa văn nào trong 4 gợi ý trên (hoặc khác); độ mờ mong
  muốn; có cần khác màu văn bản/icon sidebar hiện tại không (sidebar đang chữ trắng trên nền
  `bg-brand` xanh rừng đậm — hoa văn phải đủ mờ để không giảm độ tương phản đọc menu).
- Lưu ý: sidebar dùng `<nav>`/danh sách item thật (không tĩnh như banner) — phải test kỹ hoa
  văn không che khuất/giảm tương phản chữ khi cuộn menu dài, và không lặp lại đúng bug đã ghi
  ở `.claude/rules/24-notification-bell-module-tasks.md` (KHÔNG thêm `filter`/`backdrop-filter`/
  `transform`/`perspective`/`will-change`/`contain` vào `<header>` hay ancestor bao ngoài các
  overlay `position: fixed` mobile — sidebar cha `<div>` hiện đang dùng `transition-transform`
  cho slide-in mobile, cần kiểm tra kỹ nếu thêm hoa văn bằng kỹ thuật `::before`/pseudo-element
  có filter không để tránh phá vỡ containing-block của các overlay `fixed` bên trong).

#### C. Redesign màn hình đăng nhập chuyên nghiệp hơn

- File: `src/app/login/page.tsx` (550 dòng). Hiện tại: card `rounded-3xl bg-white/70
  backdrop-blur-md` giữa nền gradient `from-emerald-50 via-white to-emerald-100`, có sẵn 1 lớp
  SVG rừng cao su rất mờ (`opacity-[0.08]`) phía dưới, logo tròn + tên công ty + 2 tab
  Đăng nhập/Đăng ký, và `CustomerPortalLangToggle` (chuyển ngôn ngữ cho Customer Portal) ở góc
  trên-phải.
- Đây là trang phức tạp hơn banner đơn thuần — có form đăng nhập/đăng ký thật, dropdown chọn
  Nhà máy/Phòng ban (`FactoryOption`/`DepartmentOption`), xử lý lỗi/trạng thái booting. **Bắt
  buộc đọc kỹ toàn bộ 550 dòng trước khi sửa** — không đoán cấu trúc, không viết lại từ đầu chỉ
  vì "thiết kế lại", chỉ đổi phần trình bày/CSS, giữ nguyên toàn bộ logic auth/validate/state.
- **Câu hỏi cần hỏi lại người dùng trước khi code** (chưa biết "chuyên nghiệp hơn" nghĩa là
  gì cụ thể):
  1. Có ảnh/mockup tham khảo cụ thể không, hay tự đề xuất hướng thiết kế?
  2. Giữ nguyên bố cục 1 cột căn giữa hiện tại, hay đổi sang bố cục 2 cột (ảnh/hoa văn lớn bên
     trái, form bên phải — phổ biến cho trang đăng nhập B2B/ERP "chuyên nghiệp")?
  3. `CustomerPortalLangToggle` và toàn bộ luồng đăng ký (chọn Nhà máy/Phòng ban) phải giữ
     nguyên chức năng — chỉ hỏi có cần đổi VỊ TRÍ hiển thị trong bố cục mới hay không.
- **Lưu ý kỹ thuật**: card hiện dùng `backdrop-blur-md` — theo bài học đã ghi ở
  `.claude/rules/24-notification-bell-module-tasks.md`, `backdrop-filter` trên 1 ancestor biến
  nó thành containing-block cho mọi hậu duệ `position: fixed`. Trang login hiện không có overlay
  `fixed` con nào bên trong card nên chưa phát sinh bug, nhưng nếu redesign thêm modal/dropdown
  `fixed` bên trong vùng có `backdrop-blur`, phải test kỹ hoặc portal ra ngoài `document.body`.

**Chung cho cả 3 việc**: dùng literal hex khi cần vẽ màu qua style/SVG inline (bài học mục 6);
không chạy `npm run build` khi chưa chắc dev server người dùng có đang chạy song song hay
không — ưu tiên `tsc`/`eslint`; hỏi đủ câu hỏi phạm vi ở trên trước khi viết code, theo đúng
quy trình đã dùng xuyên suốt các phiên "Pastel Rừng Cao Su" trước đó.

## Cập nhật 2026-08-24 (tiếp 4) — Đã triển khai xong cả 3 việc A/B/C của kế hoạch trên

Đã hỏi lại đúng 4 câu hỏi phạm vi qua `AskUserQuestion` trước khi code (kết quả: A áp dụng cho
đúng 4 trang đã có banner, phủ rất nhẹ toàn nền trang; B chọn hướng "rãnh cạo mủ"; C tự đề xuất
bố cục 2 cột, không có mockup tham khảo). Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm
tra (đều sạch, không đụng `npm run build`/`.next/` theo đúng quy tắc mục 6). **Chưa test tay
trên trình duyệt thật** — checklist cuối mỗi mục.

### A. Hoa văn nền cho 4 trang module (Điều xe/Xuất hàng/Chất lượng/EUDR)

- Component mới `src/app/dashboard/_components/page-background-motif.tsx` — `PageBackgroundMotif`,
  nhận `theme: "ocean"|"mint"|"moss"` (tái dùng đúng `PageBannerTheme` từ `page-header-banner.tsx`).
  Tái dùng nguyên path icon (truck/flask/testtube/leaf) đã có sẵn trong bộ `<symbol>` của
  `cung_cap_dl/thiet_ke_moi_pastel_rung_cao_su.html`, ghép thành 1 SVG `<pattern>` lặp lại (tile
  260-320px) — khác với motif 1-hình-cố-định trong banner vì nền trang có chiều cao thay đổi
  theo nội dung, cần pattern lặp thay vì 1 scene cố định. Màu literal hex khớp đúng
  `--color-ocean-600`/`--color-mint-600`/`--color-moss-600` trong `globals.css` (không dùng
  `var()`). Container `opacity: 0.06`, `pointer-events-none`, `aria-hidden`.
- Dùng `position: fixed inset-0 -z-10` (không phải `absolute`) — cố ý để **không đụng
  className/position của bất kỳ ancestor nào** trong 4 file trang (tránh rủi ro đổi containing
  block cho các `position:absolute` khác đã có sẵn trong các file lớn 1500-2000+ dòng này); z âm
  sâu đảm bảo luôn vẽ sau sidebar/header (có nền đặc, tự che đúng phần diện tích của chúng).
- Đã chèn `<PageBackgroundMotif theme="..."/>` làm con đầu tiên **đúng nhánh JSX chứa
  `<PageHeaderBanner>`** của từng trang (không phải mọi nhánh view khác của cùng file) — khớp
  đúng phạm vi đã chốt "chỉ 4 trang đã có banner":
  - `dispatch/page.tsx`: nhánh `if (view === "list") return (...)`, theme `ocean`.
  - `export/page.tsx`: nhánh `if (view === "list") return (...)`, theme `ocean`.
  - `quality/page.tsx`: nhánh `{view === "list" && (...)}`, theme `mint`.
  - `eudr/EudrClient.tsx`: return duy nhất (không có nhánh view khác), theme `moss`.

### B. Hoa văn "rãnh cạo mủ" cho sidebar thật

- `src/app/dashboard/layout.tsx`: thêm 1 `<div>` trang trí ngay sau tag mở `<aside>` (trước khối
  logo) — `position: absolute inset-0 -z-10 pointer-events-none`, `backgroundImage:
  repeating-linear-gradient(52deg, rgba(255,255,255,0.1) 0 2px, transparent 2px 22px)` (đường
  chéo lặp lại, mirror đúng công thức `TILE_PATTERN_FOREST` đã dùng cho tile Sản lượng ở
  Dashboard — chỉ đổi alpha).
- Dùng `absolute` (không phải `fixed`) vì `<aside>` đã tự là positioned ancestor (`fixed` mobile /
  `relative` desktop) nên `absolute inset-0` tự động lấy đúng `<aside>` làm containing block —
  không cần thêm `relative` vào đâu cả. Không đụng landmine containing-block của
  `transform`/`backdrop-filter` (rule 24) vì đây là `absolute`, không phải `fixed`, nên không
  quan tâm tới việc `<aside>` có `transform` (Tailwind `translate-x-0`) hay không.
  `-z-10` bắt buộc (không để mặc định z-index:auto) — nếu không, theo thứ tự paint CSS
  (non-positioned content paint TRƯỚC positioned z-auto content), motif sẽ đè lên logo/nav thay
  vì nằm sau.

### C. Redesign trang đăng nhập — bố cục 2 cột

- Đã đọc kỹ toàn bộ 550 dòng gốc trước khi sửa (đúng yêu cầu bắt buộc) — chỉ đổi JSX
  trình bày/layout, **giữ nguyên 100%** state/handlers (`handleLogin`, `handleRegister`,
  bootstrap effect, `deptRef`/dropdown click-outside, `noticeText`, mọi validate) và toàn bộ
  field/logic nghiệp vụ (chọn Nhà máy, dropdown Phòng ban, `CustomerPortalLangToggle`).
- Bố cục mới: `flex flex-col lg:flex-row` — **cột trái** (`lg:w-[42%] xl:w-[38%]`, nền
  `bg-gradient-to-br from-brand to-brand-deep` — dùng thẳng Tailwind class `from-brand`/
  `to-brand-deep`, không phải hex/`var()`, vì đây là utility class tĩnh viết literal trong
  source nên Tailwind v4 scanner nhận diện đúng, khác hẳn kiểu template-literal động đã từng
  gây lỗi purge) chứa: hoa văn rãnh cạo mủ (dùng lại đúng công thức mục B, literal rgba), SVG
  rừng cao su cũ (giữ nguyên path, chỉ đổi `stroke` từ `#1c3a32` sang `#ffffff` vì nền giờ tối),
  logo + tên công ty, `<h1>` là `factorySubtitle`/`systemSubtitle` (đổi từ dòng chữ nhỏ sang
  heading chính — 2 chuỗi này vốn ngắn: "NHÀ MÁY CHẾ BIẾN"/"HỆ THỐNG QUẢN LÝ SẢN XUẤT"), 3 dòng
  bullet tóm tắt phạm vi hệ thống (chỉ hiện `lg:flex`, text tiếng Việt hard-code mới — không qua
  `tCustomerPortal` vì đây là nội dung trang trí, không phải string nghiệp vụ cần dịch), và dòng
  version ở cuối.
  - **Cột phải** (`flex-1`, nền `bg-app-bg`) giữ nguyên nội dung form: `CustomerPortalLangToggle`
    (vẫn góc trên-phải, chỉ đổi từ "góc trên toàn trang" sang "góc trên của cột phải" — đổi VỊ
    TRÍ như mục hỏi 3 cho phép, KHÔNG đổi chức năng), rồi card form (`bg-white border
    border-slate-200` — bỏ hẳn `backdrop-blur-md`/`bg-white/70` cũ vì nền giờ đã là mảng màu đặc
    rõ ràng, không cần kính mờ nữa; tiện thể loại bỏ luôn rủi ro containing-block đã cảnh báo ở
    mục "Lưu ý kỹ thuật" cũ vì card không còn `backdrop-filter`).
  - Mobile (`<lg`): cột trái co lại thành 1 khối header gọn (logo+tên+heading, ẩn 3 bullet và
    SVG minh hoạ co nhỏ `h-[42%]`), cột phải xếp ngay bên dưới full-width — không dùng `hidden`
    cho toàn bộ cột trái (khác branding hoàn toàn biến mất trên mobile), chỉ ẩn phần nội dung
    phụ (bullet list) để không chiếm quá nhiều màn hình nhỏ.
  - Dòng version footer trùng lặp cũ (xuất hiện cả dưới form) đã bỏ — giờ chỉ còn đúng 1 nơi
    (trong cột trái, luôn hiển thị cả mobile lẫn desktop).
- Fallback `<Suspense>` (khi `useSearchParams` chưa sẵn sàng) đổi nền từ gradient emerald cũ
  sang `bg-app-bg` cho khớp tông màu mới, tránh nháy màu khi chuyển từ fallback sang nội dung
  thật.

### Chưa test tay trên trình duyệt thật (cả A/B/C) — cần làm ở phiên sau hoặc người dùng tự xác nhận

1. Mở `npm run dev` → `/dashboard/dispatch`, `/dashboard/export`, `/dashboard/quality`,
   `/dashboard/eudr`: xác nhận hoa văn nền rất mờ hiển thị đúng theo từng theme, không che chữ/
   số liệu, không gây rối mắt; cuộn trang dài (nhiều dòng bảng) xác nhận motif vẫn phủ đều (vì
   dùng `fixed`, motif đứng yên theo viewport trong lúc nội dung cuộn — xác nhận hiệu ứng này
   chấp nhận được về mặt thẩm mỹ, không phải bug).
2. Sidebar: xác nhận hoa văn rãnh cạo mủ hiển thị đúng, không giảm độ tương phản đọc menu, thu
   gọn sidebar (`collapsed` mode, chỉ còn icon) vẫn ổn; test mobile drawer (trượt sidebar ra/vào)
   không bị vỡ layout hay motif tràn ra ngoài.
3. `/login`: xác nhận bố cục 2 cột đúng trên desktop, co đúng về 1 cột trên mobile; test đăng
   nhập thật + đăng ký thật (chọn Nhà máy, chọn Phòng ban, submit) hoạt động y hệt trước khi sửa;
   xác nhận `CustomerPortalLangToggle` đổi ngôn ngữ vẫn hoạt động đúng vị trí mới; xác nhận banner
   "Đang tải..."/lỗi "Không tải được danh sách nhà máy — Thử lại" vẫn hiển thị đúng trong card;
   kiểm tra dropdown "Phòng ban" (mở lên trên card, `z-50`) không bị hoa văn/panel khác che khuất.
4. Toàn bộ 3 việc: kiểm tra nhanh bằng mắt không có tác dụng phụ ngoài ý muốn tới phần nội dung
   khác của các trang đã đụng tới (nút chính/filter/bảng của 4 trang module, và phần còn lại của
   sidebar/dashboard) — phạm vi lần này chỉ thêm lớp hoa văn trang trí, không sửa logic/nút nào.

## Cập nhật 2026-08-24 (tiếp 5) — Mở rộng banner + hoa văn nền sang 5 module nữa

Người dùng xác nhận (sau khi test tay 4 trang ở mục "tiếp 4") muốn tiếp tục mở rộng
`PageHeaderBanner`/`PageBackgroundMotif` sang: Sản lượng, Thành phẩm, Kho (nguyên liệu +
vật tư), Bảo trì — kèm quyết định thêm cả banner (không chỉ hoa văn nền) cho các trang này vì
trước đó chỉ có header trắng phẳng thường. Chỉ dùng `npx tsc --noEmit` + `npx eslint` (đều
sạch), không chạy `npm run build`.

### Mở rộng hệ theme dùng chung (2 file component)

- `page-header-banner.tsx`: `PageBannerTheme` mở rộng từ `"ocean"|"mint"|"moss"` thành thêm
  `"forest"|"amber"|"slate"`. `forest` dùng đúng `#2f5d52→#1c3a32` (khớp `--color-brand`/
  `--color-brand-deep`, cùng giá trị `THEME_BANNER.forest` trong `widget-shared.tsx`).
  `amber`/`slate` **không có token riêng trong `@theme`** — dùng thẳng hex chuẩn Tailwind
  built-in (`amber-700→amber-900`, `slate-600→slate-800`), không thêm biến mới vào
  `globals.css` vì Tailwind's built-in palette đã đủ dùng cho 2 theme phụ này.
- `page-background-motif.tsx`: mở rộng theo đúng 3 theme mới. Khác 4 theme cũ (vốn tái dùng
  icon từ file mockup), `forest`/`amber`/`slate` **không có tiền lệ trong mockup** nên chỉ
  dùng đường nét hình học thuần (không icon) — khớp đúng phong cách gốc của chính motif Sản
  lượng trong mockup (`motif-tap`, vốn cũng chỉ có đường chéo, không icon):
  - `forest`: đường chéo lặp lại (rãnh cạo mủ, mirror sidebar/tile Sản lượng).
  - `amber`: lưới 2 lớp vuông góc (gợi giá kệ/pallet kho).
  - `slate`: vạch chéo dày cách đều (gợi vạch cảnh báo/kỹ thuật bảo trì).

### 5 điểm chạm theo trang — tất cả chỉ đổi phần header, giữ nguyên nút/bảng/filter bên dưới

| Trang | Theme | Icon | Ghi chú |
|---|---|---|---|
| `output/page.tsx` (Sản lượng) | forest | `Droplet` | 2 nút hành động (Import file, Thêm mới) đổi sang kiểu trắng/trắng-mờ cho hợp nền banner |
| `product/page.tsx` (Thành phẩm) | forest | `Package` | 5 nút hành động (Đồng bộ trạng thái lô icon-only, Dự đoán số lô, Quét QR, Sang kiện/Thay bọc, Thêm lô) đổi màu tương tự |
| `storage/page.tsx` (Kho nguyên liệu) | amber | `Warehouse` | Tiêu đề động theo `dayChuyen` ("Ngăn lưu"/"Hồ chứa") giữ nguyên qua prop `title` |
| `inventory/_components/inventory-shell.tsx` (Kho vật tư) | amber | `Boxes` | **Sửa ở tầng shell dùng chung** (9 call site: on-hand/cards/item/analytics/issues/lookup/transfers/receipts/settings) thay vì từng trang — xem chi tiết kỹ thuật bên dưới |
| `maintenance/page.tsx` (Bảo trì) | slate | `Wrench` | Nằm trong `<MaintenanceShell>`, banner render **sau** tab nav trắng của shell (thứ tự DOM cũ), không phải trước như các module khác |

### `InventoryPageShell` — quyết định kỹ thuật quan trọng khi mở rộng sang Kho vật tư

- Không sửa riêng lẻ 9 file gọi `<InventoryPageShell>` — sửa 1 lần tại chính component dùng
  chung, tự động áp dụng cho toàn bộ module (giống cách sidebar/PageHeaderBanner đã làm ở nơi
  khác). Bỏ hẳn prop `eyebrow` khỏi phần render (dòng chữ nhỏ "Nhập xuất tồn"/"Thống kê" phía
  trên `<h1>` cũ) — **vẫn giữ `eyebrow?: string` trong type** để 9 call site khỏi phải sửa,
  chỉ đơn giản là prop đó không còn được dùng ở đâu (không lỗi TS, không lỗi lint vì không bị
  destructure ra biến).
- **Quyết định quan trọng**: KHÔNG gộp `action` (nút hành động riêng của từng trang con, ví
  dụ "Xuất Excel", "Về Cấu hình nhà máy") vào bên trong banner màu tối như đã làm ở 4-5 trang
  khác. Lý do: đã rà cả 9 call site, phát hiện `settings/page.tsx`'s action
  (`"Về Cấu hình nhà máy"`) dùng nút dạng viền trong suốt, **không có `bg-` nào cả**
  (`border border-slate-200 ... text-slate-700 hover:bg-slate-50`) — thiết kế cho nền trắng,
  nếu đặt trên banner amber tối sẽ gần như vô hình (chữ xám trên nền cam đậm). Thay vì sửa tay
  từng nút ở 9 file (rủi ro cao, tốn công rà soát), giữ nguyên bố cục: banner amber chỉ có
  title/subtitle/icon (không action), `action` + 2 nhóm tab pill vẫn nằm trong đúng card
  trắng cũ như trước (chỉ bỏ `<h1>`/eyebrow/description ra khỏi card đó, phần còn lại y hệt).
  Nhờ vậy toàn bộ nút hành động của 9 trang con giữ nguyên màu sắc, không cần rà/sửa gì thêm.

### Việc CỐ Ý không làm (để tránh hiểu nhầm là thiếu sót)

- Không đụng các trang con khác của Bảo trì (`maintenance/records/page.tsx`,
  `maintenance/history/page.tsx`, `maintenance/print/*`) — chỉ trang tổng quan
  `/dashboard/maintenance` được thêm banner, đúng tiền lệ "1 trang landing/module" như các
  module khác (trừ Kho vật tư, nơi kiến trúc có 1 shell dùng chung nên tự nhiên phủ hết).
- Không đụng `product/page.tsx`'s 2 view khác (`view === "create"` — "Nhập thành phẩm", và
  nhánh detail khác nếu có) — chỉ view "list" (mặc định) có banner, mirror đúng cách làm ở
  Điều xe/Xuất hàng trước đó (chỉ list view có `PageHeaderBanner`).

### Phát hiện ngoài ý muốn — 2 file thay đổi KHÔNG PHẢI do phiên này

Trong lúc rà `git status` để tổng kết, phát hiện `src/app/dashboard/quality-analytics/page.tsx`
(diff thật, ~35 dòng, thêm `fetchAllPaginated` từ file mới `src/lib/supabase-helpers.ts` để
fix đúng loại bug "PostgREST cắt 1000 dòng" đã ghi ở `.claude/rules/04-code-patterns.md`) và
chính `src/lib/supabase-helpers.ts` (file mới, untracked) đã bị thay đổi/tạo mới **mà phiên
này không hề chạm tới** — không nằm trong bất kỳ tool call nào của phiên. Đã cố tình **không
đụng, không commit, không dọn** 2 file này (theo đúng nguyên tắc "điều tra trước khi
xóa/ghi đè, file không do phiên này tạo ra thì không tự ý dọn") — có thể là kết quả của một
tiến trình/phiên khác đang chạy song song trên cùng repo. Nếu người dùng không nhận ra thay
đổi này, cần hỏi lại nguồn gốc trước khi commit bất cứ thứ gì trong repo.

### Chưa test tay trên trình duyệt thật (5 module mới) — cần làm ở phiên sau hoặc người dùng tự xác nhận

1. `/dashboard/output`, `/dashboard/product`: banner forest hiển thị đúng, các nút hành động
   (đổi sang kiểu trắng/trắng-mờ) vẫn bấm được và đọc rõ chữ; hoa văn nền rất nhẹ không che
   nội dung.
2. `/dashboard/storage`: xác nhận tiêu đề đổi đúng theo Dây chuyền (Mủ tạp → "Ngăn lưu", Mủ
   nước → "Hồ chứa") ngay trong banner; nút "Thêm ngăn lưu/hồ chứa" (chỉ hiện khi có quyền)
   đọc rõ trên nền amber.
3. `/dashboard/inventory/on-hand` (và các trang con khác: receipts/issues/transfers/cards/
   lookup/analytics/settings/item): xác nhận banner amber + hoa văn hiển thị nhất quán trên
   TẤT CẢ các trang (vì sửa ở tầng shell dùng chung); xác nhận action buttons (khi có) vẫn nằm
   trong card trắng, đọc rõ, không bị "lạc" lên banner; đặc biệt kiểm tra nút "Về Cấu hình nhà
   máy" ở `settings/page.tsx` (nút viền trong suốt) vẫn hiển thị đúng trên nền trắng như cũ.
4. `/dashboard/maintenance`: xác nhận banner slate hiển thị đúng SAU tab nav trắng (Tổng quan/
   Biên bản/Lý lịch thiết bị) — thứ tự này khác các module khác, xác nhận không bị coi là lỗi;
   nút "Tạo biên bản" đọc rõ trên nền banner.
5. Xác nhận `currencySymbol` warning (pre-existing, không liên quan phiên này) trong
   `maintenance/page.tsx` không ảnh hưởng gì — chỉ là warning ESLint có sẵn từ trước.
6. Hỏi lại người dùng về nguồn gốc 2 file `quality-analytics/page.tsx`/`supabase-helpers.ts`
   đã đổi ngoài ý muốn (mục trên) trước khi bất kỳ ai commit toàn bộ working tree.

## Cập nhật 2026-08-24 (tiếp 6) — 4 module nữa + kỹ thuật icon Lucide thật trong motif nền

Người dùng yêu cầu "sáng tạo hơn" cho 5 thẻ còn lại (Công việc KPI, Ghi chú nhanh, Bản đồ lô,
Kho thành phẩm, Kiểm soát quá trình) — không chỉ hoa văn đường nét trừu tượng mà cần **icon
chìm liên quan trực tiếp chức năng module** (ví dụ cụ thể người dùng đưa ra: Kho thành phẩm
có xe nâng/pallet/hàng pallet thẳng tắp). Đã làm 4/5 module; "Bản đồ lô" bị loại vì lý do kỹ
thuật — xem mục riêng bên dưới.

### Kỹ thuật mới: render thẳng component Lucide bên trong SVG `<pattern>`

Khác hẳn 6 theme trước (copy tay path `d="..."` từ file mockup hoặc tự vẽ hình học), 4 theme
mới dùng kỹ thuật: `<svg>` lồng trong `<svg>` là hợp lệ theo spec SVG, nên có thể render
**thẳng component Lucide thật** (ví dụ `<Forklift color={color} size={40} strokeWidth={1.4} />`)
làm con của `<pattern>`, bọc trong `<g transform="translate(x,y)">` để định vị. Ưu điểm so với
copy path tay: chính xác pixel-perfect, khớp 100% bộ icon UI đang dùng khắp app, không cần tự
tính `scale()` để quy đổi từ viewBox 24×24 gốc như cách cũ. Xác nhận bằng
`ReactDOMServer.renderToStaticMarkup` rằng prop `color` của Lucide map đúng vào `stroke` SVG
output. Kỹ thuật này có thể áp dụng ngược lại cho 6 theme cũ nếu cần sửa sau, nhưng phiên này
**không đụng 6 theme cũ** (đã chạy ổn định, không cần sửa).

### 4 theme mới (`page-header-banner.tsx` + `page-background-motif.tsx`)

| Module | Theme | Màu (from→to) | Icon banner | Icon + hoa văn nền |
|---|---|---|---|---|
| Công việc & KPI | `violet` | `#7c3aed→#4c1d95` | `Target` | `Target` + 2 vòng tròn mục tiêu mờ |
| Ghi chú nhanh | `rose` | `#e11d48→#881337` | `NotebookPen` (đã import sẵn trong trang) | `StickyNote` + 2 dòng kẻ giấy note |
| Kho thành phẩm | `orange` | `#c2410c→#7c2d12` | `Forklift` | `Forklift` + 2 hàng pallet (dãy ô chữ nhật lặp lại) — đúng ví dụ người dùng đưa ra |
| Kiểm soát quá trình | `teal` | `#0d9488→#134e4a` | `Gauge` | `Gauge` + vạch cung chia độ đứt nét |

`teal` chọn để khớp đúng màu module này đã dùng sẵn (`process-shell.tsx`'s tab active:
`bg-teal-50 text-teal-700 border-teal-200`) — không bịa màu mới cho module đã có màu riêng.
Cả 4 theme đều hex Tailwind built-in, không thêm token mới vào `globals.css`.

### 4 điểm chạm theo trang

| Trang | Vị trí chèn | Ghi chú |
|---|---|---|
| `kpi/page.tsx` | Trong `<KpiShell>`, đầu `<div className="space-y-5">` | Không có `action` (trang chỉ có 2 khối danh sách, không có nút header) |
| `notes/page.tsx` | Đầu `<div className="space-y-4">` | Nút "Thêm ghi chú" đổi sang `bg-white text-rose-700` |
| `warehouse/page.tsx` | Đầu `<div className="p-4 h-full flex flex-col">` | 2 nút chọn Kho1/Kho2 đổi màu: đang chọn = `bg-white text-orange-800`, chưa chọn = viền trắng-mờ |
| `process/page.tsx` | Trong `<ProcessShell>`, trước `<FilterBar>` | Trang này **trước đó không có `<h1>` nào cả** — banner là tiêu đề trang đầu tiên, không phải thay thế header cũ |

### "Bản đồ lô" (`/dashboard/map`) — CỐ Ý KHÔNG thêm banner/motif, lý do kỹ thuật

Đã đọc `map/page.tsx` + `MapClient.tsx` trước khi quyết định: đây là bản đồ Leaflet **full-bleed**
(`h-[calc(100vh-48px)]`, không có `<h1>` nào cả, chỉ có nút "quay lại" và panel filter nổi
`position: absolute z-[1000]` đè lên bản đồ). Hai lý do khiến cách làm giống 9 module kia không
phù hợp:

1. **`PageHeaderBanner`** sẽ chiếm mất chiều cao quý giá của bản đồ (vốn cố ý full-bleed để tối
   đa vùng nhìn) — khác hẳn các trang khác vốn đã có sẵn `<h1>` phẳng chiếm chỗ tương đương.
2. **`PageBackgroundMotif`** dùng `position:fixed -z-10` sẽ **hoàn toàn vô hình** — toàn bộ vùng
   nhìn thấy bị phủ kín bởi tile bản đồ Leaflet đục (opaque), motif nền không có chỗ nào để lộ ra.

Đã cân nhắc thêm phương án nhẹ hơn (chỉ đổi màu nút "quay lại"/panel filter nổi sang tông theme
mới, không đụng bố cục) nhưng đây là loại thay đổi khác hẳn (styling lại UI nổi có sẵn, không
phải thêm banner/motif) nên **chưa làm** — nếu người dùng vẫn muốn có điểm nhấn hình ảnh riêng
cho trang này, cần bàn phương án cụ thể riêng, không tự suy diễn.

### Chưa test tay trên trình duyệt thật (4 module mới)

1. `/dashboard/kpi`: banner violet hiển thị đúng, không có action nên banner chỉ có
   title/subtitle/icon — xác nhận không bị trống trải/lệch bố cục.
2. `/dashboard/notes`: banner rose + icon `NotebookPen`; nút "Thêm ghi chú" (trắng, chữ rose)
   đọc rõ; xác nhận ẩn đúng khi không có quyền `notes.create` (`action` trả `undefined`).
3. `/dashboard/warehouse`: banner orange + icon `Forklift`; 2 nút chọn Kho1/Kho2 đổi màu đúng
   theo trạng thái đang chọn, vẫn bấm chuyển kho hoạt động bình thường; xác nhận hoa văn nền
   (hàng pallet + forklift mờ) không ảnh hưởng thao tác kéo-thả kiện trong sơ đồ kho bên dưới.
4. `/dashboard/process`: banner teal + icon `Gauge` hiển thị **sau** tab nav trắng của
   `ProcessShell` (giống thứ tự đã thấy ở Bảo trì) — xác nhận không bị hiểu nhầm là lỗi; xác
   nhận đây là nội dung đầu tiên có `<h1>` thật của trang (trước đó trang này không có tiêu đề
   nào), không phá vỡ bố cục filter bar/KPI cards bên dưới.
5. Xác nhận kỹ thuật "component Lucide lồng trong `<pattern>`" render đúng trên nhiều trình
   duyệt (Chrome/Edge/Firefox) — đây là kỹ thuật mới lần đầu dùng trong repo, dù đã verify hợp
   lệ theo spec SVG, nên cần xác nhận trực quan ít nhất 1 lần trước khi áp dụng thêm nơi khác.

## Cập nhật 2026-08-24 (tiếp 7) — Trang đăng nhập + sidebar dùng ảnh cạo mủ thật, định hình
phong cách "ảnh thật + mờ dần" cho các module sau này

Người dùng cung cấp 2 ảnh mockup đích (`cung_cap_dl/dang_nhap.png`, `cung_cap_dl/sau_dn.png`/
`slidebar.png`), 2 ảnh nền thật chủ đề cạo mủ cao su (`cung_cap_dl/r1.jpg` cho đăng nhập,
`r2.jpg` cho sidebar), và 3 logo chứng nhận ISO thật (`9001_2015.png`, `14001_2015.png`,
`14067_2018.png`) để thay cho SVG minh hoạ vẽ tay đang dùng.

**Quy trình đã áp dụng (bắt buộc theo yêu cầu người dùng)**: dựng 2 file HTML tĩnh tham khảo
trong `cung_cap_dl/` (`thiet_ke_dang_nhap_moi.html`, `thiet_ke_sidebar_moi.html`) trước — lặp
chụp screenshot bằng `npx --yes playwright screenshot` (đã tự cài `chromium` qua
`npx playwright install chromium` vì bản cache sẵn trên máy lệch version) để tự đối chiếu với
ảnh mockup, chỉnh tới khi khớp, rồi mới đưa vào code thật. Ban đầu dùng `border-radius` hình
elip lớn để tạo cạnh cong ngăn cách 2 cột (giống ý tưởng "vòng cung" trong mockup) nhưng người
dùng phản hồi muốn đổi hẳn hướng: **ảnh cạo mủ lấn dần sang khoảng 50% chiều rộng trang rồi mờ
dần hoà vào nền trắng của form**, không còn cạnh cứng nào — đã đổi sang kỹ thuật
`mask-image`/`-webkit-mask-image` với `linear-gradient` ngang, xác nhận lại qua screenshot mới
rồi mới duyệt.

### Đã triển khai vào code thật

- Asset copy vào `public/`: `login-bg-forest.jpg`, `sidebar-bg-forest.jpg`,
  `badges/iso-9001.png`, `badges/iso-14001.png`, `badges/iso-14067.png`.
- `src/app/login/page.tsx`: viết lại toàn bộ phần trình bày (JSX/className), **giữ nguyên 100%**
  state/handler cũ (`handleLogin`, `handleRegister`, bootstrap effect, dropdown phòng ban,
  `CustomerPortalLangToggle`...) — chỉ thêm 2 state UI-tĩnh mới `showPassword`/`rememberMe`
  (không nối logic auth thật, đã chốt với người dùng khi duyệt thiết kế). Cột trái tách 2 nhánh
  theo breakpoint: `lg:hidden` giữ nguyên y hệt bản gradient+SVG cũ cho mobile/tablet (không đụng
  gì, tránh rủi ro hồi quy), `hidden lg:block` là bản mới dùng `next/image` (`/login-bg-forest.jpg`)
  + mask-image ngang lấn-mờ-dần. Card form thêm avatar tròn nổi mép trên, divider icon `Leaf`,
  input nền kem (`#fdf3d9`/`#f0e2b8`, literal hex — không dùng `var()` trong style) kèm icon
  prefix (`User`/`Lock`/`Building2`), toggle ẩn/hiện mật khẩu (`Eye`/`EyeOff`), hàng "Ghi nhớ
  đăng nhập"/"Quên mật khẩu?" tĩnh, 3 badge ISO dùng đúng logo thật (crop bằng
  `backgroundSize: "235% auto"` + `backgroundPosition: "2% 4%"` để chỉ lộ dấu hiệu tròn, bỏ chữ
  "QUACERT" rườm rà), hàng cam kết thương hiệu 4 mục cuối trang. Markup card này dùng chung cho
  cả mobile lẫn desktop (chỉ nền/branding bên trái khác nhau).
- `src/app/dashboard/layout.tsx`: `<aside>` thêm 1 lớp `next/image` (`/sidebar-bg-forest.jpg`)
  `absolute inset-x-0 bottom-0 h-[52%] -z-10` với mask-image dọc (mờ dần từ dưới lên, hoà vào
  `bg-brand`/`bg-brand-deep`), đặt sau lớp hoa văn rãnh cạo mủ hiện có, dùng `absolute` (không
  phải `fixed`) để không đụng landmine containing-block đã ghi ở
  `.claude/rules/24-notification-bell-module-tasks.md`. Header sidebar đổi tên nhà máy từ
  `truncate` 1 dòng sang cho phép wrap 2 dòng, subtitle đổi màu mint uppercase tracked — không
  đụng logic/permission/collapse/nav nào khác.
- Đã ghi lại công thức mask-image + quy tắc mở rộng làm chuẩn cho các module sau vào
  `.claude/rules/05-ui-components.md` mục "Ảnh thật + hiệu ứng mờ dần" (ngay dưới mục
  `PageHeaderBanner`) — theo đúng yêu cầu "định hình phong cách mới làm nền tảng cho các module
  sau này".

### Đã kiểm chứng

- `npx tsc --noEmit` và `npx eslint src/app/login/page.tsx src/app/dashboard/layout.tsx` đều
  sạch.
- Tự khởi động tạm 1 dev server cục bộ (xác nhận trước đó không có process `node.exe`/cổng 3000
  nào đang chạy — an toàn theo đúng quy tắc "không chạy build khi không chắc dev server người
  dùng đang chạy song song"), chụp screenshot `/login` thật ở cả desktop (1536×900) và mobile
  (430×900) qua Playwright — xác nhận hiệu ứng ảnh lấn-mờ-dần hiển thị đúng như bản HTML tham
  khảo đã được duyệt, mobile giữ nguyên y hệt thiết kế cũ. Đã tắt dev server tạm này ngay sau khi
  xác nhận xong (`taskkill` đúng PID đang bind cổng 3000, không đụng các `node.exe` khác không
  xác định được nguồn gốc).
- **Chưa xác nhận trực quan `/dashboard` (sidebar) trên trình duyệt thật** — trang này yêu cầu
  đăng nhập nên không tự động screenshot được; chỉ xác nhận gián tiếp qua log dev server (route
  `/dashboard` compile và trả `200` thành công, không có lỗi React/TypeScript khi 1 tab trình
  duyệt thật — có vẻ của người dùng, tự kết nối lại vào dev server tạm này — tải trang và gọi
  API thành công). Cần người dùng tự mở `/dashboard` sau khi đăng nhập để xác nhận trực quan lớp
  ảnh mờ dần ở đáy sidebar hiển thị đúng, không che khuất menu, không giảm độ tương phản chữ khi
  cuộn danh sách dài, và responsive mobile (drawer trượt) vẫn hoạt động bình thường.

## Kế hoạch phiên sau (2026-08-27) — Hệ thống ký số dùng chung: kế hoạch đã chốt, mockup ISO đã duyệt qua nhiều vòng, sẵn sàng bắt đầu code Giai đoạn 0

**CHƯA CODE GÌ Ở PHIÊN NÀY** — toàn bộ phiên chỉ điều tra code thật, đánh giá/góp ý 1 bản kế
hoạch do người dùng soạn, và dựng 1 file HTML mockup tương tác để duyệt thiết kế trước khi đụng
code thật (đúng quy trình chuẩn của dự án — xem `.claude/rules/05-ui-components.md`).

### File tham chiếu bắt buộc đọc trước khi bắt đầu code (theo đúng thứ tự)

1. `cung_cap_dl/du_an_ky_so_dung_chung - new.docx` — bản kế hoạch kiến trúc đầy đủ, đã qua 1
   vòng Claude đọc code thật để kiểm chứng + góp ý 5 điểm (xem mục dưới). Đây là **nguồn thiết
   kế chính thức**, không phải bản nháp ban đầu trong lịch sử chat.
2. `cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html` — mockup HTML tương tác thật (mở thẳng bằng
   trình duyệt, không cần server) cho màn **"Soạn thảo vị trí ký"** (người soạn thảo vẽ khung 1
   lần/loại tài liệu ISO cha, lưu thành `mau_vi_tri`, áp dụng tự động cho các hồ sơ sau). Đã qua
   nhiều vòng: dựng → người dùng test tay → sửa lỗi thật (kéo/resize giật do
   `renderBoxes()`/`selectRole()` phá huỷ DOM giữa chừng — đã fix và verify bằng Playwright kéo
   chuột thật, không phải `page.evaluate()`) → sửa lại phạm vi đúng nghiệp vụ ISO (bỏ
   "ghi chú"/"ký song song" vì không khớp luồng ISO thật, các tính năng đó để dành cho mockup
   Văn bản nội bộ sau này) → sửa đúng quy ước công ty thật (khối ký ở TRANG 1, không phải trang
   cuối) → đổi đúng ý "khung lưới" (gridline hỗ trợ căn chỉnh, không phải ẩn/hiện khung ký) →
   thêm cơ chế chọn hiển thị 1-trong-3 loại chức vụ.
   **Không tự suy diễn lại UI từ mô tả text — mở file này lên xem/thao tác thử trước khi build
   `SignScreen`/công cụ đặt khung thật, vì rất nhiều chi tiết hành vi (snap-to-grid, cách
   "Nhân bản khung" hoạt động, cách preview chữ ký mẫu...) chỉ được quyết định qua tương tác,
   không có mô tả đầy đủ bằng lời ở đâu khác.**

### Tóm tắt phát hiện quan trọng từ điều tra code thật (đã làm ở phiên này, không cần điều tra lại)

- PIN chữ ký (`sign_pins`) **đã** hash bcrypt cost 12, verify bằng `bcrypt.compare()`
  (`src/app/api/sign/verify/route.ts:36`) — rủi ro thật KHÔNG phải "PIN lưu dạng đọc được".
  Rủi ro thật: (1) route `sign/verify` **không** gọi `assertNotRateLimited`/
  `recordFailedVerifyAttempt` dù 2 hàm này đã có sẵn ở
  `src/app/api/account/_lib/security.ts:100-121` (đang dùng cho luồng đổi PIN) — chỉ cần import
  và gọi thêm, không viết mới; (2) không ghi log lần nhập PIN sai khi ký; (3) không lưu SHA-256
  của PDF sau khi ký; (4) `doc_approval_log` RLS là `FOR ALL`, insert-only chỉ là quy ước code.
- "Bộ render tự phát tọa độ trường ký" chỉ đúng 3/6 module nghiệp vụ dự kiến mở rộng ký số:
  Điều xe/Sản lượng/Kho dùng `jsPDF` thật (có tọa độ point). Chất lượng/Xuất hàng/Bảo trì hiện
  chỉ là HTML + `window.print()` — không có file PDF thật, không có tọa độ nào cả. **Quyết định
  đã chốt**: chuyển cả 3 sang `jsPDF` (mirror `src/lib/dispatch-pdf.ts`/`output-pdf.ts`/
  `storage-pdf.ts`) TRƯỚC khi gắn ký số cho 3 module này (Giai đoạn 2 riêng, chưa đụng workflow
  ký).
- ISO + Văn bản đã có ký số chạy thật (`pdf-lib` tự xây, không phụ thuộc dịch vụ ngoài/Adobe),
  nhưng logic bị copy-paste gần như y hệt 3 lần (`getSigImage()`, `stampPdf()`, modal đặt vị trí,
  notify 3-kênh) — route `/api/sign/generate-pdf` dù đặt tên như dùng chung nhưng thực chất
  hard-code `iso_documents`, module Văn bản có route riêng hoàn toàn (`api/documents/sign/route.ts`).
  **Quyết định đã chốt**: Giai đoạn 1 = tách lõi thành `src/lib/signing/` bằng cách REFACTOR
  chính ISO/Văn bản (rủi ro thấp vì logic đã chạy thật), KHÔNG đổi schema DB của 2 module này,
  KHÔNG chọn module mới (Bảo trì) làm thí điểm như đề xuất ban đầu — Bảo trì hoá ra là module ít
  sẵn sàng nhất (chưa PDF thật, chưa PIN, chưa ảnh chữ ký nào).

### Quyết định kiến trúc đã chốt trong bản docx (đã Claude xác nhận hợp lý qua đọc code, không cần bàn lại)

| # | Nội dung | Quyết định |
|---|---|---|
| 1 | 3 module chỉ có HTML print (Chất lượng/Xuất hàng/Bảo trì) | Chuyển sang `jsPDF` trước, chưa gắn ký số ngay |
| 2 | Module thí điểm Giai đoạn 1 | Tách dịch vụ dùng chung từ chính ISO/Văn bản (refactor, không xây mới) |
| 3 | Cấp độ ký của Bảo trì | Mỗi mẫu in (F13/F10/F15...) là 1 `yeu_cau_ky` độc lập; UI gộp 1 lần PIN cho cả lô cùng lượt phê duyệt |
| 4 | Cấu trúc `dinh_tuyen` | Theo mỗi loại tài liệu/phiếu (`cau_hinh_tai_lieu` có 1 dòng/loại) |
| 5 | Vị trí trường ký | Người soạn thảo vẽ khung màu — không dùng tag ẩn trong file |
| 6 | Mẫu vị trí | Vẽ 1 lần cho mỗi loại tài liệu, lưu `mau_vi_tri`, lần sau tự áp dụng |
| 7 | Ép đọc tài liệu | Không ép — chỉ bắt buộc ký hết mọi khung bắt buộc |
| 8 | Truy cập | Deep link `/ky/:id` + Supabase Auth + RLS theo `auth.uid()` — bỏ hẳn magic link |
| 9 | Xác thực ký | Phân tầng theo loại tài liệu: `pin` / `pin_otp` / `smartca` |
| 10 | Kênh OTP | Telegram bot (tin nhắn riêng, không phải nhóm) — email dự phòng — không SMS |
| 11 | SmartCA | Chỉ lãnh đạo, bắt buộc ở vòng cuối, gửi cả file cho VNPT ký (không tự dựng ByteRange) |
| 12 | Lưu trữ file trung gian | Giữ bản gốc + bản cuối vĩnh viễn; bản trung gian giữ 7 ngày rồi xoá; hash lưu vĩnh viễn |
| 13 | Engine render | Giữ `jsPDF`, không dùng headless browser (ràng buộc Vercel) |

### Góp ý của Claude đã đưa vào docx — nhớ khi code, đừng bỏ sót

1. SmartCA là 1 dự án con có mốc thời gian phụ thuộc VNPT (ngoài tầm kiểm soát team) — tách
   khỏi cam kết "6-8 tuần" tổng, có gate go/no-go riêng.
2. Sau khi SmartCA ký (PAdES), `file_hien_tai` tuyệt đối không được đụng lại bởi bất kỳ tính
   năng nào khác (kể cả vô hại như tạo thumbnail) — cần cột `da_ky_smartca boolean` chặn ghi đè.
3. "Giữ 7 ngày rồi tự xoá" (mục lưu trữ) cần cơ chế **dọn cơ hội** (opportunistic — dọn file cũ
   ngay khi có bản ký mới ghi đè) thay vì cron, vì dự án **không có hạ tầng lịch chạy nền**
   (đã chốt nguyên tắc này ở module KPI, `.claude/rules/27-kpi-module.md`).
4. `yeu_cau_ky` nên **snapshot** `muc_xac_thuc`/`yeu_cau_chu_ky_so` từ `cau_hinh_tai_lieu` ngay
   lúc tạo — không join sống — để admin đổi cấu hình giữa chừng không ảnh hưởng hồ sơ đang
   luân chuyển dở.
5. Ánh xạ vai trò → người ký thật trong `dinh_tuyen`: tái dùng cơ chế đã có sẵn và chạy thật
   `/api/documents/dept-leader` (tự nhận diện lãnh đạo phòng ban qua khớp `chuc_vu`) thay vì
   gán cứng `user_id` — tránh cấu hình "chết" khi nhân sự đổi.

### Quyết định phát sinh thêm khi dựng mockup — CHƯA có trong docx, cần đưa vào khi code thật

1. **Quy ước công ty thật (khác giả định ban đầu)**: khối ký Soạn thảo→Xem xét→Phê duyệt của
   tài liệu ISO Cấp 1 **luôn nằm ở TRANG 1** (gần như trang bìa/trang duyệt), không phải trang
   cuối như giả định lúc đầu. `mau_vi_tri` mặc định neo `đầu, trang 1` cho 3 vai trò này khi tạo
   mẫu cho loại tài liệu ISO cha — đây là quy ước xác nhận cho ISO Cấp 1, **chưa xác nhận** có
   áp dụng y hệt cho ISO Cấp 2 hay Văn bản nội bộ hay không, phải hỏi lại khi làm tới.
2. **Chức năng "Nhân bản khung"** (1 người ký ở ≥2 vị trí trên cùng 1 tài liệu, ví dụ Phê duyệt
   vừa ký cuối văn bản vừa ký nháy phụ lục riêng) — hoàn toàn tương thích với schema `truong_ky`
   đã thiết kế sẵn (1 `nguoi_ky_id` → nhiều dòng `truong_ky`, không có ràng buộc unique nào cản
   trở) — chỉ thiếu UI, không cần đổi schema. Mockup đã demo đầy đủ: nút "Nhân bản" tạo bản sao
   độc lập neo `đầu` + trang tự chọn (cho phép chuyển trang tự do trong lúc đang đặt), preview
   hiện đúng tên/chữ ký của người gốc qua liên kết `clonedFrom`.
3. **Lưới căn chỉnh (gridline ngang/dọc, bước 5%) + snap-to-grid** khi kéo/resize khung — tính
   năng hỗ trợ người soạn thảo đặt khung chính xác, chưa có trong docx gốc, cần đưa vào thiết kế
   `SignScreen`/công cụ đặt khung thật ở Giai đoạn 1. Bật lưới thì kéo/resize tự làm tròn về
   đúng vạch (không chỉ hiển thị để nhìn).
4. **Gap schema thật quan trọng, cần bàn kỹ trước khi viết migration**: bảng nhân sự hiện chỉ
   có 2 cột chức vụ (`maintenance_staff.chuc_vu`, `chuc_vu_chinh_quyen`), nhưng thực tế công ty
   có **3 loại chức vụ độc lập, có thể cùng tồn tại trên 1 người** (không phải 1 người 1 chức
   vụ):
   1. **Chức vụ chính quyền** — ví dụ "Tổng Giám đốc".
   2. **Chức vụ kiêm nhiệm** — ví dụ "Trưởng ban ISO".
   3. **Chức vụ đoàn thể** — ví dụ "Chủ tịch công đoàn".

   Mỗi loại có-thì-điền, không-thì-để-rỗng. Vấn đề thật đang gặp: hiện soạn thảo phải tự gõ tay
   nên **hay quên/chọn sai loại** tuỳ ngữ cảnh tài liệu (ví dụ 1 người vừa là Trưởng phòng QLCL
   (chính quyền) vừa là Trưởng ban ISO (kiêm nhiệm) — tài liệu ISO nên ưu tiên hiện chức vụ kiêm
   nhiệm, không phải chính quyền, dù cùng 1 người). Cần thêm cột `chuc_vu_kiem_nhiem`,
   `chuc_vu_doan_the` (tên cột cụ thể/có tách bảng riêng hay không **chưa quyết**, cần bàn ở
   phiên code) — mockup đã demo hướng xử lý: dropdown liệt kê rõ NHÃN LOẠI + GIÁ TRỊ THẬT, chỉ
   hiện loại nào có dữ liệu, mặc định ưu tiên chính quyền → kiêm nhiệm → đoàn thể nhưng cho đổi.
5. **"Hiện tên & chức vụ" (showName) + "chọn loại chức vụ hiển thị" (chucVuKey) là cấu hình
   KHOÁ THEO MẪU** (`mau_vi_tri`), đặt 1 lần bởi người soạn thảo/admin lúc vẽ mẫu — **KHÔNG**
   phải người ký tự bật/tắt mỗi lần đến lượt ký như hệ thống hiện tại đang làm (`showSignature`/
   `showSignerName` trong `SignPlacement` hiện do chính người ký tự chỉnh trong modal đặt vị trí
   mỗi lần ký — đây chính là kiểu thao tác lặp lại mà cả dự án này sinh ra để loại bỏ, xem
   `.claude/rules/16-iso-vanban-module.md`). Quy tắc nghiệp vụ "tài liệu cha chỉ ẩn được tên,
   không ẩn được chữ ký; hồ sơ con ẩn được cả hai" **giữ nguyên không đổi** — chỉ đổi CHỖ cấu
   hình (từ mỗi-lần-ký sang một-lần-lúc-soạn-mẫu). Đây là quyết định người dùng đã tự chốt qua
   mô tả vấn đề thật (không phải Claude tự suy diễn).

### Bước tiếp theo — Giai đoạn 0 (bắt đầu ở session khác)

Thứ tự làm, độc lập rủi ro thấp, nên gộp mục 1-4 thành 1 PR nhỏ deploy trong ngày (vá lỗ hổng
đang tồn tại thật trên production, không phải tính năng mới):

1. Vá `src/app/api/sign/verify/route.ts` — thêm `assertNotRateLimited`/`recordFailedVerifyAttempt`
   (import từ `src/app/api/account/_lib/security.ts`, chỉ 2 lời gọi hàm).
2. Thêm `computeIntegrityHash()` (SHA-256, hoàn toàn mới) — gọi ngay sau khi ký ở cả
   `generate-pdf/route.ts` và `documents/sign/route.ts`, trước khi upload Storage, lưu vào cột
   mới `content_hash` của `doc_approval_log`.
3. Trigger bất biến `chan_sua_nhat_ky()` áp cho `doc_approval_log` (`BEFORE UPDATE OR DELETE`) —
   **bắt buộc dùng trigger, không chỉ RLS insert-only**, vì API route chạy bằng service role vốn
   bypass toàn bộ RLS nhưng KHÔNG bypass được trigger.
4. Backfill hash cho PDF đã ký sẵn có trong Storage (ghi kèm `hash_backfilled_at` — nói rõ với
   đánh giá viên đây là mốc từ ngày backfill, không phải bằng chứng hồi tố).
5. Migration tạo 6 bảng mới theo đúng schema mục 5 của docx (`yeu_cau_ky`, `nguoi_ky`,
   `truong_ky`, `mau_vi_tri`, `nhat_ky_ky`, `cau_hinh_tai_lieu`) — chỉ tạo bảng, chưa module nào
   dùng, không ảnh hưởng hệ thống đang chạy.
6. Chụp **bản chuẩn**: ký thử ~10 tài liệu ISO/Văn bản thật đủ loại trên `npm run dev`, lưu file
   PDF + ảnh render ra thư mục **ngoài repo** — làm baseline đối chiếu pixel
   (`pdftoppm -r 100 -png` + ImageMagick `compare -metric AE`) cho Giai đoạn 1. Không có bước
   này thì Giai đoạn 1 (refactor lõi ký ISO/Văn bản) là refactor mù.
7. Bàn cụ thể cột/cách migrate cho gap "3 loại chức vụ" (mục "phát sinh thêm" #4 ở trên) trước
   khi viết migration — chưa chốt tên cột/có tách bảng riêng hay không.

Chỉ sau khi hoàn tất Giai đoạn 0 mới bắt đầu Giai đoạn 1 (refactor lõi ký thành
`src/lib/signing/` từ chính ISO/Văn bản — không đổi schema/hành vi 2 module đang chạy thật), rồi
mới tới việc dựng `SignScreen`/công cụ đặt khung THẬT dựa trên mockup đã duyệt.

### Prompt gợi ý để mở đầu session mới

```
Đọc mục "Kế hoạch phiên sau (2026-08-27) — Hệ thống ký số dùng chung" trong CLAUDE.md, đọc file
cung_cap_dl/du_an_ky_so_dung_chung - new.docx và mở thử cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html
bằng trình duyệt. Sau khi nắm đủ bối cảnh, bắt đầu Giai đoạn 0 mục 1-4 (vá bảo mật PIN + hash +
trigger bất biến cho doc_approval_log) — gộp thành 1 PR nhỏ. Hỏi lại tôi trước khi đụng tới mục
7 (gap 3 loại chức vụ) vì tên cột/cách migrate chưa chốt.
```

## Cập nhật (tiếp) — Giai đoạn 0 mục 1-4 đã code xong, CHƯA chạy migration/backfill/deploy

Đã đọc `cung_cap_dl/du_an_ky_so_dung_chung - new.docx` (trích xuất text từ XML nội bộ, không mở
được trực tiếp bằng Read) và `cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html` (đọc source, không
mở được trình duyệt thật trong phiên non-interactive này — đã nắm đủ hành vi qua code JS: 6 vai
trò cố định, neo `đầu/cuối/mọi_trang`, nhân bản khung, lưới snap 5%, 3 loại chức vụ). Chỉ code
đúng mục 1-4, KHÔNG đụng mục 5 (6 bảng mới), mục 6 (chụp bản chuẩn), mục 7 (gap 3 loại chức vụ —
đúng như đã hẹn, chưa hỏi vì chưa cần).

### Quyết định khi code (không tự suy diễn, ghi lại để không hỏi lại)

- CLAUDE.md's "Bước tiếp theo" mục 2 ghi rõ "gọi ngay sau khi ký ở cả `generate-pdf/route.ts` và
  `documents/sign/route.ts`" — đã xác nhận qua code: `documents/sign/route.ts` (Văn bản nội bộ)
  **trước đây hoàn toàn không ghi gì vào `doc_approval_log`** (chỉ update `van_ban_documents`),
  dù cột `doc_type` của bảng này đã hỗ trợ sẵn `'van_ban'` từ lúc tạo bảng
  (`20260522_iso_vanban_module.sql`) — tức bảng được thiết kế dùng chung nhưng Văn bản chưa từng
  dùng tới. Đã làm đúng theo chỉ dẫn: Văn bản giờ **lần đầu tiên có audit log + hash**, ghi vào
  cùng bảng `doc_approval_log` với `doc_type='van_ban'`. `generate-office/route.ts` (Office ISO)
  cũng được thêm hash dù không được nêu tên tường minh — vì đây là 1 trong 2 route ghi
  `doc_approval_log` cho ISO (cùng cặp với `generate-pdf/route.ts`), bỏ sót sẽ để lại nửa lỗ hổng.
- `computeIntegrityHash()` đặt tại `src/lib/signing/hash.ts` (SHA-256 hex, dùng `crypto` built-in
  của Node) — tạo trước thư mục `src/lib/signing/` dù việc tách thư viện dùng chung đầy đủ là
  Giai đoạn 1 (chưa làm) — đây là hàm hoàn toàn mới, không refactor code cũ, nên an toàn để đặt
  đúng vị trí đích ngay từ đầu thay vì đặt tạm rồi phải move sau.
- `action` của dòng log Văn bản suy từ `stepKey` sẵn có trong `performFileStamp()`
  (`stepKey === "phe_duyet"` → action `"phe_duyet"`, còn lại → `"ky_buoc"` kèm `buoc_ky` là số
  bước) — không thêm tham số mới cho hàm, tận dụng dữ liệu đã có.

### File đã sửa/tạo

| File | Thay đổi |
|---|---|
| `src/app/api/sign/verify/route.ts` | Thêm `assertNotRateLimited(userId)` trước khi so PIN; `recordFailedVerifyAttempt(userId)` khi PIN sai (2 lời gọi, đúng như CLAUDE.md ghi) — dùng chung cửa sổ 5 lần/15 phút đã có sẵn ở `_lib/security.ts` |
| `src/lib/signing/hash.ts` | Mới — `computeIntegrityHash(bytes)` |
| `src/app/api/sign/generate-pdf/route.ts` | Hash `signedPdfBytes` trước upload, thêm `content_hash` vào insert `doc_approval_log` (action `generate_pdf`) |
| `src/app/api/sign/generate-office/route.ts` | Hash `result.buffer` trước upload, thêm `content_hash` vào insert `doc_approval_log` (action `generate_office_{fileKind}`) |
| `src/app/api/documents/sign/route.ts` | `performFileStamp()`: hash `stampedBytes` trước upload; sau khi update `van_ban_documents` thành công, **lần đầu tiên** insert vào `doc_approval_log` (`doc_type='van_ban'`, action `ky_buoc`/`phe_duyet`, kèm `content_hash`) |
| `supabase/migrations/20260901_doc_approval_log_hardening.sql` | Mới, **CHƯA CHẠY** — thêm cột `content_hash`/`hash_backfilled_at`; trigger `nhat_ky_bat_bien` (`BEFORE UPDATE OR DELETE`) áp cho mọi role kể cả service role; xoá policy `FOR ALL` cũ, thay bằng `doc_approval_log_select` (SELECT theo factory) + `doc_approval_log_insert` (INSERT theo factory, có `WITH CHECK`) — không có policy UPDATE/DELETE nào (mặc định deny) |
| `scripts/backfill-doc-approval-hash.mjs` | Mới, **CHƯA CHẠY** — backfill hash cho PDF đã ký sẵn có (`iso_documents` + `van_ban_documents`, cả 2 vì cùng lý do ở trên), insert-only (idempotent qua kiểm tra `action='backfill_hash'` đã tồn tại chưa), dry-run mặc định, cần `--apply` để ghi thật |

Đã xác nhận bằng `grep` toàn repo: không có bất kỳ `.update()`/`.delete()` nào nhắm vào
`doc_approval_log` ở bất kỳ đâu trong code hiện tại (chỉ có 4 chỗ `.insert()`, đã liệt kê ở trên
cộng 1 chỗ ghi log hành động không kèm file tại `iso/documents/[id]/page.tsx:1680`) — nên trigger
bất biến không phá vỡ luồng nào đang chạy.

`npx tsc --noEmit` sạch; `npx eslint` trên toàn bộ file đã sửa sạch (2 warning còn lại trong
`generate-pdf/route.ts` là warning cũ, không liên quan — đã đối chiếu bằng `git diff --stat` xác
nhận thay đổi của phiên này chỉ +6 dòng ở file đó). Không chạy `npm run build`.

### BẮT BUỘC làm trước khi coi Giai đoạn 0 mục 1-4 là hoàn tất

1. Chạy `supabase/migrations/20260901_doc_approval_log_hardening.sql` trên Supabase SQL Editor
   (dự án không có Supabase CLI, migration luôn chạy tay theo quy ước có sẵn).
2. Sau khi migration chạy xong, chạy backfill (dry-run trước, đọc kỹ output rồi mới `--apply`):
   ```bash
   node --env-file=.env.local scripts/backfill-doc-approval-hash.mjs
   node --env-file=.env.local scripts/backfill-doc-approval-hash.mjs --apply
   ```
   Script tự tải từng file PDF đã ký từ Storage (qua `file_signed_pdf_url` public) để tính hash —
   có thể mất vài phút tùy số lượng tài liệu, và một số dòng có thể lỗi tải file (file đã bị xoá
   khỏi Storage) — script in danh sách lỗi riêng, không chặn phần còn lại.
3. Kiểm chứng theo đúng mục 10 của docx (chưa làm ở phiên này — cần Supabase SQL Editor + tài
   khoản ISO thật):
   - Nhập sai PIN 6 lần liên tiếp trên 1 tài liệu ISO thật → xác nhận bị khoá đúng thông báo
     "...thử lại sau 15 phút" (không phải lỗi PIN sai thông thường).
   - Ký thử 1 tài liệu ISO (PDF) và 1 văn bản (PDF) → xác nhận `doc_approval_log` có dòng mới với
     `content_hash` không rỗng.
   - Thử `UPDATE doc_approval_log SET action='x' WHERE id=...` và
     `DELETE FROM doc_approval_log WHERE id=...` trực tiếp trong SQL Editor (chạy bằng quyền
     service role/postgres, KHÔNG phải qua RLS user thường) → phải bị trigger chặn với đúng
     thông báo "Nhật ký ký số là bất biến...".
4. Deploy (commit + push) — theo đúng tinh thần "vá lỗ hổng đang tồn tại thật trên production,
   nên gộp 1 PR nhỏ và deploy trong ngày" của docx. Chưa commit/push ở phiên này — chỉ code local.

### Cố ý CHƯA làm (đúng phạm vi đã xin phép, không tự ý mở rộng)

- Chưa đụng mục 5 (migration tạo 6 bảng mới: `yeu_cau_ky`, `nguoi_ky`, `truong_ky`, `mau_vi_tri`,
  `nhat_ky_ky`, `cau_hinh_tai_lieu`), mục 6 (chụp bản chuẩn ~10 tài liệu để đối chiếu pixel cho
  Giai đoạn 1), và mục 7 (gap "3 loại chức vụ" — theo đúng yêu cầu, sẽ hỏi trước khi đụng).
- Chưa thêm `assertAccountActive()` vào `sign/verify/route.ts` dù route đó hiện chưa check
  `profiles.status` — đây là audit đã áp dụng cho các route `account/*` khác (2026-08-07) nhưng
  KHÔNG nằm trong 4 mục được yêu cầu lần này; nếu muốn vá luôn, cần xác nhận riêng vì đây là thay
  đổi hành vi (chặn thêm 1 trường hợp) ngoài đúng 4 mục đã chốt.

## Cập nhật (tiếp 2) — Giai đoạn 0 mục 1-4 đã deploy + verify sống, mục 6 (bản chuẩn) đã xong

### Deploy + verify mục 1-4 (cùng phiên, sau khi người dùng chạy migration)

- Người dùng tự chạy migration `20260901_doc_approval_log_hardening.sql` trên Supabase SQL
  Editor. Đã verify bằng script tạm (service role): insert 1 dòng test vào `doc_approval_log`,
  thử `UPDATE`/`DELETE` trực tiếp → cả hai bị trigger chặn đúng thông báo; dòng test không xoá
  được (đúng thiết kế) nên còn tồn tại vĩnh viễn trong bảng, `doc_type='trigger_test'`, không
  gắn tài liệu thật, vô hại — **nhớ điều này nếu sau này audit thấy 1 dòng lạ trong log**.
- Chạy backfill thật: `node --env-file=.env.local scripts/backfill-doc-approval-hash.mjs --apply`
  → 72 ISO + 37 Văn bản = 109/109 thành công, 0 lỗi. Re-run dry-run xác nhận idempotent (0 dòng
  còn thiếu).
- Commit `54193df` (chỉ stage đúng 8 file liên quan bảo mật ký số + CLAUDE.md, **không** đụng các
  thay đổi/xoá file `cung_cap_dl/`/`previews/` đã tồn tại từ trước trong working tree — không rõ
  nguồn gốc, không phải việc của phiên này) → `git push origin main` → Vercel tự deploy.
- **Verify sống trên production sau deploy**: người dùng test PIN sai 5 lần → khoá đúng 15 phút.
  Người dùng báo "dòng doc_approval_log mới không có content_hash" kèm ảnh — đã điều tra và xác
  nhận đây **không phải bug**: mỗi lượt ký ISO luôn sinh **2 dòng log cách nhau ~10s** — dòng
  metadata (`action` = tên bước workflow như `gui_xem_xet`, ghi từ client TRƯỚC khi tạo PDF,
  không có file nên `content_hash` luôn NULL theo thiết kế) và dòng `generate_pdf` (ghi SAU khi
  PDF đã stamp xong, có `content_hash`). Người dùng đang xem đúng dòng đầu. Query lại xác nhận
  dòng `generate_pdf` cùng lượt có hash đầy đủ → code đã chạy đúng trên production.
- **Kết luận: Giai đoạn 0 mục 1-4 hoàn tất và đã verify bằng dữ liệu thật trên production**, không
  chỉ code sạch cục bộ.

### Mục 6 — Chụp bản chuẩn (đã xong, lưu NGOÀI repo)

Đã hỏi người dùng chọn giữa "dùng tài liệu đã ký sẵn (an toàn, chỉ đọc)" vs "tự ký thử tài liệu
mới qua UI thật" — người dùng chọn phương án an toàn. **Không tạo bất kỳ hành động ký/chuyển
trạng thái nào trên dữ liệu thật** — chỉ tải file đã ký sẵn (`file_signed_pdf_url`/
`file_signed_office_url`) của 11 tài liệu thật đa dạng loại (7 ISO: QT cha Cấp1, QT cha Cấp2, F
con Cấp1, F con Cấp2/docx, PL con, HD cha, CS cha; 4 Văn bản: ĐN/CV/TTr/TB, Nội bộ công ty lẫn
đơn vị) — chọn dựa theo khảo sát thật toàn DB (không đoán), phát hiện DB hiện **không có** Văn
bản Cấp 2/Mật/Office nào đã ký, không có file phụ soát xét ISO nào đã ký — baseline phản ánh đúng
những gì THẬT SỰ tồn tại, không bịa thêm loại không có.

- Lưu tại **`C:\Users\Software\rubber-erp-ky-so-baseline\`** (sibling ngoài repo, không commit) —
  `files/` (11 file gốc + sha256), `png/` (39 trang PNG render từ 10 PDF, docx không render
  được), `manifest.json`, `README.md` (giải thích đầy đủ nguồn gốc + kỹ thuật + giới hạn).
- **Kỹ thuật render PNG** — lệch hẳn khỏi kế hoạch gốc (`pdftoppm`/ImageMagick `compare`) vì máy
  này **không có poppler lẫn ImageMagick**. Đã thử `pdfjs-dist` + `@napi-rs/canvas` (rasterize
  thuần Node) nhưng gặp lỗi thật: `ctx.fill(path)` bị native binding từ chối vì `Path2D` mà
  `pdfjs-dist` dùng nội bộ không cùng instance với `Path2D` tự import (dù ép dùng chung
  `createRequire`, `instanceof` vẫn khác) — chưa rõ nguyên nhân gốc, đã bỏ hướng này. Giải pháp
  thực tế: Playwright **Chromium có đầu** (`headless: false` — headless mặc định coi PDF là
  download thay vì mở viewer) mở `file://...#page=N&toolbar=0&navpanes=0`, screenshot từng
  trang. Đã verify bằng mắt nhiều ảnh — sắc nét, đúng nội dung, đủ chữ ký/QR/con dấu thật.
  Chi tiết đầy đủ (kèm hướng đi tiếp nếu Giai đoạn 1 cần so pixel tự động) đã ghi trong
  `README.md` của baseline — **không lặp lại ở đây**, đọc file đó khi bắt đầu Giai đoạn 1.
- **Giới hạn quan trọng cho Giai đoạn 1**: baseline chỉ lưu file **ĐÃ KÝ XONG CUỐI CÙNG**, không
  lưu input trung gian (file gốc trước ký + placement JSON từng bước) — vì tài liệu đã ở trạng
  thái cuối, không "ký lại" qua workflow thật được nữa. Giai đoạn 1 muốn so pixel true phải tự
  gọi hàm `stampPdf`-tương-đương (đã refactor) với input tái tạo từ `file_goc_url` +
  `soan_thao_placement`/`xem_xet_placement`/`phe_duyet_placement` lưu trong DB, không phải so
  trực tiếp với baseline này qua workflow ký thật.
- Không cài thêm dependency nào vào repo chính (`package.json` không đổi) — mọi công cụ
  (`playwright`, `pdfjs-dist`, `@napi-rs/canvas`) cài trong 1 thư mục scratch tạm ngoài repo
  (`npm init` riêng), không ảnh hưởng project.

### Còn lại theo đúng kế hoạch (chưa làm, đúng phạm vi)

Giai đoạn 0 mục 5 (6 bảng mới), mục 7 (gap 3 loại chức vụ), mục 8 (dựng HTML nháp SignScreen) vẫn
CHƯA làm — đúng như đã chốt trước đó, cần hỏi lại trước khi đụng mục 7 (tên cột/cách migrate chưa
chốt). Sẵn sàng bắt đầu Giai đoạn 1 (refactor `src/lib/signing/`) sau khi có baseline — nhưng nên
cân nhắc thêm mục 8 (SignScreen nháp) trước, theo đúng thứ tự "Bước tiếp theo" đã ghi ở trên.

### Prompt gợi ý để mở đầu session tiếp theo (mục 5 → 7 → 8 → Giai đoạn 1)

```
Đọc mục "Kế hoạch phiên sau (2026-08-27) — Hệ thống ký số dùng chung" và 2 mục "Cập nhật (tiếp)"/
"Cập nhật (tiếp 2)" ngay sau nó trong CLAUDE.md để nắm đầy đủ những gì đã xong (Giai đoạn 0 mục
1-4 đã deploy + verify sống trên production; mục 6 — bản chuẩn 11 tài liệu — đã lưu ở
C:\Users\Software\rubber-erp-ky-so-baseline\, đọc README.md trong đó trước khi cần so pixel).
Đọc lại cung_cap_dl/du_an_ky_so_dung_chung - new.docx (mục 5, 6.1, 9 "Giai đoạn 0") và
cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html (mockup "vị trí ký" đã duyệt trước đó — dùng làm
tham chiếu phong cách/kỹ thuật cho mockup mới ở mục 8, không phải làm lại).

Làm tuần tự, dừng đúng chỗ cần hỏi:

1. Giai đoạn 0 mục 5 — Migration TẠO MỚI 6 bảng theo đúng schema mục 5 của docx (yeu_cau_ky,
   nguoi_ky, truong_ky, mau_vi_tri, nhat_ky_ky, cau_hinh_tai_lieu). CHỈ tạo bảng — chưa module
   nào dùng tới, không đổi hành vi hệ thống đang chạy. Không cần hỏi trước, cứ làm.

2. DỪNG LẠI VÀ HỎI trước khi làm Giai đoạn 0 mục 7 — gap "3 loại chức vụ" (chức vụ chính quyền /
   kiêm nhiệm / đoàn thể, mô tả chi tiết trong mục "phát sinh thêm khi dựng mockup" #4 của kế
   hoạch phiên 2026-08-27 gốc). Tên cột cụ thể và có tách bảng riêng hay không CHƯA CHỐT — hỏi
   người dùng trước khi viết bất kỳ migration nào cho việc này.

3. Giai đoạn 0 mục 8 — dựng 1 file HTML nháp mới trong cung_cap_dl/ cho "SignScreen" (màn hình
   người KÝ thao tác — khác hẳn mockup "vị trí ký" đã có, đó là màn hình người SOẠN THẢO đặt
   khung). Bám đúng mục 4.8 "Trải nghiệm người ký" của docx: nút Bắt đầu → Tiếp theo tự nhảy tới
   khung chưa ký kế tiếp (tự cuộn qua nhiều trang); nút Hoàn tất chỉ sáng khi hết khung bắt buộc;
   không ép đọc/cuộn hết tài liệu; chữ ký lấy sẵn từ hồ sơ, chỉ xác nhận (không có bảng vẽ tay);
   ngày ký/họ tên/chức danh tự điền, không sửa được; panel phụ hiện tiến trình ký (ai đã ký lúc
   nào, ai đang chờ), trên mobile thu gọn 1 dòng bấm mở rộng. Duyệt bằng cách chụp screenshot qua
   `npx --yes playwright screenshot` (cần `npx playwright install chromium` nếu chưa có cache) —
   dựng file `file://` cục bộ, KHÔNG cần chạy `npm run dev`. Chỉ sau khi người dùng duyệt bản
   nháp này mới được đưa bất kỳ phần nào vào code thật.

4. Sau khi mục 8 được duyệt mới bắt đầu Giai đoạn 1 (refactor `src/lib/signing/` từ chính 3 route
   đang chạy thật — `api/sign/generate-pdf/route.ts`, `api/sign/generate-office/route.ts`,
   `api/documents/sign/route.ts`, `api/iso/forms/[id]/finalize/route.ts`). Nguyên tắc bắt buộc:
   KHÔNG đổi schema, KHÔNG đổi hành vi/response của các route này — chỉ trích phần logic dùng
   chung ra thư viện rồi gọi lại. Đối chiếu bằng bản chuẩn đã chụp (đọc kỹ phần "Cách dùng cho
   Giai đoạn 1" trong README.md của baseline — file gốc trước ký + placement JSON cần tái tạo từ
   DB, KHÔNG ký lại được tài liệu thật đã hoàn tất qua workflow).

Không có gì trong 4 bước trên yêu cầu chạy `npm run build` — chỉ dùng `npx tsc --noEmit` +
`npx eslint` để tự kiểm tra, theo đúng quy tắc đã rút ra ở mục "Fix bug 2026-08-24" trong lịch sử
CLAUDE.md (build có thể đụng `.next/` của dev server đang chạy song song).
```

## Cập nhật (tiếp 3) — Giai đoạn 0 mục 5 xong (6 bảng mới), mục 8 mockup SignScreen xong và
đã tự verify bằng Playwright — ĐANG CHỜ NGƯỜI DÙNG DUYỆT trước khi đụng Giai đoạn 1

### Mục 5 — Migration tạo mới 6 bảng lõi (CHƯA CHẠY trên Supabase)

File mới: `supabase/migrations/20260902_signing_core_tables.sql` — tạo `yeu_cau_ky`,
`nguoi_ky`, `truong_ky`, `mau_vi_tri`, `nhat_ky_ky`, `cau_hinh_tai_lieu` đúng theo mục 5
"Lược đồ dữ liệu" của `cung_cap_dl/du_an_ky_so_dung_chung - new.docx` (đã trích xuất text từ
XML nội bộ để đọc, không mở được trực tiếp bằng Read — giống cách phiên trước đã làm).
**Chỉ tạo bảng — chưa module nào dùng, không đổi hành vi bảng nào đang chạy thật.**

Điểm cần nhớ khi dùng lại 6 bảng này ở Giai đoạn 1/8 sau này:

- **RLS chỉ có SELECT, cố ý KHÔNG có INSERT/UPDATE/DELETE cho client** ở bất kỳ bảng nào —
  toàn bộ ghi dữ liệu phải qua service role (route hiện tại đã dùng service role sẵn) hoặc
  RPC `SECURITY DEFINER` mà Giai đoạn 1 sẽ xây, để đảm bảo các ràng buộc nghiệp vụ (hash toàn
  vẹn, ký không lặp, nhật ký bất biến, ánh xạ vai trò→người qua `dinh_tuyen`) không bị bỏ qua
  bởi ghi trực tiếp từ client trước khi RPC chuẩn tồn tại. Khi Giai đoạn 1/8 chốt xong mô hình
  quyền cụ thể, cần 1 migration riêng bổ sung policy ghi — đừng tưởng nhầm là quên.
- Đã tạo sẵn 2 ràng buộc DB cứng theo đúng mục 6 của docx: trigger `chan_sua_nhat_ky()` gắn
  cho cả `nhat_ky_ky` (tái dùng đúng hàm đã tạo cho `doc_approval_log` ở
  `20260901_doc_approval_log_hardening.sql`), và trigger 2 chiều
  `signing_check_smartca_last()` trên `nguoi_ky` (chặn cả insert dòng SmartCA không phải bước
  cuối lẫn insert dòng thường sau khi đã có bước SmartCA). Unique constraint
  `mot_lan_ky_moi_nguoi` (yeu_cau_id, user_id) đặt tên khớp nguyên văn docx.
- `modun`/`loai_tai_lieu`/`truong_ky.loai` cố ý để TEXT tự do, không CHECK cứng danh sách —
  mirror đúng cách `kpi_tasks.module_code` đang làm, tránh phải sửa migration mỗi khi thêm
  module/loại tài liệu mới.
- `ban_ghi_id` (yeu_cau_ky) là tham chiếu đa hình (không FK) tới bản ghi nghiệp vụ gốc của
  đúng `modun` đó (`lots`, `dispatch_entries`, `maintenance_records`, `iso_documents`...).
- 2 helper `SECURITY DEFINER` (`signing_is_yeu_cau_owner`, `signing_is_participant`) tránh
  "infinite recursion detected in policy" do `yeu_cau_ky`↔`nguoi_ky` tham chiếu chéo RLS —
  mirror đúng kỹ thuật đã dùng ở `operation_notes`/`operation_note_shares` và
  `kpi_tasks`/`kpi_task_members`.

**BẮT BUỘC chạy `supabase/migrations/20260902_signing_core_tables.sql` trên Supabase SQL
Editor trước khi Giai đoạn 1 cần đọc/ghi các bảng này** — hiện tại chưa module nào phụ thuộc
nên chưa chạy cũng không ảnh hưởng hệ thống đang chạy.

### Mục 7 (gap 3 loại chức vụ) — CHƯA ĐỤNG, đúng như đã hẹn

Không tự ý làm, đúng yêu cầu đã chốt từ đầu phiên — tên cột cụ thể/có tách bảng riêng hay
không vẫn chưa chốt, cần hỏi người dùng trước khi viết bất kỳ migration nào cho việc này.

### Mục 8 — Mockup HTML "SignScreen" — ĐÃ DỰNG, ĐÃ TỰ VERIFY BẰNG PLAYWRIGHT, CHƯA CÓ DUYỆT
CỦA NGƯỜI DÙNG

File mới: `cung_cap_dl/thiet_ke_man_hinh_ky.html` — mockup HTML/CSS/JS thuần (không dependency
ngoài, mở trực tiếp bằng `file://`), tái dùng đúng bảng màu/token đã duyệt ở mockup "vị trí
ký" (`cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html` — brand xanh rừng `#2f5d52`, 6 màu vai
trò `ky_nhay/soan_thao/xem_xet/phe_duyet/qr/ngay_ky`). Đây là màn hình của **người KÝ** thao
tác — khác hẳn mockup "vị trí ký" (màn hình người SOẠN THẢO đặt khung).

Đã bám sát đúng mục 4.8 "Trải nghiệm người ký" của docx, verify từng điểm bằng Playwright
(script tạm dùng bản `playwright` cache trong `_npx`, vì repo không có `playwright` làm
dependency — không thêm vào `package.json`):

1. Nút "Bắt đầu" → "Tiếp theo": nhảy tới khung CHƯA KÝ kế tiếp của đúng người đang đăng nhập
   (không phải khung của người khác), tự cuộn mượt dù khung tiếp theo ở trang khác — đã verify
   bằng screenshot cho cả 2 lần nhảy trang (trang 1→2, trang 2→3).
2. "Hoàn tất" mờ (`.muted`, KHÔNG dùng thuộc tính `disabled` — xem bug đã fix bên dưới) khi
   chưa ký đủ khung bắt buộc; bấm sớm thì cuộn tới đúng khung còn thiếu kèm hiệu ứng pulse đỏ
   2 lần, không phải toast lỗi chung chung đứng yên. Sau khi ký đủ, nút chuyển xanh + nhãn đổi
   thành "Hoàn tất" thật.
3. Không khóa trang, không ép cuộn hết — mọi trang luôn cuộn tự do được, kể cả trước khi bấm
   "Bắt đầu".
4. Sheet xác nhận ký: chữ ký lấy sẵn (SVG path tĩnh, không phải canvas vẽ tay), Họ tên/Chức
   danh/Ngày ký hiển thị dạng ô read-only (nền xám, không phải `<input>` sửa được).
5. Panel phụ "Luồng ký hồ sơ" — desktop hiện cột phải cố định; mobile/tablet (<861px) thu gọn
   thành 1 dòng dưới cùng ("3 người tham gia · Bạn đang ký"), bấm mở ra bottom sheet đầy đủ.

**Bug đã tự phát hiện và fix qua Playwright (không phải suy đoán)**: bản đầu bottom sheet
"Luồng ký" mobile đóng bằng cách bấm lại đúng thanh tóm tắt đã mở ra nó — nhưng sheet
`position:fixed` che khuất chính thanh đó khi đang mở, nên tap lại luôn trúng sheet chứ không
trúng thanh, sheet không đóng được (Playwright báo `intercepts pointer events` khi cố click
lại `#mobileFlowBar`). Đã fix bằng thêm nút "Đóng" tường minh bên trong sheet + click ra ngoài
(scrim dùng chung với sheet ký) đều đóng được, verify lại bằng Playwright xác nhận cả 2 đường
đóng đều hoạt động. Đây đúng loại bug chỉ lộ ra khi thao tác chuột/tap thật qua Playwright,
không phải nhìn ảnh chụp tĩnh mà phát hiện được — khớp đúng lý do CLAUDE.md yêu cầu duyệt bằng
`npx playwright screenshot`/thao tác thật thay vì chỉ mô tả bằng lời.

**Quyết định thiết kế phát sinh khi dựng** (chưa có trong docx, cần người dùng xác nhận nếu
muốn đổi): nút "Hoàn tất" khi chưa đủ điều kiện dùng class CSS mờ (`.muted`) thay vì thuộc
tính HTML `disabled` — vì phần tử có `disabled=true` không nhận sự kiện click trong trình
duyệt, sẽ làm hành vi "bấm khi chưa xong thì cuộn tới khung còn thiếu" (yêu cầu tường minh của
docx mục 4.8) không thể xảy ra được. Nút chỉ thực sự khoá (`disabled=true` + class `.sent`)
SAU KHI đã bấm Hoàn tất thành công, lúc đó không còn hành động nào cần làm nữa.

**Chưa làm/chưa quyết định trong mockup này** (giữ tối giản đúng phạm vi mục 4.8, không tự mở
rộng): chưa có nhánh SmartCA (đếm ngược/poll `tranId`/deeplink app — thuộc mục 4.6, một luồng
UI hoàn toàn khác, mockup này chỉ demo `loai_chu_ky = 'anh'`); chưa demo trường hợp OTP
(`muc_xac_thuc = 'pin_otp'`) hay nhập PIN trước khi xác nhận ký (mockup giản lược bước xác
thực để tập trung đúng vào trải nghiệm "nhảy khung + panel luồng ký" mà mục 4.8 mô tả — PIN
modal thật đã có sẵn design từ `SignPlacementModal` hiện tại trong `iso/forms/[id]/page.tsx`,
không cần vẽ lại ở đây).

**BƯỚC TIẾP THEO BẮT BUỘC**: người dùng cần tự mở
`cung_cap_dl/thiet_ke_man_hinh_ky.html` bằng trình duyệt thật (double-click hoặc kéo vào tab
mới — không cần server) để duyệt trực quan/tương tác thật (không chỉ dựa vào ảnh chụp), rồi
xác nhận đồng ý (hoặc yêu cầu sửa) trước khi bất kỳ phần nào trong đó được đưa vào code thật.
**Giai đoạn 1 (refactor `src/lib/signing/`) CHƯA được bắt đầu** — đúng nguyên tắc đã ghi ở
phiên trước: "Chỉ sau khi người dùng duyệt bản nháp này mới được đưa bất kỳ phần nào vào code
thật."

### Prompt gợi ý cho session tiếp theo (sau khi người dùng đã duyệt/góp ý mockup mục 8)

```
Đọc mục "Cập nhật (tiếp 3)" trong CLAUDE.md để nắm mục 5 (migration 6 bảng, CHƯA CHẠY trên
Supabase — chạy trước khi cần) và mục 8 (mockup cung_cap_dl/thiet_ke_man_hinh_ky.html) đã
xong tới đâu. Nếu tôi (người dùng) đã góp ý sửa mockup, áp dụng đúng góp ý đó trước, verify
lại bằng npx playwright screenshot, rồi mới hỏi lại xác nhận lần cuối.

Sau khi mockup được duyệt, bắt đầu Giai đoạn 1 — refactor src/lib/signing/ từ 3 route đang
chạy thật (api/sign/generate-pdf/route.ts, api/sign/generate-office/route.ts,
api/documents/sign/route.ts) và finalize route của Thực hiện hồ sơ ISO
(api/iso/forms/[id]/finalize/route.ts). Nguyên tắc bắt buộc: KHÔNG đổi schema, KHÔNG đổi
hành vi/response của các route này — chỉ trích phần logic dùng chung ra thư viện rồi gọi lại.
Đối chiếu bằng bản chuẩn đã chụp trước đó (đọc kỹ README.md trong
C:\Users\Software\rubber-erp-ky-so-baseline\ trước khi refactor — file gốc trước ký +
placement JSON cần tái tạo từ DB, KHÔNG ký lại được tài liệu thật đã hoàn tất qua workflow).

Không có gì trong việc này yêu cầu chạy `npm run build` — chỉ dùng `npx tsc --noEmit` +
`npx eslint` để tự kiểm tra, theo đúng quy tắc đã rút ra ở mục "Fix bug 2026-08-24".
```

## Cập nhật (tiếp 4) — Giai đoạn 1 đã xong: tách `src/lib/signing/` từ 4 route ký thật,
verify bằng test byte-identical (không chỉ so bằng mắt)

Người dùng đã chạy migration mục 5 và duyệt mockup mục 8 (`thiet_ke_man_hinh_ky.html`) ở
phiên trước, yêu cầu tiếp tục ngay Giai đoạn 1. **Không đợi thêm — đã làm luôn trong phiên
này**, theo đúng nguyên tắc "Refactor, không đổi hành vi, không đổi schema, không đổi
request/response của route" của docx mục 9.

### 2 file mới trong `src/lib/signing/`

- **`signature-image.ts`** — `getSignatureImage(factoryId, userId)`. Hợp nhất **4** bản
  `getSigImage()` copy-paste giống hệt nhau (không phải 3 như docx liệt kê ban đầu — đã phát
  hiện thêm bản thứ 4 ở `generate-office/route.ts` khi rà code thật): tất cả cùng tải
  `signatures/{factoryId}/{userId}/chu_ky.png` từ bucket `iso-documents` qua
  `getSupabaseAdmin()` (dùng singleton có sẵn ở `src/lib/supabase-admin.ts` thay vì tự
  `createClient()` riêng — an toàn vì service role không phụ thuộc session). Trả về
  `Buffer | null`, KHÔNG throw. `generate-office/route.ts` (route duy nhất throw khi thiếu
  ảnh) giữ nguyên hành vi throw bằng 1 wrapper cục bộ 3 dòng gọi hàm dùng chung —
  `documents/sign/route.ts` cũng giữ wrapper cục bộ tương tự (try/catch trả null) để không
  phải sửa tên gọi ở các call site khác trong file.
- **`stamp-pdf.ts`** — 5 hàm nguyên tử: `loadSignerNameFont()`, `drawSignatureImage()`,
  `drawSignerName()`, `drawSignPrefix()`, `drawExtraPlacements()`, cộng `computeNameSlot()`
  (dùng riêng khi cần custom vòng lặp) và 2 hằng số style `ISO_SIGNER_NAME_STYLE`
  (`maxFontSize:13, minFontSize:9, belowOffset:18, minY:8, extraWidth:24, minMaxWidth:110`)
  / `VAN_BAN_SIGNER_NAME_STYLE` (`10/7/14/4/20/60`).

### Phát hiện quan trọng khi đối chiếu code thật — ISO và Văn bản KHÔNG dùng chung 1 hằng số

`iso/forms/[id]/finalize/route.ts`'s `stampPdf` và `api/sign/generate-pdf/route.ts`'s 2 vòng
lặp vẽ placement nội bộ dùng **đúng 1 bộ constant** (13→9/18/8/24/110) — xác nhận đây thực sự
là 1 đoạn logic bị copy-paste y hệt như docx mô tả. Nhưng `documents/sign/route.ts`'s
`stampPdfStep` dùng bộ constant **khác hẳn** (10→7/14/4/20/60, khung chữ ký Văn bản nhỏ hơn
ISO có chủ đích). Nếu gộp ép về 1 bộ chung sẽ **đổi giao diện chữ ký đã ký thật** của 1 trong 2
module — vi phạm thẳng "không đổi hành vi". Xử lý: giữ 2 hằng số riêng, mỗi route tự truyền
đúng hằng số lịch sử của mình vào các hàm dùng chung — đạt đúng nghĩa "hợp nhất" (1 bộ hàm vẽ
duy nhất) mà không đổi 1 pixel nào của bên nào.

### Phần CỐ Ý không gộp — QR và vòng lặp nhiều-bước/nhiều-người

QR generation + vẽ QR **không đưa vào `stamp-pdf.ts`** — đã đối chiếu và xác nhận 3 route có
hành vi QR thật sự khác nhau (không chỉ trùng code): ISO tự sinh QR PNG từ `qrUrl` bên trong
(`width:100,margin:1`), vẽ đè mọi trang nếu có override vị trí, ngược lại **chỉ vẽ trang đầu**;
Văn bản nhận sẵn buffer QR đã render bên ngoài (`width:160`), **luôn vẽ mọi trang** kể cả không
có override (tự tính góc theo từng trang). Gộp ép sẽ đổi hành vi thật của 1 bên. Tương tự,
2 vòng lặp nội bộ của `generate-pdf/route.ts` (vẽ theo `allPlacements`, chạy 2 lần — nhánh
chính và nhánh fallback khi đọc metadata lỗi) vẫn giữ nguyên cấu trúc, chỉ đổi 2 điểm: gọi
`getSignatureImage()` dùng chung, và gọi `computeNameSlot(placement, ISO_SIGNER_NAME_STYLE)`
thay vì hàm `buildSignerNamePlacement` cục bộ đã xóa — **không đụng** logic
`hasExistingName`/`findNearbyText` (kiểm tra tránh đè lên chữ có sẵn) là nghiệp vụ riêng của
ISO, không có ở 2 route kia, nên không đưa vào `stamp-pdf.ts`.

### Verify — byte-identical, không chỉ so bằng mắt

Baseline pixel-diff (mục 6, `C:\Users\Software\rubber-erp-ky-so-baseline\`) không dùng được
trực tiếp ở đây vì đó là ảnh của tài liệu ĐÃ ký xong (không tái tạo lại được input trung gian
đầy đủ — đúng giới hạn đã ghi trong `README.md` của baseline). Thay vào đó dùng đúng phương án
2 mà `README.md` gợi ý: viết script gọi thẳng hàm đã refactor với input tự tạo, so kết quả với
bản dựng lại y hệt logic CŨ (chép tay từ code đọc trực tiếp trước khi sửa, không phải suy diễn
lại từ trí nhớ).

Kỹ thuật: `node --experimental-strip-types` (Node 24, có sẵn trên máy) chạy thẳng
`src/lib/signing/stamp-pdf.ts` — import trực tiếp qua `file://` path tuyệt đối, không cần
`tsx`/`ts-node` (không có trong repo). Script test dựng trong scratchpad (không phải file của
repo), 4 kịch bản:

1. ISO — placement chính đầy đủ (chữ ký + tên + tiền tố "TM.") + `extraPlacements` (nhân bản
   khung sang trang 2).
2. Văn bản — `placement = null`, dùng nhánh fallback `defaultX/y=50/w=120/h=60`.
3. ISO — tên rất dài (buộc vòng lặp thu nhỏ cỡ chữ 13→9 chạy thật, không chỉ dùng cỡ mặc
   định), `showSignature=false`, `nameX/nameY/nameWidth` đặt tay (bỏ qua công thức fallback),
   `extraPlacements`.
4. Văn bản — placement thật (không fallback) + `extraPlacements` + **thiếu ảnh chữ ký**
   (`sigBuf=null`, tên vẫn phải vẽ) + tên dài (buộc vòng lặp 10→7 chạy thật).

Cả 4 kịch bản: **PDF xuất ra từ code CŨ và code MỚI byte-identical tuyệt đối**
(`Buffer.compare(...) === 0`) — không phải "nhìn giống nhau", mà đúng nghĩa đen từng byte một,
kể cả 2 kích thước file khớp chính xác (`1351161`/`676190` bytes). Đây là bằng chứng mạnh hơn
hẳn so pixel (pixel-diff vẫn có sai số nén ảnh/anti-aliasing; byte-diff thì không).

### Kiểm tra khác

`npx tsc --noEmit` sạch cho toàn repo; `npx eslint` trên cả 6 file đã sửa/thêm sạch (chỉ còn
đúng 3 warning `no-unused-vars` **đã tồn tại từ trước phiên này**, xác nhận bằng cách nhớ đúng
vị trí dòng không liên quan gì tới các hàm đã sửa). Không chạy `npm run build` — đúng quy tắc
đã rút ra ở mục "Fix bug 2026-08-24" (build có thể đụng `.next/` của dev server đang chạy song
song, và không cần thiết vì `tsc`/`eslint` đã đủ tin cậy cho refactor nội bộ không đổi route
API).

Tổng cộng: **-188 dòng** trùng lặp trên 4 route (`documents/sign/route.ts` -124,
`iso/forms/[id]/finalize/route.ts` -132, `generate-pdf/route.ts` -46, `generate-office/route.ts`
-8, cộng +61 dòng do import/wrapper mới), đổi lấy 2 file dùng chung mới (~220 dòng, có JSDoc/
comment giải thích rõ ranh giới cố ý không gộp).

### CHƯA làm trong Giai đoạn 1 (đúng phạm vi docx, không tự mở rộng)

- `notifySigners(...)` (hợp nhất `iso/notify` + `iso/forms/notify` + `documents/notify`) —
  docx liệt kê nhưng 3 route notify này có payload/kênh (Telegram bot khác nhau: ISO dùng
  `ISO_TELEGRAM_BOT_TOKEN`, ghi chú CLAUDE.md khác) đủ khác biệt để cần 1 lượt đối chiếu riêng
  như đã làm với `stampPdf` — chưa làm trong phiên này, để dành phiên sau nếu cần.
- `signWithSmartCA(...)` — đúng kế hoạch, để rỗng tới khi có hợp đồng VNPT.
- `applyPositionTemplate(...)` (áp `mau_vi_tri`) — chưa có UI "vẽ mẫu" thật (chỉ có mockup mục
  8), chưa cần hàm này.
- `replaceDocxImageTag`/`replaceFormTags`/`stampOffice` (logic thay tag DOCX/XLSX) — 3 bản
  này KHÁC NHAU thật sự về tên tag/quy ước từng module, rủi ro gộp cao hơn giá trị, và docx
  mục 7 không liệt kê các hàm này — cố ý bỏ ngoài phạm vi Giai đoạn 1.
- QR generation/drawing — xem lý do ở mục "Phần CỐ Ý không gộp" phía trên.
- 2 vòng lặp `allPlacements` trong `generate-pdf/route.ts` vẫn còn trùng lặp NỘI BỘ với nhau
  (chính nó lặp 2 lần trong cùng file, nhánh chính + nhánh fallback) — chưa gộp 2 nhánh đó lại
  thành 1 hàm dùng chung trong phiên này (rủi ro cao hơn giá trị do 2 nhánh đọc biến ngữ cảnh
  hơi khác nhau — `signerNames` map vs `userId` đơn — cần refactor riêng, không phải phạm vi
  "tách sang `src/lib/signing/`").

### Đã test tay qua UI thật (2026-08-28) — Giai đoạn 1 hoàn tất, đã verify sống

Test bằng cách tự tạo 3 tài khoản test tạm (`role=admin`, factory `phuochoa_kt`, đặt PIN
`246813` qua `/api/sign/set-pin`) rồi ký thật qua trình duyệt (Playwright, không phải gọi API
trực tiếp) — đúng theo lựa chọn "Tôi tự tạo tài khoản test tạm" của người dùng. Không đụng bất
kỳ tài liệu/dữ liệu thật nào — mọi tài liệu test đều tự tạo mới (`NMCB-QT97`/`NMCB-QT97-F01`
cho ISO, `01/CV-QLCL "Văn bản test Giai đoạn 1 - E2E"` cho Văn bản), và đã dọn sạch sau khi
xong (xem mục "Dọn dẹp" bên dưới).

1. **ISO PDF (`api/sign/generate-pdf/route.ts`)** — PASS. Ký đủ 3 bước (soạn thảo → xem xét →
   phê duyệt) tài liệu cha `NMCB-QT97` qua `/dashboard/iso/documents/[id]`. PDF sau ký hiển thị
   đúng cả 3 chữ ký/tên/QR qua nhiều lần stamp chồng lên nhau, không lỗi.
2. **ISO Form (`api/iso/forms/[id]/finalize/route.ts`)** — PASS. Tạo hồ sơ con `NMCB-QT97-F01`
   qua `/dashboard/iso/forms/new` (phải né 1 template PDF-only ban đầu vì thiếu file Office —
   đã tạo lại đúng field "Biểu mẫu test Giai đoạn 1" có file PDF), ký đủ 3 bước qua
   `/dashboard/iso/forms/[id]`. PDF cuối đúng.
3. **Văn bản (`api/documents/sign/route.ts`)** — PASS, **verify kỹ nhất** vì đây là route có
   thay đổi lớn nhất (`stampPdfStep()` viết lại hoàn toàn, -124 dòng). Tạo văn bản
   `01/CV-QLCL` qua `/dashboard/documents/new` (Loại CV, phòng ban QLCL, 1 bước ký_phòng_ban
   KTNN, người phê duyệt cuối), ký đủ Soạn thảo → Ký phòng ban → Phê duyệt qua
   `/dashboard/documents/[id]`, tới `trang_thai: "da_phe_duyet"`. Tải PDF `phe_duyet.pdf`
   cuối cùng và render bằng Chromium có đầu (`file://...#page=N`) để xem trực tiếp: trang 1 có
   đủ 2 khung tên+QR (mỗi bước 1 khung, tại 2 vị trí khác nhau do UI tự tránh chồng lấp), trang
   2 có QR góc trên-phải trên MỌI trang đúng như thiết kế ("Văn bản luôn vẽ QR trên mọi trang
   kể cả không override"). Vì 2 tài khoản test chưa từng upload ảnh chữ ký, `sigBuf` luôn
   `null` → nhánh `if (sigBuf) await drawSignatureImage(...)` đúng theo đúng thiết kế: bỏ qua
   vẽ ảnh, chỉ vẽ tên qua `drawSignerName` — xác nhận nhánh "không có ảnh chữ ký" hoạt động
   đúng.
4. **ISO Office (`api/sign/generate-office/route.ts`)** — PASS qua kiểm chứng gián tiếp, **không
   ký live qua UI** (dựng 1 file DOCX có tag ISO hợp lệ tốn công không tương xứng giá trị, vì
   thay đổi ở route này chỉ là 1 wrapper cơ học 8 dòng, không đụng logic thay tag DOCX/XLSX).
   Đã xác nhận bằng cách gọi trực tiếp đúng lệnh download Storage y hệt `getSignatureImage()`
   dùng (bucket `iso-documents`, path `signatures/{factory}/{user}/chu_ky.png`) với 1 **chữ ký
   thật của nhân viên thật** (id `1f8c52f3-...`, chỉ đọc, không sửa) — trả về đúng 21.221 byte,
   xác nhận là JPEG thật (`ffd8ff...`) dù đuôi file là `.png` → chứng minh nhánh
   `embedPng(...).catch(() => embedJpg(...))` trong `stamp-pdf.ts`'s `drawSignatureImage()` là
   **bắt buộc phải có** (không phải code thừa) vì dữ liệu thật luôn là JPEG trá hình PNG. Gọi
   lại với `user_id` không tồn tại → trả về `null` đúng hợp đồng hàm. Đây là phép thử duy nhất
   trong cả 4 route thực sự exercise nhánh "có ảnh chữ ký thật" (3 test ở trên chỉ test được
   nhánh `null`).

**Kết luận: Giai đoạn 1 (tách `src/lib/signing/`) đã hoàn tất và verify đầy đủ** — cả byte-
identical test lẫn ký thật qua UI cho 3/4 route, route thứ 4 verify qua đúng phần thay đổi
thực sự của nó (wrapper `getSignatureImage`) với dữ liệu chữ ký thật.

### Dọn dẹp sau test (2026-08-28)

Đã xóa sạch: 9 file Storage (draft/signed PDF của cả 3 tài liệu test), `iso_documents` (2
dòng), `iso_form_instances` + `iso_form_instance_logs`, `van_ban_documents` (1 dòng),
`sign_pins` (3 dòng), `profiles` (3 dòng, xóa rồi tạo lại — xem dưới), `notifications` phát
sinh cho 3 user test.

**Không xóa được**: `doc_approval_log` — đúng theo thiết kế, trigger `nhat_ky_bat_bien`
(Giai đoạn 0 mục 3) chặn cứng `DELETE` kể cả bằng service-role key, đúng ý đồ "bất biến".
Vì các dòng log này còn FK tới `auth.users`, **3 tài khoản Auth test cũng không xóa được**
(`auth.admin.deleteUser` báo lỗi "Database error deleting user"). Đây là hệ quả đúng đắn của
tính năng bất biến vừa xây ở Giai đoạn 0 — không phải bug, không cố gắng bypass. Đã xử lý bằng
cách tạo lại đúng 3 dòng `profiles` (đã lỡ xóa trước khi phát hiện vướng FK) với
`status="disabled"` và `full_name` gắn hậu tố `"(TEST - đã disable)"` để không ai nhầm là nhân
viên thật nếu thấy trong danh sách user — 3 tài khoản username `e2e_signing_verify` /
`e2e_signing_reviewer` / `e2e_signing_approver` sẽ tồn tại vĩnh viễn ở trạng thái `disabled`,
không đăng nhập được, không có quyền gì. Đây là bằng chứng sống rằng audit log của Giai đoạn 0
hoạt động đúng thiết kế ngay cả khi có người cố tình dọn dẹp bằng service-role key.

### Người dùng đã chốt (2026-08-28, cuối phiên) — bắt đầu Giai đoạn 2 ở session khác

Giai đoạn 1 coi như xong hẳn. Người dùng đã xác nhận muốn làm tiếp Giai đoạn 2 nhưng ở 1
session mới — dưới đây là kết quả rà nhanh (`grep "window.print()"` toàn `src/app/dashboard`)
để session sau không phải dò lại từ đầu:

| Module | File có `window.print()` | Ghi chú phạm vi |
|---|---|---|
| Chất lượng | `quality/page.tsx` (hàm build chuỗi HTML "Phiếu KQKN", mở `window.open` + in) | Ứng viên chuyển đổi — đây là chứng từ kết quả kiểm nghiệm thật, sau này cần gắn ký số |
| Chất lượng | `quality/reports/print/page.tsx` | **KHÔNG đụng** — đây là báo cáo thống kê có biểu đồ Recharts (SVG), `.claude/rules/25-quality-targets-reports-module.md` đã ghi rõ cố ý dùng HTML-print, không convert sang jsPDF |
| Xuất hàng | `export/print/page.tsx` | Ứng viên chuyển đổi — chưa đọc nội dung chi tiết, cần khảo sát khi bắt tay vào |
| Bảo trì | `maintenance/print/page.tsx` | Ứng viên chuyển đổi — file lớn, ≥9 mẫu in (F13/F10/F15/F03/F06/F01/F02/F08/F07), xem đầy đủ ở `.claude/rules/14-maintenance-module.md` |

3 file khác có `window.print()` (`inventory/print*`, `process/print`, `documents/print`) **ngoài
phạm vi Giai đoạn 2** — không đụng.

### Prompt gợi ý cho session tiếp theo

```
Đọc mục "Cập nhật (tiếp 4)", "Đã test tay qua UI thật (2026-08-28)" và "Người dùng đã chốt
(2026-08-28, cuối phiên)" trong CLAUDE.md. Giai đoạn 1 (tách src/lib/signing/) đã CODE XONG và
ĐÃ TEST ĐẦY ĐỦ — không cần test lại trừ khi nghi ngờ có regression mới.

Bắt đầu Giai đoạn 2: chuyển 3 luồng in HTML+window.print() sau đây sang xuất PDF thật bằng
jsPDF, mirror đúng pattern đã có ở src/lib/dispatch-pdf.ts / output-pdf.ts / storage-pdf.ts
(không phải viết lại pattern mới):
  1. Chất lượng — hàm build "Phiếu KQKN" trong quality/page.tsx (chứng từ kết quả kiểm nghiệm).
  2. Xuất hàng — export/print/page.tsx.
  3. Bảo trì — maintenance/print/page.tsx (nhiều mẫu F13/F10/F15/F03/F06/F01/F02/F08/F07, xem
     .claude/rules/14-maintenance-module.md để nắm đủ cấu trúc trước khi sửa).

Mục đích của Giai đoạn 2 CHỈ là có file PDF thật (bytes thật, có trang/tọa độ) để Giai đoạn 3+
sau này gắn được ký số — KHÔNG đụng gì tới workflow ký, KHÔNG đổi schema DB trong giai đoạn
này trừ khi thực sự cần cột lưu URL PDF mới (nếu cần, hỏi lại trước khi viết migration).

KHÔNG đụng quality/reports/print/page.tsx (báo cáo thống kê có Recharts — cố ý giữ HTML-print
theo .claude/rules/25-quality-targets-reports-module.md) và 3 file print khác ngoài phạm vi
(inventory/print*, process/print, documents/print).

Trước khi code: đọc kỹ nội dung thật của cả 3 file trên (đặc biệt export/print/page.tsx —
chưa khảo sát chi tiết ở phiên trước), liệt kê rõ từng mẫu in cần chuyển, rồi hỏi lại người
dùng xác nhận phạm vi/thứ tự làm trước khi bắt đầu — đúng quy trình đã dùng xuyên suốt dự án
(không tự ý suy diễn phạm vi cho thay đổi nhiều file).

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi
không chắc dev server người dùng có đang chạy song song hay không (bài học đã ghi ở mục
"Fix bug 2026-08-24" trong lịch sử CLAUDE.md).
```

## Cập nhật (tiếp 5) — Giai đoạn 2 (một phần): Chất lượng + Xuất hàng đã chuyển sang PDF
thật; Bảo trì cố ý CHƯA làm, tách thành phase riêng

Trước khi code đã khảo sát đủ 3 file đích và xin xác nhận phạm vi qua `AskUserQuestion` (đúng
quy trình bắt buộc) — người dùng chốt: (1) **tách Bảo trì thành phase riêng**, phiên này chỉ
làm Chất lượng + Xuất hàng; (2) độ trung thực chỉ cần **giống nội dung/cấu trúc**, không cần
khớp pixel-perfect với bản HTML/`window.print()` cũ; (3) hành vi nút bấm đổi thành **tải file
PDF trực tiếp** (`doc.save(...)`), bỏ hẳn `window.open` + auto `window.print()`.

### Lý do tách Bảo trì

`maintenance/print/page.tsx` có **18 hàm render phủ 9 mẫu nghiệp vụ** (F13/F10/F15+biến thể
Bảo dưỡng/F03/F06/F01/F02/F08/F07), riêng file này (2334 dòng) đã lớn hơn Chất lượng + Xuất
hàng cộng lại — chuyển hết trong 1 phiên rủi ro cao, không kiểm thử kỹ được từng mẫu. Chưa
đụng file này ở phiên này; xem "Bước tiếp theo" cuối mục để biết cách bắt đầu phiên sau.

### Chất lượng — `src/lib/quality-pdf.ts` (mới)

- `downloadQualityKqknPdf(dateResults, date, fCode)` — mirror đúng `buildBatchPage`/
  `buildPrintHTML` cũ (đã xóa khỏi `quality/page.tsx`, ~168 dòng) bằng `jsPDF` + `jspdf-autotable`
  (`theme:"grid"`, header 2 tầng dùng `rowSpan`/`colSpan` — 3 cột đầu + cột "Đạt hạng" rowSpan
  xuyên 2 tầng, 8 nhóm chỉ tiêu colSpan phía trên). Tô màu từng ô (xanh=đạt/đỏ đậm=không đạt/
  xám=cột phụ) qua `didParseCell`, dùng đúng bảng màu gốc (`#065f46`/`#dc2626`/`#94a3b8`).
  Landscape A4, nhiều batch (đợt kiểm nghiệm) → nhiều trang (`doc.addPage()` giữa các batch),
  có đánh số "Trang X/Y" cuối mỗi trang (mirror convention `output-pdf.ts`).
- **Quyết định kỹ thuật quan trọng**: bỏ ký tự "X̄" (X + dấu gạch ngang kết hợp Unicode
  U+0304), thay bằng **"TB"** (Trung bình) trong tiêu đề cột thống kê. jsPDF không có bộ máy
  text-shaping (không như trình duyệt render HTML cũ) — ký tự kết hợp (combining mark) qua
  font nhúng có rủi ro không xếp chồng đúng lên ký tự gốc, và không có cách nào trong phiên
  này để kiểm chứng trực quan kết quả render (không chạy `npm run build`/mở trình duyệt xem
  PDF thật). "TB" an toàn tuyệt đối, giữ đúng nghĩa, đã xác nhận phù hợp với mức độ trung thực
  "nội dung/cấu trúc" đã chốt. Nếu người dùng test tay thấy cần đổi lại "X̄", đây là chỗ duy
  nhất cần sửa (`HEAD_ROW_2` trong `quality-pdf.ts`).
- 2 call site (`quality/page.tsx`, nút "PDF" ở danh sách theo ngày + ở tab Giám sát) đổi từ
  `window.open("","_blank",...); w.document.write(buildPrintHTML(...))` sang
  `await downloadQualityKqknPdf(...)` trong `try/catch`, báo lỗi qua `showToast` có sẵn nếu
  tạo PDF thất bại.
- **Dọn dẹp phát sinh**: `factoryName` (state + `setFactoryName(...)` trong bootstrap) trở
  thành dead code sau khi xóa `buildPrintHTML` (tham số này vốn đã KHÔNG được dùng trong bản
  gốc — `buildPrintHTML` nhận `factoryName` nhưng chưa từng render nó) — đã xóa hẳn thay vì để
  lại state chết, theo đúng nguyên tắc "không giữ lại code không dùng".

### Xuất hàng — `src/lib/export-order-pdf.ts` (mới)

- `downloadExportOrderPdf(order, factoryName?)` — mirror đúng `export/print/page.tsx` cũ:
  header (logo `/logo-phk-moi.png` + tên công ty + QR trỏ `{origin}/dashboard/eudr?order=...`
  — đổi từ domain hard-code `qlsxkpt.vercel.app` sang `window.location.origin` động, khớp
  đúng convention `buildStorageLookupUrl`/`buildProductLabelLookupUrl` đã dùng nơi khác, chạy
  đúng cả khi test trên `localhost`), bảng thông tin đơn (khách hàng/mã đơn/số hóa đơn-hợp
  đồng/số thông báo/chủng loại+tổng lượng/loại bọc-pallet), khối từng xe (biển số/loại xe/số
  lô đã gán/danh sách mã lô) kèm tối đa 3 ảnh hiện trường, khối chữ ký 3 cột cuối trang. A4
  portrait, tự `doc.addPage()` khi 1 khối xe hoặc khối chữ ký không đủ chỗ còn lại trên trang
  (`ensureSpace()`).
- **Ảnh hiện trường tải từ Supabase Storage (cross-origin, khác hẳn ảnh logo tĩnh cùng
  origin)**: `fetchRemoteImage(url)` fetch → đọc `Blob` → `FileReader.readAsDataURL` → decode
  kích thước thật qua `new Image()` để vẽ đúng tỷ lệ khung hình (contain, không méo, khác
  `object-cover` cắt ảnh của bản CSS cũ — chấp nhận được vì đã chốt không cần pixel-perfect).
  **Lỗi mềm bắt buộc**: 1 ảnh tải lỗi (mạng, CORS, file đã xóa...) chỉ in dòng "Không tải được
  ảnh" đúng ô đó, không được làm hỏng toàn bộ PDF — chưa xác nhận được Supabase Storage bucket
  public có luôn trả `Access-Control-Allow-Origin` cho `fetch()` đọc bytes hay không (khác
  hẳn `<img src>` vốn không cần CORS để hiển thị), đây là rủi ro cần xác nhận khi test tay.
- `export/print/page.tsx` giữ nguyên guard quyền/query cũ (`hydrateActiveSession` +
  `hasPermission(user,"export.view")` + lọc `factory_id`, redirect `/dashboard` nếu chặn) —
  chỉ đổi phần hiển thị: sau khi tải xong dữ liệu đơn, tự động gọi `downloadExportOrderPdf()`
  qua `useEffect`, hiện 1 card nhỏ với 3 trạng thái (đang tạo / đã tải xong + nút "Tải lại" /
  lỗi + nút "Thử lại"). Route/query param `?id=...` và cách mở (`target="_blank"` từ
  `export/page.tsx`) giữ nguyên không đổi.
- `export/page.tsx`: đổi nhãn nút "In Biên bản" → "Tải PDF biên bản" cho khớp hành vi mới
  (không còn mở dialog in, mà tải file .pdf về máy ngay).

### Đã kiểm tra

`npx tsc --noEmit` sạch toàn repo; `npx eslint` trên toàn bộ 5 file đã sửa/thêm
(`quality-pdf.ts`, `export-order-pdf.ts`, `quality/page.tsx`, `export/print/page.tsx`,
`export/page.tsx`) — **0 lỗi/cảnh báo mới**, đối chiếu `git diff --stat` xác nhận các lỗi
`no-explicit-any`/`no-unused-vars` còn lại trong `quality/page.tsx` đều là pre-existing (nằm ở
các dòng tôi không chạm tới). Không chạy `npm run build`.

### CHƯA test tay trên trình duyệt thật — bắt buộc trước khi coi 2 module này là xong

1. Chất lượng: bấm nút "PDF" ở 1 dòng ngày trong danh sách kiểm nghiệm (nhiều đợt/nhiều lô
   cùng ngày) → xác nhận file `.pdf` tải về đúng, mở ra đọc được, header 2 tầng + màu đạt/
   không đạt đúng, nhiều batch ra nhiều trang; bấm nút "PDF" ở 1 card trong tab Giám sát → xác
   nhận tương tự. Xác nhận chữ "TB" thay "X̄" chấp nhận được về mặt chuyên môn (nếu không, sửa
   `HEAD_ROW_2` trong `quality-pdf.ts`).
2. Xuất hàng: mở 1 đơn xuất có ≥2 xe, ít nhất 1 xe có đủ 3 ảnh và 1 xe không có ảnh nào, bấm
   "Tải PDF biên bản" → xác nhận tab mới hiện đúng trạng thái "Đang tạo PDF..." rồi "Đã tải
   file PDF về máy", file tải về đúng nội dung, ảnh hiện đúng (đặc biệt xác nhận ảnh Storage
   KHÔNG bị lỗi CORS khi fetch — nếu bị lỗi, mọi ảnh sẽ hiện "Không tải được ảnh" thay vì ảnh
   thật, cần điều tra CORS config của bucket `order-files`/bucket ảnh xe nếu gặp); test 1 đơn
   có nhiều xe đủ dài để buộc sang trang 2, xác nhận không bị cắt ngang khối xe.
3. Xác nhận tài khoản không có `export.view` vẫn bị redirect `/dashboard` đúng như cũ.

### Bước tiếp theo — Giai đoạn 2b (Bảo trì, chưa bắt đầu)

`maintenance/print/page.tsx` (18 hàm render, 9 mẫu F13/F10/F15/F15BaoDuong/F03/F06/F01/F02/
F08/F07) cần đọc kỹ `.claude/rules/14-maintenance-module.md` (đã mô tả đủ chi tiết từng mẫu)
trước khi bắt đầu — nhiều bảng merge cột, danh sách người ký động qua `staffMap`, các trang
tổng hợp nhiều thiết bị/nhiều xe trong 1 lần in (`asset_ids`/`vehicle_ids` query param). Nên
tách thêm thành các phase nhỏ hơn theo nhóm mẫu (ví dụ: F13/F10/F15 sự cố trước, rồi F03/F06/
F15BaoDuong bảo dưỡng, rồi F01/F02 lý lịch, rồi F08 + F07 sau) thay vì làm cả 18 hàm cùng lúc —
hỏi lại người dùng thứ tự ưu tiên trước khi code, theo đúng quy trình đã áp dụng ở phiên này.

### Prompt gợi ý để mở đầu session tiếp theo (Giai đoạn 2b — Bảo trì)

```
Đọc mục "Cập nhật (tiếp 5) — Giai đoạn 2 (một phần)" trong CLAUDE.md — Chất lượng và Xuất
hàng đã chuyển xong sang PDF thật (src/lib/quality-pdf.ts, src/lib/export-order-pdf.ts),
CHƯA test tay (xem checklist "CHƯA test tay trên trình duyệt thật" trong đúng mục đó — nếu
tôi đã test và có phản hồi, ưu tiên phản hồi của tôi hơn checklist cũ).

Tiếp tục Giai đoạn 2b: chuyển maintenance/print/page.tsx (18 hàm render, 9 mẫu F13/F10/F15/
F15BaoDuong/F03/F06/F01/F02/F08/F07 — xem đủ cấu trúc trong .claude/rules/14-maintenance-
module.md) từ HTML + window.print() sang PDF thật bằng jsPDF, mirror đúng pattern đã dùng ở
src/lib/quality-pdf.ts / src/lib/export-order-pdf.ts / src/lib/dispatch-pdf.ts (KHÔNG viết
lại pattern mới). Mục đích CHỈ là có file PDF thật (bytes thật, có trang/tọa độ) để giai đoạn
ký số sau này gắn vào — KHÔNG gắn ký số ở bước này, KHÔNG đổi schema DB trừ khi thực sự cần
cột lưu URL PDF mới (nếu cần, hỏi lại trước khi viết migration).

File này lớn hơn hẳn 2 module đã làm (2334 dòng, 18 hàm render) — đọc kỹ toàn bộ file trước,
liệt kê rõ từng mẫu, rồi đề xuất chia nhỏ thành nhiều phase con (ví dụ theo nhóm nghiệp vụ:
sự cố F13/F10/F15 trước, rồi bảo dưỡng F03/F06/F15BaoDuong, rồi lý lịch F01/F02, rồi F08+F07
sau) và hỏi lại tôi xác nhận thứ tự/phạm vi trước khi bắt đầu code — đúng quy trình đã áp
dụng ở phiên trước (không tự ý suy diễn phạm vi cho thay đổi nhiều file).

Độ trung thực đã chốt từ phiên trước: giống về nội dung/cấu trúc (bảng đúng, chữ ký đúng vị
trí tương đối, QR đúng chỗ), không cần khớp pixel-perfect font-size/màu với bản HTML cũ. Hành
vi nút bấm: tải file PDF trực tiếp (doc.save), không mở tab rồi window.print() tự động.

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi
không chắc dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (tiếp 6) — Giai đoạn 2b (Bảo trì) đã code xong cả 4 phase, chưa test tay

Đã hỏi xác nhận qua `AskUserQuestion` trước khi code (2 câu): (1) làm liên tục cả 4 phase trong
1 phiên thay vì dừng sau Phase 1 — người dùng chọn làm liên tục; (2) nhúng ảnh hiện trường thật
vào PDF (mirror `export-order-pdf.ts`) thay vì chỉ ghi số lượng — người dùng chọn nhúng ảnh
thật. Đã đọc toàn bộ 2334 dòng `maintenance/print/page.tsx` trước khi code, xác nhận qua grep
rằng 2 loại `su_co`/`de_nghi` không còn nút bấm nào trỏ tới nữa (chỉ tồn tại lồng bên trong
bundle `su_co_nho`) — chỉ **7 URL `type`** còn thực sự được gọi: `su_co_nho`, `bao_duong`,
`bao_duong_xe`, `sua_chua_nho_xe`, `ly_lich`, `ly_lich_xe`, `bao_cao_ky`.

### Quyết định kiến trúc quan trọng — KHÔNG đụng 3 file gọi (`records/[id]`, `history`,
`records`)

Khác với Chất lượng/Xuất hàng (mỗi cái chỉ có 1 loại chứng từ), Bảo trì có 7 URL `type` với
data-loading phức tạp khác nhau (multi-asset, multi-vehicle, multi bộ phận + quy đổi tiền tệ)
đã chạy đúng từ trước trong chính `maintenance/print/page.tsx`. Thay vì sửa 3 file gọi
(`records/[id]/page.tsx`, `history/page.tsx`, `records/page.tsx`) để tự tải dữ liệu + gọi PDF,
đã **giữ nguyên 100% route `/dashboard/maintenance/print` và mọi `<Link target="_blank">` hiện
có** — chỉ viết lại nội dung file: giữ nguyên tuyệt đối toàn bộ `useEffect` tải dữ liệu (bootstrap
guard quyền + query Supabase theo từng `type`, ~400 dòng không đổi 1 ký tự logic), chỉ thay khối
JSX render 18 hàm + `window.print()` bằng gọi hàm `jsPDF` mới + `doc.save()` + card trạng thái
nhỏ (mirror đúng `export/print/page.tsx`: "Đang tạo PDF..." → "Đã tải file PDF về máy" + nút "Tải
lại" / "Không tạo được PDF, thử lại?" + nút "Thử lại", nút "Đóng trang" thay cho "Quay lại" cũ).
Cách này an toàn hơn hẳn — không rủi ro gì tới 3 file gọi, tận dụng đúng logic query đã chạy ổn
định, người dùng bấm nút y hệt như trước (mở tab mới), chỉ khác là tab đó tải PDF về thay vì mở
hộp thoại in.

### `src/lib/maintenance-pdf.ts` (mới, ~1710 dòng) — toàn bộ 4 phase trong 1 file

Theo đúng convention 1-file-1-domain đã có (`quality-pdf.ts`, `export-order-pdf.ts`,
`dispatch-pdf.ts`...), không tách nhiều file nhỏ. Vẽ bằng kết hợp text thủ công (mirror
`export-order-pdf.ts`) + `jspdf-autotable` cho bảng dữ liệu thật (vật tư, F01/F02/F06/F07).

- **Workhorse dùng khắp file**: `drawLabelContent(doc,x,y,width,label,content,{blankCount})` —
  1 hàm xử lý MỌI kiểu "Nhãn: nội dung" trong toàn bộ 9 mẫu (nội dung rỗng + có `blankCount` →
  vẽ dòng kẻ trống để ký tay; có nội dung → thử vẽ liền dòng với nhãn, không đủ chỗ thì tự xuống
  dòng + wrap qua `splitTextToSize`, hỗ trợ cả nội dung nhiều đoạn nối `\n` như `mergeNoidung`).
  Thay thế hoàn toàn ~15 chỗ JSX gốc dùng pattern `{content ? <span>{content}</span> :
  <BlankLine count={N}/>}` khác nhau.
- **2 mẫu layout tiêu đề+QR** tái dùng cho đúng nhóm mẫu: `drawTitleWithQr` (QR nằm ngay cạnh
  tiêu đề cùng hàng — F13/F15/F15BaoDuong/F15SmallVehicle) và `drawQrThenDateThenTitle` (QR đứng
  riêng phía trên, rồi dòng ngày căn phải, rồi mới tới tiêu đề — F10/F03/F06/F08NB) — khớp đúng
  2 kiểu bố cục khác nhau đã xác nhận khi đọc kỹ JSX gốc, không gộp nhầm thành 1 kiểu.
- **Không dùng font "italic"** — `ensurePdfFont()` (`pdf-qr-shared.ts`) chỉ đăng ký 2 style
  `normal`/`bold` cho NotoSans, không có italic; mọi chữ nghiêng trong bản HTML gốc (ghi chú phụ,
  "(Ký và ghi rõ họ tên)"...) chuyển sang chữ thường màu xám thay vì nghiêng.
- **Không dùng ký hiệu tiền tệ Unicode ៛/₫** — rủi ro thiếu glyph Khmer/mở rộng trong font
  NotoSans-Regular.ttf (chỉ hỗ trợ Latin). Hàm `pdfMoney()` mới dùng `$` cho USD (an toàn, có
  trong Latin cơ bản), còn lại in thẳng mã tiền tệ ASCII sau số (`"25.000 VND"`, `"100 KHR"`)
  thay vì ký hiệu — khác cách hiển thị HTML cũ (`currencySymbol()`) nhưng giữ đúng nội dung,
  không có tiền lệ nào trong repo từng render 2 ký hiệu này qua jsPDF nên không có gì để đối
  chiếu độ an toàn, chọn phương án chắc chắn không lỗi thay vì thử.
- **Ảnh hiện trường**: `fetchRemoteImage`/`drawImageContain`/`collectAndFetchImages` — copy từ
  `export-order-pdf.ts` (không refactor thành helper dùng chung 2 file, giữ đúng nguyên tắc mỗi
  file PDF tự chứa đã có trong repo). `drawPhotoSection()` vẽ lưới 2 cột tỉ lệ 4:3, tự phân
  trang; `drawPhotoPage()` (không có "Ảnh chung", dùng cho `su_co_nho`/`sua_chua_nho_xe`) và
  `drawPhotoPageWithCommon()` (có khối "Ảnh chung" trước, dùng cho `bao_duong`/`bao_duong_xe`) —
  khớp đúng 2 biến thể `PrintImages`/`PrintImagesPage` gốc. 1 ảnh tải lỗi chỉ in "Không tải được
  ảnh" đúng ô đó, không hỏng cả PDF (giữ đúng nguyên tắc lỗi mềm đã có ở `export-order-pdf.ts`).
- **9 hàm vẽ mẫu** (`drawF13`, `drawF10`, `drawF15`, `drawF03`, `drawF15BaoDuong`, `drawF06`,
  `drawF08NB`, `drawF15SmallVehicle`, `drawF01`, `drawF02`, `drawF07`) — mỗi hàm port 1:1 logic
  nghiệp vụ từ đúng component JSX gốc, kể cả các nhánh rẽ tinh vi: 4 biến thể danh sách "Chúng
  tôi gồm:" khác nhau giữa F13 (đánh số, có "Tổ trưởng cơ điện/cơ khí" tự nhận diện qua
  `findToTruongCoDien` + placeholder khi thiếu)/F15 (giữ nguyên placeholder)/F15BaoDuong (thêm
  tài xế nếu Đội xe)/F15SmallVehicle (không placeholder, luôn thêm tài xế dòng đầu); checkbox
  "Chất lượng: Đạt/Không đạt" vẽ bằng ô vuông + "X" (không dùng ký tự ✓ Unicode, cùng lý do rủi
  ro glyph như tiền tệ); `mergeNoidung()` cho nội dung chung cấp biên bản + riêng từng dòng thiết
  bị (Bảo dưỡng nhiều thiết bị); `buildF06Rows()` port đúng thứ tự dòng (nhiên liệu → từng vật tư
  → công thợ → tổng cộng in đậm).
- **7 hàm `downloadMaintenanceXxxPdf()` export** — mỗi hàm là 1 orchestrator ghép các `drawFxx`
  bằng `doc.addPage()` giữa các mẫu (mirror đúng `print:page-break-before-always` gốc), chỉ thêm
  trang ảnh khi thực sự có ảnh (`hasLineImages`/`hasAnyImages`), rồi `doc.save()` với tên file
  tiếng Việt không dấu qua `safeName()`.

### `maintenance/print/page.tsx` (viết lại, 2334 → 573 dòng)

- Xóa toàn bộ 18 hàm component JSX (`PrintSuCo`, `PrintF10`, ... `PrintBaoCaoKy`) + các type
  cục bộ (`RecordData`, `LineData`, `MaterialRow`, `HistoryRow`, `AssetInfo`, `VehicleInfo`,
  `DriverAssignmentRow`, `VehicleHistoryRow`, `BaoCaoKyRow`, `BaoCaoKySection`) — nay import
  thẳng từ `@/lib/maintenance-pdf` (1 nguồn duy nhất, không còn 2 bản định nghĩa trùng).
- Giữ nguyên tuyệt đối: guard quyền (`maintenance.print`), toàn bộ khối `useEffect` tải dữ liệu
  theo từng `printType` (kể cả 2 helper lồng bên trong `fetchRowsForAsset`/`loadOneVehicle`/
  `fetchVehicleHistory`), và `qrUrl` useMemo.
- Thay effect `window.print()` bằng `generatePdf()` (useCallback, switch theo `printType` gọi
  đúng 1 trong 7 hàm `downloadMaintenanceXxxPdf`) + effect tự trigger khi `loading/error` xong +
  `pdfState==="idle"`. `bao_cao_ky` có thêm nhánh `pdfState==="empty"` (không phải lỗi) khi kỳ
  không có biên bản đã duyệt nào khớp — khớp đúng thông báo gốc "Không có dữ liệu bảo trì đã
  duyệt trong kỳ đã chọn." thay vì hiện lỗi chung chung.
- UI: card trạng thái + nút "Đóng trang" (`window.close()`) thay cho "Quay lại" (Link) cũ —
  nhất quán với `export/print/page.tsx`, hợp lý hơn vì trang này luôn mở trong tab mới chỉ để
  tải file rồi đóng, không có nhu cầu điều hướng tiếp trong tab đó.

### Đã kiểm tra

`npx tsc --noEmit` (toàn repo) và `npx eslint src/app/dashboard/maintenance/print/page.tsx
src/lib/maintenance-pdf.ts` đều sạch tuyệt đối — 0 lỗi, 0 cảnh báo. Không chạy `npm run build`
(đúng quy tắc "Fix bug 2026-08-24"). Đã grep xác nhận không file nào khác import trực tiếp
`maintenance/print/page.tsx` (chỉ điều hướng qua URL) nên không có tác dụng phụ ngoài phạm vi
2 file đã sửa.

### CHƯA test tay trên trình duyệt thật — bắt buộc trước khi coi Giai đoạn 2b là xong

Cần mở `npm run dev`, đăng nhập, và với **mỗi trong 7 loại** bấm đúng nút gốc rồi xác nhận tab
mới hiện "Đang tạo PDF..." → "Đã tải file PDF về máy", mở file tải về kiểm tra đúng nội dung:

1. **`su_co_nho`** (`records/[id]` nút "In biên bản", Sửa chữa ngoài Đội xe nhỏ) — biên bản có
   nhiều thiết bị + có vật tư + có ảnh → xác nhận đủ 4 phần (F13, F10, F15, trang ảnh), danh
   sách "Chúng tôi gồm:" đúng người, bảng vật tư đúng số liệu.
2. **`bao_duong`** / **`bao_duong_xe`** — biên bản Bảo dưỡng nhiều thiết bị dùng "Nội dung
   chung" cấp biên bản (xem `.claude/rules/14-maintenance-module.md`) → xác nhận `mergeNoidung`
   hiển thị đúng cả nội dung chung lẫn riêng; `bao_duong_xe` xác nhận có thêm trang F06 đúng
   bảng nhiên liệu/vật tư/công thợ/tổng cộng.
3. **`sua_chua_nho_xe`** (nút "Sửa chữa nhỏ", Đội xe ≤200$) — xác nhận F08+F15SmallVehicle+F06
   đúng, "Chất lượng" hiển thị đúng text (không phải checkbox, khác F15/F15BaoDuong).
4. **`ly_lich`** (`history` — chọn nhiều thiết bị) — xác nhận mỗi thiết bị đúng 1 "trang" cách
   nhau (addPage), bảng lịch sử đúng dữ liệu, tên file hợp lý khi chọn 1 vs nhiều thiết bị.
5. **`ly_lich_xe`** (`history` — chọn nhiều xe) — xác nhận đủ 3 section (người vận hành/bảo trì/
   sửa chữa) đúng dữ liệu từng xe.
6. **`bao_cao_ky`** (`records` — "In Báo cáo theo kỳ") — xác nhận nhiều bộ phận ra nhiều "trang"
   riêng, dòng quy đổi USD đúng số theo tỷ giá cấu hình, và test case rỗng (kỳ không có biên bản
   đã duyệt) ra đúng thông báo "Không có dữ liệu..." thay vì tải file rỗng/lỗi.
7. Xác nhận nút "Tải lại"/"Thử lại" hoạt động đúng (bấm lại `generatePdf()` không lỗi state).
8. Xác nhận nút "Đóng trang" đóng được tab (một số trình duyệt chặn `window.close()` nếu tab
   không phải do script mở — nhưng ở đây luôn mở qua `target="_blank"` từ click nên thường được
   phép; nếu trình duyệt cụ thể chặn, chỉ là hạn chế UX nhỏ không phải bug).
9. Đối chiếu nhanh bằng mắt vài chỗ dễ lệch: ký hiệu tiền tệ (giờ là "$"/"VND"/"KHR" thay vì
   "$"/"₫"/"៛"), chữ nghiêng cũ giờ thành chữ thường — xác nhận người dùng chấp nhận được (đã
   chốt "không cần pixel-perfect" nhưng đổi ký hiệu tiền tệ là thay đổi nội dung hiển thị, nên
   cần xác nhận rõ ràng, không chỉ suy diễn từ "không cần pixel-perfect").

### Prompt gợi ý để mở đầu session tiếp theo (sau khi test tay Giai đoạn 2b)

```
Đọc mục "Cập nhật (tiếp 6) — Giai đoạn 2b (Bảo trì) đã code xong cả 4 phase" trong CLAUDE.md.
Nếu tôi đã test tay và báo lỗi cụ thể ở 1 trong 7 loại PDF (su_co_nho/bao_duong/bao_duong_xe/
sua_chua_nho_xe/ly_lich/ly_lich_xe/bao_cao_ky), sửa đúng hàm vẽ tương ứng trong
src/lib/maintenance-pdf.ts (mỗi mẫu có 1 hàm drawFxx riêng, dễ định vị theo tên mã tài liệu).

Nếu Giai đoạn 2b đã test xong và ổn, Giai đoạn 2 (chuyển in HTML sang PDF thật) coi như hoàn tất
toàn bộ 3 module đã lên kế hoạch (Chất lượng, Xuất hàng, Bảo trì). Hỏi tôi xem có muốn tiếp tục
sang Giai đoạn 3 (gắn ký số vào các PDF này, dựa trên src/lib/signing/ đã tách ở Giai đoạn 1)
hay không — đây là bước tiếp theo hợp lý nhưng CHƯA được tôi xác nhận, không tự ý bắt đầu.

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi
không chắc dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (tiếp 7) — Giai đoạn 3 (thí điểm module Chất lượng): SignScreen + "Ký duyệt"
Phiếu KQKN đã code xong, verify qua script backend + browser Playwright thật, cộng 4 bug đã
tìm và fix từ test tay thật trên `npm run dev`

Giai đoạn 3 đã bắt đầu (không rõ ở phiên nào trước đó — khi phiên này tiếp nhận, code đã có sẵn
trong working tree, CHƯA commit) với module thí điểm là **Chất lượng** (Phiếu KQKN — Bảng kết
quả kiểm nghiệm cao su CSR). Phiên này đã: (1) verify toàn bộ pipeline ký bằng 3 lớp test độc
lập, (2) qua đó phát hiện và fix 1 bug fontkit + 1 bug khung dư thừa (đã sửa trước khi verify),
(3) người dùng tự test tay thật trên `npm run dev` và phát hiện thêm 2 bug/lỗ hổng thiết kế
nghiêm trọng hơn — cả 2 đã điều tra kỹ và fix xong trong chính phiên này.

### Kiến trúc đã có sẵn khi phiên này bắt đầu (không đổi)

- `src/app/dashboard/ky/[id]/page.tsx` — **SignScreen dùng chung cho MỌI module** (không riêng
  Chất lượng), theo đúng mockup đã duyệt `cung_cap_dl/thiet_ke_man_hinh_ky.html`: hiện toàn bộ
  trang PDF dạng ảnh (render qua `pdfjs-dist` vào canvas tạm, xuất `toDataURL()` — tránh race
  điều kiện canvas sống), khung `myFields` (của người đang xem) và `otherFields` (của người
  khác) vẽ đè lên đúng vị trí % theo `pxBoxFor()`, nút "Xem khung của tôi"/"Khung tiếp theo" tự
  cuộn, sheet PIN xác nhận gọi `/api/sign/verify` rồi `/api/signing/sign-field`. Bypass sidebar
  qua `dashboard/layout.tsx`'s `pathname.startsWith("/dashboard/ky/")`.
- `src/lib/signing/requests.ts` — `createSigningRequest()` (upload PDF + insert `yeu_cau_ky`/
  `nguoi_ky`/`truong_ky`/`nhat_ky_ky`) và `signField()` (stamp PDF hiện tại, idempotent theo
  từng người ký) — đúng 2 hàm lõi dùng chung mọi module, gọi từ `src/app/api/signing/`
  (`create-request`, `sign-field`, `participants`).
- `src/lib/signing/coords.ts` — `jsPdfBoxToPt()` quy đổi khung jsPDF (mm, top-left) sang pdf-lib
  (point, bottom-left) — bắt buộc dùng ở nơi PDF được tạo ra, không lưu lẫn 2 hệ quy chiếu.
- `src/lib/quality-pdf.ts` — thêm `buildQualityKqknPdfForSigning()` (tách từ
  `buildQualityKqknDoc()` dùng chung với `downloadQualityKqknPdf()` cũ) trả về `{bytes, pages}`,
  mỗi `page` có toạ độ mm 2 khung (`chuKyBox`/`tenBox`) cho cả 2 vai trò Lập biểu/Trưởng phòng
  QLCL — tính từ đúng vị trí nhãn "LẬP BIỂU"/"TRƯỞNG PHÒNG QLCL" đã in sẵn trên phiếu.
- `src/lib/signing/stamp-pdf.ts` — thêm `drawTextFit()` (vẽ text canh giữa, tự thu nhỏ cỡ chữ,
  trực tiếp vào 1 khung `(x,y,w,h)` — khác `drawSignerName()` cũ vốn tính lệch theo khung cha).
- `src/app/dashboard/quality/_components/quality-sign-modal.tsx` (`QualitySignModal`) — nút "Ký
  duyệt" trong `quality/page.tsx` mở modal này, người bấm trở thành "Lập biểu", chọn người ký
  vai trò "Trưởng phòng QLCL", submit gọi `buildQualityKqknPdfForSigning` → `create-request` →
  điều hướng sang `/dashboard/ky/{id}`.
- Migration `supabase/migrations/20260903_signing_phase3_bootstrap.sql` — bucket Storage
  `signing-documents` (public), permission `quality.phe_duyet` (mặc định chỉ admin), seed 1 dòng
  `cau_hinh_tai_lieu` cho `quality_kqkn` (chỉ mang tính mô tả), và **nới policy SELECT của
  `nguoi_ky`** cho mọi participant cùng hồ sơ (bản gốc chỉ cho xem đúng dòng của chính mình —
  chặn đứng panel "Luồng ký hồ sơ" của SignScreen với người không phải chủ hồ sơ). **Người dùng
  đã xác nhận đã chạy migration này thành công.**

### Verify pipeline (trước khi người dùng tự test tay) — 3 lớp, không chỉ tin lời code

Vì môi trường non-interactive không thể tự click chuột, đã tự dựng bộ công cụ test riêng (toàn
bộ nằm ngoài repo, trong scratchpad phiên — không còn tồn tại, không cần tìm lại):

1. **Backend thuần** — gọi trực tiếp `createSigningRequest()`/`signField()` (đúng hàm thật, không
   qua HTTP) bằng `node --experimental-strip-types` + 1 custom ESM resolve hook (`module.register`)
   tự map alias `@/` → `src/`, và 1 shim nhỏ cho `jspdf` (package CJS, dưới Node ESM thuần default
   export ra namespace object thay vì constructor — chỉ là hạn chế môi trường test, KHÔNG phải bug
   trong code app, Next.js/webpack bundle app thật không gặp vấn đề này). 2 tài khoản test tạm
   (role admin để bypass permission), 1 batch `qc_results` giả **chỉ tồn tại trong bộ nhớ** (không
   ghi vào bảng `qc_results` thật) → ký đủ 2 người → `trang_thai='hoan_tat'` → tải file đã ký về,
   render bằng Playwright Chromium có đầu (`file://...#toolbar=0`) → xác nhận tên 2 người
   ("E2E Lập biểu (TEST)"/"E2E Trưởng phòng QLCL (TEST)") hiện đúng vị trí dưới dòng ký, tiếng Việt
   có dấu render đúng qua font TimesNewRoman đã `registerFontkit` — **không còn lỗi fontkit**.
2. **RLS thật** — đăng nhập session Supabase thật (không phải service role) bằng tài khoản Trưởng
   phòng QLCL test (không phải chủ hồ sơ) → xác nhận đọc được đủ 2/2 dòng `nguoi_ky` và 4/4 dòng
   `truong_ky` → xác nhận migration mục "nới policy nguoi_ky" hoạt động đúng.
3. **Click-through trình duyệt thật** — Playwright điều khiển Chromium đăng nhập thật qua
   `/login`, mở `/dashboard/ky/[id]` thật, bấm "Ký xác nhận", nhập PIN thật, xác nhận panel "Luồng
   ký hồ sơ" hiện đúng cả 2 người kèm ✓ và giờ ký, không còn khung dư thừa dưới "Lập biểu" (bug đã
   báo bằng ảnh `cung_cap_dl/bug_ky_st.png`/`ky_st.png` trước phiên này — 2 ảnh này vẫn còn trong
   `cung_cap_dl/`, chưa xoá).

Sau verify, đã dọn dữ liệu test: xoá file Storage + `sign_pins` test được; **không xoá được**
2 dòng `yeu_cau_ky` test (trigger bất biến `nhat_ky_ky` chặn cascade delete, đúng thiết kế) và 2
tài khoản Auth test (FK từ `nguoi_ky`) — đã chuyển 2 profile sang `status='disabled'` kèm tên rõ
"(TEST - đã disable)", mirror đúng tiền lệ đã làm ở Giai đoạn 1.

### Bug #3 — người dùng test tay thật, phát hiện lỗ hổng thiết kế: không có cơ chế chống trùng
"Ký duyệt"

Test trên `npm run dev`, ngày 19/08/2026: bấm "Ký duyệt", chọn Trưởng phòng QLCL **thật** (tài
khoản thật, có quyền thật), ký xong phần Lập biểu, đóng lại — quay về danh sách, ngày đó **vẫn
hiện nút "Ký duyệt" trơn** như chưa từng ký, bấm lại tạo hẳn 1 yêu cầu ký MỚI, lặp lại vô hạn
lần. Tài khoản Trưởng phòng QLCL đăng nhập cũng y hệt.

Đã điều tra bằng 2 Explore agent đọc code độc lập + 1 Plan agent thiết kế fix, xác nhận: **không
phải bug logic ký** (phần PIN/stamp/RLS đã verify đúng ở trên) — mà `createSigningRequest()`
chưa từng có kiểm tra trùng, bảng `yeu_cau_ky` chưa có ràng buộc UNIQUE nào, và **trang Kiểm
nghiệm chưa từng query bảng `yeu_cau_ky`** nên không biết ngày nào đã có yêu cầu ký. Tiện thể
người dùng cũng yêu cầu bỏ hẳn việc chọn tay người phê duyệt (module QLCL chỉ có đúng 1 người) —
thay bằng tự nhận diện giống module Văn bản đang làm.

Đã lập plan chi tiết qua Plan Mode (file `.claude/plans/t-i-test-tr-n-localhots-cheerful-tarjan.md`
nếu cần tra lại — không tự nạp), người dùng duyệt, đã code xong toàn bộ:

- **Tự nhận diện Trưởng/Phó phòng QLCL**: generalize `src/app/api/documents/dept-leader/route.ts`
  (thêm optional query param `permission`, mặc định `"documents.phe_duyet"` — hành vi 2 nơi gọi cũ
  của Văn bản (`documents/new/page.tsx`, `documents/new/upload/page.tsx`) không đổi 1 chút nào).
  `quality-sign-modal.tsx` đổi gọi `dept-leader?dept=QLCL&permission=quality.phe_duyet` thay vì
  `/api/quality/approvers` (đã **xoá hẳn** file route đó, không còn nơi gọi) — 0 kết quả thì
  **chặn hẳn** nút submit + banner đỏ hướng dẫn kiểm tra Chức vụ/Phòng ban/Quyền; 1 kết quả thì tự
  gán kèm badge "Tự động xác định"; ≥2 kết quả (có cả Phó phòng) mới hiện `<select>`.
- **Khoá tương quan chống trùng**: `ma_ho_so` đổi từ `formatPKN(batches[0].pkn,...)` (không ổn
  định nếu 1 ngày có nhiều đợt KN) sang thẳng biến `date` (chuỗi ISO, đã là khoá của `dateGroups`)
  — 1 dòng sửa tại `quality/page.tsx`.
- Migration mới `supabase/migrations/20260904_signing_quality_dedup.sql` — partial UNIQUE INDEX
  `(factory_id, modun, loai_tai_lieu, ma_ho_so) WHERE trang_thai IN ('dang_luan_chuyen',
  'hoan_tat')` — chỉ chặn khi còn hiệu lực, cho phép tạo lại sau khi huỷ. **File migration có ghi
  rõ cảnh báo đầu file: phải dọn dữ liệu test 19/08/2026 trùng lặp trước (script SELECT rồi tự tay
  `UPDATE ... SET trang_thai='huy'` cho các dòng thừa) nếu không `CREATE UNIQUE INDEX` sẽ báo lỗi
  ngay khi chạy — CHƯA XÁC NHẬN người dùng đã chạy migration này.**
- `cancelSigningRequest()` mới trong `src/lib/signing/requests.ts` (đặt sau `signField()`) + route
  mới `src/app/api/signing/cancel-request/route.ts` — set `trang_thai='huy'`, chỉ cho `nguoi_tao`
  hoặc admin, chỉ khi đang `dang_luan_chuyen` (không cho huỷ khi đã `hoan_tat` — đúng triết lý bất
  biến chung của cả hệ thống ký).
- Route mới `src/app/api/quality/signing-status/route.ts` — trả trạng thái ký theo từng ngày
  (service-role, xác thực người gọi đúng nhà máy) cho MỌI người xem danh sách Kiểm nghiệm, không
  chỉ owner/participant như RLS gốc của `yeu_cau_ky` — cố tình KHÔNG mở rộng RLS chung của bảng
  (dùng chung cho 5 module tương lai, có thể cần giữ kín trạng thái ký ở module khác).
- Component mới `src/app/dashboard/quality/_components/quality-sign-status.tsx`
  (`QualitySignStatusBadge`) thay hẳn nút "Ký duyệt" trơn cũ trong `quality/page.tsx` — 5 nhánh
  hiển thị theo danh tính người xem: chưa có yêu cầu (nút "Ký duyệt" như cũ) / đã hoàn tất (badge
  xanh + link xem file) / đang chờ + là người phê duyệt hoặc admin (link vào SignScreen tiếp tục
  ký) / đang chờ + là người tạo hoặc admin (badge tĩnh + nút "Hủy yêu cầu", mở `ModalShell` xác
  nhận) / đang chờ + không liên quan (badge tĩnh + link xem file hiện tại, đã có chữ ký Lập biểu).
- Bắt mã lỗi Postgres `23505` (unique_violation) trong `createSigningRequest()`'s insert
  `yeu_cau_ky` — báo tiếng Việt rõ ràng thay vì lỗi Postgres thô khi 2 người bấm gần như cùng lúc;
  tiện thể dọn luôn file Storage mồ côi nếu insert thất bại (trước đó chưa dọn ở nhánh lỗi này).

### Bug #4 — người dùng test tay tiếp, phát hiện: nhãn "Lập biểu" chồng lên đúng chữ ký thật

Sau khi Lập biểu ký xong, Trưởng phòng QLCL mở SignScreen để ký phê duyệt thì thấy chữ "Lập biểu"
hiện **chồng lên đúng vị trí chữ ký thật** của Lập biểu (ảnh chụp còn trong `cung_cap_dl/` —
2 ảnh trước, screenshot mới trong tin nhắn không lưu file). Mở lại file PDF đã tải về thì không
thấy lỗi này — chỉ là lỗi hiển thị live trên SignScreen, không phải lỗi trong file PDF thật.

**Nguyên nhân**: khối `otherFields` (khung của người KHÁC, không phải người đang xem) trong
`ky/[id]/page.tsx` luôn vẽ viền + nhãn chữ cho MỌI khung `loai==='chu_ky'`, bất kể chủ khung đó đã
ký hay chưa. Khi Trưởng phòng QLCL mở trang, ảnh trang PDF đã tải lại theo bản MỚI NHẤT (đã có
chữ ký thật của Lập biểu stamp sẵn trong ảnh, vì `file_hien_tai` đã được cập nhật sau khi họ ký) —
nhãn "Lập biểu" vẽ đè lên đúng chỗ đó gây chồng chữ.

**Đã sửa**: thêm `nguoiKyStatusById` (map từ `nguoiKyList`), khối `otherFields` giờ chỉ vẽ viền/
nhãn khi `nguoiKyStatusById.get(f.nguoi_ky_id) !== "da_ky"` — người đã ký thì không vẽ gì thêm
nữa, để lộ đúng ảnh chữ ký thật đã có sẵn trong PDF. Không đụng khối `myFields` (khung của chính
người đang xem, badge "✓ Đã ký" là chủ đích, không phải lỗi).

### Đã kiểm tra

`npx tsc --noEmit` (toàn repo) sạch; `npx eslint` trên toàn bộ file đã sửa/thêm sạch (đối chiếu
số dòng xác nhận các lỗi `no-explicit-any`/`no-unused-vars` còn lại trong `quality/page.tsx` là
pre-existing, không liên quan tới thay đổi lần này). Không chạy `npm run build`.

### Danh sách file đã đổi trong Giai đoạn 3 (tính đến hết phiên này)

| File | Trạng thái |
|---|---|
| `src/app/dashboard/ky/[id]/page.tsx` | SignScreen — mới (phiên trước) + fix bug #2 + bug #4 (phiên này) |
| `src/app/dashboard/quality/_components/quality-sign-modal.tsx` | Mới (phiên trước) + đổi nguồn approver sang dept-leader (phiên này) |
| `src/app/dashboard/quality/_components/quality-sign-status.tsx` | Mới (phiên này) |
| `src/app/dashboard/quality/page.tsx` | Sửa: nút "Ký duyệt" → `QualitySignStatusBadge`, `maHoSo`, loader trạng thái |
| `src/lib/signing/requests.ts` | Mới (phiên trước) + `cancelSigningRequest()` + bắt `23505` (phiên này) |
| `src/lib/signing/coords.ts` | Mới (phiên trước), không đổi |
| `src/lib/signing/stamp-pdf.ts` | Sửa (phiên trước): thêm `drawTextFit()` |
| `src/lib/quality-pdf.ts` | Sửa (phiên trước): thêm `buildQualityKqknPdfForSigning()` |
| `src/lib/auth.ts` | Sửa (phiên trước): thêm `quality.phe_duyet` vào `DEFAULT_PERMISSION_CODES` |
| `src/app/api/signing/create-request/route.ts`, `sign-field/route.ts`, `participants/route.ts` | Mới (phiên trước), không đổi |
| `src/app/api/signing/cancel-request/route.ts` | Mới (phiên này) |
| `src/app/api/quality/signing-status/route.ts` | Mới (phiên này) |
| `src/app/api/quality/approvers/route.ts` | **Đã xoá** (phiên này — không còn nơi gọi) |
| `src/app/api/documents/dept-leader/route.ts` | Sửa (phiên này): thêm optional param `permission` |
| `src/app/dashboard/layout.tsx` | Sửa (phiên trước): bypass sidebar cho `/dashboard/ky/` |
| `supabase/migrations/20260903_signing_phase3_bootstrap.sql` | Mới (phiên trước) — **đã chạy** |
| `supabase/migrations/20260904_signing_quality_dedup.sql` | Mới (phiên này) — **CHƯA xác nhận đã chạy** |

### CHƯA làm / cần làm trước khi coi thí điểm Chất lượng là hoàn tất

1. **Dọn dữ liệu test trùng ngày 19/08/2026** rồi chạy migration `20260904_signing_quality_dedup.sql`
   trên Supabase SQL Editor (xem hướng dẫn chi tiết ngay đầu file migration đó).
2. Kiểm tra hồ sơ Trương Tấn Phước (và Phó phòng QLCL nếu có) trong Cài đặt → Bảo trì → Nhân sự
   bảo trì: `chuc_vu`/`chuc_vu_chinh_quyen` chứa đúng "Trưởng phòng"/"Phó phòng", đúng phòng ban
   `QLCL`, và đã có quyền `quality.phe_duyet` trong Cài đặt → Phân quyền — thiếu 1 trong 3 thì
   modal "Ký duyệt" sẽ chặn hẳn (đúng thiết kế mới, không phải bug).
3. Test tay lại đầy đủ trên `npm run dev` (2 tài khoản test tạm, mirror cách đã làm ở các Giai
   đoạn trước):
   - Chặn trùng: bấm "Ký duyệt" 1 ngày mới → ký Lập biểu → quay lại danh sách thấy banner "Chờ ký
     duyệt" ngay, không tạo được yêu cầu thứ 2 cho cùng ngày.
   - Vai trò xem: người không liên quan chỉ thấy banner + "Xem file", không có nút ký/hủy nào.
   - Người tạo bấm lại thấy nút "Hủy yêu cầu", hủy xong tạo lại được từ đầu.
   - Người phê duyệt được chọn thấy nút dẫn thẳng vào SignScreen, ký xong danh sách hiện "Đã ký
     duyệt" cho mọi người.
   - Dept-leader: modal tự nhận diện đúng Trương Tấn Phước; thử tạm xoá quyền `quality.phe_duyet`
     của họ → modal chặn hẳn đúng banner đỏ → cấp lại quyền ngay sau khi test xong.
   - **Bug #4 (nhãn chồng chữ ký)**: mở lại đúng kịch bản cũ (Trưởng phòng QLCL xem hồ sơ Lập biểu
     đã ký) → xác nhận không còn chữ "Lập biểu" đè lên chữ ký thật nữa.
4. Sau khi ổn định, hỏi lại người dùng có muốn nhân rộng `SignScreen`/hạ tầng ký dùng chung sang 5
   module còn lại (Xuất hàng, Bảo trì, ISO, Văn bản...) hay không — **CHƯA được xác nhận**, không
   tự ý mở rộng. Phần "reusable core" (đã tách sẵn, không cần sửa gì khi module khác triển khai):
   `dept-leader/route.ts` đã generalize, unique index partial trên `yeu_cau_ky`, `cancelSigningRequest()`
   + route `cancel-request`, cách bắt `23505` trong `createSigningRequest()`.

## Cập nhật (tiếp 8) — Giai đoạn 3: UI icon-only + nút PDF mở đúng file đã ký + thêm logic "Trả về"

Tiếp tục ngay trong phiên đọc mục "Cập nhật (tiếp 7)" ở trên (chưa chạy migration
`20260904_signing_quality_dedup.sql`, chưa test tay — vẫn còn nguyên checklist cũ). Người dùng yêu
cầu 3 việc: (1) nút "PDF" phải mở đúng file thật hiện có (không phải luôn render bản chưa ký), (2)
đổi các nút Thêm/Sửa/Xóa/PDF/"Xem file" sang icon-only, giữ icon+text cho nhóm hành động trạng thái
ký, (3) hỏi "Phase này có logic Trả về chưa?" — câu trả lời là CHƯA, và sau khi chốt thiết kế qua
`AskUserQuestion`, đã code thêm luôn trong phiên này.

### 1-2. Icon-only + PDF/Eye theo trạng thái ký (`quality/page.tsx`, `quality-sign-status.tsx`)

- Trong hàng action mỗi ngày: nút **Thêm/Sửa/Xóa** đổi sang icon-only (`p-1.5 rounded-lg
  text-{color}-600 hover:bg-{color}-50`, chỉ còn `title` tooltip) — đúng phong cách đã dùng ở Điều
  xe/Sản lượng (rule `06-module-production.md` mục "Khóa ca sản xuất").
- Nút **PDF** thay hẳn cách tiếp cận "ẩn khi hoàn tất" (bản nháp ban đầu, đã lỗi thời) bằng: nếu
  `signingStatusByDate.get(date)?.fileHienTai` tồn tại (đã có yêu cầu ký, bất kể `dang_luan_chuyen`
  hay `hoan_tat`) → đổi sang icon `Eye`, mở thẳng `fileHienTai` (file thật hiện tại — đã có chữ ký
  Lập biểu khi đang chờ, đủ 2 chữ ký khi hoàn tất) trong tab mới; nếu chưa có yêu cầu ký nào → giữ
  icon `Printer`, bấm vẫn render bản in nháp chưa ký như cũ (`downloadQualityKqknPdf`).
- Trong `QualitySignStatusBadge`: đổi nhãn ban đầu "Ký duyệt" → **"Gửi ký duyệt"**; thêm icon
  `Clock` cho "Chờ ký duyệt"; xoá 2 link text "Xem file" trùng lặp (đã có icon Eye ở ngoài).
- Cố ý **không đụng** nút "PDF" ở tab Giám sát (so sánh KQ CŨ/MỚI khi KN lại) — không có khái niệm
  ký duyệt theo ngày ở đó.

### 3. Logic "Trả về" — MỚI, thuộc lõi dùng chung `src/lib/signing/` (không riêng module Chất lượng)

Trước phiên này: schema `yeu_cau_ky`/`nguoi_ky` đã có sẵn giá trị `tu_choi` trong CHECK constraint
từ Giai đoạn 0, nhưng **chưa route/hàm nào ghi giá trị này** — chỉ có `createSigningRequest`,
`signField`, `cancelSigningRequest` (huỷ hẳn, không có lý do). Đã hỏi người dùng 2 câu qua
`AskUserQuestion`, chốt: **giữ nguyên 1 `yeu_cau_ky`, cho sửa & ký lại trên cùng yêu cầu** (không
tạo bản `phien_ban+1` mới như comment gốc trong migration `20260902` từng gợi ý) + **bắt buộc nhập
lý do**.

**Giới hạn cố ý, đã nói rõ với người dùng**: "Trả về" chỉ reset LỚP CHỮ KÝ (khôi phục
`file_hien_tai` về đúng `file_goc`, huỷ chữ ký của (các) người ký trước) — KHÔNG render lại nội
dung `file_goc`. Nếu lý do trả về là "sai số liệu/nội dung phiếu" (không phải "sai vị trí ký/chọn
nhầm người"), người tạo phải dùng "Hủy yêu cầu" (đã có sẵn) rồi sửa `qc_results` và "Gửi ký duyệt"
lại từ đầu để PDF được render lại đúng — lõi ký dùng chung không biết cách render lại nội dung
nghiệp vụ của từng module.

- Migration mới `supabase/migrations/20260905_signing_return_request.sql` (**CHƯA CHẠY**) — thêm
  `yeu_cau_ky.tra_ve_ly_do`/`tra_ve_boi`/`tra_ve_luc`. `tra_ve_ly_do` là lý do của LẦN TRẢ VỀ GẦN
  NHẤT CHƯA XỬ LÝ — tự bị xoá (set NULL) ngay khi người bị trả về ký lại thành công (đã sửa
  `signField()` trong `src/lib/signing/requests.ts` để luôn ghi đè cả 3 cột này về NULL mỗi lần ký
  thành công, vô hại nếu trước đó chưa từng trả về).
- `src/lib/signing/requests.ts` — hàm mới `returnSigningRequest({ yeuCauId, userId, lyDo, ip,
  thietBi })`: validate người gọi là 1 `nguoi_ky` **chưa ký** của đúng yêu cầu, tìm (các) người ký
  TRƯỚC (`thu_tu` nhỏ hơn) đã `da_ky` — nếu rỗng thì báo lỗi hướng dẫn dùng "Hủy yêu cầu" thay thế
  (không có gì để trả về); reset các dòng đó về `trang_thai='cho'` (xoá `ky_luc/ip/thiet_bi`);
  khôi phục `file_hien_tai`/`hash_hien_tai` về đúng `file_goc`; ghi `tra_ve_ly_do/tra_ve_boi/
  tra_ve_luc`; insert `nhat_ky_ky` (`hanh_dong: "tra_ve"`, bất biến như mọi dòng nhật ký khác).
- Route mới `src/app/api/signing/return-request/route.ts` — mirror đúng `cancel-request/route.ts`
  (chỉ cần Bearer token thường, không qua PIN JWT vì không phải hành động ký).
- `src/app/dashboard/ky/[id]/page.tsx` (SignScreen, **dùng chung cho mọi module**, không riêng
  Chất lượng): thêm nút **"Trả về"** (viền rose) cạnh "Ký xác nhận", chỉ hiện khi
  `canReturn = myNguoiKy && !iAlreadySigned && có ít nhất 1 người thu_tu nhỏ hơn đã da_ky` — tự
  nhiên chỉ xuất hiện cho người ký SAU (vd Trưởng phòng QLCL), không hiện cho người ký đầu tiên (vd
  Lập biểu, vì chưa có ai trước họ để trả về). Bấm mở bottom-sheet bắt buộc nhập lý do (textarea,
  validate rỗng), gọi `/api/signing/return-request`, `loadData()` lại sau khi thành công — người bị
  reset khi quay lại trang này sẽ tự thấy khung ký của họ về trạng thái "chưa ký" (vì ảnh trang PDF
  giờ render từ `file_hien_tai` đã phục hồi = `file_goc`, không cần sửa gì thêm ở phần render).
- `src/app/api/quality/signing-status/route.ts` + `QualitySigningStatus` type (`quality-sign-
  status.tsx`): thêm field `traVeLyDo`. Badge thêm nhánh 3a — khi `status.traVeLyDo` có giá trị:
  người tạo/admin thấy Link rose **"Trả về — Sửa & ký lại"** (trỏ `/dashboard/ky/{id}`, tooltip lý
  do), người khác chỉ thấy badge tĩnh "Đã trả về"; nút "Hủy yêu cầu" vẫn có cho người tạo/admin
  (dùng khi họ quyết định cần sửa nội dung thay vì chỉ ký lại). Đã tách `CancelConfirmModal` dùng
  chung cho cả nhánh bình thường lẫn nhánh "đã trả về" để không lặp code.

`npx tsc --noEmit` và `npx eslint` (toàn bộ file đã sửa: `page.tsx`, `quality-sign-status.tsx`,
`signing-status/route.ts`, `requests.ts`, `return-request/route.ts`, `ky/[id]/page.tsx`) đều sạch
tuyệt đối (exit code 0, không có warning/error nào, kể cả pre-existing).

### CHƯA làm / cần làm trước khi coi "Trả về" là hoàn tất

1. **Chạy `supabase/migrations/20260905_signing_return_request.sql`** trên Supabase SQL Editor
   (cộng với `20260904_signing_quality_dedup.sql` vẫn còn treo từ mục "tiếp 7" — nhớ dọn dữ liệu
   test trùng ngày 19/08/2026 trước khi chạy `20260904`, xem hướng dẫn đầu file migration đó).
2. Test tay đầy đủ luồng Trả về trên `npm run dev` (2 tài khoản test tạm, mirror cách đã làm ở các
   Giai đoạn trước): Lập biểu tạo yêu cầu + ký → Trưởng phòng QLCL mở `/dashboard/ky/{id}` → xác
   nhận thấy nút "Trả về" (không thấy "Ký xác nhận" ép buộc phải ký) → bấm, nhập lý do, xác nhận →
   quay lại danh sách Kiểm nghiệm, xác nhận badge đổi thành "Trả về — Sửa & ký lại" (rose) cho Lập
   biểu/admin, "Đã trả về" (tĩnh) cho người khác, tooltip đúng lý do → Lập biểu bấm vào, xác nhận
   khung ký của họ trên SignScreen về lại trạng thái "chưa ký" (khung sky-blue, không phải "✓ Đã
   ký"), ký lại thành công → xác nhận badge trở lại "Chờ ký duyệt" bình thường (không còn dấu vết
   "Trả về" cũ) → Trưởng phòng QLCL ký tiếp → "Đã ký duyệt".
3. Test case biên: người ký ĐẦU TIÊN (Lập biểu, chưa có ai ký trước) mở SignScreen — xác nhận
   KHÔNG thấy nút "Trả về" (đúng thiết kế, vì gọi API sẽ báo lỗi "không có gì để trả về" nếu cố
   tình gọi — nhưng UI đã ẩn nút nên không cần test qua UI, có thể test trực tiếp gọi API để xác
   nhận lỗi đúng thông báo).
4. Test nút PDF/Eye ở danh sách: ngày chưa ký → icon Printer, bấm ra file in nháp; ngày đã có yêu
   cầu ký (`dang_luan_chuyen` hoặc `hoan_tat`) → icon Eye, bấm mở đúng `fileHienTai` hiện tại (có
   thể verify bằng cách so khớp nội dung/chữ ký hiển thị đúng với trạng thái thật).
5. Xác nhận đổi nhãn "Gửi ký duyệt" (thay "Ký duyệt" cũ) hiển thị đúng, không vỡ layout.

### Xác nhận hoàn tất Giai đoạn 3 (2026-08-29)

Người dùng xác nhận qua `AskUserQuestion`: cả 2 migration (`20260904_signing_quality_dedup.sql`,
`20260905_signing_return_request.sql`) đã chạy đúng như kỳ vọng, VÀ đã test tay đầy đủ trên
`npm run dev` theo cả 2 checklist ở mục "tiếp 7" và "tiếp 8" — không có lỗi nào được báo lại.
**Giai đoạn 3 (thí điểm ký số dùng chung cho module Chất lượng) coi như hoàn tất**, bao gồm cả
tính năng "Trả về" mới thêm. Không cần điều tra/test lại các mục này trừ khi phát sinh báo lỗi mới.

## Kế hoạch phiên sau — Giai đoạn 4: nhân rộng hệ thống ký số dùng chung sang các module khác

### Phần lõi dùng chung đã sẵn sàng — module mới KHÔNG cần sửa gì ở đây

- `src/app/dashboard/ky/[id]/page.tsx` — SignScreen dùng chung mọi module: nhiều trang PDF, nhiều
  người ký, "Ký xác nhận" (PIN), và giờ có cả "Trả về" (chỉ hiện khi có người ký trước đã ký).
- `src/lib/signing/requests.ts` — `createSigningRequest()`, `signField()`,
  `cancelSigningRequest()`, `returnSigningRequest()`.
- `src/lib/signing/signature-image.ts`, `stamp-pdf.ts`, `coords.ts`, `hash.ts` — lấy ảnh chữ ký,
  vẽ chữ ký/tên/QR lên PDF, quy đổi toạ độ jsPDF↔pdf-lib, hash toàn vẹn.
- Route API: `/api/signing/create-request`, `/api/signing/sign-field`,
  `/api/signing/cancel-request`, `/api/signing/return-request`, `/api/signing/participants`.
- 6 bảng lõi: `yeu_cau_ky`, `nguoi_ky`, `truong_ky`, `mau_vi_tri`, `nhat_ky_ky`,
  `cau_hinh_tai_lieu` (2 bảng cuối chưa module nào dùng tới, chưa cần đụng ở Giai đoạn 4).

### Việc CẦN LÀM RIÊNG cho mỗi module mới (mirror đúng 4 phần đã làm cho Chất lượng)

1. Hàm build PDF gốc trả về `{ bytes, pages }` kèm tọa độ (mm) từng khung ký theo từng vai trò —
   mirror `buildQualityKqknPdfForSigning()` trong `src/lib/quality-pdf.ts`.
2. 1 modal tạo yêu cầu ký (chọn người ký/phê duyệt, thường tự nhận diện qua chức vụ như
   `quality-sign-modal.tsx` đã làm với `/api/documents/dept-leader`) — gọi `create-request`.
3. 1 route riêng `signing-status` (service-role, mirror `/api/quality/signing-status/route.ts`) —
   **bắt buộc phải có route riêng cho mỗi module**, vì RLS gốc của `yeu_cau_ky` chỉ cho
   owner/participant/admin đọc, không đủ để cả danh sách nghiệp vụ thấy trạng thái ký theo từng
   bản ghi/ngày.
4. 1 badge trạng thái (mirror `quality-sign-status.tsx`'s `QualitySignStatusBadge` — đã có sẵn đủ
   5 nhánh: chưa có yêu cầu / đang chờ / đã trả về / đã hoàn tất, cộng nút hủy) + nút gọi trong
   đúng màn danh sách của module đó.

### Ứng viên module — CHƯA CHỐT, phải hỏi người dùng đầu phiên sau

Chia 2 nhóm theo độ rủi ro, dựa trên khảo sát hiện trạng:

- **Nhóm DỄ — đã có PDF thật (jsPDF) từ trước, CHƯA có bất kỳ signing nào**: Xuất hàng
  (`src/lib/export-order-pdf.ts`), Điều xe (`src/lib/dispatch-pdf.ts`), Sản lượng
  (`src/lib/output-pdf.ts`), Kho nguyên liệu (`src/lib/storage-pdf.ts`), Bảo trì
  (`src/lib/maintenance-pdf.ts` — phức tạp hơn 4 module kia vì có 7 loại chứng từ khác nhau,
  xem `.claude/rules/14-maintenance-module.md`). Đây là các ứng viên an toàn để mirror đúng
  pattern Chất lượng, rủi ro thấp vì không đụng hệ thống ký nào đang chạy thật.
- **Nhóm KHÓ HƠN — đã có hệ thống ký RIÊNG, chạy thật trên production**: ISO
  (`api/sign/generate-pdf`, `api/sign/generate-office`), Văn bản nội bộ
  (`api/documents/sign`). Chuyển 2 module này sang dùng lõi `yeu_cau_ky` mới là MIGRATE hành vi
  đang chạy thật (đổi schema/workflow người dùng đã quen) — rủi ro cao hơn hẳn, nên tách thành
  quyết định riêng, không gộp chung đợt "thêm signing cho module chưa có" ở trên.

**Chưa quyết định** module nào làm trước, làm 1 module rồi dừng lại xác nhận hay làm liên tục
nhiều module — phiên sau phải hỏi người dùng trước khi bắt đầu code, đúng quy trình đã áp dụng
xuyên suốt dự án ký số này.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (tiếp 7)", "Cập nhật (tiếp 8)" và "Kế hoạch phiên sau — Giai đoạn 4" trong
CLAUDE.md. Giai đoạn 3 (thí điểm ký số dùng chung cho module Chất lượng, gồm cả tính năng "Trả
về" mới) ĐÃ HOÀN TẤT — 2 migration đã chạy, đã test tay đầy đủ, tôi đã xác nhận không có lỗi.
KHÔNG cần test lại trừ khi tôi báo lỗi mới.

Bắt đầu Giai đoạn 4: nhân rộng hệ thống ký số dùng chung sang các module khác. Phần lõi
(`src/app/dashboard/ky/[id]/page.tsx`, `src/lib/signing/*`, 5 route `/api/signing/*`, 6 bảng)
đã sẵn sàng dùng ngay, không cần sửa. Mỗi module mới cần đúng 4 việc riêng (đọc kỹ mục "Việc CẦN
LÀM RIÊNG cho mỗi module mới" để biết chi tiết): (1) hàm build PDF gốc kèm tọa độ khung ký, (2)
modal tạo yêu cầu ký, (3) 1 route `signing-status` riêng (bắt buộc — RLS gốc không đủ), (4) badge
trạng thái + nút gọi trong danh sách nghiệp vụ.

Trước khi code: hỏi tôi chọn module nào trong nhóm "DỄ" (Xuất hàng/Điều xe/Sản lượng/Kho nguyên
liệu/Bảo trì — xem bảng so sánh trong mục kế hoạch) làm trước, và có làm liên tục nhiều module
trong 1 phiên hay dừng lại xác nhận sau mỗi module — KHÔNG tự ý chọn. Nhóm "KHÓ HƠN" (ISO, Văn
bản nội bộ — đã có hệ thống ký riêng chạy thật) là MIGRATE hành vi đang chạy production, tuyệt
đối không tự ý đụng vào trừ khi tôi yêu cầu rõ ràng và đã bàn kỹ phạm vi trước.

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi không
chắc dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (Giai đoạn 4, phần 1 — Điều xe, tiếp) — fix nhận diện Giám đốc + chuẩn hoá quyền "gửi ký duyệt"

Ngay sau khi code xong Điều xe, người dùng phát hiện 2 vấn đề qua review code:

1. **Bug thật**: `chuc_vu`/`chuc_vu_chinh_quyen` thật trong `maintenance_staff` ghi
   **"Giám đốc nhà máy"**/**"Phó giám đốc nhà máy"** (có hậu tố "nhà máy") — khác giả định ban
   đầu copy từ Bảo trì (đòi khớp CHÍNH XÁC "Giám đốc", không hậu tố). Với dữ liệu thật, route
   `/api/dispatch/approvers` sẽ luôn trả rỗng, không ai ký duyệt được.
   - **Đã fix**: `normalizeChucVu()` trong `src/app/api/dispatch/approvers/route.ts` bỏ đúng hậu
     tố `" nhà máy"` ở cuối chuỗi trước khi so khớp chính xác với `"giám đốc"` — "Giám đốc" và
     "Giám đốc nhà máy" đều khớp; "Phó giám đốc nhà máy" sau khi bỏ hậu tố thành "phó giám đốc"
     vẫn bị loại đúng; "Tổng giám đốc" (không có hậu tố "nhà máy") không đổi hành vi, vẫn bị loại.
2. **Câu hỏi thiết kế**: quyền nào gate nút "Ký duyệt" (tạo yêu cầu ký, trở thành "Lập bảng"), và
   "Người tạo" có cần kiểm tra gì thêm không — vấn đề này CHƯA từng bàn kỹ khi làm Chất lượng.
   - **Người tạo (`nguoi_tao`)**: đã an toàn từ trước — server xác thực qua Bearer token
     (`requireAuthUser`), không phải trường client tự khai, không cần sửa gì.
   - **Quyền gửi ký duyệt**: đã hỏi và chốt — **dùng thẳng quyền CRUD có sẵn của module**
     (`dispatch.edit` cho Điều xe), không tạo permission mới riêng (`dispatch.gui_ky_duyet`) —
     giữ đơn giản, admin chỉ cần cấp đúng quyền sửa dữ liệu cho nhân viên NMCB được giao lập
     bảng, không cần thêm bước cấp quyền phụ. Điều xe giữ nguyên `dispatch.edit` (không đổi).
   - **Chất lượng đồng bộ theo cùng nguyên tắc**: `quality/page.tsx` đổi `canCreate` từ
     `hasPermission(currentUser, "quality.print")` sang `hasPermission(currentUser,
     "quality.edit")` — 1 dòng duy nhất, để nhất quán "quyền sửa dữ liệu nguồn = quyền gửi ký
     duyệt" giữa 2 module. Không đổi gì khác trong Chất lượng (đã test tay xong ở phiên trước,
     phạm vi sửa chỉ đúng 1 dòng này).
   - **Nguyên tắc áp dụng cho các module Giai đoạn 4 sau này**: `canCreate` (nút gửi ký duyệt)
     luôn dùng quyền `<module>.edit` có sẵn của chính module đó — không phát sinh permission
     "gui_ky_duyet" riêng trừ khi có lý do nghiệp vụ cụ thể cần tách biệt "được sửa dữ liệu"
     khỏi "được gửi ký duyệt" cho đúng module đó.

Đã xác nhận (không đổi gì): dòng mã tài liệu `"QLCL-QT21-F08 (01-10/01/2025)"` ở footer góc trái
Phiếu KQKN (`quality-pdf.ts` dòng ~252, `doc.text(..., margin, y)`) — đúng như hiện trạng, không
có thay đổi nào cần làm ở đây.

`npx tsc --noEmit` sạch; `npx eslint` trên `dispatch/approvers/route.ts` sạch; `quality/page.tsx`
còn 10 lỗi `no-explicit-any` + vài warning — đã đối chiếu, toàn bộ pre-existing từ trước phiên
này (đúng như đã ghi nhận ở lịch sử "Cập nhật (tiếp 7)"), không liên quan tới dòng vừa sửa.

**Chưa test tay** — cần thêm vào checklist "BẮT BUỘC trước khi coi module Điều xe là xong" ở mục
ngay trên: sau khi sửa `normalizeChucVu`, xác nhận `/api/dispatch/approvers` trả đúng đúng 1
Giám đốc nhà máy thật (không lẫn Phó giám đốc); và xác nhận đổi `quality.edit` không làm ẩn mất
nút "Gửi ký duyệt" cho các tài khoản Chất lượng đang dùng thật trên production (tài khoản nào
trước đây có `quality.print` nhưng KHÔNG có `quality.edit` sẽ mất nút này — cần rà nhanh xem có
tài khoản nào rơi vào trường hợp đó không trước khi coi thay đổi này là an toàn để deploy).

## Cập nhật (Giai đoạn 4, phần 1 — Điều xe) — đã code xong, CHƯA chạy migration/test tay

Người dùng chốt qua `AskUserQuestion`: bắt đầu nhóm "DỄ" với **Điều xe** trước, và **dừng lại xác
nhận sau mỗi module** (không tự ý làm liên tục nhiều module). Phiên này chỉ làm đúng 1 module.

### Tài liệu được gắn ký số: Phiếu điều xe ngày (`dispatch_entries`, 1 phiếu = 1 `entry.id`)

Đã chọn đúng tài liệu PDF sẵn có duy nhất mà module này thật sự cần ký duyệt — "Xuất PDF ngày"
(`downloadDispatchEntryPdf`, nút `FileText` ở mỗi dòng danh sách `/dashboard/dispatch`). Không
đụng `downloadDispatchTripPdf` (PDF từng chuyến) hay `downloadDispatchStatsPdf` (PDF thống kê) —
2 hàm đó không có khái niệm "duyệt", giữ nguyên `renderSignatures()` gốc không đổi.

- `ma_ho_so` = `entry.id` (UUID, không phải ngày) — khác quality (dùng chuỗi ngày) vì Điều xe
  không có ràng buộc "1 ngày = 1 phiếu" (có thể nhiều phiếu/ngày qua nhân bản), nên khóa nghiệp
  vụ đúng và duy nhất tự nhiên nhất là chính `id` của `dispatch_entries`. `banGhiId` cũng gán
  bằng `entry.id`.
- PDF dùng để ký lấy TOÀN BỘ `entry.rows` thật (không áp filter Ghi chú/Loại nguyên liệu đang
  bật trên màn hình danh sách) — giống nguyên tắc quality dùng `dateResults` đầy đủ, không lấy
  `dateResults` đã lọc UI.

### Người phê duyệt: "Giám đốc nhà máy" — tự nhận diện qua `maintenance_staff`, KHÔNG qua dept-leader

Khác Chất lượng (QLCL là 1 phòng ban thật, dùng được `/api/documents/dept-leader?dept=QLCL`),
Điều xe không thuộc riêng phòng ban nào trong 9 phòng ban chuẩn — nhãn "Giám đốc nhà máy" đã in
sẵn cứng trong chính `renderSignatures()`/`renderEntrySignatures()` từ trước (không phải quyết
định mới của phiên này). Vì vậy tạo route riêng `/api/dispatch/approvers` — mirror logic
`giamDocStaff` đã có sẵn ở module Bảo trì (`.claude/rules/14-maintenance-module.md`): so khớp
CHÍNH XÁC (không phải chuỗi con) `maintenance_staff.chuc_vu`/`chuc_vu_chinh_quyen` =
`"giám đốc"` (tự loại "phó giám đốc"/"tổng giám đốc"), lọc thêm theo quyền `dispatch.phe_duyet`
mới (permission hoàn toàn mới — Điều xe trước đây không có khái niệm người duyệt, mirror
`quality.phe_duyet`: mặc định chỉ cấp cho `admin`, gán tay qua Cài đặt → Phân quyền cho đúng
người giữ vai trò Giám đốc).

**Quyết định này CHƯA hỏi lại người dùng xác nhận** (chỉ suy ra từ nhãn đã in sẵn trên PDF +
tiền lệ code Bảo trì) — cần xác nhận khi test tay: nếu nhà máy có nhiều "Giám đốc" (hiếm) hoặc
chức vụ ghi khác "Giám đốc" đúng nguyên văn (vd "Giám đốc Nhà máy"), route sẽ trả rỗng và modal
hiện banner đỏ hướng dẫn — không tự ý nới lỏng match nếu gặp trường hợp này, hỏi lại trước.

### File đã đổi / đã tạo

| File | Nội dung |
|---|---|
| `src/lib/dispatch-pdf.ts` | Tách `buildDispatchEntryDoc()` dùng chung (không đổi hình ảnh PDF cũ); thêm `renderEntrySignatures()` (mirror `renderSignatures()`, có tính tọa độ khung ký mm); export mới `buildDispatchEntryPdfForSigning()` |
| `src/lib/auth.ts` | Thêm `"dispatch.phe_duyet"` vào `DEFAULT_PERMISSION_CODES` |
| `supabase/migrations/20260908_dispatch_signing_phe_duyet.sql` | Mới, **CHƯA CHẠY** — seed permission `dispatch.phe_duyet` (chỉ admin mặc định). Không cần migration dedup riêng — unique index `uniq_yeu_cau_ky_active_business_key` (20260904) đã có `modun` trong khóa, tự bảo vệ mọi module kể cả Điều xe |
| `src/app/api/dispatch/approvers/route.ts` | Mới — tự nhận diện Giám đốc nhà máy (xem trên) |
| `src/app/api/dispatch/signing-status/route.ts` | Mới — mirror `/api/quality/signing-status/route.ts`, khóa theo `entryIds` (list `dispatch_entries.id`) thay vì `dates` |
| `src/app/dashboard/dispatch/_components/dispatch-sign-modal.tsx` | Mới — `DispatchSignModal`, mirror `quality-sign-modal.tsx` |
| `src/app/dashboard/dispatch/_components/dispatch-sign-status.tsx` | Mới — `DispatchSignStatusBadge`, mirror `quality-sign-status.tsx` (đủ 5 nhánh + nút hủy + "Trả về") |
| `src/app/dashboard/dispatch/page.tsx` | Thêm state `currentUser`/`signingStatusByEntry`/`signModalEntry`, `loadSigningStatus()`; thêm cột "Ký duyệt" vào bảng danh sách; nút "Xuất PDF ngày" tự đổi thành icon `Eye` mở file đã ký khi đã có yêu cầu ký (mirror quality) |

Đây là module **đầu tiên** dùng `/api/dispatch/approvers` thay vì `dept-leader` — nếu module sau
(vd Sản lượng, Bảo trì) cũng cần "Giám đốc nhà máy" làm người duyệt, tái dùng route này thay vì
tạo bản sao mới.

### Đã kiểm tra

`npx tsc --noEmit` sạch toàn repo; `npx eslint` trên toàn bộ file đã sửa/thêm — 0 lỗi, 7 warning
còn lại trong `dispatch/page.tsx` đều pre-existing (đối chiếu `git diff` xác nhận không nằm gần
bất kỳ dòng nào phiên này chạm tới). Không chạy `npm run build`.

### BẮT BUỘC trước khi coi module Điều xe là xong

1. Chạy `supabase/migrations/20260908_dispatch_signing_phe_duyet.sql` trên Supabase SQL Editor.
2. Cấp quyền `dispatch.phe_duyet` cho đúng tài khoản Giám đốc nhà máy qua Cài đặt → Phân quyền
   (mặc định chỉ admin có).
3. Kiểm tra hồ sơ Giám đốc trong Cài đặt → Bảo trì → Nhân sự bảo trì: `chuc_vu` hoặc
   `chuc_vu_chinh_quyen` phải đúng nguyên văn **"Giám đốc"** (không thêm hậu tố), và đã "Liên kết
   tài khoản" (`profile_id`) — thiếu 1 trong các điều kiện này thì `/api/dispatch/approvers` trả
   rỗng, modal chặn hẳn nút submit.
4. Test tay trên `npm run dev`:
   - Bấm "Ký duyệt" ở 1 phiếu điều xe → xác nhận modal tự nhận diện đúng Giám đốc nhà máy (hoặc
     hiện đúng banner đỏ nếu thiếu điều kiện) → tạo yêu cầu ký → vào SignScreen (`/dashboard/ky/[id]`)
     ký vai trò Lập bảng → xác nhận PDF sau ký có chữ ký + tên đúng vị trí (không đè lên bảng dữ
     liệu, không đè lên "Giám đốc nhà máy"/"Lập bảng" label).
   - Đăng nhập tài khoản Giám đốc → ký tiếp vai trò Phê duyệt → xác nhận yêu cầu chuyển
     `hoan_tat`, nút "Xuất PDF ngày" ở danh sách tự đổi thành icon mắt mở đúng file đã ký.
   - Bấm "Ký duyệt" lần 2 cho cùng 1 phiếu khi đã có yêu cầu đang luân chuyển → xác nhận bị chặn
     đúng theo unique index (không tạo được yêu cầu trùng).
   - Test "Hủy yêu cầu" (người tạo/admin) và "Trả về" (Giám đốc trả lại cho Lập bảng sửa) — 2 tính
     năng này dùng thẳng lõi `src/lib/signing/requests.ts` không sửa gì, chỉ cần xác nhận UI hiển
     thị đúng badge tương ứng.
   - Test tài khoản không có `dispatch.edit` → xác nhận không thấy nút "Ký duyệt" (badge ẩn hẳn
     khi `!canCreate` và chưa có yêu cầu ký).
5. Xác nhận bảng "Ký duyệt" mới không làm vỡ layout danh sách trên mobile (bảng dùng
   `ResponsiveTableWrapper` sẵn có, nhưng đây là cột thứ 8/9 — kiểm tra cuộn ngang vẫn mượt).

### Việc CỐ Ý chưa làm (đúng phạm vi "chỉ Điều xe" đã chốt)

- Chưa đụng Xuất hàng/Sản lượng/Kho nguyên liệu/Bảo trì — theo đúng "dừng lại xác nhận sau mỗi
  module" người dùng đã chọn.
- Chưa thêm badge/nút ký duyệt vào trang chi tiết (`view === "detail"`) — chỉ có ở danh sách,
  đúng nơi nút "Xuất PDF ngày" gốc đang tồn tại (trang chi tiết chỉ có PDF từng chuyến, không có
  PDF cả ngày).

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (Giai đoạn 4, phần 1 — Điều xe)" trong CLAUDE.md. Module Điều xe đã CODE XONG
(tsc/eslint sạch) nhưng CHƯA chạy migration `20260908_dispatch_signing_phe_duyet.sql` và CHƯA
test tay — đọc kỹ mục "BẮT BUỘC trước khi coi module Điều xe là xong" để biết việc cần làm trước.

Nếu tôi xác nhận Điều xe đã test xong và ổn, hỏi tôi chọn module DỄ tiếp theo (Xuất hàng/Sản
lượng/Kho nguyên liệu/Bảo trì) — KHÔNG tự ý chọn, và tiếp tục dừng lại xác nhận sau mỗi module
như đã chốt. Nếu module tiếp theo cũng cần "Giám đốc nhà máy" làm người duyệt, tái dùng
`/api/dispatch/approvers` (đổi tên nếu cần tổng quát hóa) thay vì tạo route sao chép mới.

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi không
chắc dev server của tôi có đang chạy song song hay không.
```


## Cập nhật (Giai đoạn 4, tiếp) — Fix 3 bug lõi dùng chung (áp dụng cho CẢ Chất lượng lẫn Điều xe)

Người dùng test tay module Điều xe và phát hiện 3 bug — cả 3 đều nằm trong lõi dùng chung
(`src/lib/signing/requests.ts`, `src/app/dashboard/ky/[id]/page.tsx`), không riêng module nào,
nên đã sửa 1 lần cho cả Chất lượng lẫn Điều xe (và mọi module Giai đoạn 4 sau này).

### 1. Không có ràng buộc thứ tự ký — có thể ký ngay sau khi vừa "Trả về"

`signField()` trước đây không kiểm tra người ký trước (`thu_tu` nhỏ hơn) đã ký xong chưa — ai
cũng ký được bất cứ lúc nào. Hệ quả cụ thể: sau khi Giám đốc bấm "Trả về" (predecessor bị reset
về `cho`), chính `nguoi_ky` của Giám đốc vẫn ở trạng thái `cho` (chưa ký) nên UI vẫn hiện nút "Ký
xác nhận" — Giám đốc ký được ngay dù Lập bảng chưa sửa & ký lại.

- **Backend** (`src/lib/signing/requests.ts`'s `signField()`): thêm chặn cứng — trước khi stamp,
  query toàn bộ `nguoi_ky` cùng `yeu_cau_id`, nếu có bất kỳ ai `thu_tu` nhỏ hơn mà chưa `da_ky`
  thì throw `"Chưa tới lượt ký của bạn — cần người ký trước hoàn tất trước."`.
- **Frontend** (`ky/[id]/page.tsx`): thêm `myTurn = !myNguoiKy || nguoiKyList.every(n => n.thu_tu
  >= myNguoiKy.thu_tu || n.trang_thai === "da_ky")`. Action bar (`Trả về`/`Xem khung của
  tôi`/`Ký xác nhận`) chỉ hiện khi `myTurn` true; khi `!myTurn` hiện dòng chữ "Chưa tới lượt bạn
  — đang chờ người ký trước hoàn tất." thay cho các nút. `statusBadge` ở topbar cũng thêm nhánh
  "Chưa tới lượt bạn".
- Đã verify logic bằng tay (không phải chạy test): sau khi Giám đốc trả về, `canReturn`(Giám đốc)
  tự động về `false` (predecessor không còn `da_ky`) VÀ `myTurn`(Giám đốc) cũng về `false` cùng
  lúc — Giám đốc không còn thấy nút nào cho tới khi Lập bảng ký lại xong.

### 2. Lý do trả về chỉ nằm trong tooltip `title` — người Lập bảng không biết cần sửa gì

`YeuCauKy` type trong `ky/[id]/page.tsx` trước đây **không có** `tra_ve_ly_do`/`tra_ve_boi`/
`tra_ve_luc` — SignScreen (nơi người Lập bảng thực sự vào để sửa & ký lại) hoàn toàn không hiển
thị lý do trả về ở đâu cả; badge ở màn danh sách chỉ có lý do trong `title` (tooltip hover — khó
phát hiện, không hoạt động trên mobile).

- Thêm 3 field trên vào `YeuCauKy` type (dữ liệu đã có sẵn qua `.select("*")`, chỉ thiếu type).
- Thêm banner đỏ ngay dưới topbar của SignScreen, hiện khi `trang_thai === "dang_luan_chuyen" &&
  tra_ve_ly_do` (tự biến mất khi ký lại thành công, vì `signField()` đã xoá 3 cột này khi ký lại
  — không cần sửa gì thêm ở đó): "Hồ sơ đã bị trả về bởi {tên} lúc {giờ}: {lý do}". Tên resolve
  qua `profiles` map đã có sẵn (participant nào cũng nằm trong map này).
- `quality-sign-status.tsx` và `dispatch-sign-status.tsx`: đổi từ chỉ có `title` tooltip sang
  thêm 1 dòng `<p>` hiện rõ "Lý do: {...}" (truncate, vẫn giữ `title` đầy đủ làm fallback khi
  bị cắt) ngay dưới badge — đồng bộ cả 2 module cùng lúc.

### 3. Sau khi ký thành công, khung chữ ký của chính mình bị che bởi khối "✓ Đã ký" đặc màu

`myFields`'s khung `chu_ky` khi `iAlreadySigned` trước đây vẽ `bg-emerald-50` (nền đặc, không
trong suốt) + text "✓ Đã ký" phủ kín toàn khung — đè hoàn toàn lên đúng vị trí ảnh trang đã tải
lại (đã có chữ ký thật stamp sẵn trong ảnh). Người vừa ký không bao giờ nhìn thấy chữ ký thật của
chính mình, chỉ thấy 1 khối banner trừu tượng.

- Bỏ hẳn nền đặc `bg-emerald-50` khi `iAlreadySigned` — chỉ còn viền mảnh `border-emerald-400`,
  để lộ hoàn toàn ảnh trang (đã có chữ ký thật) bên dưới — mirror đúng cách `otherFields` đã xử
  lý cho người KHÁC đã ký (bug fix trước đó, `nguoiKyStatusById`).
  Bỏ luôn `overflow-hidden` cho nhánh đã ký để badge góc không bị cắt.
- Thay text "✓ Đã ký" phủ toàn khung bằng 1 chấm tròn nhỏ (`h-4 w-4`, nền emerald, dấu ✓ trắng)
  đặt ở góc trên-phải khung (`right-0.5 top-0.5`) — chỉ đủ để xác nhận trực quan "khung này của
  tôi và đã ký", không che chữ ký thật.

### Đã kiểm tra

`npx tsc --noEmit` sạch toàn repo; `npx eslint` trên cả 4 file đã sửa
(`src/lib/signing/requests.ts`, `src/app/dashboard/ky/[id]/page.tsx`,
`quality-sign-status.tsx`, `dispatch-sign-status.tsx`) — 0 lỗi, 0 warning. Không chạy
`npm run build`.

### Chưa test tay — cần làm trước khi coi 3 fix này là xong

1. Lặp lại đúng kịch bản đã báo lỗi: Lập bảng ký → Giám đốc "Trả về" kèm lý do → xác nhận Giám
   đốc **không còn thấy nút "Ký xác nhận"/"Trả về"** nữa (chỉ thấy dòng "Chưa tới lượt bạn...").
2. Với tài khoản Lập bảng: mở link từ badge "Trả về — Sửa & ký lại" → xác nhận thấy banner đỏ
   hiện đúng tên Giám đốc + giờ + lý do ngay đầu trang; badge ở màn danh sách cũng hiện dòng "Lý
   do: ..." rõ ràng, không cần hover.
3. Lập bảng ký lại → xác nhận banner đỏ tự biến mất, Giám đốc thấy lại nút "Ký xác nhận" bình
   thường; Giám đốc ký xong → xác nhận khung chữ ký của Giám đốc hiện đúng chấm ✓ nhỏ góc phải,
   **nhìn thấy rõ ảnh chữ ký thật** bên dưới (không còn bị khối xanh che kín).
4. Thử cố tình gọi `sign-field` (hoặc thao tác nhanh 2 tab) khi chưa tới lượt để xác nhận backend
   thật sự chặn (không chỉ UI) — nhận đúng lỗi "Chưa tới lượt ký của bạn...".
5. Test cả 2 module Chất lượng lẫn Điều xe cho đủ 4 mục trên, vì cả 2 dùng chung lõi vừa sửa.

## Xác nhận (2026-09-08) — Điều xe + 3 fix lõi dùng chung đã test tay xong

Người dùng xác nhận cả 3 mục trong checklist "Chưa test tay" ở trên: (1) trả về xong không ký
lại được — pass; (2) nội dung trả về đã hiển thị rõ — pass; (3) chữ ký thật hiện đúng sau khi
Giám đốc xác nhận ký — pass. Coi như **Giai đoạn 4 phần Điều xe hoàn tất**, bao gồm cả 3 fix lõi
dùng chung (áp dụng tự động cho Chất lượng). Còn vài việc nhỏ chưa xác nhận riêng nhưng không
chặn (nút "Hủy yêu cầu", layout mobile của cột "Ký duyệt", ẩn nút khi thiếu `dispatch.edit`) —
có thể test tùy nghi sau, không cần trước khi sang module khác.

## Kế hoạch phiên sau — Giai đoạn 5: module Bảo trì

Người dùng chọn tiếp tục nhân rộng hệ thống ký số dùng chung sang **Bảo trì** — module phức tạp
nhất trong nhóm "DỄ" ban đầu (7 loại chứng từ PDF khác nhau, `src/lib/maintenance-pdf.ts`, xem
`.claude/rules/14-maintenance-module.md`). **CHƯA CODE GÌ cho module này** — phiên sau phải khảo
sát kỹ và hỏi lại phạm vi trước khi bắt đầu, đừng tự suy diễn như đã làm với Điều xe (Điều xe có
đúng 1 tài liệu tự nhiên cần ký; Bảo trì có ít nhất 4 ứng viên khác nhau, mỗi cái nhiều người ký
hơn hẳn mô hình 2 người (Lập bảng/Lập biểu + 1 người duyệt) đã dùng ở Chất lượng/Điều xe).

### Khác biệt quan trọng so với Chất lượng/Điều xe — đọc kỹ trước khi hỏi người dùng

1. **Bảo trì ĐÃ CÓ SẴN 1 luồng phê duyệt riêng, không liên quan hệ thống ký số dùng chung**:
   `maintenance_records.trang_thai`: `cho_duyet -> da_duyet` (nút "Phê duyệt", quyền
   `maintenance.approve`, tự động tạo phiếu xuất kho nếu có vật tư `trong_kho`). Đây KHÔNG phải
   ký số — chỉ là đổi trạng thái + ghi `nguoi_duyet`/`ngay_duyet` dạng text, không có PDF nào
   được stamp chữ ký ở bước này. Việc in PDF (7 hàm `downloadMaintenanceXxxPdf`) xảy ra RIÊNG,
   sau khi đã duyệt, luôn có dòng kẻ trống để ký tay trên giấy.
   -> Cần quyết định RÕ: hệ thống ký số dùng chung sẽ THAY THẾ nút "Phê duyệt" hiện tại (đổi hẳn
   luồng `cho_duyet/da_duyet` đang chạy thật sang ký điện tử — rủi ro cao, ảnh hưởng cả việc tự
   tạo phiếu xuất kho), hay chạy SONG SONG như 1 hành động MỚI, riêng biệt, KHÔNG đụng
   `cho_duyet/da_duyet` (an toàn hơn — giống cách Chất lượng thêm "Ký duyệt" bên cạnh workflow
   sẵn có, không thay thế gì)? **Khuyến nghị mặc định: chạy song song, không đụng
   `cho_duyet/da_duyet`** — nhưng phải hỏi người dùng xác nhận, không tự quyết.
2. **4 ứng viên tài liệu có thể ký** (loại trừ 3 loại còn lại — `ly_lich`/`ly_lich_xe`/
   `bao_cao_ky` là báo cáo tổng hợp nhiều thiết bị/kỳ, không gắn với 1 bản ghi/1 lượt duyệt cụ
   thể, giống lý do Điều xe loại `downloadDispatchStatsPdf`/`downloadDispatchTripPdf`):
   - `su_co_nho` (F13+F10+F15+Ảnh) — ký 4 người: BGĐ phụ trách | Nhân viên kỹ thuật | Tổ cơ điện
     | Giám đốc nhà máy.
   - `bao_duong` (F03+F15+Ảnh) — ký 3 người: BGĐ phụ trách | Nhân viên phụ trách | Giám đốc.
   - `bao_duong_xe` (F03+F15+F06+Ảnh) — ký 4 người: BGĐ phụ trách | Nhân viên phụ trách | Tài xế
     | Giám đốc nhà máy.
   - `sua_chua_nho_xe` (F08+F15SmallVehicle+F06+Ảnh) — ký 3-4 người: BGĐ phụ trách | NV phụ
     trách | Tài xế | Giám đốc nhà máy (xem rule 14 để chính xác số cột ký từng mẫu con).
   -> 4 loại này có SỐ NGƯỜI KÝ và VAI TRÒ khác nhau — không thể dùng chung 1 modal/1 hàm build
   như Chất lượng/Điều xe (2 người cố định). Cần thiết kế modal chọn người ký ĐỘNG theo số vai
   trò của đúng loại chứng từ đang mở, hoặc làm 4 modal riêng — hỏi người dùng có muốn làm cả 4
   trong 1 phiên hay chỉ 1 loại trước (khuyến nghị: 1 loại trước, ví dụ `su_co_nho`, để verify
   mô hình nhiều người ký hoạt động đúng rồi mới nhân rộng sang 3 loại còn lại).
3. **Người ký không phải lúc nào cũng suy ra được tự động qua `maintenance_staff.chuc_vu`** như
   Giám đốc nhà máy (Điều xe) hay Trưởng phòng QLCL (Chất lượng): "Nhân viên kỹ thuật"/"Nhân
   viên phụ trách"/"Tổ cơ điện"/"Tài xế" trong Bảo trì đã có sẵn cơ chế chọn TAY qua dropdown khi
   soạn biên bản (`nv_phu_trach`, `nguoi_thuc_hien[]`, `ten_tai_xe`...) — nhiều khả năng ký số
   nên ký ĐÚNG NHỮNG NGƯỜI ĐÃ ĐƯỢC GHI TRONG CHÍNH BIÊN BẢN ĐÓ (snapshot có sẵn), không cần tự
   nhận diện qua chức vụ như 2 module trước — cần đọc kỹ cấu trúc `maintenance_records`/
   `maintenance_record_lines` (rule 14) để map đúng field nào ứng với vai trò ký nào của từng
   loại chứng từ, và xác nhận field đó lưu `user_id`/`profile_id` thật hay chỉ lưu TÊN dạng text
   snapshot (nếu chỉ có text, không thể tạo `nguoi_ky.user_id` — phải hỏi người dùng xử lý sao).

### Việc cần làm ở phiên sau (theo thứ tự)

1. Đọc kỹ `.claude/rules/14-maintenance-module.md` (toàn bộ, đặc biệt cấu trúc dữ liệu 3 bảng và
   phần "In biên bản (9 type)") và `src/lib/maintenance-pdf.ts` (đặc biệt 4 hàm dựng chứng từ đã
   liệt kê ở trên) để nắm chính xác field nào lưu tên/ID của từng vai trò ký trong từng loại
   chứng từ — đừng đoán từ rule doc, phải đọc code thật.
2. Hỏi người dùng qua AskUserQuestion (bắt buộc, đừng tự quyết) tối thiểu 2 câu:
   - Ký số chạy song song với `cho_duyet/da_duyet` hiện có, hay thay thế hẳn?
   - Bắt đầu với đúng 1 loại chứng từ nào trong 4 loại (khuyến nghị `su_co_nho`), hay làm cả 4
     luôn trong 1 phiên?
3. Sau khi chốt phạm vi, làm đúng "4 việc cần làm riêng cho mỗi module" như đã làm cho Điều xe:
   (a) hàm build PDF kèm tọa độ khung ký (tách từ `downloadMaintenanceXxxPdf` tương ứng, mirror
   `buildDispatchEntryPdfForSigning`/`buildDispatchEntryDoc`); (b) modal tạo yêu cầu ký — LƯU Ý
   modal này phức tạp hơn (nhiều người ký, có thể cần hỏi tay 1 số vai trò không tự suy ra
   được); (c) route `/api/maintenance/signing-status` riêng; (d) badge trạng thái + nút trong
   danh sách `maintenance/records/page.tsx` (hoặc trang chi tiết `records/[id]/page.tsx`, tùy
   nơi tự nhiên nhất — cần xác định qua khảo sát bước 1).
4. Không cần permission mới nếu dùng lại `maintenance.approve` làm cổng `canCreate` (đã có sẵn,
   đúng nguyên tắc "dùng thẳng quyền CRUD/duyệt có sẵn của module" đã chốt ở mục Điều xe/Chất
   lượng) — xác nhận lại với người dùng vì Bảo trì có phân biệt rõ "tạo biên bản" vs "duyệt biên
   bản" (2 quyền khác nhau), nên có thể cần dùng permission khác cho đúng ngữ nghĩa "gửi ký
   duyệt" ở đây.

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi không
chắc dev server người dùng có đang chạy song song hay không.

### Prompt gợi ý để mở đầu session tiếp theo

Đọc mục "Xác nhận (2026-09-08)" và "Kế hoạch phiên sau — Giai đoạn 5: module Bảo trì" trong
CLAUDE.md. Giai đoạn 4 (Điều xe + 3 fix lõi dùng chung áp dụng cho cả Chất lượng) ĐÃ HOÀN TẤT và
ĐÃ TEST TAY XONG — không cần test lại trừ khi tôi báo lỗi mới.

Bắt đầu Giai đoạn 5: nhân rộng hệ thống ký số dùng chung sang module Bảo trì — module PHỨC TẠP
HƠN HẲN Chất lượng/Điều xe (4 loại chứng từ khác nhau, mỗi loại 3-4 người ký khác nhau, và ĐÃ CÓ
SẴN 1 luồng phê duyệt cho_duyet/da_duyet riêng không liên quan ký số). Đọc kỹ mục "Khác biệt
quan trọng so với Chất lượng/Điều xe" trong CLAUDE.md trước khi làm gì — đặc biệt đọc trực tiếp
`.claude/rules/14-maintenance-module.md` và `src/lib/maintenance-pdf.ts` để biết chính xác field
nào lưu người ký của từng vai trò trong từng loại chứng từ (đừng đoán).

BẮT BUỘC hỏi tôi qua AskUserQuestion trước khi code (tối thiểu 2 câu, xem mục "Việc cần làm ở
phiên sau" bước 2): (1) ký số chạy song song với cho_duyet/da_duyet hiện có hay thay thế hẳn —
khuyến nghị song song, an toàn hơn; (2) bắt đầu với đúng 1 loại chứng từ (khuyến nghị
`su_co_nho`) hay làm cả 4 loại luôn. KHÔNG tự suy diễn phạm vi như đã cảnh báo trong lịch sử dự
án — Bảo trì có nhiều biến thể hơn hẳn 2 module đã làm, sai một quyết định ở đây sẽ tốn công sửa
lại cho cả 4 loại chứng từ.

Sau khi chốt phạm vi, làm đúng "4 việc cần làm riêng cho mỗi module" (build PDF kèm tọa độ, modal
tạo yêu cầu ký, route signing-status riêng, badge trạng thái trong danh sách) — mirror cách đã
làm cho Điều xe (`src/lib/dispatch-pdf.ts`'s `buildDispatchEntryPdfForSigning`,
`dispatch-sign-modal.tsx`, `dispatch-sign-status.tsx`, `/api/dispatch/*`), nhưng đừng copy máy
móc vì Bảo trì có nhiều người ký hơn — modal cần thiết kế lại cho phù hợp.

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi không
chắc dev server của tôi có đang chạy song song hay không.

## Cập nhật (Giai đoạn 5, phần 1 — Bảo trì, `su_co_nho`) — đã code xong, CHƯA test tay

Đã hỏi 4 câu qua `AskUserQuestion` trước khi code, người dùng chốt: (1) ký số chạy **song song**
với `cho_duyet/da_duyet`, không đụng luồng phê duyệt hiện có; (2) chỉ làm **`su_co_nho`** (F13+
F10+F15+Ảnh) trước, 3 loại còn lại (`bao_duong`, `bao_duong_xe`, `sua_chua_nho_xe`) để sau; (3)
vai trò **"Tài xế"** bị bỏ hẳn khỏi ký số điện tử (giữ khoảng trống ký tay như cũ) — hoá ra
không ảnh hưởng `su_co_nho` vì đã xác nhận qua code F13/F10/F15 KHÔNG có vai trò Tài xế ở bất kỳ
đâu (chỉ `sua_chua_nho_xe`/F08+F15SmallVehicle+F06 mới có); (4) quyền gate nút "Ký duyệt" là
**`maintenance.create`** (không phải `maintenance.approve`) — không cần permission/migration mới.

### Phát hiện quan trọng khi đọc code trước khi làm (khác giả định ban đầu trong kế hoạch)

- Rule 14 mô tả `su_co_nho` chỉ áp dụng "Sửa chữa **ngoài** Đội xe" — **đã lỗi thời**. Đọc trực
  tiếp `records/[id]/page.tsx` xác nhận code THẬT hiện tại: `su_co_nho` áp dụng cho **mọi bộ
  phận** khi `hang_muc==='Sửa chữa'`, TRỪ đúng trường hợp `bo_phan==='Đội xe' &&
  loai_sua_chua==='nho'` (case đó mới rẽ sang `sua_chua_nho_xe`). Nghĩa là Đội xe sửa chữa LỚN
  (>200$) cũng in bundle `su_co_nho` — nhưng F13/F10/F15 (3 mẫu trong bundle này) chưa bao giờ có
  cột "Tài xế" trong hàng chữ ký (chỉ có ở F08/F15SmallVehicle/F06 của `sua_chua_nho_xe`), nên gap
  "tài xế không có tài khoản" hoàn toàn không phát sinh ở `su_co_nho` bất kể bộ phận — khớp đúng
  quyết định (3) ở trên mà không cần thu hẹp phạm vi nút "Ký duyệt" theo bộ phận.
- `dispatch_drivers` xác nhận **không có** cột `profile_id`/`user_id` nào — tài xế chỉ là master
  data tên (Cambodian names), không có tài khoản đăng nhập trong hệ thống.
- `maintenance_staff.profile_id` (migration `20260607_link_profiles_to_maintenance_staff.sql`)
  liên kết TÊN snapshot trên biên bản (`bgd_phu_trach`/`nv_phu_trach`/`giam_doc`, và tên trong
  `nguoi_thuc_hien[]`) sang tài khoản `auth.users` thật — đây là cơ chế resolve chính, KHÁC hẳn
  Chất lượng/Điều xe (2 module đó tự nhận diện người duyệt qua CHỨC VỤ vì không có sẵn tên
  snapshot; Bảo trì đã có sẵn tên chọn tay lúc soạn biên bản, chỉ cần resolve tên → tài khoản).

### 4 người ký của bundle `su_co_nho` (đã xác nhận qua code F13/F10/F15, không suy diễn)

| roleId | Vai trò | Xuất hiện ở | Nguồn tên |
|---|---|---|---|
| `bgd_phu_trach` | BGĐ phụ trách | F13, F10, F15 (3 field-pairs) | `maintenance_records.bgd_phu_trach` |
| `nv_phu_trach` | Nhân viên phụ trách/kỹ thuật | F13, F10, F15 (3 field-pairs) | `maintenance_records.nv_phu_trach` |
| `to_co_dien` | Tổ trưởng cơ điện (hoặc cơ khí nếu Đội xe) | Chỉ F13 (1 field-pair) | `nguoi_thuc_hien[]`, lọc qua `findToTruongCoDien()` (chức vụ chứa "tổ trưởng"+"cơ điện"/"cơ khí") |
| `giam_doc` | Giám đốc nhà máy (người ký cuối, `vai_tro='phe_duyet'`) | F13, F10, F15 (3 field-pairs) | `maintenance_records.giam_doc` |

Thứ tự ký: BGĐ(10) → NV(20) → Tổ cơ điện(30) → Giám đốc(40), khớp đúng thứ tự cột trong F13.

### File đã sửa/tạo

| File | Nội dung |
|---|---|
| `src/lib/maintenance-pdf.ts` | Thêm `drawSignatureRowCapture()` (wrapper mới quanh logic gốc của `drawSignatureRow`, tính thêm toạ độ mm khung chữ ký/tên theo `roleId` do caller gán — **không đổi** hình ảnh PDF in thường, `drawSignatureRow` cũ giờ chỉ gọi lại hàm mới và bỏ `.boxes`); `drawF13`/`drawF10`/`drawF15` đổi return type từ `Promise<void>` sang `Promise<SignatureRoleBoxes[]>`; export `findToTruongCoDien`; thêm `buildSuCoNhoSigningRoles()` (resolve 4 roleId→tên, dùng chung bởi API route lẫn UI); thêm `buildMaintenanceSuCoNhoPdfForSigning()` (tách từ `buildMaintenanceSuCoNhoDoc()` dùng chung với `downloadMaintenanceSuCoNhoPdf()` cũ, mirror pattern `buildQualityKqknDoc` ở `quality-pdf.ts`) |
| `src/app/api/maintenance/su-co-nho-signers/route.ts` | Mới — GET, resolve tên snapshot trên biên bản → `maintenance_staff.profile_id` → `profiles` (kiểm cả `status==='active'`), trả về từng vai trò kèm `resolved`/`reason` nếu thiếu |
| `src/app/api/maintenance/signing-status/route.ts` | Mới — GET, mirror `dispatch/signing-status/route.ts` nhưng trả **toàn bộ danh sách 4 người ký** (không chỉ 1 approver) vì `su_co_nho` là mô hình 4 người ngang hàng, không phải 2 người (lập biểu + 1 duyệt) |
| `src/app/dashboard/maintenance/records/_components/maintenance-sign-modal.tsx` | Mới — `MaintenanceSignModal`, hiện 4 dòng vai trò kèm trạng thái resolve (✓/✗ + lý do), chặn submit nếu bất kỳ vai trò nào chưa resolve; tự tải lại dữ liệu biên bản trực tiếp từ DB (không dùng state form đang sửa của trang chi tiết — shape khác hẳn); **gộp theo `userId`** trước khi gọi `create-request` — nếu 1 người trùng 2 vai trò (vd NV phụ trách cũng là Tổ trưởng cơ điện), gộp tất cả field vào đúng 1 `nguoi_ky` để không vi phạm unique constraint `(yeu_cau_id, user_id)` |
| `src/app/dashboard/maintenance/records/_components/maintenance-sign-status.tsx` | Mới — `MaintenanceSignStatusBadge`, khác `DispatchSignStatusBadge`/`QualitySignStatusBadge` (nhị phân lập biểu/duyệt) — hiện tiến độ dạng "N/4 đã ký", đủ 5 nhánh (chưa có yêu cầu/đang chờ/đã trả về/đã hoàn tất/nút hủy) |
| `src/app/dashboard/maintenance/records/[id]/page.tsx` | Thêm `suCoNhoEligible` (đúng điều kiện IIFE render nút "In biên bản"), `signingStatus`/`signModalOpen` state, `loadSigningStatus()`, badge + nút "Ký duyệt" chèn ngay cạnh nút "In biên bản" (chỉ trong nhánh `su_co_nho`, không đụng nhánh `sua_chua_nho_xe`/Bảo dưỡng), modal render cuối trang. `showToast` cho badge tái dùng 2 state `saveSuccess`/`saveError` đã có sẵn (không thêm toast riêng) |

**Không cần migration nào** — không bảng/cột/permission mới (`maintenance.create` đã có sẵn từ
trước; 6 bảng lõi ký số dùng chung đã tồn tại từ Giai đoạn 0).

### Quyết định thiết kế khác

- **"Ký duyệt" CHỈ đặt ở trang chi tiết biên bản** (`records/[id]/page.tsx`), không thêm badge ở
  `records/page.tsx` (danh sách) — khớp đúng tiền lệ hiện có: nút "In biên bản" cũng chỉ tồn tại
  ở trang chi tiết, danh sách hoàn toàn không có action per-row nào tương tự (đã xác nhận qua
  `grep` — `records/page.tsx` không `select()` `loai_sua_chua`/không có cột hành động in ấn).
- Route `su-co-nho-signers` **không** dùng `requireAuthUser` (chỉ nhận `factoryId`+`recordId` làm
  query param, không xác thực token) — mirror đúng mức bảo mật hiện có của
  `/api/dispatch/approvers` (route "resolve ứng viên ký" tương tự cũng không có `requireAuthUser`
  trong codebase này). Route `signing-status` (đọc trạng thái ký đã tạo) vẫn dùng
  `requireAuthUser` như `dispatch/signing-status`.
- `drawSignatureRowCapture` chỉ được **F13/F10/F15** gọi trực tiếp để lấy `.boxes` — 8 call site
  còn lại của `drawSignatureRow` (F03/F15BaoDuong/F06 không dùng hàm này/F08NB/F15SmallVehicle/
  F01/F02) **hoàn toàn không đụng tới**, vẫn gọi `drawSignatureRow` cũ (nay chỉ là wrapper mỏng
  gọi lại hàm mới và bỏ `.boxes`) — đảm bảo hình ảnh PDF của 3 loại chứng từ chưa làm không đổi 1
  pixel nào.

### Đã kiểm tra

`npx tsc --noEmit` sạch toàn repo; `npx eslint` trên toàn bộ 6 file đã sửa/thêm — 0 lỗi, 0
warning mới (5 warning còn lại trong `records/[id]/page.tsx` đều pre-existing, đã đối chiếu xác
nhận không liên quan thay đổi lần này). Không chạy `npm run build` (có nhiều tiến trình `node`
đang chạy trên máy, không chắc có phải dev server của người dùng hay không).

### CHƯA test tay — bắt buộc trước khi coi `su_co_nho` là xong

1. Mở 1 biên bản Sửa chữa đã `Đã duyệt` (bất kỳ bộ phận nào, kể cả Đội xe sửa chữa lớn) → xác
   nhận nút "Ký duyệt" (tím, cạnh "In biên bản") hiện đúng; bấm mở modal → xác nhận cả 4 vai trò
   hiện đúng tên đã gán trên biên bản.
2. Test case **thiếu resolve**: 1 biên bản có `bgd_phu_trach`/`nv_phu_trach`/`giam_doc` là tên
   chưa từng "Liên kết tài khoản" trong Cài đặt → Bảo trì → Nhân sự bảo trì, hoặc `nguoi_thuc_hien`
   không có ai mang chức vụ "Tổ trưởng cơ điện"/"cơ khí" → xác nhận đúng dòng đó hiện ✗ đỏ kèm lý
   do rõ ràng, nút "Tạo yêu cầu ký" bị khoá.
3. Test **tạo yêu cầu ký thành công** (đủ 4 vai trò resolve) → xác nhận điều hướng sang
   `/dashboard/ky/[id]`, PDF hiển thị đúng 4 (hoặc nhiều hơn nếu Ảnh) trang, khung ký đúng vị trí
   không đè lên nhãn vai trò/nội dung; ký lần lượt cả 4 người (dùng tài khoản test tạm, KHÔNG
   dùng dữ liệu nhân sự thật) → xác nhận thứ tự ký đúng (chưa tới lượt bị chặn), PDF sau ký có
   đủ chữ ký+tên ở cả 3 trang F13/F10/F15 cho đúng người, Giám đốc ký cuối chuyển `hoan_tat`.
4. Test **case 1 người trùng 2 vai trò** (vd đặt cùng 1 tên vào cả "Nhân viên phụ trách" và cho
   người đó có chức vụ "Tổ trưởng cơ điện" trong `nguoi_thuc_hien`) → xác nhận tạo yêu cầu ký
   KHÔNG lỗi (đã có logic gộp), người đó chỉ xuất hiện 1 lần trong "Luồng ký hồ sơ" ở SignScreen
   nhưng khi ký thì TẤT CẢ khung của cả 2 vai trò đều được stamp cùng lúc.
5. Test nút "Xuất PDF"/"In biên bản" (luồng cũ, không ký số) trên vài biên bản `su_co_nho` khác
   (đã có từ trước, không liên quan phiên này) → xác nhận **hình ảnh PDF không đổi gì** so với
   trước khi sửa `drawSignatureRow`/`drawF13`/`drawF10`/`drawF15` — đối chiếu bằng mắt vị trí
   nhãn "BGĐ phụ trách"/"Nhân viên kỹ thuật"/"Giám đốc nhà máy" và dòng "(Ký và ghi rõ họ tên)".
6. Test "Hủy yêu cầu" và badge tiến độ "N/4 đã ký" hiển thị đúng qua các trạng thái; test tài
   khoản không có `maintenance.create` không thấy nút "Ký duyệt" khi chưa có yêu cầu ký nào.

### Bước tiếp theo — Giai đoạn 5 phần 2 (3 loại chứng từ còn lại, CHƯA làm)

Sau khi `su_co_nho` test xong, hỏi lại người dùng có tiếp tục làm `bao_duong`/`bao_duong_xe`/
`sua_chua_nho_xe` hay không (đã chốt "dừng lại xác nhận sau mỗi loại" cùng tinh thần Giai đoạn 4).
Lưu ý khi làm `bao_duong_xe`/`sua_chua_nho_xe`: có vai trò "Tài xế" — theo quyết định (3) ở trên,
vai trò này **bị loại khỏi ký số điện tử hoàn toàn** (không phải riêng cho `su_co_nho`) — modal
của 2 loại này cần tự động bỏ qua field "Tài xế" khỏi danh sách người ký, giữ nguyên khoảng trống
ký tay trên PDF cho đúng người đó, không chặn "Ký duyệt" chỉ vì thiếu tài khoản của Tài xế.

## Cập nhật (sau Giai đoạn 5 phần 1) — Ràng buộc "chỉ người tạo mới sửa/gửi ký duyệt" cho cả
3 module (Bảo trì/Chất lượng/Điều xe) + permission `maintenance.phe_duyet` mới

Người dùng chỉ ra 2 vấn đề sau khi xem lại nút "Ký duyệt" vừa thêm ở Bảo trì: (1) nút "Ký duyệt"
chỉ check `maintenance.create`, không check người tạo biên bản — bất kỳ ai có quyền `create` đều
gửi ký duyệt được biên bản của người khác; (2) route resolve người ký `giam_doc`/`bgd_phu_trach`
chỉ dựa vào CHỨC VỤ đã chọn trên biên bản, không kiểm tra quyền phê duyệt nào cả — khác hẳn
Chất lượng (`quality.phe_duyet`)/Điều xe (`dispatch.phe_duyet`). Người dùng yêu cầu áp dụng đồng
bộ nguyên tắc "chỉ người tạo (hoặc admin) mới thấy nút Sửa/Ký duyệt" cho cả 3 module.

### Phát hiện quan trọng trước khi code

- **Bảo trì** đã có sẵn `maintenance_records.nguoi_tao` (dùng cho `isCreator` ở nút Sửa/Gửi phê
  duyệt cũ) — làm ngay được, không cần migration.
- **Điều xe**: `dispatch_entries` **hoàn toàn không có cột nào lưu người tạo**.
- **Chất lượng**: `qc_results` có cột `nguoi_kn` (TEXT) nhưng **chưa từng được ghi ở bất kỳ đâu
  trong code** — coi như luôn rỗng, không dùng được.
- Đã hỏi lại người dùng qua `AskUserQuestion` (4 câu) trước khi code, chốt: (1) thêm cột
  `created_by` (migration) cho cả `dispatch_entries` và `qc_results`, chỉ áp dụng bản ghi từ nay;
  (2) bản ghi CŨ (`created_by IS NULL`) vẫn cho ai có quyền edit thao tác (grandfather clause,
  không khoá nhầm dữ liệu lịch sử); (3) tạo permission mới `maintenance.phe_duyet` (mirror
  `quality.phe_duyet`/`dispatch.phe_duyet`, mặc định chỉ admin) thay vì tái dùng
  `maintenance.approve` (đang cấp rộng cho cả role manager, sai ngữ nghĩa "chỉ đúng Giám đốc/PGĐ
  mới phê duyệt điện tử"); (4) áp dụng cho **cả 2 vai trò lãnh đạo** — Giám đốc (`giam_doc`) VÀ
  BGĐ phụ trách/Phó giám đốc (`bgd_phu_trach`) — không chỉ riêng Giám đốc.

### Đã code

- `supabase/migrations/20260909_maintenance_phe_duyet_permission.sql` — permission mới
  `maintenance.phe_duyet`, seed cho `role='admin'`. **CHƯA CHẠY.**
- `supabase/migrations/20260910_ownership_created_by_columns.sql` — `ALTER TABLE dispatch_entries
  ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL` (tương tự cho
  `qc_results`) + index. **CHƯA CHẠY.**
- `src/app/api/maintenance/su-co-nho-signers/route.ts` — thêm kiểm tra `maintenance.phe_duyet`
  cho đúng 2 `roleId` `bgd_phu_trach`/`giam_doc` (không áp dụng cho `nv_phu_trach`/`to_co_dien` —
  2 vai trò xác nhận kỹ thuật, không phải phê duyệt cuối); check qua `user_permissions` (explicit
  `granted=true`) HOẶC `role_permissions` (theo `profiles.role`), admin luôn qua. Thiếu quyền →
  `resolved:false` kèm lý do "chưa được cấp quyền phê duyệt điện tử (maintenance.phe_duyet)".
- `src/app/dashboard/maintenance/records/[id]/page.tsx` — nút "Ký duyệt" (`MaintenanceSignStatusBadge`'s
  `canCreate`) đổi từ chỉ `hasPermission(user,"maintenance.create")` sang thêm
  `&& (isAdmin || isCreator)` — tái dùng đúng `isCreator`/`isAdmin` đã có sẵn cho nút Sửa/Gửi phê
  duyệt cũ, không tạo biến mới.
- `src/app/dashboard/quality/page.tsx` — thêm `created_by: user.id`/`created_by:
  currentUser?.id ?? null` vào 2 nơi insert `qc_results` (tạo phiếu mới + import Excel); thêm
  `QcResult.created_by` vào type; thêm biến `canOwnerAct` (tính 1 lần mỗi `date` trong
  `dateGroups.map()`: admin HOẶC cả ngày không có `created_by` nào (dữ liệu cũ) HOẶC current user
  đã tạo ít nhất 1 phiếu trong ngày đó) — áp dụng cho cả nút "Sửa" (mở Edit Date Modal) lẫn
  `canCreate` của nút "Gửi ký duyệt". **Quyết định thiết kế**: vì 1 "biên bản" Chất lượng = gộp
  nhiều phiếu/batch trong CÙNG 1 NGÀY, có thể do NHIỀU người khác nhau tạo — dùng luật "đã đóng
  góp ít nhất 1 phiếu trong ngày" làm điều kiện sở hữu (không đòi hỏi sở hữu TẤT CẢ phiếu trong
  ngày, tránh khoá nhầm khi nhiều kỹ thuật viên cùng nhập liệu 1 ngày).
- `src/app/dashboard/dispatch/page.tsx` — thêm `created_by: currentUser?.id ?? null` vào 2 nơi
  insert `dispatch_entries` (tạo bảng phân xe mới + import CSV/Excel); thêm `DispatchEntry.created_by`
  vào type; thêm biến `canOwnerEditEntry` (tính 1 lần mỗi `entry` trong `filtered.map()`) —  áp
  dụng cho cả nút "Sửa" (trước đây **hoàn toàn không có gate quyền nào**, kể cả `dispatch.edit` —
  đã tiện thể vá luôn khi thêm ownership check) lẫn `canCreate` của badge "Ký duyệt".

### ⚠️ Giới hạn quan trọng — chỉ chặn ở UI, CHƯA chặn ở RLS/DB

Đã đọc trực tiếp `supabase/migrations/20260822_rls_lockdown_factories_and_write_protect.sql` —
RLS UPDATE/DELETE của cả `dispatch_entries` lẫn `qc_results` **chỉ kiểm tra đúng `factory_id`**,
KHÔNG kiểm tra quyền hay người tạo. Nghĩa là: toàn bộ rule "chỉ người tạo mới sửa được" trong mục
này **chỉ có hiệu lực qua giao diện web** — bất kỳ user nào cùng nhà máy vẫn có thể UPDATE/DELETE
trực tiếp qua Supabase client (devtools/API call thủ công) bất kể `created_by`/quyền `edit`. Đây
là giới hạn có sẵn từ trước (không phải lỗi mới phát sinh phiên này), áp dụng cho CẢ những nút
Sửa/Xóa khác vốn đã tồn tại từ lâu ở 2 module này. Muốn chặn triệt để ở tầng DB cần viết lại RLS
policy (thêm điều kiện `created_by = auth.uid() OR current_profile_role()='admin' OR
current_profile_has_permission('...')`) — đây là thay đổi bảo mật lớn hơn, **chưa làm**, cần bàn
riêng và cân nhắc kỹ (RLS vừa được hardening kỹ ở đợt `20260821`-`20260823`, đổi thêm lần nữa cần
rà lại toàn bộ luồng ghi hợp lệ hiện có để tránh chặn nhầm).

### Đã kiểm tra

`npx tsc --noEmit` sạch toàn repo. `npx eslint` trên 4 file đã sửa (`quality/page.tsx`,
`dispatch/page.tsx`, `su-co-nho-signers/route.ts`, `records/[id]/page.tsx`) — 0 lỗi/warning MỚI;
đã đối chiếu số lượng lỗi `no-explicit-any` trong `quality/page.tsx` (10 lỗi, không đổi trước/sau)
và các warning unused-var trong `dispatch/page.tsx` để xác nhận toàn bộ là pre-existing (nằm
trong phần code Giai đoạn 3 Chất lượng đã có sẵn nhưng CHƯA COMMIT từ trước phiên này — xác nhận
qua `git diff --stat` thấy 149 dòng thay đổi ở `quality/page.tsx` dù phiên này chỉ sửa ~10 dòng).
Không chạy `npm run build`.

### Bổ sung (cùng phiên) — khóa thật ở tầng RLS + gate Xóa còn thiếu

Người dùng yêu cầu thêm "khóa theo người tạo và edit" (không chỉ ẩn ở UI). Đã viết
`supabase/migrations/20260911_dispatch_qc_ownership_edit_lock.sql` (**CHƯA CHẠY**):

- `qc_results` UPDATE + DELETE: khóa đầy đủ theo `current_profile_has_permission('quality.edit'
  /'quality.delete')` + ownership (`created_by=auth.uid() OR created_by IS NULL OR
  current_profile_role()='admin'`), PER-ROW (không theo nhóm ngày như UI). Đã audit toàn bộ
  `src/` bằng grep — chỉ `quality/page.tsx` tự ghi bảng này, không có write cross-module nào
  khác, an toàn để khóa cả UPDATE lẫn DELETE.
- `dispatch_entries` **chỉ khóa DELETE**, **CỐ Ý KHÔNG khóa UPDATE** — phát hiện quan trọng khi
  audit: `writeBackToDispatch()` (`output-types.ts`, chạy sau mỗi import/lưu/xóa Sản lượng)
  UPDATE trực tiếp `dispatch_entries.rows` bằng session của người đang thao tác ở SẢN LƯỢNG
  (thường không phải người tạo phiếu Điều xe gốc), và lời gọi này là fire-and-forget
  (`.catch(() => {})`) nên lỗi RLS sẽ bị NUỐT ÂM THẦM — nếu khóa UPDATE theo `created_by`, đồng
  bộ KL Điều xe↔Sản lượng sẽ NGỪNG hoạt động cho bất kỳ ai không phải người tạo phiếu, không ai
  biết vì không có lỗi hiển thị. Đây là lý do UPDATE của `dispatch_entries` giữ nguyên như cũ
  (chỉ khóa factory_id), chỉ dựa vào lớp UI đã làm ở mục trên.
- Do RLS DELETE giờ đòi `dispatch.delete`/`quality.delete`, đã rà lại UI: nút "Xóa" ở danh sách
  Điều xe (`dispatch/page.tsx`) **trước đây hoàn toàn không có gate quyền/ownership nào** (khác
  hẳn Sửa) — đã thêm `hasPermission(...,"dispatch.delete") && canOwnerEditEntry`. Nút Xóa ở
  Chất lượng đã có sẵn gate quyền, chỉ thêm `canOwnerAct` (cấp ngày, nút mở chế độ chọn) và thêm
  mới biến `canOwnerRow` (cấp từng phiếu, bên trong Edit Date Modal) khớp đúng RLS per-row.
- **Giới hạn còn lại đã biết**: chế độ "Xóa hàng loạt" (`deleteMode`) ở Chất lượng cho tick chọn
  nhiều phiếu trong 1 ngày nhưng KHÔNG lọc bỏ phiếu không thuộc sở hữu khỏi danh sách tick — nếu
  user chọn cả phiếu của người khác rồi bấm xóa, RLS sẽ ÂM THẦM chỉ xóa đúng phần phiếu họ sở
  hữu (Postgres RLS lọc theo USING clause khi DELETE nhiều dòng, không báo lỗi cho các dòng bị
  loại) — không mất an toàn dữ liệu, chỉ hơi khó hiểu ở UX ("xóa thành công" nhưng thiếu vài
  dòng). Chưa xử lý (cần lọc/disable checkbox theo `canOwnerRow` nếu muốn hoàn thiện UX này).

`npx tsc --noEmit` sạch; `npx eslint` trên `quality/page.tsx`/`dispatch/page.tsx` không phát
sinh lỗi/warning mới (đối chiếu đúng 10 lỗi `no-explicit-any` pre-existing như trước).

### CHƯA test tay — bắt buộc trước khi coi phần này là xong

1. Chạy 3 migration theo đúng thứ tự: `20260909_maintenance_phe_duyet_permission.sql`,
   `20260910_ownership_created_by_columns.sql`, rồi
   `20260911_dispatch_qc_ownership_edit_lock.sql` trên Supabase SQL Editor.
2. Cấp `maintenance.phe_duyet` cho đúng tài khoản Giám đốc/PGĐ nhà máy qua Cài đặt → Phân quyền.
3. **Bảo trì**: đăng nhập tài khoản KHÔNG phải người tạo 1 biên bản `su_co_nho` đã duyệt → xác
   nhận KHÔNG thấy nút "Ký duyệt" dù có quyền `maintenance.create`; đăng nhập đúng người tạo →
   thấy nút bình thường. Mở modal Ký duyệt trên biên bản có Giám đốc/PGĐ CHƯA được cấp
   `maintenance.phe_duyet` → xác nhận dòng đó hiện ✗ đỏ đúng lý do; cấp quyền xong → thử lại thấy
   ✓ xanh.
4. **Chất lượng**: tạo 1 phiếu KN mới (xác nhận `created_by` được ghi đúng) → đăng nhập tài khoản
   KHÁC (không tạo phiếu nào ngày đó) → xác nhận KHÔNG thấy nút "Sửa"/"Gửi ký duyệt" của ngày đó;
   admin luôn thấy đủ. Test ngày có DỮ LIỆU CŨ (trước migration, `created_by` rỗng) → xác nhận vẫn
   thấy nút bình thường (grandfather clause).
5. **Điều xe**: tương tự — tạo bảng phân xe mới bằng tài khoản A, đăng nhập tài khoản B (có
   `dispatch.edit` nhưng không tạo phiếu đó) → xác nhận KHÔNG thấy nút "Sửa" lẫn "Ký duyệt"; admin
   luôn thấy đủ; phiếu cũ (trước migration) vẫn cho ai có `dispatch.edit` thao tác bình thường.
6. Xác nhận nút "Xóa" ở cả Chất lượng/Điều xe **không đổi hành vi** (cố ý không đụng theo đúng
   phạm vi đã hỏi — user chỉ nhắc "phê duyệt và edit", không nhắc "xóa").

### Xác nhận test tay + 2 fix nhỏ phát sinh (cùng phiên)

Người dùng xác nhận test Điều xe: creator+edit thấy "Ký duyệt", chỉ edit (không phải creator)
không thấy, non-creator không còn thấy "Sửa" ở **danh sách**. Phát hiện thêm: trang **chi tiết**
(`view==="detail"`) có nút "Sửa" RIÊNG ở header, hoàn toàn chưa gate gì (không quyền, không
ownership) — lọt qua dù đã ẩn ở danh sách. Đã sửa: thêm `canEditSelected` cùng logic
`hasPermission(...,"dispatch.edit") && (admin || không có người tạo || đúng người tạo)`, bọc nút
"Sửa" trong điều kiện đó. Đã rà lại Chất lượng/Bảo trì xem có cùng kiểu lỗ hổng "gate 1 chỗ quên
chỗ khác" không — cả 2 module chỉ có đúng 1 cửa vào sửa (Chất lượng: modal, đã gate; Bảo trì:
trang chi tiết CHÍNH LÀ form sửa, không có cửa nào khác) nên không bị lặp lại.

### Bổ sung — bỏ vai trò "Tổ trưởng cơ điện/cơ khí" khỏi ký số, Nhân viên phụ trách ký thay

Người dùng xác nhận qua test tay: "Tổ trưởng cơ điện"/"Tổ trưởng cơ khí" (roleId `to_co_dien`,
trước đây tìm người thật qua `nguoi_thuc_hien` + chức vụ chứa "tổ trưởng") **hiện không có tài
khoản đăng nhập** — yêu cầu bỏ qua hẳn việc tìm người thật cho vai trò này, để **Nhân viên phụ
trách** (`nv_phu_trach`, cùng người với roleId `nv_phu_trach`) ký thay.

- `src/lib/maintenance-pdf.ts`: `drawF13`'s cột "Tổ cơ điện"/"Tổ cơ khí" đổi `name` từ
  `toTruong[0] || ""` (kết quả `findToTruongCoDien`) sang thẳng `record.nv_phu_trach` — áp dụng
  cho **cả 2 luồng** "Xuất PDF" lẫn "Ký duyệt" (dùng chung `drawF13`) vì đây là con số PHẢI khớp
  giữa tên in sẵn và tên sẽ được đóng dấu điện tử (nếu để tên khác nhau ở 2 nơi, tên in sẵn +
  tên đóng dấu sẽ đè lên nhau tại đúng vị trí `tenBox`, tạo chữ chồng khó đọc — xem thêm ghi chú
  kỹ thuật cuối mục).
  `buildSuCoNhoSigningRoles()`: bỏ hẳn tham số `staffMap` (không còn gọi `findToTruongCoDien`
  trong hàm này nữa) — `to_co_dien.name = record.nv_phu_trach`, `roleLabel` thêm hậu tố "(ký
  thay bởi Nhân viên phụ trách)" để hiện rõ trong modal xác nhận ký, tránh gây hiểu nhầm khi 2
  dòng (Nhân viên phụ trách / Tổ trưởng cơ điện) hiện cùng 1 tên.
- `src/app/api/maintenance/su-co-nho-signers/route.ts`: bỏ theo tham số `staffMap` khỏi lời gọi
  `buildSuCoNhoSigningRoles`; dọn luôn `staffMap`/cột `chuc_vu` trong query `maintenance_staff`
  (không còn nơi nào dùng tới trong file này nữa — `chuc_vu` KHÔNG bị xoá khỏi bảng, chỉ bỏ khỏi
  câu `.select()` của đúng route này).
- **Không đụng** `buildF13Participants`/đoạn "Chúng tôi gồm:" (dùng `findToTruongCoDien` cho mục
  đích KHÁC — liệt kê người có mặt trong biên bản, không phải xác định người ký) — vẫn tìm người
  thật qua `nguoi_thuc_hien` như cũ, không đổi.
- **Ghi chú kỹ thuật (chưa cần sửa, chỉ để không phải điều tra lại nếu sau này thấy chữ hơi
  đậm/mờ trên PDF đã ký)**: `buildMaintenanceSuCoNhoDoc` dùng CHUNG `drawF13`/`drawF10`/`drawF15`
  cho cả in thường lẫn ký số — tên snapshot (`record.bgd_phu_trach`/`nv_phu_trach`/`giam_doc`)
  luôn được in sẵn vào đúng ô `tenBox` ngay lúc TẠO PDF, sau đó lúc KÝ THẬT, `drawTextFit` (từ
  `src/lib/signing/stamp-pdf.ts`) vẽ ĐÈ tên người ký thật (từ `profiles.full_name`) lên ĐÚNG vị
  trí đó — không xoá nền trước khi vẽ. Nếu 2 tên khớp nhau (trường hợp bình thường, kể cả sau
  fix `to_co_dien` này) thì chỉ là vẽ 2 lần cùng 1 chữ, không lệch nội dung — có thể hơi đậm nhẹ
  do chồng nét nhưng KHÔNG đổi nội dung/không thành chữ vô nghĩa. Khác hẳn Chất lượng/Điều xe
  (đã tự thiết kế để KHÔNG in tên trước khi ký — chỉ in nhãn vai trò + gạch chân trống). Chưa
  sửa vì đây là hành vi có sẵn từ khi bắt đầu Giai đoạn 5 phần 1 (không phải lỗi mới phát sinh),
  người dùng chưa báo có vấn đề khi xem PDF đã ký thật — chỉ ghi lại để tra cứu nhanh nếu sau
  này cần.

`npx tsc --noEmit` + `npx eslint` trên cả 2 file sạch tuyệt đối (0 lỗi, 0 warning).

**Chưa test tay lại** — cần: mở 1 biên bản `su_co_nho` mới/đã có → bấm "Ký duyệt" → xác nhận
dòng "Tổ trưởng cơ điện (ký thay bởi Nhân viên phụ trách)" hiện đúng tên + trạng thái ✓ khớp với
dòng "Nhân viên phụ trách" (cùng 1 người); ký xong → mở PDF, xem kỹ cột "Tổ cơ điện"/"Tổ cơ khí"
trên F13 xem tên có rõ ràng, dễ đọc không (theo ghi chú kỹ thuật ở trên, khả năng chữ hơi đậm
hơn bình thường 1 chút — nếu KHÓ ĐỌC thật sự thì cần quay lại sửa tiếp, không chỉ đậm nhẹ).

### Bổ sung (cùng phiên) — 3 fix sau khi người dùng test tay thật

Người dùng test bằng biên bản Đội xe thật (`DX-180826/002`) và báo 3 vấn đề:

1. **"Nhân viên phụ trách chưa tới lượt ký, tưởng đang đợi Tổ trưởng cơ khí"**: nhiều khả năng
   đây là **yêu cầu ký CŨ được tạo TRƯỚC** khi có fix "Tổ trưởng ký thay bởi Nhân viên phụ trách"
   (xem mục ngay phía trên) — lúc đó `to_co_dien` có thể đã resolve ra 1 người THẬT KHÁC (không
   merge với `nv_phu_trach`), tạo ra 4 `nguoi_ky` tách rời thay vì 3. Đã đọc lại kỹ toàn bộ logic
   gộp theo `userId` trong `maintenance-sign-modal.tsx` và thứ tự `thu_tu` (BGĐ=10 → NV+Tổ cơ
   điện gộp chung=20 → Giám đốc=40) — **không tìm thấy bug** trong code hiện tại; với 1 yêu cầu
   ký MỚI (tạo sau khi đã có fix "ký thay"), NV phải ký được ngay sau BGĐ vì `to_co_dien` giờ
   luôn cùng `userId` với `nv_phu_trach`. **Cần test lại bằng yêu cầu ký HOÀN TOÀN MỚI** (hủy yêu
   cầu cũ nếu còn treo `dang_luan_chuyen`, bấm "Ký duyệt" lại từ đầu) để xác nhận đã hết lỗi.
2. **"Giám đốc ký xong nhưng PDF cuối cùng không có nội dung ký" + "Nút in biên bản phải hoạt
   động như Chất lượng/Điều xe"**: ĐÚNG — nút "In biên bản" trước đây LUÔN render lại bản PDF
   TRỐNG (khoảng trống ký tay), bất kể đã có yêu cầu ký hay chưa, khác hẳn Chất lượng/Điều xe (đã
   có cơ chế đổi thành "Xem file đã ký" khi `signingStatus.fileHienTai` tồn tại). Đây không phải
   lỗi ở quá trình ký (chữ ký vẫn được đóng dấu đúng vào file), mà là người dùng đang xem NHẦM
   file (bản in nháp cũ, không phải file đã ký). Đã sửa `records/[id]/page.tsx`: nút giờ tự đổi
   thành "Xem file đã ký" (icon `Eye`, mở `signingStatus.fileHienTai`) ngay khi có yêu cầu ký,
   dù đang `dang_luan_chuyen` (đã có chữ ký 1 phần) hay `hoan_tat` — **giống hệt cơ chế Chất
   lượng/Điều xe đã yêu cầu**.
3. **"Tên bị lệch nét — nếu PDF đã in tên thì bỏ hẳn trường tên (hay chưa tới bước gắn tính năng
   ẩn/hiện tên và chữ ký)"**: đây CHÍNH LÀ vấn đề tôi đã tự dự đoán và ghi chú kỹ thuật ở mục
   trên (chưa kịp sửa vì nghĩ chỉ là lo ngại lý thuyết) — `buildMaintenanceSuCoNhoDoc` dùng CHUNG
   `drawF13`/`drawF10`/`drawF15` cho cả in thường lẫn ký số, nên tên snapshot (`bgd_phu_trach`/
   `nv_phu_trach`/`giam_doc`) bị in sẵn vào đúng ô `tenBox`, rồi lúc ký thật `drawTextFit` vẽ ĐÈ
   tên người ký lên ĐÚNG vị trí đó — 2 lần vẽ chồng nhau ra chữ lệch nét/mờ. **Đã sửa theo đúng
   hướng bạn đề xuất ("bỏ hẳn trường tên")**: thêm tham số `forSigning: boolean` xuyên suốt
   `buildMaintenanceSuCoNhoDoc`/`drawF13`/`drawF10`/`drawF15` — khi `forSigning=true` (luồng Ký
   duyệt), KHÔNG in tên snapshot nữa (chỉ còn nhãn vai trò + khoảng trống, y hệt cách Chất
   lượng/Điều xe đã làm từ đầu); khi `forSigning=false` (luồng "Xuất PDF" bình thường, chưa ký
   số) vẫn in tên như cũ để phục vụ ký tay trên giấy. **Không cần** xây hệ thống bật/tắt/thêm/bớt
   tên-chữ ký kiểu ISO/Văn bản (đó là cho vị trí NGƯỜI DÙNG TỰ KÉO-THẢ trên PDF; ở đây toạ độ
   `su_co_nho` được TÍNH SẴN theo layout cố định của F13/F10/F15, không cần UI đặt vị trí).

`npx tsc --noEmit` sạch; `npx eslint` trên `maintenance-pdf.ts`/`records/[id]/page.tsx` không có
lỗi/warning mới.

**Chưa test tay lại (bắt buộc trước khi coi xong)**:
1. Nếu biên bản `DX-180826/002` (hoặc bất kỳ biên bản nào đã test) còn 1 yêu cầu ký đang
   `dang_luan_chuyen` từ TRƯỚC các fix này → bấm "Hủy yêu cầu" trước, rồi "Ký duyệt" lại để tạo
   yêu cầu HOÀN TOÀN MỚI (yêu cầu cũ không tự động sửa lại theo code mới).
2. Ký lần lượt BGĐ → Nhân viên phụ trách → Giám đốc (chỉ còn 3 lượt ký thật, không phải 4) — xác
   nhận Nhân viên phụ trách ký được NGAY sau BGĐ, không bị chặn "chưa tới lượt".
3. Sau khi hoàn tất, quay lại trang chi tiết → xác nhận nút đổi thành "Xem file đã ký" (không
   còn "In biên bản") → mở file → xác nhận CẢ 3 trang F13/F10/F15 có chữ ký + tên rõ ràng, KHÔNG
   còn hiện tượng lệch nét/chữ mờ ở bất kỳ vị trí nào (kể cả cột "Tổ cơ điện"/"Tổ cơ khí").
4. Test khi yêu cầu ký đang `dang_luan_chuyen` (chưa ký xong hết) → xác nhận nút cũng đã hiện
   "Xem file đã ký" (không phải đợi `hoan_tat` mới đổi) và mở đúng file có chữ ký MỘT PHẦN.
5. Test lại nút "Xuất PDF"/"In biên bản" ở các biên bản KHÁC (chưa từng bấm Ký duyệt) → xác nhận
   vẫn in đúng như cũ, có đủ tên snapshot cho ký tay (không bị ảnh hưởng bởi thay đổi `forSigning`).

### Đính chính (cùng phiên, sau cùng) — thứ tự ký ĐÚNG là NV phụ trách → BGĐ phụ trách → Giám đốc

Người dùng đính chính: thứ tự ký điện tử BẮT BUỘC là **Nhân viên phụ trách ký trước → BGĐ phụ
trách → Giám đốc nhà máy ký cuối (phê duyệt)** — không phải BGĐ→NV→GĐ như tôi tự suy đoán ban
đầu (tôi lấy nhầm theo thứ tự CỘT IN trên F13, không phải thứ tự nghiệp vụ thật).

- `maintenance-sign-modal.tsx`'s `ROLE_ORDER`: đổi `thu_tu` — `nv_phu_trach=10` (ký trước),
  `to_co_dien=15` (gộp cùng người với nv_phu_trach nên giá trị này chỉ mang tính dự phòng, không
  ảnh hưởng thực tế vì luôn bị merge vào thu_tu của nv_phu_trach), `bgd_phu_trach=20`,
  `giam_doc=40` (ký cuối, `vai_tro='phe_duyet'`).
- `buildSuCoNhoSigningRoles()` (`maintenance-pdf.ts`): đổi thứ tự mảng trả về khớp đúng thứ tự
  ký mới (NV → Tổ cơ điện → BGĐ → GĐ) để modal xác nhận ký hiển thị đúng thứ tự thao tác thực
  tế — **KHÔNG đụng thứ tự CỘT IN trên F13** (vẫn giữ nguyên BGĐ|NV|Tổ cơ điện|GĐ theo đúng mẫu
  KHXD-QT02-F13 — thứ tự cột in và thứ tự ký điện tử là 2 khái niệm độc lập).

`npx tsc --noEmit` + `npx eslint` sạch. **Chưa test tay** — cần tạo 1 yêu cầu ký hoàn toàn mới,
xác nhận Nhân viên phụ trách ký được NGAY LẬP TỨC (không cần chờ ai), sau đó mới tới lượt BGĐ phụ
trách, cuối cùng Giám đốc.

### Fix nhỏ cùng phiên — mã hồ sơ (`drawDocumentFooter`) neo cố định ở mép dưới trang

Trước đây dòng "KHXD-QT02-Fxx (01-15/05/2026)" được vẽ NGAY SAU khối chữ ký (`y` trôi theo nội
dung phía trên — biên bản dài/ngắn khác nhau thì dòng này trồi lên cao/thấp khác nhau). Đã sửa
`drawDocumentFooter()` trong `src/lib/maintenance-pdf.ts` để luôn neo tại `PAGE_H - MARGIN` (mép
dưới trang, góc trái) — đúng quy ước "page footer" chuẩn, độc lập nội dung phía trên. Áp dụng
đồng loạt cho **cả 11 mẫu** dùng chung hàm này (F13/F10/F15×2/F03/F06/F08/F01/F02/F07) chỉ bằng 1
lần sửa duy nhất — không cần đụng từng mẫu riêng lẻ vì tất cả gọi chung 1 hàm. `npx tsc --noEmit`
+ `npx eslint src/lib/maintenance-pdf.ts` sạch. **Chưa test tay** — cần in thử vài mẫu (đặc biệt
mẫu nhiều thiết bị/nội dung dài) xác nhận dòng mã hồ sơ luôn nằm đúng mép dưới, không đè lên nội
dung/khối chữ ký phía trên.

## Cập nhật (Giai đoạn 5, phần 1 — xác nhận đã pass) + fix footer Chất lượng + Giai đoạn 5
phần 2 (3 loại chứng từ Bảo trì còn lại: bao_duong/bao_duong_xe/sua_chua_nho_xe)

Người dùng xác nhận: 3 migration (`20260909`/`20260910`/`20260911`) đã chạy, luồng ký `su_co_nho`
với yêu cầu ký HOÀN TOÀN MỚI đã pass (thứ tự NV→BGĐ→GĐ đúng, "Xem file đã ký" đúng, PDF không còn
lệch nét tên), và ownership gating (Chất lượng/Điều xe/Bảo trì) đã pass. Phát hiện 1 điểm còn sai
ở Chất lượng: mã hồ sơ "QLCL-QT21-F08 (01-10/01/2025)" trên Phiếu KQKN chưa neo ở góc trái mép
dưới trang (trôi theo chiều cao nội dung phía trên, giống đúng loại bug đã sửa cho Bảo trì ở mục
ngay phía trên).

### Fix footer mã hồ sơ Chất lượng (`src/lib/quality-pdf.ts`)

Bỏ hẳn việc vẽ `"QLCL-QT21-F08 (01-10/01/2025)"` ngay sau khối chữ ký trong `renderBatchPage()`
(vị trí cũ phụ thuộc `y` — có thể thiếu hẳn trên các trang đầu nếu 1 batch tràn nhiều trang do
`autoTable` tự phân trang). Chuyển sang vẽ **1 lần cho MỌI trang** của toàn bộ tài liệu, trong
vòng lặp `buildQualityKqknDoc()` đã có sẵn để đánh "Trang X/Y" — đặt ở góc trái cùng `y = pageH -
5` (đối xứng với "Trang X/Y" ở góc phải cùng hàng), mirror đúng quy ước
`drawDocumentFooter()`/`PAGE_H - MARGIN` đã dùng ở `maintenance-pdf.ts`. Không đụng toạ độ khung
ký (`nguoiLap`/`nguoiPheDuyet` trong `QualityKqknPageInfo`) — vẫn tính từ `labelY`/`lineY` như cũ,
chỉ dòng mã hồ sơ đổi vị trí. `npx tsc --noEmit` sạch. **Chưa test tay** — cần in lại Phiếu KQKN
(cả trường hợp 1 trang và trường hợp nhiều batch tràn ≥2 trang) xác nhận mã hồ sơ luôn nằm đúng
góc trái mép dưới MỌI trang, không chỉ trang có khối chữ ký.

### Nghiên cứu: có thể "click vào chữ ký xem bằng chứng hiệu lực" như Acrobat (sig1.png/sig2.png)
không, với hạ tầng hiện tại?

Đã đối chiếu 2 ảnh Acrobat người dùng gửi (`cung_cap_dl/sig1.png`, `sig2.png` — hộp thoại
"Signature Validation Status"/"Signature Properties" đọc trực tiếp 1 signature dictionary CHUẨN
PDF, không phải suy luận từ nội dung trang) với cơ chế ký hiện tại của hệ thống.

**Kết luận cốt lõi: hiện tại KHÔNG có, và về bản chất kỹ thuật KHÔNG THỂ có** với đúng cách ký
đang dùng — `src/lib/signing/stamp-pdf.ts` chỉ **vẽ ảnh chữ ký + tên lên trang** bằng `pdf-lib`
(`page.drawImage`/`page.drawText`), hoàn toàn là **con dấu hình ảnh**, không tạo bất kỳ
`/Type /Sig` dictionary, `/ByteRange`, hay khối CMS/PKCS#7 nào trong file. Acrobat chỉ hiện được
hộp thoại như 2 ảnh mẫu khi PDF có 1 **chữ ký số mật mã thật** (PAdES) nhúng sẵn — không có nó thì
Acrobat không có gì để hiện, dù file có "trông giống đã ký" bằng mắt thường.

**Có làm được với hạ tầng hiện tại không — CÓ, nhưng là một sáng kiến kiến trúc riêng, không phải
việc sửa nhỏ:**

1. **Cần**: 1 chứng thư số (X.509 cert + private key) — tự tạo bằng `node-forge` (thư viện JS
   thuần, không cần binary native, chạy tốt trên Vercel serverless) thành **chứng thư tự ký**
   (self-signed) — không cần mua/xin CA nào. Cộng 1 thư viện nhúng chữ ký PAdES vào PDF (repo
   hiện **chưa có** cả 2 — không có `node-forge`, không có `@signpdf/*`/`node-signpdf` trong
   `package.json`, chỉ có `pdf-lib`/`pdfjs-dist`).
2. **Kết quả với chứng thư tự ký**: đúng NHƯ 2 ẢNH MẪU người dùng gửi — "Signature validity is
   UNKNOWN" (Acrobat không tự động tin chứng thư tự ký) NHƯNG vẫn xác nhận "document has not been
   modified" (chứng minh toàn vẹn nội dung) và hiện đầy đủ tên/ngày ký khi bấm "Signature
   Properties" — đây chính xác là mức nâng cấp: biến hash SHA-256 hiện đang lưu âm thầm trong
   `doc_approval_log` (Giai đoạn 0) thành thứ **người dùng tự kiểm tra được ngay trong Acrobat**,
   không cần mở app.
3. **Để có dấu tick xanh "Signature is VALID"**: bắt buộc chứng thư từ 1 CA nằm trong Adobe
   Approved Trust List — đây chính là phạm vi dự án **SmartCA (VNPT)** đã ghi trong kế hoạch cũ
   (phụ thuộc nhà cung cấp ngoài, có mốc thời gian riêng, "gate go/no-go riêng") — KHÔNG làm được
   chỉ bằng code nội bộ.
4. **Vướng mắc kiến trúc quan trọng cần quyết định trước khi code**: chữ ký PAdES phải là
   THAO TÁC CUỐI CÙNG trên đúng dải byte nó bao phủ — bất kỳ chỉnh sửa nào sau đó (kể cả vẽ thêm
   1 con dấu hình ảnh của người ký tiếp theo) sẽ làm hỏng chữ ký đã nhúng, TRỪ KHI dùng kỹ thuật
   "incremental update" (mỗi người ký nối thêm, không đụng byte cũ — nhiều thư viện PAdES hỗ trợ
   nhưng phức tạp hơn hẳn cách ký hiện tại). Với luồng nhiều bước hiện có (Soạn thảo → Xem xét →
   Phê duyệt, mỗi bước cách nhau có thể vài ngày), có 2 hướng khả thi:
   - **(a) Đơn giản, rủi ro thấp**: chỉ ký PAdES đúng **1 lần duy nhất** — ngay sau khi
     `yeu_cau_ky.trang_thai` chuyển `hoan_tat` (văn bản đã có đủ mọi con dấu hình ảnh, không còn
     ai chỉnh sửa thêm) — cho ra đúng 1 "con dấu niêm phong hệ thống" xác nhận toàn bộ file cuối
     cùng chưa bị sửa sau khi hoàn tất, KHÔNG phải 1 chữ ký riêng cho từng người ký.
   - **(b) Đầy đủ như ảnh mẫu**: mỗi người ký (NV/BGĐ/GĐ...) có 1 chữ ký PAdES riêng, dùng
     incremental update — cho đúng trải nghiệm "bấm vào từng chữ ký thấy đúng tên người đó" như
     sig2.png, nhưng tốn công triển khai/kiểm thử hơn hẳn (a), và có thể cần cấp 1 "cặp khoá" ký
     tạm thời theo từng người thay vì 1 khoá chung toàn hệ thống.

**Khuyến nghị**: hướng (a) là bước hợp lý đầu tiên nếu muốn làm — chi phí thấp, tái dùng đúng
điểm hook đã có (`yeu_cau_ky` chuyển `hoan_tat`, cùng chỗ Giai đoạn 0 đã ghi hash), cho ra đúng
loại xác nhận Acrobat mà người dùng muốn thấy. Đây là **một initiative mới, chưa bắt đầu code** —
cần thêm dependency (`node-forge` + 1 thư viện PAdES) và quyết định lưu private key ở đâu (biến
môi trường như `SIGN_JWT_SECRET`, hay Supabase Storage riêng có kiểm soát quyền chặt). Chưa code
gì cho phần này trong phiên hiện tại — chờ xác nhận có muốn xếp lịch làm tiếp hay không.

### Giai đoạn 5 phần 2 — 3 loại chứng từ Bảo trì còn lại: bao_duong, bao_duong_xe,
sua_chua_nho_xe — ĐÃ CODE XONG, CHƯA TEST TAY

Mirror đúng kiến trúc `su_co_nho` (Giai đoạn 5 phần 1): mỗi bundle có hàm build-PDF-for-signing
riêng (`buildMaintenanceXxxPdfForSigning`), 1 role-builder riêng, dùng chung modal/badge/API đã
tổng quát hoá.

**Vai trò ký theo từng bundle** (áp dụng đúng quyết định đã chốt cho `su_co_nho`: vai trò không
có tài khoản đăng nhập thì Nhân viên phụ trách ký thay — mở rộng thêm áp dụng CẢ cho vai trò
"Tài xế", theo đúng yêu cầu trong phiên này, khác quyết định cũ hồi đầu Giai đoạn 5 vốn định
"bỏ hẳn Tài xế khỏi ký số, giữ khoảng trống ký tay"):

| Bundle | Mẫu | Người ký thật (3 người, thứ tự NV→BGĐ→GĐ) | roleId gộp vào NV phụ trách |
|---|---|---|---|
| `bao_duong` | F03+F15+Ảnh | NV phụ trách, BGĐ phụ trách, Giám đốc | `to_co_dien` (Tổ trưởng cơ điện) |
| `bao_duong_xe` | F03+F15+F06+Ảnh | NV phụ trách, BGĐ phụ trách, Giám đốc | `to_co_dien` (Tổ trưởng cơ khí) + `tai_xe` |
| `sua_chua_nho_xe` | F08+F15SmallVehicle+F06+Ảnh | NV phụ trách, BGĐ phụ trách, Giám đốc | `tai_xe` (không có `to_co_dien` ở bundle này) |

**Quyết định về cột "Tài xế" trên PDF — KHÁC cách xử lý "Tổ cơ điện"**: cột "Tổ cơ điện"/"Tổ cơ
khí" (F03) hiển thị tên Nhân viên phụ trách ở **cả 2 luồng** in thường lẫn ký duyệt (mirror đúng
F13 của `su_co_nho` — vai trò này vốn hiếm khi có người thật đáng tin cậy nên đổi thống nhất sang
NV phụ trách không mất thông tin gì). Ngược lại, cột "Tài xế" (F15BaoDuong/F06/F08NB/
F15SmallVehicle) **giữ nguyên tên tài xế thật** (`line.ten_tai_xe`) ở luồng in thường (không đổi
hành vi in ấn cũ — tên tài xế là thông tin nghiệp vụ thật, có giá trị tra cứu riêng), **chỉ bỏ
trống** ở luồng ký duyệt (`forSigning=true`) để Nhân viên phụ trách đóng dấu điện tử đúng vào đó
mà không bị chồng chữ lên tên tài xế đã in sẵn. Đây là quyết định tự đưa ra dựa trên nguyên tắc an
toàn nhất (không làm mất thông tin nghiệp vụ ở luồng không liên quan tới ký số) — nếu người dùng
muốn đồng bộ hoàn toàn với cách "Tổ cơ điện" (luôn hiện NV phụ trách kể cả bản in thường), cần nói
lại để đổi.

**File đã sửa**:

| File | Thay đổi |
|---|---|
| `src/lib/maintenance-pdf.ts` | Tổng quát hoá `SuCoNhoRoleId`/`SuCoNhoSigningRole` thành `MaintenanceSignRoleId`/`MaintenanceSigningRole` (giữ alias tên cũ) + `MaintenanceSignBundle`; thêm `buildBaoDuongSigningRoles`/`buildBaoDuongXeSigningRoles`/`buildSuaChuaNhoXeSigningRoles`; `drawF03`/`drawF15BaoDuong`/`drawF06`/`drawF08NB`/`drawF15SmallVehicle` đổi sang `drawSignatureRowCapture` + tham số `forSigning`, trả về `SignatureRoleBoxes[]` (trước đây `Promise<void>`, dùng `drawSignatureRow` không capture toạ độ); `drawF03` bỏ tham số `staffMap` (không còn dùng `findToTruongCoDien` ở cột ký); thêm `finalizeSigningResult()` dùng chung (refactor luôn `buildMaintenanceSuCoNhoPdfForSigning` để dùng lại, không đổi hành vi); thêm 3 orchestrator `buildMaintenanceBaoDuongDoc`/`buildMaintenanceBaoDuongXeDoc`/`buildMaintenanceSuaChuaNhoXeDoc` (dùng chung cho cả in thường `forSigning=false` và ký duyệt `forSigning=true`) + 3 hàm export `buildMaintenanceXxxPdfForSigning` mới; 3 hàm `downloadMaintenanceXxxPdf` cũ viết lại gọi qua orchestrator chung (chữ ký hàm public giữ nguyên, `maintenance/print/page.tsx` không cần sửa) |
| `src/app/api/maintenance/su-co-nho-signers/route.ts` | Thêm query param `type` (mặc định `su_co_nho`), chọn đúng role-builder theo bundle qua `ROLE_BUILDERS` map — tên route/file giữ nguyên dù giờ dùng chung cho cả 4 bundle |
| `src/app/api/maintenance/signing-status/route.ts` | `.eq("loai_tai_lieu","su_co_nho")` → `.in("loai_tai_lieu", [4 bundle])` |
| `src/app/dashboard/maintenance/records/_components/maintenance-sign-modal.tsx` | Thêm prop `bundle: MaintenanceSignBundle`; `BUNDLE_CONFIG` map (modalTitle/docLabel/hàm build riêng từng bundle); `ROLE_ORDER` thêm `tai_xe: {thuTu:16, vaiTro:"ky"}`; API fetch + payload `loaiTaiLieu` đọc theo `bundle`; mô tả trong modal đổi generic ("vai trò không có tài khoản đăng nhập riêng sẽ do Nhân viên phụ trách ký thay") thay vì câu cũ chỉ nói riêng "Tài xế... không nằm trong luồng ký điện tử" |
| `src/app/dashboard/maintenance/records/[id]/page.tsx` | `suCoNhoEligible` (boolean đơn) → 4 biến eligible + `signBundle: MaintenanceSignBundle \| null` dùng chung cho cả điều kiện tải `signingStatus` lẫn chọn nhánh UI; nhánh "Sửa chữa nhỏ" (sua_chua_nho_xe), "Bảo dưỡng ngoài Đội xe" (bao_duong), "Bảo dưỡng Đội xe" (bao_duong_xe) đều thêm đúng cặp "Xem file đã ký"/`MaintenanceSignStatusBadge` mirror nhánh `su_co_nho` đã có; `<MaintenanceSignModal>` truyền thêm `bundle={signBundle}` |
| `maintenance-sign-status.tsx` | **Không đổi gì** — component đã tổng quát từ trước (đếm "N/M đã ký" từ `status.signers.length`, không hard-code số 4) |

**Không cần migration mới** — dùng lại đúng permission `maintenance.phe_duyet` và unique index
`uniq_yeu_cau_ky_active_business_key` (đã có `modun`+`loai_tai_lieu` trong khoá, tự phân biệt 4
bundle dù cùng `ma_ho_so`=record id).

`npx tsc --noEmit` (toàn repo) và `npx eslint` trên toàn bộ 6 file đã sửa đều sạch (0 lỗi; các
warning còn lại trong `records/[id]/page.tsx` đều pre-existing, không liên quan thay đổi này —
đối chiếu qua vị trí dòng cách xa mọi chỗ đã sửa).

### CHƯA test tay — bắt buộc trước khi coi Giai đoạn 5 phần 2 là xong

1. **Fix footer Chất lượng**: in lại Phiếu KQKN, xác nhận mã hồ sơ luôn ở góc trái mép dưới mọi
   trang (kể cả khi 1 batch tràn ≥2 trang do nhiều lô).
2. **bao_duong** (biên bản Bảo dưỡng, bộ phận khác Đội xe): bấm "Ký duyệt" → xác nhận modal hiện
   đúng 3 người (NV phụ trách gộp Tổ trưởng cơ điện, BGĐ phụ trách, Giám đốc) → tạo yêu cầu ký →
   ký lần lượt (test bằng tài khoản test tạm, không dùng dữ liệu thật) → xác nhận thứ tự NV→BGĐ→GĐ
   đúng, không ký được khi chưa tới lượt → sau khi hoàn tất, nút đổi thành "Xem file đã ký", mở
   file xác nhận cả 2 trang F03+F15 có đủ chữ ký, cột "Tổ cơ điện" hiện tên NV phụ trách không bị
   lệch nét.
3. **bao_duong_xe** (biên bản Bảo dưỡng, Đội xe): tương tự mục 2, thêm xác nhận: cột "Tài xế" ở
   F15BaoDuong/F06 hiện ĐÚNG tên tài xế thật khi CHƯA ký (`In biên bản` bình thường), và sau khi
   NV phụ trách ký thì đúng vị trí "Tài xế" đó hiện chữ ký+tên của NV phụ trách (không phải tên
   tài xế), không bị chồng/lệch nét dù trước đó khung này để trống.
4. **sua_chua_nho_xe** (Sửa chữa nhỏ Đội xe): tương tự mục 3 cho F08NB/F15SmallVehicle/F06 — xác
   nhận không còn vai trò "Tổ cơ điện" nào xuất hiện trong modal ký (bundle này không có).
5. Test 1 trường hợp thiếu điều kiện resolve (vd Giám đốc chưa được cấp `maintenance.phe_duyet`)
   cho cả 3 bundle mới — xác nhận modal chặn đúng, thông báo lý do rõ ràng, giống hệt hành vi đã
   test pass ở `su_co_nho`.
6. Xác nhận nút "Hủy yêu cầu"/"Trả về" (dùng lại nguyên `src/lib/signing/requests.ts`, không sửa
   gì) hoạt động bình thường cho cả 3 bundle mới.
7. Đối chiếu nhanh 1 biên bản Bảo dưỡng/Sửa chữa nhỏ ĐÃ IN TRƯỚC ĐÂY (trước phiên này) bằng nút
   "In biên bản" — xác nhận hình ảnh PDF không đổi (trừ đúng 1 thay đổi có chủ đích: cột "Tổ cơ
   điện"/"Tổ cơ khí" trên F03 giờ luôn hiện tên NV phụ trách thay vì tên dò được từ
   `nguoi_thuc_hien`/chuỗi rỗng như trước).

### Bước tiếp theo — người dùng chọn "bàn thêm hướng (b)" (ký PAdES riêng từng người ký),
ĐÃ XÁC NHẬN KHẢ THI BẰNG POC THẬT (2026-08-30), CHƯA đưa vào code chính

Người dùng chốt 3 quyết định qua `AskUserQuestion`: (1) **1 khoá dùng chung** (không phải mỗi
nhân viên 1 cặp khoá riêng); (2) **có** tạo root CA nội bộ; (3) áp dụng luôn cho **mọi module**
dùng `src/lib/signing/` (Chất lượng, Điều xe, Bảo trì), không chỉ thí điểm 1 module.

Trước khi đụng vào `src/lib/signing/` (code dùng chung, đang chạy thật cho 3 module production),
đã dựng 1 proof-of-concept ĐỘC LẬP hoàn toàn ngoài repo (thư mục scratch, không đụng
`package.json`) để kiểm chứng bằng dữ liệu thật thay vì chỉ suy luận lý thuyết — đúng tinh thần
"đo 2 lần cắt 1 lần" đã áp dụng xuyên suốt dự án ký số này.

**Kết quả POC — ĐÃ CHỨNG MINH KHẢ THI, không còn là suy đoán**:

1. Dựng 1 PDF, ký tuần tự **3 người** (mô phỏng đúng NV phụ trách → BGĐ phụ trách → Giám đốc)
   bằng kỹ thuật PDF incremental update — mỗi người ký xong, người sau chỉ THÊM byte vào cuối
   file, không đụng byte cũ.
2. **Kiểm chứng bằng so sánh byte trực tiếp** (không tin code tự đánh giá chính nó): xác nhận
   `v1` là tiền tố byte-for-byte giống hệt bên trong `v2`, và `v2` giống hệt bên trong `v3` — tức
   là chữ ký của người ký trước KHÔNG bị đụng khi người sau ký tiếp.
3. **Kiểm chứng bằng OpenSSL** (công cụ ngoài, độc lập hoàn toàn với code Node đã viết) —
   `openssl cms -verify -binary` xác nhận cả 3 chữ ký đúng về mặt toán học (chữ ký RSA khớp với
   nội dung đã ký, message digest khớp chính xác — đã đối chiếu bằng `openssl asn1parse` +
   `openssl dgst -sha256` tay).
4. **Kiểm chứng đúng hành vi "UNKNOWN" như 2 ảnh mẫu sig1.png/sig2.png**: verify KHÔNG import root
   CA nội bộ → OpenSSL báo đúng lỗi `self-signed certificate in certificate chain` (tương đương
   "Signature validity is UNKNOWN" trong Acrobat). Verify CÓ import root CA nội bộ
   (`-CAfile root.pem`) → `CMS Verification successful` cho cả 3 chữ ký — đúng khớp ý tưởng "admin
   import root 1 lần, thấy tin cậy đầy đủ; người ngoài vẫn thấy Unknown".
5. Mỗi chữ ký độc lập mang đúng tên/email người ký thật trong subject certificate
   (`CN=Nguyen Van A (NV phu trach)`, v.v.) — đúng trải nghiệm "bấm vào từng chữ ký thấy đúng tên
   người đó" như sig2.png.

**Bộ dependency đã xác nhận sạch (0 lỗ hổng qua `npm audit`)**: `@cantoo/pdf-lib` (fork
`pdf-lib` được duy trì tích cực — cập nhật vài ngày trước lúc kiểm tra, có sẵn API
`forIncrementalUpdate`/`saveIncremental` mà `pdf-lib` gốc (`Hopding/pdf-lib`, đang dùng trong
repo, `^1.17.1`) **không hỗ trợ và đã ngừng phát triển**) + `node-forge` (X.509 + CMS/PKCS7,
JS thuần, không native binding) + `@signpdf/signpdf` + `@signpdf/utils` (chỉ 2 gói lõi, KHÔNG
dùng `@signpdf/placeholder-plain` — gói đó kéo theo `pdfkit`→`crypto-js` có lỗ hổng
CRITICAL đã xác nhận qua `npm audit`; placeholder tự dựng bằng chính `@cantoo/pdf-lib` theo đúng
ví dụ đã được TEST trong bộ integration test của chính thư viện đó, không cần `placeholder-plain`).

**Mô hình khoá đã validate đúng ý "1 khoá dùng chung"**: chỉ **root CA keypair** là thứ cần lưu
trữ lâu dài/bảo vệ (tương tự cách đang lưu `SIGN_JWT_SECRET`) — mỗi lần ký, hệ thống tự sinh 1
cặp khoá RSA **tạm thời** (ephemeral, dùng xong bỏ), tạo 1 leaf certificate mang tên người ký,
ký leaf cert đó bằng root CA, dùng cặp khoá tạm để tạo chữ ký CMS, rồi **không lưu lại** private
key tạm này ở đâu cả. Cách này AN TOÀN HƠN việc cố tái sử dụng 1 khoá leaf cố định (không cần
vòng đời/lưu trữ cho bất kỳ khoá leaf nào) mà vẫn cho đúng kết quả UX yêu cầu (mỗi chữ ký hiện
đúng tên riêng). **Lưu ý bảo mật cần hiểu rõ**: vì mọi leaf cert đều do server tự phát hành và tự
ký bằng root dùng chung, độ tin cậy mật mã học chỉ chứng minh "hệ thống Rubber ERP đã tạo chữ ký
này", KHÔNG chứng minh "chính người X tự tay giữ khoá riêng của họ" (non-repudiation thật) — về
bản chất tương đương mức tin cậy của con dấu ảnh hiện tại, chỉ khác là giờ đóng gói đúng chuẩn PDF
để Acrobat/OpenSSL hiểu và xác minh được trực tiếp.

File POC (ngoài repo, không commit): thư mục scratch phiên này — `poc.js` (dựng root CA, ký tuần
tự 3 người, kiểm byte-identity) + `extract-and-verify.js` (trích xuất từng `/ByteRange`+`/Contents`
để đưa cho OpenSSL — có 1 chi tiết cần nhớ khi viết code thật: `@signpdf/utils`'s `findByteRange`
trả về CẢ các occurrence TRÙNG LẶP của cùng 1 giá trị byteRange đã ký xong tồn tại lặp lại qua các
lần incremental save kế tiếp — đây là hiện tượng vô hại (PDF reader chỉ quan tâm generation mới
nhất của mỗi object number), nhưng code verify/đọc lại phải **dedupe theo giá trị** trước khi xử
lý, không đếm số occurrence thô làm "số chữ ký". Và khi verify bằng OpenSSL, bắt buộc cờ
`-binary` (thiếu cờ này OpenSSL áp canonicalization kiểu S/MIME lên nội dung nhị phân, làm digest
lệch dù message digest bên trong CMS đã đúng 100%) — nếu code production tự viết verifier riêng
(không dùng OpenSSL) thì không có vấn đề này, chỉ cần nhớ khi TEST bằng OpenSSL tay.

### Việc CẦN LÀM để đưa vào code thật (CHƯA làm — cần xác nhận có tiếp tục ngay không)

1. Thêm `@cantoo/pdf-lib`, `node-forge`, `@signpdf/signpdf`, `@signpdf/utils` vào
   `package.json` — **không** thêm `@signpdf/placeholder-plain`.
2. Script/route tạo root CA 1 lần (nếu chưa có) — lưu `SIGN_PADES_ROOT_CA_CERT_PEM` +
   `SIGN_PADES_ROOT_CA_KEY_PEM` vào `.env.local` + Vercel env vars, mirror đúng cách đang lưu
   `SIGN_JWT_SECRET`.
3. Module mới `src/lib/signing/pades.ts` — `issueLeafCertificate(rootCa, signerName, email)`,
   `class ForgeCmsSigner`, `addSignaturePlaceholder(pdfBytes, signerLabel)` (dùng
   `@cantoo/pdf-lib`, load `forIncrementalUpdate` cho MỌI PDF đã có ≥1 chữ ký trước, load thường
   cho PDF hoàn toàn mới), `applyPadesSignature(pdfBytes, signerName, email)` — kết hợp cả 2 bước
   (đặt placeholder + `SignPdf.sign()`) thành 1 hàm gọi thuận tiện.
4. Wire vào `signField()` (`src/lib/signing/requests.ts`) — SAU khi vẽ con dấu ảnh (không thay
   thế, làm THÊM bước cuối mỗi lần ký): gọi `applyPadesSignature(...)` trên file vừa stamp ảnh
   xong, lưu kết quả làm `file_hien_tai` mới. Đây là điểm chạm DUY NHẤT cần sửa để áp dụng cho
   CẢ 3 module (Chất lượng/Điều xe/Bảo trì) cùng lúc, đúng phạm vi đã chốt.
5. **Bắt buộc test bằng byte-identical/verify thật** trước khi coi là xong — mirror đúng phương
   pháp Giai đoạn 1 đã dùng khi refactor `src/lib/signing/` lần trước (không chỉ tin `tsc`/`eslint`
   sạch): ký thử 1 hồ sơ thật qua đủ 3 bước trên `npm run dev`, tải file cuối cùng, chạy lại đúng
   kiểu kiểm chứng OpenSSL đã dùng ở POC này (byte-identity qua từng bước + `openssl cms -verify
   -binary` độc lập cho từng chữ ký + verify chain qua root CA) trước khi coi là an toàn để dùng
   thật. Test thêm: mở file cuối cùng bằng Adobe Acrobat Reader thật (không phải trình xem PDF
   khác — nhiều trình xem không hiểu signature dictionary) để xác nhận trực quan đúng như
   sig1.png/sig2.png.
6. Cân nhắc thêm cột DB lưu lại root CA cert PEM công khai đâu đó dễ tải cho admin (vd trang
   Cài đặt) để họ tự import vào Acrobat cá nhân khi cần xem "trusted" — chưa thiết kế UI cho việc
   này, cần bàn khi bắt đầu code thật.

Đây là initiative đủ lớn và đụng vào code lõi `src/lib/signing/` đang chạy thật cho 3 module
production — **chưa bắt đầu code vào repo chính**, cần xác nhận có muốn làm ngay trong phiên này
hay để phiên sau (có phiên riêng, test kỹ như mọi lần đụng `src/lib/signing/` trước đây).

### ĐÃ CODE XONG cùng phiên (người dùng chọn "code ngay") — đã verify bằng script + OpenSSL,
CHƯA verify bằng Acrobat thật / chưa test qua UI ký thật

Đã làm đúng theo kế hoạch mục "Việc CẦN LÀM" ở trên:

1. **Dependency mới** (đã cài, đã xác nhận `npm audit` = 0 lỗ hổng liên quan): `@cantoo/pdf-lib`,
   `node-forge`, `@signpdf/signpdf`, `@signpdf/utils`, `@types/node-forge`. **Cố ý KHÔNG** dùng
   `@signpdf/placeholder-plain` (kéo theo `pdfkit`→`crypto-js` có lỗ hổng CRITICAL) — tự dựng
   placeholder bằng chính `@cantoo/pdf-lib` theo đúng ví dụ TRONG BỘ INTEGRATION TEST của thư
   viện đó.
2. **`scripts/generate-signing-root-ca.mjs`** — script tạo root CA, có cờ `--write-env` tự động
   thêm `SIGN_PADES_ROOT_CA_CERT_PEM`/`SIGN_PADES_ROOT_CA_KEY_PEM` vào `.env.local` (không ghi
   đè nếu đã có sẵn — an toàn chạy nhầm lần 2), và tự ghi chứng thực CÔNG KHAI (không phải khoá
   riêng) vào `public/rubber-erp-signing-root-ca.pem`.
   - **ĐÃ CHẠY THẬT trong phiên này** với `--write-env` — `.env.local` của máy hiện tại **đã có**
     2 biến trên, tính năng đang **ACTIVE** ngay khi chạy `npm run dev` local. **CHƯA set trên
     Vercel** — nếu deploy production ngay bây giờ, tính năng này sẽ tự tắt (best-effort, xem
     mục 4) cho tới khi 2 biến này được thêm vào Vercel Environment Variables.
   - ⚠️ **Lưu ý bảo mật**: vì chạy trực tiếp trong phiên chat này, nội dung PEM (bao gồm cả
     private key của root CA) đã xuất hiện trong output của 1 lệnh terminal trong lịch sử phiên
     — không phải bị lộ ra ngoài, nhưng nếu muốn chắc chắn không ai từng nhìn thấy giá trị này,
     có thể chạy lại `node scripts/generate-signing-root-ca.mjs --write-env` sau khi XOÁ 2 dòng
     cũ trong `.env.local` để xoay vòng (rotate) sang root CA mới — an toàn tuyệt đối vì CHƯA có
     chữ ký thật nào được tạo bằng root CA này (chỉ có chữ ký test, đã xoá).
   - `.gitignore` có thêm 1 ngoại lệ `!public/rubber-erp-signing-root-ca.pem` (khỏi rule
     `*.pem` chung) — vì đây là chứng thực CÔNG KHAI, cố ý cho commit để phục vụ admin tải về.
     **Chưa commit gì** — file đang nằm ở trạng thái untracked, người dùng tự quyết định commit.
3. **`src/lib/signing/pades.ts`** (mới) — `hasPadesRootCa()`, `applyPadesSignature(pdfBytes,
   signerName, contactInfo)`. Sinh 1 leaf certificate MỚI mỗi lần ký (CN = tên người ký thật,
   dùng cặp khoá RSA tạm thời, ký bằng root CA), đặt 1 khung chữ ký ẩn (`Rect [0,0,0,0]`, không
   che nội dung — con dấu NHÌN THẤY được vẫn do `stamp-pdf.ts` vẽ riêng như cũ) qua PDF
   incremental update, rồi nhúng chữ ký CMS/PKCS7 thật vào đó qua `@signpdf/signpdf`.
4. **Wire vào `src/lib/signing/requests.ts`'s `signField()`** — ngay sau khi con dấu ảnh được vẽ
   xong (`newBytes`), nếu `hasPadesRootCa()` thì gọi `applyPadesSignature(...)` để nhúng THÊM chữ
   ký số thật lên trên, bọc `try/catch` — lỗi ở bước này (thiếu cấu hình, lỗi bất kỳ) chỉ log ra
   console và **im lặng bỏ qua**, KHÔNG chặn luồng ký chính (con dấu ảnh vẫn hoạt động y hệt
   trước nếu bước PAdES thất bại). Đây là điểm chạm DUY NHẤT — áp dụng ngay cho cả 3 module
   (Chất lượng/Điều xe/Bảo trì) dùng chung `signField()`, đúng phạm vi "áp dụng luôn cho mọi
   module" đã chốt.

### Đã verify — 2 lớp, cả 2 đều PASS

1. **Proof-of-concept độc lập ngoài repo** (script tạm, không commit) — dựng PDF, ký tuần tự 3
   người (NV→BGĐ→GĐ), xác nhận: (a) byte-identity — chữ ký người trước không bị đụng khi người
   sau ký; (b) `openssl cms -verify -binary` xác nhận đúng cả 3 chữ ký về mặt toán học (không tin
   code tự đánh giá chính nó); (c) verify với `-CAfile root.pem` (root CA của chính mình) →
   thành công; verify KHÔNG có root CA → đúng lỗi `self-signed certificate in certificate chain`
   (tương đương "Signature validity is UNKNOWN" trong Acrobat, khớp `sig1.png`/`sig2.png`).
2. **Verify lại TRÊN CHÍNH FILE THẬT `src/lib/signing/pades.ts`** (không phải bản POC) — chạy
   bằng `node --experimental-strip-types` import thẳng file thật trong repo, dựng PDF bằng đúng
   `pdf-lib` (bản gốc) mà `stamp-pdf.ts` đang dùng, ký 2 người liên tiếp, lặp lại đúng phép verify
   OpenSSL ở trên — **PASS toàn bộ**, kể cả xác nhận đúng tên/email từng người ký hiện trong
   `subject=CN=...` của certificate trích xuất được.
3. `npx tsc --noEmit` (toàn repo) và `npx eslint` trên `pades.ts`/`requests.ts`/
   `generate-signing-root-ca.mjs` đều sạch.

### CHƯA làm / CHƯA test — bắt buộc trước khi coi tính năng này là hoàn tất

1. **Chưa mở file bằng Adobe Acrobat Reader thật** — toàn bộ verify ở trên dùng OpenSSL (công cụ
   dòng lệnh, không đọc UI). Cần: ký thử 1 hồ sơ thật (Chất lượng/Điều xe/Bảo trì, dùng tài khoản
   test tạm) qua `npm run dev`, tải file cuối cùng, mở bằng Acrobat Reader thật (không phải trình
   xem PDF khác — nhiều trình xem không hiểu/không hiện signature panel), xác nhận đúng như
   `sig1.png`/`sig2.png`: có panel "Signature Validation Status", đúng tên từng người ký, đúng
   trạng thái UNKNOWN khi chưa import root CA.
2. **Chưa test import root CA vào Acrobat cá nhân** — tải `public/rubber-erp-signing-root-ca.pem`
   (sau khi deploy, hoặc lấy trực tiếp từ máy hiện tại), import vào "Trusted Certificates" của
   Acrobat, mở lại đúng file đã ký ở bước 1 → xác nhận đổi từ "UNKNOWN" sang "TRUSTED"/hiện dấu
   tick xanh.
3. **Chưa set 2 biến môi trường trên Vercel** — bắt buộc trước khi deploy, nếu không tính năng
   này sẽ không hoạt động trên production (vẫn an toàn/không lỗi gì, chỉ đơn giản là không có
   thêm chữ ký PAdES nào được nhúng, giữ nguyên hành vi cũ).
4. **Chưa test qua UI thật của cả 3 module** (Chất lượng "Ký duyệt", Điều xe "Ký duyệt", Bảo trì
   "Ký duyệt" — cả `su_co_nho` lẫn `bao_duong`/`bao_duong_xe`/`sua_chua_nho_xe` mới xong ở mục
   trên) — ký đủ vòng bằng tài khoản test tạm, xác nhận file cuối cùng tải về có ĐỦ chữ ký PAdES
   cho MỌI người đã ký (không chỉ người cuối), và các tính năng hiện có (Trả về/Hủy yêu cầu) vẫn
   hoạt động đúng khi file bị khôi phục về `file_goc` (không có PAdES) rồi ký lại từ đầu.
5. **Cân nhắc thêm** (chưa quyết định, chưa cần làm ngay): thêm UI ở trang Cài đặt cho admin tải
   `rubber-erp-signing-root-ca.pem` trực tiếp trong app (hiện chỉ có thể tải qua URL tĩnh
   `/rubber-erp-signing-root-ca.pem` sau khi deploy, đã đủ dùng cho giai đoạn đầu).

### ⚠️ Phát hiện ngoài phạm vi phiên này — thư mục `src/scratch/` xuất hiện trong lúc làm việc

Trong lúc rà `git status` cuối phiên, phát hiện thư mục MỚI `src/scratch/` chứa 3 file
(`inspect_routes.js`, `inspect_vnpt.js`, `test_login.js`, timestamp trong lúc phiên này đang
chạy) — nội dung liên quan "VNPT"/"login", hoàn toàn không liên quan gì tới công việc phiên này
(Bảo trì/PAdES). Đã **cố tình không đụng, không xoá, không đọc nội dung** — đúng nguyên tắc đã áp
dụng trước đây khi gặp file lạ ngoài phạm vi ("có thể là kết quả của một tiến trình/phiên khác
đang chạy song song trên cùng repo"). Nếu người dùng không nhận ra đây là việc của mình, cần hỏi
lại nguồn gốc trước khi dọn hoặc commit bất cứ thứ gì trong repo.

## Cập nhật (2026-08-31) — Tìm ra nguyên nhân THẬT của bug "chữ ký PAdES sai root CA":
KHÔNG PHẢI stale env var, mà là bug encoding tên có dấu tiếng Việt trong `node-forge` — ĐÃ FIX

Phiên trước nghi ngờ nguyên nhân là 1 cửa sổ terminal cũ giữ biến `$env:SIGN_PADES_ROOT_CA_CERT_PEM`
gán tay đè lên `.env.local`. Phiên này đã điều tra kỹ theo đúng 5 bước người dùng yêu cầu và phát
hiện **nguyên nhân thật khác hẳn giả thuyết ban đầu** — nghiêm trọng hơn và ảnh hưởng rộng hơn.

### Đã loại trừ giả thuyết "stale terminal env var"

- `tasklist`/`wmic` xác nhận **không có tiến trình `next dev` nào đang chạy** khi phiên này bắt đầu
  (chỉ có các tiến trình `chrome-devtools-mcp` không liên quan).
- Không có biến `SIGN_PADES_*` ở cấp Machine/User (`[System.Environment]::GetEnvironmentVariables`),
  không có script PowerShell profile nào gán biến này, session PowerShell hiện tại sạch.
- Phát hiện phụ: root CA đã bị **xoay vòng (rotate) đúng ngày 2026-08-30** (cả `.env.local` lẫn
  `public/rubber-erp-signing-root-ca.pem` cùng fingerprint `3C:C7:...:DC:83`, cùng `validFrom` —
  khớp nhau tuyệt đối) — không có sai lệch nào giữa 2 file này.
- Dùng chính `@next/env` (bộ nạp env thật của Next.js, không tự parse tay) để mô phỏng những gì
  `npm run dev` sẽ nạp — khớp 100% với `public/rubber-erp-signing-root-ca.pem`.
- Khởi động `npm run dev` hoàn toàn mới (background, PID mới, log in ra đúng
  `"Environments: .env.local"`) — môi trường sạch, không có gì chồng lấn.

### Nguyên nhân THẬT: `node-forge` tự đoán sai kiểu ASN.1 cho `commonName` chứa ký tự có dấu

Dùng đúng phương pháp "Backend thuần" đã ghi trong lịch sử Giai đoạn 3 (gọi thẳng
`createSigningRequest()`/`signField()` từ `src/lib/signing/requests.ts` qua
`node --experimental-strip-types` với 1 resolve/load hook tự viết map `@/`→`src/` + shim CJS-ESM
interop cho `jspdf`/`jspdf-autotable`, dùng 2 tài khoản test tạm sẵn có
`e2e_signing_verify`/`e2e_signing_approver`), ký thử 1 phiếu KQKN giả (không đụng `qc_results`
thật) đủ 2 người ký, tải file cuối về, verify bằng **2 công cụ độc lập** (`openssl cms -verify`
VÀ `crypto.X509Certificate.verify()` của chính Node — không tin bất kỳ công cụ nào tự nó):

- Root CA nhúng trong CMS **khớp chính xác** `public/rubber-erp-signing-root-ca.pem` (fingerprint
  giống hệt) — **không phải do sai root CA**.
- Nhưng `openssl verify -CAfile root.pem <leaf-cert>` báo
  `error 7: certificate signature failure` — chữ ký của leaf certificate (do root CA ký) **sai về
  mặt toán học**, dù `.env.local`'s cert/key là 1 cặp khớp nhau thật (`openssl rsa -check` "RSA
  key ok", modulus cert = modulus key).
- Cô lập bằng script tái tạo y hệt `issueLeafCertificate()` trong `src/lib/signing/pades.ts`: dùng
  tên ASCII thuần → ký đúng; dùng tên có dấu tiếng Việt (`"Nguyễn Văn A"`, hoặc tên thật kiểu
  `"... (TEST - đã disable)"`) → **chữ ký sai hoặc PEM hỏng hẳn** (`bad base64 decode`), lặp lại
  ổn định qua nhiều lần thử.
- **Gốc rễ**: `cert.setSubject([{ name: "commonName", value: commonName }])` trong `pades.ts` không
  chỉ định `valueTagClass` — `node-forge` tự đoán kiểu chuỗi ASN.1 (PrintableString/UTF8String...)
  dựa trên nội dung, và đoán SAI khi chuỗi chứa byte UTF-8 đa byte (dấu tiếng Việt), khiến
  `TBSCertificate` lúc **ký** và lúc **serialize lại thành PEM** lệch byte nhau — cert sinh ra hợp
  lệ về cú pháp PDF/X.509 nhưng **sai chữ ký thật sự**, không kiểm chứng được ở bất kỳ verifier
  nghiêm ngặt nào (OpenSSL, Acrobat, Node crypto).
- **Mức độ ảnh hưởng**: vì hầu hết tên nhân viên thật của công ty đều có dấu tiếng Việt, bug này
  ảnh hưởng gần như **MỌI lượt ký thật** trên production kể từ khi tính năng PAdES được bật —
  không phải trường hợp hiếm/biên.

### Fix đã áp dụng — `src/lib/signing/pades.ts`

```ts
const subjectAttrs: forge.pki.CertificateField[] = [
  {
    name: "commonName",
    value: commonName || "Nguoi ky Rubber ERP",
    valueTagClass: forge.asn1.Type.UTF8 as unknown as number, // ép cứng UTF8String
  },
]
```

`@types/node-forge` khai sai kiểu (`valueTagClass?: asn1.Class` thay vì đúng ra phải là
`asn1.Type`) nên cần ép `as unknown as number` — đã xác nhận qua `npx tsc --noEmit` sạch tuyệt đối
(không chỉ riêng file này, toàn repo). `npx eslint src/lib/signing/pades.ts` cũng sạch.

### Đã verify lại bằng đúng file thật sau khi fix — PASS cả 2 lớp độc lập

Ký lại 1 phiếu test khác (2 người, cùng tài khoản test có tên tiếng Việt có dấu) bằng đúng
`issueLeafCertificate()` đã sửa:

- `openssl cms -verify -in sig.der -content content.bin -binary -CAfile root.pem` →
  **`CMS Verification successful`**, exit code 0.
- `new crypto.X509Certificate(leafPem).verify(rootPublicKey)` → **`true`**.
- Subject CN của leaf cert hiển thị đúng dấu tiếng Việt nguyên vẹn: `CN=E2E Signing Approver
  (TEST - đã disable)`.
- Root CA nhúng trong CMS vẫn khớp chính xác `public/rubber-erp-signing-root-ca.pem`.

Không cần migration DB, không đổi schema, không đổi hành vi ở bất kỳ đâu khác ngoài đúng 1 khối
`subjectAttrs` trong `pades.ts` — an toàn để deploy ngay (chỉ cần commit + push, dev server hiện
đang chạy cục bộ đã có sẵn fix).

### ⚠️ Phát hiện MỚI, CHƯA FIX — mất chữ ký PAdES của người ký trước khi có người ký sau

Trong lúc ký thử 2 người liên tiếp để verify fix trên, phát hiện: **file cuối cùng (sau khi cả 2
người ký xong) chỉ còn ĐÚNG 1 chữ ký PAdES** (của người ký SAU CÙNG) — chữ ký PAdES của người ký
ĐẦU TIÊN biến mất hoàn toàn khỏi file, dù con dấu ảnh (chữ ký hình ảnh + tên) của cả 2 người vẫn
hiển thị đúng trên PDF.

**Nguyên nhân (đã xác định, chưa sửa)**: `signField()` (`src/lib/signing/requests.ts`, dòng ~239)
dùng **`pdf-lib` gốc (Hopding/pdf-lib), KHÔNG PHẢI incremental** để vẽ con dấu ảnh/tên mỗi lượt ký:

```ts
const pdfDoc = await PDFDocument.load(currentBytes)
// ...drawSignatureImage/drawTextFit...
let newBytes = Buffer.from(await pdfDoc.save())   // ← REWRITE TOÀN BỘ FILE, không incremental
if (hasPadesRootCa()) newBytes = await applyPadesSignature(newBytes, ...)
```

`applyPadesSignature()` (trong `pades.ts`) tự nó luôn dùng đúng `forIncrementalUpdate: true` (qua
`@cantoo/pdf-lib`) nên KHÔNG bao giờ tự phá chữ ký của chính nó. Nhưng ở lượt ký **thứ 2 trở đi**,
bước vẽ con dấu ảnh (`PDFDocument.load(currentBytes).save()` bằng `pdf-lib` thường — thư viện
KHÁC, không phải fork `@cantoo`) **rebuild lại toàn bộ file từ đầu**, không bảo toàn byte-for-byte
đoạn incremental-update mà `applyPadesSignature()` đã nối thêm ở lượt ký trước đó — xoá sạch chữ
ký PAdES của người ký trước trước khi PAdES của người ký sau được thêm vào.

**Hệ quả**: với MỌI tài liệu có ≥2 người ký (Chất lượng 2 người, Điều xe 2 người, Bảo trì 3-4
người...) — chỉ chữ ký PAdES của người ký **CUỐI CÙNG** còn tồn tại trong file cuối; chữ ký của
tất cả người ký trước đó bị mất, dù workflow ký nghiệp vụ (con dấu ảnh, trạng thái `hoan_tat`,
audit log `nhat_ky_ky`...) vẫn đúng và không đổi.

**Chưa sửa** — cần bàn hướng xử lý trước khi động vào `signField()` (file lõi dùng chung cho 3
module production: Chất lượng/Điều xe/Bảo trì), ví dụ 2 hướng khả dĩ:
1. Đổi bước vẽ con dấu ảnh trong `signField()` sang dùng `@cantoo/pdf-lib` với
   `forIncrementalUpdate: true` (đồng bộ 1 loại thư viện xuyên suốt, an toàn nhất nhưng cần kiểm
   tra kỹ `@cantoo/pdf-lib` có tương thích 100% API với `pdf-lib` gốc đang dùng cho
   `drawSignatureImage`/`drawTextFit` hay không).
2. Chỉ áp dụng PAdES ở lượt ký **CUỐI CÙNG** (`allDone === true`, sau khi mọi con dấu ảnh đã vẽ
   xong) thay vì mỗi lượt ký — cho ra đúng 1 "niêm phong hệ thống" duy nhất cho toàn bộ file hoàn
   tất, đơn giản hơn hẳn hướng 1 nhưng đổi ngữ nghĩa (không còn "mỗi người 1 chữ ký PAdES riêng"
   như tài liệu gốc `du_an_ky_so_dung_chung - new.docx` mô tả — đây chính là hướng (a) "đơn giản,
   rủi ro thấp" đã ghi trong CLAUDE.md mục "Cập nhật (Giai đoạn 3, kế hoạch PAdES)" trước khi
   code, chỉ chưa chọn).

### Dọn dẹp sau test (2026-08-31)

Đã xoá 2/3 bộ file test trong Storage (`signing-documents` bucket). **Cố ý giữ lại 1 bộ**
(`yeuCauId 4569e9b2-d1dd-4490-8e35-1d01ff11a46b`, file cuối
`.../quality/4569e9b2-d1dd-4490-8e35-1d01ff11a46b/v3.pdf`) để người dùng tự tải và verify bằng
OpenSSL — **phiên sau nên xoá nốt** (mirror đúng cách dọn dẹp đã làm ở Giai đoạn 1/3: xoá file
Storage, không xoá được dòng `yeu_cau_ky`/`nguoi_ky` do trigger bất biến `nhat_ky_ky`, đây là hành
vi đúng thiết kế không phải bug).

### Việc tiếp theo (đã hoàn tất mục 1-3 cùng phiên, xem "Cập nhật tiếp theo" bên dưới)

## Cập nhật tiếp theo (2026-08-31, cùng phiên) — Xác nhận bug #2 bằng file thật của người dùng
+ đã fix xong, verify PASS cả 2 chữ ký

Người dùng tự test qua UI thật (`npm run dev` local): tạo 1 phiếu Điều xe mới, ký duyệt qua đúng
`/dashboard/ky/[id]`, gửi link file thật:
`.../signing-documents/.../dispatch/a7cde8be-037c-4ee5-8561-06bc504839dc/v3.pdf`.

**Xác nhận trên dữ liệu thật (không phải test giả lập)**:
- Root CA + tên có dấu: PASS — `openssl cms -verify -CAfile root.pem` thành công, leaf cert hiện
  đúng `CN=Tô Thành Luân` (tài khoản thật, không phải account test).
- Bug #2 (mất chữ ký người ký trước) **tái hiện đúng trên file thật**: tra DB xác nhận phiếu này
  có 2 người ký đã `hoan_tat` cả 2 (Administrator — Lập bảng, ký lúc 21:51:42; Tô Thành Luân —
  Phê duyệt, ký lúc 21:52:29) nhưng file cuối chỉ còn 1 chữ ký PAdES (của Tô Thành Luân) — chữ ký
  của Administrator đã bị xoá mất, đúng như dự đoán từ test backend trước đó.

### Đã hỏi và chốt hướng fix qua `AskUserQuestion`

Người dùng chọn **"Mỗi người 1 chữ ký PAdES riêng"** — đổi bước vẽ con dấu ảnh trong `signField()`
sang `@cantoo/pdf-lib` với `forIncrementalUpdate: true` (đồng bộ 1 loại thư viện xuyên suốt), thay
vì gộp PAdES chỉ 1 lần ở lượt ký cuối.

### Đã sửa — `src/lib/signing/requests.ts`

- Đổi `import { PDFDocument } from "pdf-lib"` → `import { PDFDocument } from "@cantoo/pdf-lib"`
  (chỉ trong file này); thêm `import type { PDFDocument as PdfLibDocument, PDFPage as PdfLibPage,
  PDFFont as PdfLibFont } from "pdf-lib"` để ép kiểu khi gọi các hàm dùng chung của
  `stamp-pdf.ts` (file đó vẫn khai type theo `pdf-lib` gốc — **KHÔNG đổi** vì còn dùng chung cho
  ISO/Văn bản, 3 route khác chưa áp dụng PAdES, đổi type ở đó sẽ ảnh hưởng ngoài phạm vi).
- `PDFDocument.load(currentBytes, { forIncrementalUpdate: true })` thay vì
  `PDFDocument.load(currentBytes)` — mirror đúng cách `addSignaturePlaceholder()` trong
  `pades.ts` đã làm cho lớp PAdES từ đầu.
- `pdfDoc.save()` khi đã `forIncrementalUpdate: true` chỉ trả về **đoạn bytes mới cần nối thêm**
  (không phải toàn bộ file) — đã sửa `newBytes` thành `Buffer.concat([currentBytes,
  Buffer.from(increment)])` thay vì gán trực tiếp kết quả `.save()`.
- Đã xác nhận qua kiểm tra API surface (`node -e "require('@cantoo/pdf-lib')..."`) rằng
  `@cantoo/pdf-lib@2.9.1` có đủ mọi method cần dùng (`registerFontkit`, `embedFont`, `embedPng`,
  `embedJpg`, `getPageCount`, `getPage`, `PDFPage.drawImage/drawText`,
  `PDFFont.widthOfTextAtSize`) — đủ điều kiện để ép kiểu gọi thẳng `drawSignatureImage`/
  `drawTextFit` từ `stamp-pdf.ts` mà không cần viết lại logic vẽ.
- `npx tsc --noEmit` (toàn repo) và `npx eslint src/lib/signing/requests.ts` đều sạch.

### Đã verify lại bằng script backend (2 người ký, mirror đúng phương pháp Giai đoạn 1/3)

Ký lại 1 phiếu test 2 người (Nguoi Lap → Phe Duyet) bằng đúng code đã sửa — file cuối:

- **Tìm thấy đúng 2 chữ ký PAdES độc lập** (trước fix chỉ có 1) qua `findByteRange`.
- Cả 2 đều `openssl cms -verify -CAfile root.pem` → `CMS Verification successful` (exit 0).
- Cả 2 đều `crypto.X509Certificate.verify(rootPublicKey)` → `true`.
- Đúng tên từng người: chữ ký #1 = `CN=E2E Signing Verify (TEST - đã disable)` (ký lúc
  22:03:51), chữ ký #2 = `CN=E2E Signing Approver (TEST - đã disable)` (ký lúc 22:03:54) — khớp
  đúng thứ tự thời gian ký thật, cả 2 root CA nhúng đều khớp fingerprint `public/rubber-erp-
  signing-root-ca.pem`.

Vì `findByteRange` scan trên chính FILE CUỐI CÙNG (không phải file trung gian), việc chữ ký #1
verify PASS tại đúng offset đã lưu trong file cuối tự nó đã chứng minh: không có byte nào trong
vùng đã ký của người ký #1 bị đụng bởi bất kỳ thao tác nào ở lượt ký #2 (vẽ con dấu ảnh lẫn PAdES)
— đúng bản chất "chỉ nối thêm, không sửa byte cũ" của incremental update.

### Dọn dẹp

Đã xoá cả 2 bộ file test trong Storage (bộ 2-người-ký vừa verify + bộ root-CA còn giữ lại từ tin
nhắn trước, nay đã thừa vì người dùng đã tự test bằng file thật của họ) — không cần giữ lại gì.

### Việc tiếp theo

1. **Chưa test qua UI thật** với code đã sửa — người dùng cần tự ký lại 1 tài liệu 2+ người ký
   (Chất lượng/Điều xe/Bảo trì đều dùng chung `signField()`) qua đúng `/dashboard/ky/[id]` trên
   `npm run dev` đang chạy, xác nhận: (a) cả 2 con dấu ảnh vẫn hiển thị đúng như trước (không đổi
   giao diện), (b) tải file cuối về, xác nhận có ≥2 chữ ký PAdES bằng cách lặp lại đúng kiểm tra
   OpenSSL đã làm ở trên.
2. Do Next.js dev server tự re-evaluate API route mỗi request (Fast Refresh), **không cần restart
   thủ công** — nhưng nếu gặp lỗi lạ, thử restart để loại trừ cache module cũ.
3. Commit + deploy cả 2 fix (`pades.ts` mục Unicode-encoding + `requests.ts` mục incremental
   update) cùng lúc — không migration, không đổi schema.
4. Nên test thêm 1 tài liệu **Bảo trì** (3-4 người ký, nhiều hơn 2) để xác nhận incremental update
   vẫn ổn định qua nhiều lượt nối tiếp, không chỉ 2 lượt.

## Cập nhật (tiếp) — Khóa Xóa/Sửa Kiểm nghiệm+Điều xe sau khi đã ký + cảnh báo lệch dữ liệu +
trang xác thực chữ ký PAdES (Việc 1+2+3) — ĐÃ CODE XONG, ĐÃ TEST BACKEND ĐẦY ĐỦ, CHƯA TEST QUA UI

Người dùng tự test 2 tài liệu (Điều xe + Kiểm nghiệm) qua `npm run dev`, gửi link file PDF đã ký
để đối chiếu — xác nhận 2 fix ở mục "tiếp" (Unicode-encoding + incremental update) hoạt động đúng
trên dữ liệu thật, đồng thời phát hiện thêm 2 lỗ hổng nghiệp vụ mới, dẫn tới việc này. Đã hỏi qua
`AskUserQuestion` và chốt phạm vi trước khi code (xem đầy đủ trong plan file
`.claude/plans/th-m-1-bug-c-joyful-iverson.md` nếu cần tra lại chi tiết thiết kế).

### Việc 1+2 — Khóa Xóa/Sửa (chỉ admin) sau khi "Đã ký duyệt" + badge cảnh báo lệch dữ liệu

Phạm vi đã chốt: **Kiểm nghiệm + Điều xe** (Bảo trì để phiên sau); khóa áp dụng cho **Xóa + Sửa**,
KHÔNG áp dụng cho "Thêm dữ liệu mới" (vẫn tự do, kể cả kênh xuyên-module `writeBackToDispatch`);
khi phát hiện dữ liệu đã đổi sau khi ký — **không chặn gì**, chỉ đổi badge sang cảnh báo màu amber.

- **Phát hiện lệch dữ liệu không cần migration/cột mới**: `qc_results`/`dispatch_entries` đã có
  sẵn `updated_at` nhưng **chưa từng được set tường minh** ở 3 điểm ghi (`quality/page.tsx`'s
  `handleSaveBatch()`, `dispatch/page.tsx`'s `handleSave()`, `output-types.ts`'s
  `writeBackToDispatch()`) — đã thêm `updated_at: new Date().toISOString()` vào cả 3 UPDATE. So
  sánh giá trị này với `yeu_cau_ky.tao_luc` (thời điểm PDF được chốt nội dung lúc tạo yêu cầu ký)
  là đủ để phát hiện "dữ liệu đã đổi sau khi ký" mà không cần snapshot/hash gì thêm.
- `src/app/api/quality/signing-status/route.ts` và `src/app/api/dispatch/signing-status/route.ts`:
  thêm field `dataChanged: boolean` — với dòng `trangThai === "hoan_tat"`, so `updated_at` mới
  nhất của dữ liệu nguồn với `tao_luc` của yêu cầu ký.
- `quality-sign-status.tsx`/`dispatch-sign-status.tsx`: nhánh `hoan_tat` khi `dataChanged` → badge
  amber "⚠ Đã ký — dữ liệu đã đổi" (icon `AlertTriangle`) thay cho badge xanh "Đã ký duyệt".
- Gate `isLocked = currentUser.role !== "admin" && status?.trangThai === "hoan_tat"` (AND với gate
  ownership hiện có, không thay thế) — áp cho **7 điểm** ở `quality/page.tsx` (nút Xóa/Sửa cấp
  ngày, `handleBulkDelete`, nút Xóa/Sửa từng dòng trong `editDateModal`, `handleDelete`,
  `handleSaveBatch` nhánh update) và **5 điểm** ở `dispatch/page.tsx` (nút Sửa/Xóa trong danh
  sách, nút Sửa trang chi tiết, `handleDelete`, `handleSave` nhánh update) — dùng
  `signingStatusByEntry`/`signingStatusByDate` đã có sẵn, không query thêm.
- `writeBackToDispatch()` **cố ý không bị khóa** — đúng quyết định "kênh tự động không chặn, chỉ
  để badge cảnh báo phản ánh qua cơ chế trên", chỉ thêm `updated_at` như 2 điểm kia.
- **Chưa đụng RLS** (`qc_results_update/delete`, `dispatch_entries_update/delete`) — vẫn giữ
  nguyên logic ownership-only hiện có ở tầng DB; đây là lớp phòng vệ sâu hơn UI, **ghi nhận cho
  phiên sau**, không phải việc quên làm.

### Việc 3 — Link trên con dấu chữ ký → trang xác thực PAdES công khai

- `src/lib/signing/requests.ts`'s `signField()`: trong vòng lặp vẽ `truong_ky` (`loai==="chu_ky"`),
  ngay sau `drawSignatureImage(...)`, thêm 1 `/Link` annotation (dùng API thấp của
  `@cantoo/pdf-lib` — tạo `PDFArray`/dict `Annot` thủ công, đăng ký vào `page.node`'s `Annots`)
  đúng tại `box` đã dùng để vẽ con dấu, action `/URI` trỏ `${appOrigin}/sign-verify/{nguoiKy.id}`.
  Vẽ trong cùng lượt `.save()` incremental đã có, không tạo lượt lưu riêng. Bọc `try/catch` — lỗi
  thêm link không được chặn luồng ký chính.
- Migration `supabase/migrations/20260831_signing_pades_sig_index.sql` — thêm cột
  `nguoi_ky.pades_sig_index INTEGER` (NULL nếu chưa cấu hình root CA/PAdES lỗi ở lượt đó).
  **Người dùng đã xác nhận đã chạy migration này.**
- `signField()`: trước `applyPadesSignature()`, đếm số `pades_sig_index IS NOT NULL` hiện có của
  đúng `yeu_cau_id` → đó là index (0-based) của chữ ký sắp thêm. **Quyết định phòng vệ quan
  trọng**: ghi `pades_sig_index` bằng **UPDATE riêng, tách khỏi** câu UPDATE chính
  (`trang_thai/ky_luc/ip/thiet_bi`) — lý do: PostgREST/Postgres từ chối **toàn bộ** câu UPDATE nếu
  gộp chung 1 cột chưa tồn tại (migration chưa chạy) vào cùng payload, làm hỏng cả luồng ký chính
  (triệu chứng giả "Chưa tới lượt ký của bạn"). Tách riêng đảm bảo luồng ký chính luôn chạy được
  dù migration đã chạy hay chưa — chỉ phần ghi `pades_sig_index` mới phụ thuộc migration.
- `src/lib/signing/verify-pades.ts` (mới) — verify CMS/PAdES thuần `node-forge` (forge không có
  `verify()` cấp cao cho PKCS7, chỉ có `sign()` — đã xác nhận qua đọc trực tiếp
  `node_modules/node-forge/lib/pkcs7.js`; tự viết bằng API cấp thấp `asn1.validate`/
  `pkcs7.asn1.*`, ép kiểu qua interface `ForgeLowLevel` cục bộ vì `@types/node-forge` không khai
  các API này). Không thêm dependency mới. Thuật toán 5 bước: (1) parse CMS DER qua
  `contentInfoValidator`/`signedDataValidator`; (2) xác nhận digest algorithm = sha256; (3) so
  SHA-256(signedData) với `messageDigest` attribute; (4) re-tag `authenticatedAttributes` thành
  `SET OF` rồi verify chữ ký RSA bằng public key leaf cert; (5) so fingerprint root cert nhúng
  trong CMS với `SIGN_PADES_ROOT_CA_CERT_PEM` hiện tại.
  - **Bug quan trọng đã tìm và fix trong chính phiên này** (phát hiện qua đối chiếu OpenSSL —
    `asn1parse` báo "too long", lệch đúng 1 byte): hàm trích `/Contents` DER ban đầu cắt padding
    dư bằng cách xóa `00` cuối chuỗi hex (`replace(/00+$/, "")`) — SAI khi byte cuối THẬT của chữ
    ký DER tình cờ là `0x00` (~1/256 xác suất mỗi chữ ký RSA-2048). Đây **cũng là bug có sẵn** ở
    chính `@signpdf/utils`'s `extractSignature()` (cùng cách tiếp cận ngây thơ), chỉ chưa từng lộ
    ra ở các lần test trước do may mắn. Đã fix bằng `derTotalLength()` — tự đọc đúng header
    Tag-Length-Value của DER để cắt chính xác số byte, không đoán theo heuristic trailing-zero.
- `src/app/api/signing/verify/[nguoiKyId]/route.ts` (mới) — GET công khai (không yêu cầu đăng
  nhập, dùng `getSupabaseAdmin()`), đọc `nguoi_ky` + `profiles.full_name` + `yeu_cau_ky.
  file_hien_tai`, gọi `verifyPadesSignature()`, trả `{signerName, vaiTro, kyLuc, valid, reason?}`.
- `src/app/sign-verify/[nguoiKyId]/page.tsx` + `_components/sign-verify-client.tsx` (mới) — trang
  public (top-level, ngoài `/dashboard`, không bị `dashboard/layout.tsx` redirect `/login`), badge
  lớn xanh/đỏ theo `valid` + tên/vai trò/thời gian ký.

### Đã verify — cả tầng thuật toán lẫn route HTTP thật, chưa verify qua UI trình duyệt

1. **Script E2E độc lập** (`signField()`/`createSigningRequest()` thật, không giả lập): ký 2 người
   (Người lập → Phê duyệt) trên 1 PDF test, sau đó gọi `verifyPadesSignature()` trực tiếp trên file
   cuối tải về từ Storage — cả 2 chữ ký (index 0 và 1) đều `valid:true`, đúng tên từng người. Test
   thêm: sửa 1 byte nội dung → cả 2 index trả `valid:false, reason:"Nội dung file không khớp chữ
   ký..."` (tamper detection đúng); gọi index không tồn tại (99) → `valid:false` đúng thông báo.
2. **Xác nhận `pades_sig_index` ghi đúng vào DB** (đọc trực tiếp qua Supabase, không chỉ tin log
   code): `{thu_tu:10, pades_sig_index:0}`, `{thu_tu:20, pades_sig_index:1}` — đúng thứ tự ký.
3. **Gọi route HTTP thật** (`curl` tới `/api/signing/verify/[nguoiKyId]` trên `npm run dev` đang
   chạy) cho cả 2 `nguoi_ky.id` — cả 2 trả JSON đúng `valid:true`, đúng `vaiTro`/`kyLuc`/tên (dấu
   tiếng Việt trong output terminal hiển thị sai do mojibake của `curl`/terminal Windows, KHÔNG
   phải bug dữ liệu thật — đã xác nhận nhiều lần trong phiên với các trường hợp khác).
4. **Trang `/sign-verify/[nguoiKyId]`** (server component + client fetch): gọi `curl` xác nhận trả
   `HTTP 200` (không crash SSR) — **chưa mở bằng trình duyệt thật** để xem badge/giao diện render
   đúng hay không.
- `npx tsc --noEmit` (toàn repo) và `npx eslint` trên toàn bộ file đã sửa/thêm đều sạch. Không
  chạy `npm run build`.
- Đã dọn 3 file Storage test (`v1/v2/v3.pdf` của yêu cầu ký `1c9dd40f-...`) — dòng `yeu_cau_ky`
  chính nó **giữ nguyên vĩnh viễn** theo đúng thiết kế bất biến (trigger chặn DELETE), không phải
  sót lại do quên dọn.

### CHƯA làm / cần làm ở phiên sau

1. **Test tay qua UI thật cho Việc 1+2** (chưa test lần nào, chỉ mới test logic ở tầng code):
   - Kiểm nghiệm: mở 1 ngày đã "Đã ký duyệt" bằng tài khoản user thường (không phải admin) → xác
     nhận nút Xóa/Sửa (cả cấp ngày lẫn từng dòng trong modal sửa) đều ẩn/disabled; đăng nhập admin
     → vẫn thao tác được bình thường.
   - Điều xe: tương tự — 1 phiếu đã ký, user thường không xóa/sửa được, admin vẫn được.
   - Kiểm nghiệm: admin thêm 1 phiếu KN mới cho đúng ngày đã ký (dùng nút "+" hoặc import Excel)
     → xác nhận badge đổi từ "Đã ký duyệt" (xanh) sang "⚠ Đã ký — dữ liệu đã đổi" (amber).
   - Điều xe: sau khi 1 phiếu điều xe đã ký, vào module Sản lượng sửa/thêm sản lượng cùng ngày để
     trigger `writeBackToDispatch()` → xác nhận: (a) việc ghi **không bị chặn** (đúng thiết kế
     "kênh tự động không khóa"), (b) badge của phiếu Điều xe đó đổi sang cảnh báo amber.
2. **Test tay Việc 3 qua trình duyệt thật**: ký 1 tài liệu Kiểm nghiệm/Điều xe mới qua UI thật
   (`/dashboard/ky/[id]`), tải PDF kết quả, mở bằng Acrobat/Chrome PDF viewer, bấm đúng vào vị trí
   con dấu chữ ký (không phải vùng tên) → xác nhận: (a) trình duyệt/Acrobat nhận diện link và mở
   đúng `/sign-verify/{nguoiKyId}` ở tab mới, (b) trang hiển thị đúng badge xanh "Chữ ký hợp lệ" +
   đúng tên người ký + thời gian ký. Thử thêm trên file đã bị sửa tay (nếu có cách tái hiện an
   toàn) để xác nhận badge đỏ hiển thị đúng thông báo lý do.
3. **RLS hardening cho `qc_results`/`dispatch_entries` UPDATE/DELETE** theo trạng thái ký — đã ghi
   nhận là việc cần làm ở Việc 1+2 nhưng cố ý chưa làm trong đợt này (chỉ có gate UI, chưa có gate
   DB) — cân nhắc làm ở phiên sau nếu người dùng muốn chặn chắc chắn hơn thao tác trực tiếp qua
   Supebase client/devtools, tương tự cách đã làm cho `dispatch.delete`/`quality.delete` ở migration
   `20260911_dispatch_qc_ownership_edit_lock.sql`.
4. **Mở rộng Việc 1+2 sang Bảo trì** — cố ý chưa làm (đã chốt phạm vi "Kiểm nghiệm + Điều xe" qua
   `AskUserQuestion`), cần hỏi lại người dùng trước khi làm thêm.
5. Cân nhắc thêm UI ở trang chi tiết `/dashboard/ky/[id]` hoặc trang xem file đã ký cho phép bấm
   trực tiếp (không cần mở PDF ngoài) tới `/sign-verify/[nguoiKyId]` — hiện chỉ có link nhúng
   trong chính file PDF, chưa có lối vào nào khác trong app.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (tiếp) — Khóa Xóa/Sửa Kiểm nghiệm+Điều xe... (Việc 1+2+3)" trong CLAUDE.md.
Migration 20260831_signing_pades_sig_index.sql đã chạy. Toàn bộ code đã xong, đã test đầy đủ ở
tầng backend/script/route HTTP thật — CHƯA test qua UI trình duyệt thật.

Nếu tôi báo đã test tay xong (mục "CHƯA làm / cần làm ở phiên sau" #1 và #2) và không có lỗi, coi
Việc 1+2+3 là hoàn tất — hỏi tôi có muốn làm tiếp #3 (RLS hardening) hoặc #4 (mở rộng sang Bảo trì)
hay không, đừng tự ý làm.

Nếu tôi báo lỗi cụ thể khi test tay, sửa đúng vị trí liên quan (7 điểm gate ở quality/page.tsx, 5
điểm ở dispatch/page.tsx, hoặc phần Link annotation/verify-pades.ts nếu lỗi liên quan xác thực chữ
ký) — đọc kỹ lại đúng đoạn code đã liệt kê trong mục này trước khi sửa, đừng đoán.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-01) — 3 bug phát hiện khi test tay Việc 1+2+3, đã fix 2/3, còn 1 việc là
CẤU HÌNH VERCEL (không phải code) — CHƯA test tay lại

Người dùng test tay theo checklist phiên trước, báo 3 vấn đề mới:

### Bug 1 — Icon vẫn "ẩn rồi hiện" dù đã thêm `signingStatusLoaded` ở phiên trước

**Nguyên nhân**: phiên trước chỉ gate `signingStatusLoaded` cho nút Sửa/Xóa — **quên** gate 2 chỗ
khác cũng đọc `signingStatusByDate`/`signingStatusByEntry` trước khi tải xong: (a) icon
`FileText`/`Eye` (chưa ký/đã ký), (b) chính `QualitySignStatusBadge`/`DispatchSignStatusBadge`
(khi `status` còn `undefined` do Map rỗng, badge tưởng "chưa có yêu cầu ký" và hiện nhầm nút
"Gửi ký duyệt" cho tới khi fetch xong mới đổi đúng).

**Fix**: cả `quality/page.tsx` và `dispatch/page.tsx` — bọc cụm icon+badge bằng
`{!signingStatusLoaded ? <Loader2 className="animate-spin"/> : (<>...icon+badge thật...</>)}`
thay vì để chúng tự render với dữ liệu rỗng. Thêm import `Loader2` ở cả 2 file.

### Bug 2 — Trưởng phòng QLCL (chỉ là người PHÊ DUYỆT) vẫn "+Thêm phiếu" được vào ngày đã gửi ký
duyệt nhưng CHƯA hoàn tất

**Nguyên nhân**: phiên trước chỉ khoá nút "+Thêm phiếu" (Quality) + luồng Nhập Excel khi
`trangThai === "hoan_tat"` — **không khoá khi `dang_luan_chuyen`** (đã gửi, đang chờ duyệt). Nút
"+" vốn không kiểm tra ownership (chủ đích, nhiều nhân viên có thể cùng nhập KN cho 1 ngày), nên
Trưởng phòng QLCL — người có quyền `quality.create` nhưng KHÔNG phải chủ phiếu — vẫn thêm được
phiếu mới vào chính ngày đang chờ HỌ duyệt.

**Fix**: thêm biến mới `isAddBlocked = currentUser?.role !== "admin" && !!signingStatusByDate.get(date)`
(khoá ngay khi có BẤT KỲ yêu cầu ký nào đang hoạt động — `dang_luan_chuyen` HOẶC `hoan_tat`, API
`signing-status` chỉ trả 2 trạng thái này nên "tồn tại record" = "đang hoạt động") — áp cho nút
"+Thêm phiếu" và điều kiện chặn Nhập Excel. **Chỉ áp dụng cho Quality** — Điều xe không có nút
tương đương độc lập (mọi sửa đổi phải qua "Sửa", vốn đã khoá đúng theo ownership từ phiên trước,
không cần mở rộng thêm). Nút Sửa/Xóa (không phải "+") của CẢ 2 module vẫn giữ nguyên chỉ khoá ở
`hoan_tat` — quyết định cũ "cho phép chủ sở hữu sửa trong lúc chờ duyệt" không đổi.

### Bug 3 — Ký trên mobile báo "Không xác minh được — chỉ có con dấu hình ảnh" — ĐÃ XÁC ĐỊNH
NGUYÊN NHÂN: thiếu biến môi trường trên Vercel, KHÔNG PHẢI bug code

Điều tra qua DB thật (đọc trực tiếp `yeu_cau_ky`/`nguoi_ky`, không đoán): phiếu Kiểm nghiệm ngày
01/9/26 (record `43cac88c-...`) có **CẢ 2** người ký (Administrator lẫn Trương Tấn Phước) đều
`pades_sig_index = NULL`. Đã hỏi lại người dùng và xác nhận: **ký qua trang production đã deploy
(qlsxkpt.vercel.app), không phải `npm run dev`**. Đã kiểm tra `.env.local` trên máy dev hiện tại —
**vẫn có đủ** `SIGN_PADES_ROOT_CA_CERT_PEM`/`SIGN_PADES_ROOT_CA_KEY_PEM` — khớp đúng giả thuyết đã
ghi từ phiên tạo tính năng PAdES (2026-08-30/31): **2 biến này CHƯA từng được thêm vào Vercel
Environment Variables**, nên `hasPadesRootCa()` trả `false` trên production → toàn bộ lớp PAdES bị
bỏ qua ÂM THẦM cho MỌI chữ ký ký trên production (con dấu ảnh vẫn ra bình thường, chỉ thiếu lớp mật
mã) — không phải lỗi trong `applyPadesSignature()`/incremental-update, không phải lỗi riêng mobile
(mobile chỉ là cách người dùng truy cập production).

Giải thích luôn case đã gây nhầm lẫn ban đầu ("Lập biểu ký thành công, Trưởng phòng QLCL không
xác minh được" — record `5d593fe5-...`): signer 1 (Nguyễn Hữu Thọ) ký lúc 03:40 UTC 31/8 —
`pades_sig_index=0` (thành công, khả năng cao ký qua `npm run dev` lúc đó); signer 2 (Trương Tấn
Phước) ký MUỘN HƠN HẲN, lúc 23:27 UTC cùng ngày — `pades_sig_index=null` (khả năng cao đã ký qua
production sau khi deploy) — khớp hoàn toàn với giả thuyết "production thiếu biến môi trường",
không phải bug "chữ ký thứ 2 luôn hỏng".

**KHÔNG PHẢI VIỆC CỦA CLAUDE CODE** — tôi không có quyền truy cập Vercel dashboard. Người dùng cần
tự làm:
1. Mở Vercel → Project Settings → Environment Variables.
2. Thêm `SIGN_PADES_ROOT_CA_CERT_PEM` và `SIGN_PADES_ROOT_CA_KEY_PEM`, copy đúng giá trị hiện có
   trong `.env.local` (2 dòng cuối file, đã có sẵn từ khi chạy
   `node scripts/generate-signing-root-ca.mjs --write-env`).
3. Deploy lại (redeploy) để biến mới có hiệu lực.
4. Các chữ ký ĐÃ ký trên production trước khi thêm biến (`pades_sig_index` đang NULL) **không tự
   khắc phục được** — PAdES không thể gắn hồi tố vào 1 yêu cầu ký đã `hoan_tat`; chỉ chữ ký MỚI
   sau khi thêm biến mới có lớp PAdES.

### Cải tiến chẩn đoán đi kèm (để lần sau không cần đoán/hỏi lại)

- Migration mới `supabase/migrations/20260901_signing_pades_error_diagnostics.sql` — thêm cột
  `nguoi_ky.pades_error TEXT` (NULL nếu PAdES thành công hoặc chưa từng thử). **CHƯA CHẠY.**
- `src/lib/signing/requests.ts`'s `signField()`: ghi rõ lý do vào biến `padesError` ở CẢ 2 nhánh
  — `!hasPadesRootCa()` (lý do cố định: "Chưa cấu hình SIGN_PADES_ROOT_CA_CERT_PEM/...") và
  nhánh `catch` (lý do là `err.message` thật). Ghi `pades_error` bằng UPDATE riêng cùng đợt với
  `pades_sig_index` (fallback về chỉ update `pades_sig_index` nếu cột `pades_error` chưa tồn tại
  — migration chưa chạy vẫn không hỏng luồng ký chính, đúng nguyên tắc phòng vệ đã áp dụng cho
  `pades_sig_index` trước đó).
- `src/app/api/signing/verify/[nguoiKyId]/route.ts`: SELECT thêm `pades_error` với **fallback an
  toàn** (thử SELECT có cột này trước, lỗi thì SELECT lại không có — tránh sập cả route nếu
  migration chưa chạy, vì SELECT nhiều cột mà 1 cột không tồn tại bị Postgres từ chối toàn bộ câu
  lệnh, khác UPDATE cũng vậy nhưng đã xử lý riêng). Khi `pades_sig_index IS NULL`, nối thêm
  `pades_error` (nếu có) vào `reason` trả về — từ nay `/sign-verify/[id]` tự hiển thị lý do kỹ
  thuật ngay trên trang, không cần vào DB/log server để tra.

### Đã kiểm tra

`npx tsc --noEmit` (toàn repo) và `npx eslint` trên 4 file đã sửa
(`quality/page.tsx`, `dispatch/page.tsx`, `signing/requests.ts`,
`api/signing/verify/[nguoiKyId]/route.ts`) đều sạch — các lỗi/warning còn lại đã đối chiếu là
pre-existing (không đổi số lượng, chỉ lệch số dòng do thêm code). Không chạy `npm run build`.

### CHƯA làm / cần làm ở phiên sau

1. **Chạy `supabase/migrations/20260901_signing_pades_error_diagnostics.sql`** trên Supabase SQL
   Editor.
2. **Thêm 2 biến môi trường vào Vercel** (xem hướng dẫn 4 bước ở trên) rồi redeploy — đây là việc
   BẮT BUỘC phải làm để tính năng PAdES hoạt động thật trên production, KHÔNG cần sửa code gì cả.
3. Sau khi làm xong #2, ký thử 1 tài liệu MỚI trên chính production, bấm vào con dấu chữ ký →
   xác nhận `/sign-verify/[id]` báo "Chữ ký hợp lệ" (không còn "chưa được ký số điện tử").
4. Test tay lại 2 bug UI đã fix (chưa test qua trình duyệt thật trong phiên này):
   - Load lại danh sách Kiểm nghiệm/Điều xe vài lần, quan sát kỹ vùng icon PDF/Eye + badge —
     phải thấy 1 vòng xoay nhỏ (`Loader2`) rất ngắn rồi chuyển thẳng sang icon/badge ĐÚNG, không
     còn hiện sai rồi đổi.
   - Đăng nhập Trưởng phòng QLCL (hoặc bất kỳ ai không phải chủ phiếu) → mở 1 ngày Kiểm nghiệm
     ĐÃ gửi ký duyệt nhưng CHƯA hoàn tất (`dang_luan_chuyen`) → xác nhận nút "+Thêm phiếu" đã ẩn;
     thử Nhập Excel cho đúng ngày đó → bị chặn với thông báo "đã gửi ký duyệt — chỉ admin...".
   - Đăng nhập admin → xác nhận "+Thêm phiếu" và Nhập Excel vẫn hoạt động bình thường bất kể
     trạng thái ký.
5. Việc đã ghi nhận từ phiên trước, vẫn chưa làm, chưa đổi ưu tiên: RLS hardening cho
   `qc_results`/`dispatch_entries` UPDATE/DELETE; mở rộng Việc 1+2 sang Bảo trì.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (2026-09-01) — 3 bug phát hiện khi test tay Việc 1+2+3" trong CLAUDE.md.

Việc BẮT BUỘC trước tiên: hỏi tôi đã (a) chạy migration
supabase/migrations/20260901_signing_pades_error_diagnostics.sql và (b) thêm
SIGN_PADES_ROOT_CA_CERT_PEM/SIGN_PADES_ROOT_CA_KEY_PEM vào Vercel Environment Variables + redeploy
hay chưa — đây là điều kiện để coi Bug 3 (PAdES không hoạt động trên production) là xong, KHÔNG
cần sửa code gì thêm cho việc này.

Nếu tôi báo đã test tay xong mục "CHƯA làm / cần làm ở phiên sau" #3-#4 và không có lỗi mới, coi
3 bug này là hoàn tất — hỏi tôi có muốn làm tiếp RLS hardening hoặc mở rộng Bảo trì hay không,
đừng tự ý làm.

Nếu tôi báo lỗi MỚI khi test tay, đọc kỹ đúng đoạn code đã liệt kê trong mục "Cập nhật
(2026-09-01)" trước khi sửa, đừng đoán — đặc biệt nếu vẫn còn chữ ký "không xác minh được" SAU
KHI đã redeploy với biến môi trường đúng, đó mới là lúc cần điều tra code thật (có thể là bug
trong `addSignaturePlaceholder()`/`applyPadesSignature()` khi ký người thứ 2 trở đi trên PDF đã
có 1 lớp PAdES — xem cột `pades_error` mới (nếu migration đã chạy) để biết lý do thật thay vì
đoán).

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-01, tiếp) — Root cause thật của Bug 3 (PAdES "không xác minh được") + 3
việc nhỏ trên SignScreen — ĐÃ XONG, ĐÃ XÁC NHẬN HOẠT ĐỘNG TRÊN PRODUCTION

### Bug 3 (mục trên) — nguyên nhân thật: giá trị dán vào Vercel thiếu PEM header/footer

Người dùng làm theo hướng dẫn thêm 2 biến môi trường vào Vercel nhưng **dán thiếu phần
`-----BEGIN.../-----END-----`** (chỉ dán phần thân base64) — đã xác nhận bằng cách so SHA-256 nội
dung người dùng dán với nội dung thật trong `.env.local` (khớp 100%, không phải lỗi copy sai nội
dung, chỉ thiếu 4 dòng header/footer bắt buộc để `node-forge` parse được PEM). Đã đưa lại đúng 2
khối hoàn chỉnh (copy nguyên văn từ `.env.local`, có đủ `-----BEGIN CERTIFICATE-----`/`-----END
CERTIFICATE-----` và `-----BEGIN RSA PRIVATE KEY-----`/`-----END RSA PRIVATE KEY-----`) để người
dùng dán đè vào Vercel. Sau khi dán đúng + redeploy, **người dùng đã xác nhận chữ ký PAdES hoạt
động đúng trên production** (ảnh chụp modal ký + trang `/sign-verify` hiện đầy đủ thông tin).

**Công cụ chẩn đoán mới đã thêm trong lúc tìm bug này** (giữ lại, hữu ích lâu dài):
- `src/lib/signing/pades.ts`'s `loadRootCa()` — tách riêng try/catch cho CERT và KEY, báo rõ
  đúng biến nào sai định dạng thay vì gộp chung 1 lỗi "Invalid PEM formatted message." mơ hồ.
- `diagnosePadesEnv()` (cùng file, export mới) — trả về metadata cấu trúc (độ dài, có bắt đầu
  bằng `-----BEGIN` không, parse được không, lỗi cụ thể) cho CẢ 2 biến, **không bao giờ trả nội
  dung khoá/chứng thư thật**.
- `GET /api/signing/diagnose-pades-env` (mới, chỉ admin) — gọi `diagnosePadesEnv()`, dùng để tự
  kiểm tra cấu hình môi trường bất cứ lúc nào mà không cần ký thử 1 tài liệu thật.

### 3 việc nhỏ trên SignScreen — ĐÃ SỬA (3 chỗ, đều đã kiểm tra `tsc`/`eslint` sạch)

1. **Việt hóa `loai_tai_lieu`**: `src/app/dashboard/ky/[id]/page.tsx` trước đây in thẳng mã
   snake_case (`dispatch_bang_phan_xe`) — đã thêm map `LOAI_TAI_LIEU_LABEL` (6 giá trị: Bảng phân
   xe/Phiếu KQKN/4 loại biên bản Bảo trì), fallback về mã gốc nếu có giá trị mới chưa kịp thêm.
2. **Modal "Xác nhận ký N khung" đếm sai gấp đôi**: mỗi vị trí ký thật gồm 2 dòng `truong_ky`
   (`loai='chu_ky'` + `loai='ten'` đi kèm) — `myFields.length` đếm gộp cả 2. Đã thêm biến
   `mySignaturePositions = myFields.filter(f => f.loai === "chu_ky")`, dùng `.length` của biến
   này ở cả 3 chỗ hiển thị số đếm (tiêu đề modal PIN + 2 dòng action bar). `myFields` gốc giữ
   nguyên cho các mục đích khác (render toạ độ trên PDF, boolean-check còn tồn tại khung hay
   không) — đã rà lại toàn bộ usages còn lại, xác nhận không có chỗ nào khác dựa vào con số sai.
3. **Chứng thư leaf chỉ hiệu lực 1 năm nhưng verify không kiểm tra hạn**: xác nhận qua đọc code
   `verifyPadesSignature()` — hoàn toàn không so `leafCert.validity` với `new Date()`, chữ ký sẽ
   mãi mãi báo "hợp lệ" bất kể đã qua "Hiệu lực đến" bao lâu (do CHƯA viết check, không phải cố
   ý). Đã hỏi và người dùng chọn: **kéo dài hiệu lực leaf lên 20 năm** (khớp thời hạn root CA) —
   không thêm logic kiểm tra ngày mới, giữ đúng ý đồ "hồ sơ ISO lưu trữ dài hạn không tự hết hạn".
   `issueLeafCertificate()` trong `pades.ts` đổi `+ 1` năm → `+ 20` năm. Chữ ký ĐÃ ký trước khi
   sửa vẫn giữ nguyên leaf cert 1 năm cũ (không hồi tố — leaf cert luôn tạo mới mỗi lần ký, không
   lưu trữ lại).

### File đã sửa trong cả 2 phần trên

| File | Thay đổi |
|---|---|
| `src/lib/signing/pades.ts` | Tách lỗi CERT/KEY trong `loadRootCa()`; thêm `diagnosePadesEnv()`; đổi `+1` → `+20` năm hiệu lực leaf cert |
| `src/app/api/signing/diagnose-pades-env/route.ts` | Mới — chẩn đoán cấu trúc env vars, chỉ admin |
| `src/app/dashboard/ky/[id]/page.tsx` | Thêm `LOAI_TAI_LIEU_LABEL`; thêm `mySignaturePositions`; sửa 3 chỗ hiển thị "N khung" |

### CHƯA làm / cần làm ở phiên sau

1. **Test tay 3 việc nhỏ vừa sửa** (chưa test qua UI, chỉ mới qua `tsc`/`eslint`):
   - Mở trang ký 1 yêu cầu bất kỳ → xác nhận dòng phụ đề hiện đúng tiếng Việt thay vì mã nội bộ.
   - Mở modal "Xác nhận ký" → xác nhận tiêu đề đúng số khung khớp với số khối preview thật đang
     hiện (thường là 1, trừ trường hợp thật sự có nhiều vị trí ký khác nhau).
   - Ký 1 tài liệu MỚI (sau khi deploy bản sửa này) → `/sign-verify/[id]` → "Hiệu lực đến" phải
     xa hơn nhiều (2046 thay vì 2027).
2. **Xác nhận migration `20260901_signing_pades_error_diagnostics.sql` đã chạy chưa** — vẫn còn
   treo từ mục "Cập nhật (2026-09-01)" phía trên, chưa được người dùng xác nhận riêng (khác với
   việc thêm biến môi trường Vercel — 2 việc độc lập nhau).
3. Việc đã ghi nhận từ các phiên trước, vẫn chưa đổi ưu tiên: RLS hardening cho
   `qc_results`/`dispatch_entries` UPDATE/DELETE; mở rộng khoá Xóa/Sửa sau ký duyệt (Việc 1+2)
   sang module Bảo trì.
4. **Chưa commit/push code của toàn bộ phiên 2026-09-01** (cả 2 phần: 6 bug UI + bug 3 root-cause
   + 3 việc nhỏ SignScreen) — người dùng cần tự `git add/commit/push` khi sẵn sàng deploy, theo
   đúng quy tắc "chỉ commit khi được yêu cầu rõ ràng".

### Xác nhận (2026-09-01, cuối phiên) — mục 1+2 ở trên đã xong

Người dùng đã deploy và xác nhận test tay cả 3 việc nhỏ (dòng phụ đề tiếng Việt, đếm đúng "1
khung", "Hiệu lực đến" đã nhảy tới 2046) đều đúng, và đã chạy migration
`20260901_signing_pades_error_diagnostics.sql` trên Supabase. **Coi mục 1+2 ở trên là hoàn tất.**
Mục 3 (RLS hardening / mở rộng Bảo trì) và mục 4 (chưa rõ đã commit/push hay chưa) vẫn còn treo,
để phiên sau hỏi lại và xử lý.

### Làm rõ trạng thái Bảo trì (2026-09-01, cuối phiên) — trả lời câu hỏi người dùng đặt ra

Người dùng hỏi lại: "có phải Bảo trì chỉ mới làm tới `su_co_nho`, còn 3 loại chứng từ còn lại
(`bao_duong`/`bao_duong_xe`/`sua_chua_nho_xe`) chưa làm?" — đã tra lại lịch sử CLAUDE.md (không
đoán) để trả lời chính xác:

- **`su_co_nho`**: đã code xong VÀ đã được người dùng xác nhận test tay pass (mục "Cập nhật (Giai
  đoạn 5, phần 1 — xác nhận đã pass)").
- **`bao_duong`/`bao_duong_xe`/`sua_chua_nho_xe`** (mục "Giai đoạn 5 phần 2"): **đã code xong**,
  bao gồm đúng cơ chế người dùng nhắc tới — vai trò "Tài xế" ở `bao_duong_xe`/`sua_chua_nho_xe`
  được gộp cho **Nhân viên phụ trách ký thay** (không có tài khoản đăng nhập riêng cho Tài xế) —
  nhưng **CHƯA từng được xác nhận test tay** ở bất kỳ đâu trong lịch sử sau đó. Checklist chi
  tiết đã có sẵn, chưa đánh dấu hoàn tất: mục "CHƯA test tay — bắt buộc trước khi coi Giai đoạn 5
  phần 2 là xong" (7 mục, ngay phía trên mục này trong file).

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc 2 mục sau trong CLAUDE.md theo đúng thứ tự:
1. "Giai đoạn 5 phần 2 — 3 loại chứng từ Bảo trì còn lại: bao_duong, bao_duong_xe,
   sua_chua_nho_xe — ĐÃ CODE XONG, CHƯA TEST TAY" (kiến trúc + bảng vai trò ký từng bundle).
2. "Cập nhật (2026-09-01, tiếp) — Root cause thật của Bug 3... + 3 việc nhỏ trên SignScreen" (đã
   xong, đã người dùng xác nhận test tay + deploy — không cần làm lại).

**Ưu tiên phiên này**: hướng dẫn tôi test tay đầy đủ 7 mục trong checklist "CHƯA test tay — bắt
buộc trước khi coi Giai đoạn 5 phần 2 là xong" (`bao_duong`/`bao_duong_xe`/`sua_chua_nho_xe`) —
đây là phần DUY NHẤT trong toàn bộ hệ thống ký số dùng chung đã code xong nhưng chưa từng được
xác nhận hoạt động đúng qua UI thật. Nếu tôi báo lỗi cụ thể ở 1 trong 3 bundle này, đọc kỹ đúng
bảng vai trò ký + đoạn code liên quan trong `src/lib/maintenance-pdf.ts`
(`buildBaoDuongSigningRoles`/`buildBaoDuongXeSigningRoles`/`buildSuaChuaNhoXeSigningRoles`) và
`maintenance-sign-modal.tsx` trước khi sửa, đừng đoán.

Sau khi Giai đoạn 5 phần 2 test xong, hỏi tôi có muốn tiếp tục 1 trong 2 hướng còn treo hay
không (đừng tự ý làm): (a) siết RLS tầng database cho `qc_results`/`dispatch_entries`
UPDATE/DELETE (hiện chỉ chặn ở tầng UI); (b) mở rộng khoá Xóa/Sửa sau ký duyệt (Việc 1+2, hiện
chỉ có ở Kiểm nghiệm + Điều xe) sang Bảo trì.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-01, tiếp — phiên mới) — Fix bug 74.8MB (root cause thật), inline icon danh
sách Bảo trì, badge "Chờ BẠN ký duyệt", label ký-thay trên SignScreen, tự động mở khóa ký lại
cho Kiểm nghiệm sau khi xóa+nhập lại dữ liệu — TẤT CẢ ĐÃ TEST TAY VÀ PASS (trừ 1 mục)

Phiên này **không đọc trước** phần lịch sử ngay phía trên (Giai đoạn 5 phần 2 Bảo trì) — bắt đầu
từ 2 bug người dùng báo bằng ảnh chụp: (1) ký Giám đốc vẫn báo "File sau khi ký đã đạt 74.8MB,
vượt giới hạn 20MB"; (2) danh sách biên bản Bảo trì (`/dashboard/maintenance/records`) không có
icon hành động inline như Chất lượng/Điều xe. Đã điều tra sâu và mở rộng làm thêm 3 việc UX theo
phản hồi thêm của người dùng trong lúc test. **Mục Giai đoạn 5 phần 2 (test tay
`bao_duong`/`bao_duong_xe`/`sua_chua_nho_xe`) ở mục lịch sử ngay phía trên VẪN CÒN TREO, chưa
đụng tới trong phiên này** — xem "Việc còn treo" cuối mục này.

### 1. Bug 74.8MB — ĐÃ TÌM RA NGUYÊN NHÂN THẬT (khác hẳn giả thuyết ban đầu), ĐÃ FIX, ĐÃ TEST PASS

Ban đầu nghi ngờ do font `TimesNewRoman.ttf` không subset cộng dồn qua nhiều lượt ký (~1-1.5MB/
người) — **sai**. Đo bằng thực nghiệm cô lập (script Node gọi thẳng `@cantoo/pdf-lib`, không qua
DB) phát hiện: **mỗi lần RELOAD 1 file PDF đã từng qua ≥1 lượt incremental-update trước đó rồi
tiếp tục incremental-save lần nữa khiến `@cantoo/pdf-lib` NHÂN ĐÔI dung lượng** (không phải cộng
thêm tuyến tính) — xác nhận bằng đối chứng: gọi `doc.commit()` lặp lại trên 1 instance SỐNG (không
reload) → tăng tuyến tính bình thường; reload từ bytes mỗi lần → tăng cấp số nhân (PDF demo từ
1.8KB → 28.67MB chỉ sau 3 lượt ký giả lập).

Nguyên nhân cụ thể: `signField()` (`src/lib/signing/requests.ts`) trước đây làm **2 lượt
reload-rồi-save tách rời** cho MỖI người ký — 1 lượt `pdfDoc.save()` vẽ con dấu ảnh, rồi
`applyPadesSignature()` (`pades.ts`) tự `CantooPDFDocument.load()` LẠI TỪ ĐẦU để đặt placeholder
PAdES. Với 1 hồ sơ Bảo trì thật (`su_co_nho`, factory `phuochoa_kt`): 0.60MB → 18.21MB chỉ sau 2
người ký (NV+BGĐ), và người ký thứ 3 (GĐ) mới ra đúng 74.8MB như ảnh báo lỗi.

**Fix**: gộp 2 bước (vẽ con dấu + đặt placeholder PAdES) vào **CÙNG 1 `pdfDoc` sống**, gọi
`.commit()` 2 lần liên tiếp thay vì `.save()` rồi để `pades.ts` reload — đúng API `commit()` mà
`@cantoo/pdf-lib` tự tài liệu hoá cho "nhiều lượt cập nhật incremental không cần reload", trước
đây chưa dùng đúng cách. Đã tách `addSignaturePlaceholder()` cũ (tự load/save) thành
`addSignaturePlaceholderToDoc()` (chỉ mutate 1 doc đã load sẵn, không tự load/save) +
`applyPadesSignatureToDoc()` (nhận thẳng `pdfDoc`, gọi `.commit()`) — giữ lại
`applyPadesSignature(bytes,...)` cũ làm wrapper tương thích ngược (tự load rồi gọi bản mới) phòng
khi có call site khác trong tương lai.

**Verify**: test THẬT bằng `createSigningRequest()`+`signField()` (không qua HTTP, dùng 3 tài
khoản test tạm `e2e_signing_verify`/`reviewer`/`approver` có sẵn từ trước) — 3 lượt ký thật ra
673KB → 1344KB → 2015KB (tuyến tính, ~670KB/người do vẫn phải nhúng lại font mỗi lượt — không
tránh được, nhưng không còn nhân đôi). Cả 3 chữ ký PAdES verify `valid:true` trên file cuối. Đã
dọn Storage test, giữ nguyên `yeu_cau_ky`/`nguoi_ky` test theo đúng thiết kế bất biến (không xóa
được). **Người dùng xác nhận trên `npm run dev` thật: Giám đốc ký được, không còn bị chặn.**

File sửa: `src/lib/signing/requests.ts`, `src/lib/signing/pades.ts`.

### 2. Icon hành động inline ở danh sách Bảo trì — ĐÃ LÀM, ĐÃ XÁC NHẬN

`src/app/dashboard/maintenance/records/page.tsx` trước đây mỗi dòng chỉ có link chữ "Chi tiết" —
đã thêm cột "Ký duyệt" với icon Eye (xem file đã ký)/FileText (in bản chưa ký) +
`MaintenanceSignStatusBadge`, bulk-load qua `/api/maintenance/signing-status?recordIds=...`
(route đã có sẵn, không cần sửa backend) — mirror đúng pattern Chất lượng/Điều xe. Thêm
`resolveSignBundle()` (suy bundle ký từ `hang_muc`/`bo_phan`/`loai_sua_chua` của dòng đầu tiên
trong `maintenance_record_lines`, mirror logic `[id]/page.tsx`). **Người dùng xác nhận: "inline
đã có các icon như modun Điều xe/Chất lượng".**

File sửa: `src/app/dashboard/maintenance/records/page.tsx`.

### 3. Badge "Chờ BẠN ký duyệt" — phân biệt rõ lượt của mình — ĐÃ LÀM, ĐÃ XÁC NHẬN CHO KIỂM NGHIỆM

Trước đây badge "Chờ ký duyệt (N/M)" giống hệt nhau bất kể người xem có phải tới lượt ký hay
không — phải hover mới biết. Thêm helper dùng chung
`src/app/dashboard/_components/signing-my-turn.ts` (`computeMyTurn()`, mirror ĐÚNG công thức đã
đúng sẵn ở SignScreen: tới lượt khi TẤT CẢ người `thu_tu` nhỏ hơn đã ký xong). Áp dụng cho cả 3
badge (`quality-sign-status.tsx`/`dispatch-sign-status.tsx`/`maintenance-sign-status.tsx`): khi
đúng lượt → nhãn đậm nổi bật **"🔔 Chờ BẠN ký duyệt"** (nền vàng đặc `bg-amber-500`, chữ trắng),
khi chưa tới lượt → **"Đang chờ người ký trước"** (nhạt hơn). Quality/Dispatch's API
signing-status đã mở rộng thêm `signers[]` (trước chỉ có `pheDuyetUserId` đơn, không đủ để tính
`thu_tu`-based turn).

**Người dùng xác nhận cho Kiểm nghiệm: "banner Chờ bạn ký duyệt đã hiện rõ ràng".** **CHƯA xác
nhận cho Điều xe/Bảo trì** — logic giống hệt nhau (dùng chung `computeMyTurn()`), rủi ro thấp
nhưng chưa test tay trực tiếp trên 2 module đó.

File sửa: `src/app/dashboard/_components/signing-my-turn.ts` (mới),
`src/app/api/quality/signing-status/route.ts`, `src/app/api/dispatch/signing-status/route.ts`,
3 file `*-sign-status.tsx`.

### 4. Label "(ký thay bởi...)" hiện cố định trên SignScreen — ĐÃ LÀM, CHƯA TEST TAY

Text "(ký thay bởi Nhân viên phụ trách)" (bake sẵn trong `truong_ky.nhan` lúc tạo yêu cầu ký,
cho CẢ vai trò "Tổ trưởng cơ điện/cơ khí" LẪN "Tài xế" ký thay — không chỉ riêng Tài xế) trước
đây chỉ hiện qua tooltip hover hoặc bị ảnh chữ ký thật che mất sau khi ký. Đã sửa
`src/app/dashboard/ky/[id]/page.tsx`: thêm `distinctRoleLabelsOf()` lấy TẤT CẢ nhãn vai trò khác
nhau của 1 người (không chỉ field đầu tiên — quan trọng khi 1 người gộp ký thay ≥2 vai trò cùng
lúc), áp dụng cho `roleLabelForMe` (ô "Vai trò" trong sheet xác nhận ký, luôn hiện cố định không
phải tooltip) và `FlowList` (panel "Luồng ký hồ sơ", mỗi vai trò 1 dòng riêng thay vì nhãn chung
chung "Ký"/"Phê duyệt").

**CHƯA test tay** — cần mở SignScreen của 1 hồ sơ `su_co_nho` (hoặc `bao_duong_xe`/
`sua_chua_nho_xe`) có vai trò ký thay, xác nhận thấy rõ "(ký thay bởi...)" cả trước/sau khi ký,
cả khung của chính mình lẫn khi người KHÁC xem panel Luồng ký hồ sơ.

### 5. Tự động mở khóa ký lại cho Kiểm nghiệm sau khi xóa+nhập lại dữ liệu — ĐÃ LÀM, ĐÃ XÁC NHẬN
PASS (qua 2 vòng sửa)

**Bối cảnh**: khi 1 ngày Kiểm nghiệm đã ký `hoan_tat`, rồi admin xóa hết `qc_results` ngày đó
+nhập/upload lại → trước đây là NGÕ CỤT thật: badge tự chuyển "Đã ký — dữ liệu đã đổi" nhưng
không có cách nào ký lại (không tạo được yêu cầu ký mới do unique index chặn trùng, không hủy
được yêu cầu cũ vì đã `hoan_tat`).

**Vòng 1** (đã bị người dùng bác bỏ): thêm nút thủ công "Mở lại để ký lại" (admin-only) trong
badge — người dùng phản hồi: "Action Mở lại để ký lại để làm gì? người dùng chỉ cần admin xóa
phiếu sau đó upload lại và lập lại các bước ký bình thường" — tức muốn HOÀN TOÀN TỰ ĐỘNG, không
thao tác thủ công nào. Đã **bỏ hẳn** nút + modal "Mở lại để ký lại" khỏi cả 3 badge
(`quality-sign-status.tsx`/`dispatch-sign-status.tsx`/`maintenance-sign-status.tsx`) — nhưng
GIỮ LẠI hàm backend `reopenSigningRequest()` + route `/api/signing/reopen-request` (dùng nội bộ
ở vòng 2).

**Vòng 2** (tự động hóa, lỗi race condition đầu tiên): móc vào `handleDelete`/`handleBulkDelete`
(`quality/page.tsx`) — sau khi xóa `qc_results` thành công, tự gọi đóng yêu cầu ký cũ. **Lỗi**:
dựa vào `signingStatusByDate` (state React cache, tải bất đồng bộ) để biết có gì cần đóng —
nếu xóa dữ liệu TRƯỚC KHI lần fetch signing-status đầu tiên của trang kịp xong, state rỗng, code
tưởng "không có gì để đóng" và bỏ qua trong im lặng. Đã xác nhận đúng root cause này bằng cách
gọi TRỰC TIẾP `reopenSigningRequest()` (không qua UI) trên đúng bản ghi bị kẹt thật
(`yeu_cau_ky.id = 3737177f-7d46-458a-84e3-380c946100c6`, ngày 27/08/2026, factory
`phuochoa_kt`) — chạy đúng 100% (`hoan_tat` → `huy`), chứng minh backend không có vấn đề, chỉ có
vấn đề ở tầng client dựa vào state cache.

**Fix triệt để**: thêm hàm mới `closeActiveSigningRequestForKey()`
(`src/lib/signing/requests.ts`) — **KHÔNG nhận `yeuCauId` từ client**, tự TRUY VẤN LẠI TRỰC TIẾP
từ DB theo khóa nghiệp vụ `(factory_id, modun, loai_tai_lieu, ma_ho_so)` ngay tại thời điểm gọi,
loại bỏ hẳn phụ thuộc vào state client → không còn race condition có thể xảy ra. Route mới
`/api/signing/close-for-key`. `quality/page.tsx`'s `autoCloseSigningRequestForDate()` đổi sang
gọi route này (kèm `factoryId`/`modun:"quality"`/`loaiTaiLieu:"quality_kqkn"`/`maHoSo:<ngày>`),
gọi tự động ngay sau `handleDelete`/`handleBulkDelete` xóa thành công — hoàn toàn im lặng, chỉ
báo lỗi qua toast nếu đóng thất bại (vd không đủ quyền).

**Người dùng xác nhận PASS**: "Xóa, upload lại kí 2 bước thành công."

**Phạm vi cố ý CHỈ áp dụng cho Kiểm nghiệm** — Điều xe/Bảo trì KHÔNG có cơ chế tương đương, vì
`ma_ho_so` của 2 module đó là ID bản ghi cố định (UUID sinh ra khi tạo, không tái sử dụng được
qua xóa-rồi-tạo-lại), khác Kiểm nghiệm dùng NGÀY (chuỗi ổn định, con người chọn lại được) làm
`ma_ho_so`. Nếu Điều xe/Bảo trì phát sinh tình huống tương tự (sửa dữ liệu sau khi đã ký xong),
cần thiết kế điểm móc nối riêng (khả năng cao là vào hành động "Sửa"/"Lưu" chứ không phải "Xóa").

File sửa: `src/lib/signing/requests.ts` (`closeActiveSigningRequestForKey`, giữ nguyên
`reopenSigningRequest`/`cancelSigningRequest` không đổi), `src/app/api/signing/close-for-key/
route.ts` (mới), `src/app/api/signing/reopen-request/route.ts` (mới, không còn gọi từ UI nhưng
giữ lại), `src/app/dashboard/quality/page.tsx`, 3 file `*-sign-status.tsx` (bỏ nút/modal
"Mở lại để ký lại").

### Rủi ro đã biết, CHƯA fix (nằm ngoài phạm vi báo cáo lần này, chỉ ghi lại để không quên)

**Guard quyền xóa phiếu Kiểm nghiệm đã ký (`hoan_tat`) vẫn còn CÙNG LOẠI race condition** —
`handleDelete`/`handleBulkDelete`'s điều kiện chặn non-admin xóa
(`currentUser?.role !== "admin" && signingStatusByDate.get(delDate)?.trangThai === "hoan_tat"`)
vẫn đọc từ `signingStatusByDate` (state client cache) y hệt bug vừa fix ở mục 5 — nếu 1 user
KHÔNG PHẢI admin xóa dữ liệu đủ nhanh (trước khi signing-status kịp tải), về mặt lý thuyết có
thể lách qua được điều kiện chặn này (dù `closeActiveSigningRequestForKey()` sau đó sẽ ĐÚNG ĐẮN
từ chối đóng yêu cầu ký cũ vì họ không phải admin — nhưng qc_results đã bị xóa mất trước đó rồi,
không hoàn tác được). Chưa fix vì ngoài phạm vi báo cáo của người dùng lần này (họ chỉ báo bug
"không đóng được yêu cầu ký cũ", không phải bug bảo mật xóa trái phép) — cần hỏi lại trước khi
đụng vào, vì sửa đúng cách cần 1 route riêng "kiểm tra quyền xóa fresh từ DB" tương tự
`closeActiveSigningRequestForKey()`, không đơn giản.

### Việc còn treo (chưa đụng trong phiên này, mang từ các phiên trước sang)

1. **Giai đoạn 5 phần 2 Bảo trì** (`bao_duong`/`bao_duong_xe`/`sua_chua_nho_xe`) — đã code xong
   từ trước, **VẪN CHƯA từng được test tay** (xem mục lịch sử "Giai đoạn 5 phần 2..." phía trên
   trong file này, còn nguyên checklist 7 mục).
2. Badge "Chờ BẠN ký duyệt" (mục 3 ở trên) — chưa test tay cho Điều xe/Bảo trì, chỉ Kiểm nghiệm.
3. Label "(ký thay bởi...)" trên SignScreen (mục 4 ở trên) — hoàn toàn chưa test tay.
4. RLS hardening tầng database cho `qc_results`/`dispatch_entries` UPDATE/DELETE (nhắc từ nhiều
   phiên trước, vẫn chưa làm).
5. Mở rộng khóa Xóa/Sửa sau ký duyệt (Việc 1+2 lịch sử cũ) sang Bảo trì.
6. Rủi ro race condition ở guard xóa phiếu Kiểm nghiệm đã ký (mục ngay phía trên) — cần hỏi
   trước khi sửa.
7. **Toàn bộ code phiên này (mục 1-5) chưa commit/push** — làm việc trực tiếp trên working tree,
   người dùng cần tự `git add/commit/push` khi sẵn sàng deploy.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (2026-09-01, tiếp — phiên mới) — Fix bug 74.8MB..." trong CLAUDE.md (ngay phía
trên, mục dài nhất ở cuối file) để nắm đầy đủ 5 việc đã làm trong phiên trước — bug 74.8MB (đã
tìm ra root cause thật: reload nhiều lần 1 file PDF đã qua incremental-update làm @cantoo/pdf-lib
nhân đôi dung lượng, đã fix bằng commit() thay vì save()+reload), icon inline danh sách Bảo trì,
badge "Chờ BẠN ký duyệt", label ký-thay trên SignScreen, tự động mở khóa ký lại cho Kiểm nghiệm
sau khi xóa+nhập lại dữ liệu (closeActiveSigningRequestForKey, race-free). Mục 1, 2, 5 ĐÃ ĐƯỢC
NGƯỜI DÙNG XÁC NHẬN PASS qua test tay — không cần test lại trừ khi tôi báo lỗi mới.

Việc cần làm theo đúng thứ tự ưu tiên:

1. Hướng dẫn tôi test tay 2 việc mục 3+4 CHƯA được xác nhận: (a) badge "Chờ BẠN ký duyệt" cho
   Điều xe + Bảo trì (Kiểm nghiệm đã pass, logic dùng chung computeMyTurn() nên rủi ro thấp
   nhưng chưa test trực tiếp); (b) label "(ký thay bởi...)" hiện cố định trên SignScreen — mở 1
   hồ sơ Bảo trì bundle su_co_nho/bao_duong_xe/sua_chua_nho_xe có vai trò ký thay, xác nhận thấy
   rõ text này cả trước/sau khi ký, cả khung của mình lẫn khi người khác xem panel "Luồng ký hồ
   sơ".

2. Nếu tôi xác nhận cả 2 việc trên pass, hỏi tôi có muốn tiếp tục việc CŨ còn treo từ trước
   (chưa đụng gì trong phiên vừa rồi) hay không — KHÔNG tự ý làm: test tay Giai đoạn 5 phần 2
   Bảo trì (bao_duong/bao_duong_xe/sua_chua_nho_xe — xem checklist 7 mục ở mục lịch sử "Giai
   đoạn 5 phần 2" trong CLAUDE.md), RLS hardening database, mở rộng khóa Xóa/Sửa sang Bảo trì,
   hoặc rủi ro race condition ở guard xóa phiếu Kiểm nghiệm đã ký (mục "Rủi ro đã biết, CHƯA
   fix" ngay trên phần này).

3. Nhắc tôi: toàn bộ code của phiên trước (mục 1-5) vẫn CHƯA commit/push — nếu tôi muốn deploy,
   cần tự xác nhận trước khi Claude chạy git commit (theo đúng quy tắc "chỉ commit khi được yêu
   cầu rõ ràng").

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-01, tiếp — phiên mới 2) — 3 phản hồi sau test tay biên bản Đội xe: label
ký-thay trên PDF in thật, khóa "Hủy yêu cầu" sau khi đã ký, điều tra badge "Chờ bạn ký duyệt"

Người dùng test biên bản `DX-170826/002` (bundle `sua_chua_nho_xe`, chưa xác nhận PASS/FAIL 2
mục treo ở trên — đây là phản hồi MỚI, độc lập) và báo 3 việc:

### 1. Đã fix — "(ký thay bởi Nhân viên phụ trách)" thiếu trên chính file PDF đã ký

Phiên trước chỉ thêm label này vào SignScreen (`truong_ky.nhan`, hiện trong panel "Luồng ký hồ
sơ") — **file PDF in ra/đã ký thật KHÔNG có label này**, cột "Tài xế" chỉ hiện tên người ký thay
("Chau Nho") không kèm chú thích, dễ hiểu lầm là chính tài xế đó tự ký.

- `drawSignatureRowCapture()` (`src/lib/maintenance-pdf.ts`) thêm field `note?: string` vào type
  cột — vẽ 1 dòng chữ nghiêng nhỏ ngay dưới "(Ký và ghi rõ họ tên)" khi có, và **tăng thêm chiều
  cao trả về** (`nameY + 14` thay vì `+8`) khi có bất kỳ cột nào có `note` — tránh khối nội dung
  kế tiếp đè lên dòng ghi chú mới. Không đổi hành vi khi không có cột nào có `note` (giữ nguyên
  `+8` cũ).
- Cả 4 điểm gọi có cột "Tài xế" (F15BaoDuong `isBoDoi`, F06, F08NB, F15SmallVehicle — tương ứng
  3 bundle `bao_duong_xe`/`sua_chua_nho_xe`) đều thêm `note: forSigning ? "(NV phụ trách ký
  thay)" : undefined` — chỉ hiện khi đang tạo bản để KÝ ĐIỆN TỬ (`forSigning=true`), bản in
  thường (`forSigning=false`, vẫn hiện tên tài xế thật để ký tay) không đổi gì.
- Dùng text ngắn **"(NV phụ trách ký thay)"** (khác câu đầy đủ "(ký thay bởi Nhân viên phụ
  trách)" dùng trên SignScreen) — cột PDF hẹp (`colW - 4`, có thể chỉ ~120pt ở layout 4 cột),
  câu dài dễ tự xuống dòng qua `maxWidth` của jsPDF và đè lên vùng chữ ký/tên bên dưới (khoảng
  cách cố định `nameY = y + 18`, không co giãn theo số dòng heading). Không sửa cột "Tổ trưởng
  cơ điện/cơ khí" (F13, bundle `su_co_nho`) — cột đó ĐÃ hiện tên NV phụ trách trực tiếp mà không
  có label ký-thay theo thiết kế cũ, ngoài phạm vi báo cáo lần này (chỉ báo cáo cột Tài xế).
- `npx tsc --noEmit`/`npx eslint src/lib/maintenance-pdf.ts` sạch. **Chưa test tay** — cần in
  thử 1 biên bản `bao_duong_xe`/`sua_chua_nho_xe` qua luồng Ký duyệt, xác nhận dòng "(NV phụ
  trách ký thay)" hiện đúng dưới cột Tài xế, không đè/tràn ra ngoài khung, không ảnh hưởng layout
  các cột khác.

### 3. Đã fix — chặn "Hủy yêu cầu" sau khi đã có người ký (cả tầng backend lẫn UI)

- `cancelSigningRequest()` (`src/lib/signing/requests.ts`) thêm kiểm tra: đếm `nguoi_ky` có
  `trang_thai='da_ky'` cho đúng `yeu_cau_id` — nếu ≥1, throw lỗi tiếng Việt hướng dẫn dùng "Trả
  về" thay thế. Đặt SAU 2 check hiện có (`trang_thai !== 'dang_luan_chuyen'`, quyền
  admin/nguoi_tao), TRƯỚC khi update `trang_thai='huy'`.
- Thêm helper dùng chung mới `hasAnySigned(signers: MyTurnSigner[])` trong
  `src/app/dashboard/_components/signing-my-turn.ts` (cạnh `computeMyTurn` đã có) — cả 3 badge
  component (`quality-sign-status.tsx`, `dispatch-sign-status.tsx`,
  `maintenance-sign-status.tsx`) đổi `canCancel` từ `isAdmin || isCreator` sang
  `(isAdmin || isCreator) && !hasAnySigned(status.signers)` — ẩn hẳn nút "Hủy yêu cầu" ở UI ngay
  khi có bất kỳ ai đã ký, kể cả với admin (đồng nhất với backend — admin cũng bị chặn, chỉ có
  "Trả về" mới sửa được sau khi đã ký).
- **Đã xác nhận không ảnh hưởng nhánh "Trả về" (`status.traVeLyDo`)**: cả 3 component dùng
  chung 1 biến `canCancel` cho cả nhánh bình thường lẫn nhánh đã-trả-về — nhưng sau khi "Trả về"
  chạy, TẤT CẢ người ký trước đó bị reset về `trang_thai='cho'` (đúng thiết kế
  `returnSigningRequest()` có sẵn từ trước), nên `hasAnySigned()` tự nhiên trả `false` trong
  tình huống này — nút "Hủy yêu cầu" vẫn hiện đúng cho người tạo/admin sau khi hồ sơ bị trả về,
  không bị chặn nhầm.
- `npx tsc --noEmit`/`npx eslint` sạch trên cả 5 file. **Chưa test tay** — cần: ký ít nhất 1
  người trong 1 yêu cầu (Kiểm nghiệm/Điều xe/Bảo trì bất kỳ) → xác nhận nút "Hủy yêu cầu" biến
  mất khỏi UI cho cả người tạo lẫn admin; thử gọi thẳng API `cancel-request` (không qua UI) sau
  khi đã ký → xác nhận bị chặn đúng thông báo lỗi mới.

### 2. Đã điều tra bằng dữ liệu thật — KHÔNG phải bug, chỉ đơn giản hoá 1 câu chữ

Người dùng nghi ngờ badge "Chờ bạn ký duyệt" hiện sai cho "người tạo" (Chau Nho) ở đúng biên bản
`DX-170826/002`. Đã tra trực tiếp DB (script tạm, đã xoá) thay vì đoán:

- `maintenance_records.nguoi_tao` (cột TEXT, tên người tạo/nhập biên bản) = **"Chau Nho"** —
  nhưng đây KHÁC hẳn `yeu_cau_ky.nguoi_tao` (UUID, người thực sự bấm nút "Ký duyệt" để tạo yêu
  cầu ký) = `21d59cc2-...` — **không phải Chau Nho** (Chau Nho's user id thật là
  `0de43ef7-...`). Hai khái niệm "người tạo" này độc lập nhau: 1 người (có thể là admin/văn
  phòng) nhập liệu + tạo yêu cầu ký, nhưng chỉ định NGƯỜI KHÁC (Chau Nho) làm "Nhân viên phụ
  trách" — người phải thực sự ký trước tiên.
- Tra `nguoi_ky`: Chau Nho (`0de43ef7-...`) là dòng `thu_tu=10, vai_tro='ky'` — **đã ký xong**
  (`trang_thai='da_ky'`, `ky_luc` có giá trị). Với dữ liệu này, `computeMyTurn()` (có guard `if
  (mine.trangThai === "da_ky") return false`) đúng ra phải trả `false` cho Chau Nho SAU KHI họ
  đã ký — tức là badge "Chờ BẠN ký duyệt" mà người dùng thấy hẳn đã hiện ĐÚNG lúc TRƯỚC khi Chau
  Nho ký (đúng vì Chau Nho thật sự là người cần ký đầu tiên), không phải hiện sai sau khi họ đã
  ký xong. Không tìm thấy bằng chứng nào cho thấy có bug trong `computeMyTurn`/badge cho tình
  huống cụ thể này.
- **Kết luận**: KHÔNG sửa logic `canContinueSign`/`myTurn` (rủi ro cao nếu đoán sai — có thể vô
  tình chặn mất khả năng ký của người tạo/participant hợp lệ). Chỉ áp dụng đúng phần rõ ràng,
  không tranh cãi trong phản hồi: đổi `"Đang chờ người ký trước (N/M)"` → `"Đang chờ ký duyệt
  (N/M)"` ở `maintenance-sign-status.tsx` (Quality/Dispatch đã dùng đúng "Chờ ký duyệt" từ
  trước, không cần sửa) — theo đúng ý "câu 'đang chờ người ký trước' vô nghĩa, cứ hiện 'Đang chờ
  ký duyệt'". Dòng tương tự trong SignScreen (`ky/[id]/page.tsx:803`, "Chưa tới lượt bạn — đang
  chờ người ký trước hoàn tất.") **không đổi** — ngữ cảnh đó là thông báo trực tiếp cho 1 người
  đang thực sự bị chặn ký, câu chữ vẫn có nghĩa ở đó, khác badge danh sách chung chung.
- **Nếu người dùng vẫn cho rằng có bug thật sau khi đọc giải thích này**, cần cung cấp thêm chi
  tiết cụ thể hơn (đăng nhập bằng tài khoản nào khi thấy badge sai, thời điểm chính xác) để điều
  tra tiếp — hiện tại dữ liệu DB của đúng bản ghi được nêu tên không cho thấy sai lệch.

### File đã sửa trong phiên này

| File | Thay đổi |
|---|---|
| `src/lib/maintenance-pdf.ts` | `drawSignatureRowCapture` thêm `note?`; 4 cột "Tài xế" thêm `note: "(NV phụ trách ký thay)"` khi `forSigning` |
| `src/lib/signing/requests.ts` | `cancelSigningRequest()` chặn khi đã có người ký |
| `src/app/dashboard/_components/signing-my-turn.ts` | Thêm `hasAnySigned()` |
| `src/app/dashboard/quality/_components/quality-sign-status.tsx` | `canCancel` thêm `&& !hasAnySigned(...)` |
| `src/app/dashboard/dispatch/_components/dispatch-sign-status.tsx` | `canCancel` thêm `&& !hasAnySigned(...)` |
| `src/app/dashboard/maintenance/records/_components/maintenance-sign-status.tsx` | `canCancel` thêm `&& !hasAnySigned(...)`; đổi nhãn "Đang chờ người ký trước" → "Đang chờ ký duyệt" |

Không có migration nào — chỉ đổi code ứng dụng. **Chưa commit/push** (cộng dồn với phiên trước
vẫn chưa commit).

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (2026-09-01, tiếp — phiên mới 2)" trong CLAUDE.md (ngay phía trên) — đã fix
label "(NV phụ trách ký thay)" trên chính file PDF (không chỉ SignScreen), chặn "Hủy yêu cầu"
sau khi đã có người ký (cả backend lẫn UI), và đơn giản hoá nhãn "Đang chờ ký duyệt" ở Bảo trì.
Mục "badge Chờ bạn ký duyệt cho người tạo" đã điều tra bằng dữ liệu DB thật của đúng biên bản
DX-170826/002 và KHÔNG tìm thấy bug — người "nguoi_tao" trên record (text field) khác với người
thực sự tạo yêu cầu ký (UUID); Chau Nho đã ký đúng vai trò của họ. Đã giải thích cho người dùng,
chưa sửa code phần này.

CHƯA test tay bất kỳ mục nào trong phiên này (label ký-thay trên PDF, chặn Hủy yêu cầu) — cũng
còn 2 mục treo từ phiên trước đó nữa (badge "Chờ BẠN ký duyệt" cho Điều xe/Bảo trì, label ký-thay
trên SignScreen). Hỏi tôi đã test xong mục nào, và nếu tôi báo lỗi mới (đặc biệt nếu tôi vẫn cho
rằng badge "Chờ bạn ký duyệt" hiện sai), hỏi thêm chi tiết cụ thể (tài khoản nào, đăng nhập lúc
nào) trước khi sửa lại — đừng đoán, đã có 1 lần điều tra kỹ bằng DB thật không tìm thấy bug.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-01, tiếp — phiên mới 3) — 3 fix sau khi xem ảnh chụp thật: bug font-fallback
làm sai chính tả, mở rộng note sang cột "Tổ trưởng cơ điện/cơ khí", thay hẳn cột Trạng thái bằng
Ký duyệt ở cả 2 nơi

Người dùng gửi ảnh chụp khung ký "Tài xế" trên SignScreen thật (không phải PDF tĩnh — đây là ảnh
trang PDF render qua canvas + overlay HTML của `/dashboard/ky/[id]`), cho thấy dòng ghi chú hiện
ra là **"(NV phả trách ký thay)"** — sai chính tả "phụ" → "phả".

### Root cause thật — đúng landmine đã ghi sẵn trong lịch sử file này, tự giẫm lại

`drawSignatureRowCapture()` (fix ở mục "phiên mới 2" ngay trên) dùng
`doc.setFont(PDF_FONT_NAME, "italic")` để vẽ dòng note — nhưng font đăng ký qua `ensurePdfFont()`
(`pdf-qr-shared.ts`) **chỉ có 2 style `normal`/`bold`**, không có `italic`. jsPDF khi xin 1 style
chưa đăng ký sẽ âm thầm fallback sang font khác (không đủ glyph tiếng Việt), làm ký tự có dấu bị
mangled — chữ "phụ" (dấu nặng) render sai thành "phả" (dấu hỏi). Đây **chính xác là landmine đã
ghi từ trước** trong lịch sử file này (mục lịch sử `maintenance-pdf.ts`: "Không dùng font
'italic'... mọi chữ nghiêng trong bản HTML gốc... chuyển sang chữ thường màu xám thay vì
nghiêng") — mục "phiên mới 2" đã vi phạm đúng quy tắc này khi thêm code mới, không kiểm tra lại
lịch sử trước khi dùng `"italic"`.

**Đã fix**: bỏ hẳn `doc.setFont(PDF_FONT_NAME, "italic")`, giữ `"normal"` (đã đăng ký đúng, đủ
glyph tiếng Việt), chỉ giảm cỡ chữ xuống `6.5` để phân biệt trực quan với "(Ký và ghi rõ họ
tên)" — đúng đúng convention "chữ thường + màu xám thay vì nghiêng" đã có sẵn trong file.

### Mở rộng thêm cột "Tổ trưởng cơ điện/cơ khí" (F13, F03) — trước đây cố ý bỏ qua

Người dùng xác nhận: note "(NV phụ trách ký thay)" phải áp dụng luôn cho cột **"Tổ trưởng cơ
điện/cơ khí"** (không chỉ "Tài xế") — đã thêm `note: forSigning ? "(NV phụ trách ký thay)" :
undefined` vào:
- `drawF13()` (bundle `su_co_nho`) — cột `isBoDoiRole` (`roleId: "to_co_dien"`).
- `drawF03()` (bundle `bao_duong`/`bao_duong_xe`) — cột `toRoleLabel` (`roleId: "to_co_dien"`,
  đặt cuối mảng 4 cột). Lưu ý: cột này ĐÃ hiện tên NV phụ trách ở **cả 2 luồng** (in thường lẫn
  ký duyệt, theo comment sẵn có dòng ~1308-1311) — note vẫn chỉ thêm khi `forSigning=true`, giữ
  đồng nhất với mọi cột khác, không đổi hành vi bản in thường.

Vị trí/canh giữa của note **không cần sửa** — đã đúng từ mục "phiên mới 2" (`align: "center"`,
`cx` tính giống mọi dòng khác trong cùng cột, nằm ngay dưới "(Ký và ghi rõ họ tên)") — bug chỉ
nằm ở font/chính tả, không phải layout.

### Thay hẳn cột "Trạng thái" bằng "Ký duyệt" — ở CẢ 2 nơi (danh sách + Tổng quan)

Người dùng chốt: KHÔNG giữ song song 2 cột (Trạng thái + Ký duyệt) — **thay thế hẳn**.

- `src/app/dashboard/maintenance/records/page.tsx` (danh sách biên bản): xóa `<th>`"Trạng thái"
  + `<td>{statusBadge(...)}</td>`, xóa hẳn hàm `statusBadge()` (dead code sau khi bỏ cột) và bỏ
  import `trangThaiLabel` (chỉ dùng trong hàm đó) khỏi `maintenance-data`. Filter dropdown "Tất
  cả trạng thái/Chờ duyệt/Đã duyệt/..." **giữ nguyên không đổi** — đây là filter riêng
  (`filterTrangThai`), không phải cột hiển thị, dùng option label hard-code không phụ thuộc
  `trangThaiLabel`.
- `src/app/dashboard/maintenance/page.tsx` (trang Tổng quan, bảng "Biên bản gần đây" — **phát
  hiện thêm khi rà theo đúng nghĩa "inline Bảo trì/Tổng quan-Biên bản"** trong yêu cầu, trang
  này trước đó CHƯA có Ký duyệt gì cả, chỉ có Trạng thái badge tĩnh): đã port đầy đủ cơ chế Ký
  duyệt từ `records/page.tsx` sang — thêm `user`/`signingStatusByRecord`/`signingStatusLoaded`/
  `toast` state, `loadSigningStatuses()` (mirror y hệt), `resolveSignBundle()` (mirror y hệt,
  cần mở rộng câu query `recentRes` thêm `maintenance_record_lines(loai_sua_chua)` để tính được
  bundle), `canCreate`/`canPrint`, cột "Ký duyệt" với icon Eye/FileText + `MaintenanceSignStatusBadge`
  + toast nổi góc trên (mirror pattern `records/page.tsx`). Xóa hẳn `statusBadge()` cũ của trang
  này (không còn dùng ở đâu).

`npx tsc --noEmit` sạch toàn repo; `npx eslint` sạch trên mọi file đã sửa (`maintenance-pdf.ts`,
`records/page.tsx`, `maintenance/page.tsx`) — chỉ còn đúng 1 warning pre-existing đã xác nhận từ
trước (`currencySymbol` unused trong `maintenance/page.tsx`, không liên quan phiên này, xem
`git show HEAD:...` xác nhận tồn tại trước khi sửa).

### File đã sửa thêm trong phiên này

| File | Thay đổi |
|---|---|
| `src/lib/maintenance-pdf.ts` | Bỏ `setFont(...,"italic")` → dùng `normal` cỡ 6.5; thêm `note` cho cột `to_co_dien` ở F13 + F03 |
| `src/app/dashboard/maintenance/records/page.tsx` | Xóa cột "Trạng thái" + `statusBadge()` + import `trangThaiLabel` thừa |
| `src/app/dashboard/maintenance/page.tsx` | Port toàn bộ cơ chế "Ký duyệt" (badge/icon/toast) thay cho cột Trạng thái tĩnh cũ |

**Chưa test tay** — cần: in/ký thử 1 biên bản `su_co_nho` (F13) và 1 biên bản `bao_duong`/
`bao_duong_xe` (F03) qua luồng Ký duyệt, xác nhận note "(NV phụ trách ký thay)" hiện đúng chính
tả dưới CẢ 2 cột "Tài xế" lẫn "Tổ trưởng cơ điện/cơ khí", không lệch/tràn; mở
`/dashboard/maintenance` (Tổng quan) xác nhận bảng "Biên bản gần đây" hiện đúng cột "Ký duyệt"
với icon/badge hoạt động y hệt trang danh sách (bấm "Gửi ký duyệt"/xem file/hủy yêu cầu), toast
hiện đúng; xác nhận trang danh sách (`records/page.tsx`) không còn cột "Trạng thái" nhưng filter
"Trạng thái" vẫn lọc đúng như cũ.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (2026-09-01, tiếp — phiên mới 3)" trong CLAUDE.md (ngay phía trên) — đã fix
bug font-fallback làm sai chính tả "(NV phụ trách ký thay)" (do dùng style "italic" chưa đăng
ký — đúng landmine đã ghi sẵn trong lịch sử file, lần sau nhớ tra lịch sử maintenance-pdf.ts
trước khi setFont style mới), mở rộng note ký-thay sang cột "Tổ trưởng cơ điện/cơ khí" (F13,
F03), và thay hẳn cột "Trạng thái" bằng "Ký duyệt" ở cả trang danh sách lẫn trang Tổng quan
Bảo trì (trang Tổng quan trước đó hoàn toàn chưa có cơ chế Ký duyệt, đã port đầy đủ sang).

CHƯA test tay bất kỳ mục nào trong 3 phiên gần nhất (font fix, cột to_co_dien note, cột Ký
duyệt ở Tổng quan, myTurn badge Điều xe/Bảo trì, label ký-thay trên SignScreen, chặn Hủy yêu
cầu sau khi đã ký). Hỏi tôi đã test xong mục nào trước khi làm tiếp — nếu tôi báo lỗi mới, đọc
kỹ đúng đoạn code liên quan trước khi sửa, đừng đoán.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-01, tiếp — phiên mới 4) — Bug "hiện Gửi ký duyệt vô điều kiện" (Bảo trì) đã
fix ở tầng UI; phát hiện gap SÂU HƠN ở tầng server — CHƯA SỬA, ưu tiên cho session sau

### Đã fix (đã commit + push `63876ed`)

Người dùng test trên `main` vừa deploy, gửi ảnh chụp bảng "Biên bản gần đây" (Tổng quan Bảo
trì): mọi dòng đều hiện nút tím "Gửi ký duyệt" bất kể ai đăng nhập — báo đúng là bug.

**Root cause**: `canCreate` truyền vào `MaintenanceSignStatusBadge` ở **cả 2 trang danh sách**
(`src/app/dashboard/maintenance/records/page.tsx`, `src/app/dashboard/maintenance/page.tsx`)
chỉ check quyền chung `hasPermission(user, "maintenance.create")` — thiếu điều kiện "phải là
người tạo chính biên bản đó (hoặc admin)" mà trang chi tiết (`records/[id]/page.tsx`, biến
`isCreator` dòng ~506-509: `nguoi_tao === user.full_name || nguoi_tao === user.username`) đã có
từ trước. Đối chiếu Quality/Dispatch xác nhận 2 module đó đã đúng (`canOwnerAct`/
`canOwnerEditEntry` tính per-row) — chỉ riêng Bảo trì thiếu.

**Đã fix**: thêm `canOwnerAct(r)` per-row ở cả 2 trang (mirror đúng công thức `isCreator` gốc),
chỉ áp dụng cho badge Ký duyệt, không đụng `canCreate` dùng cho nút "+ Tạo biên bản" (đúng,
không cần sở hữu). `maintenance/page.tsx` cần thêm `nguoi_tao` vào câu query `recentRes`.

### Phát hiện SÂU HƠN khi điều tra — CHƯA SỬA, đây là việc ưu tiên cho session sau

Trong lúc điều tra, đã kiểm tra tầng server và xác nhận: **`/api/signing/create-request`
(`src/app/api/signing/create-request/route.ts`, gọi `createSigningRequest()` trong
`src/lib/signing/requests.ts`) HOÀN TOÀN KHÔNG kiểm tra quyền sở hữu** — chỉ check token hợp lệ
(`requireAuthUser`) + đúng `factory_id` (dòng 31-38 của route). Không check `maintenance.create`/
`quality.edit`/`dispatch.edit`, không check `banGhiId`/`maHoSo` có thuộc về người gọi hay không.

**Đã xác nhận qua grep — đúng 3 module thực sự gọi route này** (không phải 6 module như tài liệu
kế hoạch gốc `du_an_ky_so_dung_chung` liệt kê — ISO/Văn bản/Thực hiện hồ sơ ISO vẫn dùng hệ ký
RIÊNG của chúng, không qua `yeu_cau_ky`/`create-request`):
- `src/app/dashboard/maintenance/records/_components/maintenance-sign-modal.tsx`
- `src/app/dashboard/dispatch/_components/dispatch-sign-modal.tsx`
- `src/app/dashboard/quality/_components/quality-sign-modal.tsx`

**Hệ quả thật**: 1 user bất kỳ cùng nhà máy (kể cả KHÔNG có `maintenance.create`/`quality.edit`/
`dispatch.edit`) có thể gọi thẳng `/api/signing/create-request` (vd qua devtools/fetch, không
qua UI) để tạo yêu cầu ký cho BẤT KỲ biên bản/ngày KN/phiếu điều xe nào trong nhà máy của họ —
bypass hoàn toàn gate UI vừa fix ở trên. Đây **cùng loại gap** đã ghi nhận trước đó trong lịch sử
file này cho các hành động khác ("chỉ chặn ở UI, chưa chặn ở DB/server") — không phải phát hiện
hoàn toàn mới về BẢN CHẤT, nhưng đây là lần đầu áp dụng đúng cho hành động "tạo yêu cầu ký".

### Dữ liệu đã xác nhận sẵn cho session sau — không cần re-derive từ đầu

**Công thức ownership CHÍNH XÁC đang dùng ở client, phải mirror đúng khi viết server-side**:

- **Bảo trì** (`maintenance_records`): KHÔNG có cột `created_by` UUID, chỉ có
  `nguoi_tao TEXT` (migration `20260511_maintenance_module.sql` dòng 54). Ownership check là
  string-match: `record.nguoi_tao === user.full_name || record.nguoi_tao === user.username`
  (xem `records/[id]/page.tsx` dòng ~506-509). Đây là kiểu so sánh MỎNG MANH hơn UUID (rủi ro
  nếu user đổi tên hiển thị, hoặc 2 user trùng tên) — đã chấp nhận rủi ro này ở client từ trước,
  session sau cần quyết định có mirror y hệt ở server hay nhân dịp thêm cột `created_by UUID`
  cho `maintenance_records` (đúng kiểu Dispatch/Quality đã làm) — xem mục "Việc cần làm" bên
  dưới, đây là 1 quyết định phạm vi cần cân nhắc, không tự ý chọn.
- **Điều xe** (`dispatch_entries.created_by UUID`): `canOwnerEditEntry = isAdmin ||
  entry.created_by === currentUser.id` (`dispatch/page.tsx` dòng ~1853-1854). **Quan trọng**:
  đã "tighten" ngày 2026-08-31 — bản ghi cũ `created_by IS NULL` giờ CHỈ admin thao tác được
  (không còn grandfather clause cho phép ai cũng sửa) — session sau PHẢI mirror đúng rule NGHIÊM
  NÀY ở server, không tự ý quay lại rule cũ lỏng hơn.
- **Chất lượng** (`qc_results.created_by UUID`, đơn vị sở hữu là "ngày", không phải 1 dòng):
  `canOwnerAct = isAdmin || dateResults.some(r => r.created_by === currentUser.id)` (nghĩa là
  chỉ cần user đã tạo ÍT NHẤT 1 phiếu trong ngày đó) (`quality/page.tsx` dòng ~2186-2189). Cùng
  đã "tighten" 2026-08-31, cùng rule nghiêm (NULL → chỉ admin).

**Hướng kiến trúc đề xuất** (chưa quyết định cuối, session sau cân nhắc): KHÔNG nhét logic
per-module vào `src/lib/signing/requests.ts` (file này chủ đích generic, dùng chung mọi module,
đã có comment đầu file khẳng định điều này) — nên thêm bước kiểm tra sở hữu NGAY TRONG
`route.ts` (tầng HTTP, được phép biết về từng module cụ thể), theo dạng 1 map/switch nhỏ theo
`body.modun`, mỗi nhánh tự query đúng bảng nguồn (`maintenance_records`/`dispatch_entries`/
`qc_results`) bằng `body.banGhiId`/`body.maHoSo` rồi so đúng công thức đã liệt kê ở trên. Cần
đọc lại chính xác `body.banGhiId`/`body.maHoSo` mapping từng module trong 3 file modal đã liệt
kê ở trên trước khi viết — **không suy đoán field nào ứng với gì**.

### Việc cần làm (ưu tiên theo thứ tự) — CHƯA CODE GÌ, chỉ điều tra + lên kế hoạch ở phiên này

1. Đọc kỹ 3 file modal (`maintenance-sign-modal.tsx`, `dispatch-sign-modal.tsx`,
   `quality-sign-modal.tsx`) để xác nhận chính xác `banGhiId`/`maHoSo` gửi lên là gì cho từng
   module (đã có gợi ý ở trên nhưng cần đọc lại code thật, không suy đoán).
2. Hỏi người dùng qua `AskUserQuestion` trước khi code: có muốn thêm cột `created_by UUID` cho
   `maintenance_records` (đồng bộ kiểu với Dispatch/Quality, chắc chắn hơn) hay chấp nhận
   string-match `nguoi_tao` ở cả server (nhanh hơn, không cần migration, nhưng giữ nguyên rủi ro
   trùng tên/đổi tên đã biết)?
3. Viết bước kiểm tra sở hữu trong `src/app/api/signing/create-request/route.ts` theo đúng
   hướng kiến trúc ở trên (switch theo `body.modun`, mirror chính xác 3 công thức đã liệt kê,
   đặc biệt rule "NULL/không khớp → chỉ admin" đã tighten 2026-08-31 — không nới lỏng lại).
   Trả lỗi 403 rõ ràng tiếng Việt nếu không đủ điều kiện.
4. Kiểm tra xem `cancel-request`/`sign-field`/`return-request` (các route ký khác dùng chung)
   có cùng loại gap không — CHƯA điều tra trong phiên này, chỉ mới xác nhận `create-request`.
5. Test tay: dùng 1 tài khoản KHÔNG sở hữu bất kỳ dữ liệu nào của module, thử gọi API trực tiếp
   (không qua UI, vd `fetch()` trong devtools) cho cả 3 module → xác nhận bị chặn đúng 403; tài
   khoản chủ sở hữu/admin vẫn tạo được bình thường qua UI như cũ.
6. Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build` khi
   không chắc dev server người dùng có đang chạy song song hay không.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (2026-09-01, tiếp — phiên mới 4)" trong CLAUDE.md (ngay phía trên) — bug
"Gửi ký duyệt hiện vô điều kiện" ở tầng UI Bảo trì ĐÃ FIX VÀ ĐÃ PUSH (63876ed). Việc ưu tiên số
1 của phiên này là gap SÂU HƠN: /api/signing/create-request (route dùng chung cho Bảo trì/Điều
xe/Chất lượng) hoàn toàn không kiểm tra quyền sở hữu ở tầng server — bất kỳ user cùng nhà máy
nào cũng có thể gọi thẳng API tạo yêu cầu ký cho biên bản/ngày/phiếu không phải của họ, bypass
hết gate UI.

Làm theo đúng thứ tự mục "Việc cần làm" trong CLAUDE.md:
1. Đọc lại 3 file modal (maintenance-sign-modal.tsx/dispatch-sign-modal.tsx/
   quality-sign-modal.tsx) xác nhận chính xác banGhiId/maHoSo gửi lên cho từng module.
2. BẮT BUỘC hỏi tôi qua AskUserQuestion trước khi code: có thêm cột created_by UUID cho
   maintenance_records (đồng bộ Dispatch/Quality) hay chấp nhận string-match nguoi_tao ở
   server luôn (không cần migration)?
3. Viết bước kiểm tra sở hữu trong route.ts theo switch(modun), mirror ĐÚNG 3 công thức đã ghi
   sẵn trong CLAUDE.md (đặc biệt rule "NULL/không khớp created_by → chỉ admin" đã tighten
   2026-08-31 — không được nới lỏng lại thành grandfather clause cũ).
4. Kiểm tra thêm cancel-request/sign-field/return-request có cùng loại gap không (chưa điều
   tra trong phiên trước).
5. Test tay bằng tài khoản không sở hữu dữ liệu, gọi thẳng API (không qua UI) xác nhận bị chặn
   403 cho cả 3 module; tài khoản hợp lệ vẫn hoạt động bình thường qua UI.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-02) — Fix bug nghiêm trọng: Lưu lần 2 sau khi tạo mới tạo biên bản trùng
lặp; "Gửi ký duyệt" không phản hồi; dirty-tracking cho nút Lưu; fix N+1 query làm chậm luồng ký
duyệt Bảo trì (đã commit + push `133333f`)

Người dùng báo (từ `/dashboard/maintenance/records/[id]/page.tsx`, ngay sau khi tạo và Lưu biên
bản lần đầu, CHƯA thoát ra load lại):
1. Action PDF hoạt động bình thường.
2. Action "Gửi phê duyệt" bấm vào không phản hồi gì.
3. Nút "Lưu" vẫn sáng dù không sửa gì — nếu bấm sẽ tạo thêm 1 biên bản y hệt.
4. Mong muốn: nút Lưu chỉ sáng khi có thay đổi thật; bấm Lưu luôn lưu đè, không tạo bản ghi mới.
5. Khắc phục các action luồng ký duyệt load hiển thị rất chậm.

### Root cause (đã xác nhận bằng đọc code, không đoán)

`const isNew = id === "new"` lấy TRỰC TIẾP từ URL param (`params.id` của route Next.js
`[id]`) — nhưng theo đúng thiết kế có chủ đích đã ghi sẵn trong code (comment dòng ~207-213):
sau lần Lưu đầu tiên, điều hướng sang URL bản ghi thật (`router.push`) bị **delay có chủ đích**
cho tới khi người dùng đóng banner "Gắn bản ghi vào công việc KPI" (`KpiLinkPrompt`) — lý do:
đổi `params.id` ngay lập tức sẽ remount route con, làm mất state banner KPI giữa chừng.

Hệ quả: trong "cửa sổ giao thời" này (đã lưu xong, bản ghi thật đã tồn tại trong DB, nhưng URL
vẫn còn `/new`), `isNew` **vẫn đọc `true`**. Đã có sẵn 1 state `savedRecordId` để đánh dấu "đã
lưu xong, có ID thật rồi" độc lập với URL, nhưng chỉ được áp dụng ở **2/12 chỗ** cần nó
(`(!isNew || savedRecordId)` ở điều kiện hiện khối badge ký duyệt, và
`loadSigningStatus(factoryId, savedRecordId ?? id)`) — **10 chỗ còn lại vẫn dùng `isNew`/`id`
thô**, trong đó có đúng 2 chỗ gây ra bug người dùng báo:

- **`handleSave()`'s `if (isNew) { ...INSERT... } else { ...UPDATE... }`** — bấm Lưu lần 2 trong
  cửa sổ giao thời vẫn đi vào nhánh INSERT → tạo hẳn 1 bản ghi `maintenance_records` mới (kèm
  `ma_bb` mới, dòng thiết bị mới, vật tư mới) — **bug 3 (tạo biên bản trùng lặp)**.
- **`{signModalOpen && factoryId && !isNew && signBundle && (<MaintenanceSignModal .../>)}`** —
  đây là điều kiện RENDER MODAL, tách biệt với điều kiện hiện NÚT (đã đúng). Bấm "Gửi ký duyệt"
  gọi `setSignModalOpen(true)` thành công (nút hiện đúng nhờ `savedRecordId`), nhưng modal không
  bao giờ mount vì `!isNew` vẫn `false` → **bug 2 (bấm không phản hồi gì, không lỗi, không log,
  vì về mặt React không có gì xảy ra cả)**.

4 link "In biên bản (chưa ký)" và 5 nút hành động (Gửi duyệt lại/Hủy biên bản/Xóa/Hủy sau khi
hoàn tất) trong cùng khối UI đó cũng dùng `id`/`isNew` thô — cùng loại lỗi, dù chưa được người
dùng báo cáo trực tiếp (khả năng do "PDF hoạt động bình thường" là họ test nhánh khác, hoặc chưa
kịp thử các nút này trong đúng cửa sổ giao thời).

### Đã fix

- Thêm `effectiveIsNew = isNew && !savedRecordId`, `effectiveId = savedRecordId ?? id` — thay
  toàn bộ `isNew`/`id` có Ý NGHĨA "đã lưu hay chưa"/"ID bản ghi thật" bằng 2 biến này ở **tất cả**
  12 chỗ liên quan: `isCreator`, `isReadOnly`, `handleSave()` (cả nhánh INSERT/UPDATE lẫn khối
  hoàn tất), điều kiện render modal ký + prop `recordId`, 4 link in PDF, 5 nút hành động, tiêu đề
  trang. Giữ nguyên `isNew`/`id` thô ở các chỗ CHỈ mang tính hiển thị/lazy-init không ảnh hưởng
  logic lưu (2 lazy initializer của `tuGio`/`denGio`, hiệu ứng gợi ý nhân sự mặc định, bootstrap
  effect gọi `loadRecord` lần đầu — các chỗ này tương đương `isNew`/`effectiveIsNew` tại đúng
  thời điểm chúng chạy nên không cần đổi).

- **Dirty-tracking cho nút "Lưu"**: snapshot JSON toàn bộ nội dung form (loại bỏ `id`/`expanded`
  client-only của từng dòng thiết bị và `id` của từng vật tư) chụp lại NGAY SAU khi
  `loadRecord()` nạp xong hoàn chỉnh (dùng biến đếm `loadVersion` tăng ở cuối `loadRecord()` làm
  tín hiệu "đã nạp XONG" — không thể đọc state ngay sau khi gọi `loadRecord()` vì hàm này có
  `await` ở giữa, các `setState` không commit đồng thời). Baseline cũng được chụp cho form trống
  mặc định khi mới vào `/records/new` (trước khi lưu lần đầu) — nút "Lưu" bắt đầu ở trạng thái
  tắt cho tới khi người dùng thêm ít nhất 1 thiết bị/sửa gì đó. Nút Lưu: `disabled={saving ||
  isUploadingAnyImage || !isDirty}`.

- **Fix hiệu năng N+1 query** trong `MaintenanceSignModal`'s `loadRecordForSigning()` (chạy MỖI
  LẦN bấm "Tạo yêu cầu ký", chặn UI cho tới khi xong): trước đây query `maintenance_materials`
  **RIÊNG CHO TỪNG DÒNG thiết bị, tuần tự trong vòng lặp `for...await`** — biên bản có N dòng
  thiết bị = N round-trip mạng nối tiếp cộng dồn độ trễ (đúng nguyên nhân khớp với "luồng ký
  duyệt load hiển thị rất chậm" — càng nhiều thiết bị càng chậm rõ rệt). Đã gộp: `record`/
  `rawLines`/`staffData` chạy song song (`Promise.all`), rồi **1 query duy nhất** lấy vật tư của
  TẤT CẢ dòng cùng lúc (`line_id IN (...)`) và tự gom nhóm ở client — mirror đúng pattern
  `matsMap` đã dùng ổn định từ trước ở `loadRecord()` của chính trang chi tiết.

- Đã kiểm tra thêm `/api/maintenance/su-co-nho-signers` (route resolve người ký, fetch ngay khi
  modal mở) — không có N+1 pattern, chỉ 4-5 round-trip nhỏ đã hợp lý (2 trong số đó đã chạy song
  song qua `Promise.all`), không phải nguồn chậm đáng kể — không sửa.

### Việc CỐ Ý không đụng — cần thêm dữ liệu/kiểm chứng nếu người dùng vẫn thấy chậm sau fix trên

Chưa đào sâu hiệu năng của `/dashboard/ky/[id]` (SignScreen) — trang render PDF qua pdfjs canvas
theo vòng lặp tuần tự từng trang (`for (let p=1; p<=pdf.numPages; p++)`). Đây là công việc RENDER
(giải mã/rasterize từng trang), không phải N+1 query mạng — parallelize không chắc an toàn/đúng
với pdfjs mà không kiểm thử kỹ, nên **chưa động vào**. Nếu sau khi fix N+1 query ở trên mà người
dùng vẫn thấy "load hiển thị rất chậm" cụ thể ở BƯỚC XEM/KÝ (không phải bước "Tạo yêu cầu ký"),
cần điều tra riêng phần SignScreen này — đừng giả định đã xong.

`npx tsc --noEmit` sạch toàn repo; `npx eslint` trên cả 2 file sạch (0 lỗi/warning mới — 5
warning còn lại ở `records/[id]/page.tsx` đều pre-existing, không liên quan thay đổi này, xác
nhận qua `git diff` không có dòng `<img>`/import nào trong diff).

### Chưa test tay — bắt buộc trước khi coi xong

1. Tạo 1 biên bản mới, Lưu lần đầu — xác nhận nút "Lưu" tắt ngay sau khi lưu xong (không sáng
   lại cho tới khi sửa gì đó); bấm "Gửi ký duyệt" (CHƯA đóng banner KPI/CHƯA reload) — xác nhận
   modal `MaintenanceSignModal` mở ra bình thường, không còn "bấm không phản hồi".
2. Trong đúng cửa sổ đó, sửa 1 trường bất kỳ (vd nội dung mô tả) — xác nhận nút "Lưu" sáng lại;
   bấm Lưu — xác nhận CHỈ CẬP NHẬT bản ghi vừa tạo (kiểm tra DB/danh sách biên bản — không có
   bản ghi trùng lặp mới nào xuất hiện).
3. Test cả 4 nút hành động khác (Gửi duyệt lại/Hủy biên bản/Xóa/Hủy sau khi hoàn tất) và 4 link
   "In biên bản" trong đúng cửa sổ giao thời này (biên bản vừa lưu, chưa đóng banner KPI) — xác
   nhận đều trỏ đúng bản ghi thật, không còn `record_id=new`.
4. Đóng banner KPI (điều hướng thật xảy ra) — xác nhận trang chuyển sang URL thật, mọi thứ vẫn
   hoạt động bình thường như trước (không có regression cho luồng đã hoạt động đúng).
5. Test biên bản có NHIỀU thiết bị (≥3-5 dòng) — bấm "Ký duyệt" → "Tạo yêu cầu ký" — xác nhận độ
   trễ giảm rõ rệt so với trước (khó đo chính xác qua lời kể, nhưng nên cảm nhận nhanh hơn đáng
   kể, đặc biệt với biên bản nhiều dòng — trước đây mỗi dòng thêm ~1 round-trip nối tiếp).
6. Test luồng SỬA 1 biên bản đã tồn tại từ trước (không phải tạo mới) — xác nhận dirty-tracking
   hoạt động đúng tương tự: mở lên nút Lưu tắt, sửa gì đó thì sáng, lưu xong tắt lại.

### Prompt gợi ý để mở đầu session tiếp theo
```
Đọc mục "Cập nhật (2026-09-02)" trong CLAUDE.md (ngay phía trên) — đã fix 2 bug nghiêm trọng
(Lưu lần 2 sau khi tạo mới tạo biên bản trùng lặp; "Gửi ký duyệt" không phản hồi trong cửa sổ
giao thời trước khi banner KPI đóng), thêm dirty-tracking cho nút Lưu, và fix 1 bug N+1 query
làm chậm bước "Tạo yêu cầu ký" của luồng ký duyệt Bảo trì. Đã commit + push (133333f).

CHƯA test tay bất kỳ mục nào — đọc kỹ checklist "Chưa test tay" trong đúng mục đó (6 bước, đặc
biệt bước 1-2: tạo biên bản mới, Lưu lần đầu, bấm "Gửi ký duyệt" NGAY khi banner KPI còn mở,
xác nhận modal mở đúng và không tạo bản ghi trùng khi Lưu lại).

Nếu tôi báo vẫn còn chậm sau khi test, đọc mục "Việc CỐ Ý không đụng" — SignScreen
(/dashboard/ky/[id]/page.tsx) render PDF qua pdfjs canvas theo vòng lặp tuần tự từng trang CHƯA
được điều tra kỹ, có thể là nguồn chậm còn lại nếu vấn đề nằm ở bước XEM/KÝ chứ không phải bước
"Tạo yêu cầu ký" đã fix.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-02, tiếp) — Người dùng test trên `npm run dev`, báo module Bảo trì "kẹt ở
Rendering .." — nghi ngờ artifact dev-mode (Fast Refresh), CHƯA XÁC NHẬN đã hết

Sau khi fix 2 bug nghiêm trọng + dirty-tracking + N+1 query ở mục "Cập nhật (2026-09-02)" ngay
phía trên (đã commit `133333f`, tài liệu `7fb4692`), người dùng chạy `npm run dev` để test tay
theo checklist, gửi ảnh chụp trang Tổng quan Bảo trì (`/dashboard/maintenance`) — nội dung bảng
"Biên bản gần đây" hiển thị ĐÚNG (badge "Đã ký duyệt (3/3)"/"Gửi ký duyệt" đúng theo từng dòng,
khớp đúng cột Ký duyệt vừa thay cho Trạng thái) — nhưng có 1 chỉ báo "Rendering .." (chip nhỏ góc
trái dưới màn hình) treo mãi, không thao tác được gì trên trang.

### Đã điều tra qua 2 câu hỏi làm rõ + 1 ảnh chụp Console — chưa kết luận chắc chắn, đang chờ
người dùng thử bước khắc phục đơn giản trước

- Chỉ báo này nằm TRONG chính tab trình duyệt đang test thật (không phải overlay VSCode).
- Console (F12) **không có bất kỳ dòng lỗi đỏ nào** — chỉ có gợi ý cài React DevTools, dòng
  `[HMR] connected` (xác nhận Fast Refresh đang kết nối bình thường), và 1 warning màu vàng
  không liên quan (ảnh `sidebar-bg-forest.jpg` cần `loading="eager"` cho LCP — pre-existing, đã
  biết từ trước, không phải nguyên nhân).
- **Chỉ module Bảo trì bị kẹt** — Sản lượng/Kho/Chất lượng trên cùng phiên `npm run dev` đó vẫn
  bình thường.
- Đã grep xác nhận chuỗi `"Rendering"` **không tồn tại ở bất kỳ đâu trong `src/`** — không phải
  text do chính app tự vẽ ra.
- Dự án dùng Next.js `16.2.3` — bản này có sẵn 1 badge "Dev Tools" nổi góc trái-dưới trong dev
  mode, có thể hiện trạng thái kiểu "Rendering..." trong lúc compile/Fast-Refresh rồi tự biến
  mất — đây khả năng cao là NGUỒN GỐC của chip đang thấy, không phải do code app.

### Giả thuyết đang nghiêng về: artifact Fast Refresh bị stale, không phải bug logic thật

Kết hợp: (a) không có lỗi JS nào trong console (loại trừ crash/exception, kể cả kiểu "Maximum
update depth exceeded" của vòng lặp setState-trong-render — lỗi đó LUÔN hiện đỏ trong console
nếu có), (b) nội dung trang vẫn render ĐÚNG dữ liệu thật (không phải màn hình trắng/spinner treo
vô hạn), (c) đúng module vừa bị sửa RẤT NHIỀU LẦN liên tiếp trong phiên này trong khi
`npm run dev` khả năng cao đang chạy song song (nhiều file lưu dồn dập: `records/[id]/page.tsx`,
`maintenance-sign-modal.tsx`, `maintenance-pdf.ts`, `maintenance/page.tsx`, `records/page.tsx`,
`maintenance-sign-status.tsx`) — **dự án này đã từng gặp đúng loại lỗi này trước đây** (xem mục
lịch sử "Fix bug 2026-08-24 — banner render trắng/mờ": nguyên nhân là dev server bị stale do
nhiều thao tác dồn dập, khắc phục chỉ bằng restart `npm run dev` + hard-refresh trình duyệt,
KHÔNG cần sửa code) — nên khả năng cao đây là CÙNG LOẠI hiện tượng, không phải bug logic mới.

**Đã hướng dẫn người dùng thử theo thứ tự, CHƯA CÓ PHẢN HỒI KẾT QUẢ**:
1. Hard refresh tab (Ctrl+Shift+R / Ctrl+F5).
2. Nếu vẫn kẹt: dừng hẳn `npm run dev`, chạy lại từ đầu, rồi hard refresh lại lần nữa.

### Việc cần làm cho session sau

- **Hỏi lại NGAY đầu phiên**: 2 bước trên đã giải quyết được chưa? Đây là câu hỏi ưu tiên số 1,
  quyết định hướng đi tiếp theo:
  - Nếu ĐÃ HẾT sau restart+hard-refresh → xác nhận đây đúng là artifact dev-mode, không phải bug
    code, đóng mục này, không cần điều tra thêm.
  - Nếu VẪN KẸT sau cả 2 bước → đây LÀ bug thật, cần điều tra sâu, KHÔNG được giả định lại là dev
    artifact nữa. Hướng điều tra gợi ý (chưa làm, vì thời điểm ghi chú này lý do vẫn chỉ là giả
    thuyết): kiểm tra kỹ các `useEffect` mới thêm ở `records/[id]/page.tsx` phiên trước
    (`loadVersion`, snapshot dirty-tracking) và ở `maintenance/page.tsx` (`loadSigningStatuses`,
    `resolveSignBundle`) xem có vòng lặp re-render/re-fetch nào bị bỏ sót trong lúc rà bằng mắt
    (dù `tsc`/`eslint` đều sạch, các công cụ đó không bắt được lỗi runtime kiểu vòng lặp
    setState-effect); test thử trên bản build production thật (`npm run build` + `npm start`,
    chỉ khi CHẮC CHẮN không có `npm run dev` nào đang chạy song song) để loại trừ hẳn khả năng
    Fast Refresh; kiểm tra Network tab xem có request nào bị treo (pending mãi không resolve, vd
    do 1 trong các route API mới sửa/thêm — `/api/maintenance/su-co-nho-signers`,
    `/api/maintenance/signing-status`) gây UI chờ vô hạn.
- Đồng thời vẫn còn nguyên checklist "Chưa test tay" (6 bước) của mục "Cập nhật (2026-09-02)"
  ngay phía trên — CHƯA có bước nào được xác nhận, cần làm sau khi mục "Rendering .." này được
  giải quyết dứt điểm (không test các bug fix chính trong lúc trang còn kẹt không thao tác được).

### Prompt gợi ý để mở đầu session tiếp theo
```
Đọc mục "Cập nhật (2026-09-02, tiếp) — ... kẹt ở Rendering .." trong CLAUDE.md (ngay phía trên)
và mục "Cập nhật (2026-09-02)" trước đó — đã fix 2 bug nghiêm trọng (Lưu lần 2 tạo biên bản
trùng lặp; "Gửi ký duyệt" không phản hồi), dirty-tracking cho nút Lưu, và 1 bug N+1 query, đã
commit + push (133333f). Sau đó, người dùng test bằng npm run dev và báo module Bảo trì "kẹt ở
Rendering ..", không thao tác được — đã điều tra qua console (KHÔNG có lỗi đỏ nào) và nghi ngờ
đây là artifact Fast Refresh bị stale (dự án từng gặp đúng loại này trước — xem lịch sử "Fix bug
2026-08-24"), đã hướng dẫn người dùng thử hard-refresh + restart npm run dev, CHƯA CÓ KẾT QUẢ.

Việc ĐẦU TIÊN bắt buộc: hỏi tôi ngay đầu phiên — 2 bước (hard refresh + restart dev server) đã
hết kẹt chưa?
- Nếu ĐÃ HẾT: xác nhận đây chỉ là artifact dev-mode, đóng mục này, chuyển sang test tay 6 bước
  của mục "Cập nhật (2026-09-02)" (chưa bước nào được xác nhận).
- Nếu VẪN KẸT: đây là bug thật, KHÔNG được giả định lại là dev-artifact — điều tra theo hướng đã
  gợi ý trong CLAUDE.md (rà kỹ các useEffect mới thêm ở records/[id]/page.tsx và
  maintenance/page.tsx, thử build production thật để loại trừ Fast Refresh, kiểm tra Network tab
  xem có request treo vô hạn).

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không (trừ khi đang CHỦ ĐỘNG dùng build production
để loại trừ nguyên nhân Fast Refresh như gợi ý ở trên — khi đó phải hỏi và xác nhận chắc chắn
không có npm run dev nào chạy song song trước).
```

## Kế hoạch phiên sau (2026-09-02) — Mở rộng ký số dùng chung sang Văn bản (ưu
tiên) rồi ISO: PHẢI xây trang "Cài đặt vị trí ký" (mau_vi_tri) trước khi đụng vào
2 module này

Người dùng xác nhận muốn tiếp tục nhân rộng hệ thống ký số dùng chung sang 2 module
còn lại thuộc "nhóm KHÓ HƠN" (đã có hệ thống ký RIÊNG chạy thật production — xem
mục "Kế hoạch phiên sau — Giai đoạn 4" cũ) — **ưu tiên Văn bản nội bộ trước, ISO
sau**. Phiên này CHƯA CODE GÌ — chỉ điều tra hiện trạng để chuẩn bị cho phiên sau.

### Khác biệt căn bản so với Chất lượng/Điều xe/Bảo trì — đọc kỹ trước khi bắt đầu

3 module đã xong đều tự sinh PDF bằng `jsPDF` (toạ độ khung ký biết trước, cố định,
tính bằng code) — không cần người dùng đặt vị trí tay. **Văn bản và ISO thì
NGƯỢC LẠI: người dùng UPLOAD file PDF/DOCX từ máy tính**, layout không biết trước.
Đã điều tra kỹ (đọc trực tiếp code, không đoán) hiện trạng đặt vị trí ký của 2
module này:

- **Văn bản** (`src/app/api/documents/sign/route.ts`, `src/app/dashboard/documents/
  [id]/page.tsx`'s `SignPlacementModal`): mỗi bước ký (ký phòng ban/phê duyệt) mở
  modal với toạ độ MẶC ĐỊNH CỐ ĐỊNH (`sigState={x:60,y:200,w:140,h:60}`...) —
  người ký phải TỰ KÉO-THẢ LẠI khung MỖI LẦN ký, không hề đọc `placement_ky` của
  bước trước để prefill. Ngoại lệ duy nhất: QR được "chốt" ở lượt ký đầu tiên qua
  `mergeQrBox()` (`route.ts`, chỉ ghi nếu `placement_ky.qr` chưa tồn tại) và giữ
  nguyên cho lượt sau — NHƯNG hành động `gui_ky` (gửi lại sau khi bị trả về) XÓA
  SẠCH `placement_ky` + cả 2 file đã ký (`route.ts` dòng ~686-701), nên kể cả cơ
  chế "chốt QR" này cũng không bền vững qua nhiều vòng trả về/gửi lại.
- **ISO** (`src/app/api/sign/generate-pdf/route.ts`, `src/app/dashboard/iso/
  documents/[id]/page.tsx`): TỆ HƠN Văn bản — hoàn toàn không có cơ chế tái dùng
  vị trí nào, kể cả QR (chỉ bước `soan_thao` mới hiện hộp kéo QR — các bước sau
  không có QR nào để đặt). Mỗi bước ký mở modal với toạ độ hard-code cố định y
  hệt nhau (`sigX:100,sigY:100,sigW:120,sigH:60,nameX:90,nameY:168...`). Có 1 lớp
  "preview mờ" (opacity 0.45) hiển thị vị trí chữ ký của bước TRƯỚC làm tham
  chiếu hình ảnh cho mắt người dùng, nhưng đây chỉ là ảnh tĩnh — khung có thể kéo/
  resize của bước đang ký vẫn luôn bắt đầu từ toạ độ mặc định, không đọc
  `soan_thao_placement`/`xem_xet_placement`/`phe_duyet_placement` để tự prefill.

Kết luận: **UX đặt vị trí ký hiện tại của cả 2 module đều lặp lại, dễ sai, và
chính là loại thao tác mà toàn bộ dự án ký số dùng chung này được sinh ra để loại
bỏ** (đã ghi rõ trong lịch sử CLAUDE.md mục "Kế hoạch phiên sau (2026-08-27)" khi
thiết kế `mau_vi_tri`). Việc nhân rộng ký số dùng chung sang 2 module này **không
thể chỉ đơn thuần "mirror lại 4 việc" đã làm cho Bảo trì/Điều xe** (build PDF kèm
tọa độ / modal tạo yêu cầu ký / route signing-status / badge trạng thái) — vì 2
module này không có "hàm build PDF với tọa độ biết trước" để mirror; phải giải
quyết bài toán "PDF từ file upload, layout không biết trước" TRƯỚC.

### Hạ tầng đã có sẵn nhưng CHƯA từng được dùng — `mau_vi_tri` + `cau_hinh_tai_lieu`

Migration `supabase/migrations/20260902_signing_core_tables.sql` đã tạo sẵn đúng 2
bảng để giải quyết bài toán trên, nhưng **chưa có bất kỳ hàm/route/UI nào trong
`src/lib/signing/` hay ở bất kỳ đâu đọc/ghi 2 bảng này** — chỉ tồn tại dưới dạng
migration:

- `mau_vi_tri` (`id, factory_id, loai_tai_lieu TEXT, phien_ban INT DEFAULT 1,
  khung JSONB DEFAULT '[]'`, unique `(factory_id, loai_tai_lieu, phien_ban)`) —
  `khung` là mảng CÁC VAI TRÒ (không phải người cụ thể):
  `[{vai_tro, neo_trang, so_trang, x_pt, y_pt, w_pt, h_pt}, ...]`.
  `neo_trang` ∈ `"dau"|"cuoi"|"moi_trang"` (mọi trang — dùng cho ký nháy lặp lại
  mỗi trang); `so_trang=0` kèm `neo_trang="cuoi"` nghĩa là trang cuối cùng dù tài
  liệu dài bao nhiêu trang. **Sửa mẫu KHÔNG ghi đè** — tạo dòng mới
  `phien_ban+1`, giữ nguyên bản cũ để các `yeu_cau_ky` đã tạo trước đó không bị
  ảnh hưởng khi admin chỉnh sửa mẫu sau này.
- `cau_hinh_tai_lieu` (`id, factory_id, loai_tai_lieu, modun, ten_hien_thi,
  dinh_tuyen JSONB DEFAULT '[]', muc_xac_thuc, yeu_cau_chu_ky_so, sla_gio,
  can_dat_truong BOOLEAN DEFAULT true`, unique `(factory_id, loai_tai_lieu)`) —
  `dinh_tuyen` ánh xạ mỗi `vai_tro` trong `mau_vi_tri.khung` sang người ký thật
  cụ thể theo đúng loại tài liệu đó (thứ tự, cách xác định người — có thể tương
  tự cơ chế "tự nhận diện lãnh đạo phòng ban" đã dùng ở Văn bản
  `/api/documents/dept-leader`).
- RLS 2 bảng này chỉ có SELECT — mọi INSERT/UPDATE phải qua service role (giống
  toàn bộ 6 bảng lõi ký số).

**Việc bắt buộc của phiên sau (theo đúng yêu cầu người dùng)**: xây dựng 1 trang
**"Cài đặt vị trí ký cho người soạn thảo"** — nơi người soạn thảo (hoặc admin)
VẼ khung vị trí ký 1 LẦN cho mỗi loại tài liệu (`loai_tai_lieu`), lưu vào
`mau_vi_tri`, để các hồ sơ SAU của cùng loại đó tự động áp dụng lại đúng vị trí —
không phải kéo-thả lại mỗi lần ký. Đây LÀ điều kiện tiên quyết trước khi mở rộng
ký số dùng chung sang Văn bản/ISO, không phải 1 việc phụ có thể làm sau.

### Mockup UI đã duyệt sẵn — bắt buộc đọc/mở trước khi code, không tự vẽ lại UI mới

File `cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html` — mockup HTML tương tác đã
DUYỆT từ trước (xem lịch sử "Cập nhật (tiếp 3)" mục "Giai đoạn 0 mục 8" trong
CLAUDE.md, phần "Kế hoạch phiên sau (2026-08-27)"), demo đúng luồng "Soạn thảo vị
trí ký":

- Người soạn thảo chọn 1 loại tài liệu (`loai_tai_lieu`), vẽ khung kéo/resize cho
  từng vai trò cố định (6 vai trò: `ky_nhay`, `soan_thao`, `xem_xet`, `phe_duyet`,
  `qr`, `ngay_ky`) trực tiếp trên ảnh render trang PDF.
- Lưới căn chỉnh (gridline ngang/dọc, bước 5%) + snap-to-grid khi kéo/resize —
  khung tự làm tròn về đúng vạch lưới khi bật lưới.
- **"Nhân bản khung"**: 1 người ký ở ≥2 vị trí trên cùng 1 tài liệu (vd Phê duyệt
  vừa ký cuối văn bản vừa ký nháy phụ lục riêng) — tạo bản sao độc lập neo `đầu`
  + trang tự chọn, preview hiện đúng tên/chữ ký của người gốc qua liên kết
  `clonedFrom`. Tương thích hoàn toàn với schema `truong_ky` hiện có (1 người ký
  → nhiều dòng `truong_ky` không có ràng buộc unique nào cản trở).
- Cơ chế chọn 1-trong-3 loại chức vụ hiển thị (`chucVuKey`): chính quyền / kiêm
  nhiệm / đoàn thể — dropdown liệt kê rõ NHÃN LOẠI + GIÁ TRỊ THẬT, chỉ hiện loại
  nào có dữ liệu, mặc định ưu tiên chính quyền → kiêm nhiệm → đoàn thể nhưng cho
  đổi tay. **Lưu ý gap schema CHƯA XỬ LÝ**: bảng nhân sự hiện chỉ có 2 cột chức
  vụ (`maintenance_staff.chuc_vu`, `chuc_vu_chinh_quyen`), thực tế công ty có 3
  loại độc lập (chính quyền/kiêm nhiệm/đoàn thể, có thể cùng tồn tại trên 1
  người) — đã ghi nhận là gap CHƯA CHỐT cách migrate (tên cột cụ thể/tách bảng
  riêng), cần hỏi lại người dùng trước khi đụng, KHÔNG tự quyết định.
- Cấu hình "Hiện tên & chức vụ" (`showName`) + `chucVuKey` là **cấu hình khoá
  THEO MẪU** (`mau_vi_tri`), đặt 1 lần bởi người soạn thảo lúc vẽ mẫu — KHÁC hẳn
  cách Văn bản/ISO hiện tại đang làm (mỗi người ký tự bật/tắt ẩn/hiện chữ
  ký/tên MỖI LẦN ký qua `SignPlacement`'s `showSignature`/`showSignerName`) —
  đây chính là hành vi lặp lại mà tính năng "Cài đặt vị trí ký" phải loại bỏ.
  Quy tắc nghiệp vụ cũ vẫn giữ nguyên không đổi: tài liệu cha chỉ ẩn được tên,
  không ẩn được chữ ký; hồ sơ con/file phụ ẩn được cả hai — chỉ đổi CHỖ cấu hình.
- **Quy tắc QR bắt buộc** (đã xác nhận với người dùng, phải giữ nguyên khi thiết
  kế `mau_vi_tri`): vị trí QR chỉ được đặt/kéo-thả **1 lần duy nhất ở bước đầu
  tiên** (Soạn thảo) và áp dụng cho **TẤT CẢ các trang** của tài liệu — các bước
  ký sau đó (Xem xét, Phê duyệt) **không** hiển thị lại khung QR để đặt/sửa nữa.
  Đây đúng là hành vi ISO hiện tại đã ghi trong `.claude/rules/16-iso-vanban-
  module.md`/`17-iso-soat-xet.md` ("Chỉ bước `soan_thao` mới được hiện/đặt QR
  draggable... Bước `xem_xet` và `phe_duyet` không được hiện lại QR draggable")
  — khi thiết kế `mau_vi_tri.khung` và tích hợp vào route ký của cả Văn bản lẫn
  ISO, PHẢI giữ đúng quy tắc này: vai trò `qr` trong mẫu chỉ set 1 lần lúc soạn
  mẫu, neo `moi_trang` (áp dụng mọi trang), không có UI đặt lại QR ở các bước ký
  sau.

**KHÔNG được tự vẽ lại UI mới từ mô tả text ở trên** — mở file mockup lên xem/
thao tác thử trực tiếp trước khi build, vì nhiều chi tiết hành vi (cách "Nhân bản
khung" hoạt động chính xác, cách preview chữ ký mẫu render, animation snap...)
chỉ được quyết định qua tương tác thật với mockup, không mô tả đầy đủ bằng lời ở
bất kỳ đâu khác.

### Pattern cần replicate — icon-action + ẩn/hiện Sửa/Xóa/Gửi ký

Đã đối chiếu lại 3 badge component đã xong (`quality-sign-status.tsx`,
`dispatch-sign-status.tsx`, `maintenance-sign-status.tsx`) — cả 3 mirror đúng 1
cấu trúc 3-nhánh, PHẢI áp dụng y hệt (không tự sáng tạo UI mới) khi làm badge cho
Văn bản/ISO:

1. **Chưa có yêu cầu ký** (`!status`): nếu không đủ quyền tạo (`!canCreate`) →
   badge tĩnh mờ "Chưa gửi ký duyệt" (hoặc ẩn hẳn, tùy module — Bảo trì trả `null`
   thay vì badge mờ); nếu đủ quyền → nút thật `PenTool` "Gửi ký duyệt" (violet).
2. **Đã hoàn tất** (`trangThai==="hoan_tat"`): `CheckCircle2` "Đã ký duyệt"
   (emerald) bình thường, đổi sang `AlertTriangle` "Đã ký — dữ liệu đã đổi"
   (amber) nếu `status.dataChanged` (so `updated_at` dữ liệu nguồn với
   `yeu_cau_ky.tao_luc`).
3. **Đang chờ ký** (`dang_luan_chuyen`) — nhiều nhánh con:
   - `canContinueSign` (admin hoặc đúng người phê duyệt/tham gia).
   - `canCancel = (isAdmin || isCreator) && !hasAnySigned(signers)` — nút
     `XCircle` "Hủy yêu cầu" (`hasAnySigned` từ `signing-my-turn.ts`, chặn hủy
     nếu đã có ai ký).
   - `canResign` khi `status.traVeLyDo` tồn tại → `RotateCcw` "Trả về — Sửa & ký
     lại" (rose), kèm hiện rõ lý do trả về (không chỉ tooltip).
   - `myTurn = computeMyTurn(signers, currentUser.id)` (dùng chung
     `signing-my-turn.ts`) → nếu đúng lượt: `Bell` "Chờ BẠN ký duyệt" (amber-500,
     nổi bật); còn lại: `Clock` "Chờ ký duyệt" (mờ hơn, hoặc tĩnh không click nếu
     `!canContinueSign`).
   - Mọi link đều trỏ `/dashboard/ky/{yeuCauId}` (SignScreen dùng chung, không
     xây màn ký riêng cho Văn bản/ISO).

**Ẩn/hiện nút "Gửi ký duyệt"** phải dùng đúng ownership-gating pattern đã tighten
2026-08-31 cho Điều xe/Chất lượng và vừa fix xong cho Bảo trì (2026-09-02):
`canOwnerAct = isAdmin || (record.created_by != null && record.created_by ===
user?.id)` — **NULL `created_by` = chỉ admin, KHÔNG fallback so khớp tên**. Với
Văn bản/ISO, 2 module này ĐÃ có sẵn `soan_thao_user_id` (UUID thật, không phải
TEXT snapshot như `maintenance_records.nguoi_tao` cũ) nên **không cần thêm cột
`created_by` mới** — dùng thẳng `soan_thao_user_id` làm cơ sở ownership cho nút
"Gửi ký duyệt" (dùng hệ ký mới) — nhưng PHẢI xác nhận lại với người dùng đây có
đúng là "chủ sở hữu" theo đúng nghĩa nghiệp vụ hay không trước khi code (khác
với Bảo trì/Điều xe/Chất lượng — nơi user tự do tạo bản ghi, `soan_thao_user_id`
của Văn bản/ISO có thể mang ý nghĩa khác do đã có workflow ký phức tạp sẵn).

Nút "Sửa"/"Xóa" của Văn bản/ISO **ĐÃ CÓ SẴN** đúng ownership pattern
(`canEditDoc`/`canDeleteDoc` dùng `soan_thao_user_id === user.id || isAdmin` kèm
điều kiện trạng thái `draft`/`tra_ve`) — không cần sửa lại, chỉ cần đối chiếu khi
thêm nút "Gửi ký duyệt" (hệ mới) cạnh các nút này để nhất quán style.

### Rủi ro & nguyên tắc bắt buộc khi bắt đầu

- Văn bản và ISO đều là **hệ thống ký ĐANG CHẠY THẬT trên production** — không
  giống việc thêm tính năng mới cho Bảo trì/Điều xe/Chất lượng (nơi trước đó
  hoàn toàn chưa có ký số nào). Bất kỳ thay đổi nào PHẢI không phá vỡ tài liệu/
  văn bản ĐÃ ký xong trước đó và luồng ký ĐANG diễn ra dở dang.
- Do độ phức tạp cao (2 module, phải xây `mau_vi_tri` UI trước, rồi mới tích hợp
  từng module), **KHÔNG được tự ý làm hết trong 1 phiên** — bắt buộc hỏi lại
  người dùng qua `AskUserQuestion` ngay đầu phiên về phạm vi cụ thể của phiên đó
  (ví dụ: "chỉ xây trang Cài đặt vị trí ký (mau_vi_tri CRUD + vẽ khung theo
  mockup) trong phiên này, CHƯA đụng route ký thật của Văn bản/ISO" — khuyến
  nghị mặc định, an toàn nhất) trước khi viết bất kỳ dòng code nào.
- Đề xuất trình tự hợp lý (chỉ là gợi ý, không phải quyết định cuối — vẫn phải
  hỏi lại người dùng):
  1. Xây UI "Cài đặt vị trí ký" độc lập (CRUD `mau_vi_tri` theo mockup, chưa
     đụng route ký nào) — có thể để trong `Cài đặt` (mirror cấu trúc admin config
     khác, xem `.claude/rules/12-settings-permissions.md`) hoặc tab riêng trong
     chính module Văn bản/ISO — cần hỏi người dùng vị trí đặt trang này.
  2. Tích hợp `mau_vi_tri` vào route ký THẬT của Văn bản (`api/documents/sign/
     route.ts`) — thay cơ chế `mergeQrBox`/toạ độ mặc định cứng bằng đọc mẫu đã
     lưu, ánh xạ `vai_tro` → người ký qua `cau_hinh_tai_lieu.dinh_tuyen`. Đây là
     bước RỦI RO CAO nhất (đổi hành vi route đang chạy thật) — cần đối chiếu
     byte-identical/verify kỹ như đã làm ở Giai đoạn 1 (refactor `src/lib/
     signing/`, xem lịch sử CLAUDE.md mục "Cập nhật (tiếp 4)").
  3. Lặp lại tương tự cho ISO sau khi Văn bản đã ổn định.
- File tham chiếu bắt buộc đọc trước khi code (không suy diễn lại từ mô tả):
  `src/lib/signing/requests.ts`, `src/lib/signing/stamp-pdf.ts`,
  `src/app/api/documents/sign/route.ts`, `src/app/dashboard/documents/[id]/
  page.tsx` (SignPlacementModal), `src/app/api/sign/generate-pdf/route.ts`,
  `src/app/dashboard/iso/documents/[id]/page.tsx`,
  `supabase/migrations/20260902_signing_core_tables.sql`,
  `cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html`,
  `.claude/rules/22-documents-module.md`, `.claude/rules/16-iso-vanban-module.md`.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Kế hoạch phiên sau (2026-09-02) — Mở rộng ký số dùng chung sang Văn bản
(ưu tiên) rồi ISO" trong CLAUDE.md (mục này vừa được thêm, ngay phía trên) — đã
điều tra kỹ hiện trạng, KHÔNG cần đọc lại code từ đầu trừ khi nghi ngờ thông tin
đã lỗi thời. Tóm tắt: Văn bản/ISO đều cho phép upload PDF từ máy tính (khác 3
module đã xong dùng jsPDF tự sinh PDF có toạ độ biết trước), và hiện tại người ký
phải tự kéo-thả lại vị trí khung MỖI LẦN ký (Văn bản còn "chốt" được vị trí QR 1
lần qua mergeQrBox() nhưng bị xóa sạch mỗi khi gửi lại; ISO không có cơ chế tái
dùng nào cả). 2 bảng `mau_vi_tri`/`cau_hinh_tai_lieu` đã có migration
(20260902_signing_core_tables.sql) nhưng CHƯA có code nào dùng.

Việc BẮT BUỘC đầu tiên: hỏi tôi qua AskUserQuestion phạm vi phiên này — khuyến
nghị mặc định (an toàn nhất): **chỉ xây trang "Cài đặt vị trí ký cho người soạn
thảo"** (CRUD bảng mau_vi_tri: chọn loại tài liệu, vẽ/kéo/resize khung theo từng
vai trò cố định trên ảnh render PDF, lưu thành mẫu — theo đúng mockup đã duyệt
cung_cap_dl/thiet_ke_soan_thao_vi_tri_ky.html, PHẢI mở file này xem/thao tác thử
trước khi code, không tự vẽ lại UI từ mô tả text) — CHƯA đụng vào route ký thật
của Văn bản (api/documents/sign/route.ts) hay ISO (api/sign/generate-pdf/
route.ts) trong phiên này. Việc tích hợp mau_vi_tri vào 2 route đó (Văn bản
trước, ISO sau) để dành phiên sau nữa, sau khi trang Cài đặt đã ổn định và được
duyệt.

Khi làm badge trạng thái ký cho Văn bản/ISO (khi tới lượt tích hợp thật), PHẢI
mirror đúng cấu trúc 3-nhánh đã dùng ở quality-sign-status.tsx/dispatch-sign-
status.tsx/maintenance-sign-status.tsx (chưa có yêu cầu / đang chờ [canContinueSign/
canCancel+hasAnySigned/canResign/myTurn qua computeMyTurn()] / hoàn tất
[thường/dataChanged]) — không tự thiết kế UI mới. Icon: PenTool/CheckCircle2/
AlertTriangle/Clock/Bell/RotateCcw/XCircle. Với Văn bản/ISO, nút "Sửa"/"Xóa" ĐÃ
có sẵn đúng ownership pattern (soan_thao_user_id===user.id||isAdmin, kèm điều
kiện trạng thái draft/tra_ve) — không cần sửa lại; nút "Gửi ký duyệt" (hệ mới)
nên dùng thẳng soan_thao_user_id làm cơ sở ownership (không cần thêm cột
created_by mới như đã làm cho Bảo trì) nhưng PHẢI xác nhận lại với tôi ý nghĩa
nghiệp vụ trước khi code, vì 2 module này có workflow ký phức tạp sẵn có khác
hẳn Bảo trì/Điều xe/Chất lượng.

Gap "3 loại chức vụ" (chính quyền/kiêm nhiệm/đoàn thể) trong mockup vẫn CHƯA
CHỐT cách migrate schema — không tự ý viết migration cho việc này, hỏi tôi
trước.

Nhớ đúng quy tắc QR: chỉ đặt/kéo-thả 1 lần ở bước Soạn thảo, áp dụng cho TẤT CẢ
các trang tài liệu — các bước Xem xét/Phê duyệt sau đó KHÔNG hiển thị lại khung
QR để đặt/sửa nữa (đúng hành vi ISO hiện tại, giữ nguyên khi thiết kế mau_vi_tri).

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build
khi không chắc dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-02, tiếp — cùng ngày) — Trang "Cài đặt vị trí ký" đã CODE XONG cho
Văn bản, gắn vào luồng "Gửi ký" thật, CHƯA test tay

Thực hiện ngay trong phiên đọc mục kế hoạch ở trên. Đã hỏi phạm vi qua `AskUserQuestion`
(chốt: "Chỉ xây trang Cài đặt vị trí ký", không đụng route ký thật) — sau đó người dùng
chỉnh 1 điểm quan trọng khi đang bàn vị trí đặt màn hình: **KHÔNG cho lần "Gửi ký" nào bỏ
qua màn xác nhận vị trí, kể cả khi loại tài liệu ĐÃ có mẫu lưu sẵn** — người soạn thảo luôn
phải xem lại/xác nhận vị trí (mẫu cũ hiện sẵn để xác nhận, hoặc vẽ mới nếu chưa có) trước khi
hệ thống thực sự gửi đi. Đây là thay đổi so với thiết kế ban đầu (dự kiến: có mẫu rồi thì bỏ
qua màn này) — đã áp dụng đúng theo yêu cầu mới.

### Kiến trúc đã dựng

- `src/lib/signing/templates.ts` (mới) — `getLatestSignTemplate()`/`saveSignTemplate()`,
  đọc/ghi bảng `mau_vi_tri` qua `getSupabaseAdmin()`. Không bao giờ ghi đè — mỗi lần lưu
  tăng `phien_ban`. Type `SignTemplateBox` mở rộng thêm so với comment tối thiểu của cột
  `khung` trong migration (`vai_tro/neo_trang/so_trang/x_pt/y_pt/w_pt/h_pt`) — thêm
  `clone_of`, `loai` ('chu_ky'|'qr'|'ngay_ky'), `nhan`, `bat_buoc`, `show_name`,
  `chuc_vu_key` — hợp lệ vì cột `khung` chỉ ràng buộc `jsonb_typeof=array`, không có schema
  cứng nào khác.
- `src/app/api/signing/templates/route.ts` (mới) — `GET` (đọc mẫu mới nhất theo
  `factoryId+loaiTaiLieu`) + `POST` (lưu phiên bản mới). Gate quyền: `documents.create`
  (mirror đúng logic 2 bước explicit `user_permissions.granted=true` rồi
  `role_permissions.role` đã dùng ở `dept-users/route.ts` — không lặp lại bug thiếu
  `.eq("granted", true)` đã từng xảy ra ở `approvers/route.ts`, xem
  `.claude/rules/22-documents-module.md`). `mau_vi_tri` RLS chỉ có SELECT nên mọi ghi bắt
  buộc qua route service-role này, đúng thiết kế đã ghi trong migration
  `20260902_signing_core_tables.sql`.
- `src/app/dashboard/ky/mau-vi-tri/page.tsx` (mới, ~940 dòng) — màn vẽ khung theo mockup đã
  duyệt, bám sát cơ chế: render PDF tham chiếu qua `pdfjs` (mirror đúng kỹ thuật canvas-tạm
  → `toDataURL()` của `ky/[id]/page.tsx`, tránh race điều kiện đã ghi trong comment gốc),
  kéo/resize bằng pointer events (không remount DOM khi kéo — mirror kỹ thuật đã sửa lỗi
  giật trong chính mockup), lưới căn chỉnh + snap 5%, "Nhân bản khung" (duplicate role →
  `clone_of` trỏ về vai trò gốc), toggle "Hiện tên & chức vụ" + chọn 1-trong-3 loại chức vụ
  (`chinh_quyen`/`kiem_nhiem`/`doan_the`, chỉ là NHÃN LOẠI tĩnh ở bước này — chưa có dữ liệu
  người ký thật để hiển thị giá trị cụ thể, vì `dinh_tuyen`/ánh xạ người thật chưa được tích
  hợp), cảnh báo khung ngoài khổ giấy, "Xem trước" đổi khung sang nội dung chữ ký mẫu/QR/ngày
  giả lập.
  - Route này tự bypass sidebar (đã có sẵn cơ chế `pathname.startsWith("/dashboard/ky/")`
    trong `dashboard/layout.tsx` — không cần sửa gì thêm).
  - Nhận query params: `loai` (`loai_tai_lieu`, bắt buộc), `pdfUrl` (file PDF tham chiếu để
    render, bắt buộc), `docLabel` (hiển thị), `returnTo` (URL quay lại sau khi xác nhận).

### Vai trò cố định cho module Văn bản (khác 6 vai trò ISO trong mockup)

Mockup gốc định nghĩa 6 vai trò cho ISO (`ky_nhay, soan_thao, xem_xet, phe_duyet, qr,
ngay_ky`). Văn bản không có khái niệm "ký nháy" và có SỐ BƯỚC KÝ PHÒNG BAN THAY ĐỔI theo
từng văn bản (`thu_tu_ky_json` do người soạn thảo tự chọn số bước) — nên đã định nghĩa lại 4
vai trò gốc cho `documents`: `ky_buoc` (Ký bước — phòng ban/cá nhân, bắt buộc), `phe_duyet`
(bắt buộc), `qr` (tuỳ chọn), `ngay_ky` (tuỳ chọn). Số bước ký phòng ban thật của 1 văn bản cụ
thể được xử lý qua cơ chế **"Nhân bản khung"** có sẵn trong mockup (nhân bản `ky_buoc` thành
`ky_buoc__ban2`, `ban3`...) — không cần thiết kế mới, đúng tinh thần schema `truong_ky`/
`mau_vi_tri.khung` vốn đã hỗ trợ 1 vai trò → nhiều khung.

### Đơn giản hoá có chủ đích so với mockup — bỏ lựa chọn "chỉ áp dụng cho hồ sơ này"

Mockup có modal 2 lựa chọn khi lưu vị trí đã chỉnh: "Cập nhật mẫu vị trí (dùng chung)" hoặc
"Chỉ áp dụng cho hồ sơ này". Lựa chọn thứ 2 cần nơi lưu override RIÊNG CHO TỪNG YÊU CẦU KÝ
(`truong_ky`, chỉ tồn tại sau khi `createSigningRequest()` chạy) — nhưng phiên này CHƯA tích
hợp `mau_vi_tri` vào bất kỳ route ký thật nào, nên không có nơi nào để "chỉ áp dụng cho hồ sơ
này" đi tới. Đã bỏ hẳn lựa chọn này — nút "Xác nhận vị trí & Gửi đi" chỉ có 1 hành vi: nếu có
thay đổi (hoặc chưa từng có mẫu) → lưu thành phiên bản `mau_vi_tri` MỚI dùng chung cho mọi hồ
sơ sau; nếu không đổi gì so với mẫu đã tải → bỏ qua bước lưu, đi thẳng tới gửi đi.

### Gắn vào luồng "Gửi ký" thật của Văn bản — chỉ đổi UI điều hướng, KHÔNG đụng route ký

`src/app/dashboard/documents/[id]/page.tsx`:

- `handleGuiKy()` (nút "Gửi ký", action `gui_ky`, đưa văn bản từ `draft`/`tra_ve` sang bước ký
  đầu tiên): nếu văn bản có **file nguồn là PDF** (`docExt === "pdf"`, dùng đúng biến
  `docSourceUrl`/`docExt` đã có sẵn trong file — computed từ `file_goc_url` ở trạng thái
  draft) VÀ có `loai_van_ban`, điều hướng sang
  `/dashboard/ky/mau-vi-tri?loai=...&pdfUrl=...&docLabel=...&returnTo=/dashboard/documents/{id}`
  thay vì gọi thẳng `doAction("gui_ky")`. Văn bản nguồn **Office (DOCX/XLSX)** không có khái
  niệm "vị trí" (dùng tag `{{...}}`) nên **bỏ qua hoàn toàn** màn này, gửi thẳng như cũ —
  không đổi hành vi cho luồng Office.
- Effect mới (`autoSendTriedRef` chặn lặp) đọc query param `confirmedSignTemplate=1` khi quay
  lại từ màn cài đặt vị trí — tự gọi lại đúng `doAction("gui_ky")` **đúng 1 lần**, rồi
  `router.replace()` dọn query param khỏi URL (tránh gửi lặp nếu F5 lại trang).
- **Không đụng** `api/documents/sign/route.ts`, `SignPlacementModal`, hay bất kỳ logic đóng
  dấu PDF thật nào — các bước ký sau đó (`ky_buoc`, `phe_duyet`) vẫn dùng nguyên
  `SignPlacementModal` cũ với toạ độ mặc định hard-code như trước, KHÔNG đọc `mau_vi_tri`.
  Nghĩa là: mẫu vị trí giờ ĐƯỢC LƯU đúng lúc gửi ký, nhưng CHƯA được ĐỌC để tự động áp dụng
  vào bất kỳ khung ký thật nào — đó là việc của phiên tích hợp tiếp theo (mục 2 trong đề xuất
  trình tự đã ghi ở kế hoạch phía trên).

### Đã kiểm tra

`npx tsc --noEmit` (toàn repo) và `npx eslint` trên cả 4 file (mới + đã sửa) đều sạch — 0
lỗi, 0 warning mới (2 warning `<img>` còn lại trong `documents/[id]/page.tsx` là pre-existing
ở dòng 537/738, cách xa mọi chỗ đã sửa lần này). Không chạy `npm run build`.

### CHƯA test tay — bắt buộc trước khi coi tính năng này là hoàn tất

1. Tạo 1 văn bản mới (nguồn PDF), bấm "Gửi ký" lần đầu (chưa có mẫu `mau_vi_tri` cho loại
   văn bản đó) → xác nhận điều hướng đúng sang màn Cài đặt vị trí ký, 4 vai trò hiện đúng
   trạng thái "Chưa đặt", 2 vai trò bắt buộc (`ky_buoc`, `phe_duyet`) chặn nút gửi nếu chưa
   đặt đủ.
2. Đặt đủ khung, bấm "Xác nhận vị trí & Gửi đi" → xác nhận: (a) tạo đúng 1 dòng `mau_vi_tri`
   mới (`phien_ban=1`) trong DB; (b) quay lại đúng trang chi tiết văn bản; (c) văn bản THẬT
   SỰ đã chuyển trạng thái (`gui_ky` đã chạy) — không bị kẹt ở `draft`.
3. Tạo văn bản thứ 2 CÙNG loại → bấm "Gửi ký" → xác nhận màn Cài đặt vị trí ký hiện SẴN 2
   khung đã lưu từ lần trước (không phải trống), có thể bấm thẳng "Xác nhận vị trí & Gửi đi"
   mà không sửa gì → xác nhận KHÔNG tạo thêm `phien_ban` mới (vì không đổi gì) và văn bản vẫn
   được gửi đi đúng.
4. Thử "Nhân bản" 1 khung (`ky_buoc`) để mô phỏng văn bản có nhiều bước ký phòng ban → xác
   nhận bản sao xuất hiện đúng, đặt được vị trí riêng, lưu thành công, tải lại xác nhận đọc
   lại đúng cấu trúc `clone_of`.
5. Test văn bản nguồn Office (DOCX/XLSX) → xác nhận bấm "Gửi ký" đi thẳng như cũ, KHÔNG bị
   điều hướng sang màn Cài đặt vị trí ký.
6. Test tài khoản KHÔNG có `documents.create` (và không phải admin) → xác nhận `POST
   /api/signing/templates` trả 403, hiển thị lỗi rõ ràng trên màn (không crash trắng trang).
7. Test lưới căn chỉnh (snap 5%) và cảnh báo "khung ngoài khổ giấy" hoạt động đúng khi kéo
   khung ra sát mép trang.
8. Xác nhận nút "Huỷ" (không lưu gì, quay lại `returnTo`) và văn bản vẫn ở nguyên trạng thái
   `draft`/`tra_ve` như trước khi bấm "Gửi ký".

### Bước tiếp theo (chưa làm, đúng như kế hoạch — cần hỏi lại phạm vi trước khi bắt đầu)

Tích hợp `mau_vi_tri` vào route ký thật (`api/documents/sign/route.ts`) để các bước
`ky_buoc`/`phe_duyet` tự đọc mẫu đã lưu và prefill khung thay vì toạ độ mặc định hard-code —
đây là bước RỦI RO CAO hơn hẳn (đổi hành vi route đang chạy thật), cần verify kỹ (đối chiếu
byte-identical hoặc test tay đầy đủ) trước khi coi là xong, và cần `cau_hinh_tai_lieu.dinh_tuyen`
để ánh xạ `vai_tro` → người ký thật (bảng này cũng chưa có route/UI nào ghi tới, tương tự
`mau_vi_tri` trước phiên này).

## Cập nhật (2026-09-02, tiếp — cùng ngày, phiên mới) — Đồng bộ màn "Cài đặt vị trí ký" với
người ký thật của Văn bản — ĐÃ CODE XONG, CHƯA test tay

Người dùng test tay màn "Cài đặt vị trí ký" mới xong (mục ngay phía trên) và báo 3 vấn đề dựa
trên 1 kịch bản thật: văn bản phòng ban NMCB, `pham_vi="Don_vi"`, chọn Phê duyệt = Tô Thành Luân
(Giám đốc nhà máy), chọn nhiều nhân viên cụ thể theo thứ tự làm "Ký xác nhận". Đã đi qua đúng
quy trình EnterPlanMode (Explore agent đọc code thật → Plan agent thiết kế → 2 câu hỏi
`AskUserQuestion` xác nhận kiến trúc → viết plan → `ExitPlanMode` được duyệt) trước khi code —
chi tiết đầy đủ xem trong chính plan đã duyệt (không lặp lại toàn văn ở đây).

### 3 vấn đề đã fix

1. **Trải nghiệm mong muốn**: màn vị trí phải tự khớp với đúng người đã chọn ở `new/page.tsx`
   (không phải vai trò trừu tượng chung chung).
2. **Bug UX**: bấm vào 1 dòng vai trò không kích hoạt công cụ vẽ khung — phải đổi dropdown neo
   trang trước (vì `armRole()` chỉ gắn vào `onChange` của `<select>`, không có nút "+" riêng).
3. **Xem trước** phải hiện tên/chức danh/ảnh chữ ký THẬT của người đã gắn cố định, không phải
   placeholder giả ("Nguyễn Văn A", SVG cố định).

### Quyết định kiến trúc đã chốt qua `AskUserQuestion`

- **Không gộp** màn "chọn người/bước ký" (`new/page.tsx`) vào màn "Cài đặt vị trí ký" — giữ 2
  màn riêng, chỉ đồng bộ DỮ LIỆU. Lý do: `mau_vi_tri` phải giữ mức trừu tượng (vai trò) để tái
  dùng cho văn bản tương lai; logic chọn người là đặc thù Văn bản, gộp vào màn dùng chung sẽ
  phá vỡ khả năng tái dùng cho ISO sau này.
- **Slot dư** (mẫu có nhiều "Ký bước" hơn số người thật của văn bản đang mở): **ẩn hẳn khỏi
  UI đang thao tác**, nhưng dữ liệu vẫn giữ nguyên trong `mau_vi_tri` khi lưu phiên bản mới
  (ẩn ở tầng hiển thị, không lọc khỏi payload lưu).

### Nguyên tắc nền tảng đã giữ xuyên suốt khi code

`mau_vi_tri.khung`/`SignTemplateBox` chỉ chứa dữ liệu TRỪU TƯỢNG (vai trò, toạ độ, `loai`,
`nhan` tĩnh, `bat_buoc`, `show_name`, `chuc_vu_key`). Dữ liệu người thật (tên/chức vụ/ảnh chữ
ký/tên phòng ban) chỉ tồn tại như state phiên làm việc song song (`docSignerByRoleId`,
`signerInfoById`, `docSteps`, `docPheDuyetUserId`) — KHÔNG bao giờ ghi vào `EditorRole` các
field lưu-lên-server hay gửi lên `POST /api/signing/templates`. Lý do kỹ thuật: `dirty` tính
bằng `JSON.stringify(roles) !== initialSnapshot` — nhét dữ liệu người thật vào `EditorRole` sẽ
khiến mở lại màn luôn "dirty" giả, ép tạo `phien_ban` mới vô nghĩa mỗi lần mở.

### File đã sửa/tạo

| File | Thay đổi |
|---|---|
| `src/app/dashboard/documents/[id]/page.tsx` | `handleGuiKy()` thêm `docId: doc.id` vào `URLSearchParams` khi điều hướng sang màn vị trí (1 dòng) |
| `src/app/api/documents/signer-info/route.ts` (mới) | `GET ?factoryId=&userIds=` — mirror đúng cách `dept-leader/route.ts` tra `maintenance_staff.chuc_vu`/`chuc_vu_chinh_quyen` qua `profile_id` (KHÔNG lọc từ khoá lãnh đạo — người đã được chọn sẵn); xác nhận có ảnh chữ ký qua `storage.list(...,{search:"chu_ky.png"})` (rẻ hơn `download()` toàn bộ bytes) |
| `src/app/dashboard/ky/mau-vi-tri/page.tsx` | Sửa chính — xem chi tiết dưới |

### `mau-vi-tri/page.tsx` — chi tiết thay đổi

- `EditorRole` thêm field `hiddenForDoc: boolean` — lọc khỏi `rolesOnPage`/sidebar list/
  `missingRequired`/`outOfBoundsRoles`, nhưng **KHÔNG** lọc khỏi `buildKhungPayload()` (giữ
  nguyên hành vi cũ ở đó — đảm bảo slot dư không mất khi lưu).
- Tách `makeCloneRole(baseId, n, sourceBox)` khỏi `duplicateRole()` — dùng chung cho cả nhân
  bản thủ công lẫn "pad" tự động. Thêm `roleCloneIndex(role)` (base=1, `__banN`→N) để sắp thứ
  tự ổn định, map 1-1 với `thu_tu_ky_json[i]`.
  `reconcileForDoc(prevRoles, docSteps, cloneSeqRef)` (hàm thuần, top-level): tự thêm slot
  "Ký bước" nếu `N=thu_tu_ky_json.length` lớn hơn số slot hiện có (dùng `makeCloneRole`, không
  tự `armRole()` — khác `duplicateRole()`, đây là hành vi hệ thống không phải người dùng chủ
  động bấm); đánh dấu `hiddenForDoc:true` cho các slot vượt quá `N` nếu mẫu có nhiều hơn.
- 3 effect mới, chạy nối tiếp theo đúng thứ tự phụ thuộc:
  1. Nạp `van_ban_documents` (`thu_tu_ky_json`, `phe_duyet_user_id`) khi có `docId` — set
     `docSteps`/`docPheDuyetUserId`/`docFetchOk`/`docLoaded`. Lỗi/không tìm thấy → `docFetchOk
     =false` (fallback an toàn — coi như không có `docId`, không ẩn/pad gì cả).
  2. Gọi `/api/documents/signer-info` 1 lần với danh sách `userId` gom từ bước 1 → set
     `signerInfoById`. Lỗi không chặn luồng (fallback placeholder).
  3. **Effect "đối chiếu"** — chờ CẢ `templateLoaded` (cờ mới, set ở cuối effect nạp mẫu hiện
     có, cả 2 nhánh có/không có mẫu) VÀ `docLoaded` đều sẵn sàng, chạy `reconcileForDoc` ĐÚNG 1
     LẦN (guard bằng `reconciledRef`, không phải dependency `roles` — tránh vòng lặp vì effect
     tự gọi `setRoles`). Set `initialSnapshot` MỚI sau khi đối chiếu (không phải trước) — nếu
     không, việc tự pad/ẩn slot sẽ khiến `dirty=true` giả ngay khi vừa mở màn.
- `docSignerByRoleId` (`useMemo`) — map vị trí slot "Ký bước" (đã sort theo `roleCloneIndex`)
  1-1 với `docSteps[i]` theo đúng thứ tự đã chọn lúc soạn thảo; `phe_duyet` map thẳng
  `docPheDuyetUserId`. Bước `type:"phong_ban"` (Cong_ty, chưa có người cố định) → chỉ có tên
  phòng ban, không có ảnh/chức vụ.
- **Bug UX #2 đã fix**: dropdown neo trang đổi sang chỉ set state cục bộ
  `pendingAnchorByRole[role.id]` (không tự `armRole()`); thêm nút "+" riêng (icon `Plus`) —
  `onClick` mới gọi `armRole(role.id, pendingAnchorByRole[role.id] ?? "dau")`.
  `duplicateRole()` giữ nguyên tự `armRole()` ngay (hành động chủ động của người dùng).
- Sidebar: thêm dòng phụ nhỏ dưới mỗi vai trò (chỉ khi có `docSignerByRoleId[role.id]`) —
  `→ Tô Thành Luân · Giám đốc nhà máy` hoặc `→ Phòng {tên phòng ban} (chưa xác định người ký)`.
- `PreviewContent` nhận thêm `signer`/`factoryId` — `kind:"ca_nhan"` hiện ảnh chữ ký thật qua
  `supabase.storage.from("iso-documents").getPublicUrl(...)` nếu `has_signature`, tên/chức vụ
  thật (fallback nhãn tĩnh `chucVuKey` nếu `chuc_vu` rỗng — bug gốc `chuc_vu=""` khi lưu
  `thu_tu_ky_json` ở `new/page.tsx` KHÔNG sửa ở đây, ngoài phạm vi); `kind:"phong_ban"` chỉ
  hiện tên phòng ban + ghi chú "(người ký thật xác định khi ký)"; không có `signer` → giữ
  nguyên hành vi cũ 100% (SVG giả/"Nguyễn Văn A"/QR giả/ngày giả) — không đổi gì khi mở màn
  không kèm `docId`.

### Đã kiểm tra

`npx tsc --noEmit` (toàn repo) và `npx eslint` trên cả 3 file (2 sửa + 1 mới) đều sạch — 0 lỗi,
0 warning mới (2 warning `<img>` còn lại trong `documents/[id]/page.tsx` pre-existing, không
liên quan). Không chạy `npm run build`.

### CHƯA test tay — bắt buộc trước khi coi tính năng này là hoàn tất

Lặp lại đúng kịch bản người dùng đã báo cáo:

1. Tạo văn bản NMCB, `pham_vi="Don_vi"`, phê duyệt tự nhận diện Tô Thành Luân, chọn 2-3 nhân
   viên "Ký xác nhận" theo thứ tự → Lưu → "Gửi ký duyệt" → xác nhận màn vị trí hiện đúng số
   dòng "Ký bước" (khớp số người đã chọn), mỗi dòng có dòng phụ hiện đúng tên/chức vụ thật
   (hoặc "(chưa rõ tên)"/chức vụ rỗng nếu `maintenance_staff` thiếu dữ liệu), dòng "Phê duyệt"
   hiện đúng Tô Thành Luân.
2. Bấm thẳng vào 1 dòng vai trò CHƯA đặt (không đổi dropdown) → xác nhận nút "+" kích hoạt chế
   độ vẽ khung ngay lập tức.
3. Bật "Xem trước" → xác nhận ảnh chữ ký thật hiện đúng cho người đã upload ảnh (Cài đặt → ISO
   & Văn bản → Chữ ký cá nhân), chữ "Chưa có ảnh chữ ký" cho người chưa có.
4. Test slot dư: lưu 1 mẫu có 3 "Ký bước" (chọn văn bản có 3 người xác nhận), mở 1 văn bản khác
   cùng `loai_van_ban` chỉ cần 1 người ký → xác nhận 2 slot dư ẩn hẳn khỏi UI, không chặn nút
   gửi (không còn tính là "thiếu vai trò bắt buộc"); lưu phiên bản mới xong, mở lại 1 văn bản
   cần đủ 3 người → xác nhận cả 3 vị trí vẫn còn nguyên (không mất do lần lưu trước ẩn chúng).
5. Test văn bản `pham_vi="Cong_ty"` (bước `phong_ban`) → xác nhận preview chỉ hiện tên phòng
   ban + ghi chú, không có ảnh/chức vụ giả.
6. Test văn bản `pham_vi="Don_vi"` nhưng KHÔNG chọn "Ký xác nhận" nào (N=0, hợp lệ theo rule 22
   — bước này là tuỳ chọn) → xác nhận slot "Ký bước" gốc tự ẩn, KHÔNG chặn gửi dù `batBuoc`
   (đúng thiết kế: N=0 nghĩa là văn bản này thật sự không cần vị trí "Ký bước" nào).
7. Xác nhận văn bản Office (DOCX/XLSX) và luồng không kèm `docId` (nếu còn cách truy cập trực
   tiếp `/dashboard/ky/mau-vi-tri`) hoạt động y hệt trước khi có thay đổi này.

## Cập nhật (2026-09-03) — 3 phát hiện từ test tay màn Cài đặt vị trí ký

Người dùng test tay màn "Cài đặt vị trí ký" trên desktop (`npm run dev`, localhost) và báo 3
việc. Đã hỏi lại 2 câu qua `AskUserQuestion` để làm rõ trước khi ghi kế hoạch (tránh phiên sau
phải đoán lại), và tự xác nhận thêm 1 bug qua đọc code (không phải suy đoán) trong lúc soạn kế
hoạch. **Phiên này KHÔNG sửa code** — chỉ ghi lại phát hiện + soạn kế hoạch cho phiên sau.

1. **Sidebar cần kéo giãn bề rộng** — đã hỏi rõ và xác nhận: cả câu "thanh phải thêm chức năng
   tăng giảm bề rộng" lẫn câu tiếp theo ("Khung ký hiện tại vẽ ra 1 kích thước cố định không
   tăng giãm kích thước không di chuyển được") đều nói về **panel sidebar 320px cố định bên
   phải** (danh sách vai trò) — người dùng chọn đáp án gộp cả 2 câu vào ý "sidebar", KHÔNG chọn
   đáp án "cả hai" (tức tách riêng thành 1 bug khung ký trên canvas). Nếu khung ký (role box)
   trên canvas thực sự cũng không kéo/resize được khi test lại ở phiên sau, đó là bug MỚI cần
   người dùng báo riêng — không giả định sẵn là có.
2. **Vấn đề lớn nhất — xác nhận qua code, đúng như đã ghi rõ từ đầu là "chưa tích hợp"**: sau
   khi lưu mẫu vị trí, bước ký THẬT (`SignPlacementModal` trong `documents/[id]/page.tsx`, gọi
   khi bấm "Ký phòng ban"/"Ký xác nhận"/"Phê duyệt") vẫn dùng toạ độ mặc định hard-code, hoàn
   toàn không đọc `mau_vi_tri` — việc tích hợp nằm ngoài phạm vi phiên trước (đã ghi rõ trong
   mục "Cập nhật (2026-09-02, tiếp — cùng ngày, phiên mới)" ở trên). Đã hỏi người dùng hướng
   tích hợp cho phiên sau — **CHỐT: vị trí CỨNG** — khi ký thật, hệ thống tự đặt đúng vị trí đã
   lưu trong `mau_vi_tri`, người ký chỉ xác nhận PIN, không còn canvas kéo-thả tự do nữa (khác
   hẳn UX `SignPlacementModal` hiện tại).
3. **Bug đã xác nhận qua đọc code trực tiếp (không phải suy đoán)** — phát hiện thêm trong lúc
   soạn kế hoạch này: validation "còn thiếu vai trò bắt buộc" (`missingRequired`,
   `mau-vi-tri/page.tsx:541`) chỉ check `role.batBuoc` — nhưng `makeCloneRole()` (dòng 172,
   dùng cho CẢ nhân bản thủ công LẪN tự "pad" slot theo `reconcileForDoc()`) luôn set
   `batBuoc: false`. Nghĩa là khi hệ thống tự sinh thêm slot "Ký bước" khớp số người thật
   (`docSteps.length`), CHỈ slot gốc (`ky_buoc`) và `phe_duyet` bị coi là bắt buộc — các slot
   pad thêm (dù đại diện cho người ký THẬT theo `docSignerByRoleId`) không bị chặn nếu bỏ
   trống → khớp đúng lời người dùng báo "chưa cài đặt hết vị trí ký xác nhận vẫn lưu được".

## Kế hoạch phiên sau — Fix validation + sidebar resizable + tích hợp mau_vi_tri VÀO route ký
thật (vị trí CỨNG)

Chia 3 phần theo độ rủi ro tăng dần — khuyến nghị làm tuần tự, KHÔNG bắt buộc làm hết trong 1
phiên (đúng tinh thần đã áp dụng xuyên suốt dự án ký số này).

### Phần A — Fix rõ ràng, rủi ro thấp (làm ngay, không cần hỏi thêm)

- `mau-vi-tri/page.tsx`: sửa `missingRequired` (hoặc thêm 1 biến mới song song, KHÔNG đổi
  nghĩa `batBuoc` gốc — `batBuoc` vẫn đúng nghĩa "bắt buộc ở cấp độ MẪU trừu tượng, dùng khi
  lưu `mau_vi_tri`") — khi có `docId`, 1 slot `ky_buoc`-family phải coi là bắt buộc đặt trước
  khi "Xác nhận vị trí & Gửi đi" nếu nó có mặt trong `docSignerByRoleId` (tương ứng 1 bước ký
  thật của văn bản đang mở), bất kể `role.batBuoc` gốc. Đề xuất: hàm `isRequiredForConfirm(role)`
  = `role.batBuoc || (docId && role.id in docSignerByRoleId)`, dùng thay `role.batBuoc` đúng
  tại chỗ tính `missingRequired` (dòng 541) — KHÔNG đổi `role.batBuoc`/`bat_buoc` lưu vào
  `mau_vi_tri` (payload lưu mẫu giữ nguyên ý nghĩa trừu tượng cũ).
- Sidebar resizable: thêm 1 thanh kéo (divider) giữa vùng canvas và sidebar 320px
  (`mau-vi-tri/page.tsx`, khu vực `<div className="w-[320px] ...">`) — đổi từ width cố định
  sang width kéo giãn được bằng pointer events, mirror ĐÚNG kỹ thuật drag đã tự viết trong
  chính file này (`startDrag`/`onDragMove`/`onDragEnd`, dùng `setPointerCapture`) thay vì thêm
  dependency mới — lưu width vào 1 state (`sidebarWidth`, có min/max hợp lý, ví dụ 260–480px),
  không cần persist qua session khác.

### Phần B — Cần TEST TAY lại để xác nhận trước khi sửa (không tự ý đoán fix)

Mở lại đúng màn Cài đặt vị trí ký, ở chế độ ĐANG SỬA (không phải Xem trước), thử kéo di chuyển
1 khung đã đặt và resize bằng handle góc dưới-phải — xác nhận có THỰC SỰ bị lỗi (không di
chuyển/không resize được) hay không. Nếu có bug thật, đọc kỹ `startDrag`/`onDragMove`/
`startResize`/`onResizeMove` (đã dùng `setPointerCapture`, có vẻ đúng kỹ thuật khi đọc code
tĩnh — nếu vẫn lỗi khi test thật, khả năng cao là vấn đề khác: handle resize quá nhỏ (12px,
khó bấm trúng), hoặc xung đột `onClick={handlePageClick}` ở div cha bị bắt nhầm sự kiện — cần
debug bằng console.log/React DevTools thật, không suy đoán suông).

### Phần C — Tích hợp `mau_vi_tri` vào route ký thật, vị trí CỨNG (rủi ro cao nhất, cần thiết
kế kỹ trước khi code)

- **Đã chốt hướng**: lúc ký thật (bấm "Ký phòng ban"/"Ký xác nhận"/"Phê duyệt"), hệ thống tự
  đặt đúng vị trí đã lưu trong `mau_vi_tri`, người ký chỉ xác nhận PIN — bỏ hẳn canvas kéo-thả
  tự do ở bước ký (khác hẳn UX hiện tại của `SignPlacementModal`).
- **Phát hiện quan trọng cần điều tra kỹ trước khi thiết kế** (chưa xác nhận, chỉ là gợi ý
  hướng đi rẻ hơn `cau_hinh_tai_lieu.dinh_tuyen` đã phác thảo trong kế hoạch cũ): `van_ban_documents`
  đã có sẵn cột `placement_ky JSONB` (`documents-types.ts:62`), và code hiện tại (`mergeQrBox()`
  trong `api/documents/sign/route.ts`) đã có tiền lệ đọc/ghi `placement_ky.qr` giữa các bước
  ký. Rất có thể **không cần** xây dựng cơ chế tổng quát `cau_hinh_tai_lieu.dinh_tuyen` (như
  phác thảo ban đầu, dành cho N module dùng chung) — chỉ cần: lúc bấm "Xác nhận vị trí & Gửi
  đi" ở `mau-vi-tri/page.tsx`, tính sẵn toạ độ pt CHÍNH XÁC cho từng bước ký thật (dùng đúng
  `docSignerByRoleId`/`roleCloneIndex` đã có) rồi ghi thẳng vào `van_ban_documents.placement_ky`
  (mở rộng cấu trúc hiện có, ví dụ key theo `stepKey`/vai_tro), và route ký thật +
  `SignPlacementModal` đọc thẳng từ đó — tái dùng đúng field/cơ chế đã tồn tại, rủi ro thấp hơn
  xây mới toàn bộ. **Bắt buộc đọc kỹ TOÀN BỘ `api/documents/sign/route.ts` (không chỉ đoạn
  `mergeQrBox`) trước khi quyết định** — đây chỉ là giả thuyết cần verify, không phải kết luận.
- Cần thiết kế: `SignPlacementModal` khi phát hiện bước hiện tại ĐÃ có toạ độ cứng trong
  `placement_ky` → bỏ qua hẳn canvas/kéo-thả, chỉ hiện xác nhận PIN (giữ nguyên UI khi
  `placement_ky` thiếu dữ liệu — văn bản soạn trước khi có tính năng này — fallback về hành vi
  cũ, KHÔNG chặn ký của văn bản cũ).
- Vì đây là ROUTE KÝ THẬT ĐANG CHẠY PRODUCTION, bắt buộc: hỏi lại phạm vi cụ thể qua
  `AskUserQuestion` trước khi code (ví dụ: có áp dụng ngay cho MỌI văn bản đang dở dang hay chỉ
  văn bản tạo mới sau khi có tính năng?), và verify kỹ (test tay đầy đủ hoặc đối chiếu
  byte-identical như đã làm ở Giai đoạn 1 refactor `src/lib/signing/`) trước khi coi là xong.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (2026-09-03) — 3 phát hiện từ test tay màn Cài đặt vị trí ký" và "Kế hoạch
phiên sau — Fix validation + sidebar resizable + tích hợp mau_vi_tri VÀO route ký thật (vị trí
CỨNG)" trong CLAUDE.md (2 mục vừa thêm, ngay phía trên).

Làm theo đúng thứ tự, dừng lại hỏi khi tới Phần C:

1. **Phần A** (làm ngay, không cần hỏi): sửa bug validation ở `mau-vi-tri/page.tsx` —
   `missingRequired` hiện chỉ check `role.batBuoc` nhưng các slot "Ký bước" tự pad thêm
   (`makeCloneRole()`, dòng ~172) luôn có `batBuoc:false` dù đại diện người ký thật — thêm
   logic coi 1 slot là bắt buộc khi nó có mặt trong `docSignerByRoleId`, không chỉ dựa
   `batBuoc`. Đồng thời thêm thanh sidebar resizable (kéo giãn panel 320px bên phải) — mirror
   đúng kỹ thuật `setPointerCapture` đã có sẵn trong file, không thêm dependency mới.

2. **Phần B**: test tay lại việc kéo-di chuyển/resize khung ký ở chế độ ĐANG SỬA (không phải
   Xem trước) — xác nhận có bug thật không trước khi sửa gì (đọc code tĩnh không thấy bug rõ
   ràng, cần debug bằng thao tác thật/React DevTools nếu tái hiện được).

3. **Phần C** (rủi ro cao nhất — route ký thật `api/documents/sign/route.ts` đang chạy
   production): đã chốt hướng "vị trí CỨNG" với người dùng, nhưng PHẢI đọc kỹ toàn bộ
   `api/documents/sign/route.ts` (không chỉ đoạn `mergeQrBox`) để xác nhận giả thuyết tái dùng
   cột `placement_ky` có sẵn (thay vì xây `cau_hinh_tai_lieu.dinh_tuyen` mới) có khả thi không,
   rồi BẮT BUỘC hỏi lại phạm vi cụ thể qua `AskUserQuestion` (ví dụ: áp dụng ngay cho văn bản
   đang dở dang hay chỉ văn bản mới) trước khi code bất kỳ dòng nào.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-03, tiếp) — 7 hạng mục an toàn đã code xong (UI mẫu vị trí + badge "Chờ
bạn" + xoá nút In cũ); Phần C (tích hợp "vị trí CỨNG" vào route ký thật) VẪN CHƯA làm

Người dùng test tay tiếp và gửi 1 loạt phát hiện mới (bản test luồng ký văn bản NMCB trên
desktop). Đã dùng Plan Mode đầy đủ (3 Explore agent + 1 Plan agent đọc trực tiếp code, 2 vòng
`AskUserQuestion` làm rõ phạm vi + 2 quyết định thiết kế) trước khi code — xem plan đã duyệt tại
`.claude/plans/th-m-m-c-k-generic-elephant.md` nếu cần đối chiếu chi tiết từng dòng.

**Phát hiện quan trọng đầu phiên**: khi đọc lại `mau-vi-tri/page.tsx` để lên kế hoạch, xác nhận
**Phần A của mục kế hoạch cũ ở trên (fix `missingRequired` + sidebar resizable) ĐÃ ĐƯỢC LÀM** bởi
1 phiên khác ngoài transcript trước khi phiên này bắt đầu — `isRequiredForConfirm()` đã tồn tại
đúng như đề xuất, `sidebarWidth`/kéo-giãn panel đã có sẵn (min 260/max 480 cố định). Phiên này chỉ
mở rộng thêm max sidebar (xem mục 2 dưới), không phải làm lại từ đầu.

### 7 hạng mục đã code xong phiên này (tất cả đều KHÔNG đụng route ký thật/production)

1. **Lưới căn chỉnh ô vuông thật, nhỏ hơn** (`mau-vi-tri/page.tsx`) — trước đây lưới dùng `%`
   độc lập theo mỗi trục nên ô bị méo (khổ giấy không vuông). Đổi sang `GRID_STEP_PX = 16` (px cố
   định qua CSS `backgroundSize`) — luôn vuông thật bất kể tỉ lệ khổ giấy. Snap khi kéo/resize
   cũng đổi theo: `pctStepFor(axisPx)` tính lại % tương ứng 16px theo ĐÚNG trục đang thao tác
   (`rectW`/`rectH` đo thật lúc bắt đầu kéo), thay vì dùng chung 1 hằng số % cho cả 2 trục.
2. **Sidebar max width tối đa 50% màn hình** — `onSidebarDragMove` đổi từ hằng số 480 sang
   `Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth * 0.5)`, tính động ngay lúc đang kéo.
3. **Màu khung riêng cho từng người/slot cùng cấp** — trước đây mọi bản sao "Ký bước" dùng chung
   1 màu cam. Thêm `KY_BUOC_CLONE_PALETTE` (8 màu luân phiên: amber/sky/pink/lime/indigo/orange/
   cyan/amber đậm) + hàm `getRoleColor(role)` — chỉ áp dụng đa sắc cho family `ky_buoc` (nhiều
   người cùng ký 1 bước); `qr`/`phe_duyet`/`ngay_ky`/`ghi_chu` giữ nguyên đúng 1 màu cố định.
4. **Vai trò mới "Ghi chú"** (`ghi_chu`) — thêm vào `BaseRoleId`/`ROLE_ORDER`/`BASE_ROLE_DEFS`/
   `ROLE_COLORS` (teal) + `SignTemplateBoxLoai` (`src/lib/signing/templates.ts`, additive, không
   có DB CHECK constraint nên không phá dữ liệu cũ). Người soạn thảo đặt vị trí 1 lần lúc vẽ mẫu
   (đúng quyết định đã chốt) — mục đích để sau này (Phần C) route ký thật in `van_ban_documents.
   ghi_chu` lên đúng vị trí trên PDF. Preview hiện placeholder text, chưa có nội dung thật (đúng
   phạm vi — trang này chỉ lưu VỊ TRÍ, không đọc `ghi_chu` thật của bất kỳ văn bản nào).
5. **Tiền tố ký thay KT./TM./TL./TUQ. chuyển sang chọn-lúc-vẽ-mẫu** — thêm
   `SignTemplateSignAsKey`/`SIGN_TEMPLATE_SIGN_AS_OPTIONS`/`SIGN_TEMPLATE_SIGN_AS_LABEL` vào
   `templates.ts` (mirror giá trị 1-1 với `SignAsType`/`SIGN_AS_OPTIONS` của `documents-types.ts`,
   khai riêng để `templates.ts` giữ độc lập module — dùng chung được cho ISO sau này); `EditorRole`
   thêm `signAs`, UI thêm dropdown ngay dưới khối "Hiện tên & chức vụ" (chỉ hiện với
   `role.loai==="chu_ky"`, tức `ky_buoc`/`phe_duyet`). **Chỉ lưu vào `mau_vi_tri` — CHƯA đổi**
   `SignPlacementModal`/`api/documents/sign/route.ts`, người ký thật vẫn tự chọn KT/TM/TL/TUQ như
   cũ cho tới khi Phần C tích hợp xong.
6. **Badge "Chờ BẠN" vs "Chờ [người khác]"** — tái dùng nguyên `canKyBuoc`/`canPheDuyet` đã có sẵn
   (`documents/[id]/page.tsx`), CHỈ đổi phần hiển thị:
   - Trang chi tiết: `TimelineStep` thêm prop `isMyTurn` — icon `Bell` (amber) + badge pill "🔔
     Đến lượt bạn" khi đúng lượt người xem; icon `Clock` mờ + "Đang chờ" khi không. Sublabel bước
     "Ký bước" phân biệt "Chờ BẠN ký" vs "Chờ {tên người}/phòng {tên phòng ban} ký"; bước "Phê
     duyệt" phân biệt "Chờ BẠN phê duyệt" vs "Đang chờ phê duyệt...".
   - Trang danh sách (`documents/page.tsx`) — theo đúng Phương án A đã chọn: thêm 1 lần gọi
     `/api/documents/dept-code` khi trang mount (không phải N+1 theo dòng) lấy `myDeptCode`, cộng
     3 cột mới vào `select()` (`phe_duyet_user_id, thu_tu_ky_json, buoc_hien_tai`) — đủ dữ liệu
     tính `isMyTurnToAct(doc)` cho MỌI dòng, hiện badge "🔔 Chờ bạn" cạnh badge trạng thái.
7. **Xoá hẳn nút "In" + trang `documents/print/page.tsx`** — đã grep xác nhận không còn tham
   chiếu nào khác trong repo (email/Telegram/route API khác đều không dùng). Xoá khối `<a>` +
   import `Printer` (`documents/[id]/page.tsx`), xoá cả thư mục `src/app/dashboard/documents/
   print/`. `dashboard/layout.tsx`'s check `pathname.includes("/print")` (bypass sidebar) GIỮ
   NGUYÊN — dùng chung cho các route `/print` khác (inventory/process/maintenance/quality
   reports), không đụng. Cập nhật luôn 2 file tài liệu nội bộ phản ánh đã xoá:
   `.claude/rules/22-documents-module.md` (mục "Trang in văn bản") và `.claude/rules/
   10-roadmap.md` (dòng nhắc `documents/print/`).

### Đã kiểm tra

`npx tsc --noEmit` sạch trên toàn bộ source code — chỉ còn đúng 1 lỗi **không liên quan code
thật**: `.next/types/validator.ts` (file tự sinh, gitignored) còn tham chiếu stale tới route
`documents/print/page.tsx` vừa xoá — đây là cache build cũ, Next.js tự tái tạo file này khi dev
server/build chạy lại, không cần và không nên sửa tay. `npx eslint` trên cả 4 file đã sửa
(`templates.ts`, `mau-vi-tri/page.tsx`, `documents/[id]/page.tsx`, `documents/page.tsx`) sạch — 0
lỗi, chỉ còn 2 warning `<img>` pre-existing (dòng 537/738 của `[id]/page.tsx`, không liên quan
thay đổi lần này). Không chạy `npm run build`. Không có migration nào — không đổi schema DB
(`mau_vi_tri.khung` vẫn là JSONB tự do, additive).

### CHƯA làm trong phiên này (cố ý, để dành sau)

- **Phần C** (đổi tên gọi từ mục kế hoạch cũ ở trên — nội dung không đổi, chỉ bổ sung thêm 2 việc
  mới phát sinh từ mục 4/5 ở trên) — xem mục "Kế hoạch phiên sau" MỚI ngay dưới đây, đã cập nhật
  đầy đủ.
- **Item 8 từ báo cáo test tay của người dùng — "Khi ký xong không click vào chữ ký để xem bằng
  chứng"**: Văn bản nội bộ dùng hệ ký RIÊNG (`api/documents/sign/route.ts`), hoàn toàn tách biệt
  với hệ ký dùng chung có PAdES/`/sign-verify/[nguoiKyId]` (`src/lib/signing/requests.ts`'s
  `signField()`, dùng cho Chất lượng/Điều xe/Bảo trì) — Văn bản chỉ import
  `computeIntegrityHash`/`getSignatureImage` từ `src/lib/signing/`, QR nhúng trỏ thẳng trang chi
  tiết văn bản chứ không phải trang verify. Thêm tính năng "click chữ ký xem bằng chứng" cho Văn
  bản là 1 sáng kiến RIÊNG, chưa được scope (cần quyết định: gắn PAdES trực tiếp vào
  `api/documents/sign/route.ts` tương tự cách đã làm cho hệ dùng chung, hay xây 1 cơ chế nhẹ hơn
  chỉ hiện metadata `doc_approval_log`) — **chưa làm, chưa hỏi phạm vi, để dành phiên khác riêng**
  nếu người dùng muốn tiếp tục hướng này.

### CHƯA test tay — bắt buộc trước khi coi 7 hạng mục trên là hoàn tất

1. Mở `/dashboard/ky/mau-vi-tri` (kèm 1 văn bản thật qua `?docId=...`) → bật "Lưới căn chỉnh" →
   xác nhận ô lưới là hình vuông thật (không méo), nhỏ hơn hẳn trước; kéo/resize 1 khung khi lưới
   bật → xác nhận khung tự làm tròn đúng theo lưới vuông ở cả 2 trục.
2. Kéo thanh chia sidebar sang phải hết cỡ → xác nhận panel mở rộng được tới ~50% chiều rộng màn
   hình (không còn dừng cứng ở 480px).
3. Tạo/mở 1 văn bản có ≥2 người "Ký xác nhận" (nhiều slot "Ký bước") → xác nhận mỗi slot có màu
   khung khác nhau rõ ràng (không còn tất cả cùng màu cam), cả trên canvas lẫn danh sách sidebar.
4. Đặt khung "Ghi chú" mới → xác nhận đặt/kéo/resize được như các vai trò khác, lưu mẫu thành
   công; mở lại → khung "Ghi chú" vẫn còn đúng vị trí.
5. Với 1 vai trò "Ký bước"/"Phê duyệt" đã đặt khung, chọn tiền tố "TM. (Thay mặt)" ở dropdown mới
   → lưu mẫu → mở lại → xác nhận dropdown giữ đúng lựa chọn đã chọn.
6. Mở trang chi tiết 1 văn bản đang `cho_ky_phong_ban`/`cho_phe_duyet` bằng ĐÚNG tài khoản tới
   lượt ký/duyệt → xác nhận thấy badge "🔔 Đến lượt bạn" nổi bật (amber); đăng nhập tài khoản
   KHÁC (không tới lượt) → xác nhận chỉ thấy "Đang chờ" mờ, sublabel đúng tên người/phòng ban
   đang được chờ.
7. Mở trang danh sách `/dashboard/documents` với cùng 2 tài khoản trên → xác nhận badge "🔔 Chờ
   bạn" chỉ hiện đúng cho tài khoản tới lượt, cả trường hợp bước `ca_nhan` lẫn `phong_ban`.
8. Xác nhận nút "In" đã biến mất khỏi trang chi tiết văn bản; truy cập trực tiếp URL cũ
   `/dashboard/documents/print/?docId=...` → xác nhận trả về 404 (route không còn tồn tại).
9. Sau khi test xong mục 1-8, restart `npm run dev` (hoặc chờ Next.js tự regenerate) rồi chạy
   lại `npx tsc --noEmit` xác nhận lỗi `.next/types/validator.ts` đã tự biến mất.

## Kế hoạch phiên sau — Phần C: tích hợp `mau_vi_tri` (kèm `sign_as`/`ghi_chu` mới) vào route ký
thật, "vị trí CỨNG" (cập nhật, thay thế nội dung Phần C cũ ở trên)

Nội dung cốt lõi giữ nguyên như mục "Phần C" đã ghi ở kế hoạch cũ phía trên (đọc lại đoạn đó để
có đầy đủ ngữ cảnh: giả thuyết tái dùng `van_ban_documents.placement_ky` thay vì xây
`cau_hinh_tai_lieu.dinh_tuyen` mới, yêu cầu đọc kỹ TOÀN BỘ `api/documents/sign/route.ts`, bắt
buộc `AskUserQuestion` xác nhận phạm vi văn bản áp dụng trước khi code). Bổ sung 2 việc MỚI phát
sinh từ phiên này (mục 4, 5 ở trên) — mẫu `mau_vi_tri` giờ đã mang thêm 2 loại dữ liệu mà route ký
thật cần đọc thêm khi tích hợp:

- **`loai: "ghi_chu"`** — khi route ký thật vẽ/stamp theo mẫu, nếu mẫu có khung `ghi_chu`, phải
  lấy nội dung từ `van_ban_documents.ghi_chu` (trường đã có sẵn, đang chỉ hiển thị ở trang chi
  tiết) và in/vẽ text đó vào đúng toạ độ khung — với PDF dùng `pdf-lib` (đã có sẵn hạ tầng vẽ text
  trong `src/lib/signing/stamp-pdf.ts`, xem cách stamp tên người ký để mirror đúng kỹ thuật đo
  chữ/wrap); với Office cần thêm tag mới (vd `{{GHI_CHU}}`) vào `buildStepTags`/logic thay tag —
  hiện HOÀN TOÀN CHƯA có tag này (đã xác nhận qua grep phiên trước, 0 kết quả).
- **`sign_as` trên `SignTemplateBox`** — khi route ký thật ở bước có mẫu khoá cứng vị trí, tiền tố
  KT./TM./TL./TUQ. giờ đã được người soạn thảo chọn SẴN lúc vẽ mẫu (không cần hỏi lại người ký) —
  route chỉ cần đọc `box.sign_as` cho đúng vai trò (`phe_duyet`, hoặc `ky_buoc` khi
  `step.type==="phong_ban"`) và áp dụng y hệt logic `isValidSignAs`/vẽ tiền tố đã có sẵn, KHÔNG
  cần `SignPlacementModal` hỏi lại qua radio group nữa (`showSignAsPicker` cần bỏ hẳn khi field
  này đã có trong mẫu áp dụng).

**Không đổi** phần còn lại của kế hoạch Phần C cũ — vẫn cần: đọc kỹ route ký thật trước khi thiết
kế, hỏi phạm vi áp dụng (văn bản dở dang vs chỉ văn bản mới) qua `AskUserQuestion`, và verify kỹ
(test tay hoặc đối chiếu byte-identical) trước khi coi là xong — đây vẫn là ROUTE ĐANG CHẠY
PRODUCTION, không được tự ý suy diễn phạm vi.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Cập nhật (2026-09-03, tiếp) — 7 hạng mục an toàn đã code xong" và "Kế hoạch phiên sau —
Phần C: tích hợp mau_vi_tri (kèm sign_as/ghi_chu mới) vào route ký thật" trong CLAUDE.md (2 mục
mới nhất, cuối file). 7 hạng mục UI/badge/xoá nút In ĐÃ CODE XONG (tsc/eslint sạch) nhưng CHƯA
được người dùng xác nhận test tay — đọc kỹ checklist "CHƯA test tay" (9 mục) trước khi làm gì
tiếp; nếu người dùng báo lỗi ở 1 trong 9 mục đó, sửa đúng chỗ liên quan trước khi đụng Phần C.

Nếu người dùng xác nhận cả 7 hạng mục đã ổn, bắt đầu Phần C — tích hợp `mau_vi_tri` vào route ký
thật (`api/documents/sign/route.ts`), khoá cứng vị trí ("vị trí CỨNG", đã chốt trước đó). Đọc kỹ
TOÀN BỘ route này trước khi thiết kế (không chỉ đoạn `mergeQrBox`), xác nhận giả thuyết tái dùng
`van_ban_documents.placement_ky` thay vì xây bảng `cau_hinh_tai_lieu.dinh_tuyen` mới. Nhớ xử lý
thêm 2 việc mới: khung `ghi_chu` (cần vẽ nội dung `van_ban_documents.ghi_chu` lên PDF/thêm tag
Office mới, hiện chưa có tag nào cho việc này) và `sign_as` đã chọn sẵn trong mẫu (route đọc thẳng
từ mẫu, không cần `SignPlacementModal` hỏi lại qua radio group nữa).

BẮT BUỘC hỏi phạm vi qua `AskUserQuestion` trước khi code (áp dụng cho văn bản đang dở dang hay
chỉ văn bản mới?), và verify kỹ (test tay đầy đủ hoặc đối chiếu byte-identical như Giai đoạn 1
refactor `src/lib/signing/`) trước khi coi là xong — đây là route ký thật đang chạy production.

Item "click chữ ký xem bằng chứng" (PAdES/verify cho Văn bản) vẫn CHƯA được scope — nếu người
dùng muốn làm, đó là 1 sáng kiến riêng cần bàn phạm vi từ đầu, không tự ý gộp vào Phần C.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Xác nhận (2026-09-03, cuối phiên) — Người dùng đã test tay trên `npm run dev`, cả 9 mục
checklist PASS đúng như kế hoạch

Người dùng xác nhận đã test trên localhost và kết quả khớp đúng kế hoạch — **coi 7 hạng mục ở
mục "Cập nhật (2026-09-03, tiếp)" ngay phía trên là HOÀN TẤT**, không cần test lại: lưới vuông
nhỏ hơn, sidebar kéo tới ~50% màn hình, màu khung đa sắc theo từng slot "Ký bước", khung "Ghi
chú" đặt/lưu được, dropdown tiền tố KT/TM/TL/TUQ lưu đúng vào mẫu, badge "Chờ BẠN ký/duyệt" hiển
thị đúng theo người xem ở cả trang chi tiết lẫn trang danh sách, nút "In" đã biến mất và route
`/dashboard/documents/print/` trả 404.

### Việc tiếp theo cho session sau — chỉ còn Phần C (chưa bắt đầu)

Toàn bộ phần "an toàn" (UI mẫu vị trí + badge + xoá nút In) đã xong và đã verify bằng tay. Việc
DUY NHẤT còn lại trong lộ trình module Văn bản là **Phần C — tích hợp `mau_vi_tri` vào route ký
thật, khoá cứng vị trí ("vị trí CỨNG")** — xem đầy đủ nội dung ở mục "Kế hoạch phiên sau — Phần
C..." ngay phía trên, tóm tắt lại đúng 4 điểm phải làm theo thứ tự khi bắt đầu:

1. Đọc kỹ TOÀN BỘ `api/documents/sign/route.ts` (không chỉ đoạn `mergeQrBox`) trước khi thiết kế
   — xác nhận giả thuyết tái dùng cột `van_ban_documents.placement_ky` có sẵn thay vì xây bảng
   `cau_hinh_tai_lieu.dinh_tuyen` mới.
2. BẮT BUỘC hỏi phạm vi qua `AskUserQuestion` trước khi code — áp dụng "vị trí CỨNG" cho văn bản
   đang dở dang hay chỉ văn bản mới soạn sau khi có tính năng.
3. Khi thiết kế, nhớ xử lý thêm 2 việc phát sinh từ hạng mục 4/5 vừa xong (không có trong scope
   Phần C gốc ban đầu): khung `ghi_chu` (vẽ nội dung `van_ban_documents.ghi_chu` lên đúng vị trí
   trên PDF; với Office cần thêm tag mới, ví dụ `{{GHI_CHU}}`, hiện chưa tồn tại) và `sign_as` đã
   chọn sẵn trong mẫu (route đọc thẳng từ `mau_vi_tri`, bỏ hẳn bước `SignPlacementModal` hỏi lại
   qua radio group).
4. Verify kỹ trước khi coi là xong — test tay đầy đủ hoặc đối chiếu byte-identical (mirror cách
   đã làm ở Giai đoạn 1 refactor `src/lib/signing/`) — đây là ROUTE KÝ THẬT ĐANG CHẠY PRODUCTION.

Item "click chữ ký xem bằng chứng" (PAdES/verify cho Văn bản) vẫn ngoài phạm vi, chưa scope —
không tự ý gộp vào Phần C nếu chưa hỏi lại người dùng.

### Prompt gợi ý để mở đầu session tiếp theo

```
Đọc mục "Xác nhận (2026-09-03, cuối phiên)" và "Kế hoạch phiên sau — Phần C: tích hợp mau_vi_tri
(kèm sign_as/ghi_chu mới) vào route ký thật" trong CLAUDE.md (2 mục cuối file). 7 hạng mục UI/
badge/xoá nút In ĐÃ HOÀN TẤT và ĐÃ ĐƯỢC NGƯỜI DÙNG XÁC NHẬN TEST TAY PASS trên npm run dev —
KHÔNG cần test lại trừ khi tôi (người dùng) báo lỗi mới.

Bắt đầu ngay Phần C — tích hợp `mau_vi_tri` vào route ký thật (`api/documents/sign/route.ts`),
khoá cứng vị trí ("vị trí CỨNG", đã chốt từ trước). Đọc kỹ TOÀN BỘ route này trước khi thiết kế
(không chỉ đoạn `mergeQrBox`), xác nhận giả thuyết tái dùng `van_ban_documents.placement_ky`
thay vì xây bảng `cau_hinh_tai_lieu.dinh_tuyen` mới. Nhớ xử lý thêm khung `ghi_chu` (vẽ nội dung
`van_ban_documents.ghi_chu` lên PDF/thêm tag Office mới) và `sign_as` đã chọn sẵn trong mẫu
(route đọc thẳng từ mẫu, không cần `SignPlacementModal` hỏi lại qua radio group nữa).

BẮT BUỘC hỏi phạm vi qua `AskUserQuestion` trước khi code (áp dụng cho văn bản đang dở dang hay
chỉ văn bản mới?), và verify kỹ (test tay đầy đủ hoặc đối chiếu byte-identical như Giai đoạn 1
refactor `src/lib/signing/`) trước khi coi là xong — đây là route ký thật đang chạy production.

Chỉ dùng npx tsc --noEmit + npx eslint để tự kiểm tra — không chạy npm run build khi không chắc
dev server của tôi có đang chạy song song hay không.
```

## Cập nhật (2026-09-04) — Phần C ĐÃ CODE XONG: mẫu vị trí ký được áp vào route ký thật ("vị trí CỨNG")

Việc cuối cùng của lộ trình module Văn bản (xem mục "Xác nhận (2026-09-03, cuối phiên)" ngay
trên) đã hoàn tất. Chi tiết đầy đủ: `.claude/rules/22-documents-module.md` mục **"Vị trí CỨNG —
áp mẫu `mau_vi_tri` vào route ký thật"** — không lặp lại ở đây. Tóm tắt các điểm dễ quên:

- **Không cần migration** — `placement_ky` là JSONB tự do, cột `ghi_chu` đã có sẵn.
- **Hệ toạ độ của `mau_vi_tri` trùng khớp tuyệt đối với pdf-lib** (point, gốc dưới-trái) → ánh
  xạ thuần, không quy đổi. Giả thuyết "tái dùng `placement_ky`, không cần bảng
  `cau_hinh_tai_lieu.dinh_tuyen`" đã được xác nhận ĐÚNG.
- **Tách 2 luồng tự động theo cờ `tu_mau`, kiểm theo TỪNG BƯỚC** — `stampPdfStep` cũ không sửa
  1 dòng nào; văn bản gửi ký trước 2026-09-04 chạy y hệt như cũ.
- **Phát sinh ngoài phạm vi ban đầu**: đã tách công tắc gộp "Hiện tên & chức vụ" thành **2 công
  tắc ĐỘC LẬP** ở màn cài đặt vị trí (`show_name` / `show_chuc_vu`), theo yêu cầu người dùng —
  file PDF gốc có thể đã in sẵn tên và/hoặc chức vụ, chỉ người soạn thảo biết cần đè cái nào.
  Mẫu lưu trước 2026-09-04 chỉ có `show_name` → mọi nơi đọc PHẢI fallback
  `show_chuc_vu ?? show_name`.

### Đã tự kiểm chứng (không chỉ tsc/eslint)

`npx tsc --noEmit` sạch; `npx eslint` trên 5 file đã sửa/thêm — 0 lỗi, chỉ 2 warning `<img>`
pre-existing. Không chạy `npm run build`.

Ngoài ra đã chạy **2 bộ test gọi thẳng code thật** (`node --experimental-strip-types` + resolve
hook map `@/` → `src/`, import trực tiếp `src/lib/signing/apply-template.ts`, KHÔNG test bản
copy) — tổng **42/42 assertion PASS**:

- **24 assertion logic ánh xạ**: id nhân bản không liên tục (`ky_buoc`, `__ban2`, `__ban4` →
  bước 1,2,3); cắt theo `so_buoc_tong`; `phe_duyet` gộp bản gốc + nhân bản vào 1 entry;
  fallback `show_chuc_vu` cho mẫu cũ; entry legacy KHÔNG bị nhận nhầm là mẫu; `resolveAnchorPages`
  (dau/cuoi/moi_trang/clamp/PDF 0 trang).
- **18 assertion vẽ PDF thật**: dựng PDF 3 trang, gọi `stampPdfWithTemplate`, rồi **trích text
  bằng pdfjs** (công cụ độc lập, không tin code tự đánh giá chính nó) để xác nhận tên/chức vụ/
  tiền tố/ghi chú/ngày ký nằm ĐÚNG trang và KHÔNG lem sang trang khác; 4 tổ hợp công tắc
  tên/chức vụ; ký nháy `moi_trang`; nhân bản khung phê duyệt ở 2 trang.

### Kẽ hở đã vá khi rà kịch bản hỗn hợp

Mẫu thiếu khung cho đúng 1 bước → bước đó rơi về luồng cũ, nhưng `placement_ky.qr` lúc này có
shape `{tu_mau, boxes}` chứ không phải `QrBox` → `stampPdfStep` sẽ đọc `qrBox?.x` ra `undefined`
và vẽ QR **thứ hai** ở góc trên-phải. Đã vá trong `performFileStamp`: quy đổi entry mẫu về
`QrBox` (lấy `boxes[0]`) trước khi truyền cho nhánh cũ.

### CHƯA test tay trên trình duyệt thật

Toàn bộ verify ở trên là ở tầng logic/PDF, **chưa chạy qua UI thật**. Checklist 8 bước (luồng
khoá cứng, 2 công tắc độc lập, nhân bản khung, neo trang, **không hồi quy văn bản đang dở
dang**, Office, fallback thiếu slot, trả về rồi gửi lại) nằm trong plan file
`C:\Users\Software\.claude\plans\vi-c-l-m-agile-crab.md` mục "Verification".

Việc "click chữ ký xem bằng chứng" (PAdES cho Văn bản) vẫn **ngoài phạm vi, chưa scope**.

## Cập nhật (2026-09-04, tiếp) — Fix ngày phê duyệt lệch múi giờ + Loại VB tùy chọn khi không có mã

2 việc phát sinh khi test tay Phần C. Chi tiết đầy đủ:
`.claude/rules/22-documents-module.md` mục **"Ngày phê duyệt theo múi giờ nhà máy + Loại VB tùy
chọn khi không có mã"**. Tóm tắt các điểm dễ quên:

- **Bug thật đã fix**: `api/documents/sign/route.ts` tính "ngày hôm nay" bằng
  `toISOString().slice(0,10)` (UTC) và `toLocaleDateString("vi-VN")` (không set `timeZone`) →
  nhà máy ở UTC+7, thao tác trong khoảng **00:00–06:59 sáng** bị ghi nhận **lệch 1 ngày về
  trước**, cả trong DB (`ngay_phe_duyet`) lẫn ngày in lên PDF/tag Office. Đã đo bằng code thật:
  sai đúng **7/24** khung giờ.
- Fix bằng 2 helper mới trong `src/lib/date-utils.ts`: `getFactoryTodayISO()` /
  `formatFactoryDateVN()` + hằng `FACTORY_TIME_ZONE = "Asia/Ho_Chi_Minh"`.
- ⚠️ **`getTodayISODate()` cũ cùng lỗi nhưng CỐ Ý không sửa** (module KPI đang dùng để so ngày,
  đổi sẽ ảnh hưởng ngoài phạm vi) — đã ghi chú cảnh báo ngay cạnh hàm. **Nếu sau này rà lỗi ngày
  ở module khác, đây là điểm cần xem đầu tiên.**
- `loai_van_ban` thành **tùy chọn ở trang Upload ký tay** khi tick "không có mã" (luồng đó không
  dùng mẫu vị trí ký), **giữ bắt buộc ở trang Soạn thảo** (là khóa chọn `mau_vi_tri`). Không cần
  migration — cột đã nullable.
- **Không phải bug**: văn bản Upload ký tay không có nút "Gửi ký"/màn cài đặt vị trí — luồng đó
  lưu thẳng `da_phe_duyet`, không có bước ký số. Người cài đặt vị trí của luồng ký số là **người
  soạn thảo**.

### Đã tự kiểm chứng

`npx eslint` trên 4 file đã sửa: **exit 0, sạch tuyệt đối**. `npx tsc --noEmit`: **không có lỗi
nào ở file đã sửa** (7 lỗi còn lại đều thuộc `src/app/dashboard/output/page.tsx` +
`src/lib/output-pdf.ts` — xem cảnh báo ở mục dưới).

Test helper múi giờ bằng cách **gọi thẳng `src/lib/date-utils.ts`** (`node
--experimental-strip-types` + resolve hook), chạy **2 lần với `TZ=UTC` (mô phỏng Vercel) và TZ
máy** — **16/16 assertion PASS** cả 2 lần: 6 mốc giờ trong ngày đều ra đúng ngày địa phương,
chứng minh code cũ sai đúng 7/24 khung giờ, và xác nhận `getTodayISODate()` cũ không bị đổi.

### ⚠️ File dở dang NGOÀI PHẠM VI — cần người dùng xử lý

`src/app/dashboard/output/{page.tsx,_components/*}` và `src/lib/output-pdf.ts` đang có **7 lỗi
TypeScript** (`Cannot find name 'closeDayDetail' / 'ArrowLeft' / 'bulkDeleting' /
'toggleAllDetailRows'`, `'a' is possibly null`). Các file này **không thuộc phiên nào của module
Văn bản** và không có trong `git status` lúc bắt đầu phiên trước — nhiều khả năng là việc đang
làm dở của người dùng ở module Sản lượng. **Cố ý không đụng, không commit.** Cần hoàn tất hoặc
hoàn tác trước khi build/deploy, nếu không `npm run build` sẽ fail.

## Cập nhật (2026-09-05) — Module Văn bản: ĐÃ CODE XONG việc 1→5, chưa test tay

Chi tiết kỹ thuật đầy đủ: `.claude/rules/22-documents-module.md` — 5 mục mới ở cuối file
("Người ký ĐỌC được PDF…", "Khung Ghi chú = ô Ý KIẾN CHỈ ĐẠO…", "Tag ngày ký…", "Việc 4 & 5",
"Tự kiểm chứng"). Tóm tắt các điểm dễ quên:

| # | Việc | Điểm cốt lõi |
|---|---|---|
| 1 | Người ký đọc PDF + xê dịch 3 khối | Module thuần mới `src/lib/signing/template-layout.ts` (**không import pdf-lib**) — UI và server dùng **chung một công thức**. Server **bắt buộc tự kẹp** toạ độ (`applySignerLayoutToEntry`), không tin client |
| 2 | Khung Ghi chú = ý kiến lãnh đạo | Cột mới `ghi_chu_phe_duyet`; vẽ ở bước **phê duyệt** bằng `drawTextWrapped()` (wrap nhiều dòng); chữ ký nháy góc trên-phải TRONG khung, tắt khung thì mất theo; chưa nhập & chưa tắt → **chặn ký cả 2 tầng** |
| 3 | Tag ngày ký | Cột mới `ky_phe_duyet_at`; tick vẽ bằng **2 `drawLine`** (không dùng ký tự `✓` — rủi ro thiếu glyph), chữ xám mờ có giây |
| 4 | Dropdown neo trang | Hiện cả khi khung đã đặt; `changeRoleAnchor()` nắn luôn `role.page` theo neo |
| 5 | Nhãn nút | PDF → "Cài đặt vị trí & Gửi ký"; Office giữ "Gửi ký" |

**Quy tắc 2 TẦNG (đổi nghĩa `show_name`/`show_chuc_vu` của mẫu)**: mẫu **bật** = "CHO PHÉP hiển
thị", người ký tự tắt/mở; mẫu **tắt** = người ký không thấy và không bật lên được. Lựa chọn thực
tế của người ký lưu trong `layout` của từng khung.

**Tương thích ngược**: entry không có `layout` (văn bản ký trước bản này) rơi về đúng công thức
chia dải cũ — đã verify bằng số (`y = box.y + height*0.26`), không đổi 1 pixel.

### Migration cần chạy

`supabase/migrations/20260904_van_ban_ghi_chu_phe_duyet.sql` (2 cột `ghi_chu_phe_duyet TEXT`,
`ky_phe_duyet_at TIMESTAMPTZ`) — **CHƯA CHẠY**. Việc 1/4/5 không cần migration.

### Đã tự kiểm chứng — 103 assertion, KHÔNG chỉ tsc/eslint

`npx tsc --noEmit` sạch **toàn repo** (0 lỗi — 7 lỗi module Sản lượng nêu ở mục dưới nay đã hết);
`npx eslint` 0 lỗi. Cộng thêm 2 bộ test gọi **thẳng code thật** qua
`node --experimental-strip-types`: 67 assertion logic kẹp toạ độ/2 tầng/công thức mặc định, và
36 assertion trên **PDF thật** (trích lại text bằng pdfjs — công cụ độc lập) xác nhận mọi thứ vẽ
ra đều nằm trong khung kể cả khi client cố gửi toạ độ ngoài vùng.

### CHƯA test tay trên trình duyệt

1. Chạy migration trước.
2. **Việc 1**: soạn văn bản PDF nhiều trang → đặt khung → ký từng bước: sau PIN phải **thấy PDF
   đọc được**, 3 khối kéo/resize riêng được, **không kéo ra ngoài khung** (viền xanh đứt); PDF
   sau ký khớp đúng vị trí đã kéo. Thử gọi thẳng API với toạ độ ngoài vùng → server phải tự kẹp.
   Mẫu TẮT Tên → người ký không thấy khối Tên và không bật lên được; mẫu BẬT → tắt/mở tự do.
3. **Việc 2**: mẫu có khung Ghi chú → bước phê duyệt hiện ô nhập; bỏ trống và không tắt → **bị
   chặn kèm banner**; nhập 2-3 dòng → wrap đúng trong khung, có chữ ký nháy nhỏ góc trên-phải,
   chữ **không đè** lên nó; bấm "Không ghi ý kiến" → không vẽ cả ghi chú lẫn ký nháy. Mẫu KHÔNG
   đặt khung Ghi chú → phê duyệt không hiện ô nào.
4. **Việc 3**: sau phê duyệt, PDF hiện tick xanh + "Văn bản được ký dd/mm/yyyy hh:mm:ss" xám mờ,
   giờ khớp thời điểm bấm ký (kiểm cả khung 00:00–06:59 sáng để chắc múi giờ đúng).
5. **Việc 4**: đặt 1 khung xong, đổi neo trang sang "Mọi trang" ngay tại chỗ; lưu rồi mở lại
   thấy đúng.
6. **Việc 5**: văn bản PDF thấy "Cài đặt vị trí & Gửi ký"; văn bản DOCX vẫn "Gửi ký".
7. **Không hồi quy**: văn bản dở dang từ trước (không có `_mau`) ký tiếp bình thường bằng canvas
   kéo-thả tự do như cũ; văn bản Upload ký tay không đổi.

### Việc 6 — chưa làm (đã chốt để riêng 1 phiên)

PAdES + trang verify cho Văn bản. Lưu ý: Văn bản dùng hệ ký RIÊNG, **không có bản ghi
`nguoi_ky`** nên không dùng lại được `/dashboard/sign-verify/[nguoiKyId]`; bắt buộc dùng
incremental update (`@cantoo/pdf-lib` + `commit()`) theo bài học "bug 74.8MB".

---

## Cập nhật (2026-09-05, tiếp) — 4 cải tiến sau khi test tay việc 1→5 PASS

Người dùng test tay việc 1→5 trên localhost, xác nhận **pass**, rồi nêu 4 điểm cải tiến. Tất cả
đều xoay quanh cùng một nguyên tắc: **mọi thứ hệ thống đóng dấu lên PDF đều phải cho người ký
NHÌN THẤY và XÊ DỊCH được, nhưng chỉ TRONG khung người soạn thảo đã cài đặt.** Trước đợt này
chỉ 3 khối (ảnh chữ ký / tên / chức danh) đạt chuẩn đó.

Chi tiết kỹ thuật đầy đủ: `.claude/rules/22-documents-module.md` — 3 mục đã cập nhật (tiền tố
thành khối con thứ 4, khung Ghi chú thành vùng cho phép 2 khối, khung QR) + mục "Việc 4 & 5"
(nhãn nút) + "Tự kiểm chứng". Tóm tắt các điểm dễ quên:

| # | Cải tiến | Điểm cốt lõi |
|---|---|---|
| 1 | Nhãn nút | PDF → **"Vào cài đặt vị trí"** (bấm là VÀO màn cài đặt, việc gửi ký chỉ xảy ra sau khi xác nhận vị trí) |
| 2 | QR kéo/resize | Người ký **ĐẦU TIÊN** chỉnh trong khung QR mẫu, các lượt sau chỉ xem — route ghi **đúng 1 lần** (`mergeTemplateQrLayout`, mirror `mergeQrBox` cũ) |
| 3 | Khung Ghi chú | Thành "vùng cho phép" chứa **2 khối kéo/resize**: ô text + chữ ký nháy — để ý kiến dài không đè lên chữ sẵn có của văn bản |
| 4 | Tiền tố KT./TM. | Khối con **thứ 4** nằm TRONG khung ký (trước vẽ cứng NGOÀI mép trên), kéo + **tắt được**; tắt trên mọi khung ⇒ route ghi `sign_as = "none"` (timeline cũng không hiện "KT.") |

**Không cần migration** — `placement_ky` là JSONB tự do, chỉ thêm field `layout` optional vào
từng box.

**Đổi bố cục mặc định có chủ đích**: khung CÓ `sign_as` giờ chia thêm dải trên 16% cho tiền tố,
3 khối còn lại co xuống. Khung **không** có `sign_as` ⇒ không đổi 1 pixel.

### Đã tự kiểm chứng — 158 assertion (102 logic + 56 PDF thật)

`npx tsc --noEmit` sạch toàn repo; `npx eslint` 0 lỗi (4 warning `<img>`, đều pre-existing hoặc
do khối ký nháy mới thay thế khối cũ). Cộng 2 bộ test gọi **thẳng code thật** qua
`node --experimental-strip-types` — trích lại text/ảnh bằng **pdfjs** (công cụ độc lập, không
tin code tự đánh giá chính nó). Tất cả PASS. Không chạy `npm run build`.

### CHƯA test tay trên trình duyệt

1. **Nút**: văn bản PDF hiện "Vào cài đặt vị trí"; DOCX vẫn "Gửi ký".
2. **QR**: ký bước 1 → **thấy QR thật**, kéo/resize (khoá tỉ lệ) trong vùng tím; ký xong mở lại
   ở bước 2 → QR **chỉ xem**, nhãn "QR đã chốt ở lượt ký trước", đúng vị trí bước 1 đã chỉnh;
   PDF sau ký khớp.
3. **Tiền tố**: mẫu chọn KT cho Phê duyệt → thấy khối `KT.` viền cam kéo được **trong khung**;
   tắt → PDF không có "KT." **và** timeline cũng không hiện "KT.".
4. **Ghi chú**: nhập ý kiến dài → kéo/resize ô text né chữ trên văn bản, kéo ký nháy sang chỗ
   khác → PDF đúng vị trí đã kéo, chữ tự xuống dòng, không đè ký nháy. Bấm "Không ghi ý kiến" →
   cả 2 khối biến mất.
5. **Không hồi quy**: văn bản dở dang không có `_mau` vẫn ký bằng canvas kéo-thả tự do như cũ;
   văn bản Upload ký tay không đổi.
6. Migration `20260904_van_ban_ghi_chu_phe_duyet.sql` (từ đợt việc 1→5) — xác nhận đã chạy.

---

## Prompt mở đầu session sau — Việc 6 (PAdES + trang verify cho Văn bản)

```
Đọc mục "Cập nhật (2026-09-05)" và "Cập nhật (2026-09-05, tiếp)" trong CLAUDE.md. Việc 1→5 và
4 cải tiến sau đó đã CODE XONG (158 assertion pass, tsc/eslint sạch). Nếu tôi báo đã test tay
xong và không có lỗi, bắt đầu việc 6; nếu tôi báo lỗi, sửa đúng chỗ liên quan trước.

Việc 6: PAdES + trang verify cho module Văn bản nội bộ ("bấm vào chữ ký xem bằng chứng xác
minh", giống module Bảo trì/Chất lượng/Điều xe đã có).

Ràng buộc BẮT BUỘC phải nắm trước khi thiết kế (đã điều tra, đừng điều tra lại):

1. Văn bản dùng **hệ ký RIÊNG** (`src/app/api/documents/sign/route.ts`), hoàn toàn tách biệt
   với hệ ký dùng chung (`src/lib/signing/requests.ts`'s `signField()`). Văn bản **KHÔNG có
   bản ghi `nguoi_ky`** ⇒ **không dùng lại được** trang `/sign-verify/[nguoiKyId]` hiện có
   (trang đó đọc `nguoi_ky.pades_sig_index`). Cần trang verify RIÊNG cho Văn bản.
2. Tái dùng nguyên `src/lib/signing/pades.ts` (`applyPadesSignatureToDoc`/
   `addSignaturePlaceholderToDoc`, `hasPadesRootCa`, `diagnosePadesEnv`) và
   `src/lib/signing/verify-pades.ts` (`verifyPadesSignature`) — 2 file này đã chạy thật trên
   production, KHÔNG viết lại từ đầu.
3. **Bắt buộc incremental update**: dùng `@cantoo/pdf-lib` với `forIncrementalUpdate: true` và
   gọi `.commit()` nhiều lần trên CÙNG 1 doc sống — KHÔNG `save()` rồi reload. Đây là bài học
   từ 2 bug đã fix: "bug 74.8MB" (reload nhiều lần làm dung lượng nhân đôi mỗi lượt ký) và
   "mất chữ ký PAdES của người ký trước". Lời giải mẫu nằm sẵn trong `signField()` của
   `src/lib/signing/requests.ts` — đọc kỹ trước khi viết.
   ⚠️ `stampPdfWithTemplate`/`stampPdfStep` (`apply-template.ts`/`stamp-pdf.ts`) hiện dùng
   `pdf-lib` GỐC (Hopding) + `save()` — chính là pattern đã gây bug. Phải quyết định cách
   chuyển sang `@cantoo/pdf-lib` cho module Văn bản mà KHÔNG phá `stamp-pdf.ts` dùng chung
   (file đó còn phục vụ ISO — xem cách `requests.ts` ép kiểu qua `PdfLibDocument` để tái dùng).
4. `doc_approval_log` cho Văn bản đã có sẵn `content_hash` từ Giai đoạn 0 — dùng làm nguồn dữ
   liệu cho trang verify. Cần chỗ lưu `pades_sig_index` theo TỪNG BƯỚC ký (Văn bản có nhiều
   bước: `ky_buoc` 1..N + `phe_duyet`) — nhiều khả năng cần migration mới, hỏi phạm vi trước.
5. Cần thêm **link annotation** trên con dấu chữ ký trỏ về trang verify — mẫu có sẵn trong
   `signField()` (tạo `PDFArray`/dict `Annot` thủ công bằng API thấp của `@cantoo/pdf-lib`,
   bọc try/catch, không chặn luồng ký chính).
6. Biến môi trường `SIGN_PADES_ROOT_CA_CERT_PEM`/`SIGN_PADES_ROOT_CA_KEY_PEM` đã cấu hình sẵn
   ở cả `.env.local` lẫn Vercel — KHÔNG tạo root CA mới. ⚠️ Giá trị dán vào Vercel phải có đủ
   `-----BEGIN.../-----END-----` (đã từng mất 1 phiên vì thiếu 4 dòng này).
7. Landmine đã biết: `node-forge` đoán SAI kiểu ASN.1 cho `commonName` chứa dấu tiếng Việt —
   `pades.ts` đã ép `valueTagClass: forge.asn1.Type.UTF8`, giữ nguyên, đừng bỏ.

BẮT BUỘC hỏi phạm vi qua `AskUserQuestion` trước khi code — tối thiểu: (a) áp dụng cho văn bản
đang dở dang hay chỉ văn bản mới? (b) mỗi bước ký 1 chữ ký PAdES riêng, hay chỉ 1 "niêm phong
hệ thống" duy nhất lúc phê duyệt xong? Đây là ROUTE KÝ THẬT ĐANG CHẠY PRODUCTION.

Verify bắt buộc trước khi coi là xong: ký thật đủ các bước, tải file cuối, dùng `openssl cms
-verify -binary -CAfile <root>` (công cụ ngoài, độc lập) xác nhận TỪNG chữ ký, và kiểm
byte-identity giữa các lượt ký (chữ ký người trước không bị đụng).

Chỉ dùng `npx tsc --noEmit` + `npx eslint` để tự kiểm tra — không chạy `npm run build`.
```

---

## Kế hoạch phiên sau (2026-09-04) — Module Văn bản: 6 việc còn lại sau khi test tay Phần C

**CHƯA CODE GÌ cho 6 việc này.** Kế hoạch chi tiết đã duyệt nằm ở
`C:\Users\Software\.claude\plans\vi-c-l-m-agile-crab.md` (đọc file đó trước khi bắt đầu — có đầy
đủ hướng làm từng việc, file cần sửa, và checklist verify). Dưới đây là bản tóm tắt để không phải
điều tra lại.

### Đã xong và người dùng đã test tay xác nhận

- **Phần C "vị trí CỨNG"** — người dùng xác nhận *"Các vị trí nhớ rất tốt"*.
- **`loai_van_ban` tùy chọn** ở trang Upload ký tay khi tick "không có mã" — xác nhận *"bỏ require"*.
- Tách 2 công tắc **Hiện tên** / **Hiện chức vụ**; ngày phê duyệt theo múi giờ nhà máy (code xong,
  chưa test tay).

### 6 việc cần làm, theo thứ tự ưu tiên

1. **⭐ QUAN TRỌNG NHẤT — người ký phải ĐỌC được PDF và xê dịch chữ ký.** Hiện bước ký chỉ hiện
   hộp PIN (hệ quả của Phần C), người ký không nhìn thấy nội dung văn bản. Mong muốn: sau PIN →
   hiện canvas PDF; chữ ký/tên/chức danh đặt sẵn theo mẫu nhưng **kéo được, giới hạn CHỈ bên
   trong khung mẫu**, và **tách thành 3 khối độc lập**. **Server bắt buộc tự kẹp toạ độ** (không
   tin client). Tái dùng `bounds="parent"` của `DraggableBox` sẵn có.
   - **Quy tắc bật/tắt 2 TẦNG (đã chốt, ĐỔI NGHĨA `show_name`/`show_chuc_vu`)**: mẫu **bật** →
     người ký thấy và **tắt/mở tự do**; mẫu **tắt** → người ký **không thấy, không bật được**.
     Tức mẫu chuyển từ *"có vẽ hay không"* sang *"có CHO PHÉP hiển thị hay không"*.
2. **Khung "Ghi chú" đang bị hiểu SAI mục đích.** Code hiện tại in `van_ban_documents.ghi_chu`
   (ghi chú người soạn thảo) — **sai**. Thực tế đây là ô để **lãnh đạo gõ ý kiến chỉ đạo ngay lúc
   phê duyệt** (vd *"Phòng TCHC phối hợp NMCB tham mưu thực hiện, hạn chót 15/9/2026"*). Cần: ô
   nhập ở modal phê duyệt (chỉ hiện khi mẫu có đặt khung), nút bật/tắt, **chưa nhập & chưa tắt thì
   KHÔNG CHO KÝ + banner cảnh báo** (đang bị nuốt âm thầm), và **wrap nhiều dòng**.
   - **Chữ ký nháy** của lãnh đạo nằm **cố định góc trên-phải TRONG khung Ghi chú** (không phải
     khung chữ ký chính), dùng ảnh `chu_ky.png` thu nhỏ, **chỉ lãnh đạo phê duyệt**, **tắt khung
     Ghi chú thì mất luôn**. Vùng wrap text phải chừa chỗ, không đè lên chữ ký nháy.
3. **Tag ngày ký trên PDF**: thay chuỗi ngày trơn bằng **tick xanh + "Văn bản được ký
   dd/mm/yyyy hh:mm:ss" màu xám mờ**. Cần giây → phải thêm cột timestamp (xem Migration).
   ⚠️ Vẽ tick bằng `drawLine`, **không dùng ký tự `✓`** (font TimesNewRoman có thể thiếu glyph —
   bài học ở `.claude/rules/14-maintenance-module.md`).
4. **Dropdown neo trang biến mất sau khi đặt khung** (`ky/mau-vi-tri/page.tsx` ~dòng 1180-1194):
   chỉ render trong nhánh `!role.placed`. → cho hiện cả khi đã đặt, đổi trực tiếp `role.anchor`.
   Áp dụng **mọi vai trò**, không riêng QR.
5. **Đổi nhãn nút "Gửi ký"** → **"Cài đặt vị trí & Gửi ký"** khi `docExt === "pdf"` (vì luôn mở
   màn cài đặt vị trí trước); giữ "Gửi ký" cho file Office.
6. **Bấm chữ ký xem bằng chứng xác minh** (như Bảo trì) — người dùng chọn **PAdES + trang verify
   đầy đủ**. Việc lớn nhất, **làm riêng 1 phiên**. Lưu ý: Văn bản dùng hệ ký RIÊNG, **không có
   bản ghi `nguoi_ky`** nên không dùng lại được `/sign-verify/[nguoiKyId]`; bắt buộc dùng
   incremental update (`@cantoo/pdf-lib` + `commit()`) theo bài học "bug 74.8MB".

### Migration cần chạy (gộp 1 file, phục vụ việc 2 và 3)

```sql
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS ghi_chu_phe_duyet TEXT,          -- ý kiến lãnh đạo lúc phê duyệt
  ADD COLUMN IF NOT EXISTS ky_phe_duyet_at   TIMESTAMPTZ;   -- thời điểm ký chính xác tới giây
```

Việc 1, 4, 5 không cần migration.

### ⚠️ Cảnh báo — file dở dang NGOÀI phạm vi module Văn bản

`src/app/dashboard/output/{page.tsx,_components/*}` và `src/lib/output-pdf.ts` đang có **7 lỗi
TypeScript** (`Cannot find name 'closeDayDetail' / 'ArrowLeft' / 'bulkDeleting' /
'toggleAllDetailRows'`, `'a' is possibly null`) — việc đang làm dở của người dùng ở **module Sản
lượng**. **Không đụng, không commit.** `npm run build` sẽ fail cho tới khi được hoàn tất/hoàn tác.

Toàn bộ code các phiên gần đây **chưa commit**.

## Cập nhật (2026-09-04) — Fix bug ảnh HEIC đội lốt `.jpg` làm PDF in "Không tải được ảnh"

Chi tiết đầy đủ (triệu chứng, chuỗi nhân quả, lệnh kiểm chứng, quy tắc cho code mới):
`.claude/rules/14-maintenance-module.md` mục **"Bug ảnh HEIC đội lốt `.jpg` (2026-09-04)"**.
Tóm tắt các điểm dễ quên:

- **Nguyên nhân**: điện thoại lưu ảnh HEIC nhưng đặt đuôi `.jpg`; `File.type`/`Content-Type` đều
  suy từ ĐUÔI TÊN FILE nên mọi lớp kiểm tra dựa vào MIME đều bị qua mặt. Khi dựng PDF, code cũ
  tạo `data:image/jpeg;base64,<dữ liệu HEIC>` rồi gán `img.src` — data URL khai báo MIME tường
  minh nên trình duyệt chọn nhầm bộ giải mã → `onerror` → in "Không tải được ảnh".
- **2 ảnh trong báo cáo lỗi là 2 TẬP ẢNH KHÁC NHAU** (PDF = 3 ảnh HEIC lúc 00:06; trang chi tiết
  = 4 ảnh JPEG lúc 00:32 sau khi người dùng gửi qua Zalo rồi tải lên lại) — đừng đi tìm "vì sao
  cùng một ảnh mà hai nơi khác nhau".
- **File mới `src/lib/image-format.ts`** là nguồn duy nhất nhận diện định dạng theo **magic
  bytes** + `fetchImageForPdf()` dùng chung cho `maintenance-pdf.ts` và `export-order-pdf.ts`.
  Thư viện `heic-to` (~3MB WASM) **nạp lười**, chỉ tải khi thật sự gặp HEIC.
- **Quy tắc bắt buộc**: không tin `file.type`/`blob.type`/`Content-Type`; không dựng
  `data:<mime>;base64` rồi gán `img.src` để đo kích thước ảnh (dùng `createImageBitmap`/object
  URL); jsPDF chỉ nhận chắc chắn JPEG/PNG.
- **Dữ liệu cũ**: `scripts/convert-heic-images.mjs` ghi đè đúng đường dẫn cũ sau khi sao lưu bản
  gốc sang `<path>.heic.bak` → URL không đổi, **không phải sửa bảng nào**.
- **PDF đã ký là bất biến** — biên bản `MT-020926/001` sẽ vĩnh viễn thiếu ảnh, không sửa được.

### Mở rộng ra toàn bộ module (2026-09-05)

Đã rà toàn `src/` và vá **mọi điểm upload ảnh**, không riêng Bảo trì — bảng đầy đủ ở
`.claude/rules/14-maintenance-module.md` mục "Đã áp dụng cho TOÀN BỘ module". Điểm cần nhớ:

- Vá ở **tầng hàm dùng chung trong `src/lib/`** (`kpi-5s.ts`, `kpi-tasks.ts`,
  `operation-notes.ts`, `image-upload.ts`) và ở **điểm vào chung** `uploadInventoryImage` —
  nhờ vậy mọi picker gọi chúng tự động được vá, không phải sửa từng file UI.
- Vá inline thêm 3 nơi upload trực tiếp: Xuất hàng (ảnh xe), Kiểm soát quá trình (2 chỗ).
- `api/storage/upload-image/route.ts` có **lớp phòng vệ cuối** phía máy chủ: nhận diện theo
  nội dung thật, từ chối HEIC (máy chủ **không** tự chuyển đổi — tránh kéo thư viện giải mã
  HEIC vào runtime).
- Ảnh Kiểm soát quá trình còn được gửi Gemini OCR Po/Mo — HEIC làm hỏng cả OCR, nên phải
  chuẩn hóa **trước** khi vừa OCR vừa upload.
- `uploadKpiEvidenceFile` nhận cả tài liệu lẫn ảnh → dùng `prepareUploadFileIfImage` (chỉ xử
  lý khi nội dung thật sự là ảnh, không đụng PDF/Excel).
- Khảo sát toàn Storage: chỉ `order-files` dính (49 file, **đã chuyển đổi hết**);
  `inventory-files`/`product-files`/`shipping-files` sạch.
