import { existsSync, readFileSync, writeFileSync } from 'node:fs'

function patch(file, replacements) {
  if (!existsSync(file)) throw new Error(`Missing GeaStack Sailfish target: ${file}`)
  const original = readFileSync(file, 'utf8')
  let source = original
  for (const [before, after, alreadyPatchedMarker, optional] of replacements) {
    if (source.includes(after)) continue
    if (alreadyPatchedMarker && source.includes(alreadyPatchedMarker)) continue
    if (optional && !source.includes(before)) continue
    if (!source.includes(before)) throw new Error(`Unsupported GeaStack Sailfish source in ${file}: ${before.slice(0, 80)}`)
    source = source.replace(before, after)
  }
  if (source !== original) writeFileSync(file, source)
}

const root = 'node_modules/@geastack/linux/targets/sailfish-os'
patch(`${root}/prepare.mjs`, [
  [
    `const coreRepo = path.resolve(coreArg || path.join(linuxRoot, '../core'))
const corePackage = path.join(coreRepo, 'packages/core')
const npmCore = path.join(linuxRoot, 'node_modules/@geastack/core')
const coreMetadata = path.join(corePackage, 'package.json')
if (!fs.existsSync(coreMetadata)) throw new Error(\`missing core package: \${coreMetadata}\`)
const checkoutVersion = JSON.parse(fs.readFileSync(coreMetadata, 'utf8')).version
const installedVersion = JSON.parse(fs.readFileSync(path.join(npmCore, 'package.json'), 'utf8')).version
if (!checkoutVersion || checkoutVersion !== installedVersion) {
  throw new Error(\`core version mismatch: npm @geastack/core \${installedVersion}, checkout \${checkoutVersion}. Use a core checkout matching the installed npm package, or install the matching npm version.\`)
}`,
    `const coreRepo = coreArg ? path.resolve(coreArg) : null
const npmCore = path.join(linuxRoot, 'node_modules/@geastack/core')
if (coreRepo) {
  const coreMetadata = path.join(coreRepo, 'packages/core/package.json')
  if (!fs.existsSync(coreMetadata)) throw new Error(\`missing core package: \${coreMetadata}\`)
  const checkoutVersion = JSON.parse(fs.readFileSync(coreMetadata, 'utf8')).version
  const installedVersion = JSON.parse(fs.readFileSync(path.join(npmCore, 'package.json'), 'utf8')).version
  if (checkoutVersion !== installedVersion) throw new Error(\`core version mismatch: \${installedVersion} / \${checkoutVersion}\`)
}`,
    `const coreRepo = coreArg ? path.resolve(coreArg) : null`,
  ],
  [
    `const npmCore = path.join(linuxRoot, 'node_modules/@geastack/core')`,
    `const npmCore = path.join(appDir, 'node_modules/@geastack/core')`,
  ],
  [
    `const source = path.join(coreRepo, 'packages', name)`,
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) : path.join(linuxRoot, 'node_modules/@geastack', name)`,
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) :`,
  ],
  [
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) : path.join(linuxRoot, 'node_modules/@geastack', name)`,
    `const source = coreRepo ? path.join(coreRepo, 'packages', name) : path.join(appDir, 'node_modules/@geastack', name)`,
  ],
  [
    `path.join(linuxRoot, 'node_modules/@geastack/compiler/dist/cli.js')`,
    `path.join(appDir, 'node_modules/@geastack/compiler/dist/cli.js')`,
  ],
  [
    `path.join(linuxRoot, 'node_modules/@geastack/geatsc-plugin-gea/dist/index.js')`,
    `path.join(appDir, 'node_modules/@geastack/geatsc-plugin-gea/dist/index.js')`,
  ],
  [
    `const generated = path.join(here, 'generated', app.id)`,
    `const generated = path.join(appDir, '.gea-sailfish', 'generated', app.id)`,
  ],
  [
    `const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: linuxRoot })
if (result.status !== 0) process.exit(result.status || 1)`,
    `const result = spawnSync(process.execPath, args, {
  stdio: 'inherit', cwd: linuxRoot,
  env: { ...process.env, GEA_RPIOS_FONT_LATIN_EXTENDED: '1' },
})
if (result.status !== 0) process.exit(result.status || 1)

// geatsc currently treats declared app-native globals as unresolved. Bind the
// generated host calls to the C++ object supplied by app_native instead.
const generatedEntry = path.join(generated, 'index.cpp')
let nativeEntry = fs.readFileSync(generatedEntry, 'utf8')
const unresolvedHost = 'gea::host::detail::throwReferenceError<gea::CallableObject<std::string(std::string, std::string)>>()'
nativeEntry = nativeEntry.replaceAll(unresolvedHost, 'fitermHostInvoke')
const availability = /bool (gea_body_fn_decl_[A-Za-z0-9_]+)\\(\\) \\{\\s*gea::Value::Tag v0;\\s*v0 = gea::Value::Tag::Undefined;\\s*return \\(v0 == gea::Value::Tag::Function\\);\\s*\\}/g
nativeEntry = nativeEntry.replace(availability, 'bool $1() { return true; }')
nativeEntry = nativeEntry.replace('#include "gea/audio-worklet-runtime.h"', '#include "gea/audio-worklet-runtime.h"\\n#include "fiterm_host.h"')
fs.writeFileSync(generatedEntry, nativeEntry)`,
  ],
  [
    `const stage = path.join(here, 'build', \`\${app.id}-\${arch}\`, 'project')`,
    `const stage = path.join(appDir, '.gea-sailfish', 'build', \`\${app.id}-\${arch}\`, 'project')`,
  ],
  [
    `const allowedParent = path.resolve(here, 'build') + path.sep`,
    `const allowedParent = path.resolve(appDir, '.gea-sailfish', 'build') + path.sep`,
  ],
  [
    `copyTree(path.join(here, 'include'), path.join(stage, 'platform/include'))`,
    `copyTree(path.join(here, 'include'), path.join(stage, 'platform/include'))
fs.mkdirSync(path.join(stage, 'app_native', 'nlohmann'), { recursive: true })
for (const name of fs.readdirSync(path.join(appDir, 'native')).filter((n) => /\\.(cpp|h)$/.test(n))) {
  const p = path.join(appDir, 'native', name)
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(stage, 'app_native', name))
}
const jsonP = path.join(appDir, 'native/vendor/nlohmann/json.hpp')
if (fs.existsSync(jsonP)) fs.copyFileSync(jsonP, path.join(stage, 'app_native/nlohmann/json.hpp'))`,
    `path.join(stage, 'app_native', 'nlohmann')`,
  ],
  // Older patched copies listed the native files by name; copy every .cpp/.h instead.
  [`for (const name of ['fiterm_host_linux.cpp', 'fiterm_host.h', 'sailfish_keyboard.cpp', 'sailfish_keyboard.h']) {`, `for (const name of fs.readdirSync(path.join(appDir, 'native')).filter((n) => /\\.(cpp|h)$/.test(n))) {`, null, true],
  [`for (const name of ['fiterm_host_linux.cpp', 'fiterm_host.h', 'fiterm_input.h', 'fiterm_input_sailfish.cpp', 'sailfish_keyboard.cpp', 'sailfish_keyboard.h']) {`, `for (const name of fs.readdirSync(path.join(appDir, 'native')).filter((n) => /\\.(cpp|h)$/.test(n))) {`, null, true],
  [
    `const { includeFlags, cSources, cxxSources } = await import(pathToFileURL(path.join(coreRepo, 'packages/core/gea_sources.mjs')))`,
    `const { includeFlags, cSources, cxxSources } = await import(pathToFileURL(coreRepo ? path.join(coreRepo, 'packages/core/gea_sources.mjs') : path.join(npmCore, 'gea_sources.mjs')))`,
  ],
  [
    `cxx.push('framework/core/gea_app_entry.cpp')`,
    `cxx.push('framework/core/gea_app_entry.cpp')
cxx.push('app_native/fiterm_host_linux.cpp')
cxx.push('app_native/sailfish_keyboard.cpp')`,
  ],
  [
    `cxx.push('app_native/sailfish_keyboard.cpp')`,
    `cxx.push('app_native/sailfish_keyboard.cpp')
cxx.push('app_native/fiterm_input_sailfish.cpp')`,
  ],
  [
    `const includes = ['platform/include', 'generated', ...includeFlags(env).map((s) => rel(s.slice(2)))]`,
    `const includes = ['platform/include', 'generated', 'app_native', ...includeFlags(env).map((s) => rel(s.slice(2)))]`,
  ],
  [
    // A terminal must run real shells with PTYs and see the whole filesystem,
    // which Sailjail's sandbox forbids. Opt out like the stock fingerterm does.
    `\\n\\n[X-Sailjail]\\nOrganizationName=`,
    `\\n\\n[X-Sailjail]\\nSandboxing=Disabled\\nOrganizationName=`,
  ],
  [
    `BuildRequires: pkgconfig(libcurl)\\n`,
    `BuildRequires: pkgconfig(libcurl)\\nBuildRequires: pkgconfig(maliit-glib)\\n`,
  ],
])

patch(`${root}/CMakeLists.txt`, [
  [`find_package(PkgConfig REQUIRED)`, `find_package(PkgConfig REQUIRED)`],
  [`pkg_check_modules(CURL REQUIRED IMPORTED_TARGET libcurl)`, `pkg_check_modules(CURL REQUIRED IMPORTED_TARGET libcurl)
pkg_check_modules(MALIIT REQUIRED IMPORTED_TARGET maliit-glib)`],
  [`  GEA_EMBEDDED_TTF_RUNTIME_FONTS=1`, `  GEA_EMBEDDED_TTF_RUNTIME_FONTS=1
  GEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD=0
  FITERM_SAILFISH=1`, `FITERM_SAILFISH=1`],
  [`PkgConfig::SDL2 PkgConfig::CURL pthread m rt`, `PkgConfig::SDL2 PkgConfig::CURL PkgConfig::MALIIT util pthread m rt`, `PkgConfig::MALIIT`],
])

patch('node_modules/@geastack/engine/rasterized_font.cpp', [
  [
    `constexpr int kRuntimeExtraGlyphs = 1;`,
    `constexpr int kRuntimeLatin1First = 0x00a0;
constexpr int kRuntimeLatin1Count = 0x60;
constexpr int kRuntimeTurkish[] = {0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f};
constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6;`,
    `kRuntimeSymbols`,
  ],
  [
    `constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6;`,
    `constexpr int kRuntimeSymbols[] = {0x2013, 0x2014, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026,
    0x2190, 0x2191, 0x2192, 0x2193, 0x2315, 0x2318, 0x25cf, 0x2605, 0x2699, 0x26a1, 0x2713, 0x2715};
constexpr int kRuntimeSymbolCount = sizeof(kRuntimeSymbols) / sizeof(kRuntimeSymbols[0]);
constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6 + kRuntimeSymbolCount;`,
    `constexpr int kRuntimeSymbols[]`,
  ],
  [
    `if (index == kRuntimeAsciiCount) return 0x00b0;`,
    `const int extra = index - kRuntimeAsciiCount;
if (extra >= 0 && extra < kRuntimeLatin1Count) return kRuntimeLatin1First + extra;
if (extra >= kRuntimeLatin1Count && extra < kRuntimeExtraGlyphs) return kRuntimeTurkish[extra - kRuntimeLatin1Count];`,
    `kRuntimeSymbols[extra`,
  ],
  [
    `if (extra >= kRuntimeLatin1Count && extra < kRuntimeExtraGlyphs) return kRuntimeTurkish[extra - kRuntimeLatin1Count];`,
    `if (extra >= kRuntimeLatin1Count && extra < kRuntimeLatin1Count + 6) return kRuntimeTurkish[extra - kRuntimeLatin1Count];
if (extra >= kRuntimeLatin1Count + 6 && extra < kRuntimeExtraGlyphs) return kRuntimeSymbols[extra - kRuntimeLatin1Count - 6];`,
    `kRuntimeSymbols[extra`,
  ],
  // ↑ and ↓ for the toolbar arrow keys (← → were already there).
  [`0x2190, 0x2192,`, `0x2190, 0x2191, 0x2192, 0x2193,`],
  // Box drawing and block elements (U+2500–U+259F) for full-screen programs.
  [
    `constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6 + kRuntimeSymbolCount;`,
    `constexpr int kRuntimeBoxFirst = 0x2500;
constexpr int kRuntimeBoxCount = 0xa0;
constexpr int kRuntimeExtraGlyphs = kRuntimeLatin1Count + 6 + kRuntimeSymbolCount + kRuntimeBoxCount;`,
  ],
  [
    `if (extra >= kRuntimeLatin1Count + 6 && extra < kRuntimeExtraGlyphs) return kRuntimeSymbols[extra - kRuntimeLatin1Count - 6];`,
    `if (extra >= kRuntimeLatin1Count + 6 && extra < kRuntimeLatin1Count + 6 + kRuntimeSymbolCount) return kRuntimeSymbols[extra - kRuntimeLatin1Count - 6];
if (extra >= kRuntimeLatin1Count + 6 + kRuntimeSymbolCount && extra < kRuntimeExtraGlyphs) return kRuntimeBoxFirst + (extra - kRuntimeLatin1Count - 6 - kRuntimeSymbolCount);`,
  ],
  // Same coverage for the FreeType rasterizer used by the desktop test build.
  [
    `0x2190,0x2191,0x2192,0x2193,0x2212};`,
    `0x2190,0x2191,0x2192,0x2193,0x2212,${[
      ...Array.from({ length: 0x5f }, (_, i) => 0xa1 + i).filter((c) => c !== 0xb0 && c !== 0xb5 && c !== 0xd7),
      0x011e, 0x011f, 0x0130, 0x0131, 0x015e, 0x015f,
      ...Array.from({ length: 0xa0 }, (_, i) => 0x2500 + i),
    ].map((c) => '0x' + c.toString(16)).join(',')}};`,
    `0x2212,0xa1,`,
  ],
])

patch(`${root}/main/sailfish_display.cpp`, [
  [
    `int window_flags = SDL_WINDOW_SHOWN | SDL_WINDOW_ALLOW_HIGHDPI | SDL_WINDOW_RESIZABLE;`,
    `// The canvas already uses the configured DPR.
int window_flags = SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE;`,
  ],
  [
    `extern "C" int sailfish_display_window_scale() { return g_window_scale; }`,
    `extern "C" int sailfish_display_window_scale() { return g_window_scale; }

extern "C" void sailfish_display_read_size(int *window_w, int *window_h, int *output_w, int *output_h)
{
	const int scale = g_window_scale > 0 ? g_window_scale : 1;
	int ww = g_canvas_width * scale;
	int wh = g_canvas_height * scale;
	int ow = ww;
	int oh = wh;
	if (g_window) SDL_GetWindowSize(g_window, &ww, &wh);
	if (g_renderer) SDL_GetRendererOutputSize(g_renderer, &ow, &oh);
	if (ww < 1) ww = ow;
	if (wh < 1) wh = oh;
	if (ow < 1) ow = ww;
	if (oh < 1) oh = wh;
	if (window_w) *window_w = ww;
	if (window_h) *window_h = wh;
	if (output_w) *output_w = ow;
	if (output_h) *output_h = oh;
}`,
  ],
])

patch(`${root}/main/sailfish_main.cpp`, [
  [`#include "touch.h"`, `#include "touch.h"
#include "sailfish_keyboard.h"`],
  [`#include "sailfish_keyboard.h"`, `#include "sailfish_keyboard.h"
#include "fiterm_input.h"`],
  // Terminal keys go straight to the PTY: Escape must not quit the app, and
  // keys must not be dropped when the hidden <input> has no focus.
  [
    `if (sym == SDLK_ESCAPE) {
\t\t\t\tg_stop = 1;
\t\t\t\tbreak;
\t\t\t}`,
    `if (fiterm_pty_key(sym, event.key.keysym.mod)) break;`,
  ],
  [`while (SDL_PollEvent(&event)) {`, `while (SDL_PollEvent(&event)) {
\t\tfiterm_trace_sdl_event(&event);`],
  [
    `case SDL_TEXTINPUT:
\t\t\tappendTextToActiveInput(event.text.text);`,
    `case SDL_TEXTINPUT:
\t\t\tfiterm_pty_text(event.text.text);`,
  ],
  [
    `bool changed = false;
\tfor (const char *p = utf8; *p; p++) {
\t\t// ASCII printable only — the raster pipeline's fonts cover ASCII.
\t\tif (*p >= 32 && *p < 127) {
\t\t\tnext.push_back(*p);
\t\t\tchanged = true;
\t\t}
\t}
\tif (!changed) return true;`,
    `if (!utf8 || !*utf8) return true;
\tnext.append(utf8);`,
  ],
  [
    `if (!next.empty()) {
\t\tnext.pop_back();`,
    `if (!next.empty()) {
\t\twhile (!next.empty() && (static_cast<unsigned char>(next.back()) & 0xc0) == 0x80) next.pop_back();
\t\tif (!next.empty()) next.pop_back();`,
  ],
  [`SDL_StartTextInput();`, `SDL_StartTextInput();
\tsailfish_keyboard_init(&fiterm_pty_text, &fiterm_pty_backspace);`, `sailfish_keyboard_init(`],
  [
    `sailfish_keyboard_init(&appendTextToActiveInput, &applyBackspaceToActiveInput);`,
    `sailfish_keyboard_init(&fiterm_pty_text, &fiterm_pty_backspace);`,
  ],
  [`\t\tpumpSdlEvents();`, `\t\tpumpSdlEvents();
\t\tsailfish_keyboard_pump();`],
  [`\t\tdispatchPendingEvents();`, `\t\tdispatchPendingEvents();
\t\tsailfish_keyboard_update(tree.activeInputId());`, `const int focusedInput = tree.activeInputId();`],
])

// ---- Screen rotation (ROT button) -------------------------------------------
// The window stays portrait; in landscape the canvas is laid out sideways and
// drawn rotated, and finger coordinates are mapped back into it.
patch(`${root}/main/sailfish_display.cpp`, [
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
\t} else
\tSDL_RenderCopy(g_renderer, g_texture, nullptr, nullptr);`,
  ],
  [
    `\tif (g_sdl_ok) SDL_RenderSetLogicalSize(g_renderer, g_canvas_width, g_canvas_height);`,
    `\tif (g_sdl_ok) SDL_RenderSetLogicalSize(g_renderer, g_rotation ? g_canvas_height : g_canvas_width,
\t                                        g_rotation ? g_canvas_width : g_canvas_height);`,
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

patch(`${root}/main/sailfish_main.cpp`, [
  [
    `extern "C" int sailfish_display_window_scale();`,
    `extern "C" int sailfish_display_window_scale();
extern "C" int sailfish_display_rotation();
extern "C" void sailfish_display_read_size(int *window_w, int *window_h, int *output_w, int *output_h);`,
  ],
  [
    `\tint x = (int)(nx * (float)sailfish_canvas_width());
\tint y = (int)(ny * (float)sailfish_canvas_height());
\tconst int maxX = sailfish_canvas_width() - 1;
\tconst int maxY = sailfish_canvas_height() - 1;
\tif (x < 0) x = 0;
\tif (y < 0) y = 0;
\tif (x > maxX) x = maxX;
\tif (y > maxY) y = maxY;
\tgea::framework::events::TouchRuntime::queueTouchEvent(`,
    `\t// Fingers arrive normalized to the portrait window; map into the rotated canvas.
\tconst int rotation = sailfish_display_rotation();
\tif (rotation == 1) { const float t = nx; nx = ny; ny = 1.0f - t; }
\telse if (rotation == 3) { const float t = nx; nx = 1.0f - ny; ny = t; }
\tint x = (int)(nx * (float)sailfish_canvas_width());
\tint y = (int)(ny * (float)sailfish_canvas_height());
\tconst int maxX = sailfish_canvas_width() - 1;
\tconst int maxY = sailfish_canvas_height() - 1;
\tif (x < 0) x = 0;
\tif (y < 0) y = 0;
\tif (x > maxX) x = maxX;
\tif (y > maxY) y = maxY;
\tgea::framework::events::TouchRuntime::queueTouchEvent(`,
    `const int rotation = sailfish_display_rotation();`,
  ],
  [
    `\t\tif (g_resize_pending) {
\t\t\tg_resize_pending = false;
\t\t\tconst int scale = sailfish_display_window_scale();
\t\t\tconst int newW = g_resize_window_w / (scale > 0 ? scale : 1);
\t\t\tconst int newH = g_resize_window_h / (scale > 0 ? scale : 1);`,
    `\t\t{
\t\t\t// ROT button: lay the canvas out again for the new orientation.
\t\t\tstatic int appliedRotation = 0;
\t\t\tif (sailfish_display_rotation() != appliedRotation) {
\t\t\t\tappliedRotation = sailfish_display_rotation();
\t\t\t\tsailfish_display_read_size(&g_resize_window_w, &g_resize_window_h, nullptr, nullptr);
\t\t\t\tg_resize_pending = true;
\t\t\t}
\t\t}
\t\tif (g_resize_pending) {
\t\t\tg_resize_pending = false;
\t\t\tconst int scale = sailfish_display_window_scale();
\t\t\tint newW = g_resize_window_w / (scale > 0 ? scale : 1);
\t\t\tint newH = g_resize_window_h / (scale > 0 ? scale : 1);
\t\t\tif (sailfish_display_rotation() != 0) { const int t = newW; newW = newH; newH = t; }`,
    `static int appliedRotation = 0;`,
  ],
])

console.log('GeaStack Sailfish patches successfully applied for FiTerm.')
