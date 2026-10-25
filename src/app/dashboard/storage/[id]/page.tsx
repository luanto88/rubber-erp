import { StorageDetailDashboard } from "../_components/storage-detail-dashboard"

export default async function StorageDetailPage(props: PageProps<"/dashboard/storage/[id]">) {
  const { id } = await props.params

  return <StorageDetailDashboard nganId={id} />
}
