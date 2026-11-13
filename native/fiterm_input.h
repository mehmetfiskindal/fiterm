#pragma once

#include <cstddef>

// Terminal input routed straight to the PTY, bypassing the UI's focused-<input>
// path (which drops keys whenever nothing has focus and quits on Escape).

// DECCKM, set by the terminal emulator: arrow keys are sent as ESC O x.
extern bool gFitermAppCursorKeys;

// Raw bytes to the running shell. No-op when no shell is running.
void fiterm_pty_write_raw(const char *data, std::size_t len);

// UTF-8 text from SDL_TEXTINPUT or a Maliit commit; "\n" is sent as "\r".
bool fiterm_pty_text(const char *utf8);

// Backspace from the Maliit keyboard.
bool fiterm_pty_backspace();

// SDL_KEYDOWN for non-text keys (Enter, Esc, arrows, Ctrl+letter, ...).
// Returns true when the key was consumed and sent to the shell.
bool fiterm_pty_key(int sdlKeycode, int sdlKeymod);

// FITERM_TRACE=1 diagnostics; takes a const SDL_Event*.
void fiterm_trace_sdl_event(const void *sdlEvent);

// System clipboard (SDL). Paste writes the clipboard text to the shell.
bool fiterm_clipboard_set(const char *utf8);
bool fiterm_clipboard_paste();
