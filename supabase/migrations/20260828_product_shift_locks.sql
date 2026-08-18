-- Khóa ca sản xuất Thành phẩm — chặn ghi/sửa/xóa lot_transactions của một (nhà máy, ngày sản
-- xuất, ca) sau khi người có quyền đã "Duyệt & Khóa". Giải quyết rủi ro: công nhân quét QR chọn
-- nhầm ngày sản xuất (vd quét hôm nay nhưng chọn nhầm hôm qua) — không có validate ngày nào ở
-- bất kỳ tầng nào trước đây, và "Kết thúc ca" trước giờ chỉ sinh PDF, không khóa gì cả.
-- Xem plan đầy đủ: .claude/rules/06-module-production.md mục "Khóa ca sản xuất".
--
-- Bảng lưu LỊCH SỬ ĐẦY ĐỦ (không ghi đè) — mỗi lần Khóa tạo 1 dòng mới; Mở khóa chỉ set
-- is_active=false trên dòng hiện tại, giữ nguyên để truy vết ai khóa/mở khóa lúc nào vì sao.
-- Cho phép khóa → mở khóa → khóa lại nhiều lần cho cùng 1 (ngày, ca).

CREATE TABLE IF NOT EXISTS product_shift_locks (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id    UUID NOT NULL REFERENCES factories(id),
  ngay_sx       DATE NOT NULL,
  ca            TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  locked_by     UUID NOT NULL REFERENCES auth.users,
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlocked_by   UUID REFERENCES auth.users,
  unlocked_at   TIMESTAMPTZ,
  unlock_reason TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Chỉ 1 khóa active tại 1 thời điểm cho mỗi (factory, ngày, ca) — partial unique index, KHÔNG
-- phải UNIQUE thường (phải cho phép nhiều dòng lịch sử is_active=false chồng lên nhau).
CREATE UNIQUE INDEX IF NOT EXISTS product_shift_locks_active_unique
  ON product_shift_locks (factory_id, ngay_sx, ca) WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_product_shift_locks_lookup
  ON product_shift_locks (factory_id, ngay_sx, ca);

ALTER TABLE product_shift_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_shift_locks_select" ON product_shift_locks;
CREATE POLICY "product_shift_locks_select" ON product_shift_locks
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());
-- Không cấp policy INSERT/UPDATE/DELETE cho `authenticated` — mọi ghi bắt buộc đi qua RPC
-- product_lock_shift()/product_unlock_shift() (SECURITY DEFINER, xem migration kế tiếp).

-- Helper dùng chung — trả về true nếu (factory, ngày, ca) đang có khóa active. Dùng cả trong
-- các RPC khác (delete_lot_transaction, submit_confirm_draft_batch) lẫn trong RLS policy mở
-- rộng của lot_transactions/lots.
CREATE OR REPLACE FUNCTION public.product_shift_is_locked(
  p_factory_id UUID, p_ngay_sx DATE, p_ca TEXT
) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM product_shift_locks
    WHERE factory_id = p_factory_id AND ngay_sx = p_ngay_sx AND ca = p_ca AND is_active
  );
$$;

GRANT EXECUTE ON FUNCTION public.product_shift_is_locked(UUID, DATE, TEXT) TO authenticated, service_role;
