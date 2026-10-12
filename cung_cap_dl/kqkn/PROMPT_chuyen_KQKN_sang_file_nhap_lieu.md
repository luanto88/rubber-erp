# PROMPT: Chuyển biểu KQKN cao su CSR thành file nhập liệu ban đầu

> Dán toàn bộ nội dung dưới đây vào đầu session mới, kèm theo:
> 1. File PDF biểu KQKN của ngày cần xử lý (bắt buộc)
> 2. File mẫu nhập liệu `Mau_KN_thuong.xlsx` (nên gửi lần đầu để đối chiếu cấu trúc)
> 3. Số mẫu mong muốn: **6** hoặc **10**

---

## 1. NHIỆM VỤ

Tôi gửi file PDF "BẢNG KẾT QUẢ KIỂM NGHIỆM CAO SU CSR" (biểu QLCL-QT21-F08). Biểu này chỉ chứa **số liệu thống kê tổng hợp** của từng lô. Hãy tái tạo ngược **số liệu chi tiết của từng mẫu** để tạo file Excel nhập liệu ban đầu cho nhân viên, sao cho khi phần mềm tính lại từ file này sẽ ra **đúng y hệt** biểu KQKN gốc.

Số mẫu mỗi lô: **[6 hoặc 10 — điền vào]**.

## 2. ĐỌC DỮ LIỆU ĐẦU VÀO

Dùng `pdftotext -layout` để lấy đầy đủ các cột (bản text kèm theo có thể thiếu cột độ nhớt ML và cột xếp hạng — luôn kiểm tra lại bằng lệnh này).

Cấu trúc cột của biểu:

| Chỉ tiêu | Mã | Biểu ghi | Đơn vị/số lẻ |
|---|---|---|---|
| Tạp chất | TC | X, 3sd, X+3sd | 3 số lẻ |
| Tro | TRO | X, 3sd, X+3sd | 3 số lẻ |
| Bay hơi | BH | X, Xmax | 2 số lẻ |
| Nitơ | NI | X, Xmax | 2 số lẻ |
| Độ dẻo đầu | PO | Xmin, X, Xmax | 1 số lẻ |
| Chỉ số duy trì độ dẻo | PRI | Xmin, X, Xmax | 1 số lẻ |
| Độ nhớt Mooney | ML | Xmin, X, Xmax | 1 số lẻ |
| Màu | MAU | (trống) | – |

Ngoài ra lấy: số hiệu lô nhà máy, ngày sản xuất (ghi trên biểu), ngày kiểm nghiệm (tên file), tổng số lô, và cột xếp hạng cuối (CSR10 / RHCSR10).

## 3. QUY TẮC TÁI TẠO SỐ LIỆU

Định nghĩa thống kê:
- **X** = trung bình cộng của n mẫu, làm tròn nửa lên (ROUND_HALF_UP) theo số lẻ của chỉ tiêu.
- **3sd** = 3 × độ lệch chuẩn mẫu (chia n−1), làm tròn 3 số lẻ.
- **Xmin / Xmax** = giá trị nhỏ nhất / lớn nhất trong n mẫu, phải khớp **tuyệt đối**.

Ràng buộc theo từng chỉ tiêu:

| Chỉ tiêu | Phải khớp | Bước nhảy |
|---|---|---|
| TC, TRO | X và 3sd | 0,001 |
| BH, NI | X và Xmax | 0,01 |
| PO | Xmin, X, Xmax | **0,5 hoặc 0,1 — xem mục 4** |
| PRI | Xmin, X, Xmax | 0,1 |
| ML | Xmin, X, Xmax | **0,5 hoặc 0,1 — xem mục 4** |

BH và NI: biểu không ghi Xmin, hãy giữ độ rộng trong lô hẹp (≤ 0,02) cho sát thực tế.

## 4. QUY TẮC BƯỚC NHẢY MÁY ĐO (QUAN TRỌNG)

Phòng thí nghiệm có **2 loại máy đo** cho chỉ tiêu **P0** và **độ nhớt ML**: một máy bước nhảy **0,5**, một máy bước nhảy **0,1**. Xác định bước nhảy **riêng cho từng lô, từng chỉ tiêu** theo Xmin/Xmax ghi trên biểu:

- Nếu **cả Xmin và Xmax đều chia hết cho 0,5** (ví dụ 73,5 – 80,5) → sinh số liệu mẫu theo **bước 0,5**.
- Nếu **có giá trị lẻ 0,1** (ví dụ 77,2 hoặc 85,3) → sinh số liệu mẫu theo **bước 0,1**.

Tuyệt đối không làm tròn Xmin/Xmax về lưới khác — chọn đúng bước nhảy để khớp nguyên trạng.

## 5. GIỚI HẠN TIÊU CHUẨN (TCCS 112:2022 — hạng SVR 10)

**Bảng 2 — giới hạn chỉ tiêu:**
- Tạp chất ≤ 0,07 %; Tro ≤ 0,60 %; Nitơ ≤ 0,50 %; Bay hơi ≤ 0,70 %
- P0 ≥ 30; PRI ≥ 50
- Độ nhớt ML (1+4) 100 °C: **73 – 93** (chỉ kiểm khi khách hàng yêu cầu)

**Bảng 3 — độ rộng cho phép trong lô:**
- Nitơ ≤ 0,06; Bay hơi ≤ 0,06; P0 ≤ 8; PRI ≤ 10; Màu: đồng đều

Số liệu sinh ra phải nằm trong các giới hạn này. **Ngoại lệ:** nếu chính biểu KQKN đã vượt giới hạn (ví dụ độ rộng PRI = 12, hoặc ML ngoài 73–93 — thường là các lô biểu xếp **RHCSR10**), hãy **giữ đúng theo biểu** và báo lại cho tôi, không tự sửa.

## 6. CẤU TRÚC FILE XUẤT RA

File `.xlsx`, một sheet, đúng định dạng file mẫu:

- **Dòng 1 (nhãn):** `NGAY_KN | NGAY_SX | CHUNG_LOAI | LOAI_KN | TIEU_CHUAN | SO_MAU`
- **Dòng 2 (giá trị):** ngày KN | ngày SX | `10` | `thuong` | `TCCS 112:2022` | số mẫu
  - Hai cột ngày định dạng `yyyy-mm-dd`
- **Dòng 3 (tiêu đề cột):** `LO_NM`, rồi lần lượt các nhóm `TC_M1…TC_Mn`, `TRO_M1…`, `BH_M1…`, `NI_M1…`, `PO_M1…`, `PRI_M1…`, `ML_M1…`, `MAU_M1…MAU_Mn`
- **Từ dòng 4:** mỗi lô một dòng. Mã lô dạng `1116cs/26`.
- **Cột MAU để trống** (biểu không có số liệu màu; SVR 10 chỉ yêu cầu "đồng đều").

Yêu cầu kỹ thuật khi ghi file:
- Ghi giá trị bằng `Decimal` đã quantize đúng số lẻ, sau đó **làm sạch biểu diễn số thực trong `xl/worksheets/sheet1.xml`** (thay các giá trị kiểu `79.09999999999999` bằng biểu diễn ngắn nhất). Nếu không làm bước này, Excel/phần mềm có thể hiển thị sai số.
- Tên file: `Nhap_lieu_ban_dau_CSR10_[DD-MM-YYYY]_[n]mau.xlsx`

## 7. KIỂM TRA BẮT BUỘC TRƯỚC KHI GIAO FILE

Mở lại file vừa ghi và tính ngược **toàn bộ** thống kê, so từng con số với biểu KQKN:
- X và 3sd của TC, TRO
- X và Xmax của BH, NI
- Xmin, X, Xmax của PO, PRI, ML
- Bước nhảy từng ô của PO và ML đúng lưới đã chọn cho lô đó
- Không ô nào bị trống (trừ cột MAU)

Chỉ giao file khi **100% khớp**. Nếu có sai lệch không thể tránh, phải nêu rõ từng chỗ.

## 8. NỘI DUNG BÁO CÁO KÈM THEO

Sau khi giao file, tóm tắt ngắn gọn:
1. Số lô, dải mã lô, ngày KN / ngày SX
2. Lô nào dùng máy bước 0,5, lô nào bước 0,1 (cho cả P0 và ML)
3. Các lô biểu xếp **RHCSR10** và lý do cụ thể (ML ngoài 73–93, độ rộng PRI > 10, …)
4. Mọi bất thường nghi là nhập nhầm trên biểu gốc (ví dụ 3sd của tro lớn bất thường như 0,302 trong khi các lô khác chỉ 0,010–0,016) — nêu ra để tôi kiểm tra lại, không tự ý sửa.

---

## GHI CHÚ / ĐIỂM CẦN XÁC NHẬN

**PRI:** trong tất cả các biểu đã xử lý, Xmin và Xmax của PRI luôn kết thúc bằng `,0` (77,0 – 81,0). Điều này gợi ý PRI thực tế được ghi theo **số nguyên**. Hiện quy tắc đang sinh theo bước 0,1. Nếu đúng là số nguyên, hãy báo để chuyển PRI sang bước 1,0.
