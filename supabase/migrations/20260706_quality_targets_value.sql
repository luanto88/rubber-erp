-- Migration: Thêm giá trị "Trọng tâm" (target_value) cho Mục tiêu chất lượng
-- Dùng để vẽ đường thẳng đứng đối chiếu đỉnh biểu đồ phân bố với giá trị lý tưởng
-- muốn nhắm tới — tách biệt với nguong_min/nguong_max (dùng để tính đạt/không đạt).

ALTER TABLE quality_targets ADD COLUMN IF NOT EXISTS target_value NUMERIC;
