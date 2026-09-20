-- Seed thêm 10 bí danh mã lô vườn còn lại từng chặn `verify-eudr-export-chain.mjs` (2026-09-19,
-- 0/63 đơn xuất được). Tiếp nối `20260919_forest_plot_code_aliases.sql` (bảng + 17 bí danh đầu:
-- 16 Đông/Tây 1:1 + M6→M6S/M6T).
--
-- ĐÃ ÁP DỤNG THẬT trên DB qua script Node dùng service-role key (không qua SQL Editor) trong
-- phiên 2026-09-20 — file này là bản ghi lại y hệt dữ liệu đã ghi, để đồng bộ với convention
-- "mọi thay đổi schema/data có migration file" của dự án. Idempotent (`ON CONFLICT DO NOTHING`)
-- — chạy lại trong Supabase SQL Editor an toàn, không tạo trùng, không đổi dữ liệu đã có.
--
-- Nguồn xác nhận: đội khảo sát thực địa trả lời qua tài liệu Claude Docs
-- (`https://claude.ai/artifact/GKU9oqispoTcu1BPBzg5AP`), đã verify độc lập bằng Supabase thật
-- (script tạm, không lưu trong repo) trước khi ghi — xem `.claude` memory `eudr-area-recovery.md`
-- mục "GĐ2c — HOÀN TẤT 2026-09-20" và `eudr_geometry_gotchas.md` gotcha #10.
--
-- Nhóm 1 — bí danh Đông/Tây thuần tuý (an toàn tương đương 17 bí danh đã seed trước, chỉ khác
-- ở chỗ mã vận hành có thêm dấu gạch nối "I-13" mà mã gốc trong forest_plots không có "I13"):
--   I-13Đ, I-13T → I13   ·   I-14Đ, I-14T → I14   ·   I-15Đ, I-15T → I15
--
-- Nhóm 2 — QUYẾT ĐỊNH NGHIỆP VỤ (không chỉ ghép hình học): mã gốc S/T là 2 mảnh đất THẬT SỰ
-- RIÊNG BIỆT, chênh lệch diện tích rất lớn (vd G15S 0,5ha vs G15T 22,51ha) — đội xác nhận chọn
-- đúng 1 mảnh làm đại diện, bỏ hẳn mảnh kia (không liên quan tới mã bí danh):
--   G15Đ → G15T (22,51ha, bỏ G15S 0,5ha — G15Đ thiếu 1 dải suối + bìa rừng, không phải đất trồng)
--   H13Đ → H13T (22,9ha, bỏ H13S 1,3ha)
--   L6D  → L6T  (6,86ha, bỏ L6S 8,17ha — L6S/L6T bị ngăn cách bởi 1 con suối, không liền mạch)
--   G8   → G8N  (11,1ha, bỏ G8B 8,34ha — điểm giao nhận "G8" nằm thật tại G8N, cách G8B ~52m
--                bởi 1 con suối, KHÁC "M6" chạm biên liền mạch)
--
-- Verify sau khi ghi (2026-09-20): `verify-eudr-export-chain.mjs` — 64 đơn xuất được / 0 đơn bị
-- chặn trên tổng 64 đơn đã duyệt (từ 0/63 trước khi ghi).

INSERT INTO forest_plot_code_aliases (factory_id, alias_ten, canonical_ten, ly_do, confirmed_by, confirmed_at)
SELECT f.id, v.alias_ten, v.canonical_ten,
  'Bí danh lịch cạo mủ Đông/Tây của lô ' || v.canonical_ten || ' — đội khảo sát thực địa xác nhận ' ||
  '2026-09-20 (đưa map ' || v.alias_ten || ' về map gốc ' || v.canonical_ten || '). ' ||
  'Nguyên nhân ban đầu bị coi là "chưa từng đo": điều tra trước đó tra cứu geometry bằng chuỗi ' ||
  'CÓ GẠCH NỐI, trong khi tên thật trong hệ thống không có gạch nối.',
  'To Thanh Luan',
  DATE '2026-09-20'
FROM factories f
CROSS JOIN (VALUES
  ('I-13Đ', 'I13'), ('I-13T', 'I13'),
  ('I-14Đ', 'I14'), ('I-14T', 'I14'),
  ('I-15Đ', 'I15'), ('I-15T', 'I15')
) AS v(alias_ten, canonical_ten)
WHERE f.code = 'phuochoa_kt'
ON CONFLICT (factory_id, alias_ten, canonical_ten) DO NOTHING;

INSERT INTO forest_plot_code_aliases (factory_id, alias_ten, canonical_ten, ly_do, confirmed_by, confirmed_at)
SELECT f.id, v.alias_ten, v.canonical_ten, v.ly_do, 'To Thanh Luan', DATE '2026-09-20'
FROM factories f
CROSS JOIN (VALUES
  ('G15Đ', 'G15T', 'Đội khảo sát thực địa xác nhận G15Đ dùng geometry của G15T (22,51ha); phần thiếu là dải suối + bìa rừng, không phải đất trồng. G15S (0,5ha) là mảnh khác, không liên quan. Xác nhận 2026-09-20, chấp nhận thiếu dải nhỏ để giải quyết ngay.'),
  ('H13Đ', 'H13T', 'Đội khảo sát thực địa xác nhận H13Đ dùng geometry của H13T (22,9ha). H13S (1,3ha) là mảnh khác, không liên quan. Xác nhận 2026-09-20.'),
  ('L6D', 'L6T', 'Đội khảo sát thực địa xác nhận L6D dùng geometry của L6T (6,86ha) — L6S và L6T bị ngăn cách bởi 1 con suối, không liền mạch. L6S là mảnh khác, không liên quan. Xác nhận 2026-09-20.'),
  ('G8', 'G8N', 'Đội khảo sát thực địa xác nhận điểm giao nhận "G8" nằm tại G8N (11,1ha), cách G8B (8,34ha) bởi 1 con suối. G8B không liên quan tới mã "G8". Xác nhận 2026-09-20.')
) AS v(alias_ten, canonical_ten, ly_do)
WHERE f.code = 'phuochoa_kt'
ON CONFLICT (factory_id, alias_ten, canonical_ten) DO NOTHING;
