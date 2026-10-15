import { describe, it, expect } from 'vitest'
import {
  checkPdfFile,
  checkPixels,
  checkDpi,
  selectedPages,
  pdfLayout,
  defaultPdfOptions,
} from '../../src/adapters/pdf/PdfOptions'
import { EditorCore } from '../../src/core/EditorCore'
import { DocumentManager } from '../../src/core/DocumentManager'
import { EditorDocument } from '../../src/core/model/EditorDocument'
describe('PDF preflight and physical layout', () => {
  it('validates signature, DPI and allocations before rendering', () => {
    expect(() => checkPdfFile(new TextEncoder().encode('fake pdf'))).toThrow(
      'signature',
    )
    expect(() =>
      checkPdfFile(new TextEncoder().encode('%PDF-1.7')),
    ).not.toThrow()
    for (const dpi of [NaN, 0, 1201, Infinity])
      expect(() => checkDpi(dpi)).toThrow()
    for (const size of [
      [9000, 1],
      [5000, 5000],
      [NaN, 10],
      [0, 10],
    ])
      expect(() => checkPixels(size[0]!, size[1]!)).toThrow()
  })
  it('selects a single page, ranges, and all pages in original order', () => {
    expect(selectedPages('2', 5)).toEqual([2])
    expect(selectedPages('5, 1, 2-3, 2', 5)).toEqual([1, 2, 3, 5])
    expect(selectedPages('1-5', 5)).toEqual([1, 2, 3, 4, 5])
    for (const input of ['', '0', '6', '3-1', '1-x', '1,'])
      expect(() => selectedPages(input, 5)).toThrow()
  })
  it('keeps original physical dimensions across resolutions', () => {
    const options = defaultPdfOptions()
    for (const dpi of [72, 150, 300]) {
      const layout = pdfLayout(
        { width: 600, height: 300, resolution: 150 },
        { ...options, dpi },
      )
      expect(layout.width).toBe(288)
      expect(layout.height).toBe(144)
      expect(layout.pixelWidth).toBe(dpi * 4)
    }
  })
  it('fits and crops A4 landscape with margins, validates custom pages', () => {
    const options = {
      ...defaultPdfOptions(),
      pageSize: 'a4' as const,
      orientation: 'landscape' as const,
      margin: 10,
    }
    const doc = { width: 100, height: 100, resolution: 72 }
    const fit = pdfLayout(doc, options),
      cover = pdfLayout(doc, { ...options, fit: 'cover' })
    expect(fit.width).toBeCloseTo((297 * 72) / 25.4)
    expect(fit.imageHeight).toBeCloseTo(fit.height - fit.margin * 2)
    expect(cover.imageWidth).toBeCloseTo(cover.width - cover.margin * 2)
    expect(() => pdfLayout(doc, { ...options, margin: 150 })).toThrow('Margins')
    expect(() =>
      pdfLayout(doc, { ...options, pageSize: 'custom', customWidth: -1 }),
    ).toThrow()
  })
  it('retains resources for undo and recently closed tabs, disposes on eviction/destroy', () => {
    const manager = new DocumentManager(1),
      cleaned: string[] = []
    const make = (name: string) =>
      manager.open(
        EditorDocument.create({
          name,
          width: 10,
          height: 10,
          resolution: 72,
          background: 'transparent',
        }),
      )
    const first = make('one')
    first.editor.retainResource(() => cleaned.push('one'))
    manager.close(first.id)
    expect(cleaned).toEqual([])
    manager.reopenLastClosed()
    expect(cleaned).toEqual([])
    const second = make('two')
    second.editor.retainResource(() => cleaned.push('two'))
    manager.close(first.id)
    manager.close(second.id)
    expect(cleaned).toEqual(['one'])
    manager.destroy()
    expect(cleaned).toEqual(['one', 'two'])
    const core = new EditorCore()
    core.retainResource(() => cleaned.push('three'))
    core.destroy()
    core.destroy()
    expect(cleaned).toEqual(['one', 'two', 'three'])
  })
})
