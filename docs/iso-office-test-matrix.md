# ISO Office Review/Inactivation Test Matrix

## Scope

Cases below cover the bugs reported for:

- child/main `DOCX` footer status not updating on review/approval
- old reviewed documents/records becoming `het_hieu_luc`
- preserving the rule that review attachments must not have footer stamping

## Matrix

| ID | Scenario | Source artifact | Action | Expected result |
| --- | --- | --- | --- | --- |
| DOCX-01 | Child/main DOCX has standard tags in header and footer | `DOCX` | `gui_xem_xet` | `{{TINH_TRANG}}` in header and footer becomes `Chờ xem xét`; other tags still filled |
| DOCX-02 | Same artifact from `DOCX-01` is signed again on latest artifact | `DOCX` latest signed artifact | `phe_duyet` | Footer text changes from `Chờ xem xét` to `Có hiệu lực`; header status also becomes `Có hiệu lực`; no fallback from template gốc |
| DOCX-03 | Footer status is literal text, not tag, and may be split across Word runs | `DOCX` | `phe_duyet` | Literal footer status is replaced correctly on latest artifact |
| DOCX-04 | Header contains `Ngày hiệu lực:` literal text | `DOCX` old effective document | inactivation after review approval | Header/footer text becomes `Ngày hết hiệu lực: dd/mm/yyyy` |
| DOCX-05 | Old reviewed document is Office main file stored in `file_signed_office_url` | `DOCX` | inactivation after review approval | A new invalidated Office artifact is generated from the latest artifact and saved back to the latest-office column |
| DOCX-06 | Old reviewed child Office document stores latest artifact in `file_goc_url` | `DOCX` child/main | inactivation after review approval | Invalidated Office artifact is generated and written back without losing child workflow behavior |
| XLSX-01 | Main/child XLSX contains `{{TINH_TRANG}}` and `{{NGAY_HIEU_LUC}}` | `XLSX` | `phe_duyet` | Cells update to `Có hiệu lực`; signer names remain `Times New Roman` size `12` |
| XLSX-02 | Old reviewed XLSX becomes invalid | `XLSX` | inactivation after review approval | `Ngày hiệu lực` becomes `Ngày hết hiệu lực`; `Tình trạng` becomes `Hết hiệu lực` |
| PDF-01 | Old reviewed PDF becomes invalid | `PDF` | inactivation after review approval | Existing footer/header metadata is replaced to `Hết hiệu lực`; red invalid watermark/stamp appears in header area |
| PDF-02 | Main PDF path is signed URL, signed path, or raw storage key | `PDF` | inactivation after review approval | Route resolves storage path robustly and updates file successfully |
| AUX-01 | `Phiếu yêu cầu thay đổi` PDF exists on reviewed doc | review attachment `PDF` | inactivation after review approval | Footer/header are not stamped or altered |
| AUX-02 | `Đề nghị soát xét` Office file exists on reviewed doc | review attachment `DOCX/XLSX` | approval or inactivation | Tags may be filled by normal signing flow, but invalidation flow does not touch footer/header outside allowed tag replacement |
| FLOW-01 | Parent review batch invalidates old parent + old child records | mixed `PDF/DOCX/XLSX` | `phe_duyet` on new batch | All matching old effective records move to `het_hieu_luc`; every old artifact is updated according to its real file type |
| FLOW-02 | Invalidation job fails for one old artifact | mixed | `phe_duyet` on new batch | Failure is surfaced in response/logs instead of being silently swallowed |
| REG-01 | Non-review normal draft/approval flow | mixed | `gui_xem_xet`, `gui_phe_duyet`, `phe_duyet` | Existing signing behavior for current document remains unchanged |

## Known Bugs Covered Before Fix

- `generate-office` is not reliably replacing footer status on latest `DOCX` artifact when the footer already contains literal text from the previous step.
- The invalidation flow only calls `restamp-pdf`, so old `DOCX/XLSX` files are never reopened and updated to `Hết hiệu lực`.
- `restamp-pdf` currently touches review attachments, which conflicts with the ISO rules.
- The invalidation flow is fire-and-forget from the UI, so failures are easy to miss.
