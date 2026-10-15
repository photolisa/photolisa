<script setup lang="ts">
defineProps<{ name: string }>()
const emit = defineEmits<{ cancel: []; discard: []; save: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/60" role="dialog" aria-modal="true" aria-label="Close unsaved project">
    <div class="w-[min(420px,90vw)] border border-ui-border bg-ui-panel p-5 shadow-2xl">
      <h2 class="text-sm font-semibold text-ui-text">Save changes to {{ name }}?</h2>
      <p class="mt-2 text-xs text-ui-secondary-text">This project has unsaved edits. You can reopen the tab during this session while its state remains available.</p>
      <div class="mt-5 flex justify-end gap-2 text-xs">
        <button class="border border-ui-border px-3 py-1.5 hover:bg-ui-hover" @click="emit('cancel')">Cancel</button>
        <button class="border border-ui-border px-3 py-1.5 hover:bg-ui-hover" @click="emit('discard')">Close without saving</button>
        <button class="border border-accent bg-accent px-3 py-1.5 text-ui-text" @click="emit('save')">Save and close</button>
      </div>
    </div>
  </div>
</template>
