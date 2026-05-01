import { redirect } from "next/navigation"

export default function InventoryPage() {
  redirect("/dashboard/inventory/on-hand")
}
