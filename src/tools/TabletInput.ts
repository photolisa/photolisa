/** Standard Pointer Events work with tablet drivers without a vendor plugin. */
export function isPenEraser(event: Pick<PointerEvent, 'pointerType' | 'button' | 'buttons'>): boolean {
  return event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0)
}

export function pressureOf(event: Pick<PointerEvent, 'pointerType' | 'pressure'>): number {
  if (event.pointerType !== 'pen') return 1
  // Zero at pen-up lets the stroke retain its last contact pressure rather than
  // introducing a full-size blob at the end. RasterStroke owns that fallback.
  return Number.isFinite(event.pressure) ? Math.max(0, Math.min(1, event.pressure)) : 0
}

export function strokeSamples(event: PointerEvent): readonly PointerEvent[] {
  const coalesced = event.getCoalescedEvents?.()
  const samples = coalesced?.length ? coalesced : [event]
  // Hover and unrelated pointers must never deposit ink into an active stroke.
  return samples.filter(sample => sample.pointerId === event.pointerId
    && (sample.pointerType !== 'pen' || (sample.buttons & 33) !== 0))
}
