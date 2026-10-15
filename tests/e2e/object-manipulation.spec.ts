import { test, expect, type Page } from '@playwright/test'
import type { EditorCore } from '../../src/core/EditorCore'
import type { ImageExportAdapter } from '../../src/adapters/ImageExportAdapter'
import type { RasterSourceRegistry } from '../../src/raster/RasterSourceRegistry'
import type { selectedObjects } from '../../src/tools/ObjectBounds'
import type { framePoints } from '../../src/core/transform/ObjectTransform'

async function importShapes(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Objects.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="Left" x="40" y="40" width="80" height="60" fill="#e34b65"/><rect id="Right" x="180" y="40" width="80" height="60" fill="#3baee8"/></svg>',
    ),
  })
  await expect(
    page.getByRole('tab', { name: 'Objects', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+1')
}
async function model(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/composables/useEditor.ts',
      module = (await import(path)) as { editorCore: EditorCore }
    return module.editorCore.document!.serialize()
  })
}
async function point(page: Page, x: number, y: number) {
  const box = await page.getByLabel('Document canvas').boundingBox(),
    doc = await model(page)
  if (!box) throw new Error('Canvas unavailable')
  return {
    x: box.x + box.width / 2 - doc.dimensions.width / 2 + x,
    y: box.y + box.height / 2 - doc.dimensions.height / 2 + y,
  }
}
async function handles(page: Page) {
  return page.evaluate(async () => {
    const editorPath = '/src/composables/useEditor.ts',
      boundsPath = '/src/tools/ObjectBounds.ts',
      transformPath = '/src/core/transform/ObjectTransform.ts'
    const { editorCore } = (await import(editorPath)) as {
      editorCore: EditorCore
    }
    const { selectedObjects: selected } = (await import(boundsPath)) as {
      selectedObjects: typeof selectedObjects
    }
    const { framePoints: points } = (await import(transformPath)) as {
      framePoints: typeof framePoints
    }
    const doc = editorCore.document!,
      entry = selected(doc.layers, doc.selectedLayerIds)[0]!
    return points({ bounds: entry.bounds, matrix: entry.world })
  })
}
async function drag(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await page.mouse.up()
}

test('selects, multi-moves, nudges, marquee-selects and duplicates with one undo', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await importShapes(page)
  const a = await point(page, 80, 70),
    b = await point(page, 220, 70)
  await page.mouse.click(a.x, a.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(b.x, b.y)
  await page.keyboard.up('Shift')
  expect((await model(page)).selectedLayerIds).toHaveLength(2)
  await drag(page, a, { x: a.x + 30, y: a.y + 20 })
  expect((await model(page)).layers.map((l) => l.transform.x)).toEqual([30, 30])
  await page.keyboard.press('Shift+ArrowRight')
  expect((await model(page)).layers.map((l) => l.transform.x)).toEqual([40, 40])
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  expect((await model(page)).layers.map((l) => l.transform.x)).toEqual([0, 0])
  await page.keyboard.down('Alt')
  await drag(page, a, { x: a.x + 25, y: a.y + 30 })
  await page.keyboard.up('Alt')
  expect((await model(page)).layers).toHaveLength(4)
  await page.keyboard.press('Control+z')
  expect((await model(page)).layers).toHaveLength(2)
  const start = await point(page, 10, 10),
    end = await point(page, 290, 120)
  await drag(page, start, end)
  expect((await model(page)).selectedLayerIds).toHaveLength(2)
  await page.getByRole('button', { name: 'Group objects' }).click()
  expect((await model(page)).layers[0]?.kind).toBe('group')
  await page.keyboard.press('Control+z')
  expect((await model(page)).layers).toHaveLength(2)
  expect(errors).toEqual([])
})

test('resizes proportionally from center, rotates, flips and edits rectangle radius', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await importShapes(page)
  const a = await point(page, 80, 70)
  await page.mouse.click(a.x, a.y)
  const bottomRight = await point(page, 120, 100)
  await page.keyboard.down('Shift')
  await page.keyboard.down('Alt')
  await drag(page, bottomRight, await point(page, 160, 130))
  await page.keyboard.up('Alt')
  await page.keyboard.up('Shift')
  let layer = (await model(page)).layers[0]!
  expect(layer.transform.scaleX).toBeCloseTo(2)
  expect(layer.transform.scaleY).toBeCloseTo(2)
  const frame = await handles(page)
  expect((frame[0]!.x + frame[4]!.x) / 2).toBeCloseTo(80)
  await page.keyboard.press('Control+z')
  // Outside the top-left corner is the rotation handle, at a constant screen offset.
  const rotation = await point(page, 40 - 22 * 0.8, 40 - 22 * 0.6)
  await page.keyboard.down('Shift')
  await drag(page, rotation, await point(page, 132, 14))
  await page.keyboard.up('Shift')
  layer = (await model(page)).layers[0]!
  expect(Math.abs(layer.transform.rotation)).toBeGreaterThan(0.1)
  expect(layer.transform.rotation / (Math.PI / 12)).toBeCloseTo(
    Math.round(layer.transform.rotation / (Math.PI / 12)),
  )
  await page.keyboard.press('Control+z')
  const radius = await point(page, 52, 52)
  await drag(page, radius, await point(page, 62, 62))
  layer = (await model(page)).layers[0]!
  expect(layer.kind).toBe('vector')
  if (layer.kind === 'vector' && layer.geometry.type === 'rect')
    expect(layer.geometry.rx).toBeCloseTo(22)
  await page.getByRole('button', { name: 'Object transform options' }).click()
  await page
    .getByRole('button', { name: 'Flip horizontal', exact: true })
    .click()
  expect((await handles(page))[0]!.x).toBeCloseTo(120)
  await page.screenshot({ path: '/tmp/photolisa-object-transform.png' })
  expect(errors).toEqual([])
})

test('edits text in place and resizes its box independently of glyph scale', async ({
  page,
}) => {
  await importShapes(page)
  await page.keyboard.press('t')
  const p = await point(page, 60, 150)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('v')
  const frame = await handles(page),
    center = await point(
      page,
      (frame[0]!.x + frame[4]!.x) / 2,
      (frame[0]!.y + frame[4]!.y) / 2,
    )
  await page.mouse.dblclick(center.x, center.y)
  const input = page.getByRole('textbox', { name: 'Edit text on canvas' })
  await expect(input).toBeVisible()
  await input.fill('Hello editor')
  await input.press('Control+Enter')
  let layer = (await model(page)).layers.find((l) => l.kind === 'text')!
  if (layer.kind !== 'text') throw new Error('Text missing')
  expect(layer.text).toBe('Hello editor')
  await page.keyboard.press('Control+z')
  layer = (await model(page)).layers.find((l) => l.kind === 'text')!
  if (layer.kind === 'text') expect(layer.text).toBe('Text')
  await page.keyboard.press('Control+Shift+z')
  const after = await handles(page),
    edge = await point(page, after[3]!.x, after[3]!.y)
  await drag(page, edge, { x: edge.x + 60, y: edge.y })
  layer = (await model(page)).layers.find((l) => l.kind === 'text')!
  if (layer.kind === 'text') {
    expect(layer.textBox?.width).toBeGreaterThan(100)
    expect(layer.fontSize).toBe(48)
    expect(layer.transform.scaleX).toBeCloseTo(1)
  }
  await page.keyboard.press('Control+z')
  layer = (await model(page)).layers.find((l) => l.kind === 'text')!
  if (layer.kind === 'text') expect(layer.textBox).toBeUndefined()
})

test('crops and repositions an image without changing its original source', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 120
    const context = canvas.getContext('2d')!
    const gradient = context.createLinearGradient(0, 0, 200, 0)
    gradient.addColorStop(0, '#000000')
    gradient.addColorStop(1, '#ff0000')
    context.fillStyle = gradient
    context.fillRect(0, 0, 200, 120)
    return canvas.toDataURL().split(',')[1]!
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Original.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  })
  await expect(
    page.getByRole('tab', { name: 'Original', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+1')
  const center = await point(page, 100, 60)
  await page.mouse.dblclick(center.x, center.y)
  await expect(
    page.getByRole('button', { name: 'Finish image crop' }),
  ).toBeVisible()
  await drag(page, await point(page, 200, 60), await point(page, 140, 60))
  let layer = (await model(page)).layers[0]!
  if (layer.kind !== 'raster') throw new Error('Image missing')
  expect(layer.crop?.width).toBeCloseTo(140)
  await drag(page, await point(page, 70, 60), await point(page, 50, 60))
  layer = (await model(page)).layers[0]!
  if (layer.kind === 'raster') expect(layer.crop?.offsetX).toBeCloseTo(-20)
  await page.getByRole('button', { name: 'Finish image crop' }).click()
  const original = await page.evaluate(async () => {
    const editorPath = '/src/composables/useEditor.ts',
      sourcePath = '/src/raster/RasterSourceRegistry.ts'
    const { editorCore } = (await import(editorPath)) as {
      editorCore: EditorCore
    }
    const { rasterSources } = (await import(sourcePath)) as {
      rasterSources: RasterSourceRegistry
    }
    const layer = editorCore.document!.layers[0]!
    if (layer.kind !== 'raster') throw new Error('Image missing')
    const source = rasterSources.get(layer.pixelSourceId!)!
    return { width: source.width, height: source.height }
  })
  expect(original).toEqual({ width: 200, height: 120 })
  const exported = await page.evaluate(async () => {
    const editorPath = '/src/composables/useEditor.ts',
      exportPath = '/src/adapters/ImageExportAdapter.ts'
    const { editorCore } = (await import(editorPath)) as {
      editorCore: EditorCore
    }
    const { ImageExportAdapter: Adapter } = (await import(exportPath)) as {
      ImageExportAdapter: typeof ImageExportAdapter
    }
    const adapter = new Adapter()
    try {
      const surface = await adapter.renderDocument(editorCore.document!)
      return {
        inside: [...surface.context.getImageData(0, 60, 1, 1).data],
        outside: [...surface.context.getImageData(150, 60, 1, 1).data],
      }
    } finally {
      adapter.destroy()
    }
  })
  expect(exported.inside[0]).toBeGreaterThan(24)
  expect(exported.inside[0]).toBeLessThan(29)
  expect(exported.inside[3]).toBe(255)
  expect(exported.outside[3]).toBe(0)
  await page.keyboard.press('i')
  const outside = await point(page, 150, 60)
  await page.mouse.click(outside.x, outside.y)
  await expect(page.getByTitle('Foreground color')).toContainText('#00000000')
  await page.keyboard.press('v')

  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+z')
  layer = (await model(page)).layers[0]!
  if (layer.kind === 'raster') expect(layer.crop?.offsetX).toBe(0)
  await page.keyboard.press('Control+z')
  layer = (await model(page)).layers[0]!
  if (layer.kind === 'raster') expect(layer.crop).toBeUndefined()
})

test('skew and affine free transform retain geometry, and wheel navigation cancels a preview', async ({
  page,
}) => {
  await importShapes(page)
  const p = await point(page, 80, 70)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.down('Control')
  await drag(page, await point(page, 80, 40), await point(page, 110, 40))
  await page.keyboard.up('Control')
  let layer = (await model(page)).layers[0]!
  expect(layer.svgMatrix).toBeDefined()
  if (layer.kind === 'vector' && layer.geometry.type === 'rect')
    expect(layer.geometry.width).toBe(80)
  await page.keyboard.press('Control+z')
  expect((await model(page)).layers[0]!.svgMatrix).toBeUndefined()
  await page.keyboard.down('Control')
  await page.keyboard.down('Alt')
  await drag(page, await point(page, 40, 40), await point(page, 25, 25))
  await page.keyboard.up('Alt')
  await page.keyboard.up('Control')
  expect((await handles(page))[0]!.x).toBeCloseTo(25)
  expect((await handles(page))[0]!.y).toBeCloseTo(25)
  expect((await model(page)).layers).toHaveLength(2)
  await page.keyboard.press('Control+z')
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 40, p.y + 20, { steps: 4 })
  await page.mouse.wheel(0, -100)
  await page.mouse.up()
  layer = (await model(page)).layers[0]!
  expect(layer.transform.x).toBe(0)
  expect(layer.transform.y).toBe(0)
})
