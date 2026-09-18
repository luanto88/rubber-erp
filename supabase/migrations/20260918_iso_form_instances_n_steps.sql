-- Migration: Chuyển iso_form_instances sang mô hình N bước ký động (như van_ban_documents)
-- Giữ nguyên toàn bộ cột cũ cho hồ sơ legacy (so_buoc_tong = 0)

ALTER TABLE iso_form_instances
  ADD COLUMN IF NOT EXISTS thu_tu_ky_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS buoc_hien_tai   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS so_buoc_tong    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nguoi_ky        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS placement_ky    JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN iso_form_instances.thu_tu_ky_json IS 'Mảng các bước ký động [ { step: 1, type: "ca_nhan", user_id: "...", ten: "...", chuc_vu: "..." }, ... ]';
COMMENT ON COLUMN iso_form_instances.buoc_hien_tai IS 'Chỉ số bước đang chờ ký (0-indexed, khớp với van_ban_documents)';
COMMENT ON COLUMN iso_form_instances.so_buoc_tong IS 'Tổng số bước ký động. = 0 là hồ sơ legacy (dùng cap_tl, soan_thao_*, xem_xet_*, phe_duyet_*)';
COMMENT ON COLUMN iso_form_instances.nguoi_ky IS 'Snapshot người ký từng bước { "1": { ten, chuc_vu, ky_at, sign_as }, ... }';
COMMENT ON COLUMN iso_form_instances.placement_ky IS 'Bố cục / placement của từng bước ký và QR { "1": {...}, "qr": {...} }';

COMMENT ON COLUMN iso_form_instances.cap_tl IS 'LEGACY: Cấp 1 / Cấp 2 chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.soan_thao IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.soan_thao_placement IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.soan_thao_signed_url IS 'LEGACY: File ký bước 1 cũ khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.ky_soan_thao_at IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.xem_xet_user_id IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.xem_xet IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.ky_xem_xet_at IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.xem_xet_placement IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.phe_duyet_user_id IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.phe_duyet IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.ky_phe_duyet_at IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
COMMENT ON COLUMN iso_form_instances.phe_duyet_placement IS 'LEGACY: Chỉ dùng khi so_buoc_tong = 0';
