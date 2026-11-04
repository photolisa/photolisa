import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /New document/ }).click()
  await page.getByLabel('Width (px)').fill('128')
  await page.getByLabel('Height (px)').fill('128')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.keyboard.press('Control+1')
  await page.getByTitle('Brush (B)').click()
  await page.getByLabel('Primary color').fill('#cf392a')
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Canvas unavailable')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}
async function pixels(page: Page): Promise<number[]> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PNG/ }).click()
  const path = await (await download).path()
  if (!path) throw new Error('No PNG download')
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data]
  }, [...await readFile(path)])
}
const alphaSum = (data: number[]) => data.reduce((sum, value, i) => sum + (i % 4 === 3 ? value : 0), 0)

test('all presets paint full-resolution pixels and restore identical strokes on redo', async ({ page }) => {
  test.setTimeout(180_000)
  const center = await setup(page)
  const ids = await page.getByLabel('Brush preset', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))
  expect(ids).toHaveLength(18)
  const blank = await pixels(page)
  expect(alphaSum(blank)).toBe(0)
  for (const id of ids) {
    await page.getByLabel('Brush preset', { exact: true }).selectOption(id)
    await page.locator('.option').filter({ hasText: 'Size' }).getByRole('slider').fill('12')
    await page.mouse.move(center.x - 36, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x + 36, center.y, { steps: 12 })
    await page.mouse.up()
    const painted = await pixels(page)
    expect(alphaSum(painted), id).toBeGreaterThan(0)
    // Corners stay transparent; exports contain document pixels, never overlays.
    expect(painted[3], id).toBe(0)
    await page.keyboard.press('Control+z')
    expect(await pixels(page), `${id} undo`).toEqual(blank)
    await page.keyboard.press('Control+Shift+z')
    expect(await pixels(page), `${id} redo`).toEqual(painted)
    await page.keyboard.press('Control+z')
  }
})

test('airbrush deposits while held and Escape cancels the entire gesture', async ({ page }) => {
  const center = await setup(page)
  await page.getByLabel('Brush preset', { exact: true }).selectOption('airbrush')
  const sourceAlpha = () => page.evaluate(async () => {
    const registryPath = new URL('src/raster/RasterSourceRegistry.ts', document.baseURI).href
    const editorPath = new URL('src/composables/useEditor.ts', document.baseURI).href
    const { rasterSources } = await import(registryPath)
    const { editorCore } = await import(editorPath)
    const layer = editorCore.layers.find(editorCore.document.activeLayerId)
    return rasterSources.getEditableCanvas(layer.pixelSourceId)?.getContext('2d')?.getImageData(64, 64, 1, 1).data[3] ?? 0
  })
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  const initialAlpha = await sourceAlpha()
  await expect.poll(sourceAlpha).toBeGreaterThan(initialAlpha + 10)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(alphaSum(await pixels(page))).toBe(0)
  await page.getByTitle('Brush (B)').click()
  await page.mouse.click(center.x, center.y)
  expect(alphaSum(await pixels(page))).toBeGreaterThan(0)
  await page.keyboard.press('Control+z')
  expect(alphaSum(await pixels(page))).toBe(0)
})


test('preset settings preview, custom dash pattern, and reset stay connected', async ({ page }) => {
  await setup(page)
  await page.getByLabel('Brush preset', { exact: true }).selectOption('dashed')
  await page.getByRole('button', { name: 'Brush settings', exact: true }).click()
  await expect(page.getByLabel('Brush dash length')).toBeVisible()
  await page.getByLabel('Brush dash length').fill('4')
  await page.getByLabel('Brush dash gap').fill('2')
  await expect(page.getByLabel('Brush dash length')).toHaveValue('4')
  const preview = page.getByLabel('Brush stroke preview')
  expect(await preview.evaluate(element => {
    const canvas = element as HTMLCanvasElement
    return canvas.getContext('2d')?.getImageData(0, 0, 280, 72).data.some((value, i) => i % 4 === 3 && value > 0)
  })).toBe(true)
  await page.screenshot({ path: '/tmp/photolisa-brush-settings.png' })
  await page.getByRole('button', { name: 'Reset preset settings' }).click()
  await expect(page.getByLabel('Brush dash length')).toHaveValue('2')
  await expect(page.getByLabel('Brush dash gap')).toHaveValue('1')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Brush dash length')).not.toBeVisible()
  await page.getByLabel('Brush preset', { exact: true }).selectOption('charcoal')
  await page.getByRole('button', { name: 'Brush settings', exact: true }).click()
  await page.getByLabel('Brush texture').fill('0.3')
  await expect(page.getByLabel('Brush texture')).toHaveValue('0.3')
})
