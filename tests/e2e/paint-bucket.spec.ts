import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('paint bucket fills a contiguous color with undo and redo', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 32, 64)
    context.fillStyle = '#0000ff'; context.fillRect(32, 0, 32, 64)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await page.keyboard.press('Control+1')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Document canvas unavailable')
  await page.getByRole('button', { name: 'Paint bucket tool' }).click()
  await page.mouse.click(box.x + box.width / 2 - 16, box.y + box.height / 2)
  expect(await pixels(page)).toEqual([[0, 0, 0, 255], [0, 0, 255, 255]])
  await page.keyboard.press('Control+z')
  expect(await pixels(page)).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]])
  await page.keyboard.press('Control+Shift+z')
  expect(await pixels(page)).toEqual([[0, 0, 0, 255], [0, 0, 255, 255]])
})

test('paint bucket clips translucent fill to a marquee on transparent pixels', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'transparent.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await page.keyboard.press('Control+1')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Document canvas unavailable')
  const x = box.x + box.width / 2; const y = box.y + box.height / 2
  await page.getByRole('button', { name: 'Rectangle selection tool' }).click()
  await page.mouse.move(x - 31, y - 31); await page.mouse.down(); await page.mouse.move(x - 1, y + 31); await page.mouse.up()
  await page.getByRole('button', { name: 'Paint bucket tool' }).click()
  await page.getByLabel('Bucket opacity').fill('0.5')
  await page.mouse.click(x - 16, y)
  expect(await pixels(page)).toEqual([[0, 0, 0, 128], [0, 0, 0, 0]])
  await page.keyboard.press('Control+z')
  expect(await pixels(page)).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]])
})

async function pixels(page: import('@playwright/test').Page): Promise<number[][]> {
  await page.getByRole('button', { name: 'File' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  const path = await (await download).path()
  if (!path) throw new Error('PNG download unavailable')
  const bytes = await readFile(path)
  return page.evaluate(async (input) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(input)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    return [8, 48].map((x) => [...context.getImageData(x, 32, 1, 1).data])
  }, [...bytes])
}
