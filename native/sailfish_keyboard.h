#pragma once

void sailfish_keyboard_init(bool (*appendText)(const char *), bool (*backspace)());
void sailfish_keyboard_pump();
void sailfish_keyboard_update(int activeInputId, const char *inputType = nullptr);
// Keep the keyboard up (or down) regardless of input focus; the KBD button.
void sailfish_keyboard_toggle_forced();
