-- Module Chấm công — GĐ C0 "Nền nhân sự" (2026-11-19). Kế hoạch: .claude/plans/cham-cong-2026-11-19.md
--
-- 1. Nhân sự (maintenance_staff): thêm loại nhân sự (nhân viên / công nhân), mã, dây chuyền + ca + công việc
--    mặc định, thứ tự điểm danh, ngày vào làm / nghỉ việc, cờ "chờ xác nhận" cho tên thêm nhanh ngoài danh sách.
-- 2. Danh mục công việc (attendance_job_types) theo dây chuyền + tổ, tên Việt + Khmer (Khmer dùng cho màn điểm danh
--    của trực ca và phiếu F01/F02 song ngữ), số người gợi ý, loại xe gắn kèm.
-- 3. Danh mục lý do vắng (attendance_absence_reasons), Việt + Khmer.
-- 4. Tài xế ↔ nhân sự (dispatch_drivers.staff_id) + tài xế phụ của xe (dispatch_vehicle_secondary_drivers).
-- 5. Quyền module Chấm công (6 mã).
--
-- KHÔNG seed danh mục công việc / lý do ở đây — chạy script scripts/seed-attendance-catalog.mjs (xem trước → --apply),
-- nguồn duy nhất src/lib/attendance/khmer-catalog.json.
-- Chạy TAY trên Supabase SQL Editor TRƯỚC khi deploy. Idempotent — chạy lại an toàn.

-- ── 0. Hàm quyền dùng chung ───────────────────────────────────────────────────
create or replace function public.attendance_can_manage_config()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_admin()
      or public.current_profile_has_permission('attendance.manage_config')
      or public.current_profile_has_permission('settings.manage_config');
$$;

-- Người được thêm nhanh lý do vắng ngay trên form điểm danh.
create or replace function public.attendance_can_quick_add()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.attendance_can_manage_config()
      or public.current_profile_has_permission('attendance.shift_check')
      or public.current_profile_has_permission('attendance.mark')
      or public.current_profile_has_permission('attendance.mark_all')
      or public.current_profile_has_permission('attendance.approve');
$$;

-- ── 1. Danh mục công việc ─────────────────────────────────────────────────────
create table if not exists public.attendance_job_types (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  day_chuyen text not null check (day_chuyen in ('Mủ tạp', 'Mủ nước')),
  to_nhom text not null check (to_nhom in ('tiep_nhan', 'co_dien', 'nang_hang', 'ca_san_xuat')),
  ten text not null,
  ten_khmer text,
  so_nguoi_goi_y integer not null default 1 check (so_nguoi_goi_y >= 0 and so_nguoi_goi_y <= 50),
  -- Khớp dispatch_vehicles.vehicle_type (vd 'Xúc sản xuất', 'Nâng sản xuất'); NULL = công việc không cần chọn xe.
  loai_xe text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uniq_attendance_job_types_name
  on public.attendance_job_types (factory_id, day_chuyen, to_nhom, lower(btrim(ten)));
create index if not exists idx_attendance_job_types_factory on public.attendance_job_types (factory_id, day_chuyen, sort_order);

drop trigger if exists trg_attendance_job_types_updated_at on public.attendance_job_types;
create trigger trg_attendance_job_types_updated_at before update on public.attendance_job_types
  for each row execute function public.set_updated_at();

alter table public.attendance_job_types enable row level security;
drop policy if exists attendance_job_types_select on public.attendance_job_types;
create policy attendance_job_types_select on public.attendance_job_types for select to authenticated
  using (factory_id = public.current_profile_factory_id());
drop policy if exists attendance_job_types_insert on public.attendance_job_types;
create policy attendance_job_types_insert on public.attendance_job_types for insert to authenticated
  with check (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());
drop policy if exists attendance_job_types_update on public.attendance_job_types;
create policy attendance_job_types_update on public.attendance_job_types for update to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config())
  with check (factory_id = public.current_profile_factory_id());
drop policy if exists attendance_job_types_delete on public.attendance_job_types;
create policy attendance_job_types_delete on public.attendance_job_types for delete to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());

-- ── 2. Danh mục lý do vắng ────────────────────────────────────────────────────
create table if not exists public.attendance_absence_reasons (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  ten text not null,
  ten_khmer text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uniq_attendance_absence_reasons_name
  on public.attendance_absence_reasons (factory_id, lower(btrim(ten)));

drop trigger if exists trg_attendance_absence_reasons_updated_at on public.attendance_absence_reasons;
create trigger trg_attendance_absence_reasons_updated_at before update on public.attendance_absence_reasons
  for each row execute function public.set_updated_at();

alter table public.attendance_absence_reasons enable row level security;
drop policy if exists attendance_absence_reasons_select on public.attendance_absence_reasons;
create policy attendance_absence_reasons_select on public.attendance_absence_reasons for select to authenticated
  using (factory_id = public.current_profile_factory_id());
drop policy if exists attendance_absence_reasons_insert on public.attendance_absence_reasons;
create policy attendance_absence_reasons_insert on public.attendance_absence_reasons for insert to authenticated
  with check (factory_id = public.current_profile_factory_id() and public.attendance_can_quick_add());
drop policy if exists attendance_absence_reasons_update on public.attendance_absence_reasons;
create policy attendance_absence_reasons_update on public.attendance_absence_reasons for update to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config())
  with check (factory_id = public.current_profile_factory_id());
drop policy if exists attendance_absence_reasons_delete on public.attendance_absence_reasons;
create policy attendance_absence_reasons_delete on public.attendance_absence_reasons for delete to authenticated
  using (factory_id = public.current_profile_factory_id() and public.attendance_can_manage_config());

-- ── 3. Nhân sự ────────────────────────────────────────────────────────────────
alter table public.maintenance_staff
  add column if not exists loai_nhan_su text not null default 'nhan_vien',
  add column if not exists ma_nhan_su text,
  add column if not exists day_chuyen_mac_dinh text,
  add column if not exists ca_mac_dinh text,
  add column if not exists cong_viec_mac_dinh_id uuid references public.attendance_job_types(id) on delete set null,
  add column if not exists thu_tu_diem_danh integer,
  add column if not exists ngay_vao_lam date,
  add column if not exists ngay_nghi_viec date,
  add column if not exists nguon_tao text not null default 'cai_dat',
  add column if not exists cho_xac_nhan boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_staff_loai_nhan_su_check') then
    alter table public.maintenance_staff add constraint maintenance_staff_loai_nhan_su_check
      check (loai_nhan_su in ('nhan_vien', 'cong_nhan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_staff_ca_mac_dinh_check') then
    alter table public.maintenance_staff add constraint maintenance_staff_ca_mac_dinh_check
      check (ca_mac_dinh is null or ca_mac_dinh in ('A', 'B', 'C'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_staff_day_chuyen_mac_dinh_check') then
    alter table public.maintenance_staff add constraint maintenance_staff_day_chuyen_mac_dinh_check
      check (day_chuyen_mac_dinh is null or day_chuyen_mac_dinh in ('Mủ tạp', 'Mủ nước'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_staff_ngay_lam_viec_check') then
    alter table public.maintenance_staff add constraint maintenance_staff_ngay_lam_viec_check
      check (ngay_nghi_viec is null or ngay_vao_lam is null or ngay_nghi_viec >= ngay_vao_lam);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_staff_nguon_tao_check') then
    alter table public.maintenance_staff add constraint maintenance_staff_nguon_tao_check
      check (nguon_tao in ('cai_dat', 'them_nhanh_truc_ca', 'nhap_excel'));
  end if;
end $$;

create unique index if not exists uniq_maintenance_staff_ma_nhan_su
  on public.maintenance_staff (factory_id, upper(btrim(ma_nhan_su)))
  where ma_nhan_su is not null and btrim(ma_nhan_su) <> '';
create index if not exists idx_maintenance_staff_attendance
  on public.maintenance_staff (factory_id, loai_nhan_su, ca_mac_dinh);

comment on column public.maintenance_staff.loai_nhan_su is 'nhan_vien | cong_nhan — công nhân thường không có tài khoản, do trực ca điểm danh.';
comment on column public.maintenance_staff.ngay_vao_lam is 'Tháng có ngày vào làm sau ngày 1 = tháng làm không trọn ⇒ không xếp loại, không tính KPI/chuỗi phép.';
comment on column public.maintenance_staff.cho_xac_nhan is 'Tên do trực ca thêm nhanh ngoài danh sách — văn phòng xác nhận hoặc gộp trùng.';

-- ── 4. Tài xế ↔ nhân sự + tài xế phụ ──────────────────────────────────────────
alter table public.dispatch_drivers
  add column if not exists staff_id uuid references public.maintenance_staff(id) on delete set null;
create unique index if not exists uniq_dispatch_drivers_staff
  on public.dispatch_drivers (staff_id) where staff_id is not null;

create table if not exists public.dispatch_vehicle_secondary_drivers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  vehicle_id uuid not null references public.dispatch_vehicles(id) on delete cascade,
  driver_id uuid not null references public.dispatch_drivers(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  is_current boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists uniq_dispatch_vsd_current
  on public.dispatch_vehicle_secondary_drivers (vehicle_id, driver_id) where is_current;
create index if not exists idx_dispatch_vsd_factory on public.dispatch_vehicle_secondary_drivers (factory_id, vehicle_id);

drop trigger if exists trg_dispatch_vsd_updated_at on public.dispatch_vehicle_secondary_drivers;
create trigger trg_dispatch_vsd_updated_at before update on public.dispatch_vehicle_secondary_drivers
  for each row execute function public.set_updated_at();

-- Cùng mức như dispatch_vehicle_driver_assignments (20260821_rls_lockdown_master_data_full.sql).
alter table public.dispatch_vehicle_secondary_drivers enable row level security;
drop policy if exists dispatch_vsd_select on public.dispatch_vehicle_secondary_drivers;
create policy dispatch_vsd_select on public.dispatch_vehicle_secondary_drivers for select to authenticated
  using (factory_id = public.current_profile_factory_id());
drop policy if exists dispatch_vsd_insert on public.dispatch_vehicle_secondary_drivers;
create policy dispatch_vsd_insert on public.dispatch_vehicle_secondary_drivers for insert to authenticated
  with check (factory_id = public.current_profile_factory_id());
drop policy if exists dispatch_vsd_update on public.dispatch_vehicle_secondary_drivers;
create policy dispatch_vsd_update on public.dispatch_vehicle_secondary_drivers for update to authenticated
  using (factory_id = public.current_profile_factory_id())
  with check (factory_id = public.current_profile_factory_id());
drop policy if exists dispatch_vsd_delete on public.dispatch_vehicle_secondary_drivers;
create policy dispatch_vsd_delete on public.dispatch_vehicle_secondary_drivers for delete to authenticated
  using (factory_id = public.current_profile_factory_id());

-- ── 5. Quyền ──────────────────────────────────────────────────────────────────
insert into public.permissions (code, module_name, action_name) values
  ('attendance.view', 'attendance', 'view'),
  ('attendance.shift_check', 'attendance', 'shift_check'),
  ('attendance.mark', 'attendance', 'mark'),
  ('attendance.mark_all', 'attendance', 'mark_all'),
  ('attendance.approve', 'attendance', 'approve'),
  ('attendance.manage_config', 'attendance', 'manage_config')
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_code)
select 'admin', c from unnest(array[
  'attendance.view', 'attendance.shift_check', 'attendance.mark',
  'attendance.mark_all', 'attendance.approve', 'attendance.manage_config'
]) c
on conflict do nothing;

-- Ai cũng xem được công của chính mình (tài khoản có quyền tường minh vẫn phải tick tay ở Cài đặt).
insert into public.role_permissions (role, permission_code)
select r, 'attendance.view' from unnest(array['manager', 'user']) r
on conflict do nothing;
