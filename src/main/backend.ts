import { app } from 'electron'
import { spawn, spawnSync, ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { join, resolve } from 'path'

export interface BackendInfo {
  port: number
  token: string
  ready: boolean
}

let proc: ChildProcess | null = null
let info: BackendInfo = { port: 0, token: '', ready: false }

const HANDSHAKE_TIMEOUT_MS = 15000

function backendExePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'backend', 'svcide-backend.exe')
  }
  return resolve(app.getAppPath(), 'backend', 'bin', 'svcide-backend.exe')
}

/** In dev, (re)build the Go backend so we always run current code. */
function ensureDevBuild(): void {
  const backendDir = resolve(app.getAppPath(), 'backend')
  const out = join(backendDir, 'bin', 'svcide-backend.exe')
  const res = spawnSync('go', ['build', '-o', out, './cmd/svcide-backend'], {
    cwd: backendDir,
    encoding: 'utf8',
    windowsHide: true
  })
  if (res.status !== 0) {
    throw new Error(`go build failed:\n${res.stderr || res.stdout || res.error?.message}`)
  }
}

export function getBackendInfo(): BackendInfo {
  return info
}

export async function startBackend(): Promise<BackendInfo> {
  if (!app.isPackaged) {
    ensureDevBuild()
  }
  const exe = backendExePath()
  if (!existsSync(exe)) {
    throw new Error(`Backend executable not found: ${exe}`)
  }

  const token = randomBytes(32).toString('hex')

  proc = spawn(exe, [], {
    env: {
      ...process.env,
      SVCIDE_TOKEN: token,
      SVCIDE_PARENT_PID: String(process.pid)
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  proc.stderr?.on('data', (d: Buffer) => {
    console.error(`[backend] ${d.toString().trimEnd()}`)
  })
  proc.on('exit', (code) => {
    info = { ...info, ready: false }
    console.error(`[backend] exited with code ${code}`)
  })

  const port = await new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Backend handshake timed out')),
      HANDSHAKE_TIMEOUT_MS
    )
    let buf = ''
    proc!.stdout!.on('data', (d: Buffer) => {
      buf += d.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (msg.event === 'ready' && typeof msg.port === 'number') {
            clearTimeout(timer)
            resolvePort(msg.port)
            return
          }
        } catch {
          console.log(`[backend] ${line}`)
        }
      }
    })
    proc!.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc!.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Backend exited during startup (code ${code})`))
    })
  })

  info = { port, token, ready: true }
  return info
}

export async function stopBackend(): Promise<void> {
  if (!proc || proc.exitCode !== null) return
  const p = proc
  try {
    await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(3000)
    })
  } catch {
    // fall through to kill
  }
  await new Promise<void>((res) => {
    const t = setTimeout(() => {
      try {
        p.kill()
      } catch {
        /* already gone */
      }
      res()
    }, 3000)
    p.on('exit', () => {
      clearTimeout(t)
      res()
    })
    if (p.exitCode !== null) {
      clearTimeout(t)
      res()
    }
  })
  proc = null
  info = { ...info, ready: false }
}
