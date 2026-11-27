-- A3 (2026-11-27): gắn công việc ↔ ô trên "Sơ đồ dây chuyền" Mủ tạp ở màn điểm danh.
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code A3. Không đổi RPC nào (save/open giữ bản 20261220).
-- Chạy lại an toàn (idempotent).

alter table public.attendance_job_types add column if not exists so_do_vi_tri text;
comment on column public.attendance_job_types.so_do_vi_tri is
  'Ô trên Sơ đồ dây chuyền Mủ tạp (màn điểm danh). NULL = không có ô (hiện ở khung "Việc khác").';

alter table public.attendance_job_types drop constraint if exists attendance_job_types_so_do_vi_tri_check;
alter table public.attendance_job_types add constraint attendance_job_types_so_do_vi_tri_check
  check (so_do_vi_tri is null or so_do_vi_tri in (
    'truc_ca', 'lo_say', 'bao_tri', 'xlnt', 'co_khi', 'xe_nang',
    'tn_xuc', 'tn_xe', 'tn_vs',
    'ca_xuc', 'ca_xe', 'ca_can', 'ca_bam', 'ca_pha', 'ca_ralo', 'ca_ep', 'ca_bao', 'ca_kien', 'ca_vs'
  ));

-- Seed theo tên (chỉ điền ô đang trống, mỗi ô 1 việc đang dùng / nhà máy).
with m(unit_code, day_chuyen, to_nhom, ten, vi_tri) as (values
  ('CD', null, 'co_dien', 'trực ca', 'truc_ca'),
  ('CD', null, 'co_dien', 'vận hành lò sấy', 'lo_say'),
  ('CD', null, 'co_dien', 'bảo trì máy', 'bao_tri'),
  ('CD', null, 'co_dien', 'lái xe nâng', 'xe_nang'),
  ('XLNT', null, 'tiep_nhan', 'trực hồ xlnt', 'xlnt'),
  ('XE_CK', null, 'co_dien', 'sửa chữa xe, cơ khí', 'co_khi'),
  ('TN_MT', 'Mủ tạp', 'tiep_nhan', 'vận hành xe xúc', 'tn_xuc'),
  ('TN_MT', 'Mủ tạp', 'tiep_nhan', 'xé nhỏ - lưu kho', 'tn_xe'),
  ('TN_MT', 'Mủ tạp', 'tiep_nhan', 'vệ sinh kho', 'tn_vs'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'xe xúc tiếp liệu', 'ca_xuc'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'tiếp liệu & vận hành máy xé', 'ca_xe'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'vận hành máy cán', 'ca_can'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'vận hành băm tinh', 'ca_bam'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'phả mủ', 'ca_pha'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'ra lò', 'ca_ralo'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'cân ép bành mủ', 'ca_ep'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'vô bao dán nhãn', 'ca_bao'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'cắt mẫu - vô kiện', 'ca_kien'),
  (null, 'Mủ tạp', 'ca_san_xuat', 'vệ sinh dây chuyền', 'ca_vs')
)
update public.attendance_job_types j set so_do_vi_tri = m.vi_tri
from m
where j.so_do_vi_tri is null
  and j.is_active
  and coalesce(j.unit_code, '') = coalesce(m.unit_code, '')
  and coalesce(j.day_chuyen, '') = coalesce(m.day_chuyen, '')
  and j.to_nhom = m.to_nhom
  and lower(btrim(j.ten)) = m.ten
  and not exists (
    select 1 from public.attendance_job_types k
    where k.factory_id = j.factory_id and k.is_active and k.so_do_vi_tri = m.vi_tri
  );

create unique index if not exists uniq_attendance_job_types_so_do
  on public.attendance_job_types (factory_id, so_do_vi_tri)
  where so_do_vi_tri is not null and is_active;

-- Kiểm sau khi chạy (mong đợi 19 dòng với phuochoa_kt):
-- select so_do_vi_tri, unit_code, day_chuyen, ten from public.attendance_job_types
--  where so_do_vi_tri is not null order by so_do_vi_tri;
