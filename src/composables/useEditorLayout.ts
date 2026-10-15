import { computed, ref } from 'vue'
import { useMediaQuery, useStorage } from '@vueuse/core'

/** Presentation preferences never mutate document or history state. */
export function useEditorLayout() {
  const mode = useStorage<'simple' | 'pro'>('photolisa.workspace.mode', 'pro')
  if (mode.value !== 'simple' && mode.value !== 'pro') mode.value = 'pro'
  const collapsed = useStorage('photolisa.workspace.panelsCollapsed', false)
  const narrow = useMediaQuery('(max-width: 1023px)')
  const mobileOpen = ref(false)
  const panelsVisible = computed(() => narrow.value ? mobileOpen.value : !collapsed.value)
  function togglePanels(): void {
    if (narrow.value) mobileOpen.value = !mobileOpen.value
    else collapsed.value = !collapsed.value
  }
  return { mode, panelsVisible, togglePanels }
}
