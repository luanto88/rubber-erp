# Chuông thông báo — "Việc cần làm theo module" (2026-07-05)

## Bối cảnh

Chuông thông báo cũ (`src/app/dashboard/layout.tsx`) chỉ hiển thị 1 danh sách phẳng từ bảng `notifications` (chỉ ISO/Văn bản insert vào bảng này), không mobile-friendly, và không phản ánh việc cần làm của các module khác (Xuất hàng, Kho vật tư, Chất lượng...). Đã redesign theo hướng: giữ nguyên hệ thống notification cũ, THÊM MỚI 1 section "Việc cần làm ở [Module]" tính LIVE theo route đang đứng.

## Nguyên tắc kiến trúc đã chốt

1. **Không động vào bảng `notifications`** và các route insert hiện có (`/api/iso/notify`, `/api/iso/forms/notify`, `/api/iso/distribute*`, `/api/documents/notify`, `/api/documents/distribute`) — đây vẫn là push notification thật (persisted, có is_read, kèm Telegram/Email), khác bản chất với "việc cần làm live theo module".
2. **Không cần migration DB** — toàn bộ dữ liệu cần thiết đã có sẵn trong schema hiện tại.
3. **"Việc cần làm theo module" là live-computed**, không persist, không có is_read riêng — tính lại mỗi khi mở chuông / đổi module.
4. **Bố cục hiện/ẩn**: khi module hiện tại có `getModuleTasks()` trả về non-null VÀ có ít nhất 1 item với `count > 0` → CHỈ hiện section "Việc cần làm ở [Module]", ẩn hẳn "Thông báo chung". Khi không (route chưa được hỗ trợ, hoặc module đó hiện không có gì cần xử lý) → hiện "Thông báo chung" (danh sách `notifications`) như cũ. Tránh trường hợp dropdown trống hoàn toàn.

## File `src/app/dashboard/_components/module-tasks.ts`

Export chính: `getModuleTasks(pathname, factoryId, user: SessionUser): Promise<ModuleTaskSummary | null>`.

```ts
type ModuleTaskItem = {
  label: string; count: number; link: string
  // role/tab: chỉ set bởi getKpiTasks() — dùng để module /dashboard/kpi tự nhóm item theo
  // vai trò ("nhan"/"giao") và tính badge số trên từng tab. Các module khác để undefined.
  role?: "nhan" | "giao"
  tab?: "tasks" | "5s" | "templates" | "appeals"
}
type ModuleTaskSummary = { moduleLabel: string; items: ModuleTaskItem[] }
```

Switch theo tiền tố route qua `isUnderRoute(pathname, base)` (khớp `pathname === base` hoặc bắt đầu bằng `${base}/` — **không dùng `startsWith` trần** vì sẽ khớp nhầm route anh em, ví dụ `/dashboard/quality-analytics` là route độc lập ngang hàng `/dashboard/quality`, không phải route con).

### Module đã hỗ trợ

| Route prefix | Hàm | Nguồn logic gốc được mirror |
|---|---|---|
| `/dashboard/iso` | `getIsoTasks` | `src/app/dashboard/iso/my-tasks/page.tsx` (`isMyPendingDoc` cho `iso_documents`, filter tương tự cho `iso_form_instances`) |
| `/dashboard/documents` | `getDocumentsTasks` | `src/app/dashboard/documents/my-tasks/page.tsx` (3 nhánh: `draft/tra_ve` theo `soan_thao_user_id`, `cho_ky_phong_ban` khớp `thu_tu_ky_json[buoc_hien_tai]`, `cho_phe_duyet` theo quyền `documents.phe_duyet`) |
| `/dashboard/export` | `getExportTasks` | `src/app/dashboard/export/page.tsx` (`canApproveOrders` qua `maintenance_staff.chuc_vu_chinh_quyen`, `EXPORT_ORDER_STATUS_PENDING`) + lô rớt hạng dùng chung `getRotHangLotCount` |
| `/dashboard/inventory` | `getInventoryTasks` | `inventory_documents.status='draft'` + `buildEffectiveStockBalances` (tái dùng pure function từ `inventory/_components/inventory-stock.ts`) + công thức `alertRows` ở `inventory/analytics/page.tsx` |
| `/dashboard/quality`, `/dashboard/quality-analytics` | `getQualityTasks` | dùng chung `getRotHangLotCount` |
| `/dashboard/maintenance` | `getMaintenanceTasks` | **2 item**: (1) "Biên bản chờ phê duyệt" — `maintenance_records.trang_thai='cho_duyet'`, gate `maintenance.approve`; (2) "Hồ sơ chờ bạn ký" — qua `GET /api/signing/my-pending?modun=maintenance`, **không gate permission** (xem mục "Hồ sơ ký chờ chính người dùng" bên dưới) |
| `/dashboard/kpi` | `getKpiTasks` | Module lớn, nhiều item (`role`/`tab`) — xem trực tiếp code `getKpiTasks` trong `module-tasks.ts`, không chép lại logic vào rule này vì thay đổi thường xuyên |

Route khác (dispatch, storage, product, warehouse, settings, dashboard, process, notes, warehouse-thành-phẩm, map, eudr, customer-portal...) → `getModuleTasks` trả `null`, fallback "Thông báo chung".

### Helper dùng chung `getRotHangLotCount(factoryId)`

Đếm số lô đang rớt hạng theo đúng logic dedupe-by-`lan` ở `quality/page.tsx` (`dat_hang.endsWith("RH")` hoặc `trang_thai === "khong_dat"` trên kết quả KN **mới nhất** của mỗi lô), nhưng **SCOPE lại chỉ trong `lots.trang_thai IN ('Hoàn thành', 'Xuất hàng')`** — quyết định nghiệp vụ đã chốt với người dùng, khác với trang Chất lượng chính (vốn không giới hạn phạm vi này). Lý do bắt buộc phải giới hạn: quét toàn bộ lịch sử `qc_results` không giới hạn có nguy cơ vượt 1000 dòng theo thời gian, PostgREST sẽ âm thầm cắt bớt kết quả (xem `.claude/rules/04-code-patterns.md`). Vì phạm vi khác nhau, **số đếm "lô rớt hạng" trong chuông sẽ KHÁC** số liệu "Tỷ lệ rớt hạng" ở trang `quality-analytics` — đây là chủ đích, không phải bug lệch số liệu.

`qc_results.lot_id IN (...)` được chunk theo lô 200 ID/lần (đúng convention `04-code-patterns.md`).

### Vì sao viết lại query gọn thay vì import nguyên page component

`quality/page.tsx`, `export/page.tsx` là component hàng nghìn dòng mang theo state/effect/UI không liên quan — import chúng vào Bell sẽ kéo theo side-effect và bundle-size không cần thiết. Cái được tái dùng là CÔNG THỨC/điều kiện nghiệp vụ (đã ghi rõ nguồn ở bảng trên), không phải bản thân file. Riêng phần Kho vật tư, `buildEffectiveStockBalances` (file `inventory/_components/inventory-stock.ts`) là pure function nhỏ, đủ điều kiện để import trực tiếp — xử lý đúng case "dầu dùng chung bồn" (`uses_shared_oil_stock`, xem `.claude/rules/13-inventory-module.md`) mà nếu tự viết lại từ đầu rất dễ bỏ sót.

**Không tái dùng** `loadInventoryAdminData()`/`loadInventorySnapshotData()`/`loadInventoryMovementData()` (dù đã là hàm loader tách riêng, không phải page component) — các hàm này có hành vi fallback-to-mock-data khi lỗi hoặc rỗng (trả về `fallbackItems`, `fallbackStockBalances`... là mảng mẫu hard-code), phù hợp cho trang analytics cần luôn có gì đó để render, nhưng SAI cho một badge thông báo (sẽ hiện số đếm giả từ dữ liệu mẫu nếu Supabase lỗi tạm thời, gây hiểu nhầm nghiêm trọng). `module-tasks.ts` tự viết query trực tiếp, không fallback — lỗi/rỗng thì đơn giản là đếm 0.

## Thay đổi UI Bell — `src/app/dashboard/layout.tsx`

- **Tap target**: nút chuông `h-8 w-8` → `h-10 w-10`.
- **Mobile bottom-sheet**: khi `notifOpen` và `<md`, panel chuyển từ dropdown neo góc sang bottom-sheet full-width (`fixed inset-x-0 bottom-0 rounded-t-2xl`), có backdrop riêng (`fixed inset-0 z-40 bg-black/50 md:hidden`, mirror đúng pattern đã có sẵn cho `mobileNavOpen`) và nút đóng (X) rõ ràng chỉ hiện trên mobile (`md:hidden`). Từ `md:` trở lên giữ nguyên dropdown neo icon (`md:absolute md:right-2 md:top-full md:w-80`).
- **Chiều cao cuộn**: `max-h-80` cố định → `max-h-[65dvh] md:max-h-80` (dùng `dvh` thay `vh` để tránh lỗi tính chiều cao khi thanh địa chỉ trình duyệt mobile ẩn/hiện).
- **Đóng bằng touch**: `handleClickOutside` giờ lắng nghe cả `mousedown` lẫn `touchstart`.
- **Điều hướng SPA**: mọi click vào 1 dòng (cả "Thông báo chung" lẫn "Việc cần làm") đi qua `goToNotification(link)` → `router.push(link)`, không còn `window.location.href` (tránh full page reload).
- **State mới**: `moduleTasks: ModuleTaskSummary | null`, load qua `useEffect` phụ thuộc `moduleRoutePrefix` (= 2 segment đầu của `pathname`, ví dụ `/dashboard/iso`) — **không phụ thuộc `pathname` đầy đủ**, để tránh gọi lại `getModuleTasks` mỗi lần chuyển sub-tab trong cùng 1 module (ví dụ giữa `/dashboard/iso` và `/dashboard/iso/my-tasks`).
- **Hằng số hiển thị**: `hasModuleTasks = !!moduleTasks && moduleTasks.items.some(i => i.count > 0)` quyết định nhánh render (mục "Bố cục hiện/ẩn" ở trên). Item có `count === 0` vẫn hiển thị (disabled, mờ) để giữ ngữ cảnh đầy đủ của module, không bị ẩn riêng lẻ.

## Mở rộng thêm module mới sau này

1. Thêm hàm `get<Module>Tasks(factoryId, user)` trong `module-tasks.ts`, viết query gọn chỉ SELECT cột cần đếm — không import page component.
2. Thêm nhánh trong `getModuleTasks()` dùng `isUnderRoute(pathname, "/dashboard/xxx")`, kiểm tra kỹ có route anh em nào dễ bị khớp nhầm bằng `startsWith` trần không (như case `quality` vs `quality-analytics`).
3. Nếu logic đếm cần quét bảng có khả năng vượt 1000 dòng (lịch sử giao dịch, kết quả kiểm nghiệm...), PHẢI giới hạn phạm vi (theo trạng thái còn "sống"/đang xử lý, không quét toàn bộ lịch sử) hoặc chunk theo batch — không lặp lại rủi ro đã ghi ở `.claude/rules/04-code-patterns.md`.
4. Không tự ý quyết định phạm vi dữ liệu nghiệp vụ mơ hồ (ví dụ "thế nào là lô đang cần xử lý") — hỏi lại người dùng như đã làm với case Xuất hàng/Chất lượng ở trên.

## Cập nhật — module Bảo trì + fix bug mobile chỉ hiển thị 1 dòng

- Đã thêm `getMaintenanceTasks` (xem bảng ở trên). Module KPI (`getKpiTasks`) cũng đã có từ trước nhưng không được ghi vào bảng gốc — đã bổ sung.
- **Bug đã fix**: trên mobile, panel chuông (bottom-sheet) chỉ hiển thị được đúng 1 dòng, gần như không cuộn được dù CSS scroll (`max-h-[65dvh] overflow-y-auto`) hoàn toàn đúng. Nguyên nhân: `<header>` (`layout.tsx`) có class `backdrop-blur-sm` — theo spec CSS, `backdrop-filter` (cùng nhóm `filter`/`transform`/`perspective`/`will-change`/`contain`) khiến phần tử đó trở thành **containing block mới cho mọi hậu duệ `position: fixed`**. Panel chuông dùng `fixed inset-x-0 bottom-0` trên mobile (chỉ override `md:absolute` từ `md:` trở lên) — vì `<header>` là tổ tiên có `backdrop-blur-sm`, `bottom-0`/`inset-x-0` bị tính theo hộp mỏng ~52px của `<header>` thay vì theo viewport, đẩy gần hết nội dung panel ra tọa độ y âm (ngoài màn hình), chỉ còn lọt vào vùng nhìn thấy đúng 1 dòng. Đã fix bằng cách bỏ hẳn `backdrop-blur-sm` khỏi `<header>` — giải quyết dứt điểm, không cần đổi cấu trúc panel (`createPortal`...).
- **Landmine cần nhớ cho code sau này**: KHÔNG thêm `filter`/`backdrop-filter`/`transform`/`perspective`/`will-change`/`contain` vào `<header>` (hoặc bất kỳ ancestor `sticky`/tĩnh nào bao ngoài các overlay `position: fixed` dùng cho mobile bottom-sheet/drawer) — các thuộc tính này âm thầm biến ancestor đó thành containing block cho `fixed`, làm hỏng positioning trên mobile mà desktop (`md:absolute`) không hề lộ ra vì `absolute` dừng containing-block sớm hơn ở ancestor `relative` gần nhất. Nếu thực sự cần hiệu ứng blur/transform trên 1 vùng, đặt nó lệch khỏi cây chứa các overlay `fixed` (hoặc portal overlay ra `document.body`), không đặt chung 1 ancestor.

## Hồ sơ ký chờ chính người dùng — item "Hồ sơ chờ bạn ký" (2026-09-04)

Item thứ 2 của `getMaintenanceTasks`. Khác mọi item chuông khác ở chỗ **không đếm được từ
client**: RLS `nguoi_ky_select` (`20260902_signing_core_tables.sql`) chỉ cho đọc dòng
`user_id = auth.uid()`, trong khi để biết "đã TỚI LƯỢT tôi chưa" phải nhìn được trạng thái của
những người ký TRƯỚC mình. Vì vậy phải đi qua route service-role.

- Route: `GET /api/signing/my-pending?modun=<modun>` — `requireAuthUser` (Bearer), trả
  `{ count, countChoLuot, items[] }` sắp theo `tao_luc` tăng dần.
- **Không tin `factoryId` từ client** — luôn đọc `profiles.factory_id` của chính người gọi
  (mirror `create-request/route.ts`); truyền `factoryId` lệch → 403.
- `toiLuot` tính bằng công thức **mirror đúng guard server trong `signField()`**:
  `!rows.some(r => r.thu_tu < myThuTu && r.trang_thai !== "da_ky")` — không phát minh lại.
- Helper client: `getMySigningPending(modun, fallbackLink)` trong `module-tasks.ts`, dùng
  `getFreshAuthSession()` lấy Bearer. **Lỗi mạng/hết phiên → trả 0, KHÔNG throw** —
  `layout.tsx` bắt `.catch → setModuleTasks(null)` sẽ làm mất luôn item cùng module.
- **Chỉ đếm `toiLuot = true`**, không thêm item "chưa tới lượt": `layout.tsx` ẩn hoàn toàn
  "Thông báo chung" khi có bất kỳ item `count > 0`, nên một item không hành động được sẽ che
  mất chính các thông báo ký số (`doc_type='yeu_cau_ky'`). API vẫn trả `countChoLuot` để dành.
- **Không gate permission** — phạm vi đã tự giới hạn bằng `nguoi_ky.user_id = tôi` ở server;
  thêm gate chỉ tạo tình huống "được chọn làm người ký nhưng chuông không báo". Vì vậy
  `getMaintenanceTasks` **không được `return { items: [] }` sớm** khi thiếu `maintenance.approve`
  (bug cũ đã sửa) — gate đó chỉ áp cho item "Biên bản chờ phê duyệt".
- Tái dùng cho module khác: bỏ `modun` thì trả toàn bộ mọi module. Muốn thêm cho Chất lượng/
  Điều xe chỉ cần gọi `getMySigningPending("quality" | "dispatch", ...)` trong getter tương ứng.

⚠️ **Không đổi gate của item "Biên bản chờ phê duyệt" sang `maintenance.phe_duyet`**: item đó
đếm luồng `cho_duyet → da_duyet` CŨ, đúng ngữ nghĩa `maintenance.approve`.
`maintenance.phe_duyet` là quyền hẹp (mặc định chỉ admin, chỉ để CHỌN ĐƯỢC người ký điện tử —
xem `20260909_maintenance_phe_duyet_permission.sql`); đổi sẽ làm hầu hết manager mất item.
