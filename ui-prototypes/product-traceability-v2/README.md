# Hướng dẫn & Tài liệu Bản mẫu UI Tra cứu Kiện Thành phẩm (v2)
`ui-prototypes/product-traceability-v2/index.html`

Tài liệu này thuộc **GIAI ĐOẠN 1: KHẢO SÁT VÀ TẠO BẢN MÔ PHỎNG (PROTOTYPE)** của nhiệm vụ cải tiến giao diện tra cứu kiện thành phẩm theo chuẩn quốc tế.

---

## 1. Cách mở và xem Prototype

File prototype được thiết kế dưới dạng **Pure HTML5 + CSS + Vanilla JavaScript tự chứa hoàn toàn (Self-contained)**, không cần chạy `npm install`, không cần build server hay cấu hình môi trường.

### Cách 1: Mở trực tiếp bằng trình duyệt trên máy
- Mở File Explorer trên Windows, điều hướng đến:
  `c:\Users\Software\rubber-erp\ui-prototypes\product-traceability-v2\`
- Nhấp đúp chuột vào file `index.html` (hoặc chuột phải chọn **Open with** > **Google Chrome** / **Microsoft Edge**).

### Cách 2: Mở qua máy chủ cục bộ (nếu muốn)
```bash
npx serve ui-prototypes/product-traceability-v2
# Hoặc python
python -m http.server 8080 --directory ui-prototypes/product-traceability-v2
```
Sau đó truy cập: `http://localhost:8080`

---

## 2. Những thành phần và cải tiến đã mô phỏng

### A. Thanh công cụ mô phỏng tương tác (Prototype Toolbar - Đặt trên cùng)
- **Bộ chuyển đổi kích thước màn hình (Khung nhìn)**:
  - `Desktop`: 1040px / 1440px
  - `Tablet`: 768px
  - `Mobile`: 390px (iPhone 14/15/16 chuẩn)
  - `Small`: 360px (Android màn hình nhỏ)
- **Bộ chuyển đổi trạng thái sản xuất (Status Simulator)**:
  - `Dự kiến`: Kiện mới lên lịch, chưa đóng bánh, các trường ngày/giờ/ca/đạt hạng hiển thị trạng thái chờ thanh lịch.
  - `Đã sản xuất`: Kiện hoàn tất, đạt chứng nhận CSR10, hiển thị đầy đủ phiếu KQKN đính kèm.
  - `Dở dang`: Kiện dở dang (29 bành ca A), kích hoạt dải cảnh báo nghiệp vụ nổi bật.
- **Bộ chuyển đổi phân quyền người dùng (Role Mode Simulator)**:
  - `Khách hàng QR`: Ẩn nút "Xác nhận sản xuất" và nút "Đổi ngăn", mang lại trải nghiệm cổng tra cứu bảo mật, tinh gọn.
  - `Công nhân / KCS`: Hiển thị nút "Xác nhận sản xuất" và "Đổi ngăn" với nhãn phân quyền rõ ràng.

### B. Giải quyết triệt để lỗi cắt cụt văn bản (Zero Truncation Bug)
- **Tiêu đề kiện**: Không còn bị cắt thành `1799cs/...` -> Hiển thị đầy đủ `1799cs/26 — Kiện KD`.
- **Loại bọc**: Không còn bị cắt thành `Bọc nhãn 0,...` -> Hiển thị đầy đủ `Bọc nhãn 0,04 mm`.
- **Đạt hạng**: Không còn bị cắt thành `Đang chờ ki...` -> Hiển thị rõ ràng `Đang chờ kiểm nghiệm` hoặc `CSR10 (TCCS 112:2022)`.
- **Mã ngăn nguồn**: Không bị cắt mất chuỗi ngày tháng -> Hiển thị rõ ràng `N10 (N10-NT-ĐC-X-12/09/26-15/09/26)`.
- **Tính năng sao chép nhanh**: Mã lô, mã kiện và URL đều có nút sao chép 1 chạm với hiệu ứng Toast phản hồi.

### C. Đưa nút đổi ngôn ngữ lên cùng dòng với tiêu đề
- Khắc phục lỗi trên mobile ở giao diện cũ (nút đổi ngôn ngữ bị đẩy xuống một hàng riêng chiếm diện tích).
- Giao diện mới đặt **Tiêu đề** và **Cụm chọn ngôn ngữ [VI | ខ្មែរ | EN]** ngay trên **cùng một dòng đầu trang**, cân đối hai bên, tiết kiệm chiều cao màn hình trên điện thoại di động.

### D. Khắc phục dịch tiếng Khmer (ភាសាខ្មែរ) triệt để
- Khắc phục triệt để lỗi ở ảnh `7.jpg`:
  - Nhãn "Mã lô & Kiện" trước đây bị hardcode tiếng Việt -> Nay dịch chuẩn sang `លេខឡូត៍ & ឡាំង`.
  - Nhãn "Vị trí & Mã ngăn" trước đây bị bỏ quên tiếng Việt -> Dịch chuẩn sang `ទីតាំង & លេខកូដផ្លង់`.
  - Đơn vị bành `kg/bành` -> Dịch chuẩn sang `គ.ក្រ/ដុំ` hoặc quốc tế `kg/bale`.
  - Phụ đề ngăn nguồn trước đây còn tiếng Việt -> Dịch chuẩn sang `រុករកប្រភពដើមជ័រកៅស៊ូ និងចម្ការដើមប្រភពតាមឡូត៍នីមួយៗ`.
  - Tối ưu line-height và font-family `Kantumruy Pro` để chữ Khmer không bị cụt hay đè dấu.

### E. Giải trình nội dung "Dây chuyền" và "Ngày hoàn thành" tại sao là `—` (ở ảnh `5.jpg`)
- Đã bổ sung Popup chi tiết lô 1790cs/26 có bảng giải trình kỹ thuật rõ ràng:
  - **Dây chuyền (`day_chuyen`)**: Lô dữ liệu cũ hoặc khi tạo chưa phân dây chuyền Mủ tạp / Mủ nước.
  - **Ngày hoàn thành (`ngay_ht`)**: Lô này mới nhập 29 bánh ở Kiện C (A, B, D là 0 bánh). Lô tròn cần 144 bánh nên trigger cơ sở dữ liệu `sync_lot_master_snapshot` giữ `ngay_ht = null`.

---

## 3. Dữ liệu mẫu (Mock Data) trong Prototype

| Trường thông tin | Dữ liệu mô phỏng | Ghi chú |
| :--- | :--- | :--- |
| Mã lô | `1799cs/26` | Dựa theo ảnh thực tế `3.jpg` |
| Kiện | `Kiện KD` (hoặc `Kiện KC` ở trạng thái dở dang) | Kiện D trong lô 4 kiện |
| Loại CSR | `CSR10` | Chủng loại chuẩn |
| Loại bành | `35 kg/bành` (35 kg/bale) | Chuẩn xuất khẩu |
| Loại bọc | `Bọc nhãn 0,04 mm` | Không bị cắt text |
| Loại pallet | `Sắt đế gỗ` | Chuẩn đóng gói |
| Ngăn nguồn gốc | `N10 (N10-NT-ĐC-X-12/09/26-15/09/26)` | Dựa theo ảnh `1.jpg` & `2.jpg` |
| File kiểm nghiệm | `Phiếu kết quả kiểm nghiệm chất lượng — Lô 1799cs/26.pdf` | Tải/Xem mô phỏng |

---

## 4. Giới hạn của Prototype
- Prototype độc lập hoàn toàn, không kết nối cơ sở dữ liệu Supabase thật.
- Các thao tác "Tải về PDF" hoặc "Xác nhận sản xuất" chỉ kích hoạt thông báo Toast minh họa luồng UX, không ghi dữ liệu hoặc điều hướng thật.
- Không sửa bất kỳ file nguồn nào trong `src/`.
