ALTER TABLE public.maintenance_records
ADD COLUMN IF NOT EXISTS inventory_issue_doc_ids UUID[];

UPDATE public.maintenance_records
SET inventory_issue_doc_ids = ARRAY[inventory_issue_doc_id]
WHERE inventory_issue_doc_id IS NOT NULL
  AND (inventory_issue_doc_ids IS NULL OR array_length(inventory_issue_doc_ids, 1) IS NULL);
