declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  const workerModule: unknown
  export default workerModule
}

declare module "pdfjs-dist/build/pdf.worker.mjs" {
  const workerModule: string
  export default workerModule
}
