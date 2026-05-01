---
description: Auth, session, multi-tenant, dang ky va duyet tai khoan
---

# Auth & Session

## Kien truc auth hien tai

He thong dang nhap dung `Supabase Auth`.

`localStorage` chi duoc dung nhu app session cache cho:

```ts
localStorage.setItem("erp_user", JSON.stringify(userObject))
localStorage.setItem("erp_factory", factoryId)
```

Khong dung `localStorage` de luu data nghiep vu.

## Session cache va session that

- `localStorage` chi la lop cache UI, khong phai source of truth cuoi cung
- Source of truth cho dang nhap van la `Supabase Auth session`
- Khi can dung session hien tai, app phai uu tien helper:
  - `getFreshAuthSession()`
  - `hydrateActiveSession()`
  - `getActiveFactoryId()`
- `getFreshAuthSession()` co trach nhiem:
  - doc session hien tai
  - chu dong refresh token neu session sap het han
- `getActiveFactoryId()` co trach nhiem:
  - uu tien doc `erp_factory` tu cache neu hop le
  - neu cache mat / stale thi phai rebuild lai tu profile cua session dang dang nhap
- Khong duoc coi `erp_factory` bi mat la trang thai "khong co du lieu" cua module
- Neu session khong con hop le:
  - phai dang xuat / dieu huong ve `/login`
  - khong de page treo `Dang tai...` hoac hien empty state sai nghia

## Multi-tenant

Moi query phai filter theo:

```ts
supabase.from("table").select("*").eq("factory_id", fid)
```

## Data model auth

```ts
auth.users
```

Bang app profile:

```ts
{
  id: UUID,
  username: string,
  auth_email: string,
  full_name: string,
  factory_id: UUID | null,
  role: string,
  department: string,
  status: string,
  approved_by: UUID | null,
  approved_at: string | null,
  disabled_by: UUID | null,
  disabled_at: string | null,
}
```

Ten bang app: `profiles`

Bang `users` cu chi de migration va doi chieu, khong con la nguon dang nhap chinh.

## Dang ky tai khoan

- User dang ky moi -> `status = "pending"`
- Duoc tao tai khoan auth + profile app
- `auth.users.email` duoc sinh tu username theo dang `username@auth.rubber-erp.example.com`
- Khong dung domain `.local` cho tai khoan auth moi vi provider co the tu choi email
- Dang nhap phai uu tien email noi bo moi va fallback cho tai khoan cu `.local` neu can
- Chua duoc vao ung dung ngay
- Can admin hoac nguoi co quyen duyet kich hoat

## Duyet tai khoan

Thuc hien trong module `Cai dat`.

Khi duyet, admin gan:

- Nha may
- Role
- Bo permission chi tiet

Khi duyet thanh cong:

- `status -> active`
- luu `approved_by`
- luu `approved_at`

## Roles tong quat

- `admin`
- `manager`
- `user`
- `customer`

`customer` chi xem khu vuc duoc cap, chu yeu la truy xuat/EUDR.

## Disabled

- Tai khoan `disabled` khong duoc vao ung dung
- Neu auth thanh cong nhung profile la `disabled`, app phai dang xuat ngay va day ve `/login`
- Phai luu `disabled_by` va `disabled_at`

## Permission chi tiet

He thong dung mo hinh:

`module + action chuan`, them mot so action dac biet

Action chuan:

- `view`
- `create`
- `edit`
- `delete`

Action dac biet tuy module:

- `import`
- `export_file`
- `print`
- `approve`
- `manage_config`
- `quick_add`
- `mark_completed`
- `delete_order`

## Guard

- Phai check quyen o UI
- Dong thoi phai check quyen o logic thao tac save / delete / import / approve
- Khong chi an nut ma bo qua check logic

## Route auth

- Route dang nhap chuan: `/login`
- Dang xuat phai:
  - xoa app session cache
  - sign out Supabase Auth
  - day ve `/login`

## Dashboard session sync

- `dashboard/layout.tsx` la noi can bo nghe `onAuthStateChange`
- Layout phai co co che tu dong dong bo session khi:
  - app vua bootstrap
  - tab duoc focus lai
  - tab quay lai `visible`
  - heartbeat dinh ky (60 giay)
- Muc tieu:
  - han che tinh trang dang nhap mot luc roi tat ca module dong loat roi vao `Dang tai...`
  - han che tinh trang query tra rong gia tao vi session da stale

### Quy tac bat buoc khi viet syncSession trong layout

**1. Sync lock — bat buoc de tranh concurrent calls**

```typescript
let syncing = false
const syncSession = async () => {
  if (syncing) return
  syncing = true
  try { ... } finally { syncing = false }
}
```

**2. `onAuthStateChange` chi xu ly `SIGNED_IN` / `SIGNED_OUT`**

```typescript
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === "SIGNED_OUT" || !session?.user) {
    setUser(null)
    router.replace("/login")
    return
  }
  if (event === "SIGNED_IN") {
    await syncSession()
  }
  // TOKEN_REFRESHED → bo qua, interval 60s xu ly
})
```

Li do: neu xu ly `TOKEN_REFRESHED`, moi lan `refreshSession()` se kich hoat them 1 `syncSession()` → vong lap tu cung co → 5-10 DB query dong thoi → UI dong bang.

**3. Chi clear user khi loi xac thuc that su**

```typescript
} catch (error) {
  if (alive && isAuthSessionError(error)) {
    setUser(null)
    router.replace("/login")
  }
  // loi mang tam thoi → chi log, khong xoa user
}
```

`isAuthSessionError()` co san tai `src/lib/auth.ts` — check JWT/token/session/auth/401/403.

Neu clear user tren moi loi mang, layout se hien spinner va tat ca module unmount.

**4. Debounce focus/visibility handler — toi thieu 30 giay**

```typescript
let lastSyncTime = 0
const handleVisibilityOrFocus = () => {
  const now = Date.now()
  if (document.visibilityState === "visible" && now - lastSyncTime > 30_000) {
    lastSyncTime = now
    void syncSession()
  }
}
```

**5. useEffect deps phai la `[]`**

```typescript
}, []) // router stable trong Next.js App Router, khong can trong deps
```

## Migration

He thong co script migration user cu:

- `scripts/migrate-legacy-users.mjs`

Migration se:

- doc bang `users` cu
- tao auth user bang email noi bo hop le
- tao / upsert `profiles`
- migrate permission cu sang `user_permissions`
