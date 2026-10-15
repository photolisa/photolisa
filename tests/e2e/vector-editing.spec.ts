import { expect, test } from '@playwright/test'
import { selectEditorTool } from './helpers/tools'
import { readFile } from 'node:fs/promises'

test('pen creates cubic paths, direct selection edits anchors, paint exports as SVG', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'blank.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>',
    ),
  })
  await expect(
    page.getByRole('tab', { name: 'blank', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Canvas unavailable')
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await page.keyboard.press('p')
  await page.mouse.click(x - 70, y + 30)
  await page.mouse.move(x, y - 40)
  await page.mouse.down()
  await page.mouse.move(x + 30, y - 40)
  await page.mouse.up()
  await page.mouse.click(x + 70, y + 30)
  await page.keyboard.press('Enter')
  const path = page.getByLabel('Vector geometry').locator('textarea')
  await expect(path).toBeVisible()
  const original = await path.inputValue()
  expect(original).toContain('C')
  await page.keyboard.press('a')
  await page.mouse.move(x - 70, y + 30)
  await page.mouse.down()
  await page.mouse.move(x - 50, y + 40, { steps: 4 })
  await page.mouse.up()
  await expect(path).not.toHaveValue(original)
  await page.keyboard.press('Control+z')
  await expect(path).toHaveValue(original)
  await page.keyboard.press('Delete')
  await expect(path).not.toHaveValue(original)
  await page.keyboard.press('Control+z')
  await expect(path).toHaveValue(original)
  await page.getByLabel('Vector fill type').selectOption('linear')
  await expect(page.getByLabel('Gradient stop 1 color')).toBeVisible()
  await page.keyboard.press('i')
  await page.mouse.click(x - 40, y + 25)
  const sampled = (await page.getByTitle('Foreground color').innerText()).match(
    /#([0-9a-f]{6})/i,
  )
  expect(sampled).not.toBeNull()
  const gray = Number.parseInt(sampled![1]!.slice(0, 2), 16)
  expect(gray).toBeGreaterThan(10)
  expect(gray).toBeLessThan(180)
  await page.keyboard.press('a')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export selection as SVG' }).click()
  const download = await downloadPromise,
    svg = await readFile(await download.path(), 'utf8')
  expect(svg).toContain('linearGradient')
  expect(svg).toContain('<path')
  expect(svg).toContain('stroke-linecap')
  await page.screenshot({ path: '/tmp/photolisa-vector-pen.png' })
  expect(errors).toEqual([])
})

test('boolean groups preserve operands, recompute, flatten and undo', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'booleans.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect id="outer" x="20" y="20" width="220" height="160" fill="#ff0000"/><rect id="inner" x="70" y="60" width="100" height="80" fill="#0000ff"/></svg>',
    ),
  })
  await page.getByText('outer', { exact: true }).click()
  await page.getByText('inner', { exact: true }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'subtract', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Flatten boolean result' }),
  ).toBeVisible()
  await page.screenshot({ path: '/tmp/photolisa-vector-boolean.png' })
  await page.getByRole('button', { name: 'Flatten boolean result' }).click()
  await expect(page.getByLabel('Vector geometry')).toContainText(
    'path geometry',
  )
  await page.keyboard.press('Control+z')
  await expect(
    page.getByRole('button', { name: 'Flatten boolean result' }),
  ).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.getByText('outer', { exact: true })).toBeVisible()
  await expect(page.getByText('inner', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('star parameters, multi-shape move and transform remain editable', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'blank.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>',
    ),
  })
  await expect(
    page.getByRole('tab', { name: 'blank', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await selectEditorTool(page, 'Star tool')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Canvas unavailable')
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await page.mouse.move(x - 40, y - 40)
  await page.mouse.down()
  await page.mouse.move(x + 40, y + 40)
  await page.mouse.up()
  await expect(page.getByLabel('Shape point count')).toHaveValue('5')
  await page.getByLabel('Shape point count').fill('7')
  await page.getByLabel('Shape point count').press('Tab')
  await expect(page.getByLabel('Shape point count')).toHaveValue('7')
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('Shape point count')).toHaveValue('5')
  await page.getByLabel('Document canvas').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Control+t')
  await expect(page.getByLabel('Transform origin X')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Shape point count')).toHaveValue('5')
})

test('native save/reopen preserves Bézier paint and vector clipboard crosses tabs', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
  })
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Source.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><path id="Curve" d="M40 80C80 20 120 20 160 80Z" fill="#ff0000"/></svg>',
    ),
  })
  await page.getByText('Curve', { exact: true }).click()
  await page.getByLabel('Vector fill type').selectOption('radial')
  const path = page.getByLabel('Vector geometry').locator('textarea'),
    original = await path.inputValue()
  const savedPromise = page.waitForEvent('download', { timeout: 10000 })
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByRole('button', { name: /Save project/ }).click()
  await page.screenshot({ path: '/tmp/photolisa-native-save.png' })
  const saved = await savedPromise,
    bytes = await readFile(await saved.path())
  await page.getByRole('button', { name: 'Close Source', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Source.photolisa',
    mimeType: 'application/x-photolisa',
    buffer: bytes,
  })
  await page.getByText('Curve', { exact: true }).click()
  await expect(path).toHaveValue(original)
  await expect(page.getByLabel('Vector fill type')).toHaveValue('radial')
  // Focus without clicking empty workspace: the Move tool now clears object selection there.
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('Control+c')
  await page.getByRole('button', { name: 'Add project tab' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Destination')
  await page.getByLabel('Width (px)').fill('400')
  await page.getByLabel('Height (px)').fill('300')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.keyboard.press('Control+v')
  await expect(path).toHaveValue(original)
  await expect(page.getByLabel('Vector fill type')).toHaveValue('radial')
  await page.keyboard.press('Control+z')
  await expect(page.getByText('Curve', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByText('Curve', { exact: true })).toBeVisible()
})

test('multi-selection transforms and custom presets are editable and undoable', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'multi.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="A" x="60" y="60" width="80" height="80" fill="#f00"/><rect id="B" x="220" y="60" width="80" height="80" fill="#00f"/></svg>',
    ),
  })
  await page.getByText('A', { exact: true }).click()
  await page.getByText('B', { exact: true }).click({ modifiers: ['Shift'] })
  await page.keyboard.press('Control+t')
  await expect(page.getByLabel('Transform origin X')).toBeVisible()
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Canvas unavailable')
  const originX = box.x + box.width / 2 - 200,
    originY = box.y + box.height / 2 - 150
  await page.mouse.move(originX + 300, originY + 140)
  await page.mouse.down()
  await page.mouse.move(originX + 340, originY + 180, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Shape width')).not.toHaveValue('80')
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('Shape width')).toHaveValue('80')
  await page.getByLabel('Custom shape name').fill('My rectangle')
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await selectEditorTool(page, 'Diamond tool')
  await expect(page.getByLabel('Custom shape preset')).toContainText(
    'My rectangle',
  )
})

test('GPU stroke alignment clips correctly inside and outside a shape', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({
    timeout: 60000,
  })
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'Stroke.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="Border" x="80" y="60" width="100" height="80" fill="#ff0000" stroke="#000000" stroke-width="20"/></svg>',
      ),
    })
  await page.getByText('Border', { exact: true }).click()
  await page.getByLabel('Vector stroke alignment').selectOption('inside')
  const box = await page.getByLabel('Document canvas').boundingBox()
  if (!box) throw new Error('Canvas unavailable')
  const x = box.x + box.width / 2 - 200,
    y = box.y + box.height / 2 - 150
  await page.getByLabel('Document canvas').focus()
  await page.keyboard.press('i')
  await page.mouse.click(x + 70, y + 100)
  await expect(page.getByTitle('Foreground color')).toContainText('#00000000')
  await page.mouse.click(x + 90, y + 100)
  await expect(page.getByTitle('Foreground color')).toContainText('#000000FF')
  await page.getByLabel('Vector stroke alignment').selectOption('outside')
  await page.getByLabel('Document canvas').focus()
  await page.mouse.click(x + 70, y + 100)
  await expect(page.getByTitle('Foreground color')).toContainText('#000000FF')
  await page.mouse.click(x + 90, y + 100)
  await expect(page.getByTitle('Foreground color')).toContainText('#FF0000FF')
})

test('pointer cancellation restores a shared vector transform without a history entry', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Document canvas')).toBeVisible({ timeout: 60000 })
  await page.locator('input[type="file"]').setInputFiles({ name: 'Cancel.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="A" x="60" y="60" width="80" height="80" fill="#f00"/><rect id="B" x="220" y="60" width="80" height="80" fill="#00f"/></svg>') })
  await page.getByText('A', { exact: true }).click(); await page.getByText('B', { exact: true }).click({ modifiers: ['Shift'] }); await page.keyboard.press('Control+t')
  const box = await page.getByLabel('Document canvas').boundingBox(); if (!box) throw new Error('Canvas unavailable')
  const x = box.x + box.width / 2 - 200, y = box.y + box.height / 2 - 150
  await page.mouse.move(x + 300, y + 140); await page.mouse.down(); await page.mouse.move(x + 340, y + 180)
  await page.getByLabel('Document canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', button: 0 })
  await page.mouse.up()
  await expect(page.getByLabel('Transform origin X')).toHaveCount(0)
  await expect(page.getByLabel('Shape width')).toHaveValue('80')
  await expect(page.getByRole('tab', { name: 'Cancel', exact: true })).not.toContainText('*')
})
