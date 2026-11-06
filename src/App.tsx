import { ReactiveComponent, type InputEvent, type KeyEvent, type Style } from '@geastack/core'
import { NativeBridge, type PtySpawnResult } from './platform/host'
import { TerminalBuffer, type TerminalLine } from './terminal/buffer'
import { KeyCodes } from './terminal/keys'
import { Header } from './components/Header'
import { Toolbar } from './components/Toolbar'
import './styles.css'

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
  cursorRow = 0
  cursorCol = 0
  cursorVisible = true
  inputValue = ''

  private buffer: TerminalBuffer = new TerminalBuffer(80, 26)
  private pollTimer: any = null

  onAfterRender() {
    if (!this.pollTimer) {
      this.startSession()
    }
  }

  startSession() {
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
    const res = NativeBridge.read()
    if (res.bytes > 0 && res.text) {
      this.buffer.write(res.text)
      this.updateFromBuffer()
    }
    if (res.alive !== this.alive) {
      this.alive = res.alive
    }
  }

  updateFromBuffer() {
    this.lines = this.buffer.getRenderableLines()
    this.cursorRow = this.buffer.cursorRow
    this.cursorCol = this.buffer.cursorCol
    this.cursorVisible = this.buffer.cursorVisible
  }

  sendToPty(data: string) {
    NativeBridge.write(data)
    setTimeout(() => this.pollPty(), 5)
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

  toggleTheme() {
    const themes: ThemeName[] = ['silica', 'matrix', 'amber', 'dracula']
    const nextIdx = (themes.indexOf(this.theme) + 1) % themes.length
    this.theme = themes[nextIdx]
  }

  changeFontSize(delta: number) {
    const next = Math.max(9, Math.min(24, this.fontSize + delta))
    this.fontSize = next
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
        >
          {/* Virtual and hardware keyboard input surface */}
          <input
            class="maliit-input-bridge"
            type="text"
            value={this.inputValue}
            onInput={(e: InputEvent) => this.handleHiddenInput(e)}
            onKeyDown={(e: KeyEvent) => this.handleHiddenKeyDown(e)}
          />

          <div class="terminal-grid">
            {this.lines.map((line, rIdx) => (
              <div key={rIdx} class="terminal-line">
                {line.spans.map((span, sIdx) => {
                  const spanStyle: Style = {}
                  if (span.style.fg) spanStyle.color = span.style.fg
                  if (span.style.bg) spanStyle.backgroundColor = span.style.bg
                  if (span.style.dim) spanStyle.opacity = 0.6

                  const spanClass = [
                    'term-span',
                    span.style.bold ? 'bold' : '',
                    span.style.italic ? 'italic' : '',
                    span.style.underline ? 'underline' : '',
                    span.style.inverse ? 'inverse' : ''
                  ].filter(Boolean).join(' ')

                  return (
                    <span key={sIdx} class={spanClass} style={spanStyle}>
                      {span.text}
                    </span>
                  )
                })}

                {/* Cursor rendering on active row */}
                {rIdx === (this.lines.length - this.rows + this.cursorRow) && this.cursorVisible && (
                  <span class="terminal-cursor blink" style={{ left: `calc(${this.cursorCol} * 1ch)` }}>
                    &nbsp;
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <Toolbar
          onKey={(key: string) => this.sendToPty(key)}
          onClear={() => this.clearScreen()}
          onToggleKeyboard={() => {}}
          onFontSizeChange={(delta: number) => this.changeFontSize(delta)}
        />
      </div>
    )
  }
}
