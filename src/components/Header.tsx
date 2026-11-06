import { Component, type GeaElement } from '@geastack/core'

export interface HeaderProps {
  pid: number
  shell: string
  alive: boolean
  cols: number
  rows: number
  onRestart: () => void
  onToggleTheme: () => void
  currentTheme: string
}

export class Header extends Component<GeaElement, HeaderProps> {
  template(props?: HeaderProps) {
    const alive = props?.alive ?? true
    const pid = props?.pid ?? 0
    const shell = props?.shell || '/bin/bash'
    const cols = props?.cols ?? 80
    const rows = props?.rows ?? 24
    const theme = props?.currentTheme || 'silica'

    return (
      <div class="terminal-header">
        <div class="header-left">
          <span class="app-logo">FiTerm</span>
          <span class={`status-dot ${alive ? 'online' : 'offline'}`} />
          <span class="session-info">
            {alive ? `PID ${pid}` : 'Exited'} · {shell.split('/').pop()} · {cols}x{rows}
          </span>
        </div>
        <div class="header-actions">
          <button
            class="header-btn"
            onClick={() => props?.onToggleTheme()}
          >
            {theme === 'silica' ? 'Theme: Silica' : theme === 'matrix' ? 'Theme: Matrix' : theme === 'amber' ? 'Theme: Amber' : 'Theme: Dracula'}
          </button>
          <button
            class="header-btn restart"
            onClick={() => props?.onRestart()}
          >
            Restart
          </button>
        </div>
      </div>
    )
  }
}

