import type { AppErrorCode } from '../../shared/types'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly details?: string

  constructor(code: AppErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

