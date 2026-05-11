"use client"

import { redirect } from "next/navigation"
import MaintenanceRecordFormPage from "../[id]/page"

// /records/new redirects to /records/[id] with id="new"
export default function NewRecordPage() {
  return <MaintenanceRecordFormPage params={Promise.resolve({ id: "new" })} />
}
