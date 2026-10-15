import type { Graphics } from 'pixi.js'
import { readSubpaths } from '../core/vector/PathGeometry'
/** Feed exact cubic commands to Pixi without its SVG transform parser's closePath warnings. */
export function drawVectorPath(graphics: Graphics, d: string): Graphics {
  for (const path of readSubpaths({ type: 'path', d })) {
    const first = path.anchors[0]
    if (!first) continue
    graphics.moveTo(first.point.x, first.point.y)
    for (
      let i = 0;
      i < (path.closed ? path.anchors.length : path.anchors.length - 1);
      i++
    ) {
      const a = path.anchors[i]!,
        b = path.anchors[(i + 1) % path.anchors.length]!
      const straight =
        a.outgoing.x === a.point.x &&
        a.outgoing.y === a.point.y &&
        b.incoming.x === b.point.x &&
        b.incoming.y === b.point.y
      if (straight) {
        if (!path.closed || i !== path.anchors.length - 1)
          graphics.lineTo(b.point.x, b.point.y)
      } else
        graphics.bezierCurveTo(
          a.outgoing.x,
          a.outgoing.y,
          b.incoming.x,
          b.incoming.y,
          b.point.x,
          b.point.y,
        )
    }
    if (path.closed) graphics.closePath()
  }
  return graphics
}
