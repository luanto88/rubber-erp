# HƯỚNG DẪN DỰ ÁN & QUY TẮC HOẠT ĐỘNG (AGENTS.MD)

Dự án tự động hóa: **Chuyển đổi biểu kết quả kiểm nghiệm (KQKN) cao su CSR sang file Excel nhập liệu ban đầu**.

---

## 1. MỤC TIÊU VÀ BỐI CẢNH DỰ ÁN

- **Đầu vào:** File PDF biểu "BẢNG KẾT QUẢ KIỂM NGHIỆM CAO SU CSR" (mẫu QLCL-QT21-F08), chứa số liệu thống kê tổng hợp của từng lô sản xuất.
- **Mục tiêu:** Tái tạo ngược số liệu chi tiết của từng mẫu ($n = 6$ hoặc $n = 10$ mẫu/lô) để lập file Excel nhập liệu ban đầu cho nhân viên.
- **Yêu cầu cốt lõi:** Khi phần mềm kiểm nghiệm tính toán lại từ file Excel sinh ra, kết quả thống kê phải **khớp 100%** so với biểu KQKN gốc.

---

## 2. QUY TẮC TÁI TẠO SỐ LIỆU THỐNG KÊ

### A. Định nghĩa toán học
1. **$X$ (Trung bình cộng):** Tổng các mẫu chia cho $n$, làm tròn nửa lên (`ROUND_HALF_UP`) theo số chữ số thập phân quy định.
2. **$3sd$ (3 lần độ lệch chuẩn mẫu):** $3 \times \sqrt{\frac{\sum (x_i - \bar{x})^2}{n - 1}}$, làm tròn nửa lên 3 chữ số thập phân.
3. **$X_{min}$ / $X_{max}$:** Giá trị nhỏ nhất và lớn nhất trong $n$ mẫu, phải khớp tuyệt đối.

### B. Ràng buộc theo từng chỉ tiêu
| Chỉ tiêu | Mã | Giá trị phải khớp | Số lẻ | Bước nhảy đo | Lưu ý |
|---|---|---|---|---|---|
| Tạp chất | `TC` | $X$ và $3sd$ | 3 | `0.001` | Các mẫu $\ge 0$ |
| Tro | `TRO` | $X$ và $3sd$ | 3 | `0.001` | |
| Bay hơi | `BH` | $X$ và $X_{max}$ | 2 | `0.01` | Giữ độ rộng lô hẹp ($\le 0.02$) |
| Nitơ | `NI` | $X$ và $X_{max}$ | 2 | `0.01` | Giữ độ rộng lô hẹp ($\le 0.02$) |
| Độ dẻo đầu | `PO` | $X_{min}$, $X$, $X_{max}$ | 1 | `0.5` hoặc `0.1` | **Xác định theo quy tắc bước nhảy máy đo** |
| Chỉ số duy trì độ dẻo | `PRI` | $X_{min}$, $X$, $X_{max}$ | 1 | `0.1` | Tạm thời bước `0.1` (kiểm tra nếu toàn số nguyên) |
| Độ nhớt Mooney | `ML` | $X_{min}$, $X$, $X_{max}$ | 1 | `0.5` hoặc `0.1` | **Xác định theo quy tắc bước nhảy máy đo** |
| Màu | `MAU` | (Trống) | - | - | Để trống toàn bộ cột |

### C. Quy tắc bước nhảy máy đo (PO & ML)
- Nếu **cả $X_{min}$ và $X_{max}$ đều chia hết cho 0.5** (ví dụ 73.5, 80.0, 80.5) $\rightarrow$ sinh số liệu theo **bước 0.5**.
- Nếu **có giá trị lẻ 0.1** (ví dụ 77.2, 85.3) $\rightarrow$ sinh số liệu theo **bước 0.1**.
- Sắp xếp các mẫu theo thứ tự tăng dần từ $M_1 \dots M_n$.

---

## 3. TIÊU CHUẨN CHẤT LƯỢNG (TCCS 112:2022 - SVR 10)

- **Giới hạn chỉ tiêu:**
  - Tạp chất $\le 0.07\%$
  - Tro $\le 0.60\%$
  - Bay hơi $\le 0.70\%$
  - Nitơ $\le 0.50\%$
  - $P_0 \ge 30$
  - $PRI \ge 50$
  - Độ nhớt $ML(1+4) 100^\circ\text{C}$: $73 - 93$
- **Độ rộng cho phép trong lô:**
  - Nitơ $\le 0.06$; Bay hơi $\le 0.06$; $P_0 \le 8$; $PRI \le 10$
- **Lô RHCSR10:** Giữ nguyên số liệu theo biểu gốc khi vượt tiêu chuẩn, không tự ý chỉnh sửa và lập báo cáo chi tiết nguyên nhân.

---

## 4. CẤU TRÚC FILE EXCEL ĐẦU RA

- Định dạng: `.xlsx`, 1 sheet duy nhất, cấu trúc khớp chuẩn `Mau_KN_thuong.xlsx`.
- **Dòng 1:** `NGAY_KN | NGAY_SX | CHUNG_LOAI | LOAI_KN | TIEU_CHUAN | SO_MAU`
- **Dòng 2:** Ngày KN (Excel Serial) | Ngày SX (Excel Serial) | `10` | `thuong` | `TCCS 112:2022` | $n$
- **Dòng 3:** Tiêu đề cột `LO_NM`, `TC_M1...TC_Mn`, `TRO_M1...`, `BH_M1...`, `NI_M1...`, `PO_M1...`, `PRI_M1...`, `ML_M1...`, `MAU_M1...`
- **Từ dòng 4:** Dữ liệu từng lô. Mã lô thêm đuôi năm, ví dụ `1708cs/26`, `1M/26`.
- **Yêu cầu kỹ thuật:** Sử dụng biểu diễn số thực chuẩn trong XML (không để sai số dấu phẩy động dạng `79.09999999999999`).
- **Tên file quy chuẩn:** `Nhap_lieu_ban_dau_CSR10_[DD-MM-YYYY]_[n]mau.xlsx`

---

## 5. BƯỚC KIỂM TRA BẮT BUỘC TRƯỚC KHI BÀN GIAO FILE

Mọi file xuất ra phải chạy qua hàm kiểm tra độc lập:
1. Đọc lại file Excel vừa tạo.
2. Tính toán lại toàn bộ chỉ tiêu thống kê ($X, 3sd, X_{min}, X_{max}$).
3. Đối chiếu 100% với biểu KQKN gốc. Chỉ xuất file khi đạt tỷ lệ khớp 100%.

---

## 6. MẪU BÁO CÁO KÈM THEO
1. Số lô, dải mã lô, ngày KN / ngày SX.
2. Phân loại máy đo: Lô nào bước 0.5, lô nào bước 0.1 cho $P_0$ và $ML$.
3. Danh sách lô xếp hạng `RHCSR10` và lý do cụ thể (nếu có).
4. Các bất thường trên biểu gốc cần lưu ý (nếu có).
