-- 1. Tạo bảng giao dịch chi tiết Lô (lot_transactions)
CREATE TABLE IF NOT EXISTS lot_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
    ngan_id UUID NOT NULL REFERENCES ngans(id),
    ca TEXT NOT NULL,
    ngay_nhap DATE NOT NULL,
    kien_a NUMERIC DEFAULT 0,
    kien_b NUMERIC DEFAULT 0,
    kien_c NUMERIC DEFAULT 0,
    kien_d NUMERIC DEFAULT 0,
    so_banh NUMERIC NOT NULL DEFAULT 0,
    so_kg NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Thêm index để tối ưu Query thống kê theo lô, ngăn và ca
CREATE INDEX IF NOT EXISTS idx_lot_transactions_lot_id ON lot_transactions(lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_transactions_ngan_id ON lot_transactions(ngan_id);
CREATE INDEX IF NOT EXISTS idx_lot_transactions_ca ON lot_transactions(ca);

-- 2. Tạo Function để tự động cập nhật tổng bành, tổng kg và trạng thái lên bảng lots
CREATE OR REPLACE FUNCTION update_lot_master_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_tong_banh NUMERIC;
    v_tong_kg NUMERIC;
    v_loai_banh NUMERIC;
    v_lo_tron NUMERIC;
    v_trang_thai TEXT;
BEGIN
    -- Tính tổng số bành và kg từ tất cả các giao dịch của lô này
    SELECT COALESCE(SUM(so_banh), 0), COALESCE(SUM(so_kg), 0)
    INTO v_tong_banh, v_tong_kg
    FROM lot_transactions
    WHERE lot_id = COALESCE(NEW.lot_id, OLD.lot_id);

    -- Lấy thông tin loai_banh từ bảng lots để xác định quy tắc lô tròn
    SELECT loai_banh INTO v_loai_banh
    FROM lots WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);

    -- Xác định quy tắc lô tròn (20kg -> 240 bành, khác -> 144 bành)
    IF v_loai_banh = 20 THEN v_lo_tron := 240; ELSE v_lo_tron := 144; END IF;

    -- Xác định trạng thái mới
    IF v_tong_banh >= v_lo_tron THEN v_trang_thai := 'Hoan thanh'; ELSE v_trang_thai := 'Do dang'; END IF;

    -- Cập nhật vào bảng master (lots)
    UPDATE lots
    SET tong_banh = v_tong_banh, tong_kg = v_tong_kg, trang_thai = v_trang_thai
    WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Gắn Trigger vào bảng lot_transactions
DROP TRIGGER IF EXISTS trigger_update_lot_master ON lot_transactions;
CREATE TRIGGER trigger_update_lot_master
AFTER INSERT OR UPDATE OR DELETE ON lot_transactions
FOR EACH ROW EXECUTE FUNCTION update_lot_master_totals();