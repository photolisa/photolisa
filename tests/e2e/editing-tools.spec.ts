import { selectEditorTool } from './helpers/tools'
import { expect, test, type Page } from '@playwright/test'

async function createDocument(page: Page, width = 128, height = 96): Promise<void> {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /New document/ }).click()
  await page.getByLabel('Name').fill('Tool Test')
  await page.getByLabel('Width (px)').fill(String(width))
  await page.getByLabel('Height (px)').fill(String(height))
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText(`${width} × ${height} px`).first()).toBeVisible()
}

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Document canvas has no bounds')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

async function thumbnailRed(page: Page): Promise<number> {
  return page.getByLabel('Layer 1 thumbnail').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Thumbnail canvas is unavailable')
    return context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[0] ?? 255
  })
}

async function setZoom(page: Page, percent: number): Promise<void> {
  await page.getByRole('slider', { name: 'Zoom' }).evaluate((element, value) => {
    const input = element as HTMLInputElement
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, percent)
  await expect(page.getByRole('contentinfo').getByText(`${percent}%`, { exact: true })).toBeVisible()
}

test('brush and eraser edit one raster layer with undo at multiple zoom levels', async ({ page }) => {
  await createDocument(page)
  await page.getByTitle('Brush (B)').click()
  const center = await canvasCenter(page)

  for (const zoom of [25, 100, 200, 400]) {
    await setZoom(page, zoom)
    await page.mouse.click(center.x, center.y)
    await expect.poll(() => thumbnailRed(page)).toBeLessThan(100)
    await page.keyboard.press('Control+z')
    await expect.poll(() => thumbnailRed(page)).toBeGreaterThan(150)
  }

  await setZoom(page, 100)
  await page.mouse.move(center.x - 18, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 18, center.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => thumbnailRed(page)).toBeLessThan(100)

  await page.getByTitle('Eraser (E)').click()
  await page.mouse.click(center.x, center.y)
  await expect.poll(() => thumbnailRed(page)).toBeGreaterThan(150)
  await page.keyboard.press('Control+z')
  await expect.poll(() => thumbnailRed(page)).toBeLessThan(100)
})

test('locked and hidden layers reject raster edits', async ({ page }) => {
  await createDocument(page)
  const center = await canvasCenter(page)
  await page.getByTitle('Brush (B)').click()

  await page.getByLabel('Lock Layer 1').click()
  await page.mouse.click(center.x, center.y)
  await expect(page.getByRole('alert')).toContainText('visible, unlocked raster layer')
  await expect.poll(() => thumbnailRed(page)).toBeGreaterThan(150)
  await page.getByLabel('Dismiss error').click()

  await page.getByLabel('Unlock Layer 1').click()
  await page.getByLabel('Hide Layer 1').click()
  await page.mouse.click(center.x, center.y)
  await expect(page.getByRole('alert')).toContainText('visible, unlocked raster layer')
  await expect.poll(() => thumbnailRed(page)).toBeGreaterThan(150)
})

test('move, transform, and crop commit as undoable document edits', async ({ page }) => {
  await createDocument(page)
  const center = await canvasCenter(page)

  await page.getByTitle('Move (V)').click()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 16, center.y + 10)
  await page.mouse.up()
  await expect(page.getByTestId('layer-position')).toHaveText('16, 10 px')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('layer-position')).toHaveText('0, 0 px')

  await page.keyboard.press('Control+t')
  await expect(page.getByText('transform', { exact: true })).toBeVisible()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 12, center.y + 8)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByTestId('layer-position')).toHaveText('12, 8 px')
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('layer-position')).toHaveText('0, 0 px')

  await selectEditorTool(page, 'Crop tool (C)')
  await page.mouse.move(center.x + 64, center.y + 48)
  await page.mouse.down()
  await page.mouse.move(center.x + 20, center.y + 15)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('84 × 63 px').first()).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.getByText('128 × 96 px').first()).toBeVisible()
})

test('Escape cancels a live layer move without leaving an untracked change', async ({ page }) => {
  await createDocument(page)
  const center = await canvasCenter(page)
  await page.getByTitle('Move (V)').click()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 24, center.y + 12)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.getByTestId('layer-position')).toHaveText('0, 0 px')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo', exact: false })).toBeDisabled()
})

test('move tool can auto-select a transformed vector layer by clicking it', async ({ page }) => {
  await createDocument(page)
  const center = await canvasCenter(page)
  await page.getByRole('button', { name: 'Rectangle tool', exact: true }).click()
  await page.mouse.move(center.x - 25, center.y - 15)
  await page.mouse.down()
  await page.mouse.move(center.x + 25, center.y + 15)
  await page.mouse.up()
  await expect(page.getByLabel('Vector geometry')).toBeVisible()
  await page.getByLabel('Layer 1 thumbnail').click()
  await expect(page.getByLabel('Vector geometry')).toHaveCount(0)
  await page.getByRole('button', { name: 'Move tool (V)' }).click()
  await page.getByLabel('Auto-select layer').check()
  await page.mouse.click(center.x, center.y)
  await expect(page.getByLabel('Vector geometry')).toBeVisible()
})

test('optional canvas snapping keeps a near-centered layer aligned', async ({ page }) => {
  await createDocument(page)
  const center = await canvasCenter(page)
  await page.getByRole('button', { name: 'Rectangle tool', exact: true }).click()
  await page.mouse.move(center.x - 25, center.y - 15)
  await page.mouse.down()
  await page.mouse.move(center.x + 25, center.y + 15)
  await page.mouse.up()
  const position = page.getByTestId('layer-position')
  const initial = await position.textContent()
  await page.getByRole('button', { name: 'Move tool (V)' }).click()
  await page.getByLabel('Snap to canvas').check()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 4, center.y + 4)
  await page.mouse.up()
  await expect(position).toHaveText(initial ?? '')
  await page.getByLabel('Snap to canvas').uncheck()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 4, center.y + 4)
  await page.mouse.up()
  await expect(position).not.toHaveText(initial ?? '')
})
