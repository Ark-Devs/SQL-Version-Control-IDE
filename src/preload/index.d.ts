import type { PreloadApi } from './index'

declare global {
  interface Window {
    svcide: PreloadApi
  }
}

export {}
