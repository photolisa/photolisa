import { selectEditorTool } from './helpers/tools'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('selection fill, cut, paste, and undo preserve alpha', async ({ page }) => {
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
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await selectEditorTool(page, 'Ellipse selection tool')
  await page.mouse.move(center.x - 12, center.y - 12)
  await page.mouse.down(); await page.mouse.move(center.x + 12, center.y + 12); await page.mouse.up()
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('button', { name: 'Fill selection' }).click()
  expect(await alphaAt(page, 32, 32)).toBe(255)
  expect(await alphaAt(page, 21, 21)).toBe(0)
  await page.keyboard.press('Control+x')
  expect(await alphaAt(page, 32, 32)).toBe(0)
  await page.keyboard.press('Control+z')
  expect(await alphaAt(page, 32, 32)).toBe(255)
  await page.keyboard.press('Control+v')
  expect(await alphaAt(page, 32, 32)).toBe(255)
})

test('freehand lasso clips edits to its polygon at actual zoom', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('button', { name: 'New document…' }).click()
  await page.getByLabel('Width (px)').fill('64'); await page.getByLabel('Height (px)').fill('64')
  await page.getByRole('button', { name: 'Create' }).click(); await page.keyboard.press('Control+1')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Document canvas unavailable')
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await selectEditorTool(page, 'Freehand lasso tool (L)')
  await page.mouse.move(cx - 12, cy - 12); await page.mouse.down()
  await page.mouse.move(cx + 12, cy - 12, { steps: 5 })
  await page.mouse.move(cx - 12, cy + 12, { steps: 5 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Edit' }).click(); await page.getByRole('button', { name: 'Fill selection' }).click()
  expect(await alphaAt(page, 28, 28)).toBe(255)
  expect(await alphaAt(page, 40, 40)).toBe(0)
})

async function alphaAt(page: import('@playwright/test').Page, x: number, y: number): Promise<number> {
  await page.getByRole('button', { name: 'File' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  const path = await (await download).path()
  if (!path) throw new Error('PNG download unavailable')
  const bytes = await readFile(path)
  return page.evaluate(async ({ bytes, x, y }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    return context.getImageData(x, y, 1, 1).data[3] ?? 0
  }, { bytes: [...bytes], x, y })
}
