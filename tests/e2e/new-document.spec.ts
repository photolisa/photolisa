import { expect, test } from '@playwright/test'

test('creates a new document from the File menu', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Photolisa', { timeout: 60_000 })
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /New document/ }).click()
  await page.getByLabel('Name').fill('Website Hero')
  await page.getByLabel('Width (px)').fill('1440')
  await page.getByLabel('Height (px)').fill('900')
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByText('Website Hero').first()).toBeVisible()
  await expect(page.getByText('1440 × 900 px').first()).toBeVisible()
  await expect(page.getByText('Layer 1')).toBeVisible()
})

test('imports PNG and JPEG files at their original dimensions', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const input = page.locator('input[type="file"]')

  for (const image of [
    { name: 'sample-png.png', mimeType: 'image/png' },
    { name: 'sample-jpeg.jpg', mimeType: 'image/jpeg' },
  ]) {
    const bytes = await page.evaluate(async (mimeType) => {
      const canvas = document.createElement('canvas')
      canvas.width = 7
      canvas.height = 5
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.fillStyle = '#d946ef'
      context.fillRect(0, 0, 7, 5)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Encoding failed')), mimeType)
      })
      return [...new Uint8Array(await blob.arrayBuffer())]
    }, image.mimeType)

    await input.setInputFiles({ name: image.name, mimeType: image.mimeType, buffer: Buffer.from(bytes) })
    await expect(page.getByText(image.name.replace(/\.(png|jpg)$/, '')).first()).toBeVisible()
    await expect(page.getByText('7 × 5 px').first()).toBeVisible()
  }
})
