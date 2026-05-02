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
  - SIGNED_IN event (full hydration)
  - focus lai cua so (lightweight — chi verify token, khong DB query)
  - tab quay lai visible (lightweight)
  - heartbeat dinh ky 60 giay (lightweight)
- Bootstrap layout phai boc trong `Promise.race` voi timeout 10s de tranh spinner treo do mang cham
- Interval va focus sync phai dung lightweight (`getFreshAuthSession()` only) — goi `hydrateActiveSession()` moi 60s se lam 4-5 DB query, loi nao do co the xoa user sai
- `onAuthStateChange` SIGNED_OUT handler phai thu `getFreshAuthSession()` truoc khi redirect — Supabase co the fire SIGNED_OUT khi network blip xay ra luc auto-refresh, gay false-positive kick user ra khoi app
- Sau bootstrap, neu `!loading && !user`, phai redirect ve `/login` bang `useEffect`
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
- Logic ngan luu chi tiet: `.claude/rules/storage.md`

## Nho ky

- Khong xoa file hay xoa du lieu khi chua duoc xac nhan
- Supabase JS v2 khong throw DB error -> luon check `error`
- Khong dung `localStorage` de luu data nghiep vu
- Tai lieu chi tiet uu tien nam trong `rules`, khong nhan ban day lai vao file nay
- Mac dinh giao dien va noi dung trong app phai viet bang tieng Viet co dau
- Chi thay doi ngon ngu hien thi khi nguoi dung yeu cau ro rang
