import fs from 'node:fs/promises'
import path from 'node:path'
import type { CookieCacheStatus } from '../../shared/types'

export class CookieCacheService {
  private readonly cookieFilePath: string

  constructor(userDataPath: string) {
    this.cookieFilePath = path.join(userDataPath, 'cookies', 'youtube-cookies.txt')
  }

  getCookieFilePath(): string {
    return this.cookieFilePath
  }

  async ensureDirectory(): Promise<void> {
    await fs.mkdir(path.dirname(this.cookieFilePath), { recursive: true })
  }

  async getStatus(): Promise<CookieCacheStatus> {
    try {
      const stats = await fs.stat(this.cookieFilePath)

      return {
        exists: stats.isFile(),
        updatedAt: stats.mtime.toISOString()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }

      return {
        exists: false
      }
    }
  }

  async clear(): Promise<CookieCacheStatus> {
    try {
      await fs.unlink(this.cookieFilePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    return this.getStatus()
  }
}
