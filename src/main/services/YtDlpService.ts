import { AppError } from './AppError'
import { runCommand, type CommandFailure } from './CommandRunner'
import { resolveToolPath } from './ToolPathResolver'
import type { MediaMetadata, VideoQuality } from '../../shared/types'

interface YtDlpMetadata {
  title?: string
  duration?: number
  thumbnail?: string
  thumbnails?: Array<{ url?: string }>
}

interface YtDlpPreviewInfo {
  url?: string
  http_headers?: Record<string, string>
  requested_formats?: Array<{
    url?: string
    http_headers?: Record<string, string>
    vcodec?: string
    acodec?: string
  }>
}

export interface PreviewMediaInfo {
  url: string
  httpHeaders: Record<string, string>
}

const YT_DLP_SOCKET_TIMEOUT_SECONDS = 30
const YT_DLP_PROCESS_TIMEOUT_MS = 120_000
const DEFAULT_VIDEO_QUALITY: VideoQuality = '720p'

export class YtDlpService {
  private readonly binaryPath: string

  constructor(binaryPath = resolveToolPath('YT_DLP_PATH', 'yt-dlp')) {
    this.binaryPath = binaryPath
  }

  async isAvailable(): Promise<boolean> {
    try {
      await runCommand(this.binaryPath, ['--version'], 10_000)
      return true
    } catch {
      return false
    }
  }

  async assertAvailable(): Promise<void> {
    try {
      await runCommand(this.binaryPath, ['--version'], 10_000)
    } catch (error) {
      throw this.missingBinaryError(error)
    }
  }

  validateYouTubeUrl(value: string): string {
    let parsed: URL

    try {
      parsed = new URL(value.trim())
    } catch {
      throw new AppError('invalid-url', 'Введите корректную ссылку YouTube.')
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const allowedHosts = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'])

    if (!['http:', 'https:'].includes(parsed.protocol) || !allowedHosts.has(host)) {
      throw new AppError('invalid-url', 'В этом MVP поддерживаются только ссылки YouTube.')
    }

    return parsed.toString()
  }

  async fetchMetadata(url: string): Promise<MediaMetadata> {
    const sourceUrl = this.validateYouTubeUrl(url)
    await this.assertAvailable()

    try {
      const result = await runCommand(
        this.binaryPath,
        [
          '--dump-single-json',
          '--no-playlist',
          '--skip-download',
          '--no-warnings',
          '--force-ipv4',
          '--socket-timeout',
          String(YT_DLP_SOCKET_TIMEOUT_SECONDS),
          sourceUrl
        ],
        YT_DLP_PROCESS_TIMEOUT_MS
      )
      const payload = JSON.parse(result.stdout) as YtDlpMetadata
      const thumbnailUrl = payload.thumbnail || this.lastThumbnailUrl(payload.thumbnails)

      return {
        sourceUrl,
        title: payload.title || 'YouTube-медиа без названия',
        durationSeconds: typeof payload.duration === 'number' ? payload.duration : 0,
        thumbnailUrl
      }
    } catch (error) {
      this.rethrowMissingBinary(error)
      this.rethrowTimeout(error, 'metadata-failure', 'yt-dlp слишком долго получает метаданные.')
      throw new AppError(
        'metadata-failure',
        'Не удалось получить метаданные через yt-dlp.',
        this.commandDetails(error)
      )
    }
  }

  async getBestAudioUrl(url: string): Promise<string> {
    const sourceUrl = this.validateYouTubeUrl(url)
    await this.assertAvailable()

    try {
      const result = await runCommand(
        this.binaryPath,
        [
          '--format',
          'bestaudio/best',
          '--no-playlist',
          '--no-warnings',
          '--force-ipv4',
          '--socket-timeout',
          String(YT_DLP_SOCKET_TIMEOUT_SECONDS),
          '--get-url',
          sourceUrl
        ],
        YT_DLP_PROCESS_TIMEOUT_MS
      )
      const streamUrl = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)

      if (!streamUrl) {
        throw new AppError('export-failure', 'yt-dlp не вернул пригодную ссылку на медиапоток.')
      }

      return streamUrl
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }

      this.rethrowMissingBinary(error)
      this.rethrowTimeout(error, 'export-failure', 'yt-dlp слишком долго получает аудиопоток.')
      throw new AppError(
        'export-failure',
        'Не удалось получить аудиопоток через yt-dlp.',
        this.commandDetails(error)
      )
    }
  }

  async getPreviewMediaUrl(url: string): Promise<string> {
    const preview = await this.getPreviewMediaInfo(url)
    return preview.url
  }

  async getPreviewMediaInfo(url: string, videoQuality: VideoQuality = DEFAULT_VIDEO_QUALITY): Promise<PreviewMediaInfo> {
    const sourceUrl = this.validateYouTubeUrl(url)
    await this.assertAvailable()

    try {
      const result = await runCommand(
        this.binaryPath,
        [
          '--dump-single-json',
          '--no-playlist',
          '--skip-download',
          '--no-warnings',
          '--force-ipv4',
          '--socket-timeout',
          String(YT_DLP_SOCKET_TIMEOUT_SECONDS),
          '--format',
          this.videoFormatSelector(videoQuality),
          sourceUrl
        ],
        YT_DLP_PROCESS_TIMEOUT_MS
      )
      const payload = JSON.parse(result.stdout) as YtDlpPreviewInfo
      const requestedFormat = payload.requested_formats?.find(
        (format) => format.url && format.vcodec !== 'none' && format.acodec !== 'none'
      )
      const previewUrl = payload.url || requestedFormat?.url

      if (!previewUrl) {
        throw new AppError('preview-failure', 'yt-dlp не вернул ссылку для preview.')
      }

      return {
        url: previewUrl,
        httpHeaders: {
          ...(payload.http_headers ?? {}),
          ...(requestedFormat?.http_headers ?? {})
        }
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }

      this.rethrowMissingBinary(error)
      this.rethrowTimeout(error, 'preview-failure', 'yt-dlp слишком долго готовит preview.')
      throw new AppError(
        'preview-failure',
        'Не удалось подготовить preview через yt-dlp.',
        this.commandDetails(error)
      )
    }
  }

  private rethrowMissingBinary(error: unknown): void {
    if ((error as CommandFailure).code === 'ENOENT') {
      throw this.missingBinaryError(error)
    }
  }

  private commandDetails(error: unknown): string | undefined {
    const failure = error as CommandFailure
    return failure.stderr || failure.stdout || failure.message
  }

  private rethrowTimeout(
    error: unknown,
    code: 'metadata-failure' | 'export-failure' | 'preview-failure',
    message: string
  ): void {
    if ((error as CommandFailure).code === 'ETIMEDOUT') {
      throw new AppError(
        code,
        message,
        [
          'Проверьте интернет-соединение, VPN и доступность YouTube.',
          `Запрос к yt-dlp был остановлен по таймауту ${Math.round(YT_DLP_PROCESS_TIMEOUT_MS / 1000)} секунд.`,
          'Для диагностики запустите: npm run debug:metadata -- "ССЫЛКА_YOUTUBE"'
        ].join('\n')
      )
    }
  }

  private missingBinaryError(error?: unknown): AppError {
    return new AppError(
      'missing-yt-dlp',
      'Не найден yt-dlp.',
      [
        `Приложение пыталось запустить: ${this.binaryPath}`,
        'Проверьте `npm run check:tools` и команду `yt-dlp --version` в PowerShell.',
        'Если бинарник лежит не в PATH, задайте переменную окружения YT_DLP_PATH перед запуском приложения.',
        this.commandDetails(error)
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  private lastThumbnailUrl(thumbnails?: Array<{ url?: string }>): string | undefined {
    if (!thumbnails) {
      return undefined
    }

    for (let index = thumbnails.length - 1; index >= 0; index -= 1) {
      if (thumbnails[index].url) {
        return thumbnails[index].url
      }
    }

    return undefined
  }

  private videoFormatSelector(videoQuality: VideoQuality): string {
    if (videoQuality === 'best') {
      return 'best[protocol=https][ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]'
    }

    const maxHeight = Number(videoQuality.replace('p', ''))

    return [
      `best[protocol=https][ext=mp4][vcodec!=none][acodec!=none][height<=${maxHeight}]`,
      `best[ext=mp4][vcodec!=none][acodec!=none][height<=${maxHeight}]`,
      'best[protocol=https][ext=mp4][vcodec!=none][acodec!=none]',
      'best[ext=mp4][vcodec!=none][acodec!=none]',
      'best[vcodec!=none][acodec!=none]'
    ].join('/')
  }
}
