import { Plus } from "lucide-react"
import { InventoryPageShell, InventoryPlaceholderSection } from "./_components/inventory-shell"

export default function InventoryPage() {
  return (
    <InventoryPageShell
      title="Quản lý kho"
      description="Theo dõi nhập kho, xuất kho, chuyển kho, tồn kho và cảnh báo vật tư, hóa chất theo từng nhà máy."
      action={
        <button className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700">
          <Plus size={16} />
          Tạo phiếu
        </button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <InventoryPlaceholderSection
          title="Nhập xuất tồn"
          description="Đây là khu vực làm việc chính của thủ kho và kế toán kho, gom toàn bộ nghiệp vụ phát sinh hằng ngày vào một mạch thao tác thống nhất."
          bullets={[
            "Nhập kho, xuất kho, chuyển kho, tồn kho và thẻ kho nằm chung trong một tab nghiệp vụ.",
            "Cảnh báo số lô, hạn dùng, tồn thấp và tồn cao hiển thị ngay trong lúc thao tác phiếu.",
            "Người thực hiện phiếu chính là tài khoản đang đăng nhập vào hệ thống.",
          ]}
        />

        <InventoryPlaceholderSection
          title="Thống kê"
          description="Khu vực thống kê tách riêng để quản lý xem nhanh tình hình kho mà không lẫn với màn hình nhập liệu hằng ngày."
          bullets={[
            "Tổng hợp nhập xuất tồn theo kỳ, theo kho, theo vật tư và theo nhóm vật tư.",
            "Biểu đồ cảnh báo tồn thấp, tồn cao, sắp hết hạn và chênh lệch định mức.",
            "Xuất file kiểm tra nhập xuất tồn và đối chiếu định mức theo kỳ.",
          ]}
        />
      </div>
    </InventoryPageShell>
  )
}
