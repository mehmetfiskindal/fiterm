import { ReactiveComponent, type GeaElement } from '@geastack/core'
import { KeyCodes, toCtrlCode, toAltCode } from '../terminal/keys'

export interface ToolbarProps {
  onKey: (key: string) => void
  onClear: () => void
  onToggleKeyboard: () => void
  onFontSizeChange: (delta: number) => void
}

export class Toolbar extends ReactiveComponent<GeaElement, ToolbarProps> {
  ctrlActive = false
  altActive = false

  handleKeyClick(char: string, props?: ToolbarProps) {
    let keyToSend = char

    if (this.ctrlActive) {
      keyToSend = toCtrlCode(char)
      this.ctrlActive = false
    } else if (this.altActive) {
      keyToSend = toAltCode(char)
      this.altActive = false
    }

    if (props?.onKey) {
      props.onKey(keyToSend)
    }
  }

  toggleCtrl() {
    this.ctrlActive = !this.ctrlActive
  }

  toggleAlt() {
    this.altActive = !this.altActive
  }

  template(props?: ToolbarProps) {
    return (
      <div class="terminal-toolbar">
        <div class="toolbar-scroll">
          <button
            class={`toolbar-btn modifier ${this.ctrlActive ? 'active' : ''}`}
            onClick={() => this.toggleCtrl()}
          >
            CTRL
          </button>
          <button
            class={`toolbar-btn modifier ${this.altActive ? 'active' : ''}`}
            onClick={() => this.toggleAlt()}
          >
            ALT
          </button>
          <button
            class="toolbar-btn"
            onClick={() => this.handleKeyClick(KeyCodes.ESC, props)}
          >
            ESC
          </button>
          <button
            class="toolbar-btn"
            onClick={() => this.handleKeyClick(KeyCodes.TAB, props)}
          >
            TAB
          </button>

          <button
            class="toolbar-btn nav"
            onClick={() => this.handleKeyClick(KeyCodes.ARROW_UP, props)}
          >
            ↑
          </button>
          <button
            class="toolbar-btn nav"
            onClick={() => this.handleKeyClick(KeyCodes.ARROW_DOWN, props)}
          >
            ↓
          </button>
          <button
            class="toolbar-btn nav"
            onClick={() => this.handleKeyClick(KeyCodes.ARROW_LEFT, props)}
          >
            ←
          </button>
          <button
            class="toolbar-btn nav"
            onClick={() => this.handleKeyClick(KeyCodes.ARROW_RIGHT, props)}
          >
            →
          </button>

          <button
            class="toolbar-btn sym"
            onClick={() => this.handleKeyClick('|', props)}
          >
            |
          </button>
          <button
            class="toolbar-btn sym"
            onClick={() => this.handleKeyClick('/', props)}
          >
            /
          </button>
          <button
            class="toolbar-btn sym"
            onClick={() => this.handleKeyClick('-', props)}
          >
            -
          </button>
          <button
            class="toolbar-btn sym"
            onClick={() => this.handleKeyClick('~', props)}
          >
            ~
          </button>
          <button
            class="toolbar-btn sym"
            onClick={() => this.handleKeyClick('$', props)}
          >
            $
          </button>

          {/* Quick Ctrl combos */}
          <button
            class="toolbar-btn ctrl-action"
            onClick={() => this.handleKeyClick(toCtrlCode('C'), props)}
          >
            ^C
          </button>
          <button
            class="toolbar-btn ctrl-action"
            onClick={() => this.handleKeyClick(toCtrlCode('D'), props)}
          >
            ^D
          </button>
          <button
            class="toolbar-btn ctrl-action"
            onClick={() => this.handleKeyClick(toCtrlCode('Z'), props)}
          >
            ^Z
          </button>
          <button
            class="toolbar-btn ctrl-action"
            onClick={() => this.handleKeyClick(toCtrlCode('L'), props)}
          >
            ^L
          </button>

          <button
            class="toolbar-btn icon-btn"
            onClick={() => props?.onFontSizeChange(-1)}
          >
            A-
          </button>
          <button
            class="toolbar-btn icon-btn"
            onClick={() => props?.onFontSizeChange(1)}
          >
            A+
          </button>
        </div>
      </div>
    )
  }
}

