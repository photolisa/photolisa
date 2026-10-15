import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('imports editable SVG layers and exports vector geometry', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><g id="art"><rect id="box" x="10" y="10" width="80" height="50" fill="#ff0000"/><circle id="dot" cx="40" cy="35" r="10" fill="#00ff00"/></g></svg>'
  await page.locator('input[type="file"]').setInputFiles({ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  await expect(page.getByText('120 × 80 px').first()).toBeVisible()
  await expect(page.getByText('box', { exact: true })).toBeVisible()
  await expect(page.getByText('dot', { exact: true })).toBeVisible()
  await page.getByText('box', { exact: true }).click()
  const preview = await page.getByLabel('box thumbnail').evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Thumbnail canvas unavailable')
    return [...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data]
  })
  expect(preview[0]).toBeGreaterThan(200)
  expect(preview[1]).toBeLessThan(80)
  const style = page.getByLabel('Vector style')
  const fill = style.locator('input').first()
  await expect(fill).toHaveValue('#ff0000')
  await fill.fill('#0000ff')
  await fill.press('Tab')
  await expect(fill).toHaveValue('#0000ff')
  await page.keyboard.press('Control+z')
  await expect(fill).toHaveValue('#ff0000')
  const width = page.getByLabel('Vector geometry').getByLabel('width')
  await width.fill('70')
  await width.press('Tab')
  await expect(width).toHaveValue('70')
  await page.keyboard.press('Control+z')
  await expect(width).toHaveValue('80')
  await page.getByRole('button', { name: 'New empty layer' }).click()
  await page.getByTitle('Brush (B)').click()
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Document canvas unavailable')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export SVG/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('vector.svg')
  const exported = await readFile(await download.path(), 'utf8')
  expect(exported).toContain('<rect x="10" y="10" width="80" height="50"')
  expect(exported).toContain('<circle cx="40" cy="35" r="10"')
  expect(exported).toContain('<image width="120" height="80" href="data:image/png;base64,')
  expect(pageErrors).toEqual([])
})

test('imports class-styled SVG paths as editable vector layers', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><style>.cls-1{fill:#f00;opacity:.75}.cls-2{fill:#00f;stroke:#fff;stroke-width:1}</style><path id="red" class="cls-1" d="M 0 0 L 10 0 L 10 10 Z"/><path id="blue" class="cls-2" d="M 10 10 L 20 10 L 20 20 Z"/></svg>'
  await page.locator('input[type="file"]').setInputFiles({ name: 'classes.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  await expect(page.getByText('Compatibility notes', { exact: true })).toHaveCount(0)
  await page.getByText('red', { exact: true }).click()
  await expect(page.locator('aside').getByText('75%', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Vector style').locator('input').first()).toHaveValue('#f00')
  await page.getByText('blue', { exact: true }).click()
  await expect(page.getByLabel('Vector style').locator('input').first()).toHaveValue('#00f')
})
