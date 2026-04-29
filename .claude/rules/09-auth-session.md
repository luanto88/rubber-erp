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

## Migration

He thong co script migration user cu:

- `scripts/migrate-legacy-users.mjs`

Migration se:

- doc bang `users` cu
- tao auth user
- tao / upsert `profiles`
- migrate permission cu sang `user_permissions`
