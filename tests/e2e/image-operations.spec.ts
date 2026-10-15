import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('resize, canvas size, and rotate preserve exported pixels through undo and redo', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 4
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 4, 4)
    context.fillStyle = '#0000ff'; context.fillRect(4, 0, 4, 4)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await page.getByRole('button', { name: 'Image' }).click()
  await page.getByRole('button', { name: 'Image size…' }).click()
  await page.getByLabel('New width').fill('16')
  await page.getByLabel('New height').fill('8')
  await page.getByLabel('Resampling quality').selectOption('nearest')
  await page.getByRole('dialog', { name: 'Resize image' }).getByRole('button', { name: 'Apply' }).click()
  expect(await exportImage(page)).toMatchObject({ width: 16, height: 8, left: [255, 0, 0, 255], right: [0, 0, 255, 255] })
  await page.keyboard.press('Control+z')
  expect(await exportImage(page)).toMatchObject({ width: 8, height: 4, left: [255, 0, 0, 255], right: [0, 0, 255, 255] })
  await page.keyboard.press('Control+Shift+z')
  await page.getByRole('button', { name: 'Image' }).click()
  await page.getByRole('button', { name: 'Canvas size…' }).click()
  await page.getByLabel('New width').fill('20')
  await page.getByLabel('New height').fill('12')
  await page.getByRole('dialog', { name: 'Canvas size' }).getByRole('button', { name: 'Apply' }).click()
  const expanded = await exportImage(page)
  expect(expanded).toMatchObject({ width: 20, height: 12 })
  expect(expanded.corner).toEqual([0, 0, 0, 0])
  await page.getByRole('button', { name: 'Image' }).click()
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click()
  expect(await exportImage(page)).toMatchObject({ width: 12, height: 20 })
  await page.keyboard.press('Control+z')
  expect(await exportImage(page)).toMatchObject({ width: 20, height: 12 })
})

async function exportImage(page: import('@playwright/test').Page) {
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
    const at = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data]
    return { width: canvas.width, height: canvas.height, left: at(Math.floor(canvas.width * .25), Math.floor(canvas.height / 2)),
      right: at(Math.floor(canvas.width * .75), Math.floor(canvas.height / 2)), corner: at(0, 0) }
  }, [...bytes])
}
