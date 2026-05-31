-- Migration: Sửa unique constraint mã tài liệu ISO để cho phép soát xét draft
-- cùng mã với bản đang co_hieu_luc (constraint cũ chặn luồng soát xét)

-- Xóa index cũ (áp dụng toàn bộ rows, gây lỗi khi insert soát xét draft)
DROP INDEX IF EXISTS uniq_iso_documents_factory_ma_tai_lieu;

-- Index 1: đảm bảo chỉ 1 tài liệu co_hieu_luc mỗi mã trong 1 nhà máy
-- het_hieu_luc được phép trùng mã (version history soát xét)
CREATE UNIQUE INDEX uniq_iso_documents_factory_ma_tai_lieu_active
  ON iso_documents(factory_id, upper(trim(ma_tai_lieu)))
  WHERE ma_tai_lieu IS NOT NULL
    AND trim(ma_tai_lieu) <> ''
    AND trang_thai = 'co_hieu_luc';

-- Index 2: đảm bảo không có 2 tài liệu NON-soát-xét cùng mã ở trạng thái draft
-- Soát xét draft được phép chia sẻ mã với bản co_hieu_luc (cho đến khi phê duyệt)
CREATE UNIQUE INDEX uniq_iso_documents_factory_ma_tai_lieu_draft
  ON iso_documents(factory_id, upper(trim(ma_tai_lieu)))
  WHERE ma_tai_lieu IS NOT NULL
    AND trim(ma_tai_lieu) <> ''
    AND (chon_quy_trinh IS NULL OR chon_quy_trinh <> 'Soát xét')
    AND trang_thai NOT IN ('co_hieu_luc', 'het_hieu_luc');
