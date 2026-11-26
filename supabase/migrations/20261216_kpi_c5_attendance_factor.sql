-- Chấm công C5 — KPI dùng hệ số chuyên cần từ module Chấm công (2026-11-25).
-- Kế hoạch: rule 31 mục "C5", rule 27 mục "Hệ số chuyên cần".
-- Chạy tay TRƯỚC deploy (sau 20261215).
--
-- 1. kpi_score_weights: so_ngay_nghi_tua_chuan (6), he_so_phat_khong_phep (0,02).
-- 2. Tách lõi KHÔNG kiểm quyền của attendance_sync_auto / attendance_leave_recompute để RPC KPI gọi
--    được dù người bấm "Tính điểm tháng" không có attendance.view. Hàm cũ thành vỏ (kiểm quyền như cũ).
--    ⚠️ Mọi CREATE OR REPLACE 2 lõi này về sau chép từ file này.
-- 3. kpi_attendance_summary_internal / kpi_attendance_month_summary — NGUỒN DUY NHẤT số liệu + hệ số
--    chuyên cần cho KPI (RPC tính điểm, màn "Chi tiết cách tính điểm", script so sánh).
-- 4. kpi_compute_monthly_scores — chép từ 20260827, chỉ đổi khối hệ số chuyên cần + bỏ tháng làm không
--    trọn + ghi chi_tiet v2. ⚠️ Mọi CREATE OR REPLACE hàm này về sau chép từ file này.
--
-- Công thức (đã chốt):
--   Công chuẩn = số ngày lịch − so_ngay_nghi_tua_chuan
--   Hệ số      = CLAMP((Có mặt + Phép thưởng bù) ÷ Công chuẩn − muc_phat × ngày nghỉ không phép; min; max)
--   Tháng chưa hết: vẫn chia công chuẩn CẢ tháng (tam_tinh = true).
--   Làm không trọn tháng (vào làm / nghỉ việc giữa tháng) ⇒ không có dòng điểm KPI.
--   Không xét được (không có hồ sơ nhân sự / hồ sơ là công nhân) ⇒ hệ số 1,00.

-- ── 1. Cấu hình ──────────────────────────────────────────────────────────────
alter table public.kpi_score_weights
  add column if not exists so_ngay_nghi_tua_chuan integer not null default 6,
  add column if not exists he_so_phat_khong_phep numeric(5,3) not null default 0.020;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_score_weights_tua_chuan_check') then
    alter table public.kpi_score_weights add constraint kpi_score_weights_tua_chuan_check
      check (so_ngay_nghi_tua_chuan between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_score_weights_phat_check') then
    alter table public.kpi_score_weights add constraint kpi_score_weights_phat_check
      check (he_so_phat_khong_phep >= 0 and he_so_phat_khong_phep <= 0.2);
  end if;
end $$;

comment on column public.kpi_score_weights.ngay_chuan_chuyen_can is
  'LEGACY (công thức v1: số ngày chấm D ÷ ngày chuẩn). Từ C5 dùng so_ngay_nghi_tua_chuan.';
comment on column public.kpi_score_weights.so_ngay_nghi_tua_chuan is
  'Công chuẩn tháng = số ngày lịch − giá trị này (C5).';
comment on column public.kpi_score_weights.he_so_phat_khong_phep is
  'Trừ vào hệ số chuyên cần cho mỗi ngày nghỉ không phép (C5).';

-- ── 2a. Lõi đồng bộ có mặt tự động (thân chép từ 20261214) ────────────────────
create or replace function public.attendance_sync_auto_internal(p_factory_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_to date := least(p_to, v_today);
  v_them integer := 0;
  v_cap_nhat integer := 0;
  v_xoa integer := 0;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Khoảng ngày không hợp lệ.'; end if;
  if p_to - p_from > 62 then raise exception 'Đồng bộ tối đa 62 ngày mỗi lần.'; end if;
  if p_from > v_to then return jsonb_build_object('them', 0, 'cap_nhat', 0, 'xoa', 0); end if;

  -- Chống 2 người mở lịch cùng lúc đồng bộ chồng nhau.
  perform pg_advisory_xact_lock(hashtext('attendance_sync_auto:' || p_factory_id::text));

  create temp table if not exists _att_auto (
    staff_id uuid, ngay date, nguon text, hoat_dong jsonb
  ) on commit drop;
  truncate _att_auto;

  insert into _att_auto (staff_id, ngay, nguon, hoat_dong)
  select ms.id, a.ngay,
         case when bool_or(a.nguon = 'cham_diem_d') then 'cham_diem_d' else 'auto_app' end,
         jsonb_agg(jsonb_build_object('nguon', a.nguon, 'luc', a.luc) order by a.luc, a.nguon)
    from public.attendance_collect_activity(p_factory_id, p_from, v_to) a
    join public.maintenance_staff ms
      on ms.profile_id = a.profile_id and ms.factory_id = p_factory_id
   where coalesce(ms.loai_nhan_su, 'nhan_vien') = 'nhan_vien'
     and (ms.ngay_vao_lam is null or a.ngay >= ms.ngay_vao_lam)
     and (ms.ngay_nghi_viec is null or a.ngay <= ms.ngay_nghi_viec)
   group by ms.id, a.ngay;

  -- (a) Dòng tự động mất hết nguồn ⇒ xoá.
  with d as (
    delete from public.attendance_records r
     where r.factory_id = p_factory_id and r.ngay between p_from and v_to
       and r.nguon in ('auto_app', 'cham_diem_d')
       and not exists (select 1 from _att_auto t where t.staff_id = r.staff_id and t.ngay = r.ngay)
    returning 1
  ) select count(*) into v_xoa from d;

  -- (b) Dòng nguồn cao (truc_ca / bo_sung_tay) không còn thao tác ⇒ làm rỗng hoat_dong.
  update public.attendance_records r set hoat_dong = '[]'::jsonb
   where r.factory_id = p_factory_id and r.ngay between p_from and v_to
     and r.nguon not in ('auto_app', 'cham_diem_d')
     and r.hoat_dong <> '[]'::jsonb
     and not exists (select 1 from _att_auto t where t.staff_id = r.staff_id and t.ngay = r.ngay);

  -- (c) Dòng đã có ⇒ cập nhật hoat_dong; dòng tự động thì cập nhật cả nguồn (D ưu tiên hơn app).
  with u as (
    update public.attendance_records r
       set hoat_dong = t.hoat_dong,
           nguon = case when r.nguon in ('auto_app', 'cham_diem_d') then t.nguon else r.nguon end
      from _att_auto t
     where r.factory_id = p_factory_id and r.staff_id = t.staff_id and r.ngay = t.ngay
       and (r.hoat_dong is distinct from t.hoat_dong
            or (r.nguon in ('auto_app', 'cham_diem_d') and r.nguon <> t.nguon))
    returning 1
  ) select count(*) into v_cap_nhat from u;

  -- (d) Chưa có dòng ⇒ Có mặt, không xếp loại.
  with i as (
    insert into public.attendance_records (factory_id, staff_id, ngay, trang_thai, nguon, xep_loai, ly_do, hoat_dong, updated_by)
    select p_factory_id, t.staff_id, t.ngay, 'co_mat', t.nguon, null, null, t.hoat_dong, null
      from _att_auto t
     where not exists (select 1 from public.attendance_records r
                        where r.factory_id = p_factory_id and r.staff_id = t.staff_id and r.ngay = t.ngay)
    on conflict (factory_id, staff_id, ngay) do nothing
    returning 1
  ) select count(*) into v_them from i;

  return jsonb_build_object('them', v_them, 'cap_nhat', v_cap_nhat, 'xoa', v_xoa);
end $$;

-- Vỏ: kiểm quyền như cũ rồi gọi lõi.
create or replace function public.attendance_sync_auto(p_factory_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not (public.current_profile_is_admin() or public.current_profile_has_permission('attendance.view')) then
    raise exception 'Không có quyền xem chấm công.';
  end if;
  return public.attendance_sync_auto_internal(p_factory_id, p_from, p_to);
end $$;

revoke all on function public.attendance_sync_auto_internal(uuid, date, date) from public, anon, authenticated;
grant execute on function public.attendance_sync_auto_internal(uuid, date, date) to service_role;
revoke all on function public.attendance_sync_auto(uuid, date, date) from public, anon;
grant execute on function public.attendance_sync_auto(uuid, date, date) to authenticated, service_role;

-- ── 2b. Lõi xét chuỗi sổ phép (thân chép từ 20261215, created_by = p_actor) ──
create or replace function public.attendance_leave_recompute_internal(
  p_factory_id uuid, p_nam integer, p_staff_ids uuid[], p_actor uuid
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid;
  v_flag record;
  v_run integer;
  v_start integer;
  v_expected text[];
  v_key text;
  v_net integer;
  v_end_m integer;
  v_bad integer;
  v_changes integer := 0;
begin
  if p_nam is null or p_nam < 2000 or p_nam > 2100 then raise exception 'Năm không hợp lệ.'; end if;

  perform pg_advisory_xact_lock(hashtext('attendance_leave_recompute:' || p_factory_id::text || ':' || p_nam));

  -- Người đủ điều kiện + người đã có dòng chuỗi trong năm (đổi quốc tịch / loại ⇒ phải thu hồi).
  for v_staff in
    select ms.id from public.maintenance_staff ms
    where ms.factory_id = p_factory_id
      and (p_staff_ids is null or ms.id = any(p_staff_ids))
      and (
        (coalesce(ms.loai_nhan_su, 'nhan_vien') = 'nhan_vien' and ms.quoc_tich = 'VN')
        or exists (select 1 from public.attendance_leave_ledger l
                   where l.staff_id = ms.id and l.nam = p_nam and l.chuoi_key is not null)
      )
  loop
    v_expected := '{}';
    v_run := 0;
    for v_flag in
      select f.thang, f.tinh_trang from public.attendance_leave_flags_internal(p_factory_id, p_nam, array[v_staff]) f
      order by f.thang
    loop
      if v_flag.tinh_trang = 'du' then
        if v_run = 0 then v_start := v_flag.thang; end if;
        v_run := v_run + 1;
        if v_run = 3 then
          v_expected := v_expected || (p_nam::text || '-' || lpad(v_start::text, 2, '0') || '..'
                                       || p_nam::text || '-' || lpad(v_flag.thang::text, 2, '0'));
          v_run := 0;
        end if;
      else
        v_run := 0;
      end if;
    end loop;

    -- Cộng chuỗi mới đạt.
    foreach v_key in array v_expected loop
      select coalesce(sum(so_ngay), 0) into v_net from public.attendance_leave_ledger
        where factory_id = p_factory_id and staff_id = v_staff and nam = p_nam and chuoi_key = v_key;
      if v_net < 1 then
        v_end_m := substring(v_key from 15 for 2)::int;
        insert into public.attendance_leave_ledger (factory_id, staff_id, nam, loai, so_ngay, chuoi_key, hieu_luc_tu, ly_do, created_by)
        values (p_factory_id, v_staff, p_nam, 'tich_luy', 1 - v_net, v_key,
                (make_date(p_nam, v_end_m, 1) + interval '1 month')::date,
                'Đủ ngày công 3 tháng liên tiếp ' || to_char(make_date(p_nam, substring(v_key from 6 for 2)::int, 1), 'MM') || '–'
                  || to_char(make_date(p_nam, v_end_m, 1), 'MM/YYYY'),
                p_actor);
        v_changes := v_changes + 1;
      end if;
    end loop;

    -- Thu hồi chuỗi không còn đạt.
    for v_key, v_net in
      select l.chuoi_key, sum(l.so_ngay)::int from public.attendance_leave_ledger l
      where l.factory_id = p_factory_id and l.staff_id = v_staff and l.nam = p_nam and l.chuoi_key is not null
      group by l.chuoi_key
    loop
      if v_net > 0 and not (v_key = any(v_expected)) then
        select f.thang into v_bad
          from public.attendance_leave_flags_internal(p_factory_id, p_nam, array[v_staff]) f
          where f.thang between substring(v_key from 6 for 2)::int and substring(v_key from 15 for 2)::int
            and f.tinh_trang <> 'du'
          order by f.thang limit 1;
        insert into public.attendance_leave_ledger (factory_id, staff_id, nam, loai, so_ngay, chuoi_key, hieu_luc_tu, ly_do, created_by)
        values (p_factory_id, v_staff, p_nam, 'thu_hoi', -v_net, v_key,
                (make_date(p_nam, substring(v_key from 15 for 2)::int, 1) + interval '1 month')::date,
                case when v_bad is null
                  then 'Tự thu hồi: không còn đủ điều kiện (nhân viên Việt Nam)'
                  else 'Tự thu hồi: tháng ' || lpad(v_bad::text, 2, '0') || '/' || p_nam || ' không còn đủ ngày công' end,
                p_actor);
        v_changes := v_changes + 1;
      end if;
    end loop;
  end loop;
  return v_changes;
end $$;

-- Vỏ: kiểm quyền như cũ rồi gọi lõi.
create or replace function public.attendance_leave_recompute(p_factory_id uuid, p_nam integer, p_staff_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not (public.current_profile_is_admin() or public.current_profile_has_permission('attendance.view')) then
    raise exception 'Không có quyền xem chấm công.';
  end if;
  return public.attendance_leave_recompute_internal(p_factory_id, p_nam, p_staff_ids, v_uid);
end $$;

revoke all on function public.attendance_leave_recompute_internal(uuid, integer, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.attendance_leave_recompute_internal(uuid, integer, uuid[], uuid) to service_role;
revoke all on function public.attendance_leave_recompute(uuid, integer, uuid[]) from public, anon;
grant execute on function public.attendance_leave_recompute(uuid, integer, uuid[]) to authenticated;

-- ── 3. Tổng hợp chuyên cần theo tài khoản (nguồn duy nhất cho KPI) ────────────
-- loai: nhan_vien | cong_nhan | khong_ho_so. khong_xet: lý do không xét chuyên cần (hệ số 1,00) | null.
-- khong_tron = vào làm / nghỉ việc giữa tháng ⇒ he_so NULL, KPI không tạo dòng điểm.
create or replace function public.kpi_attendance_summary_internal(p_factory_id uuid, p_nam integer, p_thang integer)
returns table (
  profile_id uuid, staff_id uuid, loai text, khong_tron boolean, tam_tinh boolean,
  so_ngay_lich integer, so_ngay_da_qua integer, tua_chuan integer, cong_chuan integer,
  muc_phat numeric, he_so_min numeric, he_so_max numeric,
  co_mat integer, co_mat_tu_dong integer, co_mat_truc_ca integer, co_mat_cham_tay integer,
  phep_thuong_bu integer, co_phep integer, khong_phep integer, nghi_tua integer, chua_ghi_nhan integer,
  khong_xet text, he_so numeric
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
  -- Trọng số: theo nhóm chính của hồ sơ, không có thì mặc định nhà máy (như kpi_compute_monthly_scores).
  w as (
    select pr.id as profile_id,
      coalesce(wg.so_ngay_nghi_tua_chuan, wd.so_ngay_nghi_tua_chuan, 6) as tua_chuan,
      coalesce(wg.he_so_phat_khong_phep, wd.he_so_phat_khong_phep, 0.020) as muc_phat,
      coalesce(wg.he_so_chuyen_can_min, wd.he_so_chuyen_can_min, 0.75) as he_so_min,
      coalesce(wg.he_so_chuyen_can_max, wd.he_so_chuyen_can_max, 1.10) as he_so_max
    from pr
    left join st on st.profile_id = pr.id
    left join lateral (
      select pgm.group_id from public.personnel_group_members pgm
      where pgm.staff_id = st.id and pgm.is_primary = true limit 1
    ) g on true
    left join public.kpi_score_weights wg on wg.factory_id = p_factory_id and wg.group_id = g.group_id
    left join public.kpi_score_weights wd on wd.factory_id = p_factory_id and wd.group_id is null
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
      count(*) filter (where r.ngay <= (select today from mo)) as da_ghi_qua
    from public.attendance_records r, mo
    where r.factory_id = p_factory_id and r.ngay between mo.m0 and mo.m1
      and r.staff_id in (select id from st)
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
      greatest(0, greatest(0, least(mo.today, mo.m1) - mo.m0 + 1) - coalesce(rec.da_ghi_qua, 0))::int as chua_ghi_nhan
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
    end as he_so
  from base b;
$$;

-- Bản cho giao diện: chính mình, admin, kpi.view_all, kpi.manage_config.
drop function if exists public.kpi_attendance_month_summary(uuid, integer, integer);
create function public.kpi_attendance_month_summary(p_factory_id uuid, p_nam integer, p_thang integer)
returns table (
  profile_id uuid, staff_id uuid, loai text, khong_tron boolean, tam_tinh boolean,
  so_ngay_lich integer, so_ngay_da_qua integer, tua_chuan integer, cong_chuan integer,
  muc_phat numeric, he_so_min numeric, he_so_max numeric,
  co_mat integer, co_mat_tu_dong integer, co_mat_truc_ca integer, co_mat_cham_tay integer,
  phep_thuong_bu integer, co_phep integer, khong_phep integer, nghi_tua integer, chua_ghi_nhan integer,
  khong_xet text, he_so numeric
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

-- ── 4. Tính điểm tháng (chép từ 20260827, chỉ đổi khối hệ số + làm không trọn + chi_tiet v2) ──
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

  CREATE TEMP TABLE IF NOT EXISTS _kpi_att ON COMMIT DROP AS
    SELECT * FROM public.kpi_attendance_summary_internal(p_factory_id, p_nam, p_thang) WITH NO DATA;
  TRUNCATE _kpi_att;
  INSERT INTO _kpi_att SELECT * FROM public.kpi_attendance_summary_internal(p_factory_id, p_nam, p_thang);

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
  -- C5: bỏ 3 cột chuyên cần cũ (đã chuyển sang _kpi_att); DISTINCT ON chống trùng dòng khi 1 tài khoản
  -- có nhiều hồ sơ nhân sự (trước đây sẽ lỗi "ON CONFLICT ... cannot affect row a second time").
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
      att.khong_xet, COALESCE(att.he_so, 1.000) AS he_so_att
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
          'nghi_tua', s.nghi_tua, 'chua_ghi_nhan', s.chua_ghi_nhan
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

  -- Dọn các dòng "mồ côi" của tháng này (chưa khoá): user không còn dữ liệu nào ở cả 4 thành phần,
  -- HOẶC (C5) tháng làm không trọn.
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
