import { expect, test } from '@playwright/test'

test('samples visible and active-layer colors at multiple zoom levels', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /New document/ }).click()
  await page.getByLabel('Name').fill('Color sample')
  await page.getByLabel('Width (px)').fill('128')
  await page.getByLabel('Height (px)').fill('96')
  await page.getByRole('dialog', { name: 'New document' }).locator('select').selectOption('white')
  await page.getByRole('button', { name: 'Create' }).click()
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Canvas has no bounds')
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }

  await page.keyboard.press('i')
  await expect(page.getByRole('button', { name: 'Eyedropper tool (I)' })).toHaveAttribute('aria-pressed', 'true')
  for (const zoom of [25, 100, 200, 400]) {
    await page.getByRole('slider', { name: 'Zoom' }).evaluate((element, value) => {
      const input = element as HTMLInputElement
      input.value = String(value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, zoom)
    await page.mouse.move(center.x, center.y)
    await expect(page.getByText('#FFFFFFFF').first()).toBeVisible()
    await page.mouse.click(center.x, center.y)
    await expect(page.getByTitle('Foreground color')).toContainText('#FFFFFFFF')
  }

  await page.getByTitle('Brush (B)').click()
  await page.getByLabel('Primary color').fill('#ff0000')
  await page.mouse.click(center.x, center.y)
  await page.getByTitle('Eyedropper (I)').click()
  await page.mouse.click(center.x, center.y)
  await expect(page.getByTitle('Foreground color')).toContainText('#FF0000FF')

  await page.getByLabel('Eyedropper sample source').selectOption('active')
  await page.mouse.move(center.x + 100, center.y)
  await page.mouse.click(center.x + 100, center.y)
  await expect(page.getByTitle('Foreground color')).toContainText('#00000000')
  await page.mouse.click(center.x, center.y)
  await expect(page.getByTitle('Foreground color')).toContainText('#FF0000FF')
  await expect(page.getByLabel('Recent sampled colors').getByRole('button')).toHaveCount(3)
})

test('samples imported semi-transparent pixels without flipping document rows', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.fillStyle = '#0000ff'
    context.fillRect(0, 16, 32, 16)
    context.fillStyle = 'rgba(255, 0, 0, 0.5)'
    context.fillRect(0, 0, 32, 16)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG encoding failed')), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type="file"]').setInputFiles({ name: 'eyedropper-colors.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await expect(page.getByText('32 × 32 px').first()).toBeVisible()
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Canvas has no bounds')
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await page.keyboard.press('i')
  await page.mouse.click(center.x, center.y - 8)
  await expect(page.getByTitle('Foreground color')).toContainText('#FF000080')
  await page.mouse.click(center.x, center.y + 8)
  await expect(page.getByTitle('Foreground color')).toContainText('#0000FFFF')
})
