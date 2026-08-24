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

