// ANSI Escape sequence parser and text cell generator

export interface CellStyle {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

export interface FormattedCell {
  char: string
  style: CellStyle
}

// 16 standard ANSI colors
const ANSI_16: Record<number, string> = {
  30: '#1e1e1e', // Black
  31: '#f44336', // Red
  32: '#4caf50', // Green
  33: '#ffeb3b', // Yellow
  34: '#2196f3', // Blue
  35: '#e91e63', // Magenta
  36: '#00bcd4', // Cyan
  37: '#e0e0e0', // White
  90: '#757575', // Bright Black
  91: '#ef5350', // Bright Red
  92: '#81c784', // Bright Green
  93: '#fff59d', // Bright Yellow
  94: '#64b5f6', // Bright Blue
  95: '#f06292', // Bright Magenta
  96: '#4dd0e1', // Bright Cyan
  97: '#ffffff', // Bright White
}

const ANSI_BG_16: Record<number, string> = {
  40: '#1e1e1e',
  41: '#b71c1c',
  42: '#1b5e20',
  43: '#f57f17',
  44: '#0d47a1',
  45: '#880e4f',
  46: '#006064',
  47: '#e0e0e0',
  100: '#424242',
  101: '#d32f2f',
  102: '#388e3c',
  103: '#fbc02d',
  104: '#1976d2',
  105: '#c2185b',
  106: '#0097a7',
  107: '#ffffff',
}

// 256 color lookup table
function ansi256Color(n: number): string {
  if (n < 8) return ANSI_16[30 + n] || '#000000'
  if (n < 16) return ANSI_16[90 + (n - 8)] || '#ffffff'
  if (n >= 16 && n <= 231) {
    const r = Math.floor((n - 16) / 36) * 51
    const g = Math.floor(((n - 16) % 36) / 6) * 51
    const b = ((n - 16) % 6) * 51
    return `rgb(${r},${g},${b})`
  }
  if (n >= 232 && n <= 255) {
    const gray = (n - 232) * 10 + 8
    return `rgb(${gray},${gray},${gray})`
  }
  return '#ffffff'
}

export class AnsiState {
  style: CellStyle = {}

  reset() {
    this.style = {}
  }

  processSgr(params: number[]) {
    if (params.length === 0) {
      this.reset()
      return
    }

    let i = 0
    while (i < params.length) {
      const code = params[i]
      if (code === 0) {
        this.reset()
      } else if (code === 1) {
        this.style.bold = true
      } else if (code === 2) {
        this.style.dim = true
      } else if (code === 3) {
        this.style.italic = true
      } else if (code === 4) {
        this.style.underline = true
      } else if (code === 7) {
        this.style.inverse = true
      } else if (code === 22) {
        this.style.bold = false
        this.style.dim = false
      } else if (code === 23) {
        this.style.italic = false
      } else if (code === 24) {
        this.style.underline = false
      } else if (code === 27) {
        this.style.inverse = false
      } else if (code >= 30 && code <= 37) {
        this.style.fg = ANSI_16[code]
      } else if (code === 38) {
        // Extended FG
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          this.style.fg = ansi256Color(params[i + 2])
          i += 2
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          this.style.fg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`
          i += 4
        }
      } else if (code === 39) {
        delete this.style.fg
      } else if (code >= 40 && code <= 47) {
        this.style.bg = ANSI_BG_16[code]
      } else if (code === 48) {
        // Extended BG
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          this.style.bg = ansi256Color(params[i + 2])
          i += 2
        } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
          this.style.bg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`
          i += 4
        }
      } else if (code === 49) {
        delete this.style.bg
      } else if (code >= 90 && code <= 97) {
        this.style.fg = ANSI_16[code]
      } else if (code >= 100 && code <= 107) {
        this.style.bg = ANSI_BG_16[code]
      }
      i++
    }
  }

  cloneStyle(): CellStyle {
    return { ...this.style }
  }
}
