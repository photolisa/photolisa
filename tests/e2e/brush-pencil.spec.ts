import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function createDocument(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /New document/ }).click()
  await page.getByLabel('Name').fill('Pixel Test')
  await page.getByLabel('Width (px)').fill('16')
  await page.getByLabel('Height (px)').fill('16')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('slider', { name: 'Zoom' }).evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = '400'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.getByRole('contentinfo').getByText('400%', { exact: true })).toBeVisible()
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Canvas has no bounds')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

async function exportPixels(page: Page): Promise<number[]> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PNG/ }).click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('PNG download has no path')
  const bytes = [...await readFile(path)]
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return [...context.getImageData(0, 0, canvas.width, canvas.height).data]
  }, bytes)
}

function pixel(data: number[], x: number, y: number): number[] { return data.slice((y * 16 + x) * 4, (y * 16 + x + 1) * 4) }

for (const tool of ['n', 'b']) test(`${tool === 'b' ? 'brush' : 'pencil'} leaves hidden pixels outside the document untouched`, async ({ page }) => {
  const center = await createDocument(page)
  await page.keyboard.press('n')
  await page.getByLabel('Primary color').fill('#ff0000')
  await page.mouse.click(center.x + 2, center.y + 2)
  await page.keyboard.press('v')
  await page.mouse.move(center.x + 2, center.y + 2)
  await page.mouse.down()
  await page.mouse.move(center.x + 18, center.y + 2, { steps: 4 })
  await page.mouse.up()

  await page.keyboard.press(tool)
  await page.getByLabel('Primary color').fill('#0000ff')
  if (tool === 'b') {
    await page.locator('.option').filter({ hasText: 'Size' }).getByRole('slider').evaluate(element => {
      const input = element as HTMLInputElement
      input.value = '3'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  // This point is outside the document, but inside the moved layer's bitmap.
  await page.mouse.click(center.x + 42, center.y - 22)
  // An entirely hidden stroke must not add an undo entry.
  await page.keyboard.press('Control+z')
  expect(pixel(await exportPixels(page), 8, 8)).toEqual([255, 0, 0, 255])
  await page.keyboard.press('Control+Shift+z')
  await page.mouse.move(center.x + 42, center.y - 14)
  await page.mouse.down()
  await page.mouse.move(center.x + 26, center.y - 14, { steps: 4 })
  await page.mouse.up()
  const visible = await exportPixels(page)
  expect(pixel(visible, 14, 4)[3]).toBeGreaterThan(0)
  expect(pixel(visible, 15, 4)[3]).toBeGreaterThan(0)

  // Bring the hidden bitmap area back into view to detect invisible edits.
  await page.keyboard.press('v')
  await page.mouse.move(center.x + 18, center.y + 2)
  await page.mouse.down()
  await page.mouse.move(center.x + 2, center.y + 2, { steps: 4 })
  await page.mouse.up()
  const revealed = await exportPixels(page)
  expect(pixel(revealed, 8, 8)).toEqual([255, 0, 0, 255])
  expect(pixel(revealed, 10, 4)[3]).toBeGreaterThan(0)
  expect(pixel(revealed, 11, 4)[3]).toBeGreaterThan(0)
  for (let x = 12; x < 16; x++) {
    expect(pixel(revealed, x, 2)[3]).toBe(0)
    expect(pixel(revealed, x, 4)[3]).toBe(0)
  }
})

for (const tool of ['n', 'b']) test(`${tool === 'b' ? 'brush' : 'pencil'} paints exposed checkerboard on moved layers with undo/redo`, async ({ page }) => {
  const center = await createDocument(page)
  await page.keyboard.press('n')
  await page.getByLabel('Primary color').fill('#ff0000')
  await page.mouse.click(center.x + 2, center.y + 2)
  await page.keyboard.press('v')
  await page.mouse.move(center.x + 2, center.y + 2)
  await page.mouse.down()
  await page.mouse.move(center.x + 18, center.y + 2, { steps: 4 })
  await page.mouse.up()
  expect(pixel(await exportPixels(page), 12, 8)).toEqual([255, 0, 0, 255])

  await page.keyboard.press('n')
  await page.getByLabel('Primary color').fill('#0000ff')
  await page.mouse.move(center.x - 26, center.y - 6)
  await page.mouse.down()
  await page.mouse.move(center.x - 6, center.y - 6)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  const cancelled = await exportPixels(page)
  expect(pixel(cancelled, 1, 6)[3]).toBe(0)
  expect(pixel(cancelled, 12, 8)).toEqual([255, 0, 0, 255])
  await page.keyboard.press(tool)
  if (tool === 'b') {
    await page.locator('.option').filter({ hasText: 'Size' }).getByRole('slider').evaluate(element => {
      const input = element as HTMLInputElement
      input.value = '1'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  // Begin in the document area exposed by moving the layer four pixels right.
  await page.mouse.move(center.x - 26, center.y - 6)
  await page.mouse.down()
  await page.mouse.move(center.x - 6, center.y - 6, { steps: 5 })
  await page.mouse.up()
  let pixels = await exportPixels(page)
  for (let x = 1; x <= 6; x++) expect(pixel(pixels, x, 6)).toEqual([0, 0, 255, 255])
  expect(pixel(pixels, 12, 8)).toEqual([255, 0, 0, 255])
  await page.keyboard.press('Control+z')
  pixels = await exportPixels(page)
  expect(pixel(pixels, 1, 6)[3]).toBe(0)
  expect(pixel(pixels, 12, 8)).toEqual([255, 0, 0, 255])
  await page.keyboard.press('Control+Shift+z')
  expect(pixel(await exportPixels(page), 1, 6)).toEqual([0, 0, 255, 255])
})

test('pencil draws exact source pixels and undo/redo restores them', async ({ page }) => {
  const center = await createDocument(page)
  await page.keyboard.press('n')
  await expect(page.getByTitle('Pencil (N)')).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Primary color').fill('#ff0000')
  await page.getByLabel('Secondary color', { exact: true }).fill('#0000ff')
  await page.getByLabel('Pixel grid').check()
  await expect.poll(() => page.locator('canvas.z-20').last().evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
    return pixels ? pixels.some((channel, index) => index % 4 === 3 && channel > 0) : false
  })).toBe(true)
  await page.mouse.move(center.x - 14, center.y + 2)
  await page.mouse.down()
  await page.mouse.move(center.x + 14, center.y + 2, { steps: 2 })
  await page.mouse.up()
  let pixels = await exportPixels(page)
  for (let x = 4; x <= 11; x++) expect(pixel(pixels, x, 8)).toEqual([255, 0, 0, 255])
  expect(pixel(pixels, 3, 8)[3]).toBe(0)
  expect(pixel(pixels, 8, 7)[3]).toBe(0)
  await page.keyboard.press('Control+z')
  pixels = await exportPixels(page)
  expect(pixel(pixels, 8, 8)[3]).toBe(0)
  await page.keyboard.press('Control+Shift+z')
  pixels = await exportPixels(page)
  expect(pixel(pixels, 8, 8)).toEqual([255, 0, 0, 255])
  await page.keyboard.press('x')
  await expect(page.getByLabel('Primary color')).toHaveValue('#0000ff')
})

test('Escape cancels an interrupted stroke without leaving pixels or history', async ({ page }) => {
  const center = await createDocument(page)
  await page.keyboard.press('n')
  await page.mouse.move(center.x + 2, center.y + 2)
  await page.mouse.down()
  await page.mouse.move(center.x + 10, center.y + 2)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  const pixels = await exportPixels(page)
  expect(pixel(pixels, 8, 8)[3]).toBe(0)
  expect(pixel(pixels, 10, 8)[3]).toBe(0)
})

test('brush flow builds coverage without exceeding stroke opacity', async ({ page }) => {
  const center = await createDocument(page)
  await page.getByTitle('Brush (B)').click()
  await page.getByLabel('Primary color').fill('#ff0000')
  await page.locator('.option').filter({ hasText: 'Opacity' }).getByRole('slider').evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = '0.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByLabel('Flow').evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = '0.25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.mouse.move(center.x + 2, center.y + 2)
  await page.mouse.down()
  await page.mouse.move(center.x + 6, center.y + 2)
  await page.mouse.move(center.x + 2, center.y + 2)
  await page.mouse.up()
  const pixels = await exportPixels(page)
  const drawn = pixel(pixels, 8, 8)
  expect(drawn[0]).toBe(255)
  expect(drawn[3]).toBeGreaterThan(0)
  expect(drawn[3]).toBeLessThanOrEqual(128)
})
