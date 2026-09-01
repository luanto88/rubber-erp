-- Bổ sung cột chẩn đoán khi lớp ký PAdES (chữ ký số thật, cộng thêm trên con dấu ảnh) bị bỏ
-- qua hoặc lỗi — trước đây chỉ có `console.error` (chỉ xem được qua log server, không xem
-- được từ xa nếu chạy trên Vercel), khiến không chẩn đoán được tại sao 1 lượt ký cụ thể
-- không có PAdES (trang /sign-verify báo "chưa được ký số điện tử"). Cột này KHÔNG bắt buộc
-- (NULL nếu PAdES thành công hoặc chưa từng thử), ghi bằng UPDATE riêng giống pades_sig_index
-- (xem src/lib/signing/requests.ts) để không ảnh hưởng luồng ký chính nếu migration chưa chạy.

ALTER TABLE public.nguoi_ky
  ADD COLUMN IF NOT EXISTS pades_error TEXT;

COMMENT ON COLUMN public.nguoi_ky.pades_error IS
  'Lý do lớp PAdES bị bỏ qua/lỗi ở lượt ký này (NULL = thành công hoặc chưa thử). Chỉ mang tính chẩn đoán, không ảnh hưởng workflow ký chính.';
