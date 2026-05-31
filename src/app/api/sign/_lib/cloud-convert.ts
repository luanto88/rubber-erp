import { PDFDocument } from "pdf-lib"

type CCTask = {
  name?: string
  operation?: string
  status?: string
  message?: string
  code?: string
  result?: { files?: Array<{ url?: string }> }
}
type CCJobData = { status?: string; tasks?: CCTask[] }
type CCPollJson = { data?: CCJobData; message?: string }

export async function convertOfficeUrlToPdfDocument(fileUrl: string | null): Promise<PDFDocument> {
  const cleanUrl = fileUrl?.split("?")[0] || ""
  const ext = cleanUrl.split(".").pop()?.toLowerCase()
  if (ext !== "docx" && ext !== "xlsx") {
    throw new Error("File Office da xu ly khong phai DOCX/XLSX")
  }
  if (!fileUrl) throw new Error("Thieu URL file Office da xu ly")
  const apiKey = process.env.CLOUDCONVERT_API_KEY
  if (!apiKey) throw new Error("Thieu CLOUDCONVERT_API_KEY de convert DOCX/XLSX sang PDF")

  const createRes = await fetch("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tasks: {
        "import-office": {
          operation: "import/url",
          url: fileUrl,
        },
        "convert-office": {
          operation: "convert",
          input: "import-office",
          input_format: ext,
          output_format: "pdf",
          engine: "office",
        },
        "export-pdf": {
          operation: "export/url",
          input: "convert-office",
        },
      },
    }),
  })
  const createJson = await createRes.json().catch(() => ({}))
  if (!createRes.ok) {
    throw new Error(`CloudConvert tao job that bai: ${createJson.message || createRes.status}`)
  }
  const jobId = createJson.data?.id as string | undefined
  if (!jobId) throw new Error("CloudConvert khong tra ve job id")

  const MAX_WAIT_MS = 90_000
  const POLL_INTERVAL_MS = 2_000
  const deadline = Date.now() + MAX_WAIT_MS
  let waitJson: CCPollJson = {}
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const pollRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    waitJson = (await pollRes.json().catch(() => ({}))) as CCPollJson
    const status = waitJson.data?.status
    if (status === "finished") break
    if (status === "error") {
      const errTask = waitJson.data?.tasks?.find((t) => t.status === "error")
      throw new Error(`CloudConvert convert that bai: ${errTask?.message || "unknown error"}`)
    }
  }
  if (waitJson.data?.status !== "finished") {
    throw new Error(`CloudConvert timeout sau ${MAX_WAIT_MS / 1000}s — job ${jobId} chua hoan thanh`)
  }
  const exportTask = waitJson.data.tasks?.find(
    (task) => task.name === "export-pdf" || task.operation === "export/url",
  )
  const pdfUrl = exportTask?.result?.files?.[0]?.url
  if (!pdfUrl) throw new Error("CloudConvert khong tra ve URL PDF")

  const pdfRes = await fetch(pdfUrl, { cache: "no-store" })
  if (!pdfRes.ok) throw new Error(`Khong tai duoc PDF tu CloudConvert: HTTP ${pdfRes.status}`)
  return await PDFDocument.load(await pdfRes.arrayBuffer())
}

export async function convertOfficeUrlToPdfDocumentWithRetry(fileUrl: string | null): Promise<PDFDocument> {
  try {
    return await convertOfficeUrlToPdfDocument(fileUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("429") || msg.toLowerCase().includes("too many")) {
      await new Promise((r) => setTimeout(r, 3_000))
      return await convertOfficeUrlToPdfDocument(fileUrl)
    }
    throw err
  }
}
