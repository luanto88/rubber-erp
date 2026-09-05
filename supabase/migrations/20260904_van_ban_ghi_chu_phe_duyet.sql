-- Văn bản nội bộ — khung "Ghi chú" của mẫu vị trí ký + tag ngày ký có giây.
--
-- 1) ghi_chu_phe_duyet: Ý KIẾN CHỈ ĐẠO lãnh đạo gõ NGAY LÚC PHÊ DUYỆT.
--    KHÁC HẲN cột `ghi_chu` đã có (ghi chú người soạn thảo nhập lúc tạo văn bản). Trước bản
--    này, khung "Ghi chú" của mẫu bị hiểu sai mục đích và in lại `ghi_chu` của người soạn thảo.
--
-- 2) ky_phe_duyet_at: thời điểm phê duyệt chính xác tới giây.
--    `ngay_phe_duyet` chỉ là DATE nên không đủ cho tag "Văn bản được ký dd/mm/yyyy hh:mm:ss";
--    `updated_at` thì bị mọi thao tác sau đó ghi đè nên không dùng làm mốc ký được.
--
-- An toàn chạy lại nhiều lần (IF NOT EXISTS). Không backfill: văn bản đã ký trước bản này
-- không có ý kiến chỉ đạo lẫn mốc ký tới giây — cố ý để NULL, không suy diễn từ updated_at.

ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS ghi_chu_phe_duyet TEXT,
  ADD COLUMN IF NOT EXISTS ky_phe_duyet_at   TIMESTAMPTZ;

COMMENT ON COLUMN van_ban_documents.ghi_chu_phe_duyet IS
  'Ý kiến chỉ đạo lãnh đạo nhập tại bước phê duyệt, vẽ vào khung "ghi_chu" của mẫu vị trí ký. NULL = lãnh đạo đã chủ động tắt khung hoặc mẫu không có khung này.';

COMMENT ON COLUMN van_ban_documents.ky_phe_duyet_at IS
  'Thời điểm phê duyệt chính xác tới giây (UTC). Dùng cho tag ngày ký trên PDF; ngay_phe_duyet chỉ là DATE theo giờ nhà máy.';
