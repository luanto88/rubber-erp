-- GĐ2e — Bằng chứng cho người duyệt đề nghị mua vật tư.
-- Chụp lại tồn kho / tiêu hao 90 ngày / nhập-xuất gần nhất / lần mua đã duyệt gần nhất / phiếu khác
-- còn mở của TỪNG DÒNG vật tư tại thời điểm GỬI KÝ (không join sống — số liệu kho thay đổi theo thời
-- gian, bằng chứng phải là số lúc đề nghị). Ghi bởi POST /api/purchase/requests/[id]/insight-snapshot
-- (service role). Phiếu gửi ký trước migration này: NULL (UI ghi rõ "không có số liệu chụp lại").
-- Chạy TRƯỚC khi deploy code: route submit kiểm cột này, thiếu cột là gửi ký lỗi.

ALTER TABLE purchase_request_lines
  ADD COLUMN IF NOT EXISTS insight_snapshot JSONB;

COMMENT ON COLUMN purchase_request_lines.insight_snapshot IS
  'Bằng chứng tồn kho/tiêu hao/lần mua trước chụp lúc gửi ký (GĐ2e). JSON PurchaseInsightSnapshot, kèm capturedAt.';
