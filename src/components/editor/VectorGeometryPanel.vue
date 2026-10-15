<script setup lang="ts">
import { layerWorldMatrix, invertAffine, transformPoint, IDENTITY_MATRIX } from '../../core/geometry/LayerCoordinates'
import { geometryBounds } from '~/core/vector/PathGeometry'
import { computed, ref } from 'vue'
import type { VectorGeometry, VectorLayer } from '~/core/model/types'
import { SetVectorGeometryCommand } from '~/core/commands/VectorCommands'
import { SetLayerTransformCommand } from '~/core/commands/EditingCommands'
import { starPoints } from '~/tools/shapes/AdditionalShapes'
import { polygonPoints } from '~/tools/shapes/PolygonTool'
import { shapeSize, resizeShape } from '~/tools/shapes/ShapeProperties'
import { editorCore } from '~/composables/useEditor'

const props = defineProps<{ layer: VectorLayer; revision: number }>()
const error = ref('')
const fields = computed(() => {
  void props.revision
  return Object.entries(props.layer.geometry).filter(([key, value]) => key !== 'type' && key !== 'width' && key !== 'height' && typeof value === 'number') as Array<[string, number]>
})
const world = computed(() => { void props.revision; return layerWorldMatrix(editorCore.document?.layers ?? [], props.layer.id) ?? IDENTITY_MATRIX })
const factors = computed(() => ({ width: Math.hypot(world.value[0], world.value[1]), height: Math.hypot(world.value[2], world.value[3]) }))
const position = computed(() => { void props.revision; const b = geometryBounds(props.layer.geometry); return transformPoint(world.value, { x: b.x, y: b.y }) })
const dimensions = computed(() => { void props.revision; const size = shapeSize(props.layer.geometry); return size ? { width: size.width * factors.value.width, height: size.height * factors.value.height } : null })

function commit(geometry: VectorGeometry): void {
  try { editorCore.execute(new SetVectorGeometryCommand(props.layer.id, geometry)); error.value = '' }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Invalid geometry' }
}

function changeNumber(key: string, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  commit({ ...props.layer.geometry, [key]: value } as VectorGeometry)
}

function changePath(event: Event): void {
  commit({ type: 'path', d: (event.target as HTMLTextAreaElement).value })
}

function changePoints(event: Event): void {
  const points = (event.target as HTMLInputElement).value.trim().split(/[\s,]+/).filter(Boolean).map(Number)
  commit({ type: 'polygon', points })
}
function changeDimension(dimension: 'width' | 'height', event: Event): void {
  try { commit(resizeShape(props.layer.geometry, dimension, Number((event.target as HTMLInputElement).value) / Math.max(.000001, factors.value[dimension]))) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Invalid dimension' }
}
function changeTransform(key: 'x' | 'y' | 'rotation', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) { error.value = 'Invalid transform'; return }
  const before = { ...props.layer.transform }
  let after = { ...before, [key]: key === 'rotation' ? value * Math.PI / 180 : value }
  if (key !== 'rotation') {
    const parentId = editorCore.layers.locationOf(props.layer.id)?.parentId, parent = parentId ? layerWorldMatrix(editorCore.document?.layers ?? [], parentId) ?? IDENTITY_MATRIX : IDENTITY_MATRIX
    const inverse = invertAffine(parent), zero = transformPoint(inverse, { x: 0, y: 0 }), delta = transformPoint(inverse, { x: key === 'x' ? value - position.value.x : 0, y: key === 'y' ? value - position.value.y : 0 })
    after = { ...before, x: before.x + delta.x - zero.x, y: before.y + delta.y - zero.y }
  }
  editorCore.execute(new SetLayerTransformCommand(props.layer.id, before, after))
}
function changeParametric(key: 'sides' | 'innerRadius', event: Event): void {
  const geometry = props.layer.geometry
  if (geometry.type !== 'polygon' || !geometry.parametric) return
  const value = Number((event.target as HTMLInputElement).value), params = { ...geometry.parametric, [key]: value }, size = shapeSize(geometry)
  if (!size || !Number.isFinite(value) || params.sides < 3 || params.sides > 64 || params.innerRadius <= 0 || params.innerRadius >= 1) { error.value = 'Invalid shape parameters'; return }
  const xs = geometry.points.filter((_, i) => i % 2 === 0), ys = geometry.points.filter((_, i) => i % 2 === 1), x = Math.min(...xs), y = Math.min(...ys)
  const points = params.kind === 'star' ? starPoints(size.width, size.height, params.sides, params.innerRadius) : polygonPoints(size.width, size.height, params.sides)
  commit({ ...geometry, points: points.map((point, i) => point + (i % 2 ? y : x)), parametric: params })
}
</script>

<template>
  <div class="space-y-2" aria-label="Vector geometry">
    <div class="text-[11px] uppercase tracking-wide text-ui-secondary-text">{{ layer.geometry.type }} geometry</div>
    <label class="property-row"><span>X</span><input class="property-input" type="number" step="any" :disabled="layer.locked" :value="Number(position.x.toFixed(3))" aria-label="Shape X" @change="changeTransform('x', $event)"></label>
    <label class="property-row"><span>Y</span><input class="property-input" type="number" step="any" :disabled="layer.locked" :value="Number(position.y.toFixed(3))" aria-label="Shape Y" @change="changeTransform('y', $event)"></label>
    <label v-if="dimensions" class="property-row"><span>Width</span><input class="property-input" type="number" min="0.01" step="any" :disabled="layer.locked" :value="Number(dimensions.width.toFixed(3))" aria-label="Shape width" @change="changeDimension('width', $event)"></label>
    <label v-if="dimensions" class="property-row"><span>Height</span><input class="property-input" type="number" min="0.01" step="any" :disabled="layer.locked" :value="Number(dimensions.height.toFixed(3))" aria-label="Shape height" @change="changeDimension('height', $event)"></label>
    <label class="property-row"><span>Rotation</span><input class="property-input" type="number" step="any" :disabled="layer.locked" :value="Number((layer.transform.rotation * 180 / Math.PI).toFixed(3))" aria-label="Shape rotation" @change="changeTransform('rotation', $event)"></label>
    <label v-for="[key, value] in fields" :key="key" class="property-row">
      <span>{{ key }}</span>
      <input class="property-input" type="number" step="any" :disabled="layer.locked" :value="value" @change="changeNumber(key, $event)">
    </label>
    <template v-if="layer.geometry.type === 'polygon' && layer.geometry.parametric">
      <label class="property-row"><span>{{ layer.geometry.parametric.kind === 'star' ? 'Points' : 'Sides' }}</span><input class="property-input" type="number" min="3" max="64" :disabled="layer.locked" :value="layer.geometry.parametric.sides" aria-label="Shape point count" @change="changeParametric('sides', $event)"></label>
      <label v-if="layer.geometry.parametric.kind === 'star'" class="property-row"><span>Inner radius</span><input class="property-input" type="number" min="0.01" max="0.99" step="0.01" :disabled="layer.locked" :value="layer.geometry.parametric.innerRadius" aria-label="Shape inner radius" @change="changeParametric('innerRadius', $event)"></label>
    </template>
    <label v-if="layer.geometry.type === 'path'" class="block space-y-1">
      <span>Path data</span>
      <textarea class="property-input w-full font-mono" rows="3" :disabled="layer.locked" :value="layer.geometry.d" @change="changePath" />
    </label>
    <label v-if="layer.geometry.type === 'polygon'" class="block space-y-1">
      <span>Points (x y pairs)</span>
      <input class="property-input w-full font-mono" :disabled="layer.locked" :value="layer.geometry.points.join(' ')" @change="changePoints">
    </label>
    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
  </div>
</template>
