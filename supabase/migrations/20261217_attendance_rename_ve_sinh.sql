-- Chấm công (2026-11-26): đổi tên việc "Vệ sinh tạp vụ" → "Vệ sinh dây chuyền" (Mủ tạp + Mủ nước), mọi nhà máy.
-- Khmer: សម្អាតខ្សែសង្វាក់ (máy dịch, chờ chuyên gia duyệt — file cung_cap_dl/dich_khmer_cham_cong.xlsx).
-- Chỉ đổi danh mục; dòng phiếu lưu cong_viec_id nên tự hiện tên mới. Bản cứng TKSX đã lưu giữ tên cũ (bất biến).
-- Chạy tay trong Supabase SQL Editor. An toàn chạy lại.

update public.attendance_job_types
set ten = 'Vệ sinh dây chuyền',
    ten_khmer = 'សម្អាតខ្សែសង្វាក់'
where lower(btrim(ten)) = lower('Vệ sinh tạp vụ');

-- Kiểm tra:
-- select factory_id, day_chuyen, ten, ten_khmer, is_active from public.attendance_job_types where ten ilike 'Vệ sinh%';
