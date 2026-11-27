-- Chấm công A2 làm lại (2026-11-26) — thay phần A2 của 20261218 (lỗi: record "v_sec" has no field "ca" ở MỌI lần lưu).
-- Người dùng chốt:
--   - Tổ chấm theo KHUNG GIỜ (không liên quan ca sản xuất): Tổ tiếp nhận mủ tạp, Đội xe cơ khí = ngày/đêm tự điền theo giờ
--     mở phiếu (5h–17h ⇒ ngày 05:00–17:00, từ 17h ⇒ đêm 17:00–05:00); Tổ XLNT = 24h. Giờ khung sửa được, chung cho phiếu tổ.
--     Mỗi người chọn khung (ngày và/hoặc đêm), việc riêng từng khung. Ca đêm thuộc phiếu NGÀY BẮT ĐẦU.
--   - Tổ khác (Cơ điện – Bảo trì – Xe nâng…): không chọn gì; phiếu TKSX tự xếp vào Ca A / Ca B theo GIỜ GIAO VIỆC (giao_luc).
--   - Nhãn QR chọn trước danh sách Ca/Tổ được mở (unit_codes).
-- KHÔNG có giao diện cài đặt khung giờ — attendance_units.khung_mac_dinh chỉ seed ở đây.
-- Về sau mọi CREATE OR REPLACE attendance_save_section / attendance_submit_section PHẢI chép từ file này.
-- Chạy tay trong Supabase SQL Editor (sau 20261218). An toàn chạy lại.

-- ── 1. Cột mới ─────────────────────────────────────────────────────────────────
alter table public.attendance_units add column if not exists khung_mac_dinh text;
alter table public.attendance_units drop constraint if exists attendance_units_khung_mac_dinh_check;
alter table public.attendance_units add constraint attendance_units_khung_mac_dinh_check
  check (khung_mac_dinh is null or khung_mac_dinh in ('auto', '24h'));
comment on column public.attendance_units.khung_mac_dinh is
  'NULL = tổ/ca thường; auto = chấm theo khung ngày/đêm (tự điền theo giờ mở phiếu); 24h = chấm khung 24 giờ.';

update public.attendance_units set khung_mac_dinh = 'auto' where code in ('TN_MT', 'XE_CK') and khung_mac_dinh is null;
update public.attendance_units set khung_mac_dinh = '24h' where code = 'XLNT' and khung_mac_dinh is null;

alter table public.attendance_sheet_sections add column if not exists khung_gio jsonb;
comment on column public.attendance_sheet_sections.khung_gio is
  'Giờ từng khung của phiếu tổ theo khung: {"ngay":{"bd":"05:00","kt":"17:00"},"dem":{...},"24h":{...}}.';

alter table public.attendance_sheet_lines add column if not exists viec_theo_khung jsonb;
alter table public.attendance_sheet_lines add column if not exists giao_luc timestamptz;
comment on column public.attendance_sheet_lines.viec_theo_khung is
  'Tổ theo khung: {"ngay":[job_id],"dem":[job_id]} hoặc {"24h":[job_id]}. cong_viec_ids = hợp các khung.';
comment on column public.attendance_sheet_lines.giao_luc is
  'Lần đầu người này được giao việc trong phiếu — TKSX xếp tổ thường vào Ca A/B theo giờ này.';
comment on column public.attendance_sheet_lines.ca_lam is 'LEGACY (A2 bản đầu 20261218) — không dùng nữa.';

alter table public.attendance_qr_points add column if not exists unit_codes text[];
comment on column public.attendance_qr_points.unit_codes is 'Ca/Tổ được mở khi quét QR này. NULL/rỗng = mọi Ca/Tổ.';

-- ── 2. Phân giải QR (trả thêm unit_codes) ───────────────────────────────────────
drop function if exists public.attendance_resolve_qr(text);
create function public.attendance_resolve_qr(p_token text)
returns table (id uuid, factory_id uuid, ten_diem text, day_chuyen_mac_dinh text, unit_code text, unit_codes text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  return query
    select q.id, q.factory_id, q.ten_diem, q.day_chuyen_mac_dinh, q.unit_code, q.unit_codes
    from public.attendance_qr_points q
    where q.token = btrim(coalesce(p_token, '')) and q.is_active
      and q.factory_id = public.current_profile_factory_id();
  if not found then raise exception 'Mã QR điểm danh không hợp lệ hoặc đã ngừng dùng.'; end if;
end $$;
revoke all on function public.attendance_resolve_qr(text) from public, anon;
grant execute on function public.attendance_resolve_qr(text) to authenticated;

-- ── 3. Lưu phiếu con (thân chép từ 20261210; thêm khung giờ + giao_luc; bỏ ca_lam) ──
create or replace function public.attendance_save_section(p_section_id uuid, p_header jsonb, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_line jsonb;
  v_staff record;
  v_seen uuid[] := '{}';
  v_staff_id uuid;
  v_jobs uuid[];
  v_diem text;
  v_vang text;
  v_xep text;
  v_ly_do_id uuid;
  v_ly_do text;
  v_thay_id uuid;
  v_thay_ten text;
  v_count int := 0;
  v_vt jsonb;
  v_kv record;
  v_pid uuid;
  v_gid uuid;
  v_truong uuid;
  v_khung_mode text;
  v_kg jsonb;
  v_vtk jsonb;
  v_k record;
  v_kjobs uuid[];
  v_old_by_id jsonb;
  v_old_by_staff jsonb;
  v_line_id uuid;
  v_giao timestamptz;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu.'; end if;

  -- Đơn vị của phiếu (attendance_lock_section_for_edit KHÔNG trả cột ca).
  select u.khung_mac_dinh into v_khung_mode
    from public.attendance_sheet_sections sec
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id;

  update public.attendance_sheet_sections set
    ghi_chu = nullif(btrim(coalesce(p_header ->> 'ghi_chu', '')), '')
  where id = p_section_id;

  -- Giờ các khung (chỉ phiếu tổ theo khung).
  if v_khung_mode is not null and jsonb_typeof(p_header -> 'khung_gio') = 'object' then
    v_kg := '{}'::jsonb;
    for v_k in select key, value from jsonb_each(p_header -> 'khung_gio') loop
      if v_k.key not in ('ngay', 'dem', '24h') then raise exception 'Khung giờ không hợp lệ (%).', v_k.key; end if;
      if jsonb_typeof(v_k.value) <> 'object'
         or coalesce(v_k.value ->> 'bd', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(v_k.value ->> 'kt', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Giờ khung % phải dạng HH:MM.', v_k.key;
      end if;
      v_kg := v_kg || jsonb_build_object(v_k.key, jsonb_build_object('bd', v_k.value ->> 'bd', 'kt', v_k.value ->> 'kt'));
    end loop;
    update public.attendance_sheet_sections set khung_gio = v_kg where id = p_section_id;
  end if;

  if jsonb_typeof(p_header -> 'vi_tri') = 'object' then
    v_vt := '{}'::jsonb;
    for v_kv in select key, value from jsonb_each(p_header -> 'vi_tri') loop
      if v_kv.key not in ('truong', 'pho') then raise exception 'Vị trí không hợp lệ (%).', v_kv.key; end if;
      if jsonb_typeof(v_kv.value) <> 'object' then continue; end if;
      v_pid := nullif(v_kv.value ->> 'staff_id', '')::uuid;
      v_gid := nullif(v_kv.value ->> 'goc_staff_id', '')::uuid;
      if v_pid is not null and not exists (select 1 from public.maintenance_staff ms where ms.id = v_pid and ms.factory_id = v_sec.factory_id) then
        raise exception 'Người giữ vị trí không thuộc nhà máy.';
      end if;
      if v_gid is not null and not exists (select 1 from public.maintenance_staff ms where ms.id = v_gid and ms.factory_id = v_sec.factory_id) then
        raise exception 'Người mặc định của vị trí không thuộc nhà máy.';
      end if;
      v_vt := v_vt || jsonb_build_object(v_kv.key, jsonb_build_object('staff_id', v_pid, 'goc_staff_id', v_gid));
    end loop;
    v_truong := nullif(v_vt -> 'truong' ->> 'staff_id', '')::uuid;
    update public.attendance_sheet_sections set
      vi_tri = v_vt,
      to_truong_staff_id = v_truong,
      to_pho_staff_id = nullif(v_vt -> 'pho' ->> 'staff_id', '')::uuid,
      ca_truong_ten = coalesce((select ms.ten from public.maintenance_staff ms where ms.id = v_truong), ca_truong_ten)
    where id = p_section_id;
  end if;

  -- Giữ giờ giao việc cũ (lưu = xoá + chèn lại dòng): theo id dòng, dự phòng theo người.
  select coalesce(jsonb_object_agg(l.id::text, l.giao_luc), '{}'::jsonb),
         coalesce(jsonb_object_agg(l.staff_id::text, l.giao_luc), '{}'::jsonb)
    into v_old_by_id, v_old_by_staff
    from public.attendance_sheet_lines l
    where l.section_id = p_section_id and l.giao_luc is not null;

  delete from public.attendance_sheet_lines where section_id = p_section_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
    if v_staff_id is null then continue; end if;
    select ms.id, ms.ten, ms.ngay_vao_lam, ms.ngay_nghi_viec into v_staff
      from public.maintenance_staff ms where ms.id = v_staff_id and ms.factory_id = v_sec.factory_id;
    if not found then raise exception 'Nhân sự không thuộc nhà máy.'; end if;
    if v_staff_id = any(v_seen) then raise exception '% có 2 dòng trong cùng phiếu.', v_staff.ten; end if;
    v_seen := v_seen || v_staff_id;
    if (v_staff.ngay_vao_lam is not null and v_sec.ngay < v_staff.ngay_vao_lam)
       or (v_staff.ngay_nghi_viec is not null and v_sec.ngay > v_staff.ngay_nghi_viec) then
      raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_sec.ngay, 'DD/MM/YYYY');
    end if;

    -- Việc: phiếu tổ theo khung ⇒ từ viec_theo_khung (cong_viec_ids = hợp); còn lại ⇒ cong_viec_ids.
    v_vtk := null;
    if v_khung_mode is not null and jsonb_typeof(v_line -> 'viec_theo_khung') = 'object' then
      v_vtk := '{}'::jsonb;
      for v_k in select key, value from jsonb_each(v_line -> 'viec_theo_khung') loop
        if v_k.key not in ('ngay', 'dem', '24h') then raise exception 'Khung giờ không hợp lệ (%: %).', v_staff.ten, v_k.key; end if;
        if jsonb_typeof(v_k.value) <> 'array' then continue; end if;
        select coalesce(array_agg(distinct x::uuid), '{}') into v_kjobs from jsonb_array_elements_text(v_k.value) x;
        if cardinality(v_kjobs) > 0 then
          v_vtk := v_vtk || jsonb_build_object(v_k.key, to_jsonb(v_kjobs));
        end if;
      end loop;
      select coalesce(array_agg(distinct x::uuid), '{}') into v_jobs
        from jsonb_each(v_vtk) e, jsonb_array_elements_text(e.value) x;
      if v_vtk = '{}'::jsonb then v_vtk := null; end if;
    else
      select coalesce(array_agg(distinct x::uuid), '{}') into v_jobs
        from jsonb_array_elements_text(case when jsonb_typeof(v_line -> 'cong_viec_ids') = 'array' then v_line -> 'cong_viec_ids' else '[]'::jsonb end) x;
    end if;

    v_diem := coalesce(nullif(v_line ->> 'diem_danh', ''), 'co');
    if v_diem not in ('co', 'vang') then raise exception 'Điểm danh không hợp lệ (%).', v_staff.ten; end if;
    v_thay_id := null; v_thay_ten := null; v_vang := null; v_ly_do_id := null; v_ly_do := null; v_xep := null;
    if v_diem = 'co' then
      v_xep := coalesce(nullif(v_line ->> 'xep_loai', ''), 'A');
      if v_xep not in ('A', 'B') then raise exception 'Xếp loại chỉ A hoặc B (%).', v_staff.ten; end if;
    else
      v_vang := nullif(v_line ->> 'vang_loai', '');
      if v_vang is not null and v_vang not in ('co_phep', 'khong_phep') then raise exception 'Loại vắng không hợp lệ (%).', v_staff.ten; end if;
      v_thay_id := nullif(v_line ->> 'thay_the_staff_id', '')::uuid;
      v_thay_ten := nullif(btrim(coalesce(v_line ->> 'thay_the_ten', '')), '');
      if v_thay_id is not null then
        v_thay_ten := null;
        if v_thay_id = v_staff_id then raise exception '% không thể tự thay cho chính mình.', v_staff.ten; end if;
        if not exists (select 1 from public.maintenance_staff ms where ms.id = v_thay_id and ms.factory_id = v_sec.factory_id) then
          raise exception 'Người thay của % không thuộc nhà máy.', v_staff.ten;
        end if;
      end if;
      if v_vang = 'khong_phep' then
        v_ly_do_id := nullif(v_line ->> 'ly_do_id', '')::uuid;
        v_ly_do := nullif(btrim(coalesce(v_line ->> 'ly_do', '')), '');
        if v_ly_do_id is not null then
          select r.ten into v_ly_do from public.attendance_absence_reasons r where r.id = v_ly_do_id and r.factory_id = v_sec.factory_id;
        end if;
        if v_ly_do is null then raise exception '% vắng không phép — bắt buộc chọn lý do.', v_staff.ten; end if;
      end if;
    end if;

    v_line_id := coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid());
    v_giao := null;
    if cardinality(v_jobs) > 0 then
      v_giao := coalesce((v_old_by_id ->> v_line_id::text)::timestamptz, (v_old_by_staff ->> v_staff_id::text)::timestamptz, now());
    end if;

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, cong_viec_ids,
      vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai,
      viec_theo_khung, giao_luc)
    values (
      v_line_id, p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id, v_jobs[1], v_jobs,
      nullif(v_line ->> 'vehicle_id', '')::uuid, v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do, v_thay_id, v_thay_ten,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false),
      v_vtk, v_giao);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ── 4. Gửi phiếu con (thân chép từ 20261206 + kiểm khung của tổ theo khung) ────
create or replace function public.attendance_submit_section(p_section_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_info record;
  v_n int;
  v_missing text;
  v_khung_mode text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  select count(*) into v_n from public.attendance_sheet_lines where section_id = p_section_id;
  if v_n = 0 then raise exception 'Phiếu chưa có người nào — giao việc trước khi gửi.'; end if;
  select string_agg(ms.ten, ', ') into v_missing
    from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
    where l.section_id = p_section_id and l.diem_danh = 'vang' and l.vang_loai is null;
  if v_missing is not null then raise exception 'Chọn có phép / không phép cho: %.', v_missing; end if;

  select u.khung_mac_dinh into v_khung_mode
    from public.attendance_sheet_sections sec
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id;
  if v_khung_mode is not null then
    select string_agg(coalesce(mt.ten, nullif(l.thay_the_ten, ''), ms.ten), ', ') into v_missing
      from public.attendance_sheet_lines l
      join public.maintenance_staff ms on ms.id = l.staff_id
      left join public.maintenance_staff mt on mt.id = l.thay_the_staff_id
      where l.section_id = p_section_id
        and coalesce(array_length(l.cong_viec_ids, 1), 0) > 0
        and l.viec_theo_khung is null;
    if v_missing is not null then raise exception 'Chưa chọn khung giờ cho: %.', v_missing; end if;
  end if;

  update public.attendance_sheet_sections
    set trang_thai = 'da_gui', gui_luc = now(), gui_boi = auth.uid(), tra_ve_ly_do = null
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
  where p.factory_id = v_sec.factory_id and p.status = 'active' and p.id <> auth.uid()
    and (public.attendance_user_has_permission(p.id, 'attendance.approve')
         or public.attendance_user_has_permission(p.id, 'attendance.mark_all'));
  return 'da_gui';
end $$;

revoke all on function public.attendance_save_section(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.attendance_submit_section(uuid) from public, anon;
grant execute on function public.attendance_save_section(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attendance_submit_section(uuid) to authenticated;

-- Kiểm chứng:
--   select code, ten, khung_mac_dinh from attendance_units order by sort_order;
--   select staff_id, viec_theo_khung, giao_luc from attendance_sheet_lines where giao_luc is not null order by giao_luc desc limit 20;
