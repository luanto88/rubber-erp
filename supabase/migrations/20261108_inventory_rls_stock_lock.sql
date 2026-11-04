-- GĐ B RLS kho vật tư: khoá GHI THẲNG 4 bảng tồn / phát sinh
--   inventory_stock_balances, inventory_lot_balances, inventory_stock_movements, inventory_oil_stock_pools
-- Trước migration (sau GĐ A 20261107): người đã đăng nhập ghi thẳng được tồn của nhà máy mình qua
-- devtools (policy INSERT/UPDATE/DELETE theo factory_id), vì 4 RPC ghi sổ/huỷ là SECURITY INVOKER
-- nên bắt buộc phải mở ghi cho authenticated.
--
-- Cách làm — KHÔNG chép lại thân hàm (tránh chép sai bản production):
--   1. Đổi tên 4 hàm THẬT đang chạy thành *_core (giữ nguyên logic, vẫn SECURITY INVOKER),
--      thu hồi EXECUTE của mọi role ứng dụng ⇒ chỉ gọi được từ bên trong hàm vỏ.
--   2. Tạo hàm vỏ CÙNG TÊN, CÙNG CHỮ KÝ, CÙNG KIỂU TRẢ VỀ, SECURITY DEFINER + search_path = public:
--      kiểm quyền rồi gọi *_core. *_core chạy với quyền chủ hàm (postgres) ⇒ ghi được 4 bảng dù
--      không còn policy ghi. App không phải sửa gì.
--   3. Bỏ policy INSERT/UPDATE/DELETE của 4 bảng (giữ SELECT theo nhà máy của GĐ A).
--
-- Kiểm trong hàm vỏ:
--   * service role (Bảo trì tự xuất kho khi ký — maintenance-stock-issuance.ts; Đề nghị mua nhập kho —
--     RPC purchase_receive gọi lồng; JWT vẫn là service_role) và kết nối DB trực tiếp (SQL Editor):
--     cho qua, giữ hành vi cũ.
--   * người dùng: phải đăng nhập; p_factory_id = nhà máy của profile; p_posted_by / p_cancelled_by
--     phải đúng auth.uid(); phiếu thuộc nhà máy đó và đúng loại.
--       Ghi sổ: phiếu NHÁP do chính mình lập, hoặc admin (khớp RLS 20261106).
--       Huỷ: admin, hoặc quyền inventory.cancel, hoặc phiếu X-BT-% (xuất kho Bảo trì) + maintenance.approve.
-- Trigger trg_inventory_prevent_negative_stock (stock_movements) vẫn chạy như cũ.
--
-- Chạy tay trong Supabase SQL Editor. Idempotent — chạy lại an toàn (đã đổi tên thì bỏ qua bước 1).

-- ── 1. Đổi tên hàm thật thành *_core + kiểm kiểu trả về ─────────────────────
do $$
declare
  v_spec record;
  v_core regprocedure;
  v_result text;
begin
  for v_spec in
    select * from (values
      ('inventory_post_import_document',   '(uuid,uuid,uuid)',      'TABLE(document_id uuid, document_code text, posted_lines integer)'),
      ('inventory_post_export_document',   '(uuid,uuid,uuid)',      'TABLE(document_id uuid, document_code text, posted_lines integer)'),
      ('inventory_post_transfer_document', '(uuid,uuid,uuid)',      'TABLE(document_id uuid, document_code text, posted_lines integer)'),
      ('inventory_cancel_document',        '(uuid,uuid,uuid,text)', 'void')
    ) as t(fn, args, expected)
  loop
    v_core := to_regprocedure('public.' || v_spec.fn || '_core' || v_spec.args);
    if v_core is null then
      if to_regprocedure('public.' || v_spec.fn || v_spec.args) is null then
        raise exception 'Không tìm thấy hàm public.% — dừng migration', v_spec.fn || v_spec.args;
      end if;
      execute format('alter function public.%I%s rename to %I', v_spec.fn, v_spec.args, v_spec.fn || '_core');
      v_core := to_regprocedure('public.' || v_spec.fn || '_core' || v_spec.args);
    end if;

    v_result := pg_get_function_result(v_core);
    if v_result <> v_spec.expected then
      raise exception 'Hàm %_core trả về "%" khác mong đợi "%" — dừng migration, không đổi gì',
        v_spec.fn, v_result, v_spec.expected;
    end if;

    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_core);
  end loop;
end $$;

-- ── 2. Hàm kiểm quyền dùng chung ────────────────────────────────────────────
-- true = gọi từ service role hoặc kết nối DB trực tiếp (không qua PostgREST) ⇒ giữ hành vi cũ.
create or replace function public.inventory_rpc_is_trusted_caller()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role' or session_user <> 'authenticator';
$$;
revoke all on function public.inventory_rpc_is_trusted_caller() from public, anon;
grant execute on function public.inventory_rpc_is_trusted_caller() to authenticated, service_role;

-- Kiểm chung cho 3 hàm ghi sổ. Ném lỗi nếu không được phép.
create or replace function public.inventory_assert_can_post(
  p_factory_id uuid, p_document_id uuid, p_posted_by uuid, p_document_type text
)
returns void
language plpgsql
stable
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

  select d.id, d.status, d.created_by, d.document_type
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
  if v_doc.created_by is distinct from auth.uid() and not public.current_profile_is_admin() then
    raise exception 'Chỉ người lập phiếu hoặc admin mới được ghi sổ phiếu nháp này.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.inventory_assert_can_post(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.inventory_assert_can_post(uuid, uuid, uuid, text) to authenticated, service_role;

-- ── 3. Hàm vỏ cùng tên, cùng chữ ký ─────────────────────────────────────────
create or replace function public.inventory_post_import_document(
  p_factory_id uuid, p_document_id uuid, p_posted_by uuid
)
returns table (document_id uuid, document_code text, posted_lines integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.inventory_assert_can_post(p_factory_id, p_document_id, p_posted_by, 'import');
  return query select * from public.inventory_post_import_document_core(p_factory_id, p_document_id, p_posted_by);
end;
$$;

create or replace function public.inventory_post_export_document(
  p_factory_id uuid, p_document_id uuid, p_posted_by uuid
)
returns table (document_id uuid, document_code text, posted_lines integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.inventory_assert_can_post(p_factory_id, p_document_id, p_posted_by, 'export');
  return query select * from public.inventory_post_export_document_core(p_factory_id, p_document_id, p_posted_by);
end;
$$;

create or replace function public.inventory_post_transfer_document(
  p_factory_id uuid, p_document_id uuid, p_posted_by uuid
)
returns table (document_id uuid, document_code text, posted_lines integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.inventory_assert_can_post(p_factory_id, p_document_id, p_posted_by, 'transfer');
  return query select * from public.inventory_post_transfer_document_core(p_factory_id, p_document_id, p_posted_by);
end;
$$;

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

  perform public.inventory_cancel_document_core(p_factory_id, p_document_id, p_cancelled_by, p_cancel_reason);
end;
$$;

revoke all on function public.inventory_post_import_document(uuid, uuid, uuid) from public, anon;
revoke all on function public.inventory_post_export_document(uuid, uuid, uuid) from public, anon;
revoke all on function public.inventory_post_transfer_document(uuid, uuid, uuid) from public, anon;
revoke all on function public.inventory_cancel_document(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.inventory_post_import_document(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.inventory_post_export_document(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.inventory_post_transfer_document(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.inventory_cancel_document(uuid, uuid, uuid, text) to authenticated, service_role;

-- ── 4. Bỏ policy ghi của 4 bảng tồn (giữ SELECT theo nhà máy) ───────────────
drop policy if exists "inventory_stock_balances_insert" on public.inventory_stock_balances;
drop policy if exists "inventory_stock_balances_update" on public.inventory_stock_balances;
drop policy if exists "inventory_stock_balances_delete" on public.inventory_stock_balances;
drop policy if exists "inventory_lot_balances_insert" on public.inventory_lot_balances;
drop policy if exists "inventory_lot_balances_update" on public.inventory_lot_balances;
drop policy if exists "inventory_lot_balances_delete" on public.inventory_lot_balances;
drop policy if exists "inventory_stock_movements_insert" on public.inventory_stock_movements;
drop policy if exists "inventory_stock_movements_update" on public.inventory_stock_movements;
drop policy if exists "inventory_stock_movements_delete" on public.inventory_stock_movements;
drop policy if exists "inventory_oil_stock_pools_insert" on public.inventory_oil_stock_pools;
drop policy if exists "inventory_oil_stock_pools_update" on public.inventory_oil_stock_pools;
drop policy if exists "inventory_oil_stock_pools_delete" on public.inventory_oil_stock_pools;

-- Kiểm sau khi chạy:
--   select p.oid::regprocedure, p.prosecdef from pg_proc p
--   where p.proname like 'inventory_%document%' order by 1;            -- 4 vỏ DEFINER + 4 *_core INVOKER
--   select tablename, cmd from pg_policies where tablename in ('inventory_stock_balances',
--     'inventory_lot_balances','inventory_stock_movements','inventory_oil_stock_pools');   -- chỉ còn SELECT
