# Kế hoạch: Gia công ngoài trong Đề nghị mua (đánh giá `cung_cap_dl/gia_cong.txt`) — CHỜ DUYỆT, CHƯA CODE

Đối chiếu code + DB thật (chỉ đọc) ngày 2026-11-09.

## Xác nhận lỗi / vấn đề
| # | Vấn đề | Kết luận | Bằng chứng |
|---|---|---|---|
| V1 | Danh sách / chi tiết / PDF không phân biệt phiếu mua vật tư với phiếu gia công | ĐÚNG | `purchase/page.tsx` không có badge loại phiếu; PDF luôn in tiêu đề mua vật tư; chỉ có nhãn "Dịch vụ" trong ô chọn vật tư của form |
| V2 | Tab "Gia công ngoài" chỉ hiện các lần ĐÃ xác nhận hoàn thành ⇒ phiếu gia công đang ký / đã duyệt chờ hoàn thành bị ẩn | ĐÚNG | API `service-completions` chỉ đọc `purchase_service_completions`. DB: 3 phiếu thuần gia công **101, 111, 112/2026** (đang chờ ký, 0 lần hoàn thành) không hiện ở tab này |
| V3 | "+ Lập phiếu" không có ngữ cảnh gia công (nhãn Mua tại / Có hàng / Cần hàng, nút Tạo mới mặc định là vật tư) | ĐÚNG (vấn đề trải nghiệm) | form dùng chung nhãn vật tư; modal tạo mới mặc định `laDichVu: false` |
| V4 | Form nhận diện dịch vụ theo `nguon_tao === "bao_tri_gia_cong"`, server dùng `la_dich_vu` | ĐÚNG nhưng **chưa gây lỗi** | DB: 3 mã dịch vụ, 0 mã lệch giữa 2 cờ. Rủi ro khi sau này có dịch vụ tạo từ nguồn khác |

## Đánh giá đề xuất trong file + điều chỉnh
- **HM1 (badge loại phiếu)** — đồng ý. Điều chỉnh: dùng `StatusBadge tone+label` (rule 05, không tự tô span màu); `requestKind` tính ở API từ `serviceItemIds` đã có sẵn trong route danh sách (không truy vấn mới). Bộ lọc loại phiếu đặt trong `FilterBar` hiện có.
  - ⚠️ **Tiêu đề PDF**: phiếu đang theo mẫu ISO "Đề nghị mua vật tư hàng hóa" (số ĐNMVT). Đổi tiêu đề = đổi biểu mẫu ⇒ **cần anh quyết** (xem câu hỏi Q1). Đề xuất: giữ tiêu đề, thêm dòng phụ "(Gia công ngoài)" / "(Gồm gia công ngoài)" + chữ "GC" ở cột Ghi chú từng dòng dịch vụ.
- **HM2 (chế độ lập phiếu gia công)** — đồng ý một phần. Điều chỉnh: đổi nhãn **theo từng dòng** (dòng là dịch vụ ⇒ "Đơn vị nhận gia công", "Ngày dự kiến xong", "Ngày cần hoàn thành") thay vì cả trang, vì phiếu hỗn hợp có thật (lập từ biên bản). `?mode=gia_cong` chỉ đổi tiêu đề banner, bộ lọc mặc định ô chọn và mặc định "Tạo mới = Dịch vụ". Không thêm cột DB (vẫn ghi `mua_tai`, `ngay_co_hang`, `ngay_can_hang`).
- **HM3 (tab Gia công ngoài đủ vòng đời)** — đồng ý, ưu tiên cao nhất (V2 làm mất phiếu). Tab có 2 thẻ con: "Phiếu gia công" (mọi trạng thái, dùng lại API danh sách với `kind=gia_cong,hon_hop`, nút Ký ngay / Xác nhận hoàn thành trên dòng như danh sách chính) và "Sổ hoàn thành" (bảng hiện tại + Excel). Drawer "Danh mục dịch vụ": **để sau** (đã có ở Cài đặt → Bảo trì → Vật tư mua ngoài).
- **V4** — sửa kèm: form select thêm `la_dich_vu`, helper `isServiceItem(it) = it.la_dich_vu || it.nguon_tao === "bao_tri_gia_cong"` dùng chung.

## Thứ tự đề xuất (mỗi bước tsc + eslint + test tay riêng)
1. **B1** — V4 + `requestKind`/`la_dich_vu` ở API danh sách & chi tiết (không đổi giao diện). Không migration.
2. **B2** — HM3: tab Gia công ngoài 2 thẻ con.
3. **B3** — HM1: badge loại phiếu + bộ lọc + nhãn dòng dịch vụ ở chi tiết; PDF theo quyết định Q1.
4. **B4** — HM2: nhãn theo dòng + `?mode=gia_cong` + nút "+ Lập phiếu gia công" ở tab Gia công.
5. Cập nhật tab "Hướng dẫn" (`purchase-guide.tsx`) + rule 28.

## Câu hỏi cần anh chốt trước khi code
- **Q1**: Tiêu đề PDF phiếu thuần gia công — (a) giữ tiêu đề mẫu ISO + dòng phụ "(Gia công ngoài)" [khuyến nghị]; (b) đổi hẳn "PHIẾU ĐỀ NGHỊ GIA CÔNG NGOÀI" (cần xác nhận mã biểu mẫu ISO có cho phép).
- **Q2**: Phiếu gia công có dùng chung dãy số ĐNMVT không (hiện tại: chung)? Đề xuất giữ chung, không tách dãy.
- **Q3**: Màu badge: Gia công = tông violet (tím) như nhãn "Dịch vụ" đang dùng; Mua vật tư = không badge (mặc định) để danh sách đỡ rối; Hỗn hợp = "VT + GC". Đồng ý?
