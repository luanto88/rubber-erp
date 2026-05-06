# Rubber Factory ERP — Project Memory (Updated)

## Dự án

Hệ thống ERP quản lý sản xuất cao su cho **CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM**.

## Nhà máy

- **Phước Hòa KPT** (Cambodia): CSR-series, prefix CSR, location "Kampong Thom"
- **Cuaparis** (HCM): SVR-series, prefix SVR, location "Phước Hòa"

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, App Router
- **Database**: Supabase (PostgreSQL), > 24 bảng (đã bao gồm 14 bảng của module Kho)
- **Auth**: Supabase Auth (Session là source of truth, localStorage chỉ dùng làm cache UI)
- **Deploy**: Vercel — https://rubber-erp.vercel.app/
- **Repo**: https://github.com/luanto88/rubber-erp
- **Supabase**: https://kaoeenrewvltnrbxmjfe.supabase.co
- **Anon Key**: sb_publishable_cYvSxJUCByOIPO4Psbj9Tw_s_zbZb5Y

## Modules

| Module      | Trạng thái     | Ghi chú                                        |
| ----------- | -------------- | ---------------------------------------------- |
| Dashboard   | ✅ Cơ bản      | Stats cards                                    |
| Quản lý Kho | ✅ Hoàn thiện  | Nhập, Xuất, Chuyển, Tồn, Thẻ kho, QR, Cảnh báo |
| Điều xe     | 🔄 Cập nhật    | Mã DX, Import CSV mẫu, Tải GeoJSON             |
| Ngăn lưu    | 🔄 Cập nhật    | Đang nhận -> Đóng -> Chờ SX (21 ngày)          |
| Thành phẩm  | 🔄 Cập nhật    | Liên thông Ngăn lưu, chặn max 110%             |
| Chất lượng  | 📋 Cần migrate | 3 khung, import, PDF, retest                   |
| Xuất hàng   | 📋 Cần migrate | Xe + lô drag-drop, QR                          |
| Cài đặt     | ✅ Đang VH     | Quản trị tập trung, User, Matrix, Phân quyền   |
| Login       | ✅ Done        | Supabase Auth, chọn nhà máy                    |

## Logic quan trọng

### 1. Quản lý Kho (Inventory)

- **Kho chuẩn:** `KA` (Vật tư), `KB` (Hóa chất - quản lý chặt Lô/Hạn sử dụng).
- **Luồng chứng từ:** Nháp (`draft`) ➔ Đã ghi sổ (`posted`) ➔ Đã hủy (`cancelled`).
- **Ghi sổ (Post):** Tác động DB trực tiếp qua Stored Procedures (`inventory_post_export_document`,...). Chặn xuất âm ở tầng DB (Trigger `inventory_prevent_negative_stock`).
- **Action Bar UI:** Các nút Lưu Nháp, Ghi Sổ, Hủy Phiếu luôn hiển thị ở Header góc phải. Chỉ dùng `disabled` để làm mờ khi thiếu dữ liệu, tuyệt đối KHÔNG ẨN nút.
- **Hủy phiếu:** Phải có quyền `inventory.cancel` và bắt buộc nhập lý do. Hệ thống sẽ đảo ngược tồn kho nguyên tử.

### 2. Điều xe

- **Mã:** `DX-ddmmyy/{stt}`.
- **Thông tin mặc định:** Ngày điều xe = ngày lớn nhất + 1. Trạng thái Chứng nhận = PEFC CS. Lộ trình tự động filter theo đội của Điểm giao nhận.
- **Khối lượng:** Tự tính DRC mủ dây mặc định là 65.
- **Tiện ích:** Hỗ trợ admin tải file mẫu CSV để import nhiều ngày cùng lúc. Sinh file GeoJSON lô thu hoạch.

### 3. Ngăn lưu & Thành phẩm (Liên thông)

- **Vòng đời Ngăn lưu:**
  - Tạo mới: **Đang nhận**
  - Có ngày kết thúc: **Đóng**
  - Đủ 21 ngày: **Chờ sản xuất** (Xuất hiện bên module Thành phẩm).
- **Sản xuất (Thành phẩm):**
  - Bắt đầu nhập thành phẩm: Trạng thái chuyển thành **Đang sản xuất**.
  - Tiến độ > 100% nhưng <= 110%: Cảnh báo và hiện nút _Lưu và đánh dấu đã sản xuất_.
  - Tiến độ > 110%: Bị CHẶN, bắt buộc phải bấm hoàn tất.
  - Hoàn tất: Trạng thái chốt là **Đã sản xuất**. Mọi thay đổi Xóa/Sửa bên Thành phẩm sẽ tự động sync ngược lại trạng thái Ngăn lưu.

### Thành phẩm

- **Dở dang**: dd_snapshot lưu giá trị gốc, hiện ở CẢ 2 ngày/Ca
- **isManualEdit**: tách biệt tạo mới (auto-detect DD) vs sửa (giá trị thật)
- **Batch edit**: editKey="batch_xxx", sửa tất cả lô 1 ngày
- **KienCard**: 4 kiện A/B/C/D, max 36 bành, reset button
- **Lot format**: `{num}{suffix}/{year}` VD: 01cs/26
- **Hậu tố**: cs=Nội tuyển PEFC, m=Thu mua, gctpk=GC Tân Biên

### Chất lượng

- 3 khung: chưa KN (blue) / rớt hạng (red) / 6 tháng (purple)
- Mã phiếu: KQKN-{NM}-{ddmmyy}/{stt}
- Loại KN: thường(6) / ngặt(14) / tùy chọn(≤14)
- NGAY_SX mặc định = NGAY_KN - 1 ngày
- PDF footer: CSR→"Kampong Thom", SVR→"Phước Hòa"
- Decimal: Tạp chất/Tro=3, Bay hơi/Nitơ=2, P₀/PRI/ML/Màu=1

### Xuất hàng

- Mã đơn: XH*{MaKH}*{SoTB}\_{ddmmyy}
- Layout: Xe trái | Lô phải, drag-drop
- Biển số: đầu kéo + rơ-moóc

## Quy tắc

- **KHÔNG** xóa/ghi đè dữ liệu khi chưa xác nhận
- safeSave: KHÔNG BAO GIỜ lưu mảng rỗng
- CSR_TYPES dynamic theo factory prefix (CSR/SVR)
- Lot suffixes: CS(nội tuyển), M(thu mua), GCA(gia công)
- **Multi-tenant:** Dữ liệu luôn query và filter theo `factory_id` từ auth session hiện tại.
- **Nguồn sự thật Sản phẩm:** Ma trận sản phẩm load động từ database (bảng cài đặt nhà máy), TUYỆT ĐỐI KHÔNG hard-code danh sách sản phẩm trong code.

## Deploy workflow

```
Sửa code → git add . → git commit -m "msg" → git push → Vercel auto deploy
```
