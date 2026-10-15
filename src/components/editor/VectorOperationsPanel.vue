<script setup lang="ts">
import { saveEditorFile } from '../../adapters/BrowserFileAdapter'
import { useUiStore } from '../../stores/ui'
import { JoinVectorLayersCommand } from '../../core/commands/JoinVectorLayersCommand'
import { computed, ref } from 'vue'
import { editorCore } from '../../composables/useEditor'
import {
  BooleanGroupCommand,
  FlattenBooleanCommand,
} from '../../core/commands/VectorOperations'
import {
  GroupLayersCommand,
  UngroupLayerCommand,
  MoveLayerCommand,
} from '../../core/commands/LayerCommands'
import { SetLayerTransformCommand } from '../../core/commands/EditingCommands'
import { SetVectorGeometryCommand } from '../../core/commands/VectorCommands'
import {
  alignmentTransforms,
  type AlignmentAction,
} from '../../core/vector/Alignment'
import { readSubpaths, type BooleanOperation } from '../../core/vector/PathGeometry'
import { vectorEntries, worldMatrix } from '../../tools/VectorToolController'
import { IDENTITY_MATRIX } from '../../core/geometry/LayerCoordinates'
import {
  editPath,
  supportsPathAction,
  type PathAction,
} from '../../core/vector/PathEditing'
const ui = useUiStore()
const presetName = ref('Custom shape')
const core = () => editorCore
const props = defineProps<{ revision: number }>()
const relative = ref('selection'),
  error = ref('')
const document = computed(() => {
  void props.revision
  return editorCore.document
})
const selected = computed(() => {
  void props.revision
  return document.value
    ? vectorEntries(document.value.layers).filter((e) =>
        document.value!.selectedLayerIds.includes(e.layer.id),
      )
    : []
})
const active = computed(() => {
  void props.revision
  return document.value?.activeLayerId
    ? editorCore.layers.find(document.value.activeLayerId)
    : null
})
const alignments: [AlignmentAction, string][] = [
  ['left', 'Left'],
  ['center-x', 'Center H'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['center-y', 'Center V'],
  ['bottom', 'Bottom'],
  ['distribute-x', 'Distribute H'],
  ['distribute-y', 'Distribute V'],
  ['spacing-x', 'Space H'],
  ['spacing-y', 'Space V'],
  ['match-width', 'Match W'],
  ['match-height', 'Match H'],
]
const canBoolean = computed(() => {
  void props.revision
  const entries = selected.value
  return (
    entries.length >= 2 &&
    entries.every(
      (e) =>
        editorCore.layers.locationOf(e.layer.id)?.parentId ===
        editorCore.layers.locationOf(entries[0]!.layer.id)?.parentId,
    )
  )
})
const booleans: BooleanOperation[] = [
  'union',
  'subtract',
  'intersect',
  'exclude',
  'divide',
]
function perform(action: () => void): void {
  try {
    action()
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Vector operation failed'
  }
}
function align(action: AlignmentAction): void {
  perform(() => {
    const doc = document.value
    if (!doc) return
    const entries = selected.value.map((e) => {
      const parentId = editorCore.layers.locationOf(e.layer.id)?.parentId
      return {
        ...e,
        parent: parentId
          ? (worldMatrix(doc.layers, parentId) ?? IDENTITY_MATRIX)
          : IDENTITY_MATRIX,
      }
    })
    const transforms = alignmentTransforms(
      entries,
      action,
      relative.value === 'canvas'
        ? {
            x: 0,
            y: 0,
            width: doc.dimensions.width,
            height: doc.dimensions.height,
          }
        : undefined,
    )
    editorCore.beginTransaction('Align Shapes')
    try {
      for (const e of entries) {
        const after = transforms.get(e.layer.id)
        if (after)
          editorCore.execute(
            new SetLayerTransformCommand(
              e.layer.id,
              { ...e.layer.transform },
              after,
            ),
          )
      }
      editorCore.commitTransaction()
    } catch (error) {
      editorCore.cancelTransaction()
      throw error
    }
  })
}
function pathAction(action: PathAction): void {
  perform(() => {
    if (action === 'join' && selected.value.length >= 2) { editorCore.execute(new JoinVectorLayersCommand(selected.value.map(e => e.layer.id))); return }
    const layer = active.value
    if (layer?.kind !== 'vector' || layer.locked) return
    const anchor =
      editorCore.vectorAnchor?.layerId === layer.id
        ? editorCore.vectorAnchor
        : null
    editorCore.execute(
      new SetVectorGeometryCommand(
        layer.id,
        editPath(layer.geometry, action, anchor),
      ),
    )
  })
}
function pathSupported(action: PathAction): boolean {
  void props.revision
  if (action === 'join' && canBoolean.value) return selected.value.flatMap(e => readSubpaths(e.layer.geometry)).filter(path => !path.closed && path.anchors.length).length >= 2
  const layer = active.value
  return (
    layer?.kind === 'vector' &&
    !layer.locked &&
    supportsPathAction(
      layer.geometry,
      action,
      editorCore.vectorAnchor?.layerId === layer.id
        ? editorCore.vectorAnchor
        : null,
    )
  )
}

function flip(axis: 'scaleX' | 'scaleY'): void {
  perform(() => {
    const layer = active.value
    if (layer && !layer.locked)
      editorCore.execute(
        new SetLayerTransformCommand(
          layer.id,
          { ...layer.transform },
          { ...layer.transform, [axis]: -layer.transform[axis] },
        ),
      )
  })
}
function order(action: 'front' | 'back' | 'forward' | 'backward'): void {
  perform(() => {
    const layer = active.value,
      doc = document.value
    if (!layer || layer.locked || !doc) return
    const location = editorCore.layers.locationOf(layer.id)
    if (!location) return
    const parent = location.parentId
        ? editorCore.layers.find(location.parentId)
        : null,
      siblings = parent?.kind === 'group' ? parent.children : doc.layers
    const index =
      action === 'front'
        ? siblings.length
        : action === 'back'
          ? 0
          : action === 'forward'
            ? location.index + 2
            : Math.max(0, location.index - 1)
    editorCore.execute(new MoveLayerCommand(layer.id, location.parentId, index))
  })
}
async function exportSelected(): Promise<void> {
  const doc = document.value
  if (!doc) return
  try {
    const { SvgExporter } = await import('../../adapters/SvgExporter')
    const result = await new SvgExporter().export(doc, true)
    await saveEditorFile(result.blob, `${doc.name}-selection.svg`)
    error.value = result.warnings.join(' ')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'SVG export failed'
  }
}
</script>
<template>
  <div class="space-y-2" aria-label="Vector operations">
    <label class="property-row"><span>Align to</span><select v-model="relative" class="property-input">
      <option value="selection">Selection</option>
      <option value="canvas">Canvas</option>
    </select></label>
    <div class="grid grid-cols-3 gap-1">
      <button
        v-for="[action, label] in alignments"
        :key="action"
        class="vector-action"
        :disabled="
          selected.length <
            (action.startsWith('spacing') || action.startsWith('distribute')
              ? 3
              : relative === 'canvas'
                ? 1
                : 2)
        "
        @click="align(action)"
      >
        {{ label }}
      </button>
    </div>
    <div class="grid grid-cols-3 gap-1">
      <button
        v-for="operation in booleans"
        :key="operation"
        class="vector-action capitalize"
        :disabled="!canBoolean"
        @click="
          perform(() =>
            core().execute(
              new BooleanGroupCommand(
                selected.map((e) => e.layer.id),
                operation,
              ),
            ),
          )
        "
      >
        {{ operation }}
      </button>
    </div>
    <button
      v-if="active?.kind === 'group' && active.booleanOperation"
      class="vector-action w-full"
      :disabled="active.locked"
      @click="
        perform(() => core().execute(new FlattenBooleanCommand(active!.id)))
      "
    >
      Flatten boolean result
    </button>
    <div class="grid grid-cols-2 gap-1">
      <button
        class="vector-action"
        :disabled="!document || document.selectedLayerIds.length < 2"
        @click="
          perform(() =>
            core().execute(new GroupLayersCommand(document!.selectedLayerIds)),
          )
        "
      >
        Group
      </button>
      <button
        class="vector-action"
        :disabled="active?.kind !== 'group' || active.locked"
        @click="
          perform(() => core().execute(new UngroupLayerCommand(active!.id)))
        "
      >
        Ungroup
      </button>
      <button
        class="vector-action"
        :disabled="!active || active.locked"
        @click="flip('scaleX')"
      >
        Flip H</button><button
        class="vector-action"
        :disabled="!active || active.locked"
        @click="flip('scaleY')"
      >
        Flip V
      </button>
      <button
        v-for="action in ['front', 'back', 'forward', 'backward'] as const"
        :key="action"
        class="vector-action capitalize"
        :disabled="!active || active.locked"
        @click="order(action)"
      >
        {{ action }}
      </button>
    </div>
    <div v-if="active?.kind === 'vector'" class="grid grid-cols-2 gap-1">
      <button
        v-for="action in [
          'convert',
          'reverse',
          'close',
          'open',
          'smooth',
          'corner',
          'split',
          'join',
        ] as const"
        :key="action"
        class="vector-action capitalize"
        :disabled="!pathSupported(action)"
        @click="pathAction(action)"
      >
        {{
          action === 'convert'
            ? 'Convert to path'
            : action === 'smooth' || action === 'corner'
              ? action + ' anchors'
              : action + ' path'
        }}
      </button>
    </div>
    <div v-if="active?.kind === 'vector'" class="flex gap-1">
      <input
        v-model="presetName"
        class="property-input min-w-0 flex-1"
        aria-label="Custom shape name"
      /><button
        class="vector-action"
        :disabled="active.locked"
        @click="
          perform(() =>
            ui.addShapePreset(
              presetName,
              (active as import('../../core/model/types').VectorLayer).geometry,
            ),
          )
        "
      >
        Save preset
      </button>
    </div>
    <button
      class="vector-action w-full"
      :disabled="!document?.selectedLayerIds.length"
      @click="exportSelected"
    >
      Export selection as SVG
    </button>
    <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
  </div>
</template>
<style scoped>
.vector-action {
  border: 1px solid var(--color-ui-border);
  border-radius: 4px;
  padding: 4px;
  font-size: 10px;
}
.vector-action:hover {
  background: var(--color-ui-hover);
}
.vector-action:disabled {
  opacity: 0.35;
}
</style>
