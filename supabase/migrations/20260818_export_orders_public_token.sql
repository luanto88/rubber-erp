-- Thêm mã bí mật (public_token) riêng cho từng đơn xuất hàng, dùng để nhúng vào QR trên
-- file DDS. Mục đích: quét QR của đơn XYZ chỉ mở đúng dữ liệu/file của đơn XYZ, không cho
-- phép xem thêm các đơn khác dù người quét đang đăng nhập chung 1 tài khoản khách hàng đã
-- được cấp quyền xem nhiều đơn (tránh lộ toàn bộ "Đơn hàng của tôi" chỉ vì quét 1 QR).
--
-- gen_random_uuid() là default "volatile" -> Postgres tự sinh giá trị ngẫu nhiên RIÊNG cho
-- từng dòng đã có sẵn ngay khi ALTER TABLE chạy, không cần bước backfill UPDATE riêng.

ALTER TABLE export_orders
  ADD COLUMN IF NOT EXISTS public_token UUID DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_export_orders_public_token
  ON export_orders(public_token);
