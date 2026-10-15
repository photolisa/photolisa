import { expect, test, type Page } from '@playwright/test'

async function importSolidImage(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 24
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.fillStyle = '#d946ef'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Encode failed')), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type="file"]').setInputFiles({ name: 'adjust-source.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await expect(page.getByText('adjust-source').first()).toBeVisible()
}

async function addAdjustment(page: Page, name: string): Promise<void> {
  await page.getByLabel('Adjustment type').selectOption({ label: name })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('dialog', { name })).toBeVisible()
}

test('previews and manages a non-destructive adjustment stack with undo and export', async ({ page }) => {
  const errors: string[] = []
  const consoleErrors: string[] = []
  const consoleMessages: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`)
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await importSolidImage(page)

  await addAdjustment(page, 'Exposure')
  await page.getByRole('dialog', { name: 'Exposure' }).getByLabel('Exposure').evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = '1.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByRole('button', { name: 'Exposure', exact: true })).toBeVisible()

  await addAdjustment(page, 'Invert')
  await page.keyboard.press('Escape')

  await expect(page.getByRole('button', { name: 'Invert', exact: true })).toHaveCount(0)
  await addAdjustment(page, 'Invert')
  await page.getByRole('button', { name: 'Apply' }).click()

  await page.getByLabel('Disable Exposure').click()
  await expect(page.getByLabel('Enable Exposure')).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('Disable Exposure')).toBeVisible()
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByLabel('Enable Exposure')).toBeVisible()

  await page.getByLabel('Move adjustment up').last().click()
  const names = await page.locator('[aria-label="Adjustments"] .flex-1.truncate').allTextContents()
  expect(names).toEqual(['Invert', 'Exposure'])

  await addAdjustment(page, 'Sepia')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByRole('button', { name: 'Sepia', exact: true })).toBeVisible()

  // Instantiate both custom shader paths during live preview.
  await addAdjustment(page, 'Levels')
  await page.waitForTimeout(200)
  await expect.poll(() => consoleErrors, { message: 'Levels shader should initialize' }).toEqual([])
  await page.getByRole('button', { name: 'Cancel' }).click()
  await addAdjustment(page, 'Sharpen')
  await page.waitForTimeout(200)
  await expect.poll(() => consoleErrors, { message: `Sharpen shader should initialize: ${consoleMessages.join(' | ')}` }).toEqual([])
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'File', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PNG/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('adjust-source.png')
  expect(errors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('a legacy look adds an editable adjustment stack in one undo step', async ({ page }) => {
  await importSolidImage(page)
  await page.getByLabel('Filter preset', { exact: true }).selectOption('vintage')
  await page.getByRole('button', { name: 'Add selected look' }).click()
  const rows = page.locator('[aria-label="Adjustments"] .flex-1.truncate')
  await expect(rows).toHaveText(['Brightness / Contrast', 'Saturation', 'Sepia'])
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(rows).toHaveText(['Brightness / Contrast', 'Saturation', 'Sepia'])
})
