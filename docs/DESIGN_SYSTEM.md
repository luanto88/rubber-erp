# QUY CHUẨN THIẾT KẾ GIAO DIỆN (DESIGN SYSTEM) - RUBBER ERP

Tài liệu này định hình phong cách thiết kế giao diện **Sinh thái / Thiên nhiên (Eco-Green Nature Theme)** cho toàn bộ hệ thống Rubber ERP (Nhà máy chế biến Phước Hòa Kampong Thom). Phong cách này áp dụng nhất quán cho giao diện Đăng nhập, Dashboard và các module chức năng lâu dài.

---

## 1. Bảng màu chủ đạo (Color Palette)

### 1.1 Màu thương hiệu & Nền chính
- **Primary Olive / Forest Green (Xanh rừng / Xanh lá cao su)**:
  - Base: `#1E5631` / `#164E29` / `#0D3B23`
  - Accent: `#22C55E` / `#16A34A`
  - Deep Dark (Sidebar & Header): `#0B3A28` / `#0D4430` / `#08281C`
- **Main Background (Nền nội dung chính)**:
  - Off-white ánh xanh nhạt: `#F7F9F7` / `#F4F7F4` (tạo cảm giác tự nhiên, dịu mắt, làm nổi bật thẻ trắng).
- **Form Input Tint (Nền ô nhập liệu màn hình Đăng nhập)**:
  - Cream Yellow Tint: `#FFFBEB` / `#FEF9C3` (Màu kem vàng nhẹ theo mẫu UI chuẩn, phân biệt rõ với nền trắng của card).

### 1.2 Màu sắc Phân loại Indicator (Status & Categorized Badges)
- **Xanh lá (Green)**: Lô vườn, Tạo thành phẩm, Trạng thái thành công (`#16A34A`).
- **Xanh dương (Blue)**: Sản lượng hôm nay, Đo nước/đầu ướt, Soạn thảo văn bản (`#2563EB`).
- **Cam / Đào (Orange / Peach)**: Đơn hàng xuất, Bảng phân xe, In nhãn lô (`#EA580C` / `#F97316`).
- **Đỏ (Red)**: Cảnh báo, Thiết bị bảo trì, Lỗi (`#DC2626`).
- **Tím (Purple)**: Thiết bị, Tài liệu ISO (`#9333EA`).
- **Teal / Ngọc (Teal)**: In QR ngăn nhanh (`#0D9488`).

---

## 2. Typography & Kiểu dáng Card

### 2.1 Font chữ
- Kiểu font: Sans-serif hiện đại (`Plus Jakarta Sans` / `Inter` / system font fallback).
- Trọng số:
  - Tiêu đề & Con số KPI: `font-black` (800/900) hoặc `font-extrabold` (800).
  - Nhãn & Nút bấm: `font-bold` (700) hoặc `font-semibold` (600).
  - Nội dung mô tả: `font-medium` (500) hoặc `font-normal` (400).

### 2.2 Quy chuẩn Card & Bo góc
- **Bo góc Container / Wrapper chính**: `rounded-3xl` (24px) hoặc `rounded-2xl` (16px).
- **Card nội dung**:
  - Background: `bg-white` (trắng tinh).
  - Border: Viền mượt `border border-slate-100` hoặc `border border-emerald-950/5`.
  - Shadow: Bóng đổ mềm `shadow-sm` hoặc `shadow-md`.
  - Padding: `p-4` đến `p-6`.

---

## 3. Quy chuẩn Navigation Sidebar (Thanh điều hướng)

1. **Nền & Lớp phủ**:
   - Nền màu xanh đậm thiên nhiên (`#0B3A28`) phủ ảnh thân cây cao su cạo mủ thật (`/images/forest/r1-tapping.jpg`) ở độ mờ/tối thích hợp (`opacity-25` hoặc gradient overlay).
2. **Logo & Header Sidebar**:
   - Đĩa tròn trắng chứa Logo Công ty ("Nhà máy chế biến Phước Hòa KPT" + "HỆ THỐNG QUẢN LÝ SẢN XUẤT").
   - Nút thu gọn / mobile toggle ở góc phải header.
3. **Menu Item States**:
   - **Active Item (Đang chọn)**: Hình pill dạng nắp nang bo tròn khép kín màu xanh nhạt sáng (`bg-emerald-600/90` hoặc `bg-emerald-700`), chữ trắng, shadow nổi nhẹ.
   - **Normal Item**: Chữ xám xanh nhạt (`text-emerald-100/80`), icon màu xanh mạ sáng (`text-emerald-400`), hover đổi màu nền mờ (`hover:bg-white/10`).
   - **Sub-menu Accordion**: Nhóm xổ xuống mượt mà cho `Quản lý sản xuất` và `ISO & Văn bản`.
4. **Footer Sidebar (Thông tin người dùng)**:
   - Thẻ người dùng tròn: Avatar chữ cái đầu (VD: 'N'), Tên "Nguyễn Hữu Thọ", Chức vụ "Quản trị hệ thống", nút tùy chọn 3 chấm.

---

## 4. Quy chuẩn Giao diện Đăng nhập (Login Page)

1. **Bố cục 2 Cột (Split Layout)**:
   - **Cột trái (Thương hiệu & Hình ảnh)**:
     - Nền ảnh cạo mủ cao su thật phủ lớp tối mượt.
     - Logo tròn white badge, Tên công ty "CTY TNHH PTCS PHƯỚC HÒA KAMPONG THOM".
     - Tiêu đề lớn "NHÀ MÁY CHẾ BIẾN - HỆ THỐNG QUẢN LÝ SẢN XUẤT".
     - 3 Dòng giới thiệu có badge icon tròn xanh đậm:
       - 🚚 Điều xe - Kho nguyên liệu - Thành phẩm theo dõi xuyên suốt dây chuyền
       - 📋 Kiểm nghiệm chất lượng theo TCCS/TCVN, gắn liền xuất hàng
       - 🛡️ Truy xuất chuỗi cung ứng EUDR đến từng lô vườn cao su
     - Tag phiên bản v2.0 bên dưới.
     - Đường cong hữu cơ mềm mại (organic wave cut) phân cách 2 cột.
   - **Cột phải (Thẻ đăng nhập)**:
     - Chuyển đổi ngôn ngữ `[ EN | VI ]` góc trên bên phải.
     - Card form màu trắng bo góc `rounded-3xl` / `rounded-4xl`, bóng đổ mượt.
     - Icon User tròn màu xanh lá nổi ở đỉnh card (`bg-emerald-600`).
     - Tiêu đề "ĐĂNG NHẬP HỆ THỐNG", đường kẻ trang trí có lá cây xanh ở giữa.
     - Dropdown chọn nhà máy có icon tòa nhà `Building2`.
     - Ô `Tên đăng nhập *` và `Mật khẩu *` có nền vàng nhạt (`bg-[#FFFBEB]` / `bg-[#FEF9C3]`), viền vàng nhạt mượt.
     - Checkbox "Ghi nhớ đăng nhập" & liên kết "Quên mật khẩu?".
     - Nút đăng nhập chính: Màu xanh đậm `bg-emerald-700` / `bg-olive-700`, chữ in hoa font đậm `➔] ĐĂNG NHẬP`.
2. **Khu vực Chân trang Đăng nhập**:
   - Hàng 3 chứng nhận ISO badge (ISO 9001:2015, ISO 14001:2015, ISO 14067:2018).
   - Hàng 4 giá trị cốt lõi: Chất lượng Bền vững | Môi trường Xanh sạch | Trách nhiệm Minh bạch | Phát triển Bền vững.

---

## 5. Quy chuẩn Giao diện Dashboard (Tổng quan)

1. **Thanh Header Trang**:
   - Tiêu đề "Dashboard", biểu tượng vị trí "📍 Phước Hòa Kampong Thom".
   - Nút thao tác: "🗺️ Bản đồ lô" (nền xanh lá nhạt), "➕ Tạo Polygon mới" (nền xanh lá đậm), Notification Bell, Avatar 'N' + Tên người dùng.
2. **Hàng Thẻ Thống kê KPI (5 Cards)**:
   - 1. Lô vườn: "412" (Tổng số) - Biểu tượng lá cây xanh, hình cây chìm nền.
   - 2. Sản lượng hôm nay: "128.5" (Tấn) - Biểu tượng giọt nước xanh dương, hình biểu đồ cột chìm.
   - 3. Đơn hàng xuất: "26" (Đơn) - Biểu tượng thùng hàng cam, hình hộp hàng chìm.
   - 4. Cảnh báo: "8" (Đang xử lý) - Biểu tượng lá chắn đỏ.
   - 5. Thiết bị: "12" (Bảo trì) - Biểu tượng bánh răng tím.
3. **Khu vực Trung tâm (2 Cột)**:
   - **Cột trái (Thao tác nhanh)**: Thẻ trắng chứa 6 danh mục có icon badge màu sắc kèm mũi tên (Tạo lô thành phẩm, Tạo tài liệu ISO, Soạn thảo văn bản mới, Bảng phân xe, In QR ngăn nhanh, In nhãn lô nhanh).
   - **Cột phải (Chế độ sấy & do nhanh chỉ tiêu)**: Thẻ chứa selector "🍃 Mủ tạp - CSR10", 3 thông số chỉ tiêu (ĐẦU ƯỚT 127°C, ĐẦU KHÔ 127°C, THỜI GIAN 10p) và bảng 5 kết quả đo gần nhất (Ngày đo, Ca, Po, Mo).
4. **Khu vực Sản xuất (Hàng dưới)**:
   - Thẻ nền xanh đậm: "Sản lượng theo ngày - 7 ngày gần nhất".
   - Thẻ trắng: "Tỷ lệ đạt kế hoạch - Tháng 8/2026" (biểu đồ Donut 86%).
   - Thẻ trắng: "Tiến độ đơn hàng" (32 / 45 & thanh progress green).
   - Thẻ trắng: "Cảnh báo thiết bị" (8 thiết bị cần kiểm tra).
