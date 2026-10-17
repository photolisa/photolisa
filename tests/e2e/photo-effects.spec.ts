import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }) }) })
async function source(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 128, 96); g.addColorStop(0, '#e1842b'); g.addColorStop(0.5, '#548d78'); g.addColorStop(1, '#253c9e'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 96)
    ctx.fillStyle = '#e2ddcb'; ctx.beginPath(); ctx.arc(74, 42, 18, 0, Math.PI * 2); ctx.fill()
    ctx.clearRect(0, 0, 8, 96)
    const blob = await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type="file"]').setInputFiles({ name: 'effects-fixture.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await expect(page.getByRole('tab', { name: 'effects-fixture', exact: true })).toBeVisible()
}
async function open(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Effects', exact: true }).click()
  await page.getByRole('button', { name: 'Browse effects…' }).click()
  await expect(page.getByRole('dialog', { name: 'Photo Effects' })).toBeVisible()
}
async function add(page: Page, label: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Photo Effects' })
  await dialog.getByRole('button', { name: 'library', exact: true }).click()
  await dialog.getByRole('searchbox', { name: 'Search effects' }).fill(label)
  await dialog.getByRole('button', { name: `Preview ${label}`, exact: true }).click()
}
async function waitPreview(page: Page): Promise<void> { await expect(page.getByLabel('Document canvas')).toHaveAttribute('aria-busy', 'false') }
async function exportedPixels(page: Page): Promise<number[]> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export PNG/ }).click()
  const path = await (await download).path(); if (!path) throw new Error('No export')
  const bytes = await readFile(path)
  return page.evaluate(async b => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(b)], { type: 'image/png' })), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height
    const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return [...ctx.getImageData(0, 0, c.width, c.height).data]
  }, [...bytes])
}

test('effects are editable, comparable, undoable, export correctly, and persist in native projects', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await source(page)
  const original = await exportedPixels(page)
  await open(page)
  await add(page, 'Vignette')
  const dialog = page.getByRole('dialog', { name: 'Photo Effects' })
  await dialog.getByRole('spinbutton', { name: 'Amount', exact: true }).fill('0.85')
  await dialog.getByRole('spinbutton', { name: 'Effect opacity (%)' }).fill('80')
  await waitPreview(page)
  await expect(page.getByLabel('Document canvas')).toHaveScreenshot('vignette-canvas.png', { maxDiffPixelRatio: 0.01 })
  await dialog.getByRole('button', { name: 'Show Before', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Original layer without effects')
  await dialog.getByRole('button', { name: 'Show After', exact: true }).click()
  await add(page, 'Film Grain')
  await waitPreview(page)
  await dialog.getByRole('button', { name: /presets/i, exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Preset name' }).fill('My film')
  await dialog.getByRole('button', { name: 'Save preset' }).click()
  await expect(dialog.getByRole('button', { name: 'My film', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  const effected = await exportedPixels(page)
  expect(effected).not.toEqual(original)
  for (let i = 3; i < original.length; i += 4) expect(effected[i]).toBe(original[i])
  await page.keyboard.press('Control+z')
  expect(await exportedPixels(page)).toEqual(original)
  await page.keyboard.press('Control+Shift+z')
  expect(await exportedPixels(page)).toEqual(effected)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Save project/ }).click()
  const path = await (await download).path(); if (!path) throw new Error('No project')
  await page.getByRole('button', { name: 'Close effects-fixture', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'reopened.photolisa', mimeType: 'application/x-photolisa', buffer: await readFile(path) })
  expect(await exportedPixels(page)).toEqual(effected)
  await open(page)
  await dialog.getByRole('button', { name: /stack/i, exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Vignette', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Film Grain', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Vignette', exact: true }).click()
  await expect(dialog.getByRole('spinbutton', { name: 'Amount', exact: true })).toHaveValue('0.85')
  await dialog.getByRole('button', { name: 'presets', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'My film', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(errors).toEqual([])
})

test('cancel restores pixels and presets survive opening the panel again', async ({ page }) => {
  await source(page)
  const original = await exportedPixels(page)
  await open(page)
  await add(page, 'Glow / Bloom')
  const dialog = page.getByRole('dialog', { name: 'Photo Effects' })
  await dialog.getByRole('spinbutton', { name: 'Intensity', exact: true }).fill('1.4')
  await waitPreview(page)
  await expect(dialog).toHaveScreenshot('glow-controls.png', { maxDiffPixelRatio: 0.01 })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedPixels(page)).toEqual(original)
  await page.keyboard.press('Control+Shift+f')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'presets', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Preset name' }).fill('empty')
  await expect(dialog.getByRole('button', { name: 'Save preset', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('GPU adjustments agree with the CPU reference on large translucent images', async ({ page }) => {
  await page.goto('/')
  const differences = await page.evaluate(async () => {
    const gpuPath = '/src/raster/EffectGpuProcessor.ts', filterPath = '/src/core/filters/FilterRegistry.ts'
    const { EffectGpuProcessor } = await import(gpuPath), { filterRegistry } = await import(filterPath), gpu = new EffectGpuProcessor()
    const input = { width: 512, height: 512, data: new Uint8ClampedArray(512 * 512 * 4) }
    for (let i = 0; i < input.data.length; i++) input.data[i] = (i * 37 + Math.floor(i / 64)) % 256
    const cases = [filterRegistry.create('brightness-contrast', { brightness: 0.12, contrast: 0.23 }), filterRegistry.create('exposure', { stops: 0.6 }), filterRegistry.create('saturation', { amount: -0.4 }), filterRegistry.create('temperature', { amount: 0.6 }), filterRegistry.create('sepia'), filterRegistry.create('levels', { gamma: 1.3, inputBlack: 12, inputWhite: 230 }), filterRegistry.create('gaussian-blur', { radius: 3 })]
    return cases.map(effect => {
      const accelerated = gpu.process(input, effect)
      if (!accelerated) throw new Error('WebGL2 acceleration did not initialize')
      const cpu = filterRegistry.apply(input, [effect]); let difference = 0
      for (let i = 0; i < cpu.data.length; i++) difference = Math.max(difference, Math.abs(cpu.data[i] - accelerated.data[i]))
      return difference
    })
  })
  expect(differences.every(d => d <= 1)).toBe(true)
})

test('selection effects retain outside pixels and group effects survive PSD export', async ({ page }) => {
  await source(page)
  const original = await exportedPixels(page)
  await page.evaluate(async () => {
    const editorPath = '/src/composables/useEditor.ts', maskPath = '/src/core/selection/SelectionMask.ts'
    const { editorCore } = await import(editorPath), { SelectionMask } = await import(maskPath)
    editorCore.setSelection(SelectionMask.rectangle(128, 96, { x: 32, y: 24, width: 64, height: 48 }))
  })
  await open(page)
  const dialog = page.getByRole('dialog', { name: 'Photo Effects' })
  await expect(dialog.getByRole('checkbox', { name: 'New effects: selected area only' })).toBeChecked()
  await add(page, 'Invert')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  const selected = await exportedPixels(page)
  expect(selected.slice((40 * 128 + 60) * 4, (40 * 128 + 60) * 4 + 3)).toEqual(original.slice((40 * 128 + 60) * 4, (40 * 128 + 60) * 4 + 3).map(c => 255 - c))
  expect(selected.slice((10 * 128 + 20) * 4, (10 * 128 + 20) * 4 + 4)).toEqual(original.slice((10 * 128 + 20) * 4, (10 * 128 + 20) * 4 + 4))
  await page.getByRole('button', { name: 'Group selected layers' }).click()
  await open(page); await add(page, 'Film Fade'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  const grouped = await exportedPixels(page)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PSD…' }).click()
  const path = await (await download).path(); if (!path) throw new Error('No PSD export')
  await page.locator('input[type="file"]').setInputFiles({ name: 'effects.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: await readFile(path) })
  const restored = await exportedPixels(page)
  expect(restored).toEqual(grouped)
})

test('every library effect exports the same result as its processor', async ({ page }) => {
  await source(page)
  const differences = await page.evaluate(async () => {
    const editorPath = '/src/composables/useEditor.ts', filtersPath = '/src/core/filters/FilterRegistry.ts', exportPath = '/src/adapters/ImageExportAdapter.ts', sourcesPath = '/src/raster/RasterSourceRegistry.ts'
    const { editorCore } = await import(editorPath), { filterRegistry } = await import(filtersPath), { ImageExportAdapter } = await import(exportPath), { rasterSources } = await import(sourcesPath)
    const doc = editorCore.document, layer = editorCore.layers.find(doc.activeLayerId), source = rasterSources.get(layer.pixelSourceId)
    const c = document.createElement('canvas'); c.width = source.width; c.height = source.height; const ctx = c.getContext('2d')!; ctx.drawImage(source.image, 0, 0)
    const pixels = ctx.getImageData(0, 0, c.width, c.height), input = { data: pixels.data, width: c.width, height: c.height }, exporter = new ImageExportAdapter(), result: string[] = []
    try {
      for (const definition of filterRegistry.list()) {
        const effect = filterRegistry.create(definition.kind)
        editorCore.adjustments.replace(layer.id, [effect])
        const expected = filterRegistry.apply(input, [effect]).data
        const actual = (await exporter.renderDocument(doc)).readPixels().data
        let max = 0
        for (let i = 0; i < actual.length; i++) { const channel = i % 4, alphaIndex = i - channel + 3; const a = channel === 3 ? actual[i] : actual[i] * actual[alphaIndex] / 255; const b = channel === 3 ? expected[i] : expected[i] * expected[alphaIndex] / 255; max = Math.max(max, Math.abs(a - b)) }
        if (max > 2) result.push(`${definition.kind}: ${max}`)
      }
    } finally { exporter.destroy(); editorCore.adjustments.replace(layer.id, []) }
    return result
  })
  expect(differences).toEqual([])
})
