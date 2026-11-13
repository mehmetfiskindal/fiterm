// Host bridge to native C++ fitermHostInvoke or mock fallback in dev

declare function fitermHostInvoke(method: string, payload: string): string

export interface PtySpawnResult {
  pid: number
  shell: string
  cwd: string
  rows: number
  cols: number
}

export interface PtyReadResult {
  alive: boolean
  bytes: number
  b64: string
  text: string
}

export interface PlatformInfo {
  platform: string
  user: string
  home: string
  shell: string
  alive: boolean
}

export class NativeBridge {
  static isAvailable(): boolean {
    return typeof fitermHostInvoke === 'function'
  }

  static invoke<T = any>(method: string, payload: Record<string, any> = {}): { ok: boolean; data?: T; error?: string } {
    if (!this.isAvailable()) {
      return MockBridge.handle(method, payload)
    }

    try {
      const raw = fitermHostInvoke(method, JSON.stringify(payload))
      const res = JSON.parse(raw)
      if (!res.ok) console.log('[fiterm.js] ' + method + ' failed: ' + res.error)
      return res
    } catch (err: any) {
      console.log('[fiterm.js] ' + method + ' threw: ' + (err?.message || 'unknown'))
      return { ok: false, error: err?.message || 'Host call failed' }
    }
  }

  static spawn(rows = 24, cols = 80, cwd?: string, shell?: string): PtySpawnResult | null {
    const res = this.invoke<PtySpawnResult>('pty.spawn', { rows, cols, cwd, shell })
    return res.ok && res.data ? res.data : null
  }

  static read(): PtyReadResult {
    const res = this.invoke<PtyReadResult>('pty.read', {})
    if (res.ok && res.data) {
      return res.data
    }
    return { alive: false, bytes: 0, b64: '', text: '' }
  }

  static write(data: string, isBase64 = false): boolean {
    const res = this.invoke('pty.write', { data, isBase64 })
    return res.ok
  }

  static resize(rows: number, cols: number): boolean {
    const res = this.invoke('pty.resize', { rows, cols })
    return res.ok
  }

  static signal(signal = 'SIGINT'): boolean {
    const res = this.invoke('pty.signal', { signal })
    return res.ok
  }

  static close(): boolean {
    const res = this.invoke('pty.close', {})
    return res.ok
  }

  static getInfo(): PlatformInfo {
    const res = this.invoke<PlatformInfo>('platform.info', {})
    if (res.ok && res.data) {
      return res.data
    }
    return {
      platform: 'web-simulation',
      user: 'defaultuser',
      home: '/home/defaultuser',
      shell: '/bin/bash',
      alive: true
    }
  }
}

// Built-in interactive mock shell for web preview and test environments
class MockBridge {
  private static mockOutput = `\x1b[1;36mFiTerm\x1b[0m — Sailfish OS Terminal Emulator (Web Simulation Mode)
Sailfish OS 5.1.0.11 (Pispala) aarch64
Type '\x1b[1;32mhelp\x1b[0m' or standard shell commands.

\x1b[1;32mdefaultuser@RedmiNote8\x1b[0m:\x1b[1;34m~\x1b[0m$ `
  private static buffer = ''

  static handle(method: string, payload: Record<string, any>): { ok: boolean; data?: any; error?: string } {
    switch (method) {
      case 'pty.spawn':
        this.mockOutput = `\x1b[1;36mFiTerm\x1b[0m — Sailfish OS Terminal Emulator (Simulation Mode)
Sailfish OS 5.1.0.11 (Pispala) aarch64
Type '\x1b[1;32mhelp\x1b[0m' or standard shell commands.

\x1b[1;32mdefaultuser@RedmiNote8\x1b[0m:\x1b[1;34m~\x1b[0m$ `
        return {
          ok: true,
          data: {
            pid: 1337,
            shell: '/bin/bash',
            cwd: '/home/defaultuser',
            rows: payload.rows || 24,
            cols: payload.cols || 80
          }
        }

      case 'pty.read': {
        const out = this.mockOutput
        this.mockOutput = ''
        return {
          ok: true,
          data: {
            alive: true,
            bytes: out.length,
            b64: '',
            text: out
          }
        }
      }

      case 'pty.write': {
        const input = payload.data || ''
        if (input === '\r' || input === '\n') {
          const cmd = this.buffer.trim()
          this.buffer = ''
          this.mockOutput += '\r\n' + this.executeMockCommand(cmd) + '\r\n\x1b[1;32mdefaultuser@RedmiNote8\x1b[0m:\x1b[1;34m~\x1b[0m$ '
        } else if (input === '\x7f' || input === '\b') {
          if (this.buffer.length > 0) {
            this.buffer = this.buffer.slice(0, -1)
            this.mockOutput += '\b \b'
          }
        } else if (input === '\x03') { // Ctrl+C
          this.buffer = ''
          this.mockOutput += '^C\r\n\x1b[1;32mdefaultuser@RedmiNote8\x1b[0m:\x1b[1;34m~\x1b[0m$ '
        } else if (input === '\x0c') { // Ctrl+L
          this.mockOutput += '\x1b[2J\x1b[H\x1b[1;32mdefaultuser@RedmiNote8\x1b[0m:\x1b[1;34m~\x1b[0m$ ' + this.buffer
        } else {
          this.buffer += input
          this.mockOutput += input
        }
        return { ok: true, data: { written: input.length } }
      }

      case 'input.mode':
      case 'clipboard.set':
      case 'clipboard.paste':
      case 'url.open':
      case 'display.rotate':
      case 'keyboard.toggle':
      case 'pty.resize':
      case 'pty.signal':
      case 'pty.close':
        return { ok: true, data: {} }

      case 'platform.info':
        return {
          ok: true,
          data: {
            platform: 'web-simulation',
            user: 'defaultuser',
            home: '/home/defaultuser',
            shell: '/bin/bash',
            alive: true
          }
        }

      default:
        return { ok: false, error: 'Unknown method' }
    }
  }

  private static executeMockCommand(cmd: string): string {
    const parts = cmd.split(' ')
    const verb = parts[0]
    switch (verb) {
      case '':
        return ''
      case 'help':
        return 'Available commands: ls, uname, whoami, pwd, clear, date, echo, ps, top, exit'
      case 'ls':
        return '\x1b[1;34mDesktop  Documents  Downloads  Music  Pictures  Videos  fiterm  fiotp-multiplatform\x1b[0m'
      case 'uname':
        return 'Linux RedmiNote8 4.14.98-CheeseCream+ #1 SMP PREEMPT aarch64 GNU/Linux'
      case 'whoami':
        return 'defaultuser'
      case 'pwd':
        return '/home/defaultuser'
      case 'date':
        return new Date().toString()
      case 'echo':
        return parts.slice(1).join(' ')
      case 'clear':
        return '\x1b[2J\x1b[H'
      case 'top':
      case 'htop':
        return '\x1b[1;37;44m PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND \x1b[0m\r\n 1337 defaultu  20   0  128.4m  14.2m   8.1m S   0.8   0.4   0:01.24 fiterm'
      default:
        return `bash: ${verb}: command not found`
    }
  }
}
