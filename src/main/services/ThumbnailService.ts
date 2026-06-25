import { createWriteStream } from 'node:fs'
import { access, mkdir, unlink } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ThumbnailDownloadRequest, ThumbnailDownloadResult } from '../../shared/types'
import { AppError } from './AppError'

const MAX_REDIRECTS = 5

export class ThumbnailService {
  async downloadThumbnail(request: ThumbnailDownloadRequest): Promise<ThumbnailDownloadResult> {
    if (!request.thumbnailUrl.trim()) {
      throw new AppError('thumbnail-failure', 'У этого медиа нет доступного thumbnail.')
    }

    if (!request.outputDirectory.trim()) {
      throw new AppError('thumbnail-failure', 'Перед скачиванием thumbnail выберите папку для сохранения.')
    }

    const outputDirectory = path.resolve(request.outputDirectory)
    await this.ensureOutputDirectory(outputDirectory)

    const response = await this.openThumbnailResponse(request.thumbnailUrl, 0)
    const extension = this.extensionFromResponse(request.thumbnailUrl, response.headers['content-type'])
    const outputPath = path.join(outputDirectory, `${this.safeBaseName(request.outputFileName)}${extension}`)

    try {
      await pipeline(response, createWriteStream(outputPath))
      return { outputPath }
    } catch (error) {
      await unlink(outputPath).catch(() => undefined)
      throw new AppError('thumbnail-failure', 'Не удалось сохранить thumbnail в выбранную папку.', String(error))
    }
  }

  private async openThumbnailResponse(url: string, redirectCount: number): Promise<http.IncomingMessage> {
    if (redirectCount > MAX_REDIRECTS) {
      throw new AppError('thumbnail-failure', 'Слишком много перенаправлений при скачивании thumbnail.')
    }

    let parsed: URL

    try {
      parsed = new URL(url)
    } catch {
      throw new AppError('thumbnail-failure', 'Некорректная ссылка на thumbnail.')
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new AppError('thumbnail-failure', 'Thumbnail должен быть доступен по HTTP или HTTPS.')
    }

    const client = parsed.protocol === 'https:' ? https : http

    return new Promise((resolve, reject) => {
      const request = client.get(
        parsed,
        {
          headers: {
            'User-Agent': 'SiGame Media Cutter'
          },
          timeout: 60_000
        },
        (response) => {
          const statusCode = response.statusCode ?? 0
          const location = response.headers.location

          if (statusCode >= 300 && statusCode < 400 && location) {
            response.resume()
            const nextUrl = new URL(location, parsed).toString()
            this.openThumbnailResponse(nextUrl, redirectCount + 1).then(resolve, reject)
            return
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume()
            reject(new AppError('thumbnail-failure', `Не удалось скачать thumbnail. HTTP ${statusCode}.`))
            return
          }

          resolve(response)
        }
      )

      request.on('timeout', () => {
        request.destroy(new AppError('thumbnail-failure', 'Скачивание thumbnail остановлено по таймауту.'))
      })

      request.on('error', reject)
    })
  }

  private async ensureOutputDirectory(outputDirectory: string): Promise<void> {
    try {
      await mkdir(outputDirectory, { recursive: true })
      await access(outputDirectory)
    } catch (error) {
      throw new AppError('thumbnail-failure', 'Выбранную папку для сохранения нельзя использовать.', String(error))
    }
  }

  private extensionFromResponse(sourceUrl: string, contentType: string | string[] | undefined): string {
    const normalizedContentType = Array.isArray(contentType) ? contentType[0] : contentType

    if (normalizedContentType?.includes('image/png')) {
      return '.png'
    }

    if (normalizedContentType?.includes('image/webp')) {
      return '.webp'
    }

    if (normalizedContentType?.includes('image/jpeg') || normalizedContentType?.includes('image/jpg')) {
      return '.jpg'
    }

    try {
      const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase()

      if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
        return extension === '.jpeg' ? '.jpg' : extension
      }
    } catch {
      return '.jpg'
    }

    return '.jpg'
  }

  private safeBaseName(value?: string): string {
    const fallback = `sigame_thumbnail_${new Date().toISOString().replace(/[:.]/g, '-')}`
    const candidate = (value || fallback)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90)

    return candidate || fallback
  }
}
