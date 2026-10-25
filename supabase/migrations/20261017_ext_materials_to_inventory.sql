-- 2026-10-17 — CHẨN ĐOÁN (chỉ đọc, không sửa dữ liệu).
--
-- Bối cảnh: trước bản sửa này, nút "+ Thêm mã vật tư ngoài" trong biên bản bảo trì và tab
-- Cài đặt → Bảo trì → Vật tư mua ngoài ghi vào bảng cũ `maintenance_external_materials`, rồi gán
-- id đó vào `maintenance_materials.inventory_item_id` (cột không có khoá ngoại). Khi "Lập đề nghị
-- mua", id này được ghi vào `purchase_request_lines.item_id` (khoá ngoại tới `inventory_items`)
-- ⇒ lỗi `purchase_request_lines_item_id_fkey` và phiếu tự chuyển "Đã hủy" (vd biên bản
-- DX-141026/001: "Miếng canh nhông visai", "Bilong láp dọc").
--
-- Từ bản này vật tư mua ngoài tạo mới luôn vào `inventory_items` (nguon_tao = 'bao_tri_mua_ngoai',
-- kho mặc định = Kho tạm KT). Câu dưới liệt kê các dòng vật tư mua ngoài của biên bản CHƯA duyệt/huỷ
-- đang trỏ id KHÔNG có trong `inventory_items` (hoặc chưa có id) — cần sửa tay trên giao diện:
-- mở biên bản → Sửa → với từng dòng bấm "+ Thêm mã vật tư ngoài" (hoặc chọn mã có sẵn) → Lưu →
-- bấm lại "Lập đề nghị mua". Phiếu "Đã hủy" cũ giữ làm lịch sử.

SELECT
  r.ma_bb,
  r.trang_thai,
  r.bo_phan,
  m.ten_vat_tu,
  m.dvt,
  m.so_luong,
  m.inventory_item_id,
  (em.id IS NOT NULL) AS id_cua_bang_cu_maintenance_external_materials
FROM maintenance_materials m
JOIN maintenance_records r ON r.id = m.record_id
LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
LEFT JOIN maintenance_external_materials em ON em.id = m.inventory_item_id
WHERE m.nguon = 'ben_ngoai'
  AND COALESCE(TRIM(m.ten_vat_tu), '') <> ''
  AND ii.id IS NULL
  AND r.trang_thai NOT IN ('da_duyet', 'huy')
ORDER BY r.ma_bb, m.ten_vat_tu;
