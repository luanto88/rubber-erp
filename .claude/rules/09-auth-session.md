---
description: Auth, session, multi-tenant — đọc khi làm việc với login, user roles, factory context
---

# Auth & Session Management

## Session storage

Login lưu vào `localStorage` (không phải Supabase Auth):
```typescript
localStorage.setItem("erp_user",    JSON.stringify(userObject)) // user đầy đủ
localStorage.setItem("erp_factory", factoryId)                  // UUID nhà máy
```

## Lấy context trong component

```typescript
// Factory ID — dùng cho MỌI query Supabase
const fid = localStorage.getItem("erp_factory")

// User hiện tại
const user = JSON.parse(localStorage.getItem("erp_user") || "{}")
const role = user.role // "admin" | "manager" | "user" | "customer"
```

## Multi-tenant

Mọi query bắt buộc filter theo factory:
```typescript
supabase.from("any_table").select("*").eq("factory_id", fid)
```

## Bảng `users`

```sql
id UUID PK, factory_id UUID, username TEXT UNIQUE,
password_hash TEXT, full_name TEXT, role TEXT,
department TEXT, status TEXT  -- "active"|"pending"
```

## User roles

| Role | Quyền |
|---|---|
| `admin` | Toàn quyền, duyệt tài khoản mới |
| `manager` | Đọc/ghi tất cả module |
| `user` | Đọc/ghi module được phân quyền |
| `customer` | Chỉ xem module EUDR/truy xuất nguồn gốc |

## Login flow

1. Nhập username + password + chọn nhà máy
2. Query `users` where `username = ? AND status = "active"`
3. So khớp `password_hash`
4. Lưu session → redirect `/dashboard`

## Register flow

1. Nhập thông tin + chọn nhà máy
2. Insert user với `status = "pending"`
3. Chờ admin duyệt → admin set `status = "active"`

## Guard pattern

```typescript
useEffect(() => {
  const user = localStorage.getItem("erp_user")
  if (!user) router.push("/") // redirect về login
}, [router])
```
