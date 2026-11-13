# GeaStack on Sailfish OS: issues found while building FiTerm

Draft bug reports for the GeaStack maintainers. Each section is written to be
filed as its own issue; the target repository is noted per section.

## Environment

| | |
| --- | --- |
| App | [FiTerm](https://github.com/mehmetfiskindal/fiterm), a terminal emulator |
| Device | Xiaomi Redmi Note 8, Sailfish OS 5.1.0.11, aarch64, 1080×2260 |
| Build | Sailfish SDK 3.13.5 (`sfdk`), target `SailfishOS-5.1.0.11-aarch64` |
| `@geastack/linux` | 0.1.3 |
| `@geastack/core` | 0.1.49 |
| `@geastack/engine` | 0.1.20 |
| `@geastack/host` | 0.1.22 |
| `@geastack/compiler` | 1.0.49 |
| `@geastack/cli` | 0.1.108 |
| App config | `gea.sailfish.devicePixelRatio: 2` |

The Sailfish target README says physical device behavior has not been tested.
This is a report from a physical device. Every workaround mentioned below is in
[`patches/geastack-sailfish-build.mjs`](../../patches/geastack-sailfish-build.mjs),
which patches the installed packages before each build.

---

## A. Sailfish target (`geastack/linux`, `targets/sailfish-os`)

### A1. `prepare.mjs` only works next to a `core` checkout

`prepare.mjs` resolves the core package at `<linux>/../core/packages/core`,
requires its version to match, and reads `@geastack/core`, `@geastack/compiler`
and `@geastack/geatsc-plugin-gea` from `<linux>/node_modules`. In an app that
installs `@geastack/linux` from npm, none of those paths exist: the packages
are hoisted to the app's `node_modules`.

It also writes `generated/<app>` and `build/<app>-<arch>` inside the package
directory, i.e. inside `node_modules`.

**Expected:** run from an npm install with no core checkout; resolve packages
from the app; write build output under the app directory.

**Workaround:** make the core checkout optional, resolve from `appDir`, and move
output to `<app>/.gea-sailfish/`.

### A2. No way to compile and link an app's native sources

`package.json` accepts `gea.nativeSources`, but the Sailfish `prepare.mjs` does
not copy those files into the stage, add them to the source list, or add an
include path. Extra link dependencies (`util` for `forkpty`, `maliit-glib`)
cannot be declared either.

**Workaround:** copy `native/*.cpp|h` into the stage, append them to the CMake
source list, add an include directory, and patch `CMakeLists.txt` and the spec's
`BuildRequires`.

### A3. No on-screen keyboard (Maliit) integration

Focusing an `<input>` does not raise the Sailfish keyboard, and nothing receives
its text. `GEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD` draws GeaStack's own keyboard
instead, which is not what a Sailfish user expects.

**Workaround:** a small Maliit client (`maliit-glib`): show/hide on input focus,
handle `commit-string` and `key-event`, pump the GLib main context each frame.
With it, the compositor also resizes the window when the keyboard opens
(1080×2260 → 1080×1408), which the existing resize path handles correctly.

### A4. Text input drops everything outside printable ASCII

`appendTextToActiveInput` in `sailfish_main.cpp` keeps only bytes 32–126, with
the comment that the raster fonts cover ASCII. Typing `ğ`, `ş`, `ö` etc. on a
hardware keyboard produces nothing. `applyBackspaceToActiveInput` removes one
byte, which splits a multi-byte UTF-8 character.

**Expected:** append the UTF-8 text as given; delete whole code points.

### A5. Escape quits the application

`pumpSdlEvents` sets `g_stop = 1` on `SDLK_ESCAPE`. On a phone with a Bluetooth
keyboard this closes the app, and the app cannot receive Escape at all. Keys
that are neither text nor in `webKeyCodeForSdl` (Ctrl+letter, Insert, F-keys)
are dropped, and modifier state is not passed on.

**Expected:** deliver Escape and modifiers to the app; make "Escape quits" a
desktop-only or opt-in behavior.

### A6. No screen rotation

The target has no orientation handling: the window is always portrait and the
SDL hint `SDL_HINT_QTWAYLAND_CONTENT_ORIENTATION` is never set.

**Workaround:** keep the window portrait, lay the canvas out with swapped
dimensions, present it with `SDL_RenderCopyEx` at 90°/270°, map normalized
finger coordinates back into the rotated canvas, and set the orientation hint so
the keyboard and edge gestures follow. Rotation is triggered by the app; reading
the orientation sensor (sensorfw) is not implemented.

### A7. `SDL_WINDOW_ALLOW_HIGHDPI` together with the configured DPR

The window is created with `SDL_WINDOW_ALLOW_HIGHDPI` while the canvas already
applies `devicePixelRatio`. We removed the flag because the canvas "already
uses the configured DPR". We did not isolate what breaks with the flag left in,
so treat this one as a question rather than a confirmed bug.

### A8. Generated `.desktop` file cannot opt out of Sailjail

`gea.sailfish` has `permissions`, but no way to emit `Sandboxing=Disabled` in
`[X-Sailjail]`. Under the default profile the app runs with
`--private-bin=<package>`, so it cannot execute any other program. This is
specific to apps like terminals, but it needs a config switch rather than a
patch to the template string.

---

## B. Runtime font rasterizer (`geastack/core`, `engine/rasterized_font.cpp`)

### B1. Fixed, small glyph set

With `--runtime-ttf-fonts`, the rasterizer only knows a hard-coded list of code
points: ASCII plus about sixteen symbols (FreeType path), or ASCII and `°` (stb
path). Anything else renders as `?`, whatever the embedded TTF contains. That
excludes Latin-1, Turkish (`ĞğİıŞş`), `↑ ↓`, box drawing (U+2500–257F) and block
elements (U+2580–259F).

The two rasterizer paths also have different lists, so the desktop build
(FreeType) and the Sailfish build (stb_truetype) show different glyphs.

**Expected:** rasterize glyphs on demand from the font's cmap, or let the app
declare the ranges it needs.

### B2. Without `@font-face`, text silently falls back to an ASCII bitmap font

`font-family: monospace` (or any family that is not embedded) renders in a
built-in bitmap font with no warning. Worth a build-time diagnostic.

---

## C. Layout and CSS (`geastack/core`, engine)

Observed on both the Sailfish build and `gea build --target raspberry-pi-os`.
We worked around each of these and did not reduce them to minimal test cases.

### C1. `flex: 1` child collapsed to zero height

```css
.app      { display: flex; flex-direction: column; width: 100vw; height: 100vh; }
.header   { height: 44px; flex-shrink: 0; }
.viewport { flex: 1; overflow-y: auto; }   /* ← height 0 */
.toolbar  { flex-shrink: 0; }
```

The toolbar was drawn directly under the header and the viewport's content was
invisible. `flex: 1 1 0; min-height: 0` did not help. Positioning the viewport
absolutely (`top`/`bottom`) did.

### C2. Inline `<span>` siblings are laid out as blocks

Several `<span>`s inside a `<div>` with `white-space: pre` each start a new
line. Making the parent `display: flex; flex-direction: row` fixes it.

### C3. The `ch` unit does not resolve to the glyph advance

`left: calc(N * 1ch)` placed an element at about 3 px per `ch` with a 13 px
monospace font whose advance is about 8 px.

### C4. `text-decoration: underline` is drawn through the middle of the text

It looks like a strike-through.

### C5. `window.innerWidth` / `innerHeight` return canvas pixels

They return `Document::preferredMountWidth()`, which is the canvas size. With
`devicePixelRatio: 2` that is twice the CSS size, and there is no
`window.devicePixelRatio` to convert with.

---

## D. Compiler (`geastack/compiler`, geatsc)

### D1. A declared global native function compiles to a ReferenceError

```ts
declare function fitermHostInvoke(method: string, payload: string): string
```

Calls are emitted as
`gea::host::detail::throwReferenceError<gea::CallableObject<...>>()`, and
`typeof fitermHostInvoke === 'function'` is folded to `false`. There seems to be
no supported way to bind such a declaration to a C++ symbol from the app.

**Workaround:** rewrite the generated `index.cpp` after compilation.

### D2. `document.querySelectorAll(...).length` generates C++ that does not compile

```
error: no match for 'operator=' (operand types are
'gea::Ref<gea_record_type_N>' and 'std::vector<gea::embedded::ui::NodeHandle>')
```

### D3. `window.addEventListener('resize', ...)` is refused

```
native-boundary:UIEvent@1: the target manifest registers no native-boundary "UIEvent@1"
```

The type is in `index.d.ts` (`GeaWindowEventMap.resize`), so this passes `tsc`
and fails only in geatsc. We poll `innerWidth` instead.

### D4. An event-handler arrow function that returns a value is refused

```tsx
<Toolbar onRotate={() => NativeBridge.invoke('display.rotate', {})} />
// prop type: () => void
```

```
cpp emission refuses to lower "conversion:function-value-dispatch(()->record…)
->function-value-dispatch(()->void…)"
```

Wrapping the call in a method that returns nothing works.

---

## E. Smaller notes

- `Style` has no `lineHeight`, so a dynamic line height cannot be set inline.
- `gea build --target raspberry-pi-os` fails with a clear message when
  `libsdl2-dev` or `libfreetype-dev` is missing, but only one at a time.
- That desktop target does not apply an app's native bindings, so apps with
  `nativeSources` always run their mock path there.
