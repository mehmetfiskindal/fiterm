#include "fiterm_input.h"

#include <SDL.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

bool fiterm_pty_text(const char *utf8) {
  if (!utf8 || !*utf8) return true;
  std::string s(utf8);
  for (char &c : s) {
    if (c == '\n') c = '\r';
  }
  fiterm_pty_write_raw(s.data(), s.size());
  return true;
}

bool fiterm_pty_backspace() {
  fiterm_pty_write_raw("\x7f", 1);
  return true;
}

namespace {
bool send(const char *seq) {
  fiterm_pty_write_raw(seq, std::strlen(seq));
  return true;
}
}  // namespace

bool fiterm_pty_key(int sym, int mod) {
  const bool ctrl = (mod & KMOD_CTRL) != 0;

  if (ctrl) {
    if (sym >= SDLK_a && sym <= SDLK_z) {
      const char c = static_cast<char>(sym - SDLK_a + 1);
      fiterm_pty_write_raw(&c, 1);
      return true;
    }
    switch (sym) {
      case SDLK_SPACE:
      case SDLK_2: { const char c = 0; fiterm_pty_write_raw(&c, 1); return true; }
      case SDLK_LEFTBRACKET: return send("\x1b");
      case SDLK_BACKSLASH: return send("\x1c");
      case SDLK_RIGHTBRACKET: return send("\x1d");
      default: break;
    }
  }

  switch (sym) {
    case SDLK_RETURN:
    case SDLK_KP_ENTER: return send("\r");
    case SDLK_BACKSPACE: return send("\x7f");
    case SDLK_TAB: return send((mod & KMOD_SHIFT) ? "\x1b[Z" : "\t");
    case SDLK_ESCAPE: return send("\x1b");
    case SDLK_UP: return send(gFitermAppCursorKeys ? "\x1bOA" : "\x1b[A");
    case SDLK_DOWN: return send(gFitermAppCursorKeys ? "\x1bOB" : "\x1b[B");
    case SDLK_RIGHT: return send(gFitermAppCursorKeys ? "\x1bOC" : "\x1b[C");
    case SDLK_LEFT: return send(gFitermAppCursorKeys ? "\x1bOD" : "\x1b[D");
    case SDLK_HOME: return send(gFitermAppCursorKeys ? "\x1bOH" : "\x1b[H");
    case SDLK_END: return send(gFitermAppCursorKeys ? "\x1bOF" : "\x1b[F");
    case SDLK_PAGEUP: return send("\x1b[5~");
    case SDLK_PAGEDOWN: return send("\x1b[6~");
    case SDLK_INSERT: return send("\x1b[2~");
    case SDLK_DELETE: return send("\x1b[3~");
    default: return false;
  }
}

// Input diagnostics, enabled with FITERM_TRACE=1: logs every SDL input event.
void fiterm_trace_sdl_event(const void *ev) {
  static const bool on = [] {
    const char *v = std::getenv("FITERM_TRACE");
    return v && *v && *v != '0';
  }();
  if (!on || !ev) return;
  const SDL_Event &e = *static_cast<const SDL_Event *>(ev);
  switch (e.type) {
    case SDL_KEYDOWN:
      std::fprintf(stderr, "[fiterm.trace] keydown sym=0x%x mod=0x%x\n", e.key.keysym.sym, e.key.keysym.mod);
      break;
    case SDL_TEXTINPUT:
      std::fprintf(stderr, "[fiterm.trace] textinput '%s'\n", e.text.text);
      break;
    case SDL_FINGERDOWN:
      std::fprintf(stderr, "[fiterm.trace] fingerdown %.3f,%.3f\n", e.tfinger.x, e.tfinger.y);
      break;
    case SDL_MOUSEBUTTONDOWN:
      std::fprintf(stderr, "[fiterm.trace] mousedown %d,%d\n", e.button.x, e.button.y);
      break;
    case SDL_WINDOWEVENT:
      std::fprintf(stderr, "[fiterm.trace] window event %d\n", e.window.event);
      break;
    default:
      break;
  }
}

bool fiterm_clipboard_set(const char *utf8) {
  return utf8 && SDL_SetClipboardText(utf8) == 0;
}

bool fiterm_clipboard_paste() {
  char *text = SDL_GetClipboardText();
  if (!text) return false;
  std::string s(text);
  SDL_free(text);
  // A pasted newline must not run a command half-way; shells expect CR.
  for (char &c : s) {
    if (c == '\n') c = '\r';
  }
  fiterm_pty_write_raw(s.data(), s.size());
  return !s.empty();
}
