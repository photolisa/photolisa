import { expect, test } from '@playwright/test'

function bmpIco(): Buffer {
  const size = 4
  const rowBytes = size * 4
  const maskBytes = 4 * size
  const imageBytes = 40 + rowBytes * size + maskBytes
  const file = Buffer.alloc(22 + imageBytes)
  file.writeUInt16LE(1, 2); file.writeUInt16LE(1, 4)
  file[6] = size; file[7] = size
  file.writeUInt16LE(1, 10); file.writeUInt16LE(32, 12)
  file.writeUInt32LE(imageBytes, 14); file.writeUInt32LE(22, 18)
  file.writeUInt32LE(40, 22); file.writeInt32LE(size, 26); file.writeInt32LE(size * 2, 30)
  file.writeUInt16LE(1, 34); file.writeUInt16LE(32, 36)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = 62 + (y * size + x) * 4
    file[offset] = 0; file[offset + 1] = 0; file[offset + 2] = 255; file[offset + 3] = x === 0 ? 0 : 255
  }
  return file
}

test('exports true multi-resolution ICO and imports selected PNG resolution', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('button', { name: 'New document…' }).click()
  await page.getByLabel('Width (px)').fill('64')
  await page.getByLabel('Height (px)').fill('64')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: 'File' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export ICO…' }).click()
  await page.getByRole('dialog', { name: 'Export Windows icon' }).getByText('24 × 24').click()
  await page.getByRole('dialog', { name: 'Export Windows icon' }).getByRole('button', { name: 'Export ICO' }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).toBeTruthy()
  const bytes = await import('node:fs/promises').then((fs) => fs.readFile(path!))
  expect(bytes.readUInt16LE(2)).toBe(1)
  expect(bytes.readUInt16LE(4)).toBe(5)
  const dimensions = Array.from({ length: 5 }, (_, index) => bytes[6 + index * 16] || 256)
  expect(dimensions).toEqual([16, 24, 32, 48, 256])
  await page.locator('input[type=file]').setInputFiles({ name: 'roundtrip.ico', mimeType: 'image/x-icon', buffer: bytes })
  await expect(page.getByRole('dialog', { name: 'Open icon resolution' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Open icon resolution' }).getByText('24 × 24 px').click()
  await page.getByRole('button', { name: 'Open resolution' }).click()
  await expect(page.getByText('24 × 24', { exact: false }).last()).toBeVisible()
})

test('imports a transparent BMP-encoded ICO entry', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.locator('input[type=file]').setInputFiles({ name: 'legacy.ico', mimeType: 'image/x-icon', buffer: bmpIco() })
  await expect(page.getByRole('dialog', { name: 'Open icon resolution' })).toBeVisible()
  await expect(page.getByText('BMP · 32 bpp')).toBeVisible()
  await page.getByRole('button', { name: 'Open resolution' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('legacy', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'File' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG…' }).click()
  const download = await downloadPromise
  const downloadedPath = await download.path()
  if (!downloadedPath) throw new Error('PNG download unavailable')
  const png = await import('node:fs/promises').then((fs) => fs.readFile(downloadedPath))
  const alpha = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    return [context.getImageData(0, 0, 1, 1).data[3], context.getImageData(3, 0, 1, 1).data[3]]
  }, [...png])
  expect(alpha).toEqual([0, 255])
})
