-- ============================================================================
-- Chặn huỷ phiếu xuất kho Bảo trì (X-BT-…) từ module Kho (2026-11-17)
-- Chạy tay trên Supabase SQL Editor (sau 20261129). Idempotent.
--
-- Lỗ hổng: người có inventory.cancel (hoặc maintenance.approve) huỷ thẳng phiếu X-BT ở Kho ⇒ tồn được
-- cộng lại nhưng biên bản vẫn "Đã duyệt" (2 bên lệch nhau). Từ nay phiếu X-BT chỉ huỷ được qua biên bản
-- (Hủy biên bản / Hủy sau khi hoàn tất / Xoá biên bản / Thử xuất kho lại) — các thao tác đó chạy ở server
-- bằng service role (inventory_rpc_is_trusted_caller = true) nên không bị chặn.
-- Hàm vỏ chép NGUYÊN từ 20261109_inventory_cancel_negative_guard.sql, chỉ thêm 1 khối kiểm X-BT.
-- ============================================================================

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

    -- MỚI: phiếu xuất kho của biên bản bảo trì chỉ huỷ qua biên bản.
    if coalesce(v_doc.document_code, '') like 'X-BT-%' then
      raise exception 'Phiếu % là phiếu xuất kho của biên bản bảo trì — huỷ tại biên bản (Hủy biên bản / Hủy sau khi hoàn tất), không huỷ ở Kho.',
        v_doc.document_code using errcode = '42501';
    end if;

    if not (
      public.current_profile_is_admin()
      or public.current_profile_has_permission('inventory.cancel')
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
