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

- **QUY CHUẨN GIAO DIỆN MODULE (danh sách, dòng xổ, chi tiết 70/30 + PDF nhúng, thao tác, bàn giao) — áp dụng tự động mọi module**: `.claude/rules/29-ui-standard.md`
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
- Định mức Kinh tế Kỹ thuật (khung định mức theo dây chuyền × CSR × nguồn, ngày hiệu lực, ma trận gộp ô): `.claude/rules/30-norms-module.md`
- Đề nghị mua vật tư hàng hóa (ký số 3 bước, số ĐNMVT theo năm, gợi ý giá/trùng vật tư): `.claude/rules/28-purchase-module.md`
- ISO và hồ sơ con: đọc `.claude/rules/16-iso-vanban-module.md` và `.claude/rules/17-iso-soat-xet.md`; ưu tiên các mục "Cập nhật mới nhất (2026-05-28)" nếu có mâu thuẫn với logic cũ.
- Kho thanh pham (so do kho): `.claude/rules/18-warehouse-tp-module.md`
- Chấm công / Điểm danh (trực ca quét QR, công nhân không tài khoản, Khmer, F01/F02, sổ phép, chuyên cần cho KPI): `.claude/rules/31-attendance-module.md` + `.claude/plans/cham-cong-2026-11-19.md`
- Van ban noi bo: `.claude/rules/22-documents-module.md`
- Lich su chi tiet (khong tu nap): `.claude/history/`

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

## Ghi chú Permission Guard

- Mọi trang dashboard có guard trong bootstrap: `hasPermission(user, "module.view")` ngay sau khi có user, trước khi tải dữ liệu; thiếu quyền ⇒ `setLoading(false); window.location.replace("/dashboard"); return`.
- `inventory/layout.tsx`, `iso/layout.tsx` là client layout guard cho toàn bộ route con.
- Chi tiết: `.claude/rules/12-settings-permissions.md` mục "Permission guard theo trang".

## Bài học kỹ thuật cốt lõi (rút từ nhật ký — đọc trước khi code)

**Môi trường & kiểm tra**
- Chỉ tự kiểm bằng `npx tsc --noEmit` + `npx eslint <file>`. KHÔNG `npm run build` khi chưa chắc dev server đang tắt (chung thư mục `.next/`, làm vỡ CSS/HMR).
- Dev load vô hạn / "unexpected Turbopack error" ⇒ tắt dev, xoá `.next/dev/cache/turbopack`, chạy lại + hard refresh. Lỗi tsc trỏ `.next/types/validator.ts` tới file đã xoá là cache cũ, không phải lỗi code.
- Không chạy `sed`/`cat` trên `.env.local` (đã từng lộ private key). PEM dán lên Vercel phải đủ dòng `-----BEGIN/END-----`.
- Script test gọi code thật: `node --experimental-strip-types`, cwd = gốc repo (sai cwd ⇒ font không nạp, test "pass" giả).

**Dữ liệu & Supabase**
- PostgREST cắt im lặng ở 1000 dòng ⇒ bảng lớn bắt buộc `.range()` + `.order()` ổn định; `.in()` chia lô ~200 id.
- Supabase JS không throw ⇒ luôn kiểm `error`. Mọi query lọc `factory_id`.
- `dispatch_entries.rows` (JSONB) là NGUỒN THẬT; bảng `dispatch_entry_rows` đóng băng từ 2026-06-12. Cột `ngay` của điều xe có thể là text dd/mm/yyyy ⇒ không `.gte/.lte`, không `.order("ngay")` (dùng `created_at`).
- Nhân bản dòng `DxRow` phải reset cả `uid` lẫn `row_id`.
- Thành phẩm: bọc/pallet lấy theo GIAO DỊCH/KIỆN, `lots.boc`/`lots.pallet` chỉ là snapshot. Mọi lô `tong_banh > 0` phải có `lot_transactions`. Không import CSV thẳng vào `lots`.
- PL/pgSQL có `RETURNS TABLE`: mọi cột trùng tên cột trả về phải có alias bảng. `CREATE OR REPLACE submit_confirm_draft_batch` phải chép từ migration MỚI NHẤT (giữ vòng `v_touched_ngans`).
- RLS 2 bảng tham chiếu chéo ⇒ bọc 1 chiều bằng hàm `SECURITY DEFINER` (tránh infinite recursion). Policy mới dùng `current_profile_has_permission()`, không hard-code role. Drop policy `FOR ALL` cũ khi tách (PERMISSIVE cộng dồn bằng OR).
- Bảng `profiles`: chỉ admin đọc được cả nhà máy ⇒ danh sách người dùng lấy qua API route service role.
- Route server không dùng `getFreshAuthSession()` (chỉ chạy trình duyệt) — dùng `requireAuthUser(req)` / `resolveIsoActor`; client gọi qua `authFetch()` có Bearer.
- Ngày nghiệp vụ: `getFactoryTodayISO()` / `formatFactoryDateVN()` (`src/lib/date-utils.ts`). KHÔNG `toISOString().slice(0,10)` (UTC, lệch 00:00–06:59). `getTodayISODate()` cũng là UTC.

**Ký số & PDF**
- `src/lib/signing/`: client chỉ được import module thuần (`template-layout.ts`, `template-colors.ts`, `placement-preview.ts`); `stamp-pdf.ts`, `apply-template.ts`, `pades.ts`, `requests.ts` là server-only (fs/forge/admin). tsc không bắt được lỗi này.
- Ký nhiều lượt: `@cantoo/pdf-lib` `forIncrementalUpdate` + `commit()` trên CÙNG 1 doc sống; không `save()` rồi reload (bug 74.8MB, mất chữ ký người trước).
- node-forge: `commonName` ép `valueTagClass: UTF8`; `emailAddress` phải ASCII.
- jsPDF chỉ chắc JPEG/PNG; nhận diện ảnh theo magic bytes (`src/lib/image-format.ts`), không tin `file.type` (HEIC đội lốt .jpg). Font NotoSans chỉ có regular (bold/italic là giả) — không dùng ký tự ✓ ⚠ ៛.
- Mọi phiếu PDF có URL riêng: QR góc phải trên. Xem file đã ký qua route token `/api/files/view/...`, không href thẳng Storage.

**UI**
- Chuẩn giao diện: `.claude/rules/29-ui-standard.md` (nguồn duy nhất) + component ở rule 05.
- Không `filter/backdrop-filter/transform/will-change` trên ancestor của overlay `position: fixed` (đổi containing block). Overlay/QR scanner render qua `createPortal` ra `document.body`.
- Không `var(--color-x)` trong style inline — dùng literal hex hoặc class Tailwind.
- Thư viện cần `window` (leaflet, html5-qrcode, pdfjs) ⇒ `next/dynamic({ ssr:false })`; pdfjs worker local (`ensurePdfjsWorker`).
- `re-resizable`: truyền đủ `handleComponent` + `handleClasses` + `handleStyles`; `cancel` của Draggable là `.resize-handle`.
- Đọc `localStorage/sessionStorage` lúc khởi động luôn bọc try/catch (WebView Telegram/Zalo ném SecurityError).
- Gemini Vision/OCR chỉ dùng `gemini-2.5-flash-lite` + `thinkingBudget: 0`.

## Việc còn treo (cập nhật 2026-10-27)

- Xác minh migration đã chạy: `20261023_maintenance_service_items`, `20261027_export_pallet_types` (người dùng báo test production PASS 2026-10-27).
- Bug chờ sửa Kiểm soát quá trình (P1–P10) và Sản lượng (S1–S10): `.claude/plans/ke-hoach-dong-bo-ui-toan-app.md` mục "Bug chờ sửa (2026-10-27)".
- Lộ trình đồng bộ UI U8–U14: cùng file kế hoạch trên.
- RLS UPDATE/DELETE `qc_results`/`dispatch_entries` theo trạng thái ký (hiện chặn ở UI).
- Root CA PAdES cần xoay vòng theo kế hoạch Multi-Root CA (xem memory `security_pades_root_ca_key_exposure`).
- Định mức KTKT GĐ4 (báo cáo Mẫu 8A + Mẫu 09 + ký số): code xong 2026-11-15 — chạy migration `20261124_tech_norms_reports.sql`
  rồi test tay (rule 30 mục GĐ4) — test PASS 2026-11-15 (kèm sửa header/QR/thành phần/nhảy trang/nhấp nháy).
- Báo cáo sử dụng theo ngày 55-BC / 46-BC (Kho vật tư, ký số): code xong 2026-11-15 — chạy migration
  `20261125_inventory_daily_reports.sql`, cấp quyền `inventory.daily_report`, `import-inventory-legacy-nxt.mjs --apply` (khi
  được phép), test tay (rule 13 mục cuối). Lô chốt tồn 24/07/2026 = "phiếu điều chỉnh tồn" (migration
  `20261126_inventory_adjustment_documents.sql`, chạy sau 20261125) — không tính báo cáo / định mức, KHÔNG xoá.
  2026-11-15: 2 migration ĐÃ CHẠY, import lịch sử 771 dòng ĐÃ CHẠY, test tay PASS; phiếu cũ T1–7 đã lồng tab Nhập/Xuất +
  đối soát định mức (rule 13/30), test tay PASS. Sản lượng T3–T6 "trống" là đúng thực tế (không thu gom T3–T4, sản xuất lại
  từ T6). Còn: kho rà soát tài liệu tháng 7 (dòng "Trùng" ⇒ thêm EXCLUDE).
- Định mức 8A mục 3 "Xuất kho bù" (lô 2025 ngoài hệ thống, bảng `tech_norm_export_extra`): code xong 2026-11-16 —
  migration ĐÃ CHẠY, đã nhập số bù, test PASS 2026-11-16 (rule 30). 2026-11-16 (sau): chuyển sang Cài đặt → Thành phẩm →
  "Xuất bù kho" (nhập theo ngày, đủ trường như Tồn đầu kỳ); migration 20261128 ĐÃ CHẠY, test PASS, đã push 2026-11-17.
- Chỉ số đồng hồ T1–T10/2026 nhập từ file M9 (`scripts/import-norm-meter-readings-m9.mjs`) 2026-11-16: đủ 165 lần ghi
  (28 dòng 27/09 + 27/10 ghi sau khi xoá báo cáo test 56); Mẫu 09 T5/T9/T10 khớp giấy.
  Bàn giao: `.claude/plans/ban-giao-dinh-muc-2026-11-17.md`.
- Quy cách thành phẩm theo nhà máy: GĐ1 (bọc/pallet SX/thảm, `product_packaging_types`) test PASS 2026-11-08.
  GĐ2 (chủng loại × loại bành, lô tròn = 4 × bành/kiện, `product_grade_types`) đã code 2026-11-08 — chạy migration
  `20261116_product_grade_types.sql` TRƯỚC deploy + test tay; GĐ3 (pallet → mã vật tư) — `.claude/plans/quy-cach-thanh-pham-gd2.md`.
  GĐ3A (thành phần pallet) test PASS 2026-11-08. GĐ3B (nắp theo kiện + Xuất kèm nắp + lũy kế F09) test localhost PASS,
  deploy 2026-11-09 (migration `20261118_lot_nap.sql` đã chạy). Còn: lệch lũy kế năm 22 bành + phần C — prompt phiên sau ở
  `.claude/plans/quy-cach-thanh-pham-gd3-nap.md` mục "Prompt phiên sau".

- Gắn phiếu đề nghị ĐÃ DUYỆT (lập riêng) cho biên bản bảo trì theo SL (gia công + vật tư): code xong 2026-11-17 — chạy
  migration `20261129_purchase_line_record_allocations.sql` TRƯỚC deploy rồi test tay (rule 28 mục cuối).
- Vá liên kết Biên bản ↔ Kho ↔ Ký số (huỷ/xoá biên bản ở server, chặn ký biên bản đã huỷ, Kho không huỷ được X-BT): code
  xong 2026-11-17 — chạy migration `20261130_maintenance_issue_doc_cancel_guard.sql` rồi test tay (rule 14 mục cuối).
  Migration 20261129 + 20261130 ĐÃ CHẠY (2026-11-18).
- Khoá sửa biên bản khi đang ký (cả admin) + dấu vân tay dữ liệu chặn ký + "Huỷ yêu cầu ký để sửa" (admin) + huỷ/xoá
  biên bản huỷ kèm phiếu đề nghị: đã push main `d8f7afd`, test tay 4 bước PASS 2026-11-19 (rule 14 mục cuối). CÒN TREO
  (người dùng để sau): rà soát dữ liệu — file `../rubber-erp-backups/rasoat-de-nghi-bien-ban-2026-11-18.xlsx` chờ người
  dùng điền "Quyết định", rồi chạy `scripts/apply-audit-decisions.mjs` (xem trước → `--apply`) — rule 28 mục cuối.

- Cải tiến đánh giá KPI & 5S (2026-11-19): lộ trình K1–K6 đã duyệt, CHƯA code — `.claude/plans/kpi-5s-cai-tien-2026-11-19.md`
  (đã chốt: chuyên cần suy từ hoạt động app, KPI dùng tính thưởng, độ khó việc 3 mức, 5S checklist từng S thang 1–5).
  U11 (giao diện KPI) hoãn tới sau K1–K4.
- Module Chấm công (thay K1 chuyên cần): kế hoạch C0–C8 đã duyệt 2026-11-19 (`.claude/plans/cham-cong-2026-11-19.md`). C0 code
  xong 2026-11-19 — chạy migration `20261201_attendance_c0_foundation.sql`, 3 script (xem trước → `--apply`), test tay (rule 31).
  File dịch Khmer cho chuyên gia: `cung_cap_dl/dich_khmer_cham_cong.xlsx`.
  C0 test PASS 2026-11-20. C1 (lịch công tháng + chấm tay) code xong 2026-11-20 — chạy migration
  `20261202_attendance_c1_records.sql` + `assign-workers-department.mjs --apply`, test tay (rule 31). Bàn giao C2:
  `.claude/plans/ban-giao-cham-cong-c2.md`.
  2026-11-20: C1 test PASS; migration 20261202 + 20261203 (Có mặt A không bắt buộc lý do) + 20261204 (công nhân không có
  nghỉ tua) ĐÃ CHẠY, test PASS; ô Tháng rộng hơn 20% + cột ngày xen kẽ đậm/nhạt test PASS.
  C2 "Điểm danh ca" code xong 2026-11-20 (kế hoạch mục 10 đã duyệt; duyệt xong ⇒ khoá) — chạy migration
  `20261205_attendance_c2_shift_sheets.sql` TRƯỚC deploy, test tay (rule 31 mục GĐ C2). Bàn giao C2b/C3:
  `.claude/plans/ban-giao-cham-cong-c2b-c3.md`.
  2026-11-23: C2 LÀM LẠI dạng lưới ô người (người dùng test thấy rối) — GĐ1 (migration 20261206 + danh mục mẫu F01/F02 mới +
  giới tính / tổ trưởng + thẻ nhóm) ĐÃ CHẠY, test PASS. GĐ2 (màn lưới) + GĐ3 (đơn xuất, giờ kết thúc ca, phiếu F01/F02 Canvas):
  `.claude/plans/ban-giao-cham-cong-c2-luoi.md` (thay file bàn giao c2b-c3 cho phần C2).
  2026-11-23: GĐ2 màn lưới + sửa sau test (thẻ ↔ loại việc, Tổ tiếp nhận, ẩn Trực xuất hàng, tóm tắt trước khi gửi, chặn người
  chưa phân công ca, Khmer, nam trước nữ sau, header + Tải PNG / xoá điểm QR) — migration 20261207 ĐÃ CHẠY, test PASS, đã commit
  (chưa push). GĐ3 + dấu duyệt / bản cứng F01/F02 + F09 + vị trí Ca trưởng / Tổ trưởng: `.claude/plans/ban-giao-cham-cong-c2-gd3.md`.
  2026-11-24: GĐ3 mục 1–5 ĐÃ CODE (tsc + eslint sạch, CHƯA commit) — chạy migration `20261208_attendance_section_positions.sql`
  TRƯỚC khi mở màn chấm công, rồi test tay (rule 31 mục GĐ3).
  2026-11-24: 20261208 + 20261209 ĐÃ CHẠY, test PASS. Danh mục Ca/Tổ (`attendance_units`, XLNT / CD / TN_MT như Ca A/B/C),
  trưởng/phó theo Ca/Tổ, mã phiếu TKSXMT/TKSXMN, tab "Phiếu TKSX" ĐÃ CODE (CHƯA commit) — chạy migration
  `20261210_attendance_units.sql` TRƯỚC khi mở màn chấm công, rồi test tay (rule 31 mục "Ca/Tổ điểm danh").
  2026-11-24 (sau test): bỏ thẻ nhóm ở màn điểm danh, việc gắn theo Ca/Tổ, thêm Tổ tiếp nhận mủ nước + Đội xe cơ khí —
  chạy 20261211_attendance_unit_jobs.sql sau 20261210 (rule 31 cuối mục Ca/Tổ).

## Nhật ký các phiên cũ

Toàn bộ nhật ký từng phiên (2026-05 → 2026-10-27) đã chuyển nguyên văn sang
`.claude/history/claude-md-session-log-2026.md` — KHÔNG tự nạp, chỉ tra khi cần biết lý do một quyết định.

## Prompt mở đầu phiên sau

Đang làm Chấm công (2026-11-24): dùng prompt trong `.claude/plans/ban-giao-cham-cong-ca-to.md` mục "Prompt phiên sau".
Prompt dưới đây (U11 KPI) để dành khi người dùng nhắc.

```
Đọc CLAUDE.md, rule 29 và lộ trình U8–U14 trong .claude/plans/ke-hoach-dong-bo-ui-toan-app.md.
Trạng thái: Bảo trì khoá sửa khi đang ký + huỷ kèm đề nghị đã push d8f7afd, test PASS 2026-11-19.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (file
../rubber-erp-backups/rasoat-de-nghi-bien-ban-2026-11-18.xlsx chờ tôi điền "Quyết định"; khi tôi gửi lại thì
chạy scripts/apply-audit-decisions.mjs KHÔNG --apply trước, tôi duyệt kế hoạch rồi mới --apply — rule 28 mục cuối).
Bắt đầu U11 (KPI, kpi/**): banner violet cho mọi route con, ModuleThemeScope, tab → SegmentedTabs (kpi-shell.tsx),
badge span tay → StatusBadge (thêm domain kpi_task vào status-registry), bảng scores → enterprise-table dense.
Chỉ đổi trình bày — giữ nguyên quyền, query, RPC, logic tính điểm (rule 27). Đọc lại đúng file trước khi sửa,
lên plan liệt kê từng trang + thay đổi để tôi duyệt trước. Xong: tsc + eslint, hướng dẫn test tay, hỏi tôi trước
khi commit/push. Sau đó U12 (Ghi chú), U13, U14 — mỗi giai đoạn dừng cho tôi test.
Chỉ dùng npx tsc --noEmit + npx eslint, không npm run build. Lỗi Turbopack ở dev ⇒ tắt dev, xoá
.next/dev/cache/turbopack, chạy lại.
```
