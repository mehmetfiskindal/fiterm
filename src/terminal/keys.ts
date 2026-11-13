// Keycodes, escape sequences, and modifier helpers for terminal emulation

export const KeyCodes = {
  ENTER: '\r',
  BACKSPACE: '\x7f',
  TAB: '\t',
  ESC: '\x1b',
  ARROW_UP: '\x1b[A',
  ARROW_DOWN: '\x1b[B',
  ARROW_RIGHT: '\x1b[C',
  ARROW_LEFT: '\x1b[D',
  HOME: '\x1b[H',
  END: '\x1b[F',
  PAGE_UP: '\x1b[5~',
  PAGE_DOWN: '\x1b[6~',
  DELETE: '\x1b[3~',
  INSERT: '\x1b[2~',
}

export function toCtrlCode(char: string): string {
  if (!char || char.length === 0) return ''
  const upper = char.toUpperCase()
  const code = upper.charCodeAt(0)
  // '@' is 64 -> 0
  // 'A' is 65 -> 1
  // 'Z' is 90 -> 26
  if (code >= 64 && code <= 95) {
    return String.fromCharCode(code - 64)
  }
  if (char === '?') return '\x7f'
  return char
}

export function toAltCode(char: string): string {
  return '\x1b' + char
}
