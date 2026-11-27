import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const stage = path.resolve(process.argv[2] || '.gea-sailfish/build/fiterm-aarch64/project')

function patch(relPath, replacements) {
  const file = path.join(stage, relPath)
  if (!existsSync(file)) throw new Error(`Missing staged Sailfish file: ${file}`)
  const original = readFileSync(file, 'utf8')
  let source = original
  for (const [before, after, alreadyPatchedMarker, optional] of replacements) {
    if (source.includes(after)) continue
    if (alreadyPatchedMarker && source.includes(alreadyPatchedMarker)) continue
    if (optional && !source.includes(before)) continue
    if (!source.includes(before)) {
      throw new Error(`Unsupported staged Sailfish source in ${relPath}: ${before.slice(0, 80)}`)
    }
    source = source.replace(before, after)
  }
  if (source !== original) writeFileSync(file, source)
}

// 1. Enable FiTerm-specific Sailfish hooks in CMakeLists.txt
patch('CMakeLists.txt', [
  [
    `  GEA_EMBEDDED_TTF_RUNTIME_FONTS=1`,
    `  GEA_EMBEDDED_TTF_RUNTIME_FONTS=1
  FITERM_SAILFISH=1`,
    `FITERM_SAILFISH=1`,
  ],
])

// 2. Bind declared global fitermHostInvoke in generated/index.cpp
{
  const generatedEntry = path.join(stage, 'generated/index.cpp')
  if (!existsSync(generatedEntry)) throw new Error(`Missing generated entry: ${generatedEntry}`)
  let nativeEntry = readFileSync(generatedEntry, 'utf8')
  const original = nativeEntry
  const unresolvedHost =
    'gea::host::detail::throwReferenceError<gea::CallableObject<std::string(std::string, std::string)>>()'
  nativeEntry = nativeEntry.replaceAll(unresolvedHost, 'fitermHostInvoke')
  const availability =
    /bool (gea_body_fn_decl_[A-Za-z0-9_]+)\(\) \{\s*gea::Value::Tag v0;\s*v0 = gea::Value::Tag::Undefined;\s*return \(v0 == gea::Value::Tag::Function\);\s*\}/g
  nativeEntry = nativeEntry.replace(availability, 'bool $1() { return true; }')
  if (!nativeEntry.includes('#include "fiterm_host.h"')) {
    if (nativeEntry.includes('#include "gea/audio-worklet-runtime.h"')) {
      nativeEntry = nativeEntry.replace(
        '#include "gea/audio-worklet-runtime.h"',
        '#include "gea/audio-worklet-runtime.h"\n#include "fiterm_host.h"',
      )
    } else {
      nativeEntry = `#include "fiterm_host.h"\n${nativeEntry}`
    }
  }
  if (nativeEntry !== original) writeFileSync(generatedEntry, nativeEntry)
}

// 3. Terminal glyph coverage (Latin-1, Turkish, arrows/symbols, box drawing & blocks)
const extraCodepoints = [
  ...Array.from({ length: 0x60 }, (_, i) => 0x00a0 + i),
  0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f,
  0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026,
  0x2190, 0x2191, 0x2192, 0x2193, 0x2212,
  0x2315, 0x2318, 0x25cf, 0x2605, 0x2699, 0x26a1, 0x2713, 0x2715,
  ...Array.from({ length: 0xa0 }, (_, i) => 0x2500 + i),
]
const extraList = [...new Set(extraCodepoints)]
  .sort((a, b) => a - b)
  .map((c) => '0x' + c.toString(16))
  .join(',')

patch('framework/engine/rasterized_font.cpp', [
  [
    `constexpr int kRuntimeExtraCodepoints[] = {0x00b0, 0x2022};`,
    `constexpr int kRuntimeExtraCodepoints[] = {${extraList}};`,
    `0x2500,0x2501`,
  ],
  [
    `constexpr int kRuntimeExtraCodepoints[] = {0x00b0,0x00b5,0x00d7,0x2013,0x2014,0x2018,0x2019,0x201c,0x201d,0x2022,0x2026,0x2190,0x2191,0x2192,0x2193,0x2212};`,
    `constexpr int kRuntimeExtraCodepoints[] = {${extraList}};`,
    `0x2500,0x2501`,
    true,
  ],
])

// 4. Add KBD button forced-toggle support to the vendored GDBus Maliit keyboard
patch('platform/include/sailfish_keyboard.h', [
  [
    `void sailfish_keyboard_shutdown();`,
    `void sailfish_keyboard_shutdown();
// Keep the keyboard up (or down) regardless of input focus; the KBD button.
void sailfish_keyboard_toggle_forced();`,
    `sailfish_keyboard_toggle_forced`,
  ],
])

patch('platform/main/sailfish_keyboard.cpp', [
  [
    `int g_focused_input = -1;`,
    `int g_focused_input = -1;
int g_forced_state = -1;  // -1 follow input focus, 0 forced hidden, 1 forced shown`,
    `g_forced_state`,
  ],
  [
    `\t} else if (std::strcmp(method_name, "imInitiatedHide") == 0 ||
\t           std::strcmp(method_name, "activationLostEvent") == 0) {
\t\tg_visible = false;
\t}`,
    `\t} else if (std::strcmp(method_name, "imInitiatedHide") == 0 ||
\t           std::strcmp(method_name, "activationLostEvent") == 0) {
\t\tg_visible = false;
\t\tif (g_forced_state == 1) g_forced_state = -1;
\t}`,
    `if (g_forced_state == 1)`,
  ],
  [
    `\tg_variant_builder_add(&builder, "{sv}", "correctionEnabled", g_variant_new_boolean(FALSE));`,
    `\tg_variant_builder_add(&builder, "{sv}", "correctionEnabled", g_variant_new_boolean(FALSE));
\tg_variant_builder_add(&builder, "{sv}", "autocapitalizationEnabled", g_variant_new_boolean(FALSE));`,
    `autocapitalizationEnabled`,
  ],
  [
    `\tconst bool show = activeInputId >= 0;`,
    `\tconst bool show = g_forced_state >= 0 ? g_forced_state == 1 : activeInputId >= 0;`,
    `g_forced_state >= 0`,
  ],
  [
    `void sailfish_keyboard_shutdown()`,
    `void sailfish_keyboard_toggle_forced()
{
\tg_forced_state = g_visible ? 0 : 1;
\tstd::fprintf(stderr, "[sailfish keyboard] forced %s\\n", g_forced_state == 1 ? "on" : "off");
}

void sailfish_keyboard_shutdown()`,
    `void sailfish_keyboard_toggle_forced()`,
  ],
])

// 5. Screen rotation (ROT button) in sailfish_display.cpp
patch('platform/main/sailfish_display.cpp', [
  [
    `void present_texture()
{
\tif (!g_sdl_ok) return;
\tSDL_RenderClear(g_renderer);
\tSDL_RenderCopy(g_renderer, g_texture, nullptr, nullptr);`,
    `int g_rotation = 0;  // 0 portrait, 1 landscape (90 deg clockwise), 3 inverted landscape

void present_texture()
{
\tif (!g_sdl_ok) return;
\tSDL_RenderClear(g_renderer);
\tif (g_rotation != 0) {
\t\tSDL_Rect dst{(g_canvas_height - g_canvas_width) / 2, (g_canvas_width - g_canvas_height) / 2,
\t\t             g_canvas_width, g_canvas_height};
\t\tSDL_RenderCopyEx(g_renderer, g_texture, nullptr, &dst, g_rotation == 1 ? 90.0 : 270.0, nullptr, SDL_FLIP_NONE);
\t} else {
\t\tSDL_RenderCopy(g_renderer, g_texture, nullptr, nullptr);
\t}`,
    `int g_rotation = 0;`,
  ],
  [
    `\tif (g_sdl_ok) {
\t\tSDL_RenderSetLogicalSize(g_renderer, g_canvas_width, g_canvas_height);`,
    `\tif (g_sdl_ok) {
\t\tSDL_RenderSetLogicalSize(g_renderer, g_rotation ? g_canvas_height : g_canvas_width,
\t\t                         g_rotation ? g_canvas_width : g_canvas_height);`,
    `g_rotation ? g_canvas_height : g_canvas_width`,
  ],
  [
    `// Rebuild the framebuffer + streaming texture at a new logical size (window`,
    `extern "C" int sailfish_display_rotation() { return g_rotation; }

// sailfish_main notices the change and re-lays-out the canvas for the new shape.
extern "C" void sailfish_display_set_rotation(int rotation)
{
\tg_rotation = rotation;
\t// Tells the compositor which way is up, so the keyboard and edge gestures follow.
\tSDL_SetHint(SDL_HINT_QTWAYLAND_CONTENT_ORIENTATION,
\t            rotation == 1 ? "landscape" : rotation == 3 ? "inverted-landscape" : "portrait");
\tif (g_sdl_ok) present_texture();
}

// Rebuild the framebuffer + streaming texture at a new logical size (window`,
    `sailfish_display_set_rotation(int rotation)`,
  ],
])

// 6. Direct PTY input routing + rotation touch/resize mapping in sailfish_main.cpp
patch('platform/main/sailfish_main.cpp', [
  [
    `#include "sailfish_touch.h"`,
    `#include "sailfish_touch.h"
#include "fiterm_input.h"`,
    `#include "fiterm_input.h"`,
  ],
  [
    `extern "C" int sailfish_display_window_scale();`,
    `extern "C" int sailfish_display_window_scale();
extern "C" int sailfish_display_rotation();`,
    `sailfish_display_rotation()`,
  ],
  [
    `\t// SDL_RenderSetLogicalSize's event watch already normalizes finger events
\t// to the logical viewport, including letterbox offsets. Scale only once.
\tgea::sailfish::touch::routeFinger(`,
    `\t// Fingers arrive normalized to the portrait window; map into the rotated canvas.
\tconst int rotation = sailfish_display_rotation();
\tif (rotation == 1) { const float t = nx; nx = ny; ny = 1.0f - t; }
\telse if (rotation == 3) { const float t = nx; nx = 1.0f - ny; ny = t; }
\t// SDL_RenderSetLogicalSize's event watch already normalizes finger events
\t// to the logical viewport, including letterbox offsets. Scale only once.
\tgea::sailfish::touch::routeFinger(`,
    `const int rotation = sailfish_display_rotation();`,
  ],
  [
    `\twhile (SDL_PollEvent(&event)) {`,
    `\twhile (SDL_PollEvent(&event)) {
\t\tfiterm_trace_sdl_event(&event);`,
    `fiterm_trace_sdl_event`,
  ],
  [
    `\t\tcase SDL_KEYDOWN:
\t\tcase SDL_KEYUP:
\t\tcase SDL_TEXTINPUT:
\t\tcase SDL_TEXTEDITING:
\t\tcase SDL_TEXTEDITING_EXT:
\t\t\tg_keyboard.accept(event);
\t\t\tif (event.type == SDL_TEXTEDITING_EXT) SDL_free(event.editExt.text);
\t\t\tbreak;`,
    `\t\tcase SDL_KEYDOWN:
\t\t\tif (fiterm_pty_key(event.key.keysym.sym, event.key.keysym.mod)) break;
\t\t\tg_keyboard.accept(event);
\t\t\tbreak;
\t\tcase SDL_TEXTINPUT:
\t\t\tfiterm_pty_text(event.text.text);
\t\t\tbreak;
\t\tcase SDL_KEYUP:
\t\tcase SDL_TEXTEDITING:
\t\tcase SDL_TEXTEDITING_EXT:
\t\t\tg_keyboard.accept(event);
\t\t\tif (event.type == SDL_TEXTEDITING_EXT) SDL_free(event.editExt.text);
\t\t\tbreak;`,
    `fiterm_pty_key(event.key.keysym.sym`,
  ],
  [
    `\t\tif (g_resize_pending) {
\t\t\tg_resize_pending = false;
\t\t\t// The window event reports points; the canvas follows the
\t\t\t// drawable's physical pixels (see sailfish_display.cpp).
\t\t\tconst int scale = sailfish_display_window_scale();
\t\t\tint outputW = g_resize_window_w, outputH = g_resize_window_h;
\t\t\tsailfish_display_output_size(&outputW, &outputH);
\t\t\tconst int newW = outputW / (scale > 0 ? scale : 1);
\t\t\tconst int newH = outputH / (scale > 0 ? scale : 1);`,
    `\t\t{
\t\t\t// ROT button: lay the canvas out again for the new orientation.
\t\t\tstatic int appliedRotation = 0;
\t\t\tif (sailfish_display_rotation() != appliedRotation) {
\t\t\t\tappliedRotation = sailfish_display_rotation();
\t\t\t\tsailfish_display_output_size(&g_resize_window_w, &g_resize_window_h);
\t\t\t\tg_resize_pending = true;
\t\t\t}
\t\t}
\t\tif (g_resize_pending) {
\t\t\tg_resize_pending = false;
\t\t\t// The window event reports points; the canvas follows the
\t\t\t// drawable's physical pixels (see sailfish_display.cpp).
\t\t\tconst int scale = sailfish_display_window_scale();
\t\t\tint outputW = g_resize_window_w, outputH = g_resize_window_h;
\t\t\tsailfish_display_output_size(&outputW, &outputH);
\t\t\tint newW = outputW / (scale > 0 ? scale : 1);
\t\t\tint newH = outputH / (scale > 0 ? scale : 1);
\t\t\tif (sailfish_display_rotation() != 0) { const int t = newW; newW = newH; newH = t; }`,
    `static int appliedRotation = 0;`,
  ],
])

console.log(`FiTerm Sailfish stage patches applied to: ${stage}`)
