---
description: Quy tắc an toàn bắt buộc — áp dụng cho MỌI task, không có ngoại lệ
---

# Quy tắc An toàn (Bắt buộc)

## ⛔ Tuyệt đối KHÔNG làm

1. **KHÔNG xóa, drop, truncate dữ liệu Supabase** khi chưa được người dùng xác nhận rõ ràng
2. **KHÔNG tự ý xóa file** trong project — luôn hỏi người dùng trước
3. **KHÔNG ghi đè dữ liệu** mà không có backup hoặc xác nhận
4. **KHÔNG dùng `localStorage`** để lưu data nghiệp vụ (chỉ dùng cho session)

## ✅ Bắt buộc phải làm

- Tất cả query Supabase **phải có** `.eq("factory_id", fid)`
- Tất cả form **phải có** loading state `saving` khi submit
- Sau khi save/delete **phải gọi** `loadData(factoryId)` để refresh UI
- Khi cần thao tác destructive → **hỏi người dùng trước**, chờ xác nhận

## Cách lấy factory_id

```typescript
import { getActiveFactoryId } from "@/lib/auth"

const fid = await getActiveFactoryId()
```

Ghi chu:

- `erp_factory` trong `localStorage` chi la cache
- Khong duoc coi cache nay la source of truth duy nhat
- Neu khong lay duoc `fid`, page phai ha loading va de auth/session layer xu ly tiep

## Cách lấy user hiện tại

```typescript
const user = JSON.parse(localStorage.getItem("erp_user") || "{}")
```

Rule bo sung:

- Neu mot page bat `loading = true`, phai co duong `finally` hoac duong tat `loading` ro rang trong moi nhanh
- Khong de UI treo vo han o cac thong bao:
  - `Dang tai...`
  - `Dang tai du lieu...`
  - `Dang tai lo...`
