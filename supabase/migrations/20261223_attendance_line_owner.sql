-- Chấm công A4b (2026-11-27, sau test A4 bước 1): "GIỮ CHỖ" theo NGƯỜI GIAO trên phiếu Tổ.
-- Người dùng chốt:
--   * Mỗi phân công (dòng) của phiếu TỔ có người giao (lap_boi). Người khác (kể cả người chấm công tất cả) chỉ xem mờ; vẫn giao
--     được người đó vào việc khác ở khung giờ khác = 1 phân công RIÊNG của mình (khoá trùng: (người, người giao)).
--   * Tổ phân ca (CD): phân công thuộc đúng Ca của mình ⇒ trực ca ca đó sửa được (việc, xếp loại, vắng, người thay), kể cả do tổ
--     trưởng giao trước; khoá trùng (người, ca).
--   * Đã gửi ⇒ khoá hết (cả xếp loại / vắng). Ngoại lệ: dòng tổ phân ca gửi trước bởi người KHÔNG trực ca đó (chot_ca = false)
--     ⇒ trực ca đúng ca vẫn sửa tới khi chính họ gửi (chot_ca = true). Sửa dòng đã gửi ⇒ dòng về "chưa gửi".
--   * Gửi: mỗi người gửi phần mình sửa được; phiếu tổ "Đã gửi" khi MỌI dòng có nội dung đã gửi ⇒ văn phòng duyệt 1 lần.
--   * Phiếu "Trả về": mỗi người giao tự sửa phần mình. Admin sửa mọi dòng chưa duyệt.
--   * Phiếu Ca sản xuất: KHÔNG đổi (1 dòng / người, đã gửi là khoá cả phiếu).
-- Về sau mọi CREATE OR REPLACE attendance_save_section / attendance_submit_section / attendance_recall_section PHẢI chép từ file
-- này (attendance_lock_section_for_edit / attendance_open_section vẫn ở 20261222).
-- Chạy tay trên Supabase SQL Editor SAU 20261222, TRƯỚC khi deploy code A4b. An toàn chạy lại. Không DELETE thiếu WHERE (safeupdate).

-- ── 1. Cột + backfill ────────────────────────────────────────────────────────
alter table public.attendance_sheet_lines add column if not exists lap_boi uuid references auth.users(id);
alter table public.attendance_sheet_lines add column if not exists gui_boi uuid references auth.users(id);
alter table public.attendance_sheet_lines add column if not exists chot_ca boolean not null default false;
comment on column public.attendance_sheet_lines.lap_boi is 'Người giao phân công (giữ chỗ) — chỉ người này / trực ca đúng ca (tổ phân ca) / admin sửa.';
comment on column public.attendance_sheet_lines.gui_boi is 'Người gửi dòng này (phiếu tổ).';
comment on column public.attendance_sheet_lines.chot_ca is 'Tổ phân ca: dòng đã được trực ca của ĐÚNG ca đó gửi ⇒ khoá hẳn (trừ admin).';

update public.attendance_sheet_lines l set lap_boi = sec.truc_ca_user_id
  from public.attendance_sheet_sections sec
  where l.section_id = sec.id and l.lap_boi is null;
update public.attendance_sheet_lines l set gui_boi = coalesce(sec.gui_boi, sec.truc_ca_user_id)
  from public.attendance_sheet_sections sec
  where l.section_id = sec.id and l.gui_luc is not null and l.gui_boi is null;
-- Dòng tổ phân ca đã gửi từ trước bản này ⇒ coi như đã chốt (không mở lại ngầm).
update public.attendance_sheet_lines l set chot_ca = true
  from public.attendance_sheet_sections sec
  join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca and u.phan_ca
  where l.section_id = sec.id and l.gui_luc is not null and not l.chot_ca and l.ca_phan_cong is not null;

drop index if exists public.uniq_attendance_sheet_lines_staff_ca;
create unique index if not exists uniq_attendance_sheet_lines_staff_ca_owner
  on public.attendance_sheet_lines (section_id, staff_id, coalesce(ca_phan_cong, ''), coalesce(lap_boi::text, ''));

-- ── 2. Quyền sửa 1 dòng phiếu tổ (client mirror: canEditLine trong src/lib/attendance/shift.ts) ──
create or replace function public.attendance_line_editable(
  p_lap_boi uuid, p_gui_luc timestamptz, p_chot boolean, p_ca text,
  p_uid uuid, p_my_cas text[], p_is_admin boolean, p_sec_status text, p_phan_ca boolean
) returns boolean language sql immutable as $$
  select case
    when p_is_admin then true
    when p_gui_luc is null or p_sec_status = 'tra_ve' then
      coalesce(p_lap_boi = p_uid, false) or (p_phan_ca and p_ca is not null and p_ca = any(coalesce(p_my_cas, '{}')))
    else
      p_phan_ca and p_ca is not null and p_ca = any(coalesce(p_my_cas, '{}')) and not coalesce(p_chot, false)
  end;
$$;

-- ── 3. Lưu phiếu con (chép 20261222; phiếu tổ: quyền theo dòng, giữ chỗ theo người giao) ──
create or replace function public.attendance_save_section(p_section_id uuid, p_header jsonb, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sec record;
  v_line jsonb;
  v_staff record;
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
  v_old_by_id jsonb;
  v_line_id uuid;
  v_giao timestamptz;
  v_bd text;
  v_kt text;
  v_unit record;
  v_is_admin boolean := public.current_profile_is_admin();
  v_is_to boolean;
  v_create_all boolean;
  v_my_cas text[];
  v_ca_valid text[];
  v_ca text;
  v_old public.attendance_sheet_lines%rowtype;
  v_owner uuid;
  v_gui timestamptz;
  v_gui_boi uuid;
  v_chot boolean;
  v_incoming_ids uuid[] := '{}';
  v_vehicle uuid;
  v_dup text;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu.'; end if;

  select sec.ca, sec.truc_ca_user_id, u.khung_mac_dinh, coalesce(u.loai, 'ca') as loai, coalesce(u.phan_ca, false) as phan_ca
    into v_unit
    from public.attendance_sheet_sections sec
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id;
  v_khung_mode := v_unit.khung_mac_dinh;
  v_is_to := v_unit.loai = 'to';
  -- Giao mới cho MỌI ca (tổ phân ca): admin / người chấm công / người lập phiếu / người được phân công tổ đó.
  v_create_all := not v_is_to or v_is_admin
               or public.attendance_can_edit_any_section()
               or v_unit.truc_ca_user_id = v_uid
               or public.attendance_assigned_to(v_sec.factory_id, v_unit.ca);
  v_my_cas := public.attendance_my_ca_codes(v_sec.factory_id);
  if v_unit.phan_ca then
    select coalesce(array_agg(u.code), '{}') || array['CA_NGAY'] into v_ca_valid
      from public.attendance_units u where u.factory_id = v_sec.factory_id and u.loai = 'ca' and u.is_active;
  end if;

  update public.attendance_sheet_sections set
    ghi_chu = nullif(btrim(coalesce(p_header ->> 'ghi_chu', '')), '')
  where id = p_section_id;

  -- Vị trí trưởng / phó: chỉ người giao được mọi ca (tổ) hoặc người sửa phiếu ca.
  if jsonb_typeof(p_header -> 'vi_tri') = 'object' and v_create_all then
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

  -- Bản cũ (lưu = xoá + chèn lại). safeupdate: tạo lại bảng tạm, không DELETE thiếu WHERE.
  drop table if exists _att_old_lines;
  create temp table _att_old_lines on commit drop as
    select * from public.attendance_sheet_lines where section_id = p_section_id;
  select coalesce(jsonb_object_agg(l.id::text, l.giao_luc) filter (where l.giao_luc is not null), '{}'::jsonb)
    into v_old_by_id from _att_old_lines l;

  delete from public.attendance_sheet_lines where section_id = p_section_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
    if v_staff_id is null then continue; end if;
    select ms.id, ms.ten, ms.ngay_vao_lam, ms.ngay_nghi_viec into v_staff
      from public.maintenance_staff ms where ms.id = v_staff_id and ms.factory_id = v_sec.factory_id;
    if not found then raise exception 'Nhân sự không thuộc nhà máy.'; end if;

    v_line_id := coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid());
    v_old := null;
    select o.* into v_old from _att_old_lines o where o.id = v_line_id;

    select coalesce(array_agg(distinct x::uuid), '{}') into v_jobs
      from jsonb_array_elements_text(case when jsonb_typeof(v_line -> 'cong_viec_ids') = 'array' then v_line -> 'cong_viec_ids' else '[]'::jsonb end) x;
    v_vehicle := nullif(v_line ->> 'vehicle_id', '')::uuid;

    v_ca := null;
    if v_unit.phan_ca then
      v_ca := nullif(btrim(coalesce(v_line ->> 'ca_phan_cong', '')), '');
      if v_ca is not null and not (v_ca = any(v_ca_valid)) then raise exception 'Ca của % không hợp lệ (%).', v_staff.ten, v_ca; end if;
    end if;

    v_owner := coalesce(v_old.lap_boi, v_uid);
    v_gui := v_old.gui_luc;
    v_gui_boi := v_old.gui_boi;
    v_chot := coalesce(v_old.chot_ca, false);
    if v_is_to then
      -- Dòng người khác giao / đã khoá ⇒ giữ nguyên bản DB (bỏ qua bản client — tự lưu không kẹt).
      if v_old.id is not null and not public.attendance_line_editable(
           v_old.lap_boi, v_old.gui_luc, v_old.chot_ca, v_old.ca_phan_cong, v_uid, v_my_cas, v_is_admin, v_sec.trang_thai, v_unit.phan_ca) then
        continue;
      end if;
      -- Ca mới / đổi ca: trực ca chỉ trong Ca của mình (trừ người giao được mọi ca).
      if v_unit.phan_ca and v_ca is not null and not v_create_all
         and (v_old.id is null or coalesce(v_old.ca_phan_cong, '') <> v_ca) and not (v_ca = any(v_my_cas)) then
        raise exception 'Bạn chỉ phân công được cho ca mình (%) — chọn đúng ca cho %.', array_to_string(v_my_cas, ', '), v_staff.ten;
      end if;
    end if;

    if (v_staff.ngay_vao_lam is not null and v_sec.ngay < v_staff.ngay_vao_lam)
       or (v_staff.ngay_nghi_viec is not null and v_sec.ngay > v_staff.ngay_nghi_viec) then
      raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_sec.ngay, 'DD/MM/YYYY');
    end if;

    v_bd := null; v_kt := null;
    if v_khung_mode is not null and cardinality(v_jobs) > 0 then
      v_bd := nullif(btrim(coalesce(v_line ->> 'gio_bd', '')), '');
      v_kt := nullif(btrim(coalesce(v_line ->> 'gio_kt', '')), '');
      if (v_bd is not null and v_bd !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
         or (v_kt is not null and v_kt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
        raise exception 'Giờ làm của % phải dạng HH:MM.', v_staff.ten;
      end if;
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

    -- Sửa dòng đã gửi (ngoại lệ tổ phân ca / admin / Trả về) ⇒ về "chưa gửi" để gửi lại.
    if v_old.id is not null and v_gui is not null and (
         v_old.staff_id <> v_staff_id
         or coalesce(v_old.ca_phan_cong, '') <> coalesce(v_ca, '')
         or coalesce(v_old.vehicle_id::text, '') <> coalesce(v_vehicle::text, '')
         or not (v_old.cong_viec_ids @> v_jobs and v_jobs @> v_old.cong_viec_ids)
         or coalesce(v_old.xep_loai, '') <> coalesce(v_xep, '')
         or v_old.diem_danh <> v_diem
         or coalesce(v_old.vang_loai, '') <> coalesce(v_vang, '')
         or coalesce(v_old.ly_do, '') <> coalesce(v_ly_do, '')
         or coalesce(v_old.thay_the_staff_id::text, '') <> coalesce(v_thay_id::text, '')
         or coalesce(v_old.thay_the_ten, '') <> coalesce(v_thay_ten, '')
         or coalesce(v_old.gio_bd, '') <> coalesce(v_bd, '')
         or coalesce(v_old.gio_kt, '') <> coalesce(v_kt, '')) then
      v_gui := null; v_gui_boi := null; v_chot := false;
    end if;

    v_giao := null;
    if cardinality(v_jobs) > 0 then
      v_giao := coalesce((v_old_by_id ->> v_line_id::text)::timestamptz, now());
    end if;

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, cong_viec_ids,
      vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai,
      giao_luc, gio_bd, gio_kt, ca_phan_cong, gui_luc, lap_boi, gui_boi, chot_ca)
    values (
      v_line_id, p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id, v_jobs[1], v_jobs,
      v_vehicle, v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do, v_thay_id, v_thay_ten,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false),
      v_giao, v_bd, v_kt, v_ca, v_gui, v_owner, v_gui_boi, v_chot);
    v_incoming_ids := v_incoming_ids || v_line_id;
    v_count := v_count + 1;
  end loop;

  -- Chèn lại dòng người gọi KHÔNG được sửa mà bản client bỏ / bỏ qua (phiếu tổ).
  if v_is_to then
    insert into public.attendance_sheet_lines
    select o.* from _att_old_lines o
    where not exists (select 1 from public.attendance_sheet_lines n where n.id = o.id)
      and not public.attendance_line_editable(o.lap_boi, o.gui_luc, o.chot_ca, o.ca_phan_cong, v_uid, v_my_cas, v_is_admin, v_sec.trang_thai, v_unit.phan_ca);
  end if;

  -- Khoá trùng: phiếu ca ⇒ 1 dòng / người; tổ phân ca ⇒ (người, ca); tổ khác ⇒ (người, người giao).
  select string_agg(distinct ms.ten, ', ') into v_dup
    from (
      select l.staff_id from public.attendance_sheet_lines l
      where l.section_id = p_section_id
      group by l.staff_id,
        case when not v_is_to then '' when v_unit.phan_ca then coalesce(l.ca_phan_cong, '') else coalesce(l.lap_boi::text, '') end
      having count(*) > 1
    ) d join public.maintenance_staff ms on ms.id = d.staff_id;
  if v_dup is not null then
    raise exception '% có 2 phân công trùng (%).', v_dup,
      case when not v_is_to then 'cùng phiếu' when v_unit.phan_ca then 'cùng ca' else 'cùng người giao' end;
  end if;

  -- Tổ phân ca: người làm cả ngày không có dòng ca khác.
  if v_unit.phan_ca then
    select string_agg(distinct ms.ten, ', ') into v_dup
      from public.attendance_sheet_lines a join public.maintenance_staff ms on ms.id = a.staff_id
      where a.section_id = p_section_id and a.ca_phan_cong = 'CA_NGAY'
        and exists (select 1 from public.attendance_sheet_lines b where b.section_id = p_section_id
                      and b.staff_id = a.staff_id and coalesce(b.ca_phan_cong, '') <> 'CA_NGAY');
    if v_dup is not null then raise exception '% đã làm cả ngày — không phân thêm ca khác.', v_dup; end if;
  end if;

  -- Phiếu tổ đang "Đã gửi" mà có dòng chưa gửi ⇒ "Đang lập" (gửi lại; văn phòng duyệt 1 lần khi đủ).
  if v_is_to and v_sec.trang_thai = 'da_gui' and exists (
       select 1 from public.attendance_sheet_lines l where l.section_id = p_section_id and l.gui_luc is null
         and (l.diem_danh = 'vang' or coalesce(array_length(l.cong_viec_ids, 1), 0) > 0)) then
    update public.attendance_sheet_sections set trang_thai = 'dang_lam' where id = p_section_id;
    perform public.attendance_recompute_sheet(v_sec.sheet_id);
  end if;
  return v_count;
end $$;

-- ── 4. Gửi phiếu con (chép 20261222; phiếu tổ: gửi phần mình, "Đã gửi" khi đủ mọi dòng) ────
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
    and (public.attendance_user_has_permission(p.id, 'attendance.approve')
         or public.attendance_user_has_permission(p.id, 'attendance.mark_all'));
  return 'da_gui';
end $$;

-- ── 5. Admin thu hồi phiếu tổ (chép 20261222 + xoá gui_boi / chot_ca) ─────────
create or replace function public.attendance_recall_section(p_section_id uuid, p_ly_do text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v record;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if not public.current_profile_is_admin() then raise exception 'Chỉ quản trị viên được thu hồi phiếu.'; end if;
  if v_ly_do is null then raise exception 'Thu hồi phải nhập lý do.'; end if;
  select sec.id, sec.sheet_id, sec.factory_id, sec.trang_thai, sec.truc_ca_user_id, coalesce(u.loai, 'ca') as loai,
         coalesce(u.ten, sec.ca) as ten, s.ma_phieu
    into v
    from public.attendance_sheet_sections sec
    join public.attendance_daily_sheets s on s.id = sec.sheet_id
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id for update of sec;
  if not found or v.factory_id is distinct from public.current_profile_factory_id() then raise exception 'Không tìm thấy phiếu.'; end if;
  if v.loai <> 'to' then raise exception 'Chỉ thu hồi phiếu Tổ (phiếu Ca: dùng Trả về / Mở lại).'; end if;
  if v.trang_thai = 'da_duyet' then raise exception 'Phiếu đã duyệt — dùng "Mở lại để sửa".'; end if;
  if not exists (select 1 from public.attendance_sheet_lines where section_id = p_section_id and gui_luc is not null)
     and v.trang_thai <> 'da_gui' then
    raise exception 'Phiếu chưa gửi — không cần thu hồi.';
  end if;

  update public.attendance_sheet_lines set gui_luc = null, gui_boi = null, chot_ca = false where section_id = p_section_id;
  update public.attendance_sheet_sections
    set trang_thai = 'tra_ve', tra_ve_ly_do = 'Admin thu hồi: ' || v_ly_do, tra_ve_luc = now(), tra_ve_boi = v_uid
    where id = p_section_id;
  perform public.attendance_recompute_sheet(v.sheet_id);

  -- Báo mọi người đã giao trong phiếu (giữ chỗ) + người lập phiếu.
  insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
  select v.factory_id, x.uid, 'diem_danh_tra_ve', v.sheet_id, 'attendance_sheet',
         'Phiếu điểm danh được thu hồi để sửa', v.ma_phieu || ' · ' || v.ten || ' — ' || v_ly_do,
         '/dashboard/attendance/shift?section=' || p_section_id
  from (
    select distinct l.lap_boi as uid from public.attendance_sheet_lines l where l.section_id = p_section_id and l.lap_boi is not null
    union select v.truc_ca_user_id
  ) x
  where x.uid is not null and x.uid <> v_uid;
  return 'tra_ve';
end $$;

revoke all on function public.attendance_line_editable(uuid, timestamptz, boolean, text, uuid, text[], boolean, text, boolean) from public, anon;
revoke all on function public.attendance_save_section(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.attendance_submit_section(uuid) from public, anon;
revoke all on function public.attendance_recall_section(uuid, text) from public, anon;
grant execute on function public.attendance_line_editable(uuid, timestamptz, boolean, text, uuid, text[], boolean, text, boolean) to authenticated;
grant execute on function public.attendance_save_section(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attendance_submit_section(uuid) to authenticated;
grant execute on function public.attendance_recall_section(uuid, text) to authenticated;

-- Kiểm chứng:
--   select l.staff_id, l.ca_phan_cong, l.lap_boi, l.gui_luc, l.gui_boi, l.chot_ca from attendance_sheet_lines l
--     join attendance_sheet_sections s on s.id = l.section_id where s.ca in ('CD', 'TN_MT') order by l.staff_id limit 50;
