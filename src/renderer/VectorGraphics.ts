import { drawVectorPath } from './VectorPath'
import { Container, FillPattern, Graphics, Matrix, Texture } from 'pixi.js'
import { fillVectorGradient } from './VectorGradient'
import { geometryBounds } from '../core/vector/PathGeometry'
import type { VectorLayer } from '../core/model/types'
import {
  dashedPathData,
  fillContours,
  readSubpaths,
  toPathData,
} from '../core/vector/PathGeometry'
import { arrowPolygons } from '../core/vector/VectorPaint'

/** GPU geometry is derived from editable model paths, with explicit compound holes. */
export function createVectorGraphics(
  layer: VectorLayer,
  renderScale = Math.sqrt(
    Math.abs(layer.transform.scaleX * layer.transform.scaleY),
  ),
): Container {
  const graphics = new Graphics(),
    style = layer.style
  let fill: FillPattern | undefined
  let maskedDisplay: Container | null = null
  let ownedTexture: Texture | undefined
  if (style.fillGradient) {
    // Only the paint ramp is textured; all shape contours remain GPU geometry.
    const b = geometryBounds(layer.geometry),
      width = Math.max(0.001, b.width),
      height = Math.max(0.001, b.height),
      size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Gradient texture context unavailable')
    context.setTransform(
      size / width,
      0,
      0,
      size / height,
      (-b.x * size) / width,
      (-b.y * size) / height,
    )
    const ramp = new Path2D()
    ramp.rect(b.x, b.y, width, height)
    fillVectorGradient(context, layer, ramp, 'nonzero')
    ownedTexture = Texture.from(canvas)
    fill = new FillPattern(ownedTexture, 'no-repeat')
    fill.setTransform(new Matrix(width / size, 0, 0, height / size, b.x, b.y))
  }
  if ((style.fill || fill) && layer.geometry.type !== 'line') {
    const paint = fill
      ? { fill, alpha: style.fillOpacity ?? 1 }
      : { color: style.fill!, alpha: style.fillOpacity ?? 1 }
    for (const contour of fillContours(layer.geometry, style.fillRule)) {
      drawVectorPath(graphics.beginPath(), contour.d).fill(paint)
      for (const hole of contour.holes)
        drawVectorPath(graphics.beginPath(), hole).cut()
    }
  }
  if (style.stroke && style.strokeWidth > 0) {
    const width =
      style.strokeWidth /
      (style.scaleStroke === false ? Math.max(0.001, renderScale) : 1)
    const aligned =
      style.strokeAlignment &&
      style.strokeAlignment !== 'center' &&
      readSubpaths(layer.geometry).every((path) => path.closed)
    const strokeGraphics = aligned ? new Graphics() : graphics
    drawVectorPath(
      strokeGraphics.beginPath(),
      style.strokeDash?.length
        ? dashedPathData(layer.geometry, style.strokeDash)
        : toPathData(layer.geometry),
    ).stroke({
      color: style.stroke,
      alpha: style.strokeOpacity ?? 1,
      width: aligned ? width * 2 : width,
      alignment: 0.5,
      cap: style.strokeCap ?? 'butt',
      join: style.strokeJoin ?? 'miter',
    })
    if (aligned) {
      const mask = new Graphics()
      const original = fillContours(layer.geometry, style.fillRule)
      let contours = original
      if (style.strokeAlignment === 'outside') {
        const b = geometryBounds(layer.geometry),
          pad = Math.max(10, width * 10)
        const box = `M${b.x - pad} ${b.y - pad}H${b.x + b.width + pad}V${b.y + b.height + pad}H${b.x - pad}Z`
        contours = fillContours(
          {
            type: 'path',
            d: `${box} ${original.map((c) => [c.d, ...c.holes].join(' ')).join(' ')}`,
          },
          'evenodd',
        )
      }
      for (const contour of contours) {
        drawVectorPath(mask.beginPath(), contour.d).fill('#ffffff')
        for (const hole of contour.holes)
          drawVectorPath(mask.beginPath(), hole).cut()
      }
      maskedDisplay = new Container()
      maskedDisplay.addChild(graphics, strokeGraphics, mask)
      strokeGraphics.mask = mask
    }

    for (const arrow of arrowPolygons(
      layer,
      style.scaleStroke === false ? renderScale : 1,
    ))
      graphics
        .beginPath()
        .poly(arrow, true)
        .fill({ color: style.stroke, alpha: style.strokeOpacity ?? 1 })
  }
  if (ownedTexture) {
    const texture = ownedTexture
    graphics.on('destroyed', () => texture.destroy(true))
  }
  return maskedDisplay ?? graphics
}
