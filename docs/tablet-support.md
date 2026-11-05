# Graphics tablets

Photolisa accepts graphics tablets through the browser's standard Pointer Events
API, including Wacom-style pens reported by their driver as `pointerType: pen`.
There is no vendor plugin or device pairing step in the editor.

- Brush settings expose **Pen pressure controls size** and **Pen pressure controls
  ink strength**. Presets supply their own defaults. Pencil remains pixel-exact
  with constant width; mouse and touch use constant pressure.
- Coalesced pen contact samples retain their positions and pressures. Hover does
  not paint. Zero pressure on release retains the last contact pressure.
- With Brush, Pencil, or Eraser selected, a pen's eraser end temporarily erases.
  It uses the existing eraser brush settings and mask behavior without changing
  the selected tool. Other tools ignore eraser contact. The driver must report
  standard eraser input (`button: 5` or `buttons & 32`).
- While a gesture is captured, other pointers cannot move, finish, or cancel it.
  This protects a pen stroke from concurrent palm/touch input; it is not hardware
  palm detection before a pen stroke starts.
- Each stroke is one undoable action. Escape, pointer cancellation, capture loss,
  or window focus loss restores the uncommitted pixels through the existing
  raster stroke lifecycle.

Install/configure the tablet's driver so the browser receives pen input. Drivers
that emulate a mouse provide constant pressure and cannot expose an eraser end.
The browser and driver determine the available pressure resolution. Tilt, barrel
rotation, tablet button mapping, and vendor-specific settings are not implemented.
Barrel-button-only presses do not start painting strokes.

Automated coverage uses browser pen emulation and synthetic Pointer Events,
decoded PNG pixels, and undo/redo. Physical tablets still require manual checking
on each target browser/OS/driver combination.

Input mappings follow the [W3C Pointer Events specification](https://www.w3.org/TR/pointerevents/).
