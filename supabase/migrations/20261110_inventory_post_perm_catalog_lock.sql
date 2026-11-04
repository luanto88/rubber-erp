-- 2026-11-04 — Kho vật tư: bắt buộc quyền ghi sổ + khoá ghi danh mục theo quyền + thông báo hủy nêu phiếu đang giữ hàng.
-- CHẠY TAY trong Supabase SQL Editor, TRƯỚC khi deploy code. Chạy lại được. Không sửa `*_core`.
--
-- 1. `inventory.post` (Kho vật tư · ghi sổ) trước đây có trong Cài đặt nhưng không được kiểm ⇒ chỉ cần quyền tạo là ghi sổ
--    được. Từ nay ghi sổ cần admin hoặc `inventory.post`. Người có quyền ghi sổ ghi sổ được phiếu NHÁP của bất kỳ ai trong
--    nhà máy (thủ kho ghi sổ phiếu nhân viên lập); người chỉ có quyền tạo chỉ lưu nháp. Service role vẫn cho qua.
--    ⚠️ Trước khi chạy: xem câu SQL cuối file — tick "ghi sổ" cho người đang ghi sổ hằng ngày.
-- 2. Hủy phiếu bị chặn vì tồn âm: thông báo nêu thêm tối đa 5 phiếu đang ghi sổ có phát sinh xuất/chuyển đi của cùng
--    kho + vật tư (bồn dầu / lô), mới nhất trước — người dùng biết phải hủy phiếu nào trước.
-- 3. Ghi danh mục (theo nhà máy như 20261107, thêm điều kiện quyền):
--      inventory_warehouses                     : mọi thao tác ghi = settings.manage_config
--      inventory_item_categories / inventory_items / inventory_item_warehouse_rules
--                                               : INSERT = settings.manage_config | inventory.create (thêm nhanh trên phiếu nhập)
--                                                 UPDATE / DELETE = settings.manage_config
--      inventory_alert_thresholds               : mọi thao tác ghi = inventory.settings | settings.manage_config
--    `current_profile_has_permission` đã trả true cho admin. Route service role (api/purchase/items,
--    api/maintenance/external-items) không bị ảnh hưởng.

-- ── 1. Ghi sổ cần quyền inventory.post ──────────────────────────────────────
create or replace function public.inventory_assert_can_post(
  p_factory_id uuid, p_document_id uuid, p_posted_by uuid, p_document_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
begin
  if public.inventory_rpc_is_trusted_caller() then
    return;
  end if;
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập — không ghi sổ được phiếu kho.' using errcode = '42501';
  end if;
  if p_factory_id is distinct from public.current_profile_factory_id() then
    raise exception 'Không được ghi sổ phiếu kho của nhà máy khác.' using errcode = '42501';
  end if;
  if p_posted_by is distinct from auth.uid() then
    raise exception 'Người ghi sổ phải là chính tài khoản đang đăng nhập.' using errcode = '42501';
  end if;
  if not (public.current_profile_is_admin() or public.current_profile_has_permission('inventory.post')) then
    raise exception 'Bạn không có quyền ghi sổ phiếu kho (cần quyền "Kho vật tư · ghi sổ"). Hãy lưu nháp để người có quyền ghi sổ.'
      using errcode = '42501';
  end if;

  select d.id, d.status, d.document_type
    into v_doc
  from public.inventory_documents d
  where d.id = p_document_id and d.factory_id = p_factory_id;

  if v_doc.id is null then
    raise exception 'Không tìm thấy phiếu kho.' using errcode = '42501';
  end if;
  if v_doc.document_type is distinct from p_document_type then
    raise exception 'Phiếu kho không đúng loại để ghi sổ.' using errcode = '42501';
  end if;
  if v_doc.status is distinct from 'draft' then
    raise exception 'Chỉ ghi sổ được phiếu đang ở trạng thái nháp.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.inventory_assert_can_post(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.inventory_assert_can_post(uuid, uuid, uuid, text) to authenticated, service_role;

-- ── 2. Phiếu đang giữ hàng (dùng trong thông báo hủy) ───────────────────────
-- p_item_id NULL = bồn dầu (mọi mã dầu dùng chung bồn của kho); p_lot_no khác NULL = đúng lô.
create or replace function public.inventory_holding_docs_text(
  p_factory_id uuid, p_exclude_document_id uuid, p_warehouse_id uuid, p_item_id uuid,
  p_lot_no text, p_expiry_date date, p_oil_pool boolean
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(string_agg(x.label, ', ' order by x.created_at desc), '')
  from (
    select d.document_code || ' (' || trim_scale(sum(m.quantity_out)) || ')' as label,
           max(m.created_at) as created_at
    from public.inventory_stock_movements m
    join public.inventory_documents d on d.id = m.document_id and d.status = 'posted'
    left join public.inventory_items i on i.id = m.item_id and i.factory_id = m.factory_id
    where m.factory_id = p_factory_id
      and m.document_id <> p_exclude_document_id
      and m.warehouse_id = p_warehouse_id
      and m.quantity_out > 0
      and (
        (p_oil_pool and coalesce(i.uses_shared_oil_stock, false))
        or (not p_oil_pool and m.item_id = p_item_id
            and (p_lot_no is null or (m.lot_no = p_lot_no and m.expiry_date is not distinct from p_expiry_date)))
      )
    group by d.id, d.document_code
    order by max(m.created_at) desc
    limit 5
  ) x;
$$;
revoke all on function public.inventory_holding_docs_text(uuid, uuid, uuid, uuid, text, date, boolean) from public, anon, authenticated;
grant execute on function public.inventory_holding_docs_text(uuid, uuid, uuid, uuid, text, date, boolean) to service_role;

create or replace function public.inventory_assert_cancel_keeps_stock(p_factory_id uuid, p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_code text;
  v_cur numeric;
  v_hold text;
begin
  select d.document_code into v_code
  from public.inventory_documents d
  where d.id = p_document_id and d.factory_id = p_factory_id;

  -- Khoá trước các dòng tồn sẽ bị đụng tới (chống 2 lượt huỷ cùng lúc cùng vượt qua kiểm tra).
  perform 1 from public.inventory_stock_balances b
  where b.factory_id = p_factory_id
    and (b.warehouse_id, b.item_id) in (
      select m.warehouse_id, m.item_id from public.inventory_stock_movements m
      where m.document_id = p_document_id and m.factory_id = p_factory_id)
  for update;
  perform 1 from public.inventory_oil_stock_pools p
  where p.factory_id = p_factory_id
    and p.warehouse_id in (
      select m.warehouse_id from public.inventory_stock_movements m
      where m.document_id = p_document_id and m.factory_id = p_factory_id)
  for update;
  perform 1 from public.inventory_lot_balances l
  where l.factory_id = p_factory_id
    and (l.warehouse_id, l.item_id) in (
      select m.warehouse_id, m.item_id from public.inventory_stock_movements m
      where m.document_id = p_document_id and m.factory_id = p_factory_id and m.lot_no is not null)
  for update;

  -- (a) Tồn thường theo kho + vật tư (vật tư KHÔNG dùng chung bồn).
  for r in
    select m.warehouse_id, m.item_id,
           sum(m.quantity_in - m.quantity_out) as giam,
           max(i.code) as item_code, max(i.name) as item_name
    from public.inventory_stock_movements m
    left join public.inventory_items i on i.id = m.item_id and i.factory_id = m.factory_id
    where m.document_id = p_document_id and m.factory_id = p_factory_id
      and not coalesce(i.uses_shared_oil_stock, false)
    group by m.warehouse_id, m.item_id
    having sum(m.quantity_in - m.quantity_out) > 0
  loop
    select b.on_hand into v_cur from public.inventory_stock_balances b
    where b.factory_id = p_factory_id and b.warehouse_id = r.warehouse_id and b.item_id = r.item_id;
    v_cur := coalesce(v_cur, 0);
    if v_cur - r.giam < 0 then
      v_hold := public.inventory_holding_docs_text(p_factory_id, p_document_id, r.warehouse_id, r.item_id, null, null, false);
      raise exception 'Không thể huỷ phiếu %: vật tư % (%) tại kho % hiện chỉ còn %, huỷ phiếu sẽ trừ % ⇒ tồn âm %. Hàng của phiếu này đã được xuất/chuyển đi%. Hãy huỷ các phiếu đó trước.',
        coalesce(v_code, ''), coalesce(r.item_code, '?'), coalesce(r.item_name, ''),
        coalesce((select w.code from public.inventory_warehouses w where w.id = r.warehouse_id), '?'),
        trim_scale(v_cur), trim_scale(r.giam), trim_scale(v_cur - r.giam),
        case when v_hold <> '' then ' — các phiếu đang giữ hàng: ' || v_hold else '' end;
    end if;
  end loop;

  -- (b) Bồn dầu dùng chung theo kho (gộp mọi mã dầu của phiếu).
  for r in
    select m.warehouse_id, sum(m.quantity_in - m.quantity_out) as giam
    from public.inventory_stock_movements m
    join public.inventory_items i on i.id = m.item_id and i.factory_id = m.factory_id
    where m.document_id = p_document_id and m.factory_id = p_factory_id
      and coalesce(i.uses_shared_oil_stock, false)
    group by m.warehouse_id
    having sum(m.quantity_in - m.quantity_out) > 0
  loop
    select p.on_hand into v_cur from public.inventory_oil_stock_pools p
    where p.factory_id = p_factory_id and p.warehouse_id = r.warehouse_id;
    v_cur := coalesce(v_cur, 0);
    if v_cur - r.giam < 0 then
      v_hold := public.inventory_holding_docs_text(p_factory_id, p_document_id, r.warehouse_id, null, null, null, true);
      raise exception 'Không thể huỷ phiếu %: bồn dầu kho % hiện chỉ còn %, huỷ phiếu sẽ trừ % ⇒ tồn âm %. Dầu của phiếu này đã được xuất/chuyển đi%. Hãy huỷ các phiếu đó trước.',
        coalesce(v_code, ''),
        coalesce((select w.code from public.inventory_warehouses w where w.id = r.warehouse_id), '?'),
        trim_scale(v_cur), trim_scale(r.giam), trim_scale(v_cur - r.giam),
        case when v_hold <> '' then ' — các phiếu đang giữ dầu: ' || v_hold else '' end;
    end if;
  end loop;

  -- (c) Tồn theo lô.
  for r in
    select m.warehouse_id, m.item_id, m.lot_no, m.expiry_date,
           sum(m.quantity_in - m.quantity_out) as giam,
           max(i.code) as item_code
    from public.inventory_stock_movements m
    left join public.inventory_items i on i.id = m.item_id and i.factory_id = m.factory_id
    where m.document_id = p_document_id and m.factory_id = p_factory_id and m.lot_no is not null
    group by m.warehouse_id, m.item_id, m.lot_no, m.expiry_date
    having sum(m.quantity_in - m.quantity_out) > 0
  loop
    select l.on_hand into v_cur from public.inventory_lot_balances l
    where l.factory_id = p_factory_id and l.warehouse_id = r.warehouse_id and l.item_id = r.item_id
      and l.lot_no = r.lot_no and l.expiry_date is not distinct from r.expiry_date;
    v_cur := coalesce(v_cur, 0);
    if v_cur - r.giam < 0 then
      v_hold := public.inventory_holding_docs_text(p_factory_id, p_document_id, r.warehouse_id, r.item_id, r.lot_no, r.expiry_date, false);
      raise exception 'Không thể huỷ phiếu %: lô % của vật tư % tại kho % hiện chỉ còn %, huỷ phiếu sẽ trừ % ⇒ tồn lô âm %. Lô này đã được xuất/chuyển đi%. Hãy huỷ các phiếu đó trước.',
        coalesce(v_code, ''), r.lot_no, coalesce(r.item_code, '?'),
        coalesce((select w.code from public.inventory_warehouses w where w.id = r.warehouse_id), '?'),
        trim_scale(v_cur), trim_scale(r.giam), trim_scale(v_cur - r.giam),
        case when v_hold <> '' then ' — các phiếu đang giữ lô: ' || v_hold else '' end;
    end if;
  end loop;
end;
$$;
revoke all on function public.inventory_assert_cancel_keeps_stock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inventory_assert_cancel_keeps_stock(uuid, uuid) to service_role;

-- ── 3. Khoá ghi danh mục theo quyền ─────────────────────────────────────────
do $$
declare
  t text;
  v_insert text;
  v_change text;
  v_factory constant text := 'factory_id = public.current_profile_factory_id()';
  v_manage constant text := 'public.current_profile_has_permission(''settings.manage_config'')';
begin
  foreach t in array array[
    'inventory_warehouses', 'inventory_item_categories', 'inventory_items',
    'inventory_item_warehouse_rules', 'inventory_alert_thresholds'
  ] loop
    if t = 'inventory_warehouses' then
      v_insert := v_manage;
      v_change := v_manage;
    elsif t = 'inventory_alert_thresholds' then
      v_insert := '(' || v_manage || ' or public.current_profile_has_permission(''inventory.settings''))';
      v_change := v_insert;
    else
      v_insert := '(' || v_manage || ' or public.current_profile_has_permission(''inventory.create''))';
      v_change := v_manage;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s and %s)',
      t || '_insert', t, v_factory, v_insert);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (%s and %s) with check (%s and %s)',
      t || '_update', t, v_factory, v_change, v_factory, v_change);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (%s and %s)',
      t || '_delete', t, v_factory, v_change);
  end loop;
end $$;

-- ── Kiểm tra ────────────────────────────────────────────────────────────────
-- (A) TRƯỚC khi chạy: người đang có quyền tạo phiếu kho nhưng CHƯA có quyền ghi sổ (sau migration sẽ không ghi sổ được):
--   with u as (
--     select p.id, p.full_name, p.username, p.role,
--            exists(select 1 from user_permissions x where x.user_id = p.id and x.granted) as has_explicit
--     from profiles p where p.status = 'active' and p.role <> 'admin'
--   ),
--   eff as (
--     select u.*, c.code,
--            case when u.has_explicit
--                 then exists(select 1 from user_permissions x where x.user_id = u.id and x.granted and x.permission_code = c.code)
--                 else exists(select 1 from role_permissions r where r.role = u.role and r.permission_code = c.code) end as ok
--     from u cross join (values ('inventory.create'), ('inventory.post')) c(code)
--   )
--   select full_name, username, role
--   from eff group by id, full_name, username, role
--   having bool_or(code = 'inventory.create' and ok) and not bool_or(code = 'inventory.post' and ok)
--   order by full_name;
--
-- (B) Sau khi chạy: 15 policy ghi của 5 bảng danh mục có điều kiện quyền
--   select tablename, policyname, cmd, coalesce(qual, with_check) from pg_policies
--   where tablename in ('inventory_warehouses','inventory_item_categories','inventory_items',
--                       'inventory_item_warehouse_rules','inventory_alert_thresholds')
--   order by 1, 3;
