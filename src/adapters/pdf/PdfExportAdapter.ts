import { drawVectorPdf, vectorPdfWarnings } from './PdfVectorExport'
import { PDFDocument } from 'pdf-lib'
import type { EditorDocument } from '../../core/model/EditorDocument'
import { ImageExportAdapter } from '../ImageExportAdapter'
import {
  aborted,
  pdfLayout,
  PDF_LIMITS,
  yieldPdf,
  type PdfExportOptions,
} from './PdfOptions'

function background(options: PdfExportOptions): string | null {
  return options.background === 'transparent' && options.encoding === 'png'
    ? null
    : options.background === 'custom'
      ? options.color
      : '#ffffff'
}
export class PdfExportAdapter {
  constructor(private readonly renderer: ImageExportAdapter) {}
  async preview(
    doc: EditorDocument,
    options: PdfExportOptions,
    signal: AbortSignal,
  ): Promise<Blob> {
    const layout = pdfLayout(doc.dimensions, options)
    const scale = Math.min(
      1,
      400 / Math.max(layout.pixelWidth, layout.pixelHeight),
    )
    const canvas = await this.pageCanvas(doc, options, signal, scale)
    try {
      return await this.encode(canvas, 'png', options.quality)
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  }
  async export(
    documents: readonly EditorDocument[],
    options: PdfExportOptions,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ): Promise<Blob> {
    if (!documents.length || documents.length > PDF_LIMITS.pages)
      throw new Error('Select between 1 and 100 projects.')
    let pixels = 0
    for (const doc of documents) {
      const layout = pdfLayout(doc.dimensions, options)
      pixels += layout.pixelWidth * layout.pixelHeight
    }
    if (pixels > PDF_LIMITS.batchPixels)
      throw new Error(
        'This PDF exceeds the 64 megapixel export budget. Export fewer pages or lower the DPI.',
      )
    const pdf = await PDFDocument.create()
    pdf.setCreator('Photolisa')
    pdf.setProducer('Photolisa / pdf-lib')
    for (const [index, doc] of documents.entries()) {
      aborted(signal)
      await yieldPdf()
      const layout = pdfLayout(doc.dimensions, options)
      if (options.mode === 'vector' && !vectorPdfWarnings(doc).length) {
        drawVectorPdf(pdf.addPage([layout.width, layout.height]), doc, options)
        progress(index + 1, documents.length)
        continue
      }
      const canvas = await this.pageCanvas(doc, options, signal)
      try {
        const blob = await this.encode(
          canvas,
          options.encoding,
          options.quality,
        )
        aborted(signal)
        const bytes = await blob.arrayBuffer()
        const image =
          options.encoding === 'jpeg'
            ? await pdf.embedJpg(bytes)
            : await pdf.embedPng(bytes)
        const page = pdf.addPage([layout.width, layout.height])
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: layout.width,
          height: layout.height,
        })
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
      progress(index + 1, documents.length)
    }
    aborted(signal)
    await yieldPdf()
    const bytes = await pdf.save({ objectsPerTick: 20 })
    aborted(signal)
    return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  }
  private async pageCanvas(
    doc: EditorDocument,
    options: PdfExportOptions,
    signal: AbortSignal,
    previewScale = 1,
  ): Promise<HTMLCanvasElement> {
    const layout = pdfLayout(doc.dimensions, options)
    aborted(signal)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(layout.pixelWidth * previewScale))
    canvas.height = Math.max(1, Math.ceil(layout.pixelHeight * previewScale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas rendering is unavailable.')
    const bg = background(options)
    const pixelsPerPoint = (options.dpi / 72) * previewScale
    try {
      context.save()
      context.scale(pixelsPerPoint, pixelsPerPoint)
      context.beginPath()
      context.rect(
        layout.margin,
        layout.margin,
        layout.width - 2 * layout.margin,
        layout.height - 2 * layout.margin,
      )
      context.clip()
      context.translate(layout.x, layout.y)
      context.scale(layout.scale, layout.scale)
      await this.renderer.paintDocument(doc, context, PDF_LIMITS.pixels)
      aborted(signal)
      context.restore()
      // Composite the page background behind the completed document, so it does
      // not become a backdrop for native layer blend calculations.
      if (bg) {
        context.globalCompositeOperation = 'destination-over'
        context.fillStyle = bg
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.globalCompositeOperation = 'source-over'
      }
      return canvas
    } catch (error) {
      canvas.width = 0
      canvas.height = 0
      throw error
    }
  }

  private encode(
    canvas: HTMLCanvasElement,
    encoding: 'png' | 'jpeg',
    quality: number,
  ): Promise<Blob> {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('PDF image encoding failed.')),
        `image/${encoding}`,
        quality,
      ),
    )
  }
}
