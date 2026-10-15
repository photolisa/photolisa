<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUiStore } from '../../stores/ui'
import { BASIC_PALETTES, formatHex, type ColorValue, type ColorSwatch } from '~/core/colors/ColorManager'
import { colorRgba } from '~/raster/SampledColor'

const ui = useUiStore()
const palette = ref<keyof typeof BASIC_PALETTES>('Grayscale')
const collectionId = ref('')
const newCollectionName = ref('')
const newColorName = ref('')
const editingCollection = ref(false)
const collectionName = ref('')
const editingSwatchId = ref('')
const swatchName = ref('')
const error = ref('')
const collection = computed(() => ui.colorCollections.find((item) => item.id === collectionId.value) ?? null)

function run(action: () => void): void { try { action(); error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Color library action failed' } }
function choose(color: ColorValue): void { ui.setColor('foreground', color) }
function createCollection(): void { run(() => { collectionId.value = ui.createColorCollection(newCollectionName.value); newCollectionName.value = '' }) }
function renameCollection(): void { if (!collection.value) return; run(() => { ui.renameColorCollection(collection.value!.id, collectionName.value); editingCollection.value = false }) }
function deleteCollection(): void { if (!collection.value || !window.confirm(`Remove collection “${collection.value.name}” and its swatches?`)) return; run(() => { ui.removeColorCollection(collection.value!.id); collectionId.value = '' }) }
function addColor(): void { if (!collection.value) return; run(() => { ui.addCollectionColor(collection.value!.id, newColorName.value || undefined); newColorName.value = '' }) }
function renameColor(swatch: ColorSwatch): void {
  run(() => {
    if (collection.value) ui.renameCollectionColor(collection.value.id, swatch.id, swatchName.value)
    else ui.renameFavorite(swatch.id, swatchName.value)
    editingSwatchId.value = ''
  })
}
function removeColor(swatch: ColorSwatch): void { run(() => { if (collection.value) ui.removeCollectionColor(collection.value.id, swatch.id); else ui.removeFavorite(swatch.id) }) }
function editColor(swatch: ColorSwatch): void { editingSwatchId.value = swatch.id; swatchName.value = swatch.name }
</script>

<template>
  <div class="space-y-3 p-2 text-xs text-ui-text" aria-label="Color swatches">
    <p v-if="ui.colorError" class="text-warning" role="status">Swatches are not saved: {{ ui.colorError }}</p>
    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
    <section><div class="mb-1 flex items-center justify-between"><h3 class="heading">History</h3><span class="text-ui-muted">{{ ui.recentSwatches.length }}</span></div><div class="swatch-grid"><button v-for="(color, index) in ui.recentSwatches" :key="`${formatHex(color)}-${index}`" class="swatch checker" :title="`Use ${formatHex(color)} as foreground; right-click for background`" :aria-label="`History color ${formatHex(color)}`" @click="choose(color)" @contextmenu.prevent="ui.setColor('background', color)"><span :style="{ backgroundColor: colorRgba(color) }" /></button></div></section>
    <section><div class="mb-1 flex items-center justify-between"><h3 class="heading">Favorites</h3><button class="small-action" aria-label="Add foreground to favorites" title="Add foreground to favorites" @click="run(() => ui.addFavorite())">+ Add</button></div><div class="swatch-grid"><button v-for="swatch in ui.favoriteSwatches" :key="swatch.id" class="swatch checker" :title="`${swatch.name} · ${formatHex(swatch.color)}`" :aria-label="`Favorite ${swatch.name}`" @click="choose(swatch.color)" @contextmenu.prevent="ui.setColor('background', swatch.color)"><span :style="{ backgroundColor: colorRgba(swatch.color) }" /></button></div></section>
    <section><div class="mb-1 flex items-center justify-between"><h3 class="heading">Palettes</h3><select v-model="palette" class="field h-6" aria-label="Basic palette"><option v-for="name in Object.keys(BASIC_PALETTES)" :key="name" :value="name">{{ name }}</option></select></div><div class="swatch-grid"><button v-for="(color, index) in BASIC_PALETTES[palette]" :key="index" class="swatch checker" :title="formatHex(color)" :aria-label="`Palette color ${formatHex(color)}`" @click="choose(color)" @contextmenu.prevent="ui.setColor('background', color)"><span :style="{ backgroundColor: colorRgba(color) }" /></button></div></section>
    <section class="space-y-2 border-t border-ui-border pt-2"><h3 class="heading">Collections</h3><div class="flex gap-1"><select v-model="collectionId" class="field min-w-0 flex-1" aria-label="Swatch collection"><option value="">Favorites</option><option v-for="item in ui.colorCollections" :key="item.id" :value="item.id">{{ item.name }}</option></select><button v-if="collection" class="small-action" aria-label="Rename collection" @click="collectionName = collection.name; editingCollection = true">Rename</button><button v-if="collection" class="small-action" aria-label="Remove collection" @click="deleteCollection">Remove</button></div>
      <div v-if="editingCollection" class="flex gap-1"><input v-model="collectionName" class="field min-w-0 flex-1" aria-label="New collection name" maxlength="80" @keyup.enter="renameCollection"><button class="small-action" @click="renameCollection">Save</button></div>
      <div class="flex gap-1"><input v-model="newCollectionName" class="field min-w-0 flex-1" placeholder="New collection" aria-label="Create collection name" maxlength="80" @keyup.enter="createCollection"><button class="small-action" :disabled="!newCollectionName.trim()" @click="createCollection">Create</button></div>
      <div v-if="collection" class="space-y-1"><div class="flex gap-1"><input v-model="newColorName" class="field min-w-0 flex-1" placeholder="Swatch name (optional)" aria-label="New swatch name" maxlength="80" @keyup.enter="addColor"><button class="small-action" aria-label="Add foreground to collection" @click="addColor">Add color</button></div><div class="swatch-grid"><button v-for="swatch in collection.colors" :key="swatch.id" class="swatch checker" :title="`${swatch.name} · ${formatHex(swatch.color)}`" :aria-label="`Collection color ${swatch.name}`" @click="choose(swatch.color)" @contextmenu.prevent="ui.setColor('background', swatch.color)"><span :style="{ backgroundColor: colorRgba(swatch.color) }" /></button></div></div>
      <div v-if="(collection?.colors ?? ui.favoriteSwatches).length" class="max-h-28 space-y-1 overflow-auto border-t border-ui-border pt-1"><div v-for="swatch in collection?.colors ?? ui.favoriteSwatches" :key="swatch.id" class="flex items-center gap-1"><span class="checker h-4 w-4 shrink-0 border border-ui-border"><span class="block h-full w-full" :style="{ backgroundColor: colorRgba(swatch.color) }" /></span><template v-if="editingSwatchId === swatch.id"><input v-model="swatchName" class="field min-w-0 flex-1" aria-label="Rename swatch" maxlength="80" @keyup.enter="renameColor(swatch)"><button class="small-action" @click="renameColor(swatch)">Save</button></template><template v-else><span class="min-w-0 flex-1 truncate" :title="swatch.name">{{ swatch.name }}</span><button class="small-action" :aria-label="`Rename ${swatch.name}`" @click="editColor(swatch)">Rename</button><button class="small-action" :aria-label="`Remove ${swatch.name}`" @click="removeColor(swatch)">×</button></template></div></div>
    </section>
  </div>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.heading { @apply text-[11px] font-semibold uppercase tracking-wide text-ui-secondary-text; }
.field { @apply h-7 border border-ui-border bg-ui-elevated px-1.5 text-ui-text; }
.small-action { @apply border border-ui-border px-1.5 py-0.5 text-[11px] text-ui-secondary-text hover:bg-ui-hover hover:text-ui-text disabled:opacity-30; }
.swatch-grid { @apply flex flex-wrap gap-1; }
.swatch { @apply block h-6 w-6 border border-ui-border hover:border-accent; }
.swatch > span { @apply block h-full w-full; }
.checker { background-color: #fff; background-image: linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%); background-size: 8px 8px; background-position: 0 0, 0 4px, 4px -4px, -4px 0; }
</style>
