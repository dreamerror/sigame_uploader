/// <reference types="vite/client" />

import type { SigameApi } from '../../shared/types'

declare global {
  interface Window {
    sigameApi: SigameApi
  }
}

