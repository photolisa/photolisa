import { expect, test, type Page } from '@playwright/test'

async function createProject(page: Page, name: string, width: number, height = 300): Promise<void> {
  await page.getByRole('button', { name: 'Add project tab' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Width (px)').fill(String(width))
  await page.getByLabel('Height (px)').fill(String(height))
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
}

test('keeps multiple projects open and copies a layer through the context menu', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await createProject(page, 'Source', 400)
  await createProject(page, 'Destination', 800)
  await page.getByRole('tab', { name: 'Source' }).click()
  await expect(page.getByText('400 × 300 px').first()).toBeVisible()
  await page.locator('[data-layer-row]').first().click({ button: 'right' })
  await page.getByLabel('Destination project').selectOption({ label: 'Destination' })
  await page.getByRole('button', { name: 'Copy to Project' }).click()
  await expect(page.getByRole('tab', { name: /Destination/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-layer-row]')).toHaveCount(2)
  await expect(page.getByText('800 × 300 px').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Source' }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(1)
})

test('moves a layer from the context menu and copies one by dragging onto a tab', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await createProject(page, 'First', 400)
  await createProject(page, 'Second', 800)
  await page.getByRole('tab', { name: 'First' }).click()
  await page.locator('[data-layer-row]').first().dragTo(page.getByRole('tab', { name: 'Second' }))
  await expect(page.getByRole('tab', { name: /Second/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-layer-row]')).toHaveCount(2)
  await page.getByRole('tab', { name: 'First' }).click()
  await page.locator('[data-layer-row]').first().click({ button: 'right' })
  await page.getByLabel('Destination project').selectOption({ label: 'Second' })
  await page.getByRole('button', { name: 'Move to Project' }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(3)
  await page.getByRole('tab', { name: 'First' }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(0)
})

test('retains imported raster pixels when copying into a different-sized project', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 16; canvas.height = 16
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ed1010'
    context.fillRect(0, 0, 16, 16)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type="file"]').setInputFiles({ name: 'Pixels.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await expect(page.getByRole('tab', { name: 'Pixels' })).toBeVisible()
  await createProject(page, 'Larger', 32, 32)
  await page.getByRole('tab', { name: 'Pixels' }).click()
  await page.locator('[data-layer-row]').first().click({ button: 'right' })
  await page.getByLabel('Destination project').selectOption({ label: 'Larger' })
  await page.getByRole('button', { name: 'Copy to Project' }).click()
  const rgb = await page.getByLabel('Pixels thumbnail').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const data = canvas.getContext('2d')!.getImageData(canvas.width / 4, canvas.height / 4, 1, 1).data
    return [data[0], data[1], data[2]]
  })
  expect(rgb[0]).toBeGreaterThan(150)
  expect(rgb[0]! - rgb[1]!).toBeGreaterThan(100)
  expect(rgb[0]! - rgb[2]!).toBeGreaterThan(100)
})
