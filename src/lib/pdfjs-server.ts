// Nạp pdfjs-dist ở phía SERVER (API route / serverless). Không import file này từ client.
//
// pdfjs-dist v4+ dù đặt `disableWorker: true` vẫn dựng "fake worker" bằng import() động tới
// `pdf.worker.mjs` theo đường dẫn tương đối — trên Vercel file đó không nằm trong chunk nên báo
// "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs". Preload worker bằng
// đường dẫn TĨNH rồi gán vào `globalThis.pdfjsWorker` để pdfjs dùng thẳng, không import nữa.
// Mirror pattern đang chạy ổn ở `src/app/api/sign/generate-pdf/route.ts`.

let pdfjsWorkerPreloadPromise: Promise<unknown> | null = null

export async function loadPdfjs() {
  if (!(globalThis as Record<string, unknown>).pdfjsWorker) {
    pdfjsWorkerPreloadPromise ||= import("pdfjs-dist/legacy/build/pdf.worker.mjs").then((workerModule) => {
      ;(globalThis as Record<string, unknown>).pdfjsWorker = workerModule
      return workerModule
    })
    await pdfjsWorkerPreloadPromise
  }
  return await import("pdfjs-dist/legacy/build/pdf.mjs")
}
