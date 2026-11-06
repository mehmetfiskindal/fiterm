import { AnsiState, CellStyle, FormattedCell } from './ansi'

export interface TerminalSpan {
  text: string
  style: CellStyle
}

export interface TerminalLine {
  spans: TerminalSpan[]
}

export class TerminalBuffer {
  cols: number
  rows: number
  cursorRow: number = 0
  cursorCol: number = 0
  cursorVisible: boolean = true

  private ansi: AnsiState = new AnsiState()
  private screen: FormattedCell[][] = []
  private scrollback: FormattedCell[][] = []
  private altScreen: FormattedCell[][] | null = null
  private maxScrollback: number = 2000

  constructor(cols = 80, rows = 24) {
    this.cols = cols
    this.rows = rows
    this.initScreen()
  }

  private initScreen() {
    this.screen = []
    for (let r = 0; r < this.rows; r++) {
      this.screen.push(this.createEmptyRow())
    }
  }

  private createEmptyRow(): FormattedCell[] {
    const row: FormattedCell[] = []
    const emptyStyle = this.ansi.cloneStyle()
    for (let c = 0; c < this.cols; c++) {
      row.push({ char: ' ', style: emptyStyle })
    }
    return row
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows

    // Adjust row count
    while (this.screen.length < this.rows) {
      this.screen.push(this.createEmptyRow())
    }
    while (this.screen.length > this.rows) {
      const top = this.screen.shift()
      if (top) this.scrollback.push(top)
    }

    // Adjust col count
    for (let r = 0; r < this.screen.length; r++) {
      while (this.screen[r].length < this.cols) {
        this.screen[r].push({ char: ' ', style: {} })
      }
      if (this.screen[r].length > this.cols) {
        this.screen[r] = this.screen[r].slice(0, this.cols)
      }
    }

    if (this.cursorRow >= this.rows) this.cursorRow = this.rows - 1
    if (this.cursorCol >= this.cols) this.cursorCol = this.cols - 1
  }

  clear() {
    this.initScreen()
    this.scrollback = []
    this.cursorRow = 0
    this.cursorCol = 0
    this.ansi.reset()
  }

  write(data: string) {
    let i = 0
    const len = data.length

    while (i < len) {
      const char = data[i]

      // Handle ESC sequences
      if (char === '\x1b') {
        const next = data[i + 1]
        if (next === '[') {
          // CSI Sequence
          let j = i + 2
          let paramsStr = ''
          while (j < len && (data[j] >= '0' && data[j] <= '9' || data[j] === ';' || data[j] === '?')) {
            paramsStr += data[j]
            j++
          }
          const command = data[j]
          this.handleCsi(paramsStr, command)
          i = j + 1
          continue
        } else if (next === ']') {
          // OSC Sequence (e.g. title) - skip to BEL or ST
          let j = i + 2
          while (j < len && data[j] !== '\x07' && !(data[j] === '\x1b' && data[j + 1] === '\\')) {
            j++
          }
          i = data[j] === '\x1b' ? j + 2 : j + 1
          continue
        } else if (next === '(' || next === ')') {
          // Character set selection
          i += 3
          continue
        } else {
          i += 2
          continue
        }
      }

      // Handle Control Characters
      if (char === '\r') {
        this.cursorCol = 0
        i++
        continue
      }
      if (char === '\n') {
        this.newLine()
        i++
        continue
      }
      if (char === '\b') {
        if (this.cursorCol > 0) this.cursorCol--
        i++
        continue
      }
      if (char === '\t') {
        const nextTab = Math.min(this.cols - 1, (Math.floor(this.cursorCol / 8) + 1) * 8)
        while (this.cursorCol < nextTab) {
          this.putChar(' ')
        }
        i++
        continue
      }
      if (char === '\x07') {
        // Bell - ignore
        i++
        continue
      }

      // Printable character
      this.putChar(char)
      i++
    }
  }

  private putChar(char: string) {
    if (this.cursorCol >= this.cols) {
      this.cursorCol = 0
      this.newLine()
    }
    if (this.cursorRow < this.rows && this.cursorCol < this.cols) {
      this.screen[this.cursorRow][this.cursorCol] = {
        char,
        style: this.ansi.cloneStyle()
      }
      this.cursorCol++
    }
  }

  private newLine() {
    if (this.cursorRow < this.rows - 1) {
      this.cursorRow++
    } else {
      // Scroll down
      const topRow = this.screen.shift()
      if (topRow) {
        this.scrollback.push(topRow)
        if (this.scrollback.length > this.maxScrollback) {
          this.scrollback.shift()
        }
      }
      this.screen.push(this.createEmptyRow())
    }
  }

  private handleCsi(paramsStr: string, cmd: string) {
    const isPrivate = paramsStr.startsWith('?')
    const cleanParams = isPrivate ? paramsStr.slice(1) : paramsStr
    const parts = cleanParams.length > 0 ? cleanParams.split(';').map(p => parseInt(p, 10)) : []

    switch (cmd) {
      case 'm': // SGR Color & Style
        this.ansi.processSgr(parts)
        break

      case 'H': // Cursor Position
      case 'f': {
        const row = (parts[0] || 1) - 1
        const col = (parts[1] || 1) - 1
        this.cursorRow = Math.max(0, Math.min(this.rows - 1, row))
        this.cursorCol = Math.max(0, Math.min(this.cols - 1, col))
        break
      }

      case 'A': { // Cursor Up
        const count = parts[0] || 1
        this.cursorRow = Math.max(0, this.cursorRow - count)
        break
      }

      case 'B': { // Cursor Down
        const count = parts[0] || 1
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + count)
        break
      }

      case 'C': { // Cursor Forward
        const count = parts[0] || 1
        this.cursorCol = Math.min(this.cols - 1, this.cursorCol + count)
        break
      }

      case 'D': { // Cursor Back
        const count = parts[0] || 1
        this.cursorCol = Math.max(0, this.cursorCol - count)
        break
      }

      case 'J': { // Erase in Display
        const mode = parts[0] || 0
        if (mode === 2) {
          // Clear entire screen
          for (let r = 0; r < this.rows; r++) {
            this.screen[r] = this.createEmptyRow()
          }
          this.cursorRow = 0
          this.cursorCol = 0
        } else if (mode === 0) {
          // Clear from cursor to end
          for (let c = this.cursorCol; c < this.cols; c++) {
            this.screen[this.cursorRow][c] = { char: ' ', style: this.ansi.cloneStyle() }
          }
          for (let r = this.cursorRow + 1; r < this.rows; r++) {
            this.screen[r] = this.createEmptyRow()
          }
        }
        break
      }

      case 'K': { // Erase in Line
        const mode = parts[0] || 0
        if (mode === 0) {
          // Clear cursor to end of line
          for (let c = this.cursorCol; c < this.cols; c++) {
            this.screen[this.cursorRow][c] = { char: ' ', style: this.ansi.cloneStyle() }
          }
        } else if (mode === 1) {
          // Clear start of line to cursor
          for (let c = 0; c <= this.cursorCol; c++) {
            this.screen[this.cursorRow][c] = { char: ' ', style: this.ansi.cloneStyle() }
          }
        } else if (mode === 2) {
          // Clear entire line
          this.screen[this.cursorRow] = this.createEmptyRow()
        }
        break
      }

      case 'h': // Set Mode
        if (isPrivate) {
          if (parts[0] === 25) this.cursorVisible = true
          if (parts[0] === 1049) {
            // Alternate buffer
            if (!this.altScreen) {
              this.altScreen = this.screen
              this.initScreen()
            }
          }
        }
        break

      case 'l': // Reset Mode
        if (isPrivate) {
          if (parts[0] === 25) this.cursorVisible = false
          if (parts[0] === 1049) {
            // Restore normal buffer
            if (this.altScreen) {
              this.screen = this.altScreen
              this.altScreen = null
            }
          }
        }
        break
    }
  }

  // Get lines formatted into spans for high-efficiency rendering
  getRenderableLines(): TerminalLine[] {
    const allRows = [...this.scrollback, ...this.screen]
    const lines: TerminalLine[] = []

    for (const row of allRows) {
      const spans: TerminalSpan[] = []
      let currentSpan: TerminalSpan | null = null

      for (const cell of row) {
        if (!currentSpan) {
          currentSpan = { text: cell.char, style: cell.style }
        } else if (this.isStyleEqual(currentSpan.style, cell.style)) {
          currentSpan.text += cell.char
        } else {
          spans.push(currentSpan)
          currentSpan = { text: cell.char, style: cell.style }
        }
      }
      if (currentSpan) {
        // Trim trailing empty space for rendering performance
        currentSpan.text = currentSpan.text.replace(/\s+$/, '')
        if (currentSpan.text.length > 0 || spans.length > 0) {
          spans.push(currentSpan)
        }
      }
      lines.push({ spans: spans.length > 0 ? spans : [{ text: ' ', style: {} }] })
    }

    return lines
  }

  private isStyleEqual(a: CellStyle, b: CellStyle): boolean {
    return (
      a.fg === b.fg &&
      a.bg === b.bg &&
      a.bold === b.bold &&
      a.dim === b.dim &&
      a.italic === b.italic &&
      a.underline === b.underline &&
      a.inverse === b.inverse
    )
  }
}
