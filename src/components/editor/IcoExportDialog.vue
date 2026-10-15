<script setup lang="ts">
import { ref } from 'vue'
import { ICO_SIZES, type IcoSize } from '~/adapters/IcoAdapter'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ export: [sizes: IcoSize[]]; close: [] }>()
const selected = ref<IcoSize[]>([16, 32, 48, 256])
const error = ref('')
function submit(): void {
  if (!selected.value.length) { error.value = 'Select at least one size.'; return }
  error.value = ''
  emit('export', [...selected.value].sort((a, b) => a - b))
}
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/65" @mousedown.self="emit('close')">
    <form class="w-[min(28rem,90vw)] border border-ui-border bg-ui-panel shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ico-export-title" @submit.prevent="submit">
      <header id="ico-export-title" class="border-b border-ui-border px-4 py-3 text-sm font-semibold">Export Windows icon</header>
      <div class="space-y-3 p-4 text-xs">
        <p class="text-ui-secondary-text">Choose the resolutions to embed. Each image uses transparency-preserving PNG data and is rendered from the full document.</p>
        <div class="grid grid-cols-2 gap-2">
          <label v-for="size in ICO_SIZES" :key="size" class="flex cursor-pointer items-center gap-2 border border-ui-border px-3 py-2 hover:bg-ui-hover">
            <input v-model="selected" type="checkbox" :value="size" :disabled="busy"><span>{{ size }} × {{ size }}</span>
          </label>
        </div>
        <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
      </div>
      <footer class="flex justify-end gap-2 border-t border-ui-border px-4 py-3 text-xs">
        <button type="button" class="border border-ui-border px-3 py-1.5 hover:bg-ui-hover" :disabled="busy" @click="emit('close')">Cancel</button>
        <button type="submit" class="bg-accent px-3 py-1.5 text-ui-text hover:bg-accent-hover disabled:opacity-50" :disabled="busy">{{ busy ? 'Exporting…' : 'Export ICO' }}</button>
      </footer>
    </form>
  </div>
</template>
