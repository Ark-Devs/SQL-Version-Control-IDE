let baseUrl = ''
let token = ''

/** Resolve backend {port, token}, waiting for the ready event if needed. */
export async function initApi(): Promise<void> {
  const info = await new Promise<{ port: number; token: string }>((resolve, reject) => {
    window.svcide.onBackendReady((i) => resolve(i))
    window.svcide.onBackendError((err) => reject(new Error(err)))
    window.svcide.getBackendInfo().then((i) => {
      if (i.ready) resolve(i)
    })
  })
  baseUrl = `http://127.0.0.1:${info.port}/api`
  token = info.token
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const data = await res.json()
      if (data.error) msg = data.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export const get = <T>(path: string): Promise<T> => request<T>('GET', path)
export const post = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body)
export const put = <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body)
export const del = <T>(path: string): Promise<T> => request<T>('DELETE', path)
