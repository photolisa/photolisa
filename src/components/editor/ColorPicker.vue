<script setup lang="ts">
import { ref } from 'vue'
import { useDialogFocus } from '../../composables/useDialogFocus'
import EditorColorField from './ColorField.vue'
import type { ColorValue } from '~/core/colors/ColorManager'
import { formatHex, fromHsl, parseHex, toHsl } from '~/core/colors/ColorManager'
import { colorRgba } from '~/raster/SampledColor'

const props = defineProps<{ target: 'foreground' | 'background'; color: ColorValue }>()
const emit = defineEmits<{ apply: [color: ColorValue]; close: [] }>()
const draft = ref<ColorValue>({ ...props.color })
const hex = ref(formatHex(props.color))
const mode = ref<'HEX' | 'RGB' | 'RGBA' | 'HSL'>('HEX')
const error = ref('')
const hsl = ref(toHsl(props.color))
const hexInput = ref<HTMLInputElement | null>(null)
const surface = ref<HTMLElement | null>(null)
useDialogFocus(surface, '[aria-label="HEX color"]')

function setDraft(color: ColorValue): void { draft.value = color; hex.value = formatHex(color); hsl.value = toHsl(color); error.value = '' }
function parseHexField(): void { try { setDraft(parseHex(hex.value)) } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Invalid HEX color' } }
function setChannel(channel: keyof ColorValue, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isInteger(value) || value < 0 || value > 255) { error.value = 'RGBA channels must be whole numbers from 0 to 255'; return }
  setDraft({ ...draft.value, [channel]: value })
}
function setHsl(channel: 'h' | 's' | 'l', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  try { setDraft(fromHsl(channel === 'h' ? value : hsl.value.h, channel === 's' ? value : hsl.value.s, channel === 'l' ? value : hsl.value.l, draft.value.a)) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Invalid HSL color' }
}
function apply(): void { if (mode.value === 'HEX') parseHexField(); if (!error.value) emit('apply', { ...draft.value }) }
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/70" @click.self="emit('close')" @keydown.esc.stop.prevent="emit('close')">
    <section ref="surface" tabindex="-1" class="w-[min(420px,calc(100vw-2rem))] border border-ui-border bg-ui-panel p-4 text-xs text-ui-text shadow-2xl" role="dialog" aria-modal="true" :aria-label="`${target} color picker`">
      <div class="mb-3 flex items-center justify-between"><h2 class="text-sm font-semibold capitalize">{{ target }} color</h2><button class="text-ui-secondary-text hover:text-ui-text" aria-label="Close color picker" @click="emit('close')">✕</button></div>
      <EditorColorField class="mb-3" :color="draft" @change="setDraft" />
      <div class="mb-3 flex gap-3">
        <div class="checker h-20 w-20 shrink-0 border border-ui-border"><div class="h-full w-full" :style="{ backgroundColor: colorRgba(draft) }" /></div>
        <div class="min-w-0 flex-1 space-y-2"><label class="block">Color <input class="ml-2 h-7 w-12 align-middle" type="color" :value="formatHex(draft, false)" aria-label="Visual color picker" @input="setDraft({ ...parseHex(($event.target as HTMLInputElement).value), a: draft.a })"></label><div class="font-mono">{{ formatHex(draft) }}</div><div class="text-ui-secondary-text">Alpha {{ Math.round(draft.a / 255 * 100) }}%</div></div>
      </div>
      <div class="mb-3 flex gap-1" role="tablist" aria-label="Color input format"><button v-for="format in ['HEX', 'RGB', 'RGBA', 'HSL'] as const" :key="format" class="border px-2 py-1" :class="mode === format ? 'border-accent bg-ui-active text-ui-text' : 'border-ui-border text-ui-secondary-text'" role="tab" :aria-selected="mode === format" @click="mode = format">{{ format }}</button></div>
      <label v-if="mode === 'HEX'" class="block">HEX <input ref="hexInput" v-model="hex" class="field ml-2 w-40 font-mono" aria-label="HEX color" @change="parseHexField" @keyup.enter="apply"></label>
      <div v-else-if="mode === 'RGB' || mode === 'RGBA'" class="flex gap-2"><label v-for="channel in (mode === 'RGBA' ? ['r', 'g', 'b', 'a'] : ['r', 'g', 'b']) as Array<keyof ColorValue>" :key="channel" class="flex-1 uppercase">{{ channel }}<input class="field mt-1 w-full" type="number" min="0" max="255" :aria-label="`${channel.toUpperCase()} channel`" :value="draft[channel]" @change="setChannel(channel, $event)"></label></div>
      <div v-else class="flex gap-2"><label v-for="channel in ['h', 's', 'l'] as const" :key="channel" class="flex-1 uppercase">{{ channel }}<input class="field mt-1 w-full" type="number" :min="0" :max="channel === 'h' ? 360 : 100" :aria-label="`${channel.toUpperCase()} channel`" :value="hsl[channel]" @change="setHsl(channel, $event)"></label></div>
      <p v-if="error" class="mt-2 text-danger" role="alert">{{ error }}</p>
      <div class="mt-4 flex justify-end gap-2"><button class="border border-ui-border px-3 py-1.5 hover:bg-ui-hover" @click="emit('close')">Cancel</button><button class="bg-accent px-3 py-1.5 text-ui-text hover:bg-accent-hover" @click="apply">Apply</button></div>
    </section>
  </div>
</template>

<style scoped>
@reference "../../assets/css/main.css";
.field { @apply h-8 border border-ui-border bg-ui-elevated px-2 text-ui-text; }
.checker { background-color: #fff; background-image: linear-gradient(45deg, #999 25%, transparent 25%), linear-gradient(-45deg, #999 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #999 75%), linear-gradient(-45deg, transparent 75%, #999 75%); background-size: 12px 12px; background-position: 0 0, 0 6px, 6px -6px, -6px 0; }
</style>
