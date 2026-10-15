import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('group adjustment targets grouped layers and exports their result', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 16)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await page.getByRole('button', { name: 'Group selected layers' }).click()
  await page.getByRole('button', { name: 'Collapse Group', exact: true }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Expand Group', exact: true }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(2)
  await page.getByLabel('Adjustment type').selectOption({ label: 'Invert' })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Apply' }).click()
  expect(await pixel(page)).toEqual([0, 255, 255, 255])
  await page.keyboard.press('Control+z')
  expect(await pixel(page)).toEqual([255, 0, 0, 255])
})

async function pixel(page: import('@playwright/test').Page): Promise<number[]> {
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
    return [...context.getImageData(8, 8, 1, 1).data]
  }, [...bytes])
}
