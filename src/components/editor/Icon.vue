<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { editorIcons, type EditorIconName } from '~/ui/editorIcons'

withDefaults(defineProps<{ name: EditorIconName; size?: number }>(), { size: 18 })
</script>

<template>
  <Icon :icon="editorIcons[name]" :width="size ?? 18" :height="size ?? 18" class="shrink-0" aria-hidden="true" focusable="false" />
</template>
