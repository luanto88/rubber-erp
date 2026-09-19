-- GĐ 5 EUDR: lưu hình học GỐC (trước làm sạch) + hash + thời điểm làm sạch — từ nay
-- forest_plots.geometry là bản ĐÃ SẠCH (bản chính dùng cho Whisp/khai báo, xem
-- src/lib/eudr-write-gate.ts), không còn mất dấu vết khi cổng ghi sửa ranh giới lúc lưu.
--
-- Ghi bởi: src/app/dashboard/settings/page.tsx's saveForestPlot (vẽ tay 1 lô) và
-- handleImportForestPlotGeoJSON (import hàng loạt) qua eudr-write-gate.ts's
-- prepareForestPlotGeometry/mergeGeometryPieces + computeGeometryHash.

ALTER TABLE forest_plots ADD COLUMN IF NOT EXISTS geometry_raw JSONB;
ALTER TABLE forest_plots ADD COLUMN IF NOT EXISTS geometry_hash TEXT;
ALTER TABLE forest_plots ADD COLUMN IF NOT EXISTS geometry_cleaned_at TIMESTAMPTZ;

COMMENT ON COLUMN forest_plots.geometry_raw IS 'Hình học gốc trước khi qua eudr-write-gate.ts (NULL nếu lô chưa từng có geometry thô khác geometry đã sạch).';
COMMENT ON COLUMN forest_plots.geometry_hash IS 'SHA-256 hex của geometry đã sạch (forest_plots.geometry) — src/lib/eudr-write-gate.ts computeGeometryHash().';
COMMENT ON COLUMN forest_plots.geometry_cleaned_at IS 'Thời điểm geometry được làm sạch qua eudr-write-gate.ts.';

-- Không cần policy RLS mới — các policy hiện có của forest_plots (INSERT/UPDATE theo
-- factory_id qua current_profile_factory_id(), xem 20260821_rls_lockdown_master_data_full.sql
-- và 20260819_forest_plots_admin_factory_scope.sql) đã bao trùm mọi cột.
