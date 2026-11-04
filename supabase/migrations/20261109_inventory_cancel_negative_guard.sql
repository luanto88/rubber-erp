-- 2026-11-04 — Sửa sau test GĐ B kho vật tư (CHẠY TAY trong Supabase SQL Editor, chạy lại được)
--
-- 1. LỖI NGHIÊM TRỌNG: huỷ phiếu NHẬP (hoặc CHUYỂN) sau khi hàng đã được xuất đi ⇒ tồn âm.
--    Ví dụ thật: nhập TEST_CODE 10 → xuất 1 (tồn 9) → admin huỷ phiếu nhập ⇒ tồn -1.
--    `inventory_cancel_document_core` chỉ cộng/trừ ngược theo phát sinh rồi XOÁ phát sinh, không kiểm
--    tồn; trigger chống âm chỉ chạy khi INSERT phát sinh nên không bắt được.
--    Sửa: hàm vỏ `inventory_cancel_document` gọi `inventory_assert_cancel_keeps_stock` TRƯỚC khi huỷ —
--    khoá các dòng tồn liên quan, tính phần sẽ bị trừ (tồn thường / bồn dầu / tồn lô), tồn sau huỷ < 0
--    ⇒ báo lỗi kèm mã vật tư + kho + số tồn, không huỷ gì. Áp cho MỌI người gọi (kể cả service role).
--    Huỷ phiếu XUẤT luôn cộng lại tồn ⇒ không bao giờ bị chặn.
-- 2. Quyền `inventory.cancel` chưa từng có trong bảng `permissions` ⇒ không tick được ở Cài đặt →
--    Phân quyền, chỉ admin huỷ được. Seed quyền, cấp mặc định cho admin.
-- 3. Lý do huỷ biên bản bảo trì: thêm `ly_do_huy`, `huy_boi`, `huy_luc` vào `maintenance_records`.
--
-- KHÔNG sửa `*_core` (logic ghi sổ / huỷ giữ nguyên).

-- ── 1. Kiểm tồn trước khi huỷ ───────────────────────────────────────────────
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
      raise exception 'Không thể huỷ phiếu %: vật tư % (%) tại kho % hiện chỉ còn %, huỷ phiếu sẽ trừ % ⇒ tồn âm %. Hàng của phiếu này đã được xuất/chuyển đi — hãy huỷ các phiếu xuất/chuyển đã dùng hàng này trước.',
        coalesce(v_code, ''), coalesce(r.item_code, '?'), coalesce(r.item_name, ''),
        coalesce((select w.code from public.inventory_warehouses w where w.id = r.warehouse_id), '?'),
        trim_scale(v_cur), trim_scale(r.giam), trim_scale(v_cur - r.giam);
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
      raise exception 'Không thể huỷ phiếu %: bồn dầu kho % hiện chỉ còn %, huỷ phiếu sẽ trừ % ⇒ tồn âm %. Dầu của phiếu này đã được xuất/chuyển đi — hãy huỷ các phiếu xuất/chuyển đã dùng dầu này trước.',
        coalesce(v_code, ''),
        coalesce((select w.code from public.inventory_warehouses w where w.id = r.warehouse_id), '?'),
        trim_scale(v_cur), trim_scale(r.giam), trim_scale(v_cur - r.giam);
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
      raise exception 'Không thể huỷ phiếu %: lô % của vật tư % tại kho % hiện chỉ còn %, huỷ phiếu sẽ trừ % ⇒ tồn lô âm %. Hãy huỷ các phiếu xuất/chuyển đã dùng lô này trước.',
        coalesce(v_code, ''), r.lot_no, coalesce(r.item_code, '?'),
        coalesce((select w.code from public.inventory_warehouses w where w.id = r.warehouse_id), '?'),
        trim_scale(v_cur), trim_scale(r.giam), trim_scale(v_cur - r.giam);
    end if;
  end loop;
end;
$$;

revoke all on function public.inventory_assert_cancel_keeps_stock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inventory_assert_cancel_keeps_stock(uuid, uuid) to service_role;

-- Hàm vỏ huỷ: giữ nguyên phần kiểm quyền của 20261108, thêm bước kiểm tồn trước khi gọi core.
create or replace function public.inventory_cancel_document(
  p_factory_id uuid, p_document_id uuid, p_cancelled_by uuid, p_cancel_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
begin
  if not public.inventory_rpc_is_trusted_caller() then
    if auth.uid() is null then
      raise exception 'Chưa đăng nhập — không huỷ được phiếu kho.' using errcode = '42501';
    end if;
    if p_factory_id is distinct from public.current_profile_factory_id() then
      raise exception 'Không được huỷ phiếu kho của nhà máy khác.' using errcode = '42501';
    end if;
    if p_cancelled_by is distinct from auth.uid() then
      raise exception 'Người huỷ phải là chính tài khoản đang đăng nhập.' using errcode = '42501';
    end if;

    select d.id, d.document_code
      into v_doc
    from public.inventory_documents d
    where d.id = p_document_id and d.factory_id = p_factory_id;

    if v_doc.id is null then
      raise exception 'Không tìm thấy phiếu kho.' using errcode = '42501';
    end if;

    if not (
      public.current_profile_is_admin()
      or public.current_profile_has_permission('inventory.cancel')
      or (coalesce(v_doc.document_code, '') like 'X-BT-%'
          and public.current_profile_has_permission('maintenance.approve'))
    ) then
      raise exception 'Bạn không có quyền huỷ phiếu kho (cần quyền inventory.cancel).' using errcode = '42501';
    end if;
  end if;

  perform public.inventory_assert_cancel_keeps_stock(p_factory_id, p_document_id);
  perform public.inventory_cancel_document_core(p_factory_id, p_document_id, p_cancelled_by, p_cancel_reason);
end;
$$;

revoke all on function public.inventory_cancel_document(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.inventory_cancel_document(uuid, uuid, uuid, text) to authenticated, service_role;

-- ── 2. Quyền "Kho vật tư · hủy phiếu" ───────────────────────────────────────
insert into public.permissions (code, module_name, action_name)
values ('inventory.cancel', 'inventory', 'cancel')
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_code)
values ('admin', 'inventory.cancel')
on conflict do nothing;

-- ── 3. Lý do huỷ biên bản bảo trì ───────────────────────────────────────────
alter table public.maintenance_records
  add column if not exists ly_do_huy text,
  add column if not exists huy_boi uuid references auth.users(id),
  add column if not exists huy_luc timestamptz;

-- ── Kiểm tra sau khi chạy (chạy riêng) ──────────────────────────────────────
-- Dòng tồn đang ÂM (dữ liệu sai đã phát sinh trước bản vá):
--   select 'tồn' as loai, w.code as kho, i.code as ma_vat_tu, b.on_hand
--   from inventory_stock_balances b join inventory_items i on i.id = b.item_id
--   join inventory_warehouses w on w.id = b.warehouse_id where b.on_hand < 0
--   union all
--   select 'bồn dầu', w.code, null, p.on_hand from inventory_oil_stock_pools p
--   join inventory_warehouses w on w.id = p.warehouse_id where p.on_hand < 0
--   union all
--   select 'lô ' || l.lot_no, w.code, i.code, l.on_hand from inventory_lot_balances l
--   join inventory_items i on i.id = l.item_id join inventory_warehouses w on w.id = l.warehouse_id
--   where l.on_hand < 0;
