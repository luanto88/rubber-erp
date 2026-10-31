import { isBrowserOffline, signOutEverywhere } from "@/lib/auth"
import { clearConfirmOwnerData, confirmQueueOwner, countConfirmQueue } from "@/lib/confirm-offline-store"

/**
 * Đăng xuất dùng chung cho khung dashboard và màn quét QR (màn quét bypass sidebar nên tự có nút).
 * Còn kiện quét khi mất mạng chưa đồng bộ ⇒ hỏi trước; đồng ý thì chỉ xoá dữ liệu của tài khoản đó.
 * Trả `false` khi người dùng huỷ (chưa làm gì), ngược lại luôn chuyển về /login.
 */
export async function logoutWithConfirmQueueCheck(
  user: { id?: string | null; factory_id?: string | null } | null,
  onBeforeSignOut?: () => void,
): Promise<boolean> {
  const owner = user?.id && user.factory_id ? confirmQueueOwner(user.factory_id, user.id) : null
  const offline = isBrowserOffline()
  const offlineNote = offline ? "\n\nĐang mất mạng — sau khi đăng xuất phải có mạng mới đăng nhập lại được." : ""
  const pending = owner ? await countConfirmQueue(owner) : 0
  if (pending > 0) {
    if (
      !window.confirm(
        `Còn ${pending} kiện thành phẩm quét khi mất mạng CHƯA đồng bộ lên hệ thống. Đăng xuất sẽ xoá dữ liệu này khỏi máy. Vẫn đăng xuất?${offlineNote}`,
      )
    ) {
      return false
    }
  } else if (offline && !window.confirm(`Đăng xuất?${offlineNote}`)) {
    return false
  }
  onBeforeSignOut?.()
  try {
    if (owner) await clearConfirmOwnerData(owner)
    await signOutEverywhere()
  } finally {
    window.location.replace("/login")
  }
  return true
}
