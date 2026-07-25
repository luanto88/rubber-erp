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
