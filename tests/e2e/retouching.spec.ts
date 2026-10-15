import { selectEditorTool } from './helpers/tools'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('clone sample and spot repair create undoable raster changes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File' }).click(); await page.getByRole('button', { name: 'New document…' }).click()
  await page.getByLabel('Width (px)').fill('64'); await page.getByLabel('Height (px)').fill('64')
  await page.getByRole('button', { name: 'Create' }).click(); await page.keyboard.press('Control+1')
  await page.keyboard.press('Control+a')
  await page.getByRole('button', { name: 'Edit' }).click(); await page.getByRole('button', { name: 'Fill selection' }).click()
  await page.keyboard.press('Control+d')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Document canvas unavailable')
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await selectEditorTool(page, 'Pencil tool')
  await page.getByLabel('Primary color').fill('#ff0000')
  await page.mouse.click(cx, cy)
  expect((await rgbaAt(page, 32, 32))[0]).toBe(255)
  await page.getByRole('button', { name: 'Clone stamp tool' }).click()
  await page.locator('.option').filter({ hasText: 'Size' }).getByRole('slider').fill('1')
  await page.keyboard.down('Alt'); await page.mouse.click(cx, cy); await page.keyboard.up('Alt')
  await page.mouse.click(cx + 10, cy)
  expect((await rgbaAt(page, 42, 32))[0]).toBeGreaterThan(0)
  await page.keyboard.press('Control+z')
  expect((await rgbaAt(page, 42, 32))[3]).toBe(255)
  expect((await rgbaAt(page, 42, 32))[0]).toBe(0)
  await selectEditorTool(page, 'Spot repair tool')
  await page.locator('.option').filter({ hasText: 'Size' }).getByRole('slider').fill('7')
  await page.mouse.click(cx, cy)
  expect((await rgbaAt(page, 32, 32))[0]).toBe(0)
  await page.keyboard.press('Control+z')
  expect((await rgbaAt(page, 32, 32))[0]).toBe(255)
})

async function rgbaAt(page: import('@playwright/test').Page, x: number, y: number): Promise<number[]> {
  const pixels = await exportPixels(page)
  return pixels.slice((y * 64 + x) * 4, (y * 64 + x + 1) * 4)
}

async function exportPixels(page: import('@playwright/test').Page): Promise<number[]> {
  await page.getByRole('button', { name: 'File' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  const path = await (await download).path()
  if (!path) throw new Error('PNG download unavailable')
  const bytes = await readFile(path)
  return page.evaluate(async ({ bytes }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    return [...context.getImageData(0, 0, canvas.width, canvas.height).data]
  }, { bytes: [...bytes] })
}
