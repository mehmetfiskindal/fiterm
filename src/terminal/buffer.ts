import { AnsiState, CellStyle, FormattedCell } from './ansi'

export interface TerminalSpan {
  text: string
  // Number of terminal cells this span covers (drives its pixel width).
  cells: number
  style: CellStyle
  cursor: boolean
  // First column of the span, and whether it is inside the selection.
  col: number
  selected: boolean
}

export interface TerminalLine {
  spans: TerminalSpan[]
}

// xterm-style screen buffer: scroll regions, insert/delete, alternate screen,
// saved cursor, and a parser that survives escape sequences split across reads.
export class TerminalBuffer {
  cols: number
  rows: number
  cursorRow: number = 0
  cursorCol: number = 0
  cursorVisible: boolean = true
  // DECCKM: arrow keys must be sent as ESC O x instead of ESC [ x.
  appCursorKeys: boolean = false

  private ansi: AnsiState = new AnsiState()
  private screen: FormattedCell[][] = []
  private scrollback: FormattedCell[][] = []
  private mainScreen: FormattedCell[][] | null = null
  private maxScrollback: number = 1000
  private scrollTop: number = 0
  private scrollBottom: number = 0
  private savedRow: number = 0
  private savedCol: number = 0
  private altSavedRow: number = 0
  private altSavedCol: number = 0
  private pending: string = ''
  private replies: string = ''

  constructor(cols = 80, rows = 24) {
    this.cols = cols
    this.rows = rows
    this.scrollBottom = rows - 1
    this.screen = this.createGrid()
  }

  private createGrid(): FormattedCell[][] {
    const grid: FormattedCell[][] = []
    for (let r = 0; r < this.rows; r++) {
      grid.push(this.createEmptyRow())
    }
    return grid
  }

  private blankCell(): FormattedCell {
    const style: CellStyle = {}
    const bg = this.ansi.cloneStyle().bg
    if (bg) style.bg = bg
    return { char: ' ', style }
  }

  private createEmptyRow(): FormattedCell[] {
    const row: FormattedCell[] = []
    for (let c = 0; c < this.cols; c++) {
      row.push(this.blankCell())
    }
    return row
  }

  private resizeGrid(grid: FormattedCell[][], keepScrollback: boolean): FormattedCell[][] {
    const out: FormattedCell[][] = []
    let drop = grid.length - this.rows
    if (drop < 0) drop = 0
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r]
      if (r < drop) {
        if (keepScrollback) this.pushScrollback(row)
        continue
      }
      const next: FormattedCell[] = []
      for (let c = 0; c < this.cols; c++) {
        if (c < row.length) next.push(row[c])
        else next.push({ char: ' ', style: {} })
      }
      out.push(next)
    }
    while (out.length < this.rows) {
      out.push(this.createEmptyRow())
    }
    return out
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return
    const dropped = this.rows > rows ? this.rows - rows : 0
    this.cols = cols
    this.rows = rows
    const inAlt = this.mainScreen !== null
    this.screen = this.resizeGrid(this.screen, !inAlt)
    if (this.mainScreen) this.mainScreen = this.resizeGrid(this.mainScreen, true)
    this.scrollTop = 0
    this.scrollBottom = rows - 1
    this.cursorRow = this.cursorRow - dropped
    if (this.cursorRow < 0) this.cursorRow = 0
    if (this.cursorRow >= rows) this.cursorRow = rows - 1
    if (this.cursorCol >= cols) this.cursorCol = cols - 1
  }

  clear() {
    this.screen = this.createGrid()
    this.scrollback = []
    this.cursorRow = 0
    this.cursorCol = 0
    this.ansi.reset()
  }

  // Bytes the terminal must send back to the program (cursor position reports).
  takeReplies(): string {
    const out = this.replies
    this.replies = ''
    return out
  }

  scrollbackLength(): number {
    return this.mainScreen ? 0 : this.scrollback.length
  }

  private pushScrollback(row: FormattedCell[]) {
    this.scrollback.push(row)
    if (this.scrollback.length > this.maxScrollback) {
      this.scrollback.shift()
    }
  }

  write(input: string) {
    const data = this.pending + input
    this.pending = ''
    const len = data.length
    let i = 0

    while (i < len) {
      const char = data[i]

      if (char === '\x1b') {
        if (i + 1 >= len) {
          this.pending = data.slice(i)
          return
        }
        const next = data[i + 1]

        if (next === '[') {
          let j = i + 2
          let params = ''
          while (j < len && data[j] >= ' ' && data[j] <= '?') {
            params += data[j]
            j++
          }
          if (j >= len) {
            this.pending = data.slice(i)
            return
          }
          this.handleCsi(params, data[j])
          i = j + 1
          continue
        }

        if (next === ']' || next === 'P' || next === '^' || next === '_') {
          // OSC / DCS / PM / APC: skip to BEL or ESC \
          let j = i + 2
          let end = -1
          while (j < len) {
            if (data[j] === '\x07') {
              end = j + 1
              break
            }
            if (data[j] === '\x1b' && j + 1 < len && data[j + 1] === '\\') {
              end = j + 2
              break
            }
            j++
          }
          if (end < 0) {
            // Unterminated: wait for more, but never buffer without bound.
            if (len - i < 4096) this.pending = data.slice(i)
            return
          }
          i = end
          continue
        }

        if (next === '(' || next === ')' || next === '*' || next === '+' || next === '#' || next === '%') {
          if (i + 2 >= len) {
            this.pending = data.slice(i)
            return
          }
          i += 3
          continue
        }

        this.handleEsc(next)
        i += 2
        continue
      }

      if (char === '\r') {
        this.cursorCol = 0
      } else if (char === '\n' || char === '\x0b' || char === '\x0c') {
        this.lineFeed()
      } else if (char === '\b') {
        if (this.cursorCol >= this.cols) this.cursorCol = this.cols - 1
        if (this.cursorCol > 0) this.cursorCol--
      } else if (char === '\t') {
        let nextTab = (Math.floor(this.cursorCol / 8) + 1) * 8
        if (nextTab > this.cols - 1) nextTab = this.cols - 1
        this.cursorCol = nextTab
      } else if (char < ' ' || char === '\x7f') {
        // Other control characters (BEL, SO, SI, ...) are ignored.
      } else {
        this.putChar(char)
      }
      i++
    }
  }

  private putChar(char: string) {
    if (this.cursorCol >= this.cols) {
      this.cursorCol = 0
      this.lineFeed()
    }
    this.screen[this.cursorRow][this.cursorCol] = {
      char,
      style: this.ansi.cloneStyle()
    }
    this.cursorCol++
  }

  private lineFeed() {
    if (this.cursorRow === this.scrollBottom) {
      this.scrollUp(1)
    } else if (this.cursorRow < this.rows - 1) {
      this.cursorRow++
    }
  }

  private reverseIndex() {
    if (this.cursorRow === this.scrollTop) {
      this.scrollDown(1)
    } else if (this.cursorRow > 0) {
      this.cursorRow--
    }
  }

  private scrollUp(count: number) {
    for (let n = 0; n < count; n++) {
      if (this.scrollTop === 0 && this.mainScreen === null) {
        this.pushScrollback(this.screen[0])
      }
      for (let r = this.scrollTop; r < this.scrollBottom; r++) {
        this.screen[r] = this.screen[r + 1]
      }
      this.screen[this.scrollBottom] = this.createEmptyRow()
    }
  }

  private scrollDown(count: number) {
    for (let n = 0; n < count; n++) {
      for (let r = this.scrollBottom; r > this.scrollTop; r--) {
        this.screen[r] = this.screen[r - 1]
      }
      this.screen[this.scrollTop] = this.createEmptyRow()
    }
  }

  private insertLines(count: number) {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) return
    for (let n = 0; n < count; n++) {
      for (let r = this.scrollBottom; r > this.cursorRow; r--) {
        this.screen[r] = this.screen[r - 1]
      }
      this.screen[this.cursorRow] = this.createEmptyRow()
    }
  }

  private deleteLines(count: number) {
    if (this.cursorRow < this.scrollTop || this.cursorRow > this.scrollBottom) return
    for (let n = 0; n < count; n++) {
      for (let r = this.cursorRow; r < this.scrollBottom; r++) {
        this.screen[r] = this.screen[r + 1]
      }
      this.screen[this.scrollBottom] = this.createEmptyRow()
    }
  }

  private eraseCells(row: number, from: number, to: number) {
    const line = this.screen[row]
    for (let c = from; c < to && c < this.cols; c++) {
      line[c] = this.blankCell()
    }
  }

  private setCursor(row: number, col: number) {
    if (row < 0) row = 0
    if (row > this.rows - 1) row = this.rows - 1
    if (col < 0) col = 0
    if (col > this.cols - 1) col = this.cols - 1
    this.cursorRow = row
    this.cursorCol = col
  }

  private enterAltScreen(saveCursor: boolean) {
    if (this.mainScreen !== null) return
    if (saveCursor) {
      this.altSavedRow = this.cursorRow
      this.altSavedCol = this.cursorCol
    }
    this.mainScreen = this.screen
    this.screen = this.createGrid()
  }

  private leaveAltScreen(restoreCursor: boolean) {
    if (this.mainScreen === null) return
    this.screen = this.mainScreen
    this.mainScreen = null
    this.scrollTop = 0
    this.scrollBottom = this.rows - 1
    if (restoreCursor) this.setCursor(this.altSavedRow, this.altSavedCol)
  }

  private handleEsc(code: string) {
    if (code === '7') {
      this.savedRow = this.cursorRow
      this.savedCol = this.cursorCol
    } else if (code === '8') {
      this.setCursor(this.savedRow, this.savedCol)
    } else if (code === 'M') {
      this.reverseIndex()
    } else if (code === 'D') {
      this.lineFeed()
    } else if (code === 'E') {
      this.cursorCol = 0
      this.lineFeed()
    } else if (code === 'c') {
      this.leaveAltScreen(false)
      this.ansi.reset()
      this.screen = this.createGrid()
      this.scrollTop = 0
      this.scrollBottom = this.rows - 1
      this.cursorRow = 0
      this.cursorCol = 0
      this.cursorVisible = true
      this.appCursorKeys = false
    }
  }

  private setMode(mode: number, on: boolean) {
    if (mode === 1) {
      this.appCursorKeys = on
    } else if (mode === 25) {
      this.cursorVisible = on
    } else if (mode === 47 || mode === 1047) {
      if (on) this.enterAltScreen(false)
      else this.leaveAltScreen(false)
    } else if (mode === 1049) {
      if (on) this.enterAltScreen(true)
      else this.leaveAltScreen(true)
    }
  }

  private handleCsi(paramsStr: string, cmd: string) {
    let prefix = ''
    let body = paramsStr
    if (body.length > 0 && (body[0] === '?' || body[0] === '>' || body[0] === '=' || body[0] === '<')) {
      prefix = body[0]
      body = body.slice(1)
    }
    // Sequences with intermediate bytes (CSI Ps SP q, CSI ! p, ...) are not used.
    for (let k = 0; k < body.length; k++) {
      if (body[k] < '0') return
    }

    const parts: number[] = []
    if (body.length > 0) {
      const raw = body.split(';')
      for (let k = 0; k < raw.length; k++) {
        const v = raw[k].length > 0 ? parseInt(raw[k], 10) : 0
        parts.push(v > 0 ? v : 0)
      }
    }
    const p0 = parts.length > 0 ? parts[0] : 0
    const p1 = parts.length > 1 ? parts[1] : 0
    const n = p0 > 0 ? p0 : 1

    if (prefix === '?') {
      if (cmd === 'h' || cmd === 'l') {
        for (let k = 0; k < parts.length; k++) this.setMode(parts[k], cmd === 'h')
      }
      return
    }
    if (prefix === '>') {
      if (cmd === 'c') this.replies += '\x1b[>0;276;0c'
      return
    }
    if (prefix !== '') return

    if (this.cursorCol >= this.cols && cmd !== 'm') this.cursorCol = this.cols - 1

    switch (cmd) {
      case 'm':
        this.ansi.processSgr(parts)
        break
      case 'H':
      case 'f':
        this.setCursor((p0 > 0 ? p0 : 1) - 1, (p1 > 0 ? p1 : 1) - 1)
        break
      case 'A':
        this.setCursor(this.cursorRow - n, this.cursorCol)
        break
      case 'B':
      case 'e':
        this.setCursor(this.cursorRow + n, this.cursorCol)
        break
      case 'C':
      case 'a':
        this.setCursor(this.cursorRow, this.cursorCol + n)
        break
      case 'D':
        this.setCursor(this.cursorRow, this.cursorCol - n)
        break
      case 'E':
        this.setCursor(this.cursorRow + n, 0)
        break
      case 'F':
        this.setCursor(this.cursorRow - n, 0)
        break
      case 'G':
      case '`':
        this.setCursor(this.cursorRow, n - 1)
        break
      case 'd':
        this.setCursor(n - 1, this.cursorCol)
        break
      case 'J':
        if (p0 === 0) {
          this.eraseCells(this.cursorRow, this.cursorCol, this.cols)
          for (let r = this.cursorRow + 1; r < this.rows; r++) this.screen[r] = this.createEmptyRow()
        } else if (p0 === 1) {
          for (let r = 0; r < this.cursorRow; r++) this.screen[r] = this.createEmptyRow()
          this.eraseCells(this.cursorRow, 0, this.cursorCol + 1)
        } else if (p0 === 2) {
          for (let r = 0; r < this.rows; r++) this.screen[r] = this.createEmptyRow()
        } else if (p0 === 3) {
          this.scrollback = []
        }
        break
      case 'K':
        if (p0 === 0) this.eraseCells(this.cursorRow, this.cursorCol, this.cols)
        else if (p0 === 1) this.eraseCells(this.cursorRow, 0, this.cursorCol + 1)
        else if (p0 === 2) this.eraseCells(this.cursorRow, 0, this.cols)
        break
      case 'L':
        this.insertLines(n)
        break
      case 'M':
        this.deleteLines(n)
        break
      case 'P': {
        const line = this.screen[this.cursorRow]
        for (let c = this.cursorCol; c < this.cols; c++) {
          line[c] = c + n < this.cols ? line[c + n] : this.blankCell()
        }
        break
      }
      case '@': {
        const line = this.screen[this.cursorRow]
        for (let c = this.cols - 1; c >= this.cursorCol; c--) {
          line[c] = c - n >= this.cursorCol ? line[c - n] : this.blankCell()
        }
        break
      }
      case 'X':
        this.eraseCells(this.cursorRow, this.cursorCol, this.cursorCol + n)
        break
      case 'S':
        this.scrollUp(n)
        break
      case 'T':
        this.scrollDown(n)
        break
      case 'r': {
        const top = (p0 > 0 ? p0 : 1) - 1
        const bottom = (p1 > 0 ? p1 : this.rows) - 1
        if (top < bottom && bottom < this.rows) {
          this.scrollTop = top
          this.scrollBottom = bottom
        } else {
          this.scrollTop = 0
          this.scrollBottom = this.rows - 1
        }
        this.setCursor(0, 0)
        break
      }
      case 's':
        this.savedRow = this.cursorRow
        this.savedCol = this.cursorCol
        break
      case 'u':
        this.setCursor(this.savedRow, this.savedCol)
        break
      case 'n':
        if (p0 === 6) this.replies += '\x1b[' + (this.cursorRow + 1) + ';' + (this.cursorCol + 1) + 'R'
        else if (p0 === 5) this.replies += '\x1b[0n'
        break
      case 'c':
        this.replies += '\x1b[?1;2c'
        break
    }
  }

  // The `rows` lines currently on screen, `scrollOffset` lines back into the
  // scrollback, each split into same-style spans. The cursor is its own span.
  getRenderableLines(scrollOffset = 0, selecting = false, selStart = -1, selEnd = -1): TerminalLine[] {
    const sbLen = this.scrollbackLength()
    let offset = scrollOffset
    if (offset > sbLen) offset = sbLen
    if (offset < 0) offset = 0
    const lines: TerminalLine[] = []

    for (let k = 0; k < this.rows; k++) {
      const idx = sbLen - offset + k
      const row = idx < sbLen ? this.scrollback[idx] : this.screen[idx - sbLen]
      const screenRow = idx - sbLen
      let cursorAt = -1
      if (!selecting && this.cursorVisible && screenRow === this.cursorRow) {
        cursorAt = this.cursorCol < this.cols ? this.cursorCol : this.cols - 1
      }

      const spans: TerminalSpan[] = []
      let current: TerminalSpan | null = null
      let currentBlank = false
      const width = row.length < this.cols ? row.length : this.cols

      for (let c = 0; c < width; c++) {
        const cell = row[c]
        const isCursor = c === cursorAt
        const blank = cell.char === ' '
        const linear = k * this.cols + c
        const selected = selecting && linear >= selStart && linear <= selEnd
        // In select mode every word is its own span, so it can be tapped.
        const sameWord = !selecting || blank === currentBlank
        if (
          current !== null && !isCursor && !current.cursor && sameWord &&
          current.selected === selected && this.isStyleEqual(current.style, cell.style)
        ) {
          current.text += cell.char
          current.cells++
        } else {
          if (current !== null) spans.push(current)
          current = { text: cell.char, cells: 1, style: cell.style, cursor: isCursor, col: c, selected }
          currentBlank = blank
        }
      }
      if (current !== null) spans.push(current)

      // Drop trailing blank, unstyled cells: nothing to paint there.
      while (spans.length > 0) {
        const last = spans[spans.length - 1]
        if (last.cursor || last.selected || last.style.bg || last.style.inverse) break
        const trimmed = last.text.replace(/\s+$/, '')
        if (trimmed.length === 0) {
          spans.pop()
          continue
        }
        last.cells = last.cells - (last.text.length - trimmed.length)
        last.text = trimmed
        break
      }

      lines.push({ spans })
    }

    return lines
  }

  // Text between two cells of the current view (linear index = line * cols +
  // col, inclusive). A row filled to its last column is treated as wrapped and
  // joined to the next one without a newline, so long URLs come out whole.
  getText(scrollOffset: number, start: number, end: number): string {
    const sbLen = this.scrollbackLength()
    let offset = scrollOffset
    if (offset > sbLen) offset = sbLen
    if (offset < 0) offset = 0
    let out = ''
    const firstLine = Math.floor(start / this.cols)
    const lastLine = Math.floor(end / this.cols)

    for (let k = firstLine; k <= lastLine && k < this.rows; k++) {
      const idx = sbLen - offset + k
      const row = idx < sbLen ? this.scrollback[idx] : this.screen[idx - sbLen]
      const from = k === firstLine ? start - k * this.cols : 0
      let to = k === lastLine ? end - k * this.cols : this.cols - 1
      if (to > row.length - 1) to = row.length - 1
      let text = ''
      for (let c = from; c <= to; c++) text += row[c].char
      const wrapped = k < lastLine && row.length >= this.cols && row[this.cols - 1].char !== ' '
      if (wrapped) {
        out += text
      } else {
        out += text.replace(/\s+$/, '')
        if (k < lastLine) out += '\n'
      }
    }
    return out
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
