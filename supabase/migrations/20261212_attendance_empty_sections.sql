-- Chấm công — phiếu ca "trống" + bỏ phiếu ca + dọn việc đã tắt (rule 31, sửa sau test production 2026-11-25). CHẠY TAY sau 20261211.
--
-- Lỗi thật ngày 25/11/2026 (TKSXMT-251126): chỉ Ca B làm việc, nhưng màn điểm danh tự MỞ phiếu Ca A khi trực ca vào màn
-- (Ca A là đơn vị mặc định) và tự lưu vị trí Ca trưởng mặc định ⇒ phiếu Ca A có 1 dòng (ca trưởng "có mặt A").
-- Phiếu ngày chỉ "đủ duyệt" khi MỌI phiếu ca đã duyệt ⇒ không in được dấu duyệt TKSX; người dùng phải gửi Ca A với
-- 21 công nhân "nghỉ có phép" (sai: Ca A nghỉ cả ca, không phải xin phép) + ca trưởng có mặt.
--
-- Sửa:
--  1. Phiếu ca TRỐNG = đang lập (dang_lam) và chưa có dòng nào ⇒ KHÔNG tính vào trạng thái phiếu ngày / dấu duyệt
--     (code: màn điểm danh không tự lưu chỉ vì điền sẵn vị trí / gợi ý; sheet-report-actions bỏ phiếu ca trống).
--  2. RPC attendance_discard_section(section, lý do): "Bỏ phiếu ca" khi Ca/Tổ không làm việc hôm đó.
--     Chưa duyệt ⇒ người lập phiếu, người chấm công (mark / mark_all) hoặc admin. Đã duyệt ⇒ CHỈ admin, lý do bắt buộc,
--     ngày công nguồn truc_ca lấy từ phiếu ca này được tính lại từ phiếu ca đã duyệt khác cùng ngày (như xoá phiếu ngày).
--  3. Xoá hẳn các công việc đã TẮT mà chưa dòng điểm danh / hồ sơ nào dùng (người dùng yêu cầu 2026-11-25).
--
-- Về sau mọi CREATE OR REPLACE attendance_recompute_sheet PHẢI chép từ file này.

-- ── 1. Trạng thái phiếu ngày bỏ qua phiếu ca trống ──────────────────────────
create or replace function public.attendance_recompute_sheet(p_sheet_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_duyet int; v_tra int; v_gui int; v_status text;
begin
  select count(*),
         count(*) filter (where sec.trang_thai = 'da_duyet'),
         count(*) filter (where sec.trang_thai = 'tra_ve'),
         count(*) filter (where sec.trang_thai in ('da_gui', 'da_duyet'))
    into v_total, v_duyet, v_tra, v_gui
    from public.attendance_sheet_sections sec
    where sec.sheet_id = p_sheet_id
      and not (sec.trang_thai = 'dang_lam'
               and not exists (select 1 from public.attendance_sheet_lines l where l.section_id = sec.id));
  v_status := case
    when v_total = 0 then 'dang_lap'
    when v_duyet = v_total then 'da_duyet'
    when v_tra > 0 then 'tra_ve'
    when v_gui = v_total then 'da_gui'
    else 'dang_lap' end;
  update public.attendance_daily_sheets set trang_thai = v_status where id = p_sheet_id and trang_thai is distinct from v_status;
  return v_status;
end $$;
revoke all on function public.attendance_recompute_sheet(uuid) from public, anon, authenticated;

-- ── 2. Bỏ phiếu ca ──────────────────────────────────────────────────────────
create or replace function public.attendance_discard_section(p_section_id uuid, p_ly_do text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fid uuid := public.current_profile_factory_id();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_sec record;
  v_label text;
  v_sid uuid;
  v_staff uuid[] := '{}';
  v_old record;
  v_new_status text;
  v_new_xep text;
  v_new_ly_do text;
  v_line_id uuid;
  v_updated int := 0;
  v_deleted int := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  select sec.id, sec.sheet_id, sec.factory_id, sec.ca, sec.trang_thai, sec.truc_ca_user_id, s.ngay, s.ma_phieu
    into v_sec
    from public.attendance_sheet_sections sec
    join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = p_section_id
    for update of sec;
  if not found or v_sec.factory_id is distinct from v_fid then raise exception 'Không tìm thấy phiếu ca.'; end if;
  select coalesce(u.ten, 'Ca/Tổ ' || v_sec.ca) into v_label
    from (select 1) x left join public.attendance_units u on u.factory_id = v_fid and u.code = v_sec.ca;

  if v_sec.trang_thai = 'da_duyet' then
    if not public.current_profile_is_admin() then raise exception 'Phiếu ca đã duyệt — chỉ quản trị viên được bỏ.'; end if;
    if v_ly_do is null then raise exception 'Bỏ phiếu ca đã duyệt phải nhập lý do.'; end if;
  elsif not (public.current_profile_is_admin() or public.attendance_can_edit_any_section() or v_sec.truc_ca_user_id = v_uid) then
    raise exception 'Bạn không có quyền bỏ phiếu ca này.';
  end if;

  if v_sec.trang_thai = 'da_duyet' then
    select coalesce(array_agg(distinct x), '{}') into v_staff from (
      select l.staff_id as x from public.attendance_sheet_lines l where l.section_id = p_section_id
      union
      select l.thay_the_staff_id from public.attendance_sheet_lines l
        where l.section_id = p_section_id and l.diem_danh = 'vang' and l.thay_the_staff_id is not null
    ) t where x is not null;
  end if;

  delete from public.attendance_sheet_sections where id = p_section_id;

  -- Tính lại ngày công (chỉ khi phiếu ca đã duyệt — chưa duyệt thì chưa ghi ngày công).
  foreach v_sid in array v_staff loop
    v_new_status := null; v_new_xep := null; v_new_ly_do := null; v_line_id := null;
    with src as (
      select l.id, l.diem_danh, l.xep_loai, l.vang_loai, l.ly_do, l.updated_at
      from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      join public.attendance_daily_sheets s on s.id = sec.sheet_id
      where l.staff_id = v_sid and s.ngay = v_sec.ngay and s.factory_id = v_fid and sec.trang_thai = 'da_duyet'
      union all
      select l.id, 'co', 'A', null, null, l.updated_at
      from public.attendance_sheet_lines l
      join public.attendance_sheet_sections sec on sec.id = l.section_id
      join public.attendance_daily_sheets s on s.id = sec.sheet_id
      where l.thay_the_staff_id = v_sid and l.diem_danh = 'vang'
        and s.ngay = v_sec.ngay and s.factory_id = v_fid and sec.trang_thai = 'da_duyet'
    )
    select
      case when bool_or(src.diem_danh = 'co') then 'co_mat'
           when bool_or(src.vang_loai = 'khong_phep') then 'nghi_khong_phep'
           else 'nghi_co_phep' end,
      case when bool_or(src.diem_danh = 'co') then case when bool_or(src.xep_loai = 'B') then 'B' else 'A' end end,
      (array_agg(src.ly_do order by src.updated_at desc) filter (where src.vang_loai = 'khong_phep'))[1],
      (array_agg(src.id order by (src.diem_danh = 'co') desc, src.updated_at desc))[1]
      into v_new_status, v_new_xep, v_new_ly_do, v_line_id
    from src
    having count(*) > 0;

    select id, trang_thai, xep_loai, nguon into v_old
      from public.attendance_records
      where factory_id = v_fid and staff_id = v_sid and ngay = v_sec.ngay
      for update;
    if not found or v_old.nguon <> 'truc_ca' then continue; end if;

    if v_new_status is null then
      delete from public.attendance_records where id = v_old.id;
      insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
        xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
      values (v_fid, v_sid, v_sec.ngay, 'xoa_phieu', v_old.trang_thai, null, v_old.xep_loai, null, v_old.nguon, null,
              'Bỏ phiếu ' || v_label || ' — ' || v_sec.ma_phieu || ' — ' || v_ly_do, v_uid);
      v_deleted := v_deleted + 1;
    else
      if v_new_status <> 'co_mat' then v_new_xep := null; end if;
      if v_new_status <> 'nghi_khong_phep' then v_new_ly_do := null; end if;
      update public.attendance_records
        set trang_thai = v_new_status, xep_loai = v_new_xep, ly_do = v_new_ly_do, dung_phep_thuong = false,
            updated_by = v_uid, sheet_line_id = v_line_id
        where id = v_old.id;
      insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
        xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
      values (v_fid, v_sid, v_sec.ngay, 'xoa_phieu', v_old.trang_thai, v_new_status, v_old.xep_loai, v_new_xep,
              v_old.nguon, 'truc_ca', 'Bỏ phiếu ' || v_label || ' — ' || v_sec.ma_phieu || ' — ' || v_ly_do, v_uid);
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform public.attendance_recompute_sheet(v_sec.sheet_id);
  return jsonb_build_object('records_updated', v_updated, 'records_deleted', v_deleted);
end $$;
revoke all on function public.attendance_discard_section(uuid, text) from public, anon;
grant execute on function public.attendance_discard_section(uuid, text) to authenticated;

-- ── 3. Dọn công việc đã tắt, chưa ai dùng ───────────────────────────────────
delete from public.attendance_job_types j
where j.is_active = false
  and not exists (select 1 from public.attendance_sheet_lines l
                  where l.cong_viec_id = j.id or j.id = any(coalesce(l.cong_viec_ids, '{}')))
  and not exists (select 1 from public.maintenance_staff ms where ms.cong_viec_mac_dinh_id = j.id);

-- ── 4. Tính lại trạng thái mọi phiếu ngày theo quy tắc mới ──────────────────
do $$
declare r record;
begin
  for r in select id from public.attendance_daily_sheets loop
    perform public.attendance_recompute_sheet(r.id);
  end loop;
end $$;

-- Phiếu 25/11/2026 (TKSXMT-251126): admin mở chi tiết phiếu → khối "Ca A" → "Bỏ phiếu ca" (lý do: Ca A không làm việc)
-- ⇒ 21 công nhân Ca A hết "nghỉ có phép", ca trưởng hết "có mặt"; dấu duyệt TKSX tính lại theo các phiếu ca còn lại.
