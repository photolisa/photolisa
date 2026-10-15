import paper from 'paper/dist/paper-core'
type Path = InstanceType<typeof paper.Path>
type PathItem = InstanceType<typeof paper.PathItem>
import type { VectorGeometry, AffineMatrix } from '../model/types'
import type { Point } from '../geometry/LayerCoordinates'

// Geometry-only scope: no DOM canvas, renderer, or Vue state is required.
const scope = new paper.PaperScope()
scope.setup(new scope.Size(1, 1))
export interface Anchor {
  smooth?: boolean
  point: Point
  incoming: Point
  outgoing: Point
}
export interface Subpath {
  anchors: Anchor[]
  closed: boolean
}
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export function geometryPath(geometry: VectorGeometry): PathItem {
  scope.activate()
  let item: PathItem
  switch (geometry.type) {
    case 'path':
      item = new scope.CompoundPath({ pathData: geometry.d, insert: false })
      break
    case 'rect':
      item = new scope.Path.Rectangle({
        rectangle: new scope.Rectangle(
          geometry.x,
          geometry.y,
          geometry.width,
          geometry.height,
        ),
        radius: new scope.Size(
          Math.min(geometry.rx, geometry.width / 2),
          Math.min(geometry.ry, geometry.height / 2),
        ),
        insert: false,
      })
      break
    case 'circle':
      item = new scope.Path.Circle({
        center: [geometry.cx, geometry.cy],
        radius: geometry.r,
        insert: false,
      })
      break
    case 'ellipse':
      item = new scope.Path.Ellipse({
        rectangle: new scope.Rectangle(
          geometry.cx - geometry.rx,
          geometry.cy - geometry.ry,
          geometry.rx * 2,
          geometry.ry * 2,
        ),
        insert: false,
      })
      break
    case 'line':
      item = new scope.Path({
        segments: [
          [geometry.x1, geometry.y1],
          [geometry.x2, geometry.y2],
        ],
        insert: false,
      })
      break
    case 'polygon':
      item = new scope.Path({
        segments: geometry.points.reduce<number[][]>((points, value, i) => {
          if (i % 2 === 0) points.push([value, geometry.points[i + 1]!])
          return points
        }, []),
        closed: true,
        insert: false,
      })
      break
  }
  return item
}
export function geometryBounds(geometry: VectorGeometry): Bounds {
  const path = geometryPath(geometry)
  try {
    const b = path.bounds
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  } finally {
    path.remove()
  }
}
export function toPathData(geometry: VectorGeometry): string {
  const path = geometryPath(geometry)
  try {
    return path.pathData
  } finally {
    path.remove()
  }
}
export function readSubpaths(geometry: VectorGeometry): Subpath[] {
  const item = geometryPath(geometry)
  try {
    const paths =
      item instanceof scope.Path ? [item] : (item.children as Path[])
    return paths.map((path) => ({
      closed: path.closed,
      anchors: path.segments.map((s) => ({
        point: { x: s.point.x, y: s.point.y },
        incoming: { x: s.point.x + s.handleIn.x, y: s.point.y + s.handleIn.y },
        outgoing: {
          x: s.point.x + s.handleOut.x,
          y: s.point.y + s.handleOut.y,
        },
      })),
    }))
  } finally {
    item.remove()
  }
}
export function writeSubpaths(paths: readonly Subpath[]): string {
  return paths
    .filter((path) => path.anchors.length)
    .map((path) => {
      const first = path.anchors[0]!
      let d = `M ${first.point.x} ${first.point.y}`
      const count = path.closed ? path.anchors.length : path.anchors.length - 1
      for (let i = 0; i < count; i++) {
        const a = path.anchors[i]!,
          b = path.anchors[(i + 1) % path.anchors.length]!
        d += ` C ${a.outgoing.x} ${a.outgoing.y} ${b.incoming.x} ${b.incoming.y} ${b.point.x} ${b.point.y}`
      }
      return d + (path.closed ? ' Z' : '')
    })
    .join(' ')
}
export function corner(point: Point): Anchor {
  return { point: { ...point }, incoming: { ...point }, outgoing: { ...point } }
}
export function moveAnchor(anchor: Anchor, point: Point): Anchor {
  const dx = point.x - anchor.point.x,
    dy = point.y - anchor.point.y
  return {
    ...anchor,
    point,
    incoming: { x: anchor.incoming.x + dx, y: anchor.incoming.y + dy },
    outgoing: { x: anchor.outgoing.x + dx, y: anchor.outgoing.y + dy },
  }
}
export function cubicAt(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  t: number,
): Point {
  const u = 1 - t
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  }
}
export function splitSegment(path: Subpath, index: number, t: number): void {
  const a = path.anchors[index],
    b = path.anchors[(index + 1) % path.anchors.length]
  if (!a || !b || t <= 0 || t >= 1) throw new Error('Invalid segment split')
  const mix = (p: Point, q: Point): Point => ({
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
  })
  const ab = mix(a.point, a.outgoing),
    bc = mix(a.outgoing, b.incoming),
    cd = mix(b.incoming, b.point)
  const abc = mix(ab, bc),
    bcd = mix(bc, cd),
    point = mix(abc, bcd)
  a.outgoing = ab
  b.incoming = cd
  path.anchors.splice(index + 1, 0, { point, incoming: abc, outgoing: bcd })
}
export function reverseSubpaths(paths: Subpath[]): Subpath[] {
  return paths.map((path) => ({
    closed: path.closed,
    anchors: [...path.anchors]
      .reverse()
      .map((a) => ({
        point: a.point,
        incoming: a.outgoing,
        outgoing: a.incoming,
      })),
  }))
}
export function transformGeometryPath(
  geometry: VectorGeometry,
  matrix: AffineMatrix,
): string {
  const path = geometryPath(geometry)
  try {
    path.transform(new scope.Matrix(...matrix))
    return path.pathData
  } finally {
    path.remove()
  }
}
export type BooleanOperation =
  'union' | 'subtract' | 'intersect' | 'exclude' | 'divide'
export function booleanPaths(
  inputs: readonly {
    geometry: VectorGeometry
    matrix: AffineMatrix
    fillRule: 'nonzero' | 'evenodd'
  }[],
  operation: BooleanOperation,
): string {
  if (inputs.length < 2 || inputs.length > 256)
    throw new Error('Select between 2 and 256 vector shapes')
  const items: PathItem[] = []
  try {
    let segmentBudget = 0
    for (const input of inputs) {
      const path = geometryPath(input.geometry)
      path.fillRule = input.fillRule
      path.transform(new scope.Matrix(...input.matrix))
      items.push(path)
      const paths =
        path instanceof scope.Path ? [path] : (path.children as Path[])
      segmentBudget += paths.reduce((sum, p) => sum + p.segments.length, 0)
      if (
        segmentBudget > 4096 ||
        [
          path.bounds.x,
          path.bounds.y,
          path.bounds.right,
          path.bounds.bottom,
        ].some((n) => !Number.isFinite(n) || Math.abs(n) > 1_000_000)
      )
        throw new Error('Boolean operands exceed the safe geometry budget')
    }
    let result = items[0]!
    for (const next of items.slice(1)) {
      const options = { insert: false }
      if (operation === 'divide') {
        const divided = result.divide(next, options)
        // Divide returns a Group; preserve every resulting subpath.
        const data = divided
          .getItems({ class: scope.Path })
          .map((item) => (item as Path).pathData)
          .join(' ')
        divided.remove()
        result = new scope.CompoundPath({ pathData: data, insert: false })
      } else
        result =
          operation === 'union'
            ? result.unite(next, options)
            : operation === 'subtract'
              ? result.subtract(next, options)
              : operation === 'intersect'
                ? result.intersect(next, options)
                : result.exclude(next, options)
      items.push(result)
    }
    return result.pathData
  } finally {
    items.forEach((item) => item.remove())
  }
}

/** Returns exact cubic portions for each dash; curves are never rasterized. */
export function dashedPathData(
  geometry: VectorGeometry,
  pattern: number[],
): string {
  if (!pattern.length) return toPathData(geometry)
  const item = geometryPath(geometry),
    parts: Path[] = []
  try {
    const paths =
      item instanceof scope.Path ? [item] : (item.children as Path[])
    const lengths = pattern.length % 2 ? [...pattern, ...pattern] : pattern
    for (const path of paths) {
      let offset = 0,
        index = 0
      while (offset < path.length && parts.length < 20000) {
        const length = lengths[index % lengths.length]!
        if (index % 2 === 0) {
          const copy = path.clone({ insert: false }) as Path
          if (copy.closed) copy.splitAt(0)
          const tail = offset > 0 ? copy.splitAt(offset) : copy
          if (tail) {
            const remainder = tail.splitAt(Math.min(length, tail.length))
            remainder?.remove()
            parts.push(tail)
          }
          if (tail !== copy) copy.remove()
        }
        offset += length
        index++
      }
    }
    return parts.map((p) => p.pathData).join(' ')
  } finally {
    parts.forEach((p) => p.remove())
    item.remove()
  }
}

/** Pixi requires explicit cut contours for compound-path holes. */
export function fillContours(
  geometry: VectorGeometry,
  fillRule: 'nonzero' | 'evenodd',
): Array<{ d: string; holes: string[] }> {
  const source = geometryPath(geometry)
  let resolved: PathItem = source
  try {
    source.fillRule = fillRule
    resolved = (source as PathItem & { resolveCrossings(): PathItem })
      .resolveCrossings()
      .reorient(fillRule === 'nonzero', true)
    const paths =
      resolved instanceof scope.Path
        ? [resolved]
        : (resolved.children as Path[])
    const outer = paths.filter((path) => path.clockwise)
    const holes = paths.filter((path) => !path.clockwise)
    return outer.map((path) => ({
      d: path.pathData,
      holes: holes
        .filter(
          (hole) =>
            path.contains(hole.interiorPoint) &&
            !outer.some(
              (other) =>
                other !== path &&
                Math.abs(other.area) < Math.abs(path.area) &&
                other.contains(hole.interiorPoint),
            ),
        )
        .map((hole) => hole.pathData),
    }))
  } finally {
    if (resolved !== source) resolved.remove()
    source.remove()
  }
}

export function splitPathAtAnchor(path: Subpath, index: number): Subpath[] {
  if (!path.anchors[index]) throw new Error('Select a valid anchor to split')
  if (path.closed) {
    const anchors = [
      ...path.anchors.slice(index),
      ...path.anchors.slice(0, index),
      structuredClone(path.anchors[index]!),
    ]
    return [{ anchors, closed: false }]
  }
  if (index === 0 || index === path.anchors.length - 1)
    throw new Error('Select an interior anchor to split an open path')
  return [
    {
      anchors: structuredClone(path.anchors.slice(0, index + 1)),
      closed: false,
    },
    { anchors: structuredClone(path.anchors.slice(index)), closed: false },
  ]
}
export function joinOpenPaths(paths: Subpath[]): Subpath[] {
  const closed = paths.filter((p) => p.closed),
    open = paths.filter((p) => !p.closed && p.anchors.length)
  if (open.length < 2)
    throw new Error('Joining requires at least two open paths')
  let joined = structuredClone(open[0]!)
  for (const next of open.slice(1)) {
    const last = joined.anchors.at(-1)!.point,
      first = next.anchors[0]!.point,
      end = next.anchors.at(-1)!.point
    const path =
      Math.hypot(last.x - end.x, last.y - end.y) <
      Math.hypot(last.x - first.x, last.y - first.y)
        ? reverseSubpaths([next])[0]!
        : next
    joined = {
      closed: false,
      anchors: [...joined.anchors, ...structuredClone(path.anchors)],
    }
  }
  return [...closed, joined]
}

export function nearestSegment(
  geometry: VectorGeometry,
  matrix: AffineMatrix,
  point: Point,
): { subpath: number; index: number; t: number; distance: number } | null {
  const item = geometryPath(geometry)
  try {
    item.transform(new scope.Matrix(...matrix))
    const paths =
      item instanceof scope.Path ? [item] : (item.children as Path[])
    let best: {
      subpath: number
      index: number
      t: number
      distance: number
    } | null = null
    paths.forEach((path, subpath) => {
      const location = path.getNearestLocation(point)
      if (location && (!best || location.distance < best.distance))
        best = {
          subpath,
          index: location.index,
          t: location.time,
          distance: location.distance,
        }
    })
    return best
  } finally {
    item.remove()
  }
}
