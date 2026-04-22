# Module Ngăn lưu & Thành phẩm — Logic đầy đủ

## ⚠️ Lưu ý quan trọng về trạng thái ngăn

Chỉ có **5 trạng thái hợp lệ**, **KHÔNG có "Hoàn thành"**:

| Trạng thái | Điều kiện | Module set |
|---|---|---|
| `Đang nhận` | Chỉ có `ngay_bd`, chưa có `ngay_kt` | Ngăn lưu (tạo ngăn) |
| `Đóng` | Có `ngay_kt` (có thể cùng ngày `ngay_bd`) | Ngăn lưu (nhập ngày kết thúc) |
| `Chờ sản xuất` | Đủ 21 ngày kể từ `ngay_bd` — **tự động** | Hệ thống (auto-transition) |
| `Đang sản xuất` | User chọn ngăn trong form Thành phẩm | **Thành phẩm** (khi chọn ngăn) |
| `Đã sản xuất` | User bấm "Lưu và đánh dấu đã sản xuất" | **Thành phẩm** (button đặc biệt) |

---

## Module Ngăn lưu (`ngans`)

### Tạo ngăn

**Gợi ý tên ngăn:**
- Gợi ý N1–N24, **ẩn các ngăn đang chứa nguyên liệu** (trang_thai ∈ ["Đang nhận", "Đóng", "Chờ sản xuất", "Đang sản xuất"])
- Cho phép nhập tay tên ngăn tùy ý, **tối đa 10 ký tự**

**Trạng thái khi tạo:**
- Chỉ nhập `ngay_bd` → trạng thái: `Đang nhận`
- Nhập cả `ngay_bd` + `ngay_kt` → trạng thái: `Đóng`
- `ngay_bd` và `ngay_kt` có thể là cùng 1 ngày

**Auto-transition:**
- Khi `ngay_bd` đủ 21 ngày → trạng thái tự chuyển thành `Chờ sản xuất`
- Ngăn `Chờ sản xuất` mới xuất hiện trong dropdown chọn ngăn tại module Thành phẩm

### Chọn xe vào ngăn

- Khi xe được chọn vào ngăn, xe đó **biến mất khỏi danh sách cảnh báo**
- Các xe chưa được chọn vào ngăn **tiếp tục hiển thị trong phần cảnh báo**

### Tính KL quy khô ngăn theo loại nguyên liệu

Khi tạo ngăn, người dùng chọn loại NL. **Chỉ cộng đúng cột KL của loại NL đó** — dùng helper `getKLFromTrip(t, loai_nl)` trong `storage/page.tsx`:

| Loại NL chọn | Cột tươi dùng | Cột khô dùng |
|---|---|---|
| Mủ chén | `kl_ct` | `kl_ck` |
| Mủ đông chén | `kl_dct` | `kl_dck` |
| Mủ đông khối | `kl_dkt` | `kl_dkk` |
| Mủ dây | `kl_dt` | `kl_dk` |
| Mủ nước | `kl_mn` | `kl_mnk` |

Ví dụ: ngăn chọn "Mủ đông chén" thì chỉ cộng `kl_dct` (tươi) và `kl_dck` (khô). Auto-recalc khi user đổi loại NL.

### KL tươi/khô và Mã ngăn — read-only

- **KL tươi, KL khô:** hiển thị dạng `<div>` (không có `<input>`), tự tính từ trips được chọn × loại NL
- **Mã ngăn:** auto-generate theo `[Vị trí]-[Nguồn gốc]-[Loại NL viết tắt]-[XL]-[dd/mm/yy]-[dd/mm/yy]`, không cho sửa tay
- `TripItem` lưu toàn bộ raw KL fields (`kl_ct/kl_ck`, `kl_dct/kl_dck`, `kl_dkt/kl_dkk`, `kl_dt/kl_dk`, `kl_mn/kl_mnk`), không pre-compute tổng

---

## Module Thành phẩm — Quan hệ với Ngăn lưu

### Ngăn hiển thị trong dropdown chọn ngăn

Chỉ hiện ngăn có `trang_thai = "Chờ sản xuất"` (đủ 21 ngày ủ).  
Không hiện: "Đang nhận", "Đóng", "Đã sản xuất".

### Khi user **chọn ngăn** để sản xuất

→ **Ngay lập tức** cập nhật trạng thái ngăn: `Chờ sản xuất` → `Đang sản xuất`  
→ Cập nhật đồng bộ về module Ngăn lưu (gọi `loadData`)

### Nút lưu — 2 trường hợp theo % lấp đầy ngăn

**Tỷ lệ lấp đầy** = tổng `tong_kg` các lô / `tong_kho` ngăn × 100%

| % lấp đầy | Nút hiển thị | Hành động |
|---|---|---|
| < 100% | "Lưu" | Lưu lô, ngăn giữ trạng thái "Đang sản xuất" |
| ≥ 100% | "Lưu" + **"Lưu và đánh dấu đã sản xuất"** | User chọn nút nào tùy ý |
| > 110% | **Bắt buộc** "Lưu và đánh dấu đã sản xuất" | Không cho thêm lô mới |

**Khi bấm "Lưu và đánh dấu đã sản xuất":**
→ Ngăn chuyển sang `Đã sản xuất`  
→ Cập nhật đồng bộ về module Ngăn lưu ngay lập tức

**Quan trọng:** User vẫn có thể bấm "Lưu" (không đánh dấu xong) khi ở mức 100–110%, ngăn vẫn là "Đang sản xuất".

### Khi user **xóa lô** của ngăn

```
Sau khi xóa → tính lại % lấp đầy ngăn
  % ≥ 100% → trạng thái ngăn: "Đang sản xuất" (giữ nguyên)
  % < 100% → trạng thái ngăn: "Đang sản xuất" (giữ nguyên)
  Xóa HẾT lô của ngăn → trạng thái ngăn: "Chờ sản xuất"
```

→ Cập nhật ngay về module Ngăn lưu sau mỗi lần xóa

---

## Tóm tắt luồng trạng thái ngăn

```
[Tạo ngăn, chỉ ngay_bd]
        ↓
   "Đang nhận"
        ↓ (thêm ngay_kt)
      "Đóng"    ←── hoặc ngay từ đầu nếu nhập cả ngay_bd + ngay_kt

[Tạo ngăn chỉ ngay_bd, sau 21 ngày]
        ↓
  "Chờ sản xuất"  ←── xuất hiện trong Thành phẩm dropdown
        ↓ (user chọn ngăn trong form Thành phẩm)
  "Đang sản xuất" ←── cập nhật ngay
        ↓ (user xóa hết lô)
  "Chờ sản xuất"  ←── quay về
        ↓ (user bấm "Lưu và đánh dấu đã sản xuất", % ≥ 100%)
   "Đã sản xuất"  ←── cập nhật ngay
```

---

## Code references

- Ngăn lưu UI: `src/app/dashboard/storage/page.tsx`
- Thành phẩm: `src/app/dashboard/product/page.tsx`
- `getKLFromTrip(t, loai_nl)` trong storage/page.tsx: helper tính KL đúng loại NL
- `eligibleNgans` trong product/page.tsx: filter ngăn để chọn — chỉ lấy `trang_thai = "Chờ sản xuất"`
- Ngăn update khi chọn ngăn: gọi ngay khi `session.ngan_id` thay đổi (không chờ lưu)
- Ngăn update khi lưu lô: trong `handleCreateSave`, sau vòng lặp insert
- Ngăn update khi xóa lô: trong `handleDelete`
- `handleSave` trong storage: bắt buộc check `{ error }` từ Supabase trước khi đóng modal
