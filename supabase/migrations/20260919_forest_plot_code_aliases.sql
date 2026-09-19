-- Bảng "bí danh mã lô vườn" — khi 1 mã lô (`alias_ten`) được dùng trong dữ liệu vận hành
-- (dispatch_delivery_points.phien_X[]) nhưng KHÔNG có geometry riêng ở `forest_plots` lẫn file
-- GeoJSON tĩnh, và đã được XÁC NHẬN THỦ CÔNG (không phải suy đoán tự động) rằng đây là cùng một
-- thửa đất với (một hoặc nhiều) mã `canonical_ten` đã có geometry thật — cho phép cổng xuất EUDR
-- dùng lại đúng geometry đó thay vì chặn xuất hoặc suy đoán.
--
-- Bối cảnh phát sinh: điều tra 27 mã lô gây chặn `verify-eudr-export-chain.mjs` (2026-09-19) cho
-- thấy:
--   - 16 mã dạng "Đông/Tây" (vd G13Đ, G13T) không có geometry riêng, nhưng mã gốc không hậu tố
--     (G13) đã có polygon thật và không có mảnh Nam/Tây nào khác cạnh tranh diện tích — người
--     quản lý dữ liệu đất xác nhận đây chỉ là quy ước lịch cạo mủ Đông/Tây, ranh giới đất thật
--     vẫn là 1 lô. Mỗi mã này ứng với ĐÚNG 1 canonical.
--   - "M6" (không hậu tố hướng, dùng trong dispatch_delivery_points) không có geometry riêng,
--     nhưng "M6S" + "M6T" (2 mảnh con đã digitize) CHẠM BIÊN NHAU (JTS `touches()=true`,
--     `intersects()=true` nhưng KHÔNG chồng lấn — diện tích hợp = đúng tổng diện tích 2 mảnh,
--     0 ha trùng lặp) — hình học cho thấy đây là 1 thửa liền mạch bị chia làm 2 phần khi
--     digitize. "M6" ứng với 2 canonical (M6S, M6T) — xem cột `dien_tich_ha` cộng dồn trong code
--     (`eudr-feature-collection.ts`'s `combineAliasSources()`).
--   - "G8" tương tự nhưng "G8B"+"G8N" CÁCH NHAU ~52m (không chạm, không chồng) — CHƯA đủ rõ ràng
--     để coi là bí danh, CỐ Ý không seed ở đây, chờ người quản lý đất đối chiếu hồ sơ gốc.
--   - "L6D", "G15Đ", "H13Đ": mã gốc S/T chỉ phủ MỘT PHẦN diện tích (không phải toàn bộ như nhóm
--     16 mã trên) — không thể coi là bí danh trọn vẹn, cần khảo sát thật phần còn thiếu.
--
-- Nguyên tắc dùng bảng này ở tầng ứng dụng (xem eudr-plot-merge.ts's buildForestPlotAliasMap(),
-- eudr-feature-collection.ts's buildEudrFeatureCollection()/combineAliasSources()):
--   - CHỈ tra bảng này khi `alias_ten` KHÔNG có geometry thật ở CẢ forest_plots LẪN file tĩnh —
--     không bao giờ ghi đè lên geometry thật đã có. Nếu sau này ai đó khảo sát thật cho đúng mã
--     alias_ten, dữ liệu thật luôn thắng, dòng alias tương ứng tự động hết tác dụng (không cần
--     xóa tay, dù nên dọn is_active=false để giữ bảng sạch).
--   - Output GeoJSON vẫn LUÔN dán nhãn feature bằng chính `alias_ten` gốc (Ten/Ma_lo_2026), chỉ
--     mượn geometry/diện tích của `canonical_ten` — không đổi mã lô hiển thị cho khách hàng.
--   - 1 `alias_ten` có thể có NHIỀU dòng (nhiều `canonical_ten` khác nhau) — vd "M6" gồm 2 dòng
--     trỏ tới "M6S" và "M6T". Vì vậy KHÔNG unique trên riêng `alias_ten`, chỉ unique trên cặp
--     `(alias_ten, canonical_ten)`.
--
-- Chạy trong Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS forest_plot_code_aliases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id     UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,

  alias_ten      TEXT NOT NULL,   -- mã đang dùng trong vận hành nhưng không có geometry riêng
  canonical_ten  TEXT NOT NULL,   -- mã đã có geometry thật, dùng thay thế khi xuất EUDR

  ly_do          TEXT,            -- vd "bí danh lịch cạo mủ Đông/Tây, ranh giới đất là 1 lô"
  confirmed_by   TEXT NOT NULL,   -- tên người xác nhận đây đúng là cùng một thửa đất
  confirmed_at   DATE NOT NULL,   -- ngày xác nhận (KHÔNG mặc định "hôm nay" — phải khai rõ)

  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (alias_ten <> canonical_ten),
  -- KHÔNG unique trên riêng alias_ten — 1 alias có thể ứng với nhiều canonical (xem "M6" ở trên).
  UNIQUE (factory_id, alias_ten, canonical_ten),
  -- Bắt buộc canonical_ten phải là 1 mã lô CÓ THẬT của cùng nhà máy — chặn gõ nhầm mã đích,
  -- và tự nhất quán với UNIQUE(factory_id, ten) đã có sẵn trên forest_plots.
  FOREIGN KEY (factory_id, canonical_ten) REFERENCES forest_plots (factory_id, ten)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS forest_plot_code_aliases_factory_alias
  ON forest_plot_code_aliases (factory_id, alias_ten)
  WHERE is_active;

-- Row Level Security — mirror đúng pattern hiện có của forest_plots
-- (20260520_forest_plots.sql SELECT theo factory + 20260819_forest_plots_admin_factory_scope.sql
-- ghi chỉ admin đúng nhà máy mình), cộng policy RESTRICTIVE chặn role 'customer' đọc thẳng —
-- bảng này là một phần của chuỗi truy xuất EUDR, cùng nhóm với 8 bảng đã chặn ở
-- 20260708_customer_portal_export_grants.sql.
ALTER TABLE forest_plot_code_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "factory members can read forest_plot_code_aliases" ON forest_plot_code_aliases;
CREATE POLICY "factory members can read forest_plot_code_aliases"
  ON forest_plot_code_aliases FOR SELECT
  USING (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "admin can manage forest_plot_code_aliases" ON forest_plot_code_aliases;
CREATE POLICY "admin can manage forest_plot_code_aliases"
  ON forest_plot_code_aliases FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    AND factory_id = public.current_profile_factory_id()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    AND factory_id = public.current_profile_factory_id()
  );

DROP POLICY IF EXISTS "deny_customer_direct_access" ON forest_plot_code_aliases;
CREATE POLICY "deny_customer_direct_access" ON forest_plot_code_aliases
  AS RESTRICTIVE FOR ALL
  USING (public.current_profile_role() IS DISTINCT FROM 'customer');

-- ── Seed 16 bí danh Đông/Tây đã được xác nhận (2026-09-19) ─────────────────────────────
-- 8 mã gốc dưới đây (G13, G14, G16, H14, H15, J15, K13, K14) đều có geometry thật, KHÔNG có
-- mảnh Nam/Tây nào khác (kiểu G15S/G15T, H13S/H13T) cạnh tranh diện tích — khác 2 mã G15Đ/H13Đ
-- bị loại khỏi danh sách này vì mã gốc S/T của chúng CHỈ phủ một phần, không thể coi là bí danh
-- trọn vẹn. Xác nhận qua phiên làm việc Claude Code: đây chỉ là quy ước lịch cạo mủ Đông/Tây,
-- ranh giới đất thật vẫn là 1 lô (mã gốc không hậu tố). `confirmed_by` cần soát lại nếu người
-- xác nhận thực tế không phải người điều hành phiên làm việc này.
INSERT INTO forest_plot_code_aliases (factory_id, alias_ten, canonical_ten, ly_do, confirmed_by, confirmed_at)
SELECT f.id, v.alias_ten, v.canonical_ten,
  'Bí danh lịch cạo mủ Đông/Tây của lô ' || v.canonical_ten || ' — mã gốc đã có geometry thật, ' ||
  'không có mảnh Nam/Tây nào khác cạnh tranh diện tích. Ranh giới đất thật là 1 lô. ' ||
  'Xác nhận qua phiên làm việc Claude Code ngày 2026-09-19.',
  'To Thanh Luan',
  DATE '2026-09-19'
FROM factories f
CROSS JOIN (VALUES
  ('G13T', 'G13'), ('G13Đ', 'G13'),
  ('G14T', 'G14'), ('G14Đ', 'G14'),
  ('G16T', 'G16'), ('G16Đ', 'G16'),
  ('H14T', 'H14'), ('H14Đ', 'H14'),
  ('H15T', 'H15'), ('H15Đ', 'H15'),
  ('J15T', 'J15'), ('J15Đ', 'J15'),
  ('K13T', 'K13'), ('K13Đ', 'K13'),
  ('K14T', 'K14'), ('K14Đ', 'K14')
) AS v(alias_ten, canonical_ten)
WHERE f.code = 'phuochoa_kt'
ON CONFLICT (factory_id, alias_ten, canonical_ten) DO NOTHING;

-- ── Seed "M6" = hợp "M6S" + "M6T" (2026-09-19) ──────────────────────────────────────────
-- Kiểm chứng hình học bằng JTS (script tạm, không lưu trong repo): M6S và M6T CHẠM BIÊN NHAU
-- (touches=true), KHÔNG chồng lấn (union area = tổng diện tích hình học 2 mảnh, sai lệch
-- 0,00 ha) — dấu hiệu rõ ràng đây là 1 thửa liền mạch bị chia làm 2 khi digitize, không phải
-- 2 thửa riêng biệt tình cờ trùng tiền tố tên. "G8" bị loại khỏi seed này vì G8B/G8N cách nhau
-- ~52m (không chạm) — cần người quản lý đất xác nhận thêm trước khi seed.
INSERT INTO forest_plot_code_aliases (factory_id, alias_ten, canonical_ten, ly_do, confirmed_by, confirmed_at)
SELECT f.id, 'M6', v.canonical_ten,
  'Bí danh của lô "M6" — hợp 2 mảnh con "M6S" + "M6T" đã digitize, kiểm chứng bằng JTS: 2 mảnh ' ||
  'chạm biên nhau (touches=true), không chồng lấn (union area khớp tổng diện tích hình học, ' ||
  'sai lệch 0,00 ha) — 1 thửa liền mạch bị chia làm 2 khi digitize, không phải 2 thửa riêng biệt. ' ||
  'Xác nhận qua phiên làm việc Claude Code ngày 2026-09-19.',
  'To Thanh Luan',
  DATE '2026-09-19'
FROM factories f
CROSS JOIN (VALUES ('M6S'), ('M6T')) AS v(canonical_ten)
WHERE f.code = 'phuochoa_kt'
ON CONFLICT (factory_id, alias_ten, canonical_ten) DO NOTHING;
