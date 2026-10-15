import { selectEditorTool } from './helpers/tools'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('rectangle selection clips raster painting and selection undo restores unrestricted painting', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('button', { name: 'New document…' }).click()
  await page.getByLabel('Width (px)').fill('128')
  await page.getByLabel('Height (px)').fill('96')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.keyboard.press('Control+1')
  await expect(page.getByRole('contentinfo').getByText('100%', { exact: true })).toBeVisible()
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Document canvas unavailable')
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.getByTitle('Rectangle selection (M)').click()
  await page.mouse.move(center.x - 10, center.y - 10)
  await page.mouse.down()
  await page.mouse.move(center.x + 10, center.y + 10)
  await page.mouse.up()
  await selectEditorTool(page, 'Pencil tool (N)')
  await page.mouse.click(center.x + 25, center.y)
  await page.mouse.click(center.x, center.y)
  await expect(await exportedAlpha(page, 64, 48)).toBe(255)
  await expect(await exportedAlpha(page, 89, 48)).toBe(0)
  await page.keyboard.press('Control+z') // painted pixel
  await page.keyboard.press('Control+z') // selection
  await page.mouse.click(center.x + 25, center.y)
  await expect(await exportedAlpha(page, 89, 48)).toBe(255)
})

for (const selectionTool of ['Rectangle selection tool (M)', 'Freehand lasso tool (L)']) {
  test(`${selectionTool} click clears the previous selection and undo restores it`, async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('button', { name: 'New document…' }).click()
    await page.getByLabel('Width (px)').fill('64')
    await page.getByLabel('Height (px)').fill('64')
    await page.getByRole('button', { name: 'Create' }).click()
    await page.keyboard.press('Control+1')
    const box = await page.getByLabel('Document canvas').boundingBox()
    if (!box) throw new Error('Document canvas unavailable')
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await selectEditorTool(page, selectionTool)
    await page.mouse.move(x - 12, y - 12); await page.mouse.down()
    if (selectionTool.startsWith('Freehand')) {
      await page.mouse.move(x + 12, y - 12, { steps: 4 })
      await page.mouse.move(x - 12, y + 12, { steps: 4 })
    } else await page.mouse.move(x + 12, y + 12)
    await page.mouse.up()

    await page.mouse.click(x, y)
    await selectEditorTool(page, 'Pencil tool (N)')
    await page.mouse.click(x + 20, y)
    expect(await exportedAlpha(page, 52, 32)).toBe(255)
    await page.keyboard.press('Control+z') // painted pixel
    await page.keyboard.press('Control+z') // click-to-deselect
    await page.mouse.click(x + 20, y)
    expect(await exportedAlpha(page, 52, 32)).toBe(0)
  })
}

async function exportedAlpha(page: import('@playwright/test').Page, x: number, y: number): Promise<number> {
  await page.getByRole('button', { name: 'File' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  const path = await (await downloadPromise).path()
  if (!path) throw new Error('PNG download unavailable')
  const bytes = await readFile(path)
  return page.evaluate(async ({ bytes, x, y }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    return context.getImageData(x, y, 1, 1).data[3] ?? 0
  }, { bytes: [...bytes], x, y })
}
