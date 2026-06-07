import { StorageDetailClient } from "../_components/storage-detail-client"

export default async function StorageDetailPage(props: PageProps<"/dashboard/storage/[id]">) {
  const { id } = await props.params

  return <StorageDetailClient nganId={id} />
}
