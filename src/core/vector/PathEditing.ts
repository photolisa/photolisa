import type { VectorGeometry } from '../model/types'
import {
  joinOpenPaths,
  readSubpaths,
  reverseSubpaths,
  splitPathAtAnchor,
  toPathData,
  writeSubpaths,
} from './PathGeometry'
export type PathAction =
  | 'convert'
  | 'reverse'
  | 'close'
  | 'open'
  | 'smooth'
  | 'corner'
  | 'split'
  | 'join'
export interface AnchorSelection {
  subpath: number
  index: number
}
export function supportsPathAction(
  geometry: VectorGeometry,
  action: PathAction,
  anchor: AnchorSelection | null,
): boolean {
  if (action === 'convert') return geometry.type !== 'path'
  const paths = readSubpaths(geometry)
  if (action === 'join')
    return paths.filter((p) => !p.closed && p.anchors.length).length >= 2
  if (action === 'split') {
    const p = anchor ? paths[anchor.subpath] : null
    return (
      !!p &&
      !!anchor &&
      (p.closed || (anchor.index > 0 && anchor.index < p.anchors.length - 1))
    )
  }
  if (action === 'close')
    return paths.some((p) => !p.closed && p.anchors.length > 2)
  if (action === 'open') return paths.some((p) => p.closed)
  return paths.some((p) => p.anchors.length > 1)
}
export function editPath(
  geometry: VectorGeometry,
  action: PathAction,
  anchor: AnchorSelection | null = null,
): VectorGeometry {
  if (!supportsPathAction(geometry, action, anchor))
    throw new Error('The selected path does not support this operation')
  if (action === 'convert') return { type: 'path', d: toPathData(geometry) }
  let paths = readSubpaths(geometry)
  if (action === 'split' && anchor)
    paths.splice(
      anchor.subpath,
      1,
      ...splitPathAtAnchor(paths[anchor.subpath]!, anchor.index),
    )
  if (action === 'join') paths = joinOpenPaths(paths)
  if (action === 'reverse') paths = reverseSubpaths(paths)
  if (action === 'close' || action === 'open')
    paths.forEach((p) => {
      p.closed = action === 'close'
    })
  if (action === 'smooth' || action === 'corner')
    paths.forEach((p, subpath) =>
      p.anchors.forEach((a, i) => {
        if (anchor && (anchor.subpath !== subpath || anchor.index !== i)) return
        const previous =
          p.anchors[
            p.closed
              ? (i - 1 + p.anchors.length) % p.anchors.length
              : Math.max(0, i - 1)
          ]!.point
        const next =
          p.anchors[
            p.closed
              ? (i + 1) % p.anchors.length
              : Math.min(p.anchors.length - 1, i + 1)
          ]!.point
        const dx = action === 'corner' ? 0 : (next.x - previous.x) / 6,
          dy = action === 'corner' ? 0 : (next.y - previous.y) / 6
        a.incoming = { x: a.point.x - dx, y: a.point.y - dy }
        a.outgoing = { x: a.point.x + dx, y: a.point.y + dy }
      }),
    )
  return { type: 'path', d: writeSubpaths(paths) }
}
