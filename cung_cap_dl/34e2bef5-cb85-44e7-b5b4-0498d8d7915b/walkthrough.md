# Báo cáo hoàn thành: Bản vá Màn 1 (Cài đặt vị trí ký) & Chuẩn bị Màn 2

Tài liệu này tổng hợp toàn bộ các điều chỉnh đã thực hiện nhằm giải quyết dứt điểm 3 vấn đề người dùng phát hiện trên localhost trong **Màn 1 (Soạn thảo & Cài đặt vị trí ký)**, đồng thời chuẩn bị sẵn sàng cho bước chuyển tiếp sang **Màn 2 (Ký duyệt tập trung - Xem xét & Phê duyệt)**.

---

## 1. Chi tiết các bản vá đã triển khai

### Vấn đề 1: Nút "Gửi xem xét" chỉ hiển thị sau khi cài đặt vị trí ký
- **Tệp sửa đổi**: [`iso/documents/[id]/page.tsx`](file:///c:/Users/Software/rubber-erp/src/app/dashboard/iso/documents/[id]/page.tsx)
- **Cơ chế hoạt động**:
  1. Khi tài liệu ở trạng thái `draft` hoặc `tra_ve`, nút hành động chính cho người soạn thảo chuyển thành **"Cài đặt vị trí & Gửi đi"** (icon `FileSignature`, nổi bật), ẩn nút "Gửi xem xét" trực tiếp.
  2. Bấm nút này sẽ chuyển người dùng sang màn cài đặt vị trí ký [`/dashboard/ky/mau-vi-tri`](file:///c:/Users/Software/rubber-erp/src/app/dashboard/ky/mau-vi-tri/page.tsx).
  3. Sau khi xác nhận vị trí, hệ thống điều hướng quay lại trang chi tiết kèm cờ `confirmedSignTemplate=1`.
  4. Trang chi tiết tự động bắt cờ, dọn URL và **tự động bật Modal PIN gửi xem xét** ngay lập tức. Người soạn thảo chỉ cần nhập 6 số PIN là tài liệu được gửi đi.
  5. Nếu đóng modal PIN, giao diện sẽ hiển thị nút "Chỉnh sửa vị trí ký" (màu xanh lá) cùng nút "Gửi xem xét" (màu cam).

### Vấn đề 2: Ràng buộc phải cài đặt vị trí cho tất cả biểu mẫu con kèm theo
- **Tệp sửa đổi**: [`mau-vi-tri/page.tsx`](file:///c:/Users/Software/rubber-erp/src/app/dashboard/ky/mau-vi-tri/page.tsx)
- **Cơ chế hoạt động**:
  1. Hệ thống truy vấn trạng thái mẫu (`mau_vi_tri`) của toàn bộ tài liệu cha và từng biểu mẫu con trong bộ hồ sơ.
  2. Trên thanh **"Bộ hồ sơ"**, mỗi tab biểu mẫu hiển thị huy hiệu trực quan:
     - 🟢 `✓ Đã đặt`: đã có mẫu vị trí lưu trong hệ thống.
     - 🟡 `• Chưa đặt`: có file PDF nhưng chưa được cài đặt vị trí ký.
  3. Khi bấm **"Xác nhận vị trí & Gửi đi"**: Hệ thống kiểm tra toàn diện cả tài liệu cha và tất cả biểu mẫu con. Nếu còn bất kỳ tài liệu/biểu mẫu nào chưa được cấu hình, hệ thống **chặn gửi** và hiển thị thông báo chi tiết:
     > *"Chưa thể gửi đi: Còn [N] tài liệu/biểu mẫu chưa cài đặt vị trí ([Danh sách mã]). Vui lòng chọn từng tài liệu trên thanh 'Bộ hồ sơ' để đặt vị trí trước khi gửi đi."*

### Vấn đề 3: Bỏ hoàn toàn popup `window.confirm()` khi chuyển tab sang Tự động lưu ngầm
- **Tệp sửa đổi**: [`mau-vi-tri/page.tsx`](file:///c:/Users/Software/rubber-erp/src/app/dashboard/ky/mau-vi-tri/page.tsx)
- **Cơ chế hoạt động**:
  1. **Xoá bỏ hộp thoại `confirm()` của trình duyệt**: Người dùng không còn bị gián đoạn hay bối rối bởi các câu hỏi Yes/No.
  2. **Tự động lưu ngầm (Auto-save on Tab Switch)**: Khi người dùng đang thao tác trên một tài liệu (có thay đổi vị trí khung `dirty`) và bấm chuyển sang tab biểu mẫu khác, hệ thống sẽ:
     - Tự động gọi API lưu mẫu của tài liệu hiện tại lên server ngầm.
     - Cập nhật huy hiệu `✓ Đã đặt` cho tài liệu vừa lưu.
     - Hiển thị Toast thông báo: *"Đã tự động lưu vị trí cho [Mã tài liệu]"*.
     - Reset trạng thái khung trong lúc tải tài liệu mới để tránh hiện tượng nhấp nháy khung cũ (ghost boxes).

---

## 2. Kết quả kiểm tra tự động

| Công cụ kiểm tra | Lệnh | Kết quả | Ghi chú |
| :--- | :--- | :---: | :--- |
| **TypeScript** | `npx tsc --noEmit` | **PASS (0 lỗi)** | Toàn bộ type-safety đảm bảo |
| **ESLint** | `npx eslint ...` | **PASS (0 lỗi)** | Đạt chuẩn code style |

---

## 3. Hướng dẫn kiểm thử nhanh trên Localhost

Bạn có thể mở trình duyệt trên localhost (`http://localhost:3000`) và thực hiện các bước sau:

1. **Mở tài liệu ISO đang soạn thảo (`draft` hoặc `tra_ve`) có biểu mẫu con**:
   - Xác nhận trên thanh tiêu đề: chỉ hiển thị nút **"Cài đặt vị trí & Gửi đi"** (nút màu cam hổ phách có icon bút ký), không còn nút "Gửi xem xét" tắt ngang.
2. **Bấm "Cài đặt vị trí & Gửi đi"**:
   - Trình duyệt chuyển sang màn Cài đặt vị trí ký.
   - Quan sát thanh **"Bộ hồ sơ"**: hiển thị tab Quy trình chính và các tab Biểu mẫu con kèm huy hiệu `✓ Đã đặt` hoặc `• Chưa đặt`.
3. **Thử bấm chuyển tab giữa Quy trình và các Biểu mẫu**:
   - Kéo-thả 1 khung trên tab hiện tại, sau đó bấm chọn tab Biểu mẫu khác.
   - Xác nhận: **Không còn bất kỳ hộp thoại `confirm` nào của trình duyệt**. Hệ thống tự động lưu êm dịu và hiện Toast xanh thông báo đã lưu.
4. **Kiểm tra chặn gửi khi chưa đặt đủ biểu mẫu**:
   - Nếu còn biểu mẫu con `• Chưa đặt`, bấm **"Xác nhận vị trí & Gửi đi"**.
   - Xác nhận: Hệ thống chặn lại và thông báo danh sách mã biểu mẫu còn thiếu.
5. **Hoàn tất và gửi đi**:
   - Chọn lần lượt các biểu mẫu còn thiếu để kéo khung vị trí.
   - Bấm **"Xác nhận vị trí & Gửi đi"**:
   - Trình duyệt tự động chuyển về trang chi tiết tài liệu và **tự động mở sẵn Modal PIN gửi xem xét**!
   - Người soạn thảo chỉ cần nhập 6 số PIN để hoàn tất.

---

## 4. Sẵn sàng chuyển sang Màn 2: Ký duyệt tập trung

Sau khi bạn xác nhận Màn 1 hoạt động hoàn hảo trên localhost, chúng tôi sẽ tiến hành triển khai **Màn 2 (Ký duyệt tập trung cho Người xem xét & Người phê duyệt)** với các tính năng:
- Tự động nạp mẫu vị trí đã lưu cho Quy trình và toàn bộ các Biểu mẫu con.
- Thanh thumbnail lướt nhanh toàn bộ các trang của cha và con, hiển thị khung màu trên thumbnail để nhận diện ngay trang nào cần ký.
- Ràng buộc ký: Cho phép lưu nếu lãnh đạo chỉ cần ký ở Quy trình chính; bắt buộc ký đủ khung nếu có khung được phân công trên hồ sơ con.
