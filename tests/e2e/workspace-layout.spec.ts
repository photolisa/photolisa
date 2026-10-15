import { expect, test } from '@playwright/test'
import { selectEditorTool } from './helpers/tools'

test('header project links keep the editor open and fit narrow layouts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const links = [
    ['Photolisa website', 'https://photolisa.com'],
    ['GitHub', 'https://github.com/photolisa/photolisa'],
    ['Submit issue', 'https://github.com/photolisa/photolisa/issues'],
  ] as const
  for (const [name, href] of links) {
    const link = page.getByRole('link', { name, exact: true })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', href)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
  for (const width of [1100, 900, 600, 375]) {
    await page.setViewportSize({ width, height: 740 })
    for (const name of ['GitHub', 'Submit issue']) {
      const link = page.getByRole('link', { name, exact: true })
      await expect(link).toBeVisible()
      const bounds = await link.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    expect(await page.locator('.app-header').evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test('workspace panels resize the canvas, remember preferences, and keep history', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Start blank canvas' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Workspace test')
  await page.getByLabel('Width (px)').fill('600')
  await page.getByLabel('Height (px)').fill('400')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const canvas = page.getByLabel('Document canvas')
  const initial = await canvas.boundingBox()
  if (!initial) throw new Error('Canvas unavailable')
  const resize = await page.getByRole('button', { name: 'Resize right panel', exact: true }).boundingBox()
  if (!resize) throw new Error('Resize handle unavailable')
  await page.mouse.move(resize.x + resize.width / 2, resize.y + 60)
  await page.mouse.down()
  await page.mouse.move(resize.x - 60, resize.y + 60)
  await page.mouse.up()
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBeLessThan(initial.width - 40)
  await page.getByRole('button', { name: 'Toggle right panels' }).click()
  await expect(page.getByRole('complementary', { name: 'Editor panels' })).toBeHidden()
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBe(1384)
  await expect.poll(() => canvas.evaluate((element) => element.getAttribute('width'))).toBe('1384')
  await page.getByRole('button', { name: 'Toggle right panels' }).click()
  await page.screenshot({ path: testInfo.outputPath('workspace.png') })
  await page.getByRole('button', { name: 'Simple', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resize properties panel' })).toBeHidden()
  await page.getByRole('button', { name: 'New empty layer' }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(2)
  await page.getByRole('button', { name: 'Step back' }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Step forward' }).click()
  await expect(page.locator('[data-layer-row]')).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Simple', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('complementary', { name: 'Editor panels' })).toHaveCSS('width', '352px')
  await page.getByRole('button', { name: 'Toggle right panels' }).click()
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Editor panels' })).toBeHidden()
})

test('tool flyouts and sidebar color input stay functional across responsive layouts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Brush tool (B)', exact: true }).hover()
  await expect(page.getByRole('button', { name: 'Pencil tool (N)' })).toBeVisible()
  await page.getByRole('button', { name: 'Pencil tool (N)' }).click()
  await expect(page.locator('.tool-options')).toContainText('pencil')
  await selectEditorTool(page, 'Polygon tool')
  await expect(page.getByLabel('Polygon sides')).toBeVisible()
  await page.getByLabel('Sidebar color value').fill('#12AB3480')
  await page.getByLabel('Sidebar color value').press('Enter')
  const foreground = page.getByRole('button', { name: 'Foreground color picker' })
  await expect(foreground).toHaveAttribute('title', /#12AB3480/)
  await page.getByRole('slider', { name: 'Color saturation and brightness' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(foreground).not.toHaveAttribute('title', /#12AB3480/)
  await expect(foreground).toHaveAttribute('title', /80$/)
  for (const width of [1100, 900, 600, 375]) {
    await page.setViewportSize({ width, height: 740 })
    const panels = page.getByRole('complementary', { name: 'Editor panels' })
    if (width < 1024) {
      await expect(panels).toBeHidden()
      await page.getByRole('button', { name: 'Toggle right panels' }).click()
      await expect(panels).toBeVisible()
      const bounds = await panels.boundingBox()
      expect(bounds?.x).toBeGreaterThanOrEqual(56)
      await page.getByRole('button', { name: 'Collapse right panels' }).click()
    }
    expect(await page.locator('body').evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('button', { name: 'More tools', exact: true }).click()
    const menu = page.getByLabel('Additional tools')
    await expect(menu).toBeVisible()
    const menuBounds = await menu.boundingBox()
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width)
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(740)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  }
})
