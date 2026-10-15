import {
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  rectangle,
  clip,
  endPath,
  type PDFPage,
} from 'pdf-lib'
import type { EditorDocument } from '../../core/model/EditorDocument'
import type { VectorLayer } from '../../core/model/types'
import { pdfLayout, type PdfExportOptions } from './PdfOptions'

import { vectorPdfWarnings } from './PdfVectorSupport'
export { vectorPdfWarnings } from './PdfVectorSupport'

export function pdfColor(value: string) {
  return rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  )
}
export function drawVectorPdf(
  page: PDFPage,
  doc: EditorDocument,
  options: PdfExportOptions,
): void {
  if (vectorPdfWarnings(doc).length)
    throw new Error('This document needs flattened PDF export.')
  const layout = pdfLayout(doc.dimensions, options)
  const bg =
    options.background === 'custom'
      ? options.color
      : options.background === 'white'
        ? '#ffffff'
        : null
  if (bg)
    page.drawRectangle({
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height,
      color: pdfColor(bg),
    })
  page.pushOperators(
    pushGraphicsState(),
    rectangle(
      layout.margin,
      layout.margin,
      layout.width - 2 * layout.margin,
      layout.height - 2 * layout.margin,
    ),
    clip(),
    endPath(),
    concatTransformationMatrix(
      layout.scale,
      0,
      0,
      -layout.scale,
      layout.x,
      layout.height - layout.y,
    ),
  )
  // The native document background occupies the document bounds, independently of page background.
  if (doc.background === 'white')
    page.drawRectangle({
      x: 0,
      y: 0,
      width: doc.dimensions.width,
      height: doc.dimensions.height,
      color: rgb(1, 1, 1),
    })
  page.pushOperators(
    rectangle(0, 0, doc.dimensions.width, doc.dimensions.height),
    clip(),
    endPath(),
  )
  for (const layer of doc.layers)
    if (layer.visible && layer.kind === 'vector') drawShape(page, layer)
  page.pushOperators(popGraphicsState())
}
function drawShape(page: PDFPage, layer: VectorLayer): void {
  const { transform: t, style: s, geometry: g } = layer
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation)
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      cos * t.scaleX,
      sin * t.scaleX,
      -sin * t.scaleY,
      cos * t.scaleY,
      t.x,
      t.y,
    ),
  )
  if (layer.svgMatrix)
    page.pushOperators(concatTransformationMatrix(...layer.svgMatrix))
  const style = {
    ...(s.fill ? { color: pdfColor(s.fill) } : {}),
    ...(s.stroke ? { borderColor: pdfColor(s.stroke) } : {}),
    borderWidth: s.stroke ? s.strokeWidth : 0,
  }
  if (g.type === 'rect' && (s.fill || s.stroke))
    page.drawRectangle({
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      ...style,
    })
  else if (g.type === 'circle' && (s.fill || s.stroke))
    page.drawEllipse({ x: g.cx, y: g.cy, xScale: g.r, yScale: g.r, ...style })
  else if (g.type === 'ellipse' && (s.fill || s.stroke))
    page.drawEllipse({ x: g.cx, y: g.cy, xScale: g.rx, yScale: g.ry, ...style })
  else if (g.type === 'line' && s.stroke)
    page.drawLine({
      start: { x: g.x1, y: g.y1 },
      end: { x: g.x2, y: g.y2 },
      color: pdfColor(s.stroke),
      thickness: s.strokeWidth,
    })
  page.pushOperators(popGraphicsState())
}
