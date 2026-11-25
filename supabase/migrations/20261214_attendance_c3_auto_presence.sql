-- Chấm công C3 — "Có mặt tự động" cho NHÂN VIÊN có tài khoản (rule 31, người dùng chốt 2026-11-25).
-- CHẠY TAY trên Supabase SQL Editor sau 20261213, TRƯỚC deploy. Idempotent.
--
-- Đã chốt:
--   - Chỉ thao tác GHI dữ liệu (tạo / ký / duyệt / ghi sổ) mới tính có mặt; đăng nhập / xem KHÔNG tính.
--   - Được chấm điểm chuyên môn KPI (kpi_daily_evaluations.user_id) ⇒ nguồn 'cham_diem_d' (ưu tiên hơn 'auto_app').
--   - Ngày đã có nguồn cao hơn (truc_ca / bo_sung_tay) ⇒ KHÔNG đổi; nếu đang "Nghỉ" mà có thao tác app ⇒ cờ mâu thuẫn
--     (suy ra: trang_thai <> 'co_mat' AND hoat_dong không rỗng — không lưu cột riêng).
--   - Có mặt tự động KHÔNG có xếp loại A/B (xep_loai NULL).
--   - Chỉ nhân viên (loai_nhan_su = 'nhan_vien', có profile_id). Công nhân không bao giờ có dòng tự động.
--   - Không ghi attendance_logs (dữ liệu suy ra, tính lại được). Dòng tự động mất nguồn (phiếu bị xoá) ⇒ xoá.
--   - Xoá chấm tay 1 ngày có thao tác ⇒ lần đồng bộ sau tự thành Có mặt lại; muốn ghi vắng phải chấm "Nghỉ".
-- Ngày = giờ nhà máy (Asia/Ho_Chi_Minh). Đồng bộ khi mở Lịch công (UI) — không có cron.

-- ── 1. Cột thao tác app phát hiện trong ngày ─────────────────────────────────
alter table public.attendance_records add column if not exists hoat_dong jsonb not null default '[]'::jsonb;
comment on column public.attendance_records.hoat_dong is
  'Thao tác app phát hiện trong ngày: [{"nguon":"san_luong","luc":"…"}] (giờ sớm nhất mỗi nguồn). Do attendance_sync_auto ghi.';

-- ── 2. Gom hoạt động (chỉ đọc) ───────────────────────────────────────────────
-- Trả 1 dòng / (tài khoản, ngày, nguồn) với giờ sớm nhất. Nguồn 'cham_diem_d' = người ĐƯỢC chấm D (theo cột ngay).
create or replace function public.attendance_collect_activity(p_factory_id uuid, p_from date, p_to date)
returns table (profile_id uuid, ngay date, nguon text, luc timestamptz)
language sql stable security definer set search_path = public as $$
  with b as (
    select (p_from::timestamp at time zone 'Asia/Ho_Chi_Minh') as t0,
           ((p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') as t1
  ),
  raw as (
    select x.created_by::uuid as uid, 'dieu_xe'::text as nguon, x.created_at as luc
      from public.dispatch_entries x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.created_by::uuid, 'san_luong', x.created_at
      from public.production_records x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    -- quet_luc (giờ quét thật) luôn <= created_at ⇒ lọc rộng theo created_at rồi lọc lại theo giờ quét.
    select lt.created_by::uuid, 'thanh_pham', coalesce(lt.quet_luc, lt.created_at)
      from public.lot_transactions lt join public.lots l on l.id = lt.lot_id, b
      where l.factory_id = p_factory_id and lt.created_at >= b.t0 and lt.created_at < b.t1 + interval '1 day'
        and coalesce(lt.quet_luc, lt.created_at) >= b.t0 and coalesce(lt.quet_luc, lt.created_at) < b.t1
    union all
    select x.created_by::uuid, 'thanh_pham', x.created_at
      from public.product_confirm_drafts x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.actor_id::uuid, 'thanh_pham', x.created_at
      from public.lot_admin_edits x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.created_by::uuid, 'kiem_nghiem', x.created_at
      from public.qc_results x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.created_by::uuid, 'xuat_hang', x.created_at
      from public.export_orders x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.approved_by::uuid, 'xuat_hang', x.approved_at
      from public.export_orders x, b where x.factory_id = p_factory_id and x.approved_at >= b.t0 and x.approved_at < b.t1
    union all
    select x.created_by::uuid, 'do_nhanh', x.created_at
      from public.quick_measurements x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.created_by::uuid, 'bao_tri', x.created_at
      from public.maintenance_records x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.created_by::uuid, 'kho', x.created_at
      from public.inventory_documents x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.posted_by::uuid, 'kho', x.posted_at
      from public.inventory_documents x, b where x.factory_id = p_factory_id and x.posted_at >= b.t0 and x.posted_at < b.t1
    union all
    select x.approved_by::uuid, 'kho', x.approved_at
      from public.inventory_documents x, b where x.factory_id = p_factory_id and x.approved_at >= b.t0 and x.approved_at < b.t1
    union all
    select x.user_id::uuid, 'de_nghi_mua', x.created_at
      from public.purchase_request_logs x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.user_id::uuid, 'ky_so', x.thoi_diem
      from public.nhat_ky_ky x, b where x.factory_id = p_factory_id and x.thoi_diem >= b.t0 and x.thoi_diem < b.t1
    union all
    select x.user_id::uuid, 'ky_so', x.created_at
      from public.doc_approval_log x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.user_id::uuid, 'iso', x.created_at
      from public.iso_form_instance_logs x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.created_by::uuid, 'ghi_chu', x.created_at
      from public.operation_notes x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.created_by::uuid, 'dong_ho', x.created_at
      from public.tech_norm_meter_readings x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.nguoi_thuc_hien_id::uuid, 'kpi', x.created_at
      from public.kpi_task_logs x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.nguoi_cham_id::uuid, 'kpi', coalesce(x.danh_gia_luc, x.created_at)
      from public.kpi_5s_evaluations x, b
      where x.factory_id = p_factory_id and coalesce(x.danh_gia_luc, x.created_at) >= b.t0 and coalesce(x.danh_gia_luc, x.created_at) < b.t1
    union all
    select x.nguoi_cham_id::uuid, 'kpi', x.created_at
      from public.kpi_daily_evaluations x, b where x.factory_id = p_factory_id and x.created_at >= b.t0 and x.created_at < b.t1
    union all
    select x.truc_ca_user_id::uuid, 'diem_danh', x.bat_dau_luc
      from public.attendance_sheet_sections x, b where x.factory_id = p_factory_id and x.bat_dau_luc >= b.t0 and x.bat_dau_luc < b.t1
  )
  select r.uid, (r.luc at time zone 'Asia/Ho_Chi_Minh')::date, r.nguon, min(r.luc)
    from raw r where r.uid is not null and r.luc is not null
    group by 1, 2, 3
  union all
  -- Được chấm điểm chuyên môn D: ngày theo cột ngay (ngày được chấm), giờ = lúc chấm đầu tiên.
  select e.user_id::uuid, e.ngay, 'cham_diem_d', min(e.created_at)
    from public.kpi_daily_evaluations e
    where e.factory_id = p_factory_id and e.ngay between p_from and p_to and e.user_id is not null
    group by 1, 2;
$$;

-- ── 3. Đồng bộ ngày công tự động ─────────────────────────────────────────────
create or replace function public.attendance_sync_auto(p_factory_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_to date := least(p_to, v_today);
  v_them integer := 0;
  v_cap_nhat integer := 0;
  v_xoa integer := 0;
begin
  if v_uid is null then raise exception 'Chưa đăng nhập.'; end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then raise exception 'Sai nhà máy.'; end if;
  if not (public.current_profile_is_admin() or public.current_profile_has_permission('attendance.view')) then
    raise exception 'Không có quyền xem chấm công.';
  end if;
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

revoke all on function public.attendance_collect_activity(uuid, date, date) from public, anon, authenticated;
grant execute on function public.attendance_collect_activity(uuid, date, date) to service_role;
revoke all on function public.attendance_sync_auto(uuid, date, date) from public, anon;
grant execute on function public.attendance_sync_auto(uuid, date, date) to authenticated, service_role;
