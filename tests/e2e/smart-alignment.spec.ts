import { expect, test, type Page } from '@playwright/test'
import type { EditorCore } from '../../src/core/EditorCore'
import type { objectEntries } from '../../src/tools/ObjectBounds'
import type { worldBounds } from '../../src/core/transform/ObjectTransform'

test.use({ deviceScaleFactor: 2 })

async function openLayers(page: Page, rotated = false): Promise<void> {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Smart Layers.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect id="A" x="40" y="80" width="40" height="40" fill="#e34b65"/><rect id="B" x="160" y="80" width="60" height="40" fill="#3baee8"/><rect id="C" x="310" y="180" width="30" height="40" fill="#81c784" ${rotated ? 'transform="rotate(45 325 200)"' : ''}/></svg>`,
    ),
  })
  await expect(
    page.getByRole('tab', { name: 'Smart Layers', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+1')
  await page.keyboard.press('v')
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const editorPath = '/src/composables/useEditor.ts',
      boundsPath = '/src/tools/ObjectBounds.ts',
      transformPath = '/src/core/transform/ObjectTransform.ts'
    const { editorCore } = (await import(editorPath)) as {
      editorCore: EditorCore
    }
    const { objectEntries: entries } = (await import(boundsPath)) as {
      objectEntries: typeof objectEntries
    }
    const { worldBounds: bounds } = (await import(transformPath)) as {
      worldBounds: typeof worldBounds
    }
    const doc = editorCore.document
    if (!doc) throw new Error('No document')
    return {
      history: editorCore.history.retainedEntries,
      selected: doc.selectedLayerIds,
      layers: entries(doc.layers).map((e) => ({
        id: e.layer.id,
        name: e.layer.name,
        matrix: e.layer.svgMatrix ? [...e.layer.svgMatrix] : null,
        bounds: bounds({ bounds: e.bounds, matrix: e.world }),
      })),
    }
  })
}
async function point(page: Page, x: number, y: number) {
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('No canvas')
  const zoom =
    Number(await page.getByRole('slider', { name: 'Zoom' }).inputValue()) / 100
  return {
    x: box.x + box.width / 2 + (x - 300) * zoom,
    y: box.y + box.height / 2 + (y - 200) * zoom,
  }
}
async function dragPreview(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 6,
) {
  const a = await point(page, from.x, from.y),
    b = await point(page, to.x, to.y)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps })
}
async function hasGuide(page: Page, x: number, y: number): Promise<boolean> {
  const p = await point(page, x, y)
  return page.locator('canvas.z-20').evaluateAll(
    (canvases, position) =>
      canvases.some((element) => {
        const canvas = element as HTMLCanvasElement,
          box = canvas.getBoundingClientRect()
        const context = canvas.getContext('2d')
        if (!context || !box.width) return false
        const scale = canvas.width / box.width
        const x = Math.round((position.x - box.x) * scale),
          y = Math.round((position.y - box.y) * scale)
        const pixels = context.getImageData(x - 2, y - 8, 5, 16).data
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i] ?? 0,
            g = pixels[i + 1] ?? 0,
            b = pixels[i + 2] ?? 0
          if (
            r > 220 &&
            g > 90 &&
            g < 150 &&
            b > 150 &&
            b < 210 &&
            (pixels[i + 3] ?? 0) > 150
          )
            return true
        }
        return false
      }),
    p,
  )
}

test('canvas center guides snap precisely, clear after release, and undo/redo one drag', async ({
  page,
}) => {
  await openLayers(page)
  await expect(page.getByLabel('Snap to canvas', { exact: true })).toBeChecked()
  const before = await state(page)
  await dragPreview(page, { x: 325, y: 200 }, { x: 299, y: 203 })
  await expect
    .poll(async () => (await state(page)).layers[2]?.bounds.x)
    .toBe(285)
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(true)
  await page.mouse.up()
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(false)
  expect((await state(page)).history).toBe(before.history + 1)
  await page.keyboard.press('Control+z')
  expect((await state(page)).layers[2]?.bounds.x).toBe(310)
  await page.keyboard.press('Control+Shift+z')
  expect((await state(page)).layers[2]?.bounds.x).toBe(285)
})

test('magnetic snapping holds through small pointer jitter and releases naturally', async ({
  page,
}) => {
  await openLayers(page)
  await dragPreview(page, { x: 325, y: 200 }, { x: 299, y: 200 })
  await expect
    .poll(async () => (await state(page)).layers[2]?.bounds.x)
    .toBe(285)
  const jitter = await point(page, 307, 200)
  await page.mouse.move(jitter.x, jitter.y)
  await expect
    .poll(async () => (await state(page)).layers[2]?.bounds.x)
    .toBe(285)
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(true)
  const release = await point(page, 323, 200)
  await page.mouse.move(release.x, release.y)
  await expect
    .poll(async () => (await state(page)).layers[2]?.bounds.x)
    .toBe(308)
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(false)
  await page.mouse.up()
})

test('rotated layers snap their transformed bounds without altering their rotation', async ({
  page,
}) => {
  await openLayers(page, true)
  const before = await state(page),
    original = before.layers[2]
  if (!original) throw new Error('Missing rotated layer')
  await dragPreview(page, { x: 325, y: 200 }, { x: 299, y: 203 })
  await expect
    .poll(async () => {
      const layer = (await state(page)).layers[2]
      return layer ? layer.bounds.x + layer.bounds.width / 2 : NaN
    })
    .toBeCloseTo(300, 7)
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(true)
  await page.mouse.up()
  const after = (await state(page)).layers[2]
  expect(after?.matrix).toEqual(original.matrix)
  expect(after?.bounds.width).toBeCloseTo(original.bounds.width, 7)
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(false)
  await page.keyboard.press('Control+z')
  expect((await state(page)).layers).toEqual(before.layers)
})

test('multiple selected layers snap as a unit and keep their relative offsets', async ({
  page,
}) => {
  await openLayers(page)
  const a = await point(page, 60, 100),
    b = await point(page, 190, 100)
  await page.mouse.click(a.x, a.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(b.x, b.y)
  await page.keyboard.up('Shift')
  const before = await state(page)
  expect(before.selected).toHaveLength(2)
  await dragPreview(page, { x: 60, y: 100 }, { x: 229, y: 203 })
  await expect
    .poll(async () => (await state(page)).layers[0]?.bounds.x)
    .toBe(210)
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(true)
  await page.mouse.up()
  const after = await state(page)
  expect(after.layers[1]?.bounds.x).toBe(330)
  expect(after.layers[0]?.bounds.y).toBe(180)
  expect(after.layers[1]?.bounds.y).toBe(180)
  expect(after.history).toBe(before.history + 1)
  await expect.poll(() => hasGuide(page, 300, 30)).toBe(false)
  await page.keyboard.press('Control+z')
  expect((await state(page)).layers).toEqual(before.layers)
})

test('equal spacing shows distances and matching edges, then Escape restores the drag', async ({
  page,
}) => {
  await openLayers(page)
  await page.getByLabel('Snap to canvas', { exact: true }).check()
  const before = await state(page)
  await dragPreview(page, { x: 325, y: 200 }, { x: 122, y: 100 })
  await expect
    .poll(async () => (await state(page)).layers[2]?.bounds)
    .toMatchObject({ x: 105, y: 80 })
  await expect.poll(() => hasGuide(page, 93, 100)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('equal-spacing.png') })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect((await state(page)).layers).toEqual(before.layers)
  expect((await state(page)).history).toBe(before.history)
  await expect.poll(() => hasGuide(page, 93, 100)).toBe(false)
})

test('tolerance is configurable in screen pixels and disabling snapping preserves the pointer position', async ({
  page,
}) => {
  await openLayers(page)
  await page.getByLabel('Snap to canvas', { exact: true }).check()
  await page.getByLabel('Smart snap tolerance').fill('1')
  await page.getByLabel('Document canvas').focus()
  await dragPreview(page, { x: 325, y: 200 }, { x: 298, y: 200 })
  await page.mouse.up()
  expect((await state(page)).layers[2]?.bounds.x).toBe(283)
  await page.keyboard.press('Control+z')
  await page.getByLabel('Smart snap tolerance').fill('6')
  await page.getByLabel('Document canvas').focus()
  await dragPreview(page, { x: 325, y: 200 }, { x: 298, y: 200 })
  await page.mouse.up()
  expect((await state(page)).layers[2]?.bounds.x).toBe(285)
  await page.keyboard.press('Control+z')
  await page.getByLabel('Snap to canvas', { exact: true }).uncheck()
  await dragPreview(page, { x: 325, y: 200 }, { x: 298, y: 200 })
  await page.mouse.up()
  expect((await state(page)).layers[2]?.bounds.x).toBe(283)
})

test('alignment and distribution controls change real layer bounds in one undo step', async ({
  page,
}) => {
  await openLayers(page)
  const first = await point(page, 60, 100)
  await page.mouse.click(first.x, first.y)
  for (const p of [
    { x: 190, y: 100 },
    { x: 325, y: 200 },
  ]) {
    const screen = await point(page, p.x, p.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(screen.x, screen.y)
    await page.keyboard.up('Shift')
  }
  expect((await state(page)).selected).toHaveLength(3)
  const before = await state(page)
  await page
    .getByRole('button', { name: 'Align and distribute layers' })
    .click()
  await page.getByRole('button', { name: 'Align top', exact: true }).click()
  expect((await state(page)).layers.map((l) => l.bounds.y)).toEqual([
    80, 80, 80,
  ])
  expect((await state(page)).history).toBe(before.history + 1)
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+z')
  expect((await state(page)).layers).toEqual(before.layers)
  await page
    .getByRole('button', { name: 'Align and distribute layers' })
    .click()
  await page
    .getByRole('button', { name: 'Equal horizontal spacing', exact: true })
    .click()
  expect((await state(page)).layers.map((l) => l.bounds.x)).toEqual([
    40, 165, 310,
  ])
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+z')
  expect((await state(page)).layers).toEqual(before.layers)
  await page
    .getByRole('button', { name: 'Align and distribute layers' })
    .click()
  await page.getByLabel('Alignment reference').selectOption('canvas')
  await page.getByRole('button', { name: 'Align left', exact: true }).click()
  expect((await state(page)).layers.map((l) => l.bounds.x)).toEqual([0, 0, 0])
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+z')
  await page
    .getByRole('button', { name: 'Align and distribute layers' })
    .click()
  await expect(page.getByLabel('Alignment reference')).toHaveValue('canvas')
  await page.keyboard.press('Escape')
  const blank = await point(page, 500, 250)
  await page.mouse.click(blank.x, blank.y)
  const screen = await point(page, 325, 200)
  await page.mouse.click(screen.x, screen.y)
  await page
    .getByRole('button', { name: 'Align and distribute layers' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Equal horizontal spacing', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Align right', exact: true }).click()
  expect((await state(page)).layers[2]?.bounds.x).toBe(570)
})

test('screen tolerance remains consistent at 50% and 200% zoom on a high DPI display', async ({
  page,
}) => {
  await openLayers(page)
  await page.getByLabel('Snap to canvas', { exact: true }).check()
  for (const zoom of [50, 200]) {
    await page
      .getByRole('slider', { name: 'Zoom' })
      .evaluate((element, value) => {
        const input = element as HTMLInputElement
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, zoom)
    await expect(
      page.getByRole('contentinfo').getByText(`${zoom}%`, { exact: true }),
    ).toBeVisible()
    // Deselect first so small shapes' resize/radius handles do not capture the press.
    const canvas = await page.getByLabel('Document canvas').boundingBox()
    if (!canvas) throw new Error('No canvas')
    await page.mouse.click(canvas.x + 12, canvas.y + 12)
    await dragPreview(
      page,
      { x: 325, y: 200 },
      { x: 300 + 3 / (zoom / 100), y: 200 },
      // Capture directly so an earlier edge lock does not affect this tolerance check.
      1,
    )
    await expect
      .poll(async () => (await state(page)).layers[2]?.bounds.x)
      .toBe(285)
    await expect.poll(() => hasGuide(page, 300, 150)).toBe(true)
    await page.mouse.up()
    await page.keyboard.press('Control+z')
    expect((await state(page)).layers[2]?.bounds.x).toBe(310)
  }
})
