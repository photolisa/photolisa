import { it, expect } from 'vitest'
import { ImageExportAdapter } from '../../src/adapters/ImageExportAdapter'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { createLayerBase, type GroupLayer } from '../../src/core/model/types'
import { PDF_LIMITS } from '../../src/adapters/pdf/PdfOptions'

it('rejects oversized temporary group effects before allocating a canvas and restores context state', async () => {
  const doc = EditorDocument.create({
    name: 'Large effects',
    width: 6000,
    height: 4000,
    resolution: 300,
    background: 'transparent',
  })
  const group: GroupLayer = {
    ...createLayerBase('group', 'group', 'Effects'),
    kind: 'group',
    children: [],
    adjustments: [
      {
        id: 'invert',
        kind: 'invert',
        enabled: true,
        parameters: { amount: 1 },
      },
    ],
  }
  doc.layers.splice(0, 1, group)
  let depth = 0
  const context = {
    save: () => {
      depth++
    },
    restore: () => {
      depth--
    },
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as CanvasRenderingContext2D
  const adapter = new ImageExportAdapter()
  // Node has no document/canvas API: the safety error must precede any allocation.
  await expect(
    adapter.paintDocument(doc, context, PDF_LIMITS.pixels),
  ).rejects.toThrow('temporary rendering limit')
  expect(depth).toBe(0)
  doc.layers.splice(0)
  await expect(
    adapter.paintDocument(doc, context, PDF_LIMITS.pixels),
  ).resolves.toBeUndefined()
  expect(depth).toBe(0)
  adapter.destroy()
})
