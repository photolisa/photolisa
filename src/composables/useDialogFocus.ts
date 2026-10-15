import { onUnmounted, watch, type Ref } from 'vue'
import { useEventListener } from '@vueuse/core'

/** Keep modal keyboard navigation inside its surface and return focus to its trigger. */
export function useDialogFocus(surface: Ref<HTMLElement | null>, initialSelector?: string): void {
  let trigger: HTMLElement | null = null
  const selector = 'button:enabled, input:enabled, select:enabled, textarea:enabled, [tabindex="0"]'
  function focusable(element: HTMLElement): HTMLElement[] {
    return [...element.querySelectorAll<HTMLElement>(selector)].filter((item) => item.getClientRects().length > 0)
  }
  function restore(): void {
    if (trigger?.isConnected) trigger.focus()
    trigger = null
  }
  watch(surface, (element) => {
    if (!element) { restore(); return }
    trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initial = initialSelector ? element.querySelector<HTMLElement>(initialSelector) : null
    const first = initial ?? focusable(element)[0] ?? element
    first.focus()
  }, { flush: 'post' })
  useEventListener(surface, 'keydown', (event: KeyboardEvent) => {
    const element = surface.value
    if (event.key !== 'Tab' || !element) return
    const controls = focusable(element)
    const first = controls[0], last = controls.at(-1)
    if (!first || !last) { event.preventDefault(); element.focus(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })
  onUnmounted(restore)
}
