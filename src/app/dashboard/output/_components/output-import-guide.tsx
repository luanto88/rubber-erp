"use client"

import { BookOpen, FileSpreadsheet, Layers, RefreshCcw, ShieldAlert, Tag, Truck, Upload } from "lucide-react"
import { InspectorCard } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { OutputWarnBadge } from "./output-badges"
import { FxToExcelIcon } from "./output-converter-view"
import { BLOCKING_WARN_CODES, WARN_LABELS, type WarnCode } from "./output-types"

// Tab "Hướng dẫn import" — mô tả ĐÚNG hành vi code hiện tại (output-import.tsx,
// output-converter-view.tsx, writeBackToDispatch). Đổi logic import thì cập nhật cả trang này.

const SL_MAU_COLUMNS: [string, string][] = [
  ["A", "Ngày (dd/mm/yyyy hoặc ô ngày của Excel)"],
  ["B", "Đội lớn 1–12. Thu mua: ghi \"TM\", 0 hoặc để trống"],
  ["C", "Số xe — xem cách ghi chuyến bên dưới"],
  ["D–F", "Mủ nước: Tươi / DRC% / Khô"],
  ["G–I", "Mủ chén: Tươi / DRC% / Khô"],
  ["J–L", "Mủ đông chén: Tươi / DRC% / Khô"],
  ["M–O", "Mủ đông khối: Tươi / DRC% / Khô"],
  ["P–R", "Mủ dây: Tươi / DRC% / Khô"],
  ["S", "Ký hiệu KT (ghi chú) — phải có trong danh mục"],
]

const VEHICLE_EXAMPLES: [string, string][] = [
  ["1A", "Xe 1A, chuyến 1"],
  ["1A2", "Xe 1A, chuyến 2"],
  ["TM1", "Xe TM1, chuyến 1"],
  ["TM12", "Xe TM1, chuyến 2 (nếu Điều xe ngày đó có xe TM1)"],
  ["3A1064", "Biển số đầy đủ — giữ nguyên, không tách chuyến"],
]

export function OutputImportGuide({
  canImport,
  canUseConverter,
  onStartImport,
  onOpenConverter,
}: {
  canImport: boolean
  canUseConverter: boolean
  onStartImport: () => void
  onOpenConverter: () => void
}) {
  const warnCodes = Object.keys(WARN_LABELS) as WarnCode[]
  return (
    <div className="space-y-4 text-sm text-slate-700">
      <InspectorCard title="Hai cách đưa sản lượng vào hệ thống" icon={BookOpen}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 font-bold text-slate-800">
              <Upload size={16} className="text-mod-600" /> Import file (theo mẫu)
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
              <li>Dùng file Excel đã soạn theo mẫu <b>sl_mau</b> (19 cột A–S) hoặc file <b>SLRpt</b> tổng hợp ngày.</li>
              <li>Hệ thống tự nhận ra loại mẫu, đối chiếu Điều xe, xem trước rồi mới lưu.</li>
              <li>Quyền: <b>Import sản lượng</b> (hoặc admin).</li>
            </ul>
            {canImport && (
              <button
                type="button"
                onClick={onStartImport}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
              >
                <Upload size={15} /> Bắt đầu import
              </button>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 font-bold text-slate-800">
              <FxToExcelIcon className="h-4 w-8 text-mod-600" /> Hỗ trợ kỹ thuật (file gốc)
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
              <li>Upload thẳng <b>file gốc</b> từ trạm cân: phiếu SLRpt từng đội (.xlsx/.xls) hoặc PDF.</li>
              <li>Tự bóc tách, ghép chuyến với Điều xe; dòng chưa khớp có công cụ sửa: tách 2 chuyến, gán chuyến, hoặc lưu không qua Điều xe.</li>
              <li>Xuất được file Excel đối chiếu trước khi lưu.</li>
              <li>Quyền: <b>Hỗ trợ kỹ thuật sản lượng</b> + (Import hoặc Thêm sản lượng).</li>
            </ul>
            {canUseConverter && (
              <button
                type="button"
                onClick={onOpenConverter}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                <FxToExcelIcon className="h-4 w-8" /> Mở Hỗ trợ kỹ thuật
              </button>
            )}
          </div>
        </div>
      </InspectorCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <InspectorCard title="Mẫu sl_mau — 19 cột A–S" icon={FileSpreadsheet}>
          <p className="mb-2 text-slate-600">2 dòng đầu là tiêu đề, dữ liệu bắt đầu từ dòng 3. Cột Khô để 0 thì tự tính = Tươi × DRC%.</p>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {SL_MAU_COLUMNS.map(([col, desc]) => (
                <tr key={col}>
                  <td className="w-14 py-1.5 font-mono font-bold text-slate-800">{col}</td>
                  <td className="py-1.5 text-slate-600">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </InspectorCard>

        <InspectorCard title="Cách ghi số xe và chuyến" icon={Truck}>
          <p className="mb-2 text-slate-600">
            Số chuyến ghi dính ngay sau số xe (1 chữ số). Hệ thống tra <b>Điều xe của đúng ngày</b> để tách cho đúng:
            mã có sẵn trong Điều xe thì giữ nguyên; bỏ chữ số cuối mà ra xe có trong Điều xe thì chữ số đó là chuyến.
          </p>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {VEHICLE_EXAMPLES.map(([code, desc]) => (
                <tr key={code}>
                  <td className="w-20 py-1.5 font-mono font-bold text-slate-800">{code}</td>
                  <td className="py-1.5 text-slate-600">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Ở bảng xem trước, dòng đã tách có chú thích nhỏ &quot;file ghi TM12&quot; dưới số xe.
          </p>
        </InspectorCard>

        <InspectorCard title="Mẫu SLRpt (Sản lượng ngày tổng hợp)" icon={Layers}>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Tự nhận diện khi dòng tiêu đề là <b>STT | Đội | Số xe | Ngày</b>; cột U là Ký hiệu KT.</li>
            <li>File không có cột Chuyến: các dòng cùng ngày + xe + đội được ghép <b>lần lượt theo thứ tự dòng</b> vào các chuyến Điều xe của xe đó có điểm giao nhận thuộc đội (bảng xem trước ghi &quot;tự ghép&quot;).</li>
            <li>Thu mua (đội 0): ghép lần lượt vào mọi chuyến của xe trong ngày.</li>
            <li>Nếu số xe ghi kèm chuyến (vd TM12) thì dùng đúng chuyến đó.</li>
            <li>Dòng &quot;Tổng cộng&quot; cuối file được bỏ qua.</li>
          </ul>
        </InspectorCard>

        <InspectorCard title="Ký hiệu KT (ghi chú) và Nguồn" icon={Tag}>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Ký hiệu KT bắt buộc thuộc danh mục <b>Cài đặt → Danh mục → Ghi chú bắt buộc</b>; để trống vẫn hợp lệ.</li>
            <li>Ghi chú lạ bị chặn. Ở bước xem trước có 3 cách: chọn lại ở từng dòng, <b>Thêm vào danh mục</b> cho cả nhóm, hoặc <b>Nhập phần hợp lệ</b> (bỏ các dòng lỗi).</li>
            <li><b>Thu mua</b>: đội 0 (hoặc ghi chú TM) → nguồn Thu mua; ghi chú trống tự điền &quot;TM&quot;.</li>
            <li><b>Gia công Tân Biên / Chư Păh, Thanh lý</b>: import không tự nhận ra — nhập bằng form <b>Thêm</b> (nguồn suy theo ghi chú của chuyến Điều xe).</li>
          </ul>
        </InspectorCard>
      </div>

      <InspectorCard title="Cảnh báo ở bước xem trước" icon={ShieldAlert}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1.5">Mã</th>
                <th className="py-1.5">Ý nghĩa</th>
                <th className="py-1.5 text-right">Chặn lưu?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {warnCodes.map((code) => (
                <tr key={code}>
                  <td className="py-1.5"><OutputWarnBadge code={code} /></td>
                  <td className="py-1.5 text-slate-600">{WARN_LABELS[code]}</td>
                  <td className="py-1.5 text-right font-bold">
                    {BLOCKING_WARN_CODES.has(code)
                      ? <span className="text-rose-600">{code === "DUPLICATE_IN_FILE" ? "Chặn cả file" : "Chặn dòng"}</span>
                      : <span className="text-slate-400">Không — chỉ để kiểm tra</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </InspectorCard>

      <InspectorCard title="Lưu và đồng bộ" icon={RefreshCcw}>
        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          <li>Khoá bản ghi: <b>Ngày + Đội + Số xe + Chuyến + Nguồn</b>. Import lại cùng khoá sẽ <b>cập nhật</b> (giữ người tạo gốc), không sinh bản trùng.</li>
          <li>Sau khi lưu, khối lượng được <b>ghi ngược sang Điều xe</b> (đúng chuyến) và tính lại KL các ngăn Kho nguyên liệu dùng chuyến đó.</li>
          <li>Chuyến Điều xe không còn bản ghi sản lượng thì giữ nguyên KL cũ ở Điều xe — sửa tay ở Điều xe nếu cần.</li>
        </ul>
      </InspectorCard>
    </div>
  )
}
