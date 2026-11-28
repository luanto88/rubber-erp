-- Sửa sau test B (2026-11-28) — chạy tay SAU 20261224, TRƯỚC deploy.
--   1. K1 Mở khoá sổ điểm KPI tháng: CHỈ admin, lý do bắt buộc, nhật ký bất biến kpi_monthly_score_unlocks.
--      Mở khoá xong "Tính điểm tháng" sẽ ghi đè cả điểm đã điều chỉnh (kpi_score_adjustments vẫn giữ lịch sử).
--   2. L4 Duyệt / trả về phiếu điểm danh: CHỈ admin | attendance.approve (bỏ attendance.mark_all) + chuông "chờ duyệt".
--   3. L5 Dòng phiếu Tổ ĐÃ GỬI: khoá hẳn với mọi người trừ admin (kể cả dòng ca của mình chưa chốt). Muốn sửa ⇒ văn phòng
--      Trả về hoặc admin Thu hồi. Vẫn thêm được phân công mới chưa gửi.
-- Mọi CREATE OR REPLACE attendance_submit_section / attendance_line_editable / attendance_can_review về sau chép từ file này
-- (attendance_save_section / recall vẫn ở 20261223).

-- ══════════════ 1. Mở khoá sổ KPI ══════════════
create table if not exists public.kpi_monthly_score_unlocks (
  id                uuid primary key default gen_random_uuid(),
  factory_id        uuid not null references public.factories(id) on delete cascade,
  monthly_score_id  uuid not null references public.kpi_monthly_scores(id) on delete cascade,
  ly_do             text not null,
  diem_truoc        numeric,
  khoa_boi_cu       uuid,
  khoa_luc_cu       timestamptz,
  mo_boi            uuid references auth.users(id),
  mo_luc            timestamptz not null default now()
);
create index if not exists idx_kpi_monthly_score_unlocks_score on public.kpi_monthly_score_unlocks(monthly_score_id);

alter table public.kpi_monthly_score_unlocks enable row level security;
drop policy if exists "kpi_monthly_score_unlocks_select" on public.kpi_monthly_score_unlocks;
create policy "kpi_monthly_score_unlocks_select" on public.kpi_monthly_score_unlocks
  for select using (
    factory_id = public.current_profile_factory_id()
    and (public.current_profile_is_admin()
         or public.current_profile_has_permission('kpi.view_all')
         or public.current_profile_has_permission('kpi.manage_config'))
  );

create or replace function public.kpi_monthly_score_unlocks_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Nhật ký mở khoá sổ KPI không được sửa / xoá.';
end $$;
drop trigger if exists trg_kpi_monthly_score_unlocks_immutable on public.kpi_monthly_score_unlocks;
create trigger trg_kpi_monthly_score_unlocks_immutable
  before update or delete on public.kpi_monthly_score_unlocks
  for each row execute function public.kpi_monthly_score_unlocks_immutable();

create or replace function public.kpi_monthly_score_unlock(p_monthly_score_id uuid, p_ly_do text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v record;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if not public.current_profile_is_admin() then raise exception 'Chỉ quản trị viên được mở khoá sổ điểm KPI.'; end if;
  if v_ly_do is null then raise exception 'Mở khoá sổ phải nhập lý do.'; end if;

  select * into v from public.kpi_monthly_scores where id = p_monthly_score_id for update;
  if not found or v.factory_id is distinct from public.current_profile_factory_id() then
    raise exception 'Không tìm thấy điểm tháng này.';
  end if;
  if v.trang_thai <> 'da_khoa' then raise exception 'Điểm này chưa khoá sổ — không cần mở khoá.'; end if;
  if exists (select 1 from public.kpi_appeals a where a.monthly_score_id = p_monthly_score_id
               and a.trang_thai in ('cho_xu_ly', 'cho_duyet_sua')) then
    raise exception 'Điểm này đang có khiếu nại chưa xử lý — xử lý khiếu nại trước khi mở khoá.';
  end if;

  insert into public.kpi_monthly_score_unlocks (factory_id, monthly_score_id, ly_do, diem_truoc, khoa_boi_cu, khoa_luc_cu, mo_boi)
  values (v.factory_id, v.id, v_ly_do, v.diem_tong, v.khoa_boi, v.khoa_luc, v_uid);

  update public.kpi_monthly_scores
    set trang_thai = 'nhap', khoa_boi = null, khoa_luc = null, updated_at = now()
    where id = p_monthly_score_id;
end $$;

revoke all on function public.kpi_monthly_score_unlock(uuid, text) from public, anon;
grant execute on function public.kpi_monthly_score_unlock(uuid, text) to authenticated;

-- ══════════════ 2. Duyệt chỉ admin | attendance.approve ══════════════
create or replace function public.attendance_can_review()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_profile_is_admin()
      or public.current_profile_has_permission('attendance.approve');
$$;

-- ══════════════ 3. Dòng phiếu Tổ đã gửi: chỉ admin sửa (client mirror: canEditLine trong src/lib/attendance/shift.ts) ══════════════
create or replace function public.attendance_line_editable(
  p_lap_boi uuid, p_gui_luc timestamptz, p_chot boolean, p_ca text,
  p_uid uuid, p_my_cas text[], p_is_admin boolean, p_sec_status text, p_phan_ca boolean
) returns boolean language sql immutable as $$
  select case
    when p_is_admin then true
    when p_gui_luc is null or p_sec_status = 'tra_ve' then
      coalesce(p_lap_boi = p_uid, false) or (p_phan_ca and p_ca is not null and p_ca = any(coalesce(p_my_cas, '{}')))
    else false
  end;
$$;

-- ══════════════ 4. Gửi phiếu con (chép 20261223; chuông chờ duyệt chỉ admin | approve) ══════════════
create or replace function public.attendance_submit_section(p_section_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sec record;
  v_info record;
  v_n int;
  v_missing text;
  v_unit record;
  v_is_admin boolean := public.current_profile_is_admin();
  v_my_cas text[];
  v_ids uuid[];
  v_left int;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  select u.khung_mac_dinh, coalesce(u.phan_ca, false) as phan_ca, coalesce(u.loai, 'ca') as loai into v_unit
    from public.attendance_sheet_sections sec
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id;
  v_my_cas := public.attendance_my_ca_codes(v_sec.factory_id);

  -- Dòng người gọi gửi: phiếu ca ⇒ mọi dòng; phiếu tổ ⇒ dòng người gọi sửa được.
  select coalesce(array_agg(l.id), '{}') into v_ids
    from public.attendance_sheet_lines l
    where l.section_id = p_section_id
      and (v_unit.loai <> 'to' or public.attendance_line_editable(
            l.lap_boi, l.gui_luc, l.chot_ca, l.ca_phan_cong, v_uid, v_my_cas, v_is_admin, v_sec.trang_thai, v_unit.phan_ca));
  select count(*) into v_n from public.attendance_sheet_lines where section_id = p_section_id;
  if v_n = 0 then raise exception 'Phiếu chưa có người nào — giao việc trước khi gửi.'; end if;
  if v_unit.loai = 'to' and cardinality(v_ids) = 0 and exists (
       select 1 from public.attendance_sheet_lines l where l.section_id = p_section_id and l.gui_luc is null) then
    raise exception 'Bạn không có phân công nào cần gửi — phần còn lại do người khác giao, chờ họ gửi.';
  end if;

  select string_agg(ms.ten, ', ') into v_missing
    from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
    where l.id = any(v_ids) and l.diem_danh = 'vang' and l.vang_loai is null;
  if v_missing is not null then raise exception 'Chọn có phép / không phép cho: %.', v_missing; end if;
  if v_unit.khung_mac_dinh is not null then
    select string_agg(coalesce(mt.ten, nullif(l.thay_the_ten, ''), ms.ten), ', ') into v_missing
      from public.attendance_sheet_lines l
      join public.maintenance_staff ms on ms.id = l.staff_id
      left join public.maintenance_staff mt on mt.id = l.thay_the_staff_id
      where l.id = any(v_ids)
        and coalesce(array_length(l.cong_viec_ids, 1), 0) > 0
        and (l.gio_bd is null or l.gio_kt is null);
    if v_missing is not null then raise exception 'Chưa có giờ làm cho: %.', v_missing; end if;
  end if;
  if v_unit.phan_ca then
    select string_agg(ms.ten, ', ') into v_missing
      from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
      where l.id = any(v_ids) and l.ca_phan_cong is null
        and (l.diem_danh = 'vang' or coalesce(array_length(l.cong_viec_ids, 1), 0) > 0);
    if v_missing is not null then raise exception 'Chưa chọn ca cho: %.', v_missing; end if;
  end if;

  if v_unit.loai = 'to' then
    update public.attendance_sheet_lines l set
      gui_luc = now(), gui_boi = v_uid,
      chot_ca = v_unit.phan_ca and l.ca_phan_cong is not null and l.ca_phan_cong = any(v_my_cas)
      where l.id = any(v_ids);
    select count(*) into v_left
      from public.attendance_sheet_lines l
      where l.section_id = p_section_id and l.gui_luc is null
        and (l.diem_danh = 'vang' or coalesce(array_length(l.cong_viec_ids, 1), 0) > 0);
    if v_left > 0 then
      -- Còn phân công người khác chưa gửi ⇒ phiếu chưa sang văn phòng.
      update public.attendance_sheet_sections set trang_thai = 'dang_lam'
        where id = p_section_id and trang_thai = 'da_gui';
      perform public.attendance_recompute_sheet(v_sec.sheet_id);
      return 'mot_phan:' || v_left;
    end if;
  end if;

  update public.attendance_sheet_sections
    set trang_thai = 'da_gui', gui_luc = now(), gui_boi = v_uid, tra_ve_ly_do = null
    where id = p_section_id;
  perform public.attendance_recompute_sheet(v_sec.sheet_id);

  select s.ma_phieu, s.day_chuyen, sec.ca into v_info
    from public.attendance_sheet_sections sec join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = p_section_id;
  insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
  select v_sec.factory_id, p.id, 'diem_danh_cho_duyet', v_sec.sheet_id, 'attendance_sheet',
         'Phiếu điểm danh chờ duyệt',
         v_info.ma_phieu || ' · ' || v_info.day_chuyen || ' · Ca ' || coalesce(v_info.ca, '') || ' (' || v_n || ' người)',
         '/dashboard/attendance/sheet/' || v_sec.sheet_id
  from public.profiles p
  where p.factory_id = v_sec.factory_id and p.status = 'active' and p.id <> v_uid
    and public.attendance_user_has_permission(p.id, 'attendance.approve');
  return 'da_gui';
end $$;

revoke all on function public.attendance_line_editable(uuid, timestamptz, boolean, text, uuid, text[], boolean, text, boolean) from public, anon;
revoke all on function public.attendance_submit_section(uuid) from public, anon;
grant execute on function public.attendance_line_editable(uuid, timestamptz, boolean, text, uuid, text[], boolean, text, boolean) to authenticated;
grant execute on function public.attendance_submit_section(uuid) to authenticated;
