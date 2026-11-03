-- Vá RLS "Allow all" (USING (true)) của 3 bảng phiếu kho vật tư: inventory_documents,
-- inventory_document_lines, inventory_document_attachments (tạo từ 20260501, đợt vá 20260821-23
-- chưa phủ module kho). Trước migration này: ai cầm anon key — kể cả CHƯA đăng nhập — đọc/ghi
-- được phiếu kho của MỌI nhà máy; trong cùng nhà máy, ai cũng sửa được phiếu NHÁP của người khác
-- (app chỉ chặn ở giao diện — xem rule 13 mục "Sửa / mở / thoát phiếu").
--
-- Sau migration:
--   * Mọi thao tác: chỉ authenticated, đúng factory_id của profile (current_profile_factory_id()).
--   * inventory_documents:
--       INSERT — created_by phải là chính người gọi.
--       UPDATE — phiếu NHÁP chỉ người lập (created_by) hoặc admin; phiếu đã ghi sổ / đã hủy vẫn
--                cập nhật được (Duyệt, RPC inventory_cancel_document) — quyền Duyệt theo chức vụ
--                vẫn kiểm ở app (resolveCanApproveInventory). WITH CHECK chỉ kiểm factory để RPC
--                ghi sổ chuyển draft → posted được.
--       DELETE — chỉ phiếu nháp của mình hoặc admin (app hiện không xoá phiếu).
--   * lines / attachments: đọc theo nhà máy; ghi chỉ khi phiếu cha còn NHÁP và người gọi sửa được
--     phiếu đó (hàm SECURITY DEFINER inventory_doc_draft_editable — tránh policy tra chéo bảng).
--
-- Không ảnh hưởng: luồng chạy service role (Bảo trì tự xuất kho khi ký — maintenance-stock-issuance.ts,
-- Đề nghị mua nhập kho — RPC purchase_receive, maintenance-kt / ext-price).
-- RPC inventory_post_*_document / inventory_cancel_document là SECURITY INVOKER: chạy theo quyền
-- người gọi — ghi sổ nháp của mình / admin OK; SELECT ... FOR UPDATE cũng đi qua policy UPDATE.
-- Phiếu nháp cũ có created_by NULL ⇒ chỉ admin sửa/ghi sổ được (khớp quy tắc app).
--
-- CHƯA phủ: 11 bảng inventory_* còn lại (items, warehouses, balances, movements...) vẫn "Allow all".
--
-- Trước khi chạy, kiểm hiện trạng production:
--   select tablename, policyname, cmd, qual from pg_policies
--   where tablename like 'inventory_document%';
-- Chạy tay trong Supabase SQL Editor. Idempotent — chạy lại an toàn.

-- Cần current_profile_is_admin() (tạo ở 20261028_process_permission_rls.sql) — tạo lại cho chắc.
create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role = 'admin'
  );
$$;

create or replace function public.inventory_doc_draft_editable(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.inventory_documents d
    where d.id = p_document_id
      and d.factory_id = public.current_profile_factory_id()
      and d.status = 'draft'
      and (d.created_by = auth.uid() or public.current_profile_is_admin())
  );
$$;

grant execute on function public.inventory_doc_draft_editable(uuid) to authenticated;

-- ── inventory_documents ─────────────────────────────────────────────────────
drop policy if exists "Allow all" on public.inventory_documents;

drop policy if exists "inventory_documents_select" on public.inventory_documents;
create policy "inventory_documents_select" on public.inventory_documents
  for select to authenticated
  using (factory_id = public.current_profile_factory_id());

drop policy if exists "inventory_documents_insert" on public.inventory_documents;
create policy "inventory_documents_insert" on public.inventory_documents
  for insert to authenticated
  with check (factory_id = public.current_profile_factory_id() and created_by = auth.uid());

drop policy if exists "inventory_documents_update" on public.inventory_documents;
create policy "inventory_documents_update" on public.inventory_documents
  for update to authenticated
  using (
    factory_id = public.current_profile_factory_id()
    and (status <> 'draft' or created_by = auth.uid() or public.current_profile_is_admin())
  )
  with check (factory_id = public.current_profile_factory_id());

drop policy if exists "inventory_documents_delete" on public.inventory_documents;
create policy "inventory_documents_delete" on public.inventory_documents
  for delete to authenticated
  using (
    factory_id = public.current_profile_factory_id()
    and status = 'draft'
    and (created_by = auth.uid() or public.current_profile_is_admin())
  );

-- ── inventory_document_lines ────────────────────────────────────────────────
drop policy if exists "Allow all" on public.inventory_document_lines;

drop policy if exists "inventory_document_lines_select" on public.inventory_document_lines;
create policy "inventory_document_lines_select" on public.inventory_document_lines
  for select to authenticated
  using (factory_id = public.current_profile_factory_id());

drop policy if exists "inventory_document_lines_insert" on public.inventory_document_lines;
create policy "inventory_document_lines_insert" on public.inventory_document_lines
  for insert to authenticated
  with check (
    factory_id = public.current_profile_factory_id()
    and public.inventory_doc_draft_editable(document_id)
  );

drop policy if exists "inventory_document_lines_update" on public.inventory_document_lines;
create policy "inventory_document_lines_update" on public.inventory_document_lines
  for update to authenticated
  using (
    factory_id = public.current_profile_factory_id()
    and public.inventory_doc_draft_editable(document_id)
  )
  with check (
    factory_id = public.current_profile_factory_id()
    and public.inventory_doc_draft_editable(document_id)
  );

drop policy if exists "inventory_document_lines_delete" on public.inventory_document_lines;
create policy "inventory_document_lines_delete" on public.inventory_document_lines
  for delete to authenticated
  using (
    factory_id = public.current_profile_factory_id()
    and public.inventory_doc_draft_editable(document_id)
  );

-- ── inventory_document_attachments ──────────────────────────────────────────
drop policy if exists "Allow all" on public.inventory_document_attachments;

drop policy if exists "inventory_document_attachments_select" on public.inventory_document_attachments;
create policy "inventory_document_attachments_select" on public.inventory_document_attachments
  for select to authenticated
  using (factory_id = public.current_profile_factory_id());

drop policy if exists "inventory_document_attachments_insert" on public.inventory_document_attachments;
create policy "inventory_document_attachments_insert" on public.inventory_document_attachments
  for insert to authenticated
  with check (
    factory_id = public.current_profile_factory_id()
    and public.inventory_doc_draft_editable(document_id)
  );

drop policy if exists "inventory_document_attachments_update" on public.inventory_document_attachments;
create policy "inventory_document_attachments_update" on public.inventory_document_attachments
  for update to authenticated
  using (
    factory_id = public.current_profile_factory_id()
    and public.inventory_doc_draft_editable(document_id)
  )
  with check (factory_id = public.current_profile_factory_id());

drop policy if exists "inventory_document_attachments_delete" on public.inventory_document_attachments;
create policy "inventory_document_attachments_delete" on public.inventory_document_attachments
  for delete to authenticated
  using (
    factory_id = public.current_profile_factory_id()
    and public.inventory_doc_draft_editable(document_id)
  );
