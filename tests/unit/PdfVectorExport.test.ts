import { it, expect } from 'vitest'
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { createLayerBase, type VectorLayer } from '../../src/core/model/types'
import {
  drawVectorPdf,
  vectorPdfWarnings,
} from '../../src/adapters/pdf/PdfVectorExport'
import { defaultPdfOptions } from '../../src/adapters/pdf/PdfOptions'
const shape = (): VectorLayer => ({
  ...createLayerBase('shape', 'vector', 'Rectangle'),
  kind: 'vector',
  geometry: { type: 'rect', x: 10, y: 20, width: 30, height: 40, rx: 0, ry: 0 },
  style: { fill: '#ff0000', stroke: null, strokeWidth: 0, fillRule: 'nonzero' },
})
function doc() {
  const doc = EditorDocument.create({
    name: 'Vector',
    width: 100,
    height: 100,
    resolution: 72,
    background: 'transparent',
  })
  doc.layers.splice(0, 1, shape())
  return doc
}
it('writes actual vector drawing operations with transforms and no image XObjects', async () => {
  const source = doc()
  source.layers[0]!.transform = {
    x: 5,
    y: 6,
    rotation: Math.PI / 2,
    scaleX: 2,
    scaleY: 1,
  }
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([100, 100])
  drawVectorPdf(page, source, { ...defaultPdfOptions(), dpi: 72 })
  const bytes = await pdf.save({ useObjectStreams: false })
  const output = await PDFDocument.load(bytes)
  expect(output.getPageCount()).toBe(1)
  expect(
    output
      .getPage(0)
      .node.Resources()!
      .get(PDFName.of('XObject'))
      ?.toString() ?? '',
  ).not.toContain('Image')
  const objects = output.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFRawStream => object instanceof PDFRawStream)
  expect(objects.length).toBeGreaterThan(0)
  const operations = objects
    .map((stream) =>
      new TextDecoder().decode(decodePDFRawStream(stream).decode()),
    )
    .join('\n')
  expect(operations).toContain(' cm')
  expect(operations).toContain('30 40')
  expect(operations).not.toContain(' Do')
  expect(vectorPdfWarnings(source)).toEqual([])
})
it('warns and refuses unsupported editable content rather than dropping it', async () => {
  const source = doc()
  const layer = source.layers[0] as VectorLayer
  layer.style.fillGradient = {
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    stops: [{ offset: 0, color: '#ff0000' }],
  }
  expect(vectorPdfWarnings(source).join()).toContain('gradients')
  const pdf = await PDFDocument.create()
  expect(() =>
    drawVectorPdf(pdf.addPage([100, 100]), source, defaultPdfOptions()),
  ).toThrow('flattened')
  layer.visible = false
  expect(vectorPdfWarnings(source)).toEqual([])
})
