import type { EditorDocument } from '../../core/model/EditorDocument'

const solid = (color: string | null) =>
  color === null || /^#[0-9a-f]{6}$/i.test(color)
/** Conservative subset: flat, opaque, solid shapes. Entire pages fall back when composition is unsupported. */
export function vectorPdfWarnings(doc: EditorDocument): string[] {
  const reasons = new Set<string>()
  for (const layer of doc.layers.filter((layer) => layer.visible)) {
    if (layer.kind === 'raster' && !layer.pixelSourceId) continue
    if (layer.kind !== 'vector') {
      reasons.add(`${layer.kind} layers`)
      continue
    }
    if (
      layer.blendMode !== 'normal' ||
      layer.opacity !== 1 ||
      layer.mask?.enabled ||
      layer.adjustments.some((a) => a.enabled)
    )
      reasons.add('blending, opacity, masks or effects')
    const style = layer.style,
      geometry = layer.geometry
    if (
      !solid(style.fill) ||
      !solid(style.stroke) ||
      style.fillGradient ||
      (style.fillOpacity ?? 1) !== 1 ||
      (style.strokeOpacity ?? 1) !== 1
    )
      reasons.add('gradients or non-opaque colors')
    if (
      geometry.type === 'path' ||
      geometry.type === 'polygon' ||
      (geometry.type === 'rect' && (geometry.rx !== 0 || geometry.ry !== 0))
    )
      reasons.add('paths, polygons or rounded rectangles')
    if (
      style.fillRule !== 'nonzero' ||
      (style.strokeAlignment && style.strokeAlignment !== 'center') ||
      style.strokeDash?.length ||
      style.startArrow ||
      style.endArrow ||
      style.scaleStroke === false ||
      (style.strokeCap && style.strokeCap !== 'butt') ||
      (style.strokeJoin && style.strokeJoin !== 'miter')
    )
      reasons.add('advanced stroke styles')
  }
  return [...reasons].map(
    (reason) =>
      `${doc.name}: page will be flattened because it contains ${reason}.`,
  )
}
