-- Module Chấm công — GĐ C2 làm lại "lưới ô người" (2026-11-22). Kế hoạch:
-- C:\Users\Software\.claude\plans\pasted-content-id-e8fb-test-elegant-lighthouse-of-e10e4a32-e35b-4700-a249-6ee9ab730ab6.md
--
-- 1. Mô hình: 1 phiếu / CA (attendance_sheet_sections.loai = 'ca_san_xuat' + ca) cho mỗi (ngày, dây chuyền). Mục 1, 2 của
--    F01/F02 gom theo TỔ của công việc đã giao.
-- 2. Dòng: NHIỀU việc / người (cong_viec_ids); người VẮNG có thể có người thay (thay_the_staff_id hoặc tên gõ tay
--    thay_the_ten — tên gõ tay KHÔNG tạo nhân sự, không ghi ngày công). Lúc nháp người vắng chưa cần chọn có / không phép.
-- 3. maintenance_staff: vai trò trong tổ (tổ trưởng / tổ phó) + phạm vi (tổ tiếp nhận / cơ điện – nâng hàng / ca SX).
-- 4. personnel_groups.hien_diem_danh: nhóm hiện thành THẺ trên lưới điểm danh (Cơ điện, Bảo trì).
-- 5. export_orders.nguoi_xuat_hang_ids: người trực xuất hàng (nhóm xuat_hang) — in dòng "Trực xuất hàng" F01/F02.
-- 6. RPC lưu / gửi / duyệt theo dòng mới; attendance_close_shift ghi giờ kết thúc ca từ "Kết thúc ca" màn quét Thành phẩm.
-- 7. Xoá phiếu test C2 (chưa có ngày công nào duyệt từ phiếu).
-- Chạy TAY trên Supabase SQL Editor SAU 20261205, TRƯỚC deploy. Idempotent.
-- Về sau mọi CREATE OR REPLACE attendance_save_section / submit_section / review_sections PHẢI chép từ file này.

-- ── 7. Dọn phiếu test C2 (chỉ phiếu KHÔNG có ngày công nào trỏ tới) ─────────────
delete from public.attendance_daily_sheets s
where not exists (
  select 1 from public.attendance_records r
  join public.attendance_sheet_lines l on l.id = r.sheet_line_id
  where l.sheet_id = s.id
);

-- ── 2. Dòng điểm danh ─────────────────────────────────────────────────────────
alter table public.attendance_sheet_lines
  add column if not exists cong_viec_ids uuid[] not null default '{}',
  add column if not exists thay_the_staff_id uuid references public.maintenance_staff(id) on delete set null,
  add column if not exists thay_the_ten text;
alter table public.attendance_sheet_lines drop constraint if exists attendance_sheet_lines_diem_danh;
alter table public.attendance_sheet_lines add constraint attendance_sheet_lines_diem_danh check (
  (diem_danh = 'co' and vang_loai is null and xep_loai is not null and thay_the_staff_id is null and thay_the_ten is null)
  or (diem_danh = 'vang' and xep_loai is null)
);
create index if not exists idx_attendance_sheet_lines_thay_the on public.attendance_sheet_lines (thay_the_staff_id);
comment on column public.attendance_sheet_lines.cong_viec_ids is 'Các việc của người này (dòng vắng: việc người thay làm). cong_viec_id = phần tử đầu (tương thích).';
comment on column public.attendance_sheet_lines.thay_the_ten is 'Người thay gõ tay (không có trong Nhân sự) — chỉ in phiếu, không ghi ngày công.';

-- ── 3. Vai trò trong tổ ────────────────────────────────────────────────────────
alter table public.maintenance_staff
  add column if not exists to_vai_tro text check (to_vai_tro in ('to_truong', 'to_pho')),
  add column if not exists to_pham_vi text check (to_pham_vi in ('tiep_nhan', 'co_dien', 'ca_san_xuat'));
comment on column public.maintenance_staff.to_vai_tro is 'Tổ trưởng / tổ phó trên phiếu F01/F02. Ca SX: theo ca_mac_dinh. Trống ⇒ không in dòng.';

-- ── 4. Thẻ nhóm trên lưới điểm danh ───────────────────────────────────────────
alter table public.personnel_groups add column if not exists hien_diem_danh boolean not null default false;
update public.personnel_groups set hien_diem_danh = true where code in ('co_dien', 'bao_tri') and not hien_diem_danh;

-- ── 5. Người trực xuất hàng trên đơn xuất ─────────────────────────────────────
alter table public.export_orders add column if not exists nguoi_xuat_hang_ids uuid[] not null default '{}';

-- ── 6. RPC ────────────────────────────────────────────────────────────────────
-- Lưu phiếu ca (header + toàn bộ dòng). p_lines: [{id, stt, staff_id, cong_viec_ids[], vehicle_id, xep_loai, diem_danh,
--   vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai}]
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
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'Dữ liệu dòng không hợp lệ.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 300 then raise exception 'Tối đa 300 người mỗi phiếu ca.'; end if;

  update public.attendance_sheet_sections set
    ghi_chu = nullif(btrim(coalesce(p_header ->> 'ghi_chu', '')), '')
  where id = p_section_id;

  delete from public.attendance_sheet_lines where section_id = p_section_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_staff_id := nullif(v_line ->> 'staff_id', '')::uuid;
    if v_staff_id is null then continue; end if;
    select ms.id, ms.ten, ms.ngay_vao_lam, ms.ngay_nghi_viec into v_staff
      from public.maintenance_staff ms where ms.id = v_staff_id and ms.factory_id = v_sec.factory_id;
    if not found then raise exception 'Nhân sự không thuộc nhà máy.'; end if;
    if v_staff_id = any(v_seen) then raise exception '% có 2 dòng trong cùng phiếu ca.', v_staff.ten; end if;
    v_seen := v_seen || v_staff_id;
    if (v_staff.ngay_vao_lam is not null and v_sec.ngay < v_staff.ngay_vao_lam)
       or (v_staff.ngay_nghi_viec is not null and v_sec.ngay > v_staff.ngay_nghi_viec) then
      raise exception '% không làm việc ngày % (ngoài khoảng ngày vào làm – nghỉ việc).', v_staff.ten, to_char(v_sec.ngay, 'DD/MM/YYYY');
    end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into v_jobs
      from jsonb_array_elements_text(case when jsonb_typeof(v_line -> 'cong_viec_ids') = 'array' then v_line -> 'cong_viec_ids' else '[]'::jsonb end) x;
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

    insert into public.attendance_sheet_lines (id, section_id, sheet_id, factory_id, stt, staff_id, cong_viec_id, cong_viec_ids,
      vehicle_id, xep_loai, diem_danh, vang_loai, ly_do_id, ly_do, thay_the_staff_id, thay_the_ten, ghi_chu, la_them_ngoai)
    values (
      coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid()), p_section_id, v_sec.sheet_id, v_sec.factory_id,
      coalesce((v_line ->> 'stt')::int, v_count + 1), v_staff_id, v_jobs[1], v_jobs,
      nullif(v_line ->> 'vehicle_id', '')::uuid, v_xep, v_diem, v_vang, v_ly_do_id, v_ly_do, v_thay_id, v_thay_ten,
      nullif(btrim(coalesce(v_line ->> 'ghi_chu', '')), ''),
      coalesce((v_line ->> 'la_them_ngoai')::boolean, false));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Gửi phiếu ca cho văn phòng duyệt. Mọi người vắng phải đã chọn có / không phép.
create or replace function public.attendance_submit_section(p_section_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sec record;
  v_info record;
  v_n int;
  v_missing text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  select * into v_sec from public.attendance_lock_section_for_edit(p_section_id);
  select count(*) into v_n from public.attendance_sheet_lines where section_id = p_section_id;
  if v_n = 0 then raise exception 'Phiếu chưa có người nào — giao việc trước khi gửi.'; end if;
  select string_agg(ms.ten, ', ') into v_missing
    from public.attendance_sheet_lines l join public.maintenance_staff ms on ms.id = l.staff_id
    where l.section_id = p_section_id and l.diem_danh = 'vang' and l.vang_loai is null;
  if v_missing is not null then raise exception 'Chọn có phép / không phép cho: %.', v_missing; end if;
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

-- Duyệt / trả về phiếu ca. Duyệt ⇒ ngày công nguồn truc_ca gộp MỌI dòng đã duyệt cùng (người, ngày):
--   dòng của chính người đó (có mặt / vắng) + các dòng người vắng mà người đó là NGƯỜI THAY (= có mặt, A).
--   Có mặt nếu có mặt ≥ 1 nơi; xếp B nếu bất kỳ nơi nào B; vắng mọi nơi ⇒ không phép nếu có nơi không phép.
--   Không đè bo_sung_tay. Người thay gõ tay (không có staff_id) không ghi ngày công.
create or replace function public.attendance_review_sections(p_section_ids uuid[], p_hanh_dong text, p_ly_do text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fid uuid := public.current_profile_factory_id();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_sec record;
  v_pair record;
  v_old record;
  v_new_status text;
  v_new_xep text;
  v_new_ly_do text;
  v_line_id uuid;
  v_sections int := 0;
  v_records int := 0;
  v_skipped int := 0;
  v_sheet_ids uuid[] := '{}';
  v_pairs_staff uuid[] := '{}';
  v_pairs_ngay date[] := '{}';
  v_label text;
  i int;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if not public.attendance_can_review() then raise exception 'Bạn không có quyền duyệt phiếu điểm danh.'; end if;
  if p_hanh_dong not in ('duyet', 'tra_ve') then raise exception 'Thao tác không hợp lệ.'; end if;
  if p_hanh_dong = 'tra_ve' and v_ly_do is null then raise exception 'Trả về phải nhập lý do.'; end if;
  if coalesce(array_length(p_section_ids, 1), 0) = 0 then return jsonb_build_object('sections', 0); end if;

  for v_sec in
    select sec.id, sec.sheet_id, sec.factory_id, sec.loai, sec.ca, sec.trang_thai, sec.truc_ca_user_id, s.ngay, s.ma_phieu, s.day_chuyen
    from public.attendance_sheet_sections sec join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = any(p_section_ids)
    for update of sec
  loop
    if v_sec.factory_id is distinct from v_fid then raise exception 'Sai nhà máy.'; end if;
    v_label := v_sec.ma_phieu || ' · ' || public.attendance_section_label(v_sec.loai, v_sec.ca);
    if v_sec.trang_thai <> 'da_gui' then raise exception '% không ở trạng thái chờ duyệt.', v_label; end if;
    if p_hanh_dong = 'tra_ve' then
      update public.attendance_sheet_sections
        set trang_thai = 'tra_ve', tra_ve_ly_do = v_ly_do, tra_ve_luc = now(), tra_ve_boi = v_uid
        where id = v_sec.id;
      insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
      values (v_sec.factory_id, v_sec.truc_ca_user_id, 'diem_danh_tra_ve', v_sec.sheet_id, 'attendance_sheet',
              'Phiếu điểm danh bị trả về', v_label || ' — ' || v_ly_do,
              '/dashboard/attendance/shift?section=' || v_sec.id);
    else
      update public.attendance_sheet_sections set trang_thai = 'da_duyet', duyet_luc = now(), duyet_boi = v_uid where id = v_sec.id;
      for v_pair in
        select l.staff_id as sid from public.attendance_sheet_lines l where l.section_id = v_sec.id
        union
        select l.thay_the_staff_id from public.attendance_sheet_lines l
          where l.section_id = v_sec.id and l.diem_danh = 'vang' and l.thay_the_staff_id is not null
      loop
        v_pairs_staff := v_pairs_staff || v_pair.sid;
        v_pairs_ngay := v_pairs_ngay || v_sec.ngay;
      end loop;
    end if;
    if not v_sec.sheet_id = any(v_sheet_ids) then v_sheet_ids := v_sheet_ids || v_sec.sheet_id; end if;
    v_sections := v_sections + 1;
  end loop;

  for i in 1 .. coalesce(array_length(v_pairs_staff, 1), 0) loop
    with src as (
      select l.id, l.diem_danh, l.xep_loai, l.vang_loai, l.ly_do, l.updated_at
      from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      join public.attendance_daily_sheets s on s.id = sec.sheet_id
      where l.staff_id = v_pairs_staff[i] and s.ngay = v_pairs_ngay[i] and s.factory_id = v_fid and sec.trang_thai = 'da_duyet'
      union all
      select l.id, 'co', 'A', null, null, l.updated_at
      from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      join public.attendance_daily_sheets s on s.id = sec.sheet_id
      where l.thay_the_staff_id = v_pairs_staff[i] and l.diem_danh = 'vang'
        and s.ngay = v_pairs_ngay[i] and s.factory_id = v_fid and sec.trang_thai = 'da_duyet'
    )
    select
      case when bool_or(src.diem_danh = 'co') then 'co_mat'
           when bool_or(src.vang_loai = 'khong_phep') then 'nghi_khong_phep'
           else 'nghi_co_phep' end,
      case when bool_or(src.diem_danh = 'co') then case when bool_or(src.xep_loai = 'B') then 'B' else 'A' end end,
      (array_agg(src.ly_do order by src.updated_at desc) filter (where src.vang_loai = 'khong_phep'))[1],
      (array_agg(src.id order by (src.diem_danh = 'co') desc, src.updated_at desc))[1]
      into v_new_status, v_new_xep, v_new_ly_do, v_line_id
    from src;
    if v_new_status is null then continue; end if;
    if v_new_status <> 'co_mat' then v_new_xep := null; end if;
    if v_new_status <> 'nghi_khong_phep' then v_new_ly_do := null; end if;

    select trang_thai, xep_loai, nguon, sheet_line_id into v_old
      from public.attendance_records
      where factory_id = v_fid and staff_id = v_pairs_staff[i] and ngay = v_pairs_ngay[i]
      for update;
    if found and v_old.nguon = 'bo_sung_tay' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.attendance_records (factory_id, staff_id, ngay, trang_thai, nguon, xep_loai, ly_do, updated_by, sheet_line_id)
    values (v_fid, v_pairs_staff[i], v_pairs_ngay[i], v_new_status, 'truc_ca', v_new_xep, v_new_ly_do, v_uid, v_line_id)
    on conflict (factory_id, staff_id, ngay) do update
      set trang_thai = excluded.trang_thai, nguon = excluded.nguon, xep_loai = excluded.xep_loai,
          ly_do = excluded.ly_do, dung_phep_thuong = false, updated_by = excluded.updated_by,
          sheet_line_id = excluded.sheet_line_id;
    insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
      xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
    values (v_fid, v_pairs_staff[i], v_pairs_ngay[i], 'duyet_phieu',
            v_old.trang_thai, v_new_status, v_old.xep_loai, v_new_xep, v_old.nguon, 'truc_ca',
            'Duyệt phiếu điểm danh' || coalesce(' — ' || v_ly_do, ''), v_uid);
    v_records := v_records + 1;
  end loop;

  for i in 1 .. coalesce(array_length(v_sheet_ids, 1), 0) loop
    perform public.attendance_recompute_sheet(v_sheet_ids[i]);
  end loop;
  return jsonb_build_object('sections', v_sections, 'records', v_records, 'skipped_manual', v_skipped);
end $$;

-- Giờ kết thúc ca = lúc bấm "Kết thúc ca" ở màn quét Thành phẩm. Ghi cho phiếu ca (mọi dây chuyền) của (ngày, ca).
-- Ghi cả khi phiếu đã gửi / duyệt (chỉ là mốc giờ). Trả về số phiếu ca đã ghi.
create or replace function public.attendance_close_shift(p_factory_id uuid, p_ngay date, p_ca text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not (public.attendance_can_shift()
          or public.current_profile_has_permission('product.confirm_scan')
          or public.current_profile_has_permission('product.create')) then
    raise exception 'Bạn không có quyền kết thúc ca.';
  end if;
  update public.attendance_sheet_sections sec set ket_thuc_luc = now()
    from public.attendance_daily_sheets s
    where s.id = sec.sheet_id and s.factory_id = p_factory_id and s.ngay = p_ngay
      and sec.loai = 'ca_san_xuat' and sec.ca = p_ca;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.attendance_save_section(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.attendance_submit_section(uuid) from public, anon;
revoke all on function public.attendance_review_sections(uuid[], text, text) from public, anon;
revoke all on function public.attendance_close_shift(uuid, date, text) from public, anon;
grant execute on function public.attendance_save_section(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.attendance_submit_section(uuid) to authenticated;
grant execute on function public.attendance_review_sections(uuid[], text, text) to authenticated;
grant execute on function public.attendance_close_shift(uuid, date, text) to authenticated;
