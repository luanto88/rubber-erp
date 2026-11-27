-- Chấm công A4 (2026-11-27): Tổ cơ điện – bảo trì – xe nâng PHÂN CA + phiếu Tổ không khoá cứng sau khi gửi.
-- Người dùng chốt:
--   * CHỈ đơn vị có attendance_units.phan_ca = true (seed: CD) có trường Ca cho từng dòng (Ca A/B/C hoặc CA_NGAY = cả ngày 24h).
--     1 người làm 2 ca ⇒ 2 dòng (việc riêng từng ca). Tổ khác giữ nguyên giờ làm / giao_luc.
--   * Phiếu TỔ (đơn vị loai = 'to') đã gửi VẪN sửa được: dòng đã gửi (gui_luc) bị KHOÁ việc / ca / xe với mọi người trừ admin;
--     vẫn thêm phân công cho ca sau; trực ca của ca đó ghi vắng / người thay / xếp loại cho dòng ca mình.
--     Sửa nội dung phiếu đang 'da_gui' ⇒ về 'dang_lam', gửi lại ⇒ văn phòng duyệt 1 lần. 'da_duyet' vẫn khoá hẳn.
--   * Tổ trưởng phân trước 1 ngày: phiếu tổ mở được NGÀY MAI. Phiếu Ca sản xuất không đổi.
--   * Admin "Thu hồi" phiếu tổ đã gửi (attendance_recall_section): mở khoá mọi dòng, phiếu về 'tra_ve' kèm lý do.
-- Về sau mọi CREATE OR REPLACE attendance_lock_section_for_edit / attendance_save_section / attendance_submit_section /
-- attendance_open_section PHẢI chép từ file này.
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code A4 (sau 20261221). An toàn chạy lại.
-- 2026-11-27 (sau test bước 1): sửa lỗi "DELETE requires a WHERE clause" (safeupdate) — chạy LẠI CẢ FILE.

-- ── 1. Cột ───────────────────────────────────────────────────────────────────
alter table public.attendance_units add column if not exists phan_ca boolean not null default false;
comment on column public.attendance_units.phan_ca is
  'Tổ phân ca: mỗi dòng điểm danh có Ca (Ca A/B/C hoặc CA_NGAY = cả ngày 24h). Seed: CD.';
update public.attendance_units set phan_ca = true where code = 'CD' and loai = 'to' and not phan_ca;

alter table public.attendance_sheet_lines add column if not exists ca_phan_cong text;
alter table public.attendance_sheet_lines add column if not exists gui_luc timestamptz;
comment on column public.attendance_sheet_lines.ca_phan_cong is
  'Tổ phân ca: mã đơn vị loại ca (A/B/C) hoặc CA_NGAY (cả ngày 24h). NULL ở đơn vị không phân ca.';
comment on column public.attendance_sheet_lines.gui_luc is
  'Lần gửi đầu tiên có dòng này (phiếu tổ). Khác NULL ⇒ khoá việc / ca / xe trừ admin.';

-- Dòng của phiếu tổ đã gửi / đã duyệt từ trước ⇒ coi như đã gửi (khoá đúng như dòng gửi mới).
update public.attendance_sheet_lines l set gui_luc = coalesce(sec.gui_luc, sec.updated_at, now())
  from public.attendance_sheet_sections sec
  join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca and u.loai = 'to'
  where l.section_id = sec.id and l.gui_luc is null and sec.trang_thai in ('da_gui', 'da_duyet');

drop index if exists public.uniq_attendance_sheet_lines_staff;
create unique index if not exists uniq_attendance_sheet_lines_staff_ca
  on public.attendance_sheet_lines (section_id, staff_id, coalesce(ca_phan_cong, ''));

-- ── 2. Quyền theo đơn vị ─────────────────────────────────────────────────────
-- Người gọi được phân công điểm danh đơn vị p_code (đang dùng).
create or replace function public.attendance_assigned_to(p_factory_id uuid, p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.production_shift_assignments a
                 where a.factory_id = p_factory_id and a.ca = p_code and a.assigned_user_id = auth.uid() and a.is_active);
$$;

-- Các Ca (đơn vị loại ca, đang dùng) người gọi được phân công.
create or replace function public.attendance_my_ca_codes(p_factory_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct a.ca), '{}')
    from public.production_shift_assignments a
    join public.attendance_units u on u.factory_id = a.factory_id and u.code = a.ca and u.loai = 'ca' and u.is_active
    where a.factory_id = p_factory_id and a.assigned_user_id = auth.uid() and a.is_active;
$$;

-- ── 3. Kiểm quyền sửa phiếu con (chép 20261205; phiếu tổ đã gửi vẫn sửa được) ─────
create or replace function public.attendance_lock_section_for_edit(p_section_id uuid)
returns table (section_id uuid, sheet_id uuid, factory_id uuid, ngay date, trang_thai text)
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_ok boolean;
begin
  select sec.id, sec.sheet_id, sec.factory_id, sec.trang_thai, sec.truc_ca_user_id, sec.ca, s.ngay,
         coalesce(u.loai, 'ca') as unit_loai, coalesce(u.phan_ca, false) as phan_ca
    into v
    from public.attendance_sheet_sections sec
    join public.attendance_daily_sheets s on s.id = sec.sheet_id
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id
    for update of sec;
  if not found or v.factory_id is distinct from public.current_profile_factory_id() then raise exception 'Không tìm thấy phần điểm danh.'; end if;

  if v.unit_loai = 'to' then
    v_ok := public.attendance_can_edit_any_section()
         or (public.attendance_can_shift() and (
              v.truc_ca_user_id = auth.uid()
              or public.attendance_assigned_to(v.factory_id, v.ca)
              or (v.phan_ca and cardinality(public.attendance_my_ca_codes(v.factory_id)) > 0)));
    if not v_ok then raise exception 'Bạn chưa được phân công điểm danh tổ này — chỉ xem được.'; end if;
    if v.trang_thai = 'da_duyet' then raise exception 'Phiếu đã được duyệt — không sửa được nữa.'; end if;
  else
    if not (public.attendance_can_edit_any_section() or (v.truc_ca_user_id = auth.uid() and public.attendance_can_shift())) then
      raise exception 'Phần này do trực ca khác lập — bạn chỉ xem được.';
    end if;
    if v.trang_thai = 'da_gui' then raise exception 'Phần đã gửi chấm công, đang chờ văn phòng duyệt — không sửa được.'; end if;
    if v.trang_thai = 'da_duyet' then raise exception 'Phần đã được duyệt — không sửa được nữa.'; end if;
  end if;
  return query select v.id, v.sheet_id, v.factory_id, v.ngay, v.trang_thai;
end $$;

-- Dấu vân tay nội dung phiếu (để biết lưu có đổi gì không).
create or replace function public.attendance_section_fingerprint(p_section_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(coalesce((select vi_tri::text from public.attendance_sheet_sections where id = p_section_id), '') || '|' ||
    coalesce((select string_agg(concat_ws('~', l.id, l.staff_id, coalesce(l.ca_phan_cong, ''),
        array_to_string(array(select x::text from unnest(l.cong_viec_ids) x order by 1), ','),
        coalesce(l.vehicle_id::text, ''), coalesce(l.xep_loai, ''), l.diem_danh, coalesce(l.vang_loai, ''),
        coalesce(l.ly_do, ''), coalesce(l.thay_the_staff_id::text, ''), coalesce(l.thay_the_ten, ''),
        coalesce(l.gio_bd, ''), coalesce(l.gio_kt, ''), coalesce(l.ghi_chu, '')), '#' order by l.id)
      from public.attendance_sheet_lines l where l.section_id = p_section_id), ''));
$$;

-- ── 4. Lưu phiếu con (chép 20261220 + ca_phan_cong, khoá dòng đã gửi, phạm vi ca của trực ca) ──
create or replace function public.attendance_save_section(p_section_id uuid, p_header jsonb, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_line jsonb;
  v_staff record;
  v_seen text[] := '{}';
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
  v_old_by_key jsonb;
  v_line_id uuid;
  v_giao timestamptz;
  v_bd text;
  v_kt text;
  v_unit record;
  v_is_admin boolean := public.current_profile_is_admin();
  v_full boolean;
  v_my_cas text[];
  v_ca_valid text[];
  v_ca text;
  v_key text;
  v_old public.attendance_sheet_lines%rowtype;
  v_gui timestamptz;
  v_fp_before text;
  v_incoming_ids uuid[] := '{}';
  v_vehicle uuid;
  v_lock_on boolean;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu.'; end if;

  select sec.ca, sec.truc_ca_user_id, u.khung_mac_dinh, coalesce(u.loai, 'ca') as loai, coalesce(u.phan_ca, false) as phan_ca
    into v_unit
    from public.attendance_sheet_sections sec
    left join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
    where sec.id = p_section_id;
  v_khung_mode := v_unit.khung_mac_dinh;
  -- Khoá dòng đã gửi: chỉ phiếu tổ, không áp khi phiếu đang "Trả về" (văn phòng / admin yêu cầu sửa), admin luôn sửa được.
  v_lock_on := v_unit.loai = 'to' and v_sec.trang_thai <> 'tra_ve' and not v_is_admin;

  -- Phạm vi sửa: v_full = mọi dòng chưa khoá; ngược lại chỉ dòng thuộc Ca mình được phân công (tổ phân ca).
  v_full := v_unit.loai <> 'to'
         or public.attendance_can_edit_any_section()
         or v_unit.truc_ca_user_id = auth.uid()
         or public.attendance_assigned_to(v_sec.factory_id, v_unit.ca);
  v_my_cas := case when v_unit.phan_ca then public.attendance_my_ca_codes(v_sec.factory_id) else '{}' end;
  if v_unit.phan_ca then
    select coalesce(array_agg(u.code), '{}') || array['CA_NGAY'] into v_ca_valid
      from public.attendance_units u where u.factory_id = v_sec.factory_id and u.loai = 'ca' and u.is_active;
  end if;

  v_fp_before := public.attendance_section_fingerprint(p_section_id);

  update public.attendance_sheet_sections set
    ghi_chu = nullif(btrim(coalesce(p_header ->> 'ghi_chu', '')), '')
  where id = p_section_id;

  if jsonb_typeof(p_header -> 'vi_tri') = 'object' and v_full then
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

  -- Bản cũ của mọi dòng (lưu = xoá + chèn lại).
  -- Supabase bật safeupdate ⇒ DELETE không WHERE bị chặn: tạo lại bảng tạm thay vì xoá dữ liệu cũ của nó.
  drop table if exists _att_old_lines;
  create temp table _att_old_lines on commit drop as
    select * from public.attendance_sheet_lines where section_id = p_section_id;

  select coalesce(jsonb_object_agg(l.id::text, l.giao_luc) filter (where l.giao_luc is not null), '{}'::jsonb),
         coalesce(jsonb_object_agg(l.staff_id::text || ':' || coalesce(l.ca_phan_cong, ''), l.giao_luc) filter (where l.giao_luc is not null), '{}'::jsonb)
    into v_old_by_id, v_old_by_key
    from _att_old_lines l;

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

    -- Ca của dòng (tổ phân ca).
    v_ca := null;
    if v_unit.phan_ca then
      v_ca := nullif(btrim(coalesce(v_line ->> 'ca_phan_cong', '')), '');
      if v_ca is not null and not (v_ca = any(v_ca_valid)) then raise exception 'Ca của % không hợp lệ (%).', v_staff.ten, v_ca; end if;
    end if;

    -- Dòng không thuộc phạm vi người gọi ⇒ giữ nguyên bản cũ (bỏ qua bản client).
    if not v_full and not v_is_admin then
      if v_old.id is not null and (v_old.ca_phan_cong is null or not (v_old.ca_phan_cong = any(v_my_cas))) then
        continue;  -- chèn lại bản cũ ở bước cuối
      end if;
      if v_old.id is null and (v_ca is null or not (v_ca = any(v_my_cas))) then
        raise exception 'Bạn chỉ phân công được cho ca mình (%) — chọn đúng ca cho %.', array_to_string(v_my_cas, ', '), v_staff.ten;
      end if;
    end if;

    -- Dòng đã gửi: khoá việc / ca / xe (trừ admin).
    v_gui := v_old.gui_luc;
    if v_old.id is not null and v_old.gui_luc is not null and v_lock_on then
      if v_old.staff_id <> v_staff_id
         or coalesce(v_old.ca_phan_cong, '') <> coalesce(v_ca, '')
         or coalesce(v_old.vehicle_id::text, '') <> coalesce(v_vehicle::text, '')
         or not (v_old.cong_viec_ids @> v_jobs and v_jobs @> v_old.cong_viec_ids) then
        raise exception 'Phân công của % đã gửi nên bị khoá (việc / ca / xe) — liên hệ admin thu hồi để sửa.', v_staff.ten;
      end if;
    end if;

    v_key := v_staff_id::text || ':' || coalesce(v_ca, '');
    if v_key = any(v_seen) then
      raise exception '% có 2 dòng cùng ca trong phiếu.', v_staff.ten;
    end if;
    v_seen := v_seen || v_key;
    if (v_staff.ngay_vao_lam is not null and v_sec.ngay < v_staff.ngay_vao_lam)
       or (v_staff.ngay_nghi_viec is not null and v_sec.ngay > v_staff.ngay_nghi_viec) then
      raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_sec.ngay, 'DD/MM/YYYY');
    end if;

    -- Tổ theo khung: giờ làm của người (HH:MM). Nháp được trống; bắt buộc khi Gửi.
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

    v_giao := null;
    if cardinality(v_jobs) > 0 then
      v_giao := coalesce((v_old_by_id ->> v_line_id::text)::timestamptz, (v_old_by_key ->> v_key)::timestamptz, now());
    end if;

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, cong_viec_ids,
      vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai,
      giao_luc, gio_bd, gio_kt, ca_phan_cong, gui_luc)
    values (
      v_line_id, p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id, v_jobs[1], v_jobs,
      v_vehicle, v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do, v_thay_id, v_thay_ten,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false),
      v_giao, v_bd, v_kt, v_ca, v_gui);
    v_incoming_ids := v_incoming_ids || v_line_id;
    v_count := v_count + 1;
  end loop;

  -- Chèn lại dòng cũ bị bỏ khỏi bản client nhưng không được xoá: dòng đã gửi (trừ admin) hoặc ngoài phạm vi ca của người gọi.
  insert into public.attendance_sheet_lines
  select o.* from _att_old_lines o
  where not (o.id = any(v_incoming_ids))
    and not exists (select 1 from public.attendance_sheet_lines n
                    where n.section_id = p_section_id and n.staff_id = o.staff_id
                      and coalesce(n.ca_phan_cong, '') = coalesce(o.ca_phan_cong, ''))
    and (
      (o.gui_luc is not null and v_lock_on)
      or (not v_full and not v_is_admin and (o.ca_phan_cong is null or not (o.ca_phan_cong = any(v_my_cas))))
    );

  -- Tổ phân ca: người làm cả ngày không có dòng ca khác.
  if v_unit.phan_ca then
    select string_agg(distinct ms.ten, ', ') into v_ly_do
      from public.attendance_sheet_lines a join public.maintenance_staff ms on ms.id = a.staff_id
      where a.section_id = p_section_id and a.ca_phan_cong = 'CA_NGAY'
        and exists (select 1 from public.attendance_sheet_lines b where b.section_id = p_section_id
                      and b.staff_id = a.staff_id and coalesce(b.ca_phan_cong, '') <> 'CA_NGAY');
    if v_ly_do is not null then raise exception '% đã làm cả ngày — không phân thêm ca khác.', v_ly_do; end if;
  end if;

  -- Phiếu tổ đã gửi mà nội dung đổi ⇒ về "Đang lập" để gửi lại (duyệt 1 lần cuối ngày).
  if v_sec.trang_thai = 'da_gui' and public.attendance_section_fingerprint(p_section_id) <> v_fp_before then
    update public.attendance_sheet_sections set trang_thai = 'dang_lam' where id = p_section_id;
    perform public.attendance_recompute_sheet(v_sec.sheet_id);
  end if;
  return v_count;
end $$;

-- ── 5. Gửi phiếu con (chép 20261220 + tổ phân ca bắt buộc ca, đánh dấu gui_luc) ────
create or replace function public.attendance_submit_section(p_section_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_info record;
  v_n int;
  v_missing text;
  v_khung_mode text;
  v_phan_ca boolean;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  select count(*) into v_n from public.attendance_sheet_lines where section_id = p_section_id;
  if v_n = 0 then raise exception 'Phiếu chưa có người nào — giao việc trước khi gửi.'; end if;
  select string_agg(ms.ten, ', ') into v_missing
    from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
    where l.section_id = p_section_id and l.diem_danh = 'vang' and l.vang_loai is null;
  if v_missing is not null then raise exception 'Chọn có phép / không phép cho: %.', v_missing; end if;

  select u.khung_mac_dinh, coalesce(u.phan_ca, false) into v_khung_mode, v_phan_ca
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
        and (l.gio_bd is null or l.gio_kt is null);
    if v_missing is not null then raise exception 'Chưa có giờ làm cho: %.', v_missing; end if;
  end if;
  if v_phan_ca then
    select string_agg(ms.ten, ', ') into v_missing
      from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
      where l.section_id = p_section_id and l.ca_phan_cong is null
        and (l.gui_luc is null or v_sec.trang_thai = 'tra_ve')  -- dòng cũ đã gửi trước A4 (khoá) không chặn gửi lại
        and (l.diem_danh = 'vang' or coalesce(array_length(l.cong_viec_ids, 1), 0) > 0);
    if v_missing is not null then raise exception 'Chưa chọn ca cho: %.', v_missing; end if;
  end if;

  -- Khoá dòng đã gửi CHỈ ở phiếu tổ (phiếu Ca sản xuất đã gửi là khoá cả phiếu như cũ).
  if exists (select 1 from public.attendance_sheet_sections sec
             join public.attendance_units u on u.factory_id = sec.factory_id and u.code = sec.ca
             where sec.id = p_section_id and u.loai = 'to') then
    update public.attendance_sheet_lines set gui_luc = now() where section_id = p_section_id and gui_luc is null;
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

-- ── 6. Mở phiếu con (chép 20261211; tổ mở được ngày mai; trực ca có Ca mở được tổ phân ca) ─────
create or replace function public.attendance_open_section(
  p_factory_id uuid, p_ngay date, p_day_chuyen text, p_loai text, p_ca text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_ca text := nullif(btrim(coalesce(p_ca, '')), '');
  v_unit record;
  v_sheet_id uuid;
  v_section_id uuid;
  v_ca_truong text;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not public.attendance_can_shift() then raise exception 'Bạn không có quyền điểm danh.'; end if;
  if p_day_chuyen not in ('Mủ tạp', 'Mủ nước') then raise exception 'Dây chuyền không hợp lệ.'; end if;
  if coalesce(p_loai, 'ca_san_xuat') <> 'ca_san_xuat' then raise exception 'Phiếu con không hợp lệ.'; end if;
  select u.code, u.ten, u.loai, u.is_active, u.day_chuyen, coalesce(u.phan_ca, false) as phan_ca into v_unit
    from public.attendance_units u where u.factory_id = p_factory_id and u.code = v_ca;
  if not found or not v_unit.is_active then raise exception 'Ca/Tổ không hợp lệ hoặc đã ngừng dùng.'; end if;
  if v_unit.day_chuyen is not null and v_unit.day_chuyen <> p_day_chuyen then
    raise exception '% chỉ thuộc dây chuyền %.', v_unit.ten, v_unit.day_chuyen;
  end if;
  if p_ngay is null then raise exception 'Thiếu ngày điểm danh.'; end if;
  if v_unit.loai = 'to' then
    if p_ngay > v_today + 1 then raise exception 'Tổ chỉ phân công trước 1 ngày (tới ngày mai).'; end if;
  elsif p_ngay > v_today then
    raise exception 'Không điểm danh cho ngày chưa tới.';
  end if;
  if not public.attendance_can_edit_any_section() then
    if p_ngay < v_today - 1 then
      raise exception 'Trực ca chỉ điểm danh hôm nay hoặc hôm qua (ca đêm). Ngày cũ hơn nhờ người chấm công.';
    end if;
    if not public.attendance_assigned_to(p_factory_id, v_ca)
       and not (v_unit.phan_ca and cardinality(public.attendance_my_ca_codes(p_factory_id)) > 0) then
      raise exception 'Bạn chưa được phân công điểm danh %.', v_unit.ten;
    end if;
  end if;

  insert into public.attendance_daily_sheets (factory_id, ngay, day_chuyen, ma_phieu, created_by)
  values (p_factory_id, p_ngay, p_day_chuyen,
          (case when p_day_chuyen = 'Mủ tạp' then 'TKSXMT' else 'TKSXMN' end) || '-' || to_char(p_ngay, 'DDMMYY'), v_uid)
  on conflict (factory_id, ngay, day_chuyen) do nothing;
  select s.id into v_sheet_id from public.attendance_daily_sheets s
    where s.factory_id = p_factory_id and s.ngay = p_ngay and s.day_chuyen = p_day_chuyen;

  select sec.id into v_section_id from public.attendance_sheet_sections sec
    where sec.sheet_id = v_sheet_id and sec.loai = 'ca_san_xuat' and sec.ca = v_ca;
  if v_section_id is not null then return v_section_id; end if;

  if v_unit.loai = 'ca' then
    select n.ca_truong into v_ca_truong from public.production_shift_names n
      where n.factory_id = p_factory_id and n.ca = v_ca and n.hieu_luc_tu <= p_ngay
      order by n.hieu_luc_tu desc limit 1;
  end if;

  insert into public.attendance_sheet_sections (sheet_id, factory_id, loai, ca, ca_truong_ten, truc_ca_user_id, truc_ca_staff_id, ngoai_phan_cong)
  values (v_sheet_id, p_factory_id, 'ca_san_xuat', v_ca, v_ca_truong, v_uid,
          (select ms.id from public.maintenance_staff ms where ms.profile_id = v_uid and ms.factory_id = p_factory_id limit 1),
          false)
  on conflict do nothing
  returning id into v_section_id;
  if v_section_id is null then
    select sec.id into v_section_id from public.attendance_sheet_sections sec
      where sec.sheet_id = v_sheet_id and sec.loai = 'ca_san_xuat' and sec.ca = v_ca;
  end if;
  perform public.attendance_recompute_sheet(v_sheet_id);
  return v_section_id;
end $$;

-- ── 7. Admin thu hồi phiếu tổ đã gửi ─────────────────────────────────────────
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

  update public.attendance_sheet_lines set gui_luc = null where section_id = p_section_id;
  update public.attendance_sheet_sections
    set trang_thai = 'tra_ve', tra_ve_ly_do = 'Admin thu hồi: ' || v_ly_do, tra_ve_luc = now(), tra_ve_boi = v_uid
    where id = p_section_id;
  perform public.attendance_recompute_sheet(v.sheet_id);

  if v.truc_ca_user_id is not null and v.truc_ca_user_id <> v_uid then
    insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
    values (v.factory_id, v.truc_ca_user_id, 'diem_danh_tra_ve', v.sheet_id, 'attendance_sheet',
            'Phiếu điểm danh được thu hồi để sửa', v.ma_phieu || ' · ' || v.ten || ' — ' || v_ly_do,
            '/dashboard/attendance/shift?section=' || p_section_id);
  end if;
  return 'tra_ve';
end $$;

revoke all on function public.attendance_assigned_to(uuid, text) from public, anon;
revoke all on function public.attendance_my_ca_codes(uuid) from public, anon;
revoke all on function public.attendance_section_fingerprint(uuid) from public, anon;
revoke all on function public.attendance_save_section(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.attendance_submit_section(uuid) from public, anon;
revoke all on function public.attendance_recall_section(uuid, text) from public, anon;
grant execute on function public.attendance_assigned_to(uuid, text) to authenticated;
grant execute on function public.attendance_my_ca_codes(uuid) to authenticated;
grant execute on function public.attendance_section_fingerprint(uuid) to authenticated;
grant execute on function public.attendance_save_section(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attendance_submit_section(uuid) to authenticated;
grant execute on function public.attendance_recall_section(uuid, text) to authenticated;

-- Kiểm chứng:
--   select code, ten, loai, phan_ca from attendance_units order by sort_order;
--   select indexname from pg_indexes where tablename = 'attendance_sheet_lines';
