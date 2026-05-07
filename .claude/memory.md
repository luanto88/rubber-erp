# Rubber ERP - Bộ nhớ dự án

## Tổng quan

Hệ thống ERP quản lý sản xuất cao su cho:

- Công ty TNHH PTCS Phước Hòa Kampong Thom
- Mô hình nhiều nhà máy, mọi dữ liệu nghiệp vụ phải gắn với `factory_id`
- Stack chính: Next.js App Router, TypeScript, Tailwind CSS, Supabase

## Nhà máy

- Phước Hòa KPT: dùng prefix `CSR`
- Cuaparis: dùng prefix `SVR`

## Nguyên tắc cốt lõi

- Luôn filter dữ liệu theo `factory_id`
- `day_chuyen` là trục lọc chính trong các module sản xuất
- Cấu hình sản phẩm không được hard-code rải rác; ưu tiên lấy từ cấu hình nhà máy hoặc database
- Supabase Auth session là source of truth cho đăng nhập
- Không xóa file hoặc dữ liệu khi chưa có xác nhận rõ ràng

## Thành phẩm và ngăn liệu

- Bánh `35` và `33.33`: lô tròn `144`
- Bánh `20`: lô tròn `240`
- Trạng thái lô chuẩn: `Dở dang`, `Hoàn thành`, `Xuất hàng`
- Trạng thái ngăn chuẩn: `Đang nhận`, `Đóng`, `Chờ sản xuất`, `Đang sản xuất`, `Đã sản xuất`

### Quy tắc xóa dòng sản xuất

- Mỗi dòng session trong `/dashboard/product` phải đại diện cho đúng một `lot_transactions.id`
- Xóa dòng là xóa từng transaction, không xóa cả master lot nếu vẫn còn transaction khác
- Không còn rule chặn “chỉ xóa transaction mới nhất”
- Sau khi xóa transaction:
  - nếu còn transaction khác thì đồng bộ lại snapshot master lot
  - nếu không còn transaction nào thì mới xóa master lot

### Quy tắc đồng bộ trạng thái ngăn

- Tính theo tổng `so_kg` từ `lot_transactions` của từng `ngan_id`
- Tổng kg bằng `0` -> `Chờ sản xuất`
- Dưới `100%` -> `Đang sản xuất`
- Từ `100%` đến `110%`:
  - nếu đã là `Đã sản xuất` thì giữ nguyên
  - nếu chưa phải `Đã sản xuất` thì cho phép cập nhật theo workflow hiện tại

### Quy tắc cảnh báo lô dở dang

- Trong `/dashboard/product`, cảnh báo lô dở dang đang hiển thị theo tất cả lô dở dang cùng dây chuyền
- Cảnh báo này không lọc theo năm thành phẩm
- Cảnh báo ngoài list và trong form tạo mới phải dùng cùng một rule để không bị lệch số lượng

### Quy tắc gợi ý trong form tạo mới

- Gợi ý số lô gần nhất vẫn tính theo series `loai_csr + loai_banh + year`
- Nhưng danh sách cảnh báo lô dở dang là theo dây chuyền, không theo năm
- Ca đầu khi mở session tạo mới phải sinh draft ngay theo `from_num/to_num`, không chờ người dùng tăng giảm số lô mới hiện kiện

## Xuất hàng

- Lot picker chỉ lấy lô có trạng thái hợp lệ và còn `remaining > 0`
- Nếu không lọc ra lô để tạo phiếu xuất, phải kiểm tra trước:
  - chuỗi trạng thái dùng trong query
  - các chuỗi UI/constant có bị mojibake không
  - logic `remaining` có đang loại hết lô hay không
- Session Xuất hàng phải giữ tiếng Việt có dấu, đúng chính tả để không làm sai filter và thao tác người dùng

## Ngôn ngữ hiển thị

- Luôn luôn sử dụng tiếng Việt có dấu, đúng chính tả
- Trên web, luôn đảm bảo nội dung hiển thị bằng tiếng Việt có dấu, đúng chính tả, ngoại trừ khi người dùng yêu cầu khác
- Chỉ đổi sang ngôn ngữ khác hoặc bỏ dấu khi người dùng yêu cầu rõ ràng
- Khi sửa UI hoặc tài liệu nội bộ, ưu tiên thay các chuỗi lỗi mã hóa bằng tiếng Việt chuẩn
- Không dùng script convert encoding toàn file cho các route lớn nếu chưa kiểm soát kỹ; ưu tiên sửa trực tiếp từng cụm UI

## Ghi nhớ thao tác

- Khi sửa Next.js trong repo này, phải đọc tài liệu tương ứng trong `node_modules/next/dist/docs/`
- Khi sửa module thành phẩm, ưu tiên kiểm tra đồng thời:
  - `src/app/dashboard/product/page.tsx`
  - `src/app/dashboard/product/actions.ts`
  - `src/app/dashboard/product/shared.ts`
- Khi sửa module xuất hàng, ưu tiên kiểm tra:
  - `src/app/dashboard/export/page.tsx`
- Sau các thay đổi quan trọng ở module thành phẩm hoặc xuất hàng, cần chạy:
  - `npx eslint src/app/dashboard/product/page.tsx src/app/dashboard/export/page.tsx src/app/dashboard/product/actions.ts src/app/dashboard/product/shared.ts`
  - `npm run build`
