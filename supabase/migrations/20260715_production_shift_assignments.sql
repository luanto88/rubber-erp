-- Bảng phân công trực ca cố định theo nhà máy (mục 5, .claude/rules/06-module-production.md
-- mục 4.6 "Cập nhật 2026-07-15") — cho phép admin gán trước "ai luôn trực Ca A/B/C" trong Cài
-- đặt, để trang quét QR (product/confirm) tự gợi ý đúng Ca thay vì luôn mặc định "Ca A".
--
-- Cố ý ĐƠN GIẢN, không có lịch sử effective_from/to như dispatch_vehicle_driver_assignments —
-- mỗi (factory_id, ca) có tối đa 1 dòng active tại một thời điểm, đổi người trực chỉ cần sửa
-- thẳng dòng đó. Nếu sau này cần theo dõi lịch sử đổi trực ca theo thời gian, mở rộng thêm cột
-- effective_from/to tương tự bảng xe — chưa cần ở phạm vi hiện tại.
CREATE TABLE IF NOT EXISTS production_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES factories(id),
  ca text NOT NULL CHECK (ca IN ('A', 'B', 'C')),
  -- assigned_user_id ưu tiên khi có tài khoản thật; assigned_name là tên hiển thị dự phòng khi
  -- người trực ca chưa có/không có tài khoản đăng nhập riêng (vẫn muốn ghi nhận trên bảng phân công).
  assigned_user_id uuid REFERENCES auth.users(id),
  assigned_name text,
  ghi_chu text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (factory_id, ca)
);

CREATE INDEX IF NOT EXISTS idx_production_shift_assignments_factory
  ON production_shift_assignments(factory_id);
CREATE INDEX IF NOT EXISTS idx_production_shift_assignments_user
  ON production_shift_assignments(assigned_user_id);

DROP TRIGGER IF EXISTS trg_production_shift_assignments_updated_at ON production_shift_assignments;
CREATE TRIGGER trg_production_shift_assignments_updated_at
BEFORE UPDATE ON production_shift_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE production_shift_assignments ENABLE ROW LEVEL SECURITY;

-- Đọc: mọi authenticated user trong app cần tự tra "mình trực ca nào" khi mở trang quét QR —
-- mirror đúng "Allow all" đã dùng cho ngans/lots/lot_prediction_lots (xem 20260709_lot_predictions.sql).
DROP POLICY IF EXISTS production_shift_assignments_select ON production_shift_assignments;
CREATE POLICY production_shift_assignments_select ON production_shift_assignments
  FOR SELECT USING (true);

-- Ghi: qua UI Cài đặt (Supabase browser client, không phải service role) — gate quyền thật ở
-- tầng ứng dụng bằng permission settings.manage_config, giống cách các bảng cấu hình nhà máy
-- khác (dispatch_delivery_points, quality_targets...) đang vận hành trong repo này.
DROP POLICY IF EXISTS production_shift_assignments_write ON production_shift_assignments;
CREATE POLICY production_shift_assignments_write ON production_shift_assignments
  FOR ALL USING (true) WITH CHECK (true);
