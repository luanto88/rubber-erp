ALTER TABLE dispatch_entry_rows
  ADD COLUMN IF NOT EXISTS stops_detail JSONB DEFAULT NULL;

COMMENT ON COLUMN dispatch_entry_rows.stops_detail IS
  'Per-point phien mapping: [{diem: "E1", phien: ["Phiên A"]}, ...]. NULL = dùng phien[] phẳng (backward compat)';
