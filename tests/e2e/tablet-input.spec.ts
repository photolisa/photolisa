import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /New document/ }).click()
  await page.getByLabel('Width (px)').fill('128')
  await page.getByLabel('Height (px)').fill('128')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.keyboard.press('Control+1')
  await page.getByTitle('Brush (B)').click()
  await page.getByLabel('Primary color').fill('#cf392a')
  const bounds = await page.getByLabel('Document canvas').boundingBox()
  if (!bounds) throw new Error('Canvas unavailable')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}
async function pixels(page: Page): Promise<number[]> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PNG/ }).click()
  const path = await (await download).path()
  if (!path) throw new Error('No PNG download')
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data]
  }, [...await readFile(path)])
}
const alphaSum = (data: number[]) => data.reduce((sum, value, i) => sum + (i % 4 === 3 ? value : 0), 0)

test('browser pen pressure changes exported stroke width and mouse stays full size', async ({ page }) => {
  const center = await setup(page)
  await page.locator('.option').filter({ hasText: 'Size' }).getByRole('slider').fill('20')
  const cdp = await page.context().newCDPSession(page)
  const draw = async (pressure: number, pointerType: 'pen' | 'mouse') => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x - 30, y: center.y, pointerType })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x - 30, y: center.y, button: 'left', buttons: 1, clickCount: 1, force: pressure, pointerType })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x + 30, y: center.y, button: 'left', buttons: 1, force: pressure, pointerType })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x + 30, y: center.y, button: 'left', buttons: 0, clickCount: 1, pointerType })
    return pixels(page)
  }
  const light = await draw(.2, 'pen')
  expect(alphaSum(light)).toBeGreaterThan(0)
  await page.keyboard.press('Control+z')
  const heavy = await draw(1, 'pen')
  expect(alphaSum(heavy)).toBeGreaterThan(alphaSum(light) * 3)
  await page.keyboard.press('Control+z')
  expect(alphaSum(await pixels(page))).toBe(0)
  await page.keyboard.press('Control+Shift+z')
  expect(await pixels(page)).toEqual(heavy)
  await page.keyboard.press('Control+z')
  expect(await draw(.2, 'mouse')).toEqual(heavy)
})

// Keep a real mouse pointer active so synthetic pen events can use native
// setPointerCapture/releasePointerCapture without replacing those browser APIs.
async function activatePointer(page: Page): Promise<void> {
  await page.mouse.move(1, 1)
  await page.mouse.down()
}

async function dispatch(page: Page, type: string, x: number, y: number, options: PointerEventInit = {}): Promise<void> {
  await page.getByLabel('Document canvas').evaluate((canvas, args) => {
    canvas.dispatchEvent(new PointerEvent(args.type, { bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'pen', button: 0, buttons: 1, pressure: 1,
      clientX: args.x, clientY: args.y, ...args.options }))
  }, { type, x, y, options })
}

test('pen eraser removes alpha temporarily with exact undo/redo and cancellation', async ({ page }) => {
  const center = await setup(page)
  await page.mouse.click(center.x, center.y)
  const painted = await pixels(page)
  await activatePointer(page)
  await dispatch(page, 'pointerdown', center.x, center.y, { button: 5, buttons: 32 })
  await dispatch(page, 'pointerup', center.x, center.y, { button: 5, buttons: 0, pressure: 0 })
  await page.mouse.up()
  const erased = await pixels(page)
  expect(alphaSum(erased)).toBeLessThan(alphaSum(painted))
  expect(erased[(64 * 128 + 64) * 4 + 3]).toBe(0)
  await expect(page.getByTitle('Brush (B)')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Control+z')
  expect(await pixels(page)).toEqual(painted)
  await page.keyboard.press('Control+Shift+z')
  expect(await pixels(page)).toEqual(erased)
  await page.keyboard.press('Control+z')
  await activatePointer(page)
  await dispatch(page, 'pointerdown', center.x, center.y, { button: 5, buttons: 32 })
  await dispatch(page, 'pointercancel', center.x, center.y, { button: 5, buttons: 0 })
  await page.mouse.up()
  expect(await pixels(page)).toEqual(painted)
  // Cancellation contributes no history entry.
  await page.keyboard.press('Control+z')
  expect(alphaSum(await pixels(page))).toBe(0)
})

test('palm events and pen hover cannot paint or cancel a captured stroke', async ({ page }) => {
  const center = await setup(page)
  await page.locator('.option').filter({ hasText: 'Size' }).getByRole('slider').fill('4')
  await activatePointer(page)
  await dispatch(page, 'pointerdown', center.x - 25, center.y)
  for (const type of ['pointerdown', 'pointermove', 'pointercancel', 'pointerup']) {
    await dispatch(page, type, center.x, center.y + 30, { pointerId: 2, pointerType: 'touch' })
  }
  await dispatch(page, 'pointermove', center.x + 25, center.y)
  await dispatch(page, 'pointermove', center.x, center.y - 30, { buttons: 0, pressure: 0 })
  await dispatch(page, 'pointerup', center.x + 25, center.y, { buttons: 0, pressure: 0 })
  await page.mouse.up()
  const painted = await pixels(page)
  expect(painted[(64 * 128 + 64) * 4 + 3]).toBe(255)
  expect(painted[(94 * 128 + 64) * 4 + 3]).toBe(0)
  expect(painted[(34 * 128 + 64) * 4 + 3]).toBe(0)
  await page.keyboard.press('Control+z')
  expect(alphaSum(await pixels(page))).toBe(0)
  await page.keyboard.press('Control+Shift+z')
  expect(await pixels(page)).toEqual(painted)
})

