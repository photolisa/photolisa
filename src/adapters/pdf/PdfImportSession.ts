import {
  getDocument,
  GlobalWorkerOptions,
  AnnotationMode,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import {
  aborted,
  checkDpi,
  checkPdfFile,
  checkPixels,
  PDF_LIMITS,
} from './PdfOptions'

export interface PdfPageInfo {
  number: number
  width: number
  height: number
  rotation: number
  preview?: string
}
/** Browser-only adapter. The viewer/action APIs are deliberately never instantiated. */
export class PdfImportSession {
  private constructor(
    private readonly task: PDFDocumentLoadingTask,
    private readonly pdf: PDFDocumentProxy,
  ) {}
  get count(): number {
    return this.pdf.numPages
  }
  static async open(
    file: File,
    signal: AbortSignal,
    password: (submit: (value: string) => void, incorrect: boolean) => void,
  ): Promise<PdfImportSession> {
    aborted(signal)
    if (file.size > PDF_LIMITS.fileBytes)
      throw new Error('PDF files must be at most 100 MB.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    checkPdfFile(bytes)
    aborted(signal)
    GlobalWorkerOptions.workerSrc = workerUrl
    const base = `${import.meta.env.BASE_URL}pdf-assets/`
    const task = getDocument({
      data: bytes,
      enableXfa: false,
      useWorkerFetch: false,
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      maxImageSize: PDF_LIMITS.pixels,
      canvasMaxAreaInBytes: PDF_LIMITS.pixels * 4,
      stopAtErrors: true,
    })
    task.onPassword = (submit: (value: string) => void, reason: number) =>
      password(submit, reason === 2)
    const cancel = () => {
      void task.destroy()
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const pdf = await task.promise
      aborted(signal)
      if (pdf.numPages > PDF_LIMITS.pages)
        throw new Error(`PDFs are limited to ${PDF_LIMITS.pages} pages.`)
      return new PdfImportSession(task, pdf)
    } catch (error) {
      await task.destroy()
      aborted(signal)
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }
  async info(number: number): Promise<PdfPageInfo> {
    const page = await this.pdf.getPage(number)
    try {
      const view = page.getViewport({ scale: 1 })
      if (
        ![view.width, view.height].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      )
        throw new Error('PDF page dimensions are invalid.')
      return {
        number,
        width: view.width,
        height: view.height,
        rotation: page.rotate,
      }
    } finally {
      page.cleanup()
    }
  }
  async render(
    number: number,
    dpi: number,
    signal: AbortSignal,
    preview = false,
  ): Promise<HTMLCanvasElement> {
    if (preview) {
      if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 1200)
        throw new Error('Invalid PDF preview scale.')
    } else checkDpi(dpi)
    aborted(signal)
    const page = await this.pdf.getPage(number)
    const canvas = document.createElement('canvas')
    let success = false
    try {
      const viewport = page.getViewport({ scale: dpi / 72 })
      const width = Math.ceil(viewport.width),
        height = Math.ceil(viewport.height)
      checkPixels(width, height)
      aborted(signal)
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas rendering is unavailable.')
      const render = page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: 'rgba(0,0,0,0)',
        annotationMode: AnnotationMode.ENABLE,
      })
      const cancel = () => render.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await render.promise
        aborted(signal)
        success = true
        return canvas
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    } finally {
      page.cleanup()
      if (!success) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }
  async destroy(): Promise<void> {
    await this.task.destroy()
  }
}
