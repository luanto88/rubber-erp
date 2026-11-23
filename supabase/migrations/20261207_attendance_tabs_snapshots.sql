-- Module Chấm công — sửa sau test GĐ2 (2026-11-23). Bàn giao: .claude/plans/ban-giao-cham-cong-c2-sua-sau-test-gd2.md
--
-- 1. Thẻ nhóm ↔ loại việc: personnel_groups.diem_danh_to_nhom. Thẻ của nhóm chỉ hiện việc đúng tổ đó; thành viên nhóm
--    có thẻ riêng KHÔNG hiện ở thẻ Ca (người dùng chốt 2026-11-23).
-- 2. Nhóm "Tổ tiếp nhận" (code tiep_nhan) cho mọi nhà máy, hiện thẻ ở màn điểm danh.
-- 3. attendance_job_types.an_diem_danh: việc không giao ở màn điểm danh (Trực xuất hàng — chọn ở đơn xuất).
-- 4. Bản cứng F01/F02: bucket private attendance-sheet-reports + bảng bất biến attendance_sheet_snapshots.
-- 5. RPC attendance_reopen_section: CHỈ admin mở lại phiếu ca đã duyệt (lý do bắt buộc) ⇒ phiếu về "Trả về", ngày công
--    lấy từ phiếu đó được tính lại từ các phiếu ca khác đã duyệt cùng ngày (không còn ⇒ xoá ngày công nguồn truc_ca).
--    Bộ duyệt đổi ⇒ bản cứng cũ hết hiệu lực, giữ làm lịch sử.
-- Chạy TAY trên Supabase SQL Editor SAU 20261206, TRƯỚC deploy. Idempotent.

-- ── 1. Thẻ nhóm ↔ loại việc ───────────────────────────────────────────────────
alter table public.personnel_groups add column if not exists diem_danh_to_nhom text;
alter table public.personnel_groups drop constraint if exists personnel_groups_diem_danh_to_nhom_check;
alter table public.personnel_groups add constraint personnel_groups_diem_danh_to_nhom_check
  check (diem_danh_to_nhom is null or diem_danh_to_nhom in ('tiep_nhan', 'co_dien', 'ca_san_xuat'));
comment on column public.personnel_groups.diem_danh_to_nhom is
  'Loại việc của thẻ nhóm ở màn điểm danh (tiep_nhan | co_dien | ca_san_xuat). NULL ⇒ mọi tổ trừ ca sản xuất.';
-- Chỉ code có gạch dưới (dữ liệu cũ có dòng trùng kiểu "co-dien").
update public.personnel_groups set diem_danh_to_nhom = 'co_dien'
  where code in ('co_dien', 'bao_tri') and diem_danh_to_nhom is null;

-- ── 2. Nhóm Tổ tiếp nhận ──────────────────────────────────────────────────────
insert into public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order, hien_diem_danh, diem_danh_to_nhom)
select f.id, 'tiep_nhan', 'Tổ tiếp nhận', 'Thẻ Tổ tiếp nhận ở màn điểm danh ca', true, true, 5, true, 'tiep_nhan'
from public.factories f
where not exists (select 1 from public.personnel_groups g where g.factory_id = f.id and g.code = 'tiep_nhan')
  and not exists (select 1 from public.personnel_groups g where g.factory_id = f.id and lower(g.name) = lower('Tổ tiếp nhận'));
update public.personnel_groups set diem_danh_to_nhom = 'tiep_nhan'
  where code = 'tiep_nhan' and diem_danh_to_nhom is null;

-- ── 3. Việc ẩn ở màn điểm danh ────────────────────────────────────────────────
alter table public.attendance_job_types add column if not exists an_diem_danh boolean not null default false;
comment on column public.attendance_job_types.an_diem_danh is
  'true ⇒ không hiện ở màn điểm danh (vd Trực xuất hàng — chọn người ở đơn xuất), vẫn in phiếu F01/F02.';
update public.attendance_job_types set an_diem_danh = true where btrim(ten) = 'Trực xuất hàng' and not an_diem_danh;

-- ── 4. Bản cứng F01/F02 ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('attendance-sheet-reports', 'attendance-sheet-reports', false)
on conflict (id) do update set public = false;

create table if not exists public.attendance_sheet_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- Không ON DELETE CASCADE: bảng bất biến.
  factory_id uuid not null references public.factories(id),
  sheet_id uuid not null references public.attendance_daily_sheets(id),
  -- Băm của các cặp (section_id, duyet_luc) đã duyệt lúc dựng — đổi khi admin mở lại rồi duyệt lại.
  approval_key text not null,
  storage_path text not null,
  file_name text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  duyet_ten text,
  duyet_luc timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint attendance_sheet_snapshots_path_unique unique (storage_path)
);
create index if not exists idx_attendance_sheet_snapshots_lookup
  on public.attendance_sheet_snapshots (sheet_id, approval_key, created_at desc);

alter table public.attendance_sheet_snapshots enable row level security;
drop policy if exists attendance_sheet_snapshots_select on public.attendance_sheet_snapshots;
create policy attendance_sheet_snapshots_select on public.attendance_sheet_snapshots for select to authenticated
  using (factory_id = public.current_profile_factory_id()
    and (public.attendance_can_shift() or public.attendance_can_review() or public.current_profile_has_permission('attendance.view')));
-- Không policy INSERT/UPDATE/DELETE: chỉ server (service role) ghi.

create or replace function public.attendance_sheet_snapshots_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Bản cứng phiếu điểm danh là bất biến, không được sửa hoặc xoá.';
end $$;
drop trigger if exists trg_attendance_sheet_snapshots_immutable on public.attendance_sheet_snapshots;
create trigger trg_attendance_sheet_snapshots_immutable
  before update or delete on public.attendance_sheet_snapshots
  for each row execute function public.attendance_sheet_snapshots_immutable();

-- ── 5. Admin mở lại phiếu ca đã duyệt ─────────────────────────────────────────
alter table public.attendance_logs drop constraint if exists attendance_logs_hanh_dong_check;
alter table public.attendance_logs add constraint attendance_logs_hanh_dong_check
  check (hanh_dong in ('cham', 'xoa', 'duyet_phieu', 'mo_lai_phieu'));

create or replace function public.attendance_reopen_section(p_section_id uuid, p_ly_do text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_fid uuid := public.current_profile_factory_id();
  v_ly_do text := nullif(btrim(coalesce(p_ly_do, '')), '');
  v_sec record;
  v_sid uuid;
  v_staff uuid[];
  v_old record;
  v_new_status text;
  v_new_xep text;
  v_new_ly_do text;
  v_line_id uuid;
  v_updated int := 0;
  v_deleted int := 0;
  v_label text;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if not public.current_profile_is_admin() then raise exception 'Chỉ quản trị viên được mở lại phiếu đã duyệt.'; end if;
  if v_ly_do is null then raise exception 'Mở lại phiếu phải nhập lý do.'; end if;

  select sec.id, sec.sheet_id, sec.factory_id, sec.loai, sec.ca, sec.trang_thai, sec.truc_ca_user_id, s.ngay, s.ma_phieu
    into v_sec
    from public.attendance_sheet_sections sec join public.attendance_daily_sheets s on s.id = sec.sheet_id
    where sec.id = p_section_id
    for update of sec;
  if not found or v_sec.factory_id is distinct from v_fid then raise exception 'Không tìm thấy phiếu ca.'; end if;
  v_label := v_sec.ma_phieu || ' · ' || public.attendance_section_label(v_sec.loai, v_sec.ca);
  if v_sec.trang_thai <> 'da_duyet' then raise exception '% chưa được duyệt — không cần mở lại.', v_label; end if;

  select coalesce(array_agg(distinct x), '{}') into v_staff from (
    select l.staff_id as x from public.attendance_sheet_lines l where l.section_id = p_section_id
    union
    select l.thay_the_staff_id from public.attendance_sheet_lines l
      where l.section_id = p_section_id and l.diem_danh = 'vang' and l.thay_the_staff_id is not null
  ) t;

  update public.attendance_sheet_sections
    set trang_thai = 'tra_ve', duyet_luc = null, duyet_boi = null,
        tra_ve_ly_do = 'Mở lại sau duyệt: ' || v_ly_do, tra_ve_luc = now(), tra_ve_boi = v_uid
    where id = p_section_id;

  -- Tính lại ngày công từ các phiếu ca KHÁC còn đã duyệt (cùng quy tắc attendance_review_sections, file 20261206).
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

    select id, trang_thai, xep_loai, nguon, sheet_line_id into v_old
      from public.attendance_records
      where factory_id = v_fid and staff_id = v_sid and ngay = v_sec.ngay
      for update;
    -- Chỉ đụng ngày công do phiếu ghi (truc_ca); chấm tay giữ nguyên.
    if not found or v_old.nguon <> 'truc_ca' then continue; end if;

    if v_new_status is null then
      delete from public.attendance_records where id = v_old.id;
      insert into public.attendance_logs (factory_id, staff_id, ngay, hanh_dong, trang_thai_truoc, trang_thai_sau,
        xep_loai_truoc, xep_loai_sau, nguon_truoc, nguon_sau, ly_do, nguoi_thuc_hien_id)
      values (v_fid, v_sid, v_sec.ngay, 'mo_lai_phieu', v_old.trang_thai, null, v_old.xep_loai, null, v_old.nguon, null,
              'Mở lại phiếu ' || v_label || ' — ' || v_ly_do, v_uid);
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
      values (v_fid, v_sid, v_sec.ngay, 'mo_lai_phieu', v_old.trang_thai, v_new_status, v_old.xep_loai, v_new_xep,
              v_old.nguon, 'truc_ca', 'Mở lại phiếu ' || v_label || ' — ' || v_ly_do, v_uid);
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform public.attendance_recompute_sheet(v_sec.sheet_id);

  insert into public.notifications (factory_id, user_id, type, doc_id, doc_type, title, body, link)
  values (v_fid, v_sec.truc_ca_user_id, 'diem_danh_tra_ve', v_sec.sheet_id, 'attendance_sheet',
          'Phiếu điểm danh được mở lại để sửa', v_label || ' — ' || v_ly_do,
          '/dashboard/attendance/shift?section=' || p_section_id);

  return jsonb_build_object('records_updated', v_updated, 'records_deleted', v_deleted);
end $$;

revoke all on function public.attendance_reopen_section(uuid, text) from public, anon;
grant execute on function public.attendance_reopen_section(uuid, text) to authenticated;

-- Kiểm chứng:
--   select code, name, hien_diem_danh, diem_danh_to_nhom from personnel_groups where hien_diem_danh order by sort_order;
--   select day_chuyen, ten, an_diem_danh from attendance_job_types where an_diem_danh;
--   select id, public from storage.buckets where id = 'attendance-sheet-reports';   -- public = false
