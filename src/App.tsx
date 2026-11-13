import { ReactiveComponent, type Element as GeaNode, type InputEvent, type KeyEvent, type Style } from '@geastack/core'
import { NativeBridge, type PtySpawnResult } from './platform/host'
import { TerminalBuffer, type TerminalLine } from './terminal/buffer'
import { KeyCodes } from './terminal/keys'
import { Header } from './components/Header'
import { Toolbar } from './components/Toolbar'
import './styles.css'

// Must match gea.sailfish.devicePixelRatio in package.json.
const DEVICE_PIXEL_RATIO = 2

export type ThemeName = 'silica' | 'matrix' | 'amber' | 'dracula'

export class App extends ReactiveComponent {
  pid = 0
  shell = '/bin/bash'
  alive = false
  cols = 80
  rows = 26
  fontSize = 13
  theme: ThemeName = 'silica'
  lines: TerminalLine[] = []
  inputValue = ''
  // Lines scrolled back into history (0 = live screen).
  scrollOffset = 0
  // Cell size in CSS px for the current font size.
  cellW = 8
  lineH = 17
  // Select mode: the view is frozen and words can be tapped to select them.
  selectMode = false
  selStart = -1
  selEnd = -1
  selText = ''
  private appCursorKeys = false
  private lastW = 0
  private lastH = 0

  private buffer: TerminalBuffer = new TerminalBuffer(80, 26)
  private pollTimer: any = null

  onAfterRender() {
    if (!this.pollTimer) {
      this.startSession()
    }
  }


  // Fit the grid to the window. The window has no resize event on this target
  // (and the phone resizes right after launch), so this runs on every poll.
  syncGrid(force: boolean) {
    // innerWidth/innerHeight are canvas pixels; CSS px = canvas px / DPR.
    const w = window.innerWidth / DEVICE_PIXEL_RATIO
    const h = window.innerHeight / DEVICE_PIXEL_RATIO
    if (!force && w === this.lastW && h === this.lastH) return
    this.lastW = w
    this.lastH = h
    // DejaVu Sans Mono advance is 0.602 em; round up to half a CSS px.
    this.cellW = Math.ceil(this.fontSize * 0.602 * 2) / 2
    this.lineH = Math.round(this.fontSize * 1.3)
    // Chrome: 45px header, 52px toolbar, 4px/6px viewport padding.
    const cols = Math.max(20, Math.floor((w - 12) / this.cellW))
    const rows = Math.max(5, Math.floor((h - 45 - 52 - 8) / this.lineH))
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    this.buffer.resize(cols, rows)
    NativeBridge.resize(rows, cols)
    this.updateFromBuffer()
  }

  startSession() {
    this.syncGrid(true)
    this.scrollOffset = 0
    this.appCursorKeys = false
    this.buffer = new TerminalBuffer(this.cols, this.rows)
    const result: PtySpawnResult | null = NativeBridge.spawn(this.rows, this.cols)
    if (result) {
      this.pid = result.pid
      this.shell = result.shell
      this.alive = true
    } else {
      this.alive = false
    }

    this.updateFromBuffer()

    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => this.pollPty(), 25)
  }

  restartSession() {
    NativeBridge.close()
    this.startSession()
  }

  pollPty() {
    this.syncGrid(false)
    const res = NativeBridge.read()
    if (res.bytes > 0 && res.text) {
      this.buffer.write(res.text)
      const reply = this.buffer.takeReplies()
      if (reply.length > 0) NativeBridge.write(reply)
      if (this.buffer.appCursorKeys !== this.appCursorKeys) {
        this.appCursorKeys = this.buffer.appCursorKeys
        NativeBridge.invoke('input.mode', { appCursor: this.appCursorKeys })
      }
      if (!this.selectMode) this.updateFromBuffer()
    }
    if (res.alive !== this.alive) {
      this.alive = res.alive
    }
  }

  updateFromBuffer() {
    const max = this.buffer.scrollbackLength()
    if (this.scrollOffset > max) this.scrollOffset = max
    this.lines = this.buffer.getRenderableLines(this.scrollOffset, this.selectMode, this.selStart, this.selEnd)
  }

  toggleSelectMode() {
    this.selectMode = !this.selectMode
    this.selStart = -1
    this.selEnd = -1
    this.selText = ''
    this.updateFromBuffer()
  }

  // First tap selects a word; further taps extend the selection to that word.
  tapSpan(line: number, col: number, cells: number) {
    if (!this.selectMode) return
    const first = line * this.cols + col
    const last = first + cells - 1
    if (this.selStart < 0) {
      this.selStart = first
      this.selEnd = last
    } else {
      if (first < this.selStart) this.selStart = first
      if (last > this.selEnd) this.selEnd = last
    }
    this.selText = this.buffer.getText(this.scrollOffset, this.selStart, this.selEnd)
    this.updateFromBuffer()
  }

  clearSelection() {
    this.selStart = -1
    this.selEnd = -1
    this.selText = ''
    this.updateFromBuffer()
  }

  selectionIsUrl(): boolean {
    const t = this.selText
    if (!(t.startsWith('http://') || t.startsWith('https://'))) return false
    return t.indexOf(' ') < 0 && t.indexOf('\n') < 0
  }

  copySelection() {
    if (this.selText.length > 0) NativeBridge.invoke('clipboard.set', { text: this.selText })
    this.toggleSelectMode()
  }

  openSelection() {
    if (this.selectionIsUrl()) NativeBridge.invoke('url.open', { url: this.selText })
    this.toggleSelectMode()
  }

  paste() {
    NativeBridge.invoke('clipboard.paste', {})
    setTimeout(() => this.pollPty(), 5)
  }

  sendToPty(data: string) {
    let out = data
    // Full-screen programs switch the arrow keys to ESC O x.
    if (this.appCursorKeys && out.length === 3 && out[0] === '\x1b' && out[1] === '[') {
      const k = out[2]
      if (k === 'A' || k === 'B' || k === 'C' || k === 'D' || k === 'H' || k === 'F') out = '\x1bO' + k
    }
    if (this.scrollOffset !== 0) {
      this.scrollOffset = 0
      this.updateFromBuffer()
    }
    NativeBridge.write(out)
    setTimeout(() => this.pollPty(), 5)
  }

  // Scroll the view through history by half a screen.
  scrollView(direction: number) {
    const step = Math.max(1, Math.floor(this.rows / 2))
    let next = this.scrollOffset + direction * step
    const max = this.buffer.scrollbackLength()
    if (next > max) next = max
    if (next < 0) next = 0
    if (next === this.scrollOffset) return
    this.scrollOffset = next
    this.updateFromBuffer()
  }

  // Portrait -> landscape -> inverted landscape; syncGrid picks up the new size.
  rotateScreen() {
    NativeBridge.invoke('display.rotate', {})
  }

  toggleKeyboard() {
    NativeBridge.invoke('keyboard.toggle', {})
  }

  handleHiddenInput(e: InputEvent) {
    const val = e.target.value
    if (val.length > 0) {
      this.sendToPty(val)
      this.inputValue = ''
    }
  }

  handleHiddenKeyDown(e: KeyEvent) {
    if (e.ctrlKey) {
      const code = e.key.toUpperCase()
      if (code === 'C') {
        this.sendToPty('\x03')
        return
      } else if (code === 'D') {
        this.sendToPty('\x04')
        return
      } else if (code === 'L') {
        this.sendToPty('\x0c')
        return
      } else if (code === 'Z') {
        this.sendToPty('\x1a')
        return
      }
    }

    const key = e.key
    if (key === 'Enter') {
      this.sendToPty(KeyCodes.ENTER)
      this.inputValue = ''
    } else if (key === 'Backspace') {
      this.sendToPty(KeyCodes.BACKSPACE)
    } else if (key === 'Tab') {
      this.sendToPty(KeyCodes.TAB)
    } else if (key === 'Escape') {
      this.sendToPty(KeyCodes.ESC)
    } else if (key === 'ArrowUp') {
      this.sendToPty(KeyCodes.ARROW_UP)
    } else if (key === 'ArrowDown') {
      this.sendToPty(KeyCodes.ARROW_DOWN)
    } else if (key === 'ArrowLeft') {
      this.sendToPty(KeyCodes.ARROW_LEFT)
    } else if (key === 'ArrowRight') {
      this.sendToPty(KeyCodes.ARROW_RIGHT)
    }
  }

  // Tapping the terminal focuses the tiny hidden input, which raises the
  // Maliit keyboard. The input no longer overlays the terminal text.
  focusInput() {
    if (this.selectMode) return
    const input = document.querySelector('.maliit-input-bridge') as GeaNode | null
    if (input) input.focus()
  }

  toggleTheme() {
    const themes: ThemeName[] = ['silica', 'matrix', 'amber', 'dracula']
    const nextIdx = (themes.indexOf(this.theme) + 1) % themes.length
    this.theme = themes[nextIdx]
  }

  changeFontSize(delta: number) {
    const next = Math.max(9, Math.min(24, this.fontSize + delta))
    if (next === this.fontSize) return
    this.fontSize = next
    this.syncGrid(true)
  }

  clearScreen() {
    this.sendToPty('\x0c')
  }

  template() {
    return (
      <div class={`fiterm-app theme-${this.theme}`}>
        <Header
          pid={this.pid}
          shell={this.shell}
          alive={this.alive}
          cols={this.cols}
          rows={this.rows}
          currentTheme={this.theme}
          onRestart={() => this.restartSession()}
          onToggleTheme={() => this.toggleTheme()}
        />

        <div
          class="terminal-viewport"
          style={{ fontSize: `${this.fontSize}px` }}
          onClick={() => this.focusInput()}
        >
          {/* Virtual and hardware keyboard input surface */}
          <input
            class="maliit-input-bridge"
            type="text"
            value={this.inputValue}
            onInput={(e: InputEvent) => this.handleHiddenInput(e)}
            onKeyDown={(e: KeyEvent) => this.handleHiddenKeyDown(e)}
          />

          <div class={this.selectMode ? 'terminal-grid-select' : 'terminal-grid'}>
            {this.lines.map((line, rIdx) => (
              <div key={rIdx} class="terminal-line" style={{ height: `${this.lineH}px` }}>
                {line.spans.map((span, sIdx) => {
                  // Every span is exactly `cells` wide, so columns stay on the
                  // grid whatever the glyph advances round to.
                  const spanStyle: Style = { width: `${span.cells * this.cellW}px` }
                  if (!span.cursor && !span.selected) {
                    const fg = span.style.inverse ? span.style.bg : span.style.fg
                    const bg = span.style.inverse ? span.style.fg : span.style.bg
                    if (fg) spanStyle.color = fg
                    if (bg) spanStyle.backgroundColor = bg
                  }

                  const spanClass = [
                    'term-span',
                    span.cursor ? 'cursor' : '',
                    span.selected ? 'selected' : '',
                    span.style.bold ? 'bold' : '',
                    span.style.dim ? 'dim' : '',
                    span.style.inverse && !span.cursor ? 'inverse' : ''
                  ].filter(Boolean).join(' ')

                  return (
                    <span
                      key={sIdx}
                      class={spanClass}
                      style={spanStyle}
                      onClick={() => this.tapSpan(rIdx, span.col, span.cells)}
                    >
                      {span.text}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {this.selectMode && (
          <div class="select-bar">
            <span class="select-hint">
              {this.selStart < 0 ? 'Tap a word' : 'Tap another word to extend'}
            </span>
            <button class="header-btn" onClick={() => this.copySelection()}>Copy</button>
            {this.selectionIsUrl() && (
              <button class="header-btn" onClick={() => this.openSelection()}>Open</button>
            )}
            <button class="header-btn" onClick={() => this.clearSelection()}>Clear</button>
            <button class="header-btn restart" onClick={() => this.toggleSelectMode()}>Done</button>
          </div>
        )}

        <Toolbar
          onSelect={() => this.toggleSelectMode()}
          onPaste={() => this.paste()}
          onKey={(key: string) => this.sendToPty(key)}
          onClear={() => this.clearScreen()}
          onToggleKeyboard={() => this.toggleKeyboard()}
          onScroll={(direction: number) => this.scrollView(direction)}
          onRotate={() => this.rotateScreen()}
          onFontSizeChange={(delta: number) => this.changeFontSize(delta)}
        />
      </div>
    )
  }
}
