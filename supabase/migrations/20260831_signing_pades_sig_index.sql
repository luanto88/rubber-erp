-- Ghi lại vị trí (0-based, theo thứ tự chèn PAdES incremental) của đúng chữ ký PAdES của
-- người này trong `yeu_cau_ky.file_hien_tai` — dùng để verify lại đúng người khi bấm link
-- trên con dấu chữ ký (xem src/lib/signing/verify-pades.ts). NULL nếu chưa cấu hình
-- SIGN_PADES_ROOT_CA_CERT_PEM/SIGN_PADES_ROOT_CA_KEY_PEM hoặc applyPadesSignature() lỗi/bỏ
-- qua ở lượt ký đó (xem signField() trong src/lib/signing/requests.ts).
ALTER TABLE public.nguoi_ky
  ADD COLUMN IF NOT EXISTS pades_sig_index INTEGER;

COMMENT ON COLUMN public.nguoi_ky.pades_sig_index IS
  'Thứ tự (0-based) của chữ ký PAdES/CMS tương ứng người này trong file đã ký hiện tại — dùng
   để trích đúng chữ ký khi verify lại (GET /api/signing/verify/[nguoiKyId]). NULL = chưa
   cấu hình root CA hoặc bước PAdES bị bỏ qua/lỗi ở lượt ký đó.';
