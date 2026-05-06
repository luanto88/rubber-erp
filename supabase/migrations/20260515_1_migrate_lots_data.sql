-- ============================================================
-- Migration: Chuyển đổi dữ liệu cũ từ bảng lots sang lot_transactions
-- Mục đích: Đảm bảo dữ liệu cũ không bị mất và Trigger tính tổng hoạt động đúng
-- ============================================================

DO $$
BEGIN
  INSERT INTO lot_transactions (
      lot_id, ngan_id, ca, ngay_nhap, 
      kien_a, kien_b, kien_c, kien_d, 
      so_banh, so_kg, created_at
  )
  SELECT 
      id as lot_id,
      ngan_id,
      COALESCE(ca, 'Ca A') as ca,
      -- Nếu lô đã hoàn thành thì lấy ngay_ht (ngày chốt), chưa thì lấy ngay_sx
      COALESCE(ngay_ht, ngay_sx) as ngay_nhap,
      COALESCE(kien_a, 0),
      COALESCE(kien_b, 0),
      COALESCE(kien_c, 0),
      COALESCE(kien_d, 0),
      COALESCE(tong_banh, 0) as so_banh,
      COALESCE(tong_kg, 0) as so_kg,
      created_at
  FROM lots
  WHERE id NOT IN (SELECT lot_id FROM lot_transactions);
END $$;