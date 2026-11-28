-- ════════════════════════════════════════════════════════════════════════════
-- B (2026-11-27) — Tua chuẩn theo THÁNG + chỉ số phụ "ngày chuyên cần" (rule 27, rule 31 mục B).
-- CHẠY TAY trong Supabase SQL Editor, SAU 20261223, TRƯỚC deploy.
--
-- 1. kpi_attendance_month_config: số ngày nghỉ tua chuẩn theo tháng (chung toàn nhà máy hoặc theo
--    nhóm chính), lý do bắt buộc, + nhật ký insert-only. Ghi CHỈ qua RPC save / delete; chặn tháng
--    đã có điểm KPI khoá sổ.
-- 2. personnel_groups.nguon_hoat_dong: nguồn thao tác app ứng với việc của nhóm (khoá ACTIVITY_LABEL).
--    Ngày "Nghỉ tua" mà có thao tác thuộc nguồn của NHÓM CHÍNH = 1 ngày chuyên cần. Trống ⇒ không đếm.
-- 3. kpi_attendance_summary_internal / kpi_attendance_month_summary / kpi_compute_monthly_scores chép
--    từ 20261216, CHỈ đổi: tua chuẩn = tháng-nhóm → tháng-chung → trọng số nhóm → trọng số chung → 6;
--    thêm tua_nguon, tua_ly_do, ngay_chuyen_can (vào chi_tiet.chuyen_can). Công thức hệ số KHÔNG đổi.
-- 4. kpi_score_ranking_by_group / _by_department chép từ 20260814: hoà điểm ⇒ nhiều ngày chuyên cần
--    xếp trên; trả thêm cột ngay_chuyen_can (vẫn ẩn danh).
--
-- ⚠️ Mọi CREATE OR REPLACE 5 hàm ở mục 3–4 về sau PHẢI chép từ file này.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Cấu hình tua chuẩn theo tháng ─────────────────────────────────────────
create table if not exists public.kpi_attendance_month_config (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  group_id uuid references public.personnel_groups(id) on delete cascade,
  thang date not null check (extract(day from thang) = 1),
  so_ngay_nghi_tua_chuan integer not null check (so_ngay_nghi_tua_chuan between 0 and 10),
  ly_do text not null check (length(btrim(ly_do)) > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_kpi_att_month_cfg_group
  on public.kpi_attendance_month_config (factory_id, group_id, thang) where group_id is not null;
create unique index if not exists uq_kpi_att_month_cfg_chung
  on public.kpi_attendance_month_config (factory_id, thang) where group_id is null;

create table if not exists public.kpi_attendance_month_config_logs (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  config_id uuid,
  group_id uuid,
  thang date not null,
  hanh_dong text not null check (hanh_dong in ('them', 'sua', 'xoa')),
  gia_tri_truoc integer,
  gia_tri_sau integer,
  ly_do text not null,
  nguoi_thuc_hien uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_kpi_att_month_cfg_logs on public.kpi_attendance_month_config_logs (factory_id, thang);

create or replace function public.kpi_att_month_cfg_logs_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Nhật ký cấu hình tua chuẩn không được sửa / xoá.';
end $$;

drop trigger if exists trg_kpi_att_month_cfg_logs_immutable on public.kpi_attendance_month_config_logs;
create trigger trg_kpi_att_month_cfg_logs_immutable
  before update or delete on public.kpi_attendance_month_config_logs
  for each row execute function public.kpi_att_month_cfg_logs_immutable();

alter table public.kpi_attendance_month_config enable row level security;
alter table public.kpi_attendance_month_config_logs enable row level security;

drop policy if exists kpi_att_month_cfg_select on public.kpi_attendance_month_config;
create policy kpi_att_month_cfg_select on public.kpi_attendance_month_config
  for select to authenticated
  using (factory_id = public.current_profile_factory_id()
         and (public.current_profile_is_admin() or public.current_profile_has_permission('kpi.view')));

drop policy if exists kpi_att_month_cfg_logs_select on public.kpi_attendance_month_config_logs;
create policy kpi_att_month_cfg_logs_select on public.kpi_attendance_month_config_logs
  for select to authenticated
  using (factory_id = public.current_profile_factory_id()
         and (public.current_profile_is_admin() or public.current_profile_has_permission('kpi.view')));

-- Tháng (của nhóm, hoặc cấu hình chung ⇒ cả nhà máy) đã có điểm KPI khoá sổ?
create or replace function public.kpi_att_month_cfg_locked(p_factory_id uuid, p_group_id uuid, p_thang date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.kpi_monthly_scores ms
    where ms.factory_id = p_factory_id
      and ms.nam = extract(year from p_thang)::int and ms.thang = extract(month from p_thang)::int
      and ms.trang_thai = 'da_khoa'
      and (p_group_id is null or exists (
        select 1 from public.maintenance_staff s
        join public.personnel_group_members m on m.staff_id = s.id and m.is_primary = true
        where s.profile_id = ms.user_id and s.factory_id = p_factory_id and m.group_id = p_group_id))
  );
$$;
revoke all on function public.kpi_att_month_cfg_locked(uuid, uuid, date) from public, anon;
grant execute on function public.kpi_att_month_cfg_locked(uuid, uuid, date) to authenticated;

create or replace function public.kpi_attendance_month_config_save(
  p_factory_id uuid, p_group_id uuid, p_thang date, p_so_ngay integer, p_ly_do text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_thang date := date_trunc('month', p_thang)::date;
  v_old public.kpi_attendance_month_config;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not (public.current_profile_is_admin() or public.current_profile_has_permission('kpi.manage_config')) then
    raise exception 'Bạn không có quyền cấu hình tua chuẩn.';
  end if;
  if p_thang is null then raise exception 'Chưa chọn tháng.'; end if;
  if p_so_ngay is null or p_so_ngay < 0 or p_so_ngay > 10 then
    raise exception 'Số ngày nghỉ tua chuẩn phải từ 0 đến 10.';
  end if;
  if coalesce(btrim(p_ly_do), '') = '' then raise exception 'Bắt buộc nhập lý do.'; end if;
  if p_group_id is not null and not exists (
    select 1 from public.personnel_groups g where g.id = p_group_id and g.factory_id = p_factory_id) then
    raise exception 'Nhóm không thuộc nhà máy.';
  end if;
  if public.kpi_att_month_cfg_locked(p_factory_id, p_group_id, v_thang) then
    raise exception 'Tháng %/% đã có điểm KPI khoá sổ — không sửa được cấu hình tua chuẩn.',
      extract(month from v_thang)::int, extract(year from v_thang)::int;
  end if;

  perform pg_advisory_xact_lock(hashtext('kpi_att_month_cfg:' || p_factory_id || ':' || coalesce(p_group_id::text, '-') || ':' || v_thang));

  select * into v_old from public.kpi_attendance_month_config c
  where c.factory_id = p_factory_id and c.thang = v_thang and c.group_id is not distinct from p_group_id
  for update;

  if v_old.id is null then
    insert into public.kpi_attendance_month_config (factory_id, group_id, thang, so_ngay_nghi_tua_chuan, ly_do, created_by, updated_by)
    values (p_factory_id, p_group_id, v_thang, p_so_ngay, btrim(p_ly_do), v_uid, v_uid)
    returning id into v_id;
    insert into public.kpi_attendance_month_config_logs (factory_id, config_id, group_id, thang, hanh_dong, gia_tri_truoc, gia_tri_sau, ly_do, nguoi_thuc_hien)
    values (p_factory_id, v_id, p_group_id, v_thang, 'them', null, p_so_ngay, btrim(p_ly_do), v_uid);
  else
    update public.kpi_attendance_month_config
      set so_ngay_nghi_tua_chuan = p_so_ngay, ly_do = btrim(p_ly_do), updated_by = v_uid, updated_at = now()
      where id = v_old.id;
    v_id := v_old.id;
    insert into public.kpi_attendance_month_config_logs (factory_id, config_id, group_id, thang, hanh_dong, gia_tri_truoc, gia_tri_sau, ly_do, nguoi_thuc_hien)
    values (p_factory_id, v_id, p_group_id, v_thang, 'sua', v_old.so_ngay_nghi_tua_chuan, p_so_ngay, btrim(p_ly_do), v_uid);
  end if;
  return v_id;
end $$;
revoke all on function public.kpi_attendance_month_config_save(uuid, uuid, date, integer, text) from public, anon;
grant execute on function public.kpi_attendance_month_config_save(uuid, uuid, date, integer, text) to authenticated;

create or replace function public.kpi_attendance_month_config_delete(p_id uuid, p_ly_do text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_old public.kpi_attendance_month_config;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_old from public.kpi_attendance_month_config where id = p_id for update;
  if v_old.id is null then raise exception 'Không tìm thấy cấu hình.'; end if;
  if v_old.factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not (public.current_profile_is_admin() or public.current_profile_has_permission('kpi.manage_config')) then
    raise exception 'Bạn không có quyền cấu hình tua chuẩn.';
  end if;
  if coalesce(btrim(p_ly_do), '') = '' then raise exception 'Bắt buộc nhập lý do.'; end if;
  if public.kpi_att_month_cfg_locked(v_old.factory_id, v_old.group_id, v_old.thang) then
    raise exception 'Tháng %/% đã có điểm KPI khoá sổ — không xoá được cấu hình tua chuẩn.',
      extract(month from v_old.thang)::int, extract(year from v_old.thang)::int;
  end if;
  insert into public.kpi_attendance_month_config_logs (factory_id, config_id, group_id, thang, hanh_dong, gia_tri_truoc, gia_tri_sau, ly_do, nguoi_thuc_hien)
  values (v_old.factory_id, v_old.id, v_old.group_id, v_old.thang, 'xoa', v_old.so_ngay_nghi_tua_chuan, null, btrim(p_ly_do), v_uid);
  delete from public.kpi_attendance_month_config where id = v_old.id;
end $$;
revoke all on function public.kpi_attendance_month_config_delete(uuid, text) from public, anon;
grant execute on function public.kpi_attendance_month_config_delete(uuid, text) to authenticated;

-- ── 2. Nguồn thao tác của nhóm ───────────────────────────────────────────────
alter table public.personnel_groups
  add column if not exists nguon_hoat_dong text[] not null default '{}';
comment on column public.personnel_groups.nguon_hoat_dong is
  'Nguồn thao tác app ứng với việc của nhóm (khoá ACTIVITY_LABEL, src/lib/attendance/calendar.ts). Ngày Nghỉ tua có thao tác thuộc nguồn của NHÓM CHÍNH = 1 ngày chuyên cần (chỉ số phụ KPI). Trống ⇒ không đếm.';

-- ── 3. Tổng hợp chuyên cần (chép 20261216, đổi chọn tua + thêm 3 cột) ─────────
drop function if exists public.kpi_attendance_month_summary(uuid, integer, integer);
drop function if exists public.kpi_attendance_summary_internal(uuid, integer, integer);

create function public.kpi_attendance_summary_internal(p_factory_id uuid, p_nam integer, p_thang integer)
returns table (
  profile_id uuid, staff_id uuid, loai text, khong_tron boolean, tam_tinh boolean,
  so_ngay_lich integer, so_ngay_da_qua integer, tua_chuan integer, cong_chuan integer,
  muc_phat numeric, he_so_min numeric, he_so_max numeric,
  co_mat integer, co_mat_tu_dong integer, co_mat_truc_ca integer, co_mat_cham_tay integer,
  phep_thuong_bu integer, co_phep integer, khong_phep integer, nghi_tua integer, chua_ghi_nhan integer,
  khong_xet text, he_so numeric,
  tua_nguon text, tua_ly_do text, ngay_chuyen_can integer
)
language sql stable security definer set search_path = public as $$
  with mo as (
    select make_date(p_nam, p_thang, 1) as m0,
           (make_date(p_nam, p_thang, 1) + interval '1 month' - interval '1 day')::date as m1,
           (now() at time zone 'Asia/Ho_Chi_Minh')::date as today
  ),
  pr as (
    select p.id from public.profiles p
    where p.factory_id = p_factory_id and p.status = 'active'
  ),
  -- 1 hồ sơ / tài khoản: ưu tiên nhân viên, đang dùng.
  st as (
    select distinct on (ms.profile_id)
      ms.profile_id, ms.id, coalesce(ms.loai_nhan_su, 'nhan_vien') as loai, ms.ngay_vao_lam, ms.ngay_nghi_viec
    from public.maintenance_staff ms
    where ms.factory_id = p_factory_id and ms.profile_id in (select id from pr)
    order by ms.profile_id, (coalesce(ms.loai_nhan_su, 'nhan_vien') = 'nhan_vien') desc,
             coalesce(ms.active, true) desc, ms.id
  ),
  -- Tua chuẩn: tháng-nhóm chính → tháng-chung → trọng số nhóm → trọng số chung → 6.
  -- Mức trừ / min / max: trọng số nhóm → chung (không theo tháng).
  w as (
    select pr.id as profile_id,
      coalesce(mg.so_ngay_nghi_tua_chuan, mc.so_ngay_nghi_tua_chuan,
               wg.so_ngay_nghi_tua_chuan, wd.so_ngay_nghi_tua_chuan, 6) as tua_chuan,
      case
        when mg.id is not null then 'thang_nhom'
        when mc.id is not null then 'thang_chung'
        when wg.so_ngay_nghi_tua_chuan is not null then 'trong_so_nhom'
        when wd.so_ngay_nghi_tua_chuan is not null then 'trong_so_chung'
        else 'mac_dinh' end as tua_nguon,
      coalesce(mg.ly_do, mc.ly_do) as tua_ly_do,
      coalesce(pg.nguon_hoat_dong, '{}'::text[]) as nguon_hd,
      coalesce(wg.he_so_phat_khong_phep, wd.he_so_phat_khong_phep, 0.020) as muc_phat,
      coalesce(wg.he_so_chuyen_can_min, wd.he_so_chuyen_can_min, 0.75) as he_so_min,
      coalesce(wg.he_so_chuyen_can_max, wd.he_so_chuyen_can_max, 1.10) as he_so_max
    from pr
    cross join mo
    left join st on st.profile_id = pr.id
    left join lateral (
      select pgm.group_id from public.personnel_group_members pgm
      where pgm.staff_id = st.id and pgm.is_primary = true limit 1
    ) g on true
    left join public.personnel_groups pg on pg.id = g.group_id
    left join public.kpi_score_weights wg on wg.factory_id = p_factory_id and wg.group_id = g.group_id
    left join public.kpi_score_weights wd on wd.factory_id = p_factory_id and wd.group_id is null
    left join public.kpi_attendance_month_config mg
      on mg.factory_id = p_factory_id and mg.group_id = g.group_id and mg.thang = mo.m0
    left join public.kpi_attendance_month_config mc
      on mc.factory_id = p_factory_id and mc.group_id is null and mc.thang = mo.m0
  ),
  rec as (
    select r.staff_id,
      count(*) filter (where r.trang_thai = 'co_mat') as co_mat,
      count(*) filter (where r.trang_thai = 'co_mat' and r.nguon in ('auto_app', 'cham_diem_d')) as co_mat_tu_dong,
      count(*) filter (where r.trang_thai = 'co_mat' and r.nguon = 'truc_ca') as co_mat_truc_ca,
      count(*) filter (where r.trang_thai = 'co_mat' and r.nguon = 'bo_sung_tay') as co_mat_cham_tay,
      count(*) filter (where r.trang_thai = 'nghi_co_phep' and r.dung_phep_thuong) as phep_thuong_bu,
      count(*) filter (where r.trang_thai = 'nghi_co_phep') as co_phep,
      count(*) filter (where r.trang_thai = 'nghi_khong_phep') as khong_phep,
      count(*) filter (where r.trang_thai = 'nghi_tua') as nghi_tua,
      count(*) filter (where r.trang_thai = 'nghi_tua'
        and cardinality(w.nguon_hd) > 0
        and jsonb_typeof(r.hoat_dong) = 'array'
        and exists (select 1 from jsonb_array_elements(r.hoat_dong) e where e ->> 'nguon' = any (w.nguon_hd))
      ) as ngay_chuyen_can,
      count(*) filter (where r.ngay <= (select today from mo)) as da_ghi_qua
    from public.attendance_records r
    cross join mo
    join st on st.id = r.staff_id
    join w on w.profile_id = st.profile_id
    where r.factory_id = p_factory_id and r.ngay between mo.m0 and mo.m1
    group by r.staff_id
  ),
  base as (
    select pr.id as profile_id, st.id as staff_id,
      case when st.id is null then 'khong_ho_so' else st.loai end as loai,
      (st.id is not null and (
        (st.ngay_vao_lam is not null and st.ngay_vao_lam > mo.m0)
        or (st.ngay_nghi_viec is not null and st.ngay_nghi_viec < mo.m1))) as khong_tron,
      mo.today < mo.m1 as tam_tinh,
      (mo.m1 - mo.m0 + 1)::int as so_ngay_lich,
      greatest(0, least(mo.today, mo.m1) - mo.m0 + 1)::int as so_ngay_da_qua,
      w.tua_chuan::int as tua_chuan,
      greatest(1, (mo.m1 - mo.m0 + 1) - w.tua_chuan)::int as cong_chuan,
      w.muc_phat, w.he_so_min, w.he_so_max,
      coalesce(rec.co_mat, 0)::int as co_mat,
      coalesce(rec.co_mat_tu_dong, 0)::int as co_mat_tu_dong,
      coalesce(rec.co_mat_truc_ca, 0)::int as co_mat_truc_ca,
      coalesce(rec.co_mat_cham_tay, 0)::int as co_mat_cham_tay,
      coalesce(rec.phep_thuong_bu, 0)::int as phep_thuong_bu,
      coalesce(rec.co_phep, 0)::int as co_phep,
      coalesce(rec.khong_phep, 0)::int as khong_phep,
      coalesce(rec.nghi_tua, 0)::int as nghi_tua,
      greatest(0, greatest(0, least(mo.today, mo.m1) - mo.m0 + 1) - coalesce(rec.da_ghi_qua, 0))::int as chua_ghi_nhan,
      w.tua_nguon, w.tua_ly_do,
      coalesce(rec.ngay_chuyen_can, 0)::int as ngay_chuyen_can
    from pr cross join mo
    join w on w.profile_id = pr.id
    left join st on st.profile_id = pr.id
    left join rec on rec.staff_id = st.id
  )
  select b.profile_id, b.staff_id, b.loai, b.khong_tron, b.tam_tinh,
    b.so_ngay_lich, b.so_ngay_da_qua, b.tua_chuan, b.cong_chuan,
    b.muc_phat, b.he_so_min, b.he_so_max,
    b.co_mat, b.co_mat_tu_dong, b.co_mat_truc_ca, b.co_mat_cham_tay,
    b.phep_thuong_bu, b.co_phep, b.khong_phep, b.nghi_tua, b.chua_ghi_nhan,
    case b.loai
      when 'khong_ho_so' then 'Chưa có hồ sơ Nhân sự liên kết tài khoản'
      when 'cong_nhan' then 'Công nhân — không có công chuẩn'
      else null end as khong_xet,
    case
      when b.loai <> 'nhan_vien' then 1.000
      when b.khong_tron then null
      else round(least(b.he_so_max, greatest(b.he_so_min,
             (b.co_mat + b.phep_thuong_bu)::numeric / b.cong_chuan - b.khong_phep * b.muc_phat)), 3)
    end as he_so,
    b.tua_nguon, b.tua_ly_do,
    case when b.loai = 'nhan_vien' then b.ngay_chuyen_can else 0 end as ngay_chuyen_can
  from base b;
$$;

-- Bản cho giao diện: chính mình, admin, kpi.view_all, kpi.manage_config.
create function public.kpi_attendance_month_summary(p_factory_id uuid, p_nam integer, p_thang integer)
returns table (
  profile_id uuid, staff_id uuid, loai text, khong_tron boolean, tam_tinh boolean,
  so_ngay_lich integer, so_ngay_da_qua integer, tua_chuan integer, cong_chuan integer,
  muc_phat numeric, he_so_min numeric, he_so_max numeric,
  co_mat integer, co_mat_tu_dong integer, co_mat_truc_ca integer, co_mat_cham_tay integer,
  phep_thuong_bu integer, co_phep integer, khong_phep integer, nghi_tua integer, chua_ghi_nhan integer,
  khong_xet text, he_so numeric,
  tua_nguon text, tua_ly_do text, ngay_chuyen_can integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_all boolean;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if p_thang is null or p_thang < 1 or p_thang > 12 or p_nam is null or p_nam < 2000 or p_nam > 2100 then
    raise exception 'Tháng không hợp lệ.';
  end if;
  v_all := public.current_profile_is_admin()
        or public.current_profile_has_permission('kpi.view_all')
        or public.current_profile_has_permission('kpi.manage_config');
  return query
    select s.* from public.kpi_attendance_summary_internal(p_factory_id, p_nam, p_thang) s
    where v_all or s.profile_id = v_uid;
end $$;

revoke all on function public.kpi_attendance_summary_internal(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.kpi_attendance_summary_internal(uuid, integer, integer) to service_role;
revoke all on function public.kpi_attendance_month_summary(uuid, integer, integer) from public, anon;
grant execute on function public.kpi_attendance_month_summary(uuid, integer, integer) to authenticated;

-- ── 3b. Tính điểm tháng (chép 20261216, chỉ thêm tua_nguon / tua_ly_do / ngay_chuyen_can vào chi_tiet) ──
CREATE OR REPLACE FUNCTION public.kpi_compute_monthly_scores(
  p_factory_id UUID,
  p_nam INTEGER,
  p_thang INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_month_start DATE;
  v_month_end DATE;
  v_cutoff TIMESTAMPTZ;
  v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_affected INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.manage_config') THEN
    RAISE EXCEPTION 'Bạn không có quyền tính điểm KPI tháng.';
  END IF;
  -- C5: lõi đồng bộ chấm công không kiểm quyền ⇒ bắt buộc đúng nhà máy của người bấm.
  IF p_factory_id IS DISTINCT FROM public.current_profile_factory_id() THEN
    RAISE EXCEPTION 'Sai nhà máy.';
  END IF;
  IF p_thang < 1 OR p_thang > 12 THEN
    RAISE EXCEPTION 'Tháng không hợp lệ: %', p_thang;
  END IF;

  v_month_start := make_date(p_nam, p_thang, 1);
  v_month_end := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_cutoff := LEAST(now(), (v_month_end + 1)::timestamptz);

  -- C5: đồng bộ "Có mặt tự động" của tháng + xét lại chuỗi sổ phép năm trước khi đọc ngày công.
  IF v_month_start <= v_today THEN
    PERFORM public.attendance_sync_auto_internal(p_factory_id, v_month_start, LEAST(v_month_end, v_today));
  END IF;
  PERFORM public.attendance_leave_recompute_internal(p_factory_id, p_nam, NULL, v_uid);

  -- B: cột của hàm tổng hợp đã đổi ⇒ dựng lại bảng tạm mỗi lần (không IF NOT EXISTS).
  DROP TABLE IF EXISTS _kpi_att;
  CREATE TEMP TABLE _kpi_att ON COMMIT DROP AS
    SELECT * FROM public.kpi_attendance_summary_internal(p_factory_id, p_nam, p_thang);

  WITH a_data AS (
    SELECT tm.user_id, AVG(COALESCE(tm.tien_do_nghiem_thu, tm.tien_do)) AS diem_hoan_thanh,
      COUNT(*) AS so_task
    FROM public.kpi_task_members tm
    JOIN public.kpi_tasks t ON t.id = tm.task_id
    WHERE t.factory_id = p_factory_id
      AND tm.is_active = true
      AND t.ngay_giao BETWEEN v_month_start AND v_month_end
    GROUP BY tm.user_id
  ),
  b_data AS (
    SELECT tm.user_id,
      COUNT(*) FILTER (WHERE tm.da_nop_luc IS NOT NULL AND tm.da_nop_luc <= t.han_hoan_thanh) AS dung_han,
      COUNT(*) AS tong_da_den_han
    FROM public.kpi_task_members tm
    JOIN public.kpi_tasks t ON t.id = tm.task_id
    WHERE t.factory_id = p_factory_id
      AND tm.is_active = true
      AND t.ngay_giao BETWEEN v_month_start AND v_month_end
      AND t.han_hoan_thanh <= v_cutoff
    GROUP BY tm.user_id
  ),
  c_data AS (
    SELECT e.nguoi_don_id AS user_id,
      AVG(CASE e.ket_qua WHEN 'dat' THEN 100 WHEN 'tuong_doi' THEN 50 ELSE 0 END) AS diem_5s,
      COUNT(*) AS so_lan_cham
    FROM public.kpi_5s_evaluations e
    WHERE e.factory_id = p_factory_id
      AND e.tuan_bat_dau BETWEEN v_month_start AND v_month_end
    GROUP BY e.nguoi_don_id
  ),
  eval_pct AS (
    SELECT de.id AS evaluation_id, de.user_id, de.ngay, de.loai,
      COALESCE(
        (SELECT AVG(CASE it.ket_qua WHEN 'dat' THEN 1.0 WHEN 'tuong_doi' THEN 0.5 ELSE 0 END)
         FROM public.kpi_daily_evaluation_items it WHERE it.evaluation_id = de.id),
        0
      ) AS pct
    FROM public.kpi_daily_evaluations de
    WHERE de.factory_id = p_factory_id AND de.ngay BETWEEN v_month_start AND v_month_end
  ),
  chinh_days AS (
    SELECT user_id, ngay, pct AS chinh_pct FROM eval_pct WHERE loai = 'chinh'
  ),
  choang_days AS (
    SELECT user_id, ngay, SUM(pct * 5) AS choang_sum, COUNT(*) AS choang_count
    FROM eval_pct WHERE loai = 'choang'
    GROUP BY user_id, ngay
  ),
  day_scores AS (
    SELECT
      c.user_id,
      c.ngay,
      (c.chinh_pct * 10) + COALESCE(ch.choang_sum, 0) AS diem_ngay,
      10 + COALESCE(ch.choang_count, 0) * 5 AS max_ngay
    FROM chinh_days c
    LEFT JOIN choang_days ch ON ch.user_id = c.user_id AND ch.ngay = c.ngay
  ),
  d_data AS (
    SELECT user_id,
      AVG((diem_ngay / NULLIF(max_ngay, 0)) * 100) AS diem_chuyen_mon,
      COUNT(*) AS so_ngay_co_cham
    FROM day_scores
    GROUP BY user_id
  ),
  weight_row AS (
    SELECT DISTINCT ON (p.id) p.id AS user_id,
      COALESCE(w_group.trong_so_hoan_thanh, w_default.trong_so_hoan_thanh, 30) AS w_a,
      COALESCE(w_group.trong_so_dung_han, w_default.trong_so_dung_han, 25) AS w_b,
      COALESCE(w_group.trong_so_5s, w_default.trong_so_5s, 20) AS w_c,
      COALESCE(w_group.trong_so_chuyen_mon, w_default.trong_so_chuyen_mon, 25) AS w_d
    FROM public.profiles p
    LEFT JOIN public.maintenance_staff ms ON ms.profile_id = p.id AND ms.factory_id = p_factory_id
    LEFT JOIN public.personnel_group_members pgm ON pgm.staff_id = ms.id AND pgm.is_primary = true
    LEFT JOIN public.kpi_score_weights w_group ON w_group.factory_id = p_factory_id AND w_group.group_id = pgm.group_id
    LEFT JOIN public.kpi_score_weights w_default ON w_default.factory_id = p_factory_id AND w_default.group_id IS NULL
    WHERE p.factory_id = p_factory_id AND p.status = 'active'
    ORDER BY p.id, (w_group.id IS NOT NULL) DESC
  ),
  final_calc AS (
    SELECT
      wr.user_id,
      a.diem_hoan_thanh AS diem_hoan_thanh,
      COALESCE(a.so_task, 0) > 0 AS has_a,
      CASE WHEN b.tong_da_den_han > 0 THEN (b.dung_han::numeric / b.tong_da_den_han) * 100 ELSE NULL END AS diem_dung_han,
      COALESCE(b.tong_da_den_han, 0) > 0 AS has_b,
      c.diem_5s AS diem_5s,
      COALESCE(c.so_lan_cham, 0) > 0 AS has_c,
      d.diem_chuyen_mon AS diem_chuyen_mon,
      COALESCE(d.so_ngay_co_cham, 0) > 0 AS has_d,
      COALESCE(d.so_ngay_co_cham, 0) AS so_ngay_co_cham,
      wr.w_a, wr.w_b, wr.w_c, wr.w_d,
      att.loai AS att_loai, COALESCE(att.khong_tron, false) AS khong_tron, att.tam_tinh,
      att.so_ngay_lich, att.tua_chuan, att.cong_chuan, att.muc_phat,
      att.co_mat, att.co_mat_tu_dong, att.co_mat_truc_ca, att.co_mat_cham_tay,
      att.phep_thuong_bu, att.co_phep, att.khong_phep, att.nghi_tua, att.chua_ghi_nhan,
      att.khong_xet, COALESCE(att.he_so, 1.000) AS he_so_att,
      att.tua_nguon, att.tua_ly_do, COALESCE(att.ngay_chuyen_can, 0) AS ngay_chuyen_can
    FROM weight_row wr
    LEFT JOIN a_data a ON a.user_id = wr.user_id
    LEFT JOIN b_data b ON b.user_id = wr.user_id
    LEFT JOIN c_data c ON c.user_id = wr.user_id
    LEFT JOIN d_data d ON d.user_id = wr.user_id
    LEFT JOIN _kpi_att att ON att.profile_id = wr.user_id
  ),
  scored AS (
    SELECT
      fc.*,
      fc.he_so_att AS he_so_chuyen_can,
      CASE WHEN fc.has_a THEN fc.w_a ELSE 0 END AS w_a_eff,
      CASE WHEN fc.has_b THEN fc.w_b ELSE 0 END AS w_b_eff,
      CASE WHEN fc.has_c THEN fc.w_c ELSE 0 END AS w_c_eff,
      CASE WHEN fc.has_d THEN fc.w_d ELSE 0 END AS w_d_eff
    FROM final_calc fc
  ),
  scored2 AS (
    SELECT s.*, (s.w_a_eff + s.w_b_eff + s.w_c_eff + s.w_d_eff) AS w_sum_eff FROM scored s
  ),
  upserted AS (
    INSERT INTO public.kpi_monthly_scores (
      factory_id, user_id, nam, thang,
      diem_hoan_thanh, diem_dung_han, diem_5s, diem_chuyen_mon,
      he_so_chuyen_can, so_ngay_co_cham, diem_tong, chi_tiet, trang_thai
    )
    SELECT
      p_factory_id, s.user_id, p_nam, p_thang,
      round(s.diem_hoan_thanh, 1),
      round(s.diem_dung_han, 1),
      round(s.diem_5s, 1),
      round(s.diem_chuyen_mon, 1),
      round(s.he_so_chuyen_can, 3),
      s.so_ngay_co_cham,
      round(
        ( COALESCE(s.diem_hoan_thanh, 0) * s.w_a_eff
        + COALESCE(s.diem_dung_han, 0)   * s.w_b_eff
        + COALESCE(s.diem_5s, 0)         * s.w_c_eff
        + COALESCE(s.diem_chuyen_mon, 0) * s.w_d_eff )
        / s.w_sum_eff * s.he_so_chuyen_can,
        1
      ),
      jsonb_build_object(
        'a', round(s.diem_hoan_thanh, 1), 'b', round(s.diem_dung_han, 1),
        'c', round(s.diem_5s, 1), 'd', round(s.diem_chuyen_mon, 1),
        'trong_so', jsonb_build_object('a', s.w_a, 'b', s.w_b, 'c', s.w_c, 'd', s.w_d),
        'trong_so_hieu_luc', jsonb_build_object('a', s.w_a_eff, 'b', s.w_b_eff, 'c', s.w_c_eff, 'd', s.w_d_eff),
        'co_du_lieu', jsonb_build_object('a', s.has_a, 'b', s.has_b, 'c', s.has_c, 'd', s.has_d),
        'he_so_chuyen_can', round(s.he_so_chuyen_can, 3),
        'so_ngay_co_cham', s.so_ngay_co_cham, 'ngay_chuan', s.cong_chuan,
        'cong_thuc_version', 2,
        'chuyen_can', jsonb_build_object(
          'loai', s.att_loai, 'khong_xet', s.khong_xet, 'tam_tinh', s.tam_tinh,
          'so_ngay_lich', s.so_ngay_lich, 'tua_chuan', s.tua_chuan, 'cong_chuan', s.cong_chuan,
          'muc_phat', s.muc_phat, 'co_mat', s.co_mat, 'co_mat_tu_dong', s.co_mat_tu_dong,
          'co_mat_truc_ca', s.co_mat_truc_ca, 'co_mat_cham_tay', s.co_mat_cham_tay,
          'phep_thuong_bu', s.phep_thuong_bu, 'co_phep', s.co_phep, 'khong_phep', s.khong_phep,
          'nghi_tua', s.nghi_tua, 'chua_ghi_nhan', s.chua_ghi_nhan,
          'tua_nguon', s.tua_nguon, 'tua_ly_do', s.tua_ly_do, 'ngay_chuyen_can', s.ngay_chuyen_can
        )
      ),
      'nhap'
    FROM scored2 s
    WHERE s.w_sum_eff > 0
      AND NOT s.khong_tron
    ON CONFLICT (factory_id, user_id, nam, thang)
    DO UPDATE SET
      diem_hoan_thanh = EXCLUDED.diem_hoan_thanh,
      diem_dung_han = EXCLUDED.diem_dung_han,
      diem_5s = EXCLUDED.diem_5s,
      diem_chuyen_mon = EXCLUDED.diem_chuyen_mon,
      he_so_chuyen_can = EXCLUDED.he_so_chuyen_can,
      so_ngay_co_cham = EXCLUDED.so_ngay_co_cham,
      diem_tong = EXCLUDED.diem_tong,
      chi_tiet = EXCLUDED.chi_tiet,
      updated_at = now()
    WHERE public.kpi_monthly_scores.trang_thai <> 'da_khoa'
    RETURNING 1
  )
  SELECT count(*) INTO v_affected FROM upserted;

  DELETE FROM public.kpi_monthly_scores ms
  WHERE ms.factory_id = p_factory_id
    AND ms.nam = p_nam
    AND ms.thang = p_thang
    AND ms.trang_thai <> 'da_khoa'
    AND (
      EXISTS (SELECT 1 FROM _kpi_att att WHERE att.profile_id = ms.user_id AND att.khong_tron)
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.kpi_task_members tm
          JOIN public.kpi_tasks t ON t.id = tm.task_id
          WHERE tm.user_id = ms.user_id AND t.factory_id = p_factory_id AND tm.is_active = true
            AND t.ngay_giao BETWEEN v_month_start AND v_month_end
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.kpi_5s_evaluations e
          WHERE e.nguoi_don_id = ms.user_id AND e.factory_id = p_factory_id
            AND e.tuan_bat_dau BETWEEN v_month_start AND v_month_end
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.kpi_daily_evaluations de
          WHERE de.user_id = ms.user_id AND de.factory_id = p_factory_id
            AND de.ngay BETWEEN v_month_start AND v_month_end
        )
      )
    );

  RETURN v_affected;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_compute_monthly_scores(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_compute_monthly_scores(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 4. Bảng xếp hạng ẩn danh (chép 20260814): hoà điểm ⇒ nhiều ngày chuyên cần xếp trên ──
drop function if exists public.kpi_score_ranking_by_group(uuid, integer, integer, uuid);
create function public.kpi_score_ranking_by_group(
  p_factory_id UUID, p_nam INTEGER, p_thang INTEGER, p_group_id UUID
)
RETURNS TABLE(rank BIGINT, diem_tong NUMERIC, is_me BOOLEAN, ngay_chuyen_can INTEGER)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Chưa đăng nhập.'; END IF;
  IF NOT public.current_profile_has_permission('kpi.view') THEN
    RAISE EXCEPTION 'Bạn không có quyền xem bảng điểm KPI.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Nhóm không thuộc nhà máy của bạn.';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT s.profile_id AS user_id
    FROM public.personnel_group_members m
    JOIN public.maintenance_staff s ON s.id = m.staff_id
    WHERE m.group_id = p_group_id
      AND m.is_primary = true
      AND s.factory_id = p_factory_id
      AND s.active IS DISTINCT FROM false
      AND s.profile_id IS NOT NULL
  ),
  scores AS (
    SELECT ms.user_id, ms.diem_tong,
      COALESCE(NULLIF(ms.chi_tiet -> 'chuyen_can' ->> 'ngay_chuyen_can', '')::int, 0) AS ncc
    FROM public.kpi_monthly_scores ms
    JOIN members me ON me.user_id = ms.user_id
    WHERE ms.factory_id = p_factory_id AND ms.nam = p_nam AND ms.thang = p_thang AND ms.diem_tong IS NOT NULL
  )
  SELECT RANK() OVER (ORDER BY sc.diem_tong DESC, sc.ncc DESC) AS rank, sc.diem_tong,
    (sc.user_id = v_uid) AS is_me, sc.ncc AS ngay_chuyen_can
  FROM scores sc
  ORDER BY sc.diem_tong DESC, sc.ncc DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.kpi_score_ranking_by_group(UUID, INTEGER, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_score_ranking_by_group(UUID, INTEGER, INTEGER, UUID) TO authenticated;

drop function if exists public.kpi_score_ranking_by_department(uuid, integer, integer, uuid);
create function public.kpi_score_ranking_by_department(
  p_factory_id UUID, p_nam INTEGER, p_thang INTEGER, p_department_id UUID
)
RETURNS TABLE(rank BIGINT, diem_tong NUMERIC, is_me BOOLEAN, ngay_chuyen_can INTEGER)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Chưa đăng nhập.'; END IF;
  IF NOT public.current_profile_has_permission('kpi.view') THEN
    RAISE EXCEPTION 'Bạn không có quyền xem bảng điểm KPI.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phòng ban không thuộc nhà máy của bạn.';
  END IF;

  RETURN QUERY
  WITH dept AS (
    SELECT id, name, code FROM public.departments WHERE id = p_department_id
  ),
  members AS (
    SELECT p.id AS user_id
    FROM public.profiles p, dept d
    WHERE p.factory_id = p_factory_id
      AND p.status = 'active'
      AND (
        p.department_id = d.id
        OR (d.name IS NOT NULL AND p.department = d.name)
        OR (p.department IS NOT NULL AND d.code IS NOT NULL AND upper(p.department) = upper(d.code))
      )
  ),
  scores AS (
    SELECT ms.user_id, ms.diem_tong,
      COALESCE(NULLIF(ms.chi_tiet -> 'chuyen_can' ->> 'ngay_chuyen_can', '')::int, 0) AS ncc
    FROM public.kpi_monthly_scores ms
    JOIN members me ON me.user_id = ms.user_id
    WHERE ms.factory_id = p_factory_id AND ms.nam = p_nam AND ms.thang = p_thang AND ms.diem_tong IS NOT NULL
  )
  SELECT RANK() OVER (ORDER BY sc.diem_tong DESC, sc.ncc DESC) AS rank, sc.diem_tong,
    (sc.user_id = v_uid) AS is_me, sc.ncc AS ngay_chuyen_can
  FROM scores sc
  ORDER BY sc.diem_tong DESC, sc.ncc DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.kpi_score_ranking_by_department(UUID, INTEGER, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_score_ranking_by_department(UUID, INTEGER, INTEGER, UUID) TO authenticated;
