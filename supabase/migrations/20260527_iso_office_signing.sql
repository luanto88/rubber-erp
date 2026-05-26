-- Lưu file DOCX/XLSX đã ký tách riêng với file PDF đã ký.
ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS file_signed_office_url TEXT,
  ADD COLUMN IF NOT EXISTS file_signed_office_type TEXT,
  ADD COLUMN IF NOT EXISTS file_phieu_yeu_cau_thay_doi_signed_url TEXT,
  ADD COLUMN IF NOT EXISTS file_de_nghi_soat_xet_signed_url TEXT;
