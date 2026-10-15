<script setup lang="ts">
import { ref } from 'vue'
import { useUiStore } from '../../stores/ui'
import type { ToolId } from '~/stores/ui'
import { colorHex, colorRgbHex, colorRgba } from '~/raster/SampledColor'

defineProps<{ tool: ToolId }>()
const emit = defineEmits<{ confirm: []; cancel: []; closePath: []; feather: [radius: number] }>()
const ui = useUiStore()
const featherRadius = ref(2)
</script>

<template>
  <div class="tool-options flex h-10 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap bg-[#141414] border-b border-white/10 px-3 text-xs text-ui-text">
    <span class="w-20 font-medium capitalize text-ui-text">{{ ['marquee', 'ellipse-marquee', 'lasso'].includes(tool) ? 'Selection' : tool }}</span>
    <template v-if="tool === 'brush' || tool === 'eraser' || tool === 'clone-stamp' || tool === 'spot-repair'">
      <label class="option"><span>Size</span><input v-model.number="ui.brush.diameter" type="range" min="1" max="500"><span>{{ ui.brush.diameter }} px</span></label>
      <label class="option"><span>Hardness</span><input v-model.number="ui.brush.hardness" type="range" min="0" max="1" step="0.05"><span>{{ Math.round(ui.brush.hardness * 100) }}%</span></label>
      <label class="option"><span>Opacity</span><input v-model.number="ui.brush.opacity" type="range" min="0.01" max="1" step="0.01"><span>{{ Math.round(ui.brush.opacity * 100) }}%</span></label>
      <label v-if="tool === 'brush'" class="option"><span>Flow</span><input v-model.number="ui.brush.flow" type="range" min="0.01" max="1" step="0.01"><span>{{ Math.round(ui.brush.flow * 100) }}%</span></label>
      <label v-if="tool === 'brush'" class="option"><span>Spacing</span><input v-model.number="ui.brush.spacing" type="range" min="0.01" max="2" step="0.01"><span>{{ Math.round(ui.brush.spacing * 100) }}%</span></label>
      <span v-if="tool === 'clone-stamp'" class="text-ui-secondary-text">Alt-click to sample, then drag to clone. Duplicate the layer first for nondestructive work.</span>
      <span v-if="tool === 'spot-repair'" class="text-ui-secondary-text">Click a small blemish to blend it with surrounding pixels.</span>
    </template>
    <template v-else-if="tool === 'pencil'">
      <label class="option"><span>Size</span><input v-model.number="ui.pencil.diameter" type="range" min="1" max="64" step="1"><span>{{ ui.pencil.diameter }} px</span></label>
      <label class="option"><span>Opacity</span><input v-model.number="ui.pencil.opacity" type="range" min="0.01" max="1" step="0.01"><span>{{ Math.round(ui.pencil.opacity * 100) }}%</span></label>
      <label class="flex items-center gap-1.5 text-ui-secondary-text"><input v-model="ui.pencil.pixelGrid" type="checkbox" class="accent-accent"><span>Pixel grid</span></label>
    </template>
    <template v-else-if="tool === 'paint-bucket'">
      <label class="option"><span>Tolerance</span><input v-model.number="ui.bucket.tolerance" type="range" min="0" max="255" step="1" aria-label="Bucket tolerance"><span>{{ ui.bucket.tolerance }}</span></label>
      <label class="option"><span>Opacity</span><input v-model.number="ui.bucket.opacity" type="range" min="0.01" max="1" step="0.01" aria-label="Bucket opacity"><span>{{ Math.round(ui.bucket.opacity * 100) }}%</span></label>
      <span class="text-ui-secondary-text">Click a contiguous area on the active raster layer.</span>
    </template>
    <template v-else-if="tool === 'crop' || tool === 'transform'">
      <label v-if="tool === 'transform'" class="option"><span>Origin X/Y</span><input v-model.number="ui.transformOrigin.x" class="w-12 bg-ui-toolbar" type="number" min="0" max="1" step="0.1" aria-label="Transform origin X"><input v-model.number="ui.transformOrigin.y" class="w-12 bg-ui-toolbar" type="number" min="0" max="1" step="0.1" aria-label="Transform origin Y"></label>
      <span class="text-ui-secondary-text">Drag handles to adjust. Enter applies; Escape cancels.</span>
      <button class="action primary" @click="emit('confirm')">Apply</button>
      <button class="action" @click="emit('cancel')">Cancel</button>
    </template>
    <template v-else-if="['rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'hexagon', 'line', 'polygon', 'triangle', 'star', 'arrow', 'custom-shape', 'pen', 'curvature-pen', 'freeform-pen'].includes(tool)">
      <label class="option"><span>Mode</span><select v-model="ui.shape.creationMode" class="property-input" aria-label="Vector creation mode"><option value="layer">New layer</option><option value="compound">Add to active vector</option></select></label>
      <label class="option"><span>{{ tool === 'line' ? 'Color' : 'Fill' }}</span><input :value="colorRgbHex(ui.foregroundColor)" type="color" aria-label="Shape fill" class="h-6 w-8" @input="ui.setForegroundRgb(($event.target as HTMLInputElement).value)"></label>
      <label class="option"><span>Stroke</span><input type="checkbox" :checked="ui.shape.stroke !== null" aria-label="Shape stroke enabled" @change="ui.shape.stroke = ($event.target as HTMLInputElement).checked ? colorRgbHex(ui.secondaryColor) : null; ui.shape.strokeOpacity = ui.secondaryColor.a / 255"><input v-if="ui.shape.stroke" v-model="ui.shape.stroke" type="color" aria-label="Shape stroke" class="h-6 w-8"></label>
      <label v-if="ui.shape.stroke || tool === 'line'" class="option"><span>Width</span><input v-model.number="ui.shape.strokeWidth" type="number" min="0" max="1000" step="1" class="w-14 border border-ui-border bg-ui-toolbar px-1"></label>
      <label class="option"><span>Opacity</span><input v-model.number="ui.shape.opacity" type="range" min="0" max="1" step="0.01"><span>{{ Math.round(ui.shape.opacity * 100) }}%</span></label>
      <label v-if="tool === 'rounded-rectangle'" class="option"><span>Radius</span><input v-model.number="ui.shape.cornerRadius" type="number" min="0" max="10000" class="w-14 border border-ui-border bg-ui-toolbar px-1"></label>
      <label v-if="(tool === 'polygon' || tool === 'star')" class="option"><span>Sides</span><input v-model.number="ui.shape.sides" type="number" min="3" max="32" step="1" aria-label="Polygon sides" class="w-14 border border-ui-border bg-ui-toolbar px-1"></label>
      <label v-if="tool === 'custom-shape'" class="option"><span>Preset</span><select v-model.number="ui.customShapeIndex" class="property-input" aria-label="Custom shape preset"><option v-for="(preset, index) in ui.customShapes" :key="index" :value="index">{{ preset.name }}</option></select></label>
      <label v-if="tool === 'star'" class="option"><span>Inner radius</span><input v-model.number="ui.shape.innerRadius" type="number" min="0.01" max="0.99" step="0.01" aria-label="Star inner radius" class="w-14 border border-ui-border bg-ui-toolbar px-1"></label>
      <template v-if="['pen', 'curvature-pen', 'freeform-pen'].includes(tool)"><button class="action" @click="emit('confirm')">Finish path</button><button class="action" @click="emit('closePath')">Close path</button><span class="text-ui-secondary-text">Click anchors · Drag for handles · Enter finishes · Escape cancels</span></template><span v-else class="text-ui-secondary-text">Drag to create · Shift constrains · Alt draws from center</span>
    </template>

    <template v-else-if="['path-selection', 'direct-selection'].includes(tool)"><label class="flex items-center gap-1.5"><input v-model="ui.moveSnapToCanvas" type="checkbox" aria-label="Snap vector objects"> Snap</label><span class="text-ui-secondary-text">Click or marquee to select · Shift adds · Drag anchors or handles · Alt breaks handles / adds a point · Delete removes</span></template>
    <template v-else-if="tool === 'eyedropper'">
      <label class="option"><span>Sample</span><select v-model="ui.eyedropperSampleMode" class="border border-ui-border bg-ui-toolbar px-1 py-0.5 text-ui-text" aria-label="Eyedropper sample source"><option value="visible">All visible layers</option><option value="active">Active layer</option></select></label>
      <span class="flex items-center gap-1.5" title="Foreground color"><span class="h-5 w-5 border border-ui-border" :style="{ backgroundColor: colorRgba(ui.foregroundColor) }" /><span class="font-mono">{{ colorHex(ui.foregroundColor) }}</span><span class="font-mono text-ui-secondary-text">{{ colorRgba(ui.foregroundColor) }}</span></span>
      <div v-if="ui.recentSwatches.length" class="flex items-center gap-1" aria-label="Recent sampled colors"><span class="text-ui-secondary-text">Recent</span><button v-for="swatch in ui.recentSwatches" :key="colorHex(swatch)" class="h-5 w-5 border border-ui-border hover:border-accent" :style="{ backgroundColor: colorRgba(swatch) }" :title="`Select ${colorHex(swatch)}`" :aria-label="`Select recent color ${colorHex(swatch)}`" @click="ui.selectSampledColor(swatch)" /></div>
    </template>
    <template v-else-if="tool === 'move'">
      <label class="flex items-center gap-1.5 text-ui-secondary-text"><input v-model="ui.moveAutoSelect" type="checkbox" class="accent-accent" aria-label="Auto-select layer"><span>Auto-select layer</span></label>
      <label class="flex items-center gap-1.5 text-ui-secondary-text"><input v-model="ui.moveSnapToCanvas" type="checkbox" class="accent-accent" aria-label="Snap to canvas"><span>Snap to canvas</span></label>
      <span class="text-ui-secondary-text">Drag an unlocked layer</span>
    </template>
    <span v-else-if="tool === 'text'" class="text-ui-secondary-text">Click the canvas to add editable text; change its content and style in Properties.</span>
    <template v-else-if="['marquee', 'ellipse-marquee', 'lasso'].includes(tool)">
      <span class="text-ui-secondary-text">Drag to select · Shift add · Alt subtract · Shift+Alt intersect</span>
      <label class="option"><span>Feather</span><input v-model.number="featherRadius" type="number" min="0" max="256" step="1" class="w-14 border border-ui-border bg-ui-toolbar px-1" aria-label="Feather radius"></label>
      <button class="action" @click="emit('feather', featherRadius)">Feather selection</button>
    </template>
    <span v-else-if="tool === 'hand'" class="text-ui-secondary-text">Drag to pan · Space works with any tool</span>
    <span v-else-if="tool === 'zoom'" class="text-ui-secondary-text">Click to zoom in · Alt-click to zoom out</span>
    <template v-if="tool === 'brush' || tool === 'pencil'">
      <label class="flex items-center gap-1 text-ui-secondary-text"><span>Primary</span><input :value="colorRgbHex(ui.foregroundColor)" class="h-6 w-8 border-0 bg-transparent" type="color" aria-label="Primary color" @input="ui.setForegroundRgb(($event.target as HTMLInputElement).value)"></label>
      <label class="flex items-center gap-1 text-ui-secondary-text"><span>Secondary</span><input :value="colorRgbHex(ui.secondaryColor)" class="h-6 w-8 border-0 bg-transparent" type="color" aria-label="Secondary color" @input="ui.setSecondaryRgb(($event.target as HTMLInputElement).value)"></label>
      <button class="border border-ui-border px-1.5 text-ui-text hover:bg-ui-hover" title="Swap primary and secondary colors (X)" aria-label="Swap primary and secondary colors" @click="ui.swapColors()">Swap</button>
    </template>
  </div>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.option { @apply flex items-center gap-2 text-ui-secondary-text; }
.option input[type='range'] { @apply w-24 accent-accent; }
.option span:last-child { @apply w-12 text-right text-ui-text; }
.action { border-radius: 6px; @apply border border-ui-border px-3 py-1 text-ui-text hover:bg-ui-hover; }
.primary { @apply border-accent bg-accent text-ui-text hover:bg-accent-hover; }
</style>
