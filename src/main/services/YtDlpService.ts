import { AppError } from './AppError'
import { runCommand, type CommandFailure } from './CommandRunner'
import { resolveToolPath } from './ToolPathResolver'
import type { CookieBrowser, MediaMetadata, VideoQuality, YtDlpAuthSettings } from '../../shared/types'
import path from 'node:path'

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

type CookieMode = 'fallback' | 'merge'

const YT_DLP_SOCKET_TIMEOUT_SECONDS = 30
const YT_DLP_PROCESS_TIMEOUT_MS = 120_000
const DEFAULT_VIDEO_QUALITY: VideoQuality = '720p'
const SUPPORTED_COOKIE_BROWSERS = new Set<CookieBrowser>([
  'chrome',
  'edge',
  'firefox',
  'brave',
  'yandex',
  'vivaldi',
  'opera',
  'chromium'
])

export class YtDlpService {
  private readonly binaryPath: string
  private readonly cookieCachePath?: string

  constructor(binaryPath = resolveToolPath('YT_DLP_PATH', 'yt-dlp'), cookieCachePath?: string) {
    this.binaryPath = binaryPath
    this.cookieCachePath = cookieCachePath
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

  async fetchMetadata(url: string, auth: YtDlpAuthSettings = {}, cookieMode: CookieMode = 'fallback'): Promise<MediaMetadata> {
    const sourceUrl = this.validateYouTubeUrl(url)
    await this.assertAvailable()

    try {
      const result = await this.runWithCookieFallback(
        auth,
        cookieMode,
        (cookieArgs) =>
          runCommand(
            this.binaryPath,
            [
              '--dump-single-json',
              '--no-playlist',
              '--skip-download',
              '--no-warnings',
              '--force-ipv4',
              '--socket-timeout',
              String(YT_DLP_SOCKET_TIMEOUT_SECONDS),
              ...cookieArgs,
              sourceUrl
            ],
            YT_DLP_PROCESS_TIMEOUT_MS
          )
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
      this.rethrowAuthenticationRequired(error, 'metadata-failure', 'Не удалось получить метаданные через yt-dlp.')
      this.rethrowCookieDatabaseCopyFailure(error, 'metadata-failure', 'Не удалось получить метаданные через yt-dlp.')
      this.rethrowCookieDecryptionFailure(error, 'metadata-failure', 'Не удалось получить метаданные через yt-dlp.')
      throw new AppError(
        'metadata-failure',
        'Не удалось получить метаданные через yt-dlp.',
        this.commandDetails(error)
      )
    }
  }

  async getBestAudioUrl(url: string, auth: YtDlpAuthSettings = {}): Promise<string> {
    const sourceUrl = this.validateYouTubeUrl(url)
    await this.assertAvailable()

    try {
      const result = await this.runWithCookieFallback(
        auth,
        'fallback',
        (cookieArgs) =>
          runCommand(
            this.binaryPath,
            [
              '--format',
              'bestaudio/best',
              '--no-playlist',
              '--no-warnings',
              '--force-ipv4',
              '--socket-timeout',
              String(YT_DLP_SOCKET_TIMEOUT_SECONDS),
              ...cookieArgs,
              '--get-url',
              sourceUrl
            ],
            YT_DLP_PROCESS_TIMEOUT_MS
          )
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
      this.rethrowAuthenticationRequired(error, 'export-failure', 'Не удалось получить аудиопоток через yt-dlp.')
      this.rethrowCookieDatabaseCopyFailure(error, 'export-failure', 'Не удалось получить аудиопоток через yt-dlp.')
      this.rethrowCookieDecryptionFailure(error, 'export-failure', 'Не удалось получить аудиопоток через yt-dlp.')
      throw new AppError(
        'export-failure',
        'Не удалось получить аудиопоток через yt-dlp.',
        this.commandDetails(error)
      )
    }
  }

  async getPreviewMediaUrl(url: string, auth: YtDlpAuthSettings = {}): Promise<string> {
    const preview = await this.getPreviewMediaInfo(url, DEFAULT_VIDEO_QUALITY, auth)
    return preview.url
  }

  async getPreviewMediaInfo(
    url: string,
    videoQuality: VideoQuality = DEFAULT_VIDEO_QUALITY,
    auth: YtDlpAuthSettings = {}
  ): Promise<PreviewMediaInfo> {
    const sourceUrl = this.validateYouTubeUrl(url)
    await this.assertAvailable()

    try {
      const result = await this.runWithCookieFallback(
        auth,
        'fallback',
        (cookieArgs) =>
          runCommand(
            this.binaryPath,
            [
              '--dump-single-json',
              '--no-playlist',
              '--skip-download',
              '--no-warnings',
              '--force-ipv4',
              '--socket-timeout',
              String(YT_DLP_SOCKET_TIMEOUT_SECONDS),
              ...cookieArgs,
              '--format',
              this.videoFormatSelector(videoQuality),
              sourceUrl
            ],
            YT_DLP_PROCESS_TIMEOUT_MS
          )
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
      this.rethrowAuthenticationRequired(error, 'preview-failure', 'Не удалось подготовить preview через yt-dlp.')
      this.rethrowCookieDatabaseCopyFailure(error, 'preview-failure', 'Не удалось подготовить preview через yt-dlp.')
      this.rethrowCookieDecryptionFailure(error, 'preview-failure', 'Не удалось подготовить preview через yt-dlp.')
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

  private rethrowAuthenticationRequired(
    error: unknown,
    code: 'metadata-failure' | 'export-failure' | 'preview-failure',
    message: string
  ): void {
    const details = this.commandDetails(error)

    if (!details || !/sign in to confirm|not a bot|cookies-from-browser|cookies/i.test(details)) {
      return
    }

    throw new AppError(
      code,
      message,
      [
        'YouTube попросил подтвердить, что пользователь не бот.',
        'В приложении включите “Использовать cookies браузера”, выберите браузер, где вы вошли в YouTube, и повторите запрос.',
        'Если вход ещё не выполнен, нажмите “Открыть вход YouTube”, войдите в браузере и затем снова нажмите “Получить”.',
        details
      ].join('\n')
    )
  }

  private rethrowCookieDecryptionFailure(
    error: unknown,
    code: 'metadata-failure' | 'export-failure' | 'preview-failure',
    message: string
  ): void {
    const details = this.commandDetails(error)

    if (!details || !/failed to decrypt with dpapi|could not decrypt|failed to load cookies/i.test(details)) {
      return
    }

    throw new AppError(
      code,
      message,
      [
        'yt-dlp нашёл cookies браузера, но не смог расшифровать их через Windows DPAPI.',
        'Проверьте, что выбран правильный браузер и вход в YouTube выполнен именно в нём.',
        'Полностью закройте выбранный браузер и повторите запрос.',
        'Если используется Яндекс.Браузер: приложение передаёт его профиль как Chromium-профиль, потому что yt-dlp не поддерживает yandex как отдельное имя браузера.',
        'Если ошибка повторяется, попробуйте войти в YouTube в Edge или Chrome и выбрать этот браузер в приложении.',
        details
      ].join('\n')
    )
  }

  private rethrowCookieDatabaseCopyFailure(
    error: unknown,
    code: 'metadata-failure' | 'export-failure' | 'preview-failure',
    message: string
  ): void {
    const details = this.commandDetails(error)

    if (!details || !/could not copy .*cookie database|permission denied.*cookies|issue\/7271/i.test(details)) {
      return
    }

    throw new AppError(
      code,
      message,
      [
        'yt-dlp не смог скопировать базу cookies выбранного браузера.',
        'Обычно это происходит на Windows, когда Chromium-браузер ещё открыт и держит файл cookies заблокированным.',
        'Полностью закройте выбранный браузер, включая фоновые процессы, и повторите запрос в приложении.',
        'Если выбран Яндекс.Браузер и ошибка повторяется, попробуйте войти в YouTube через Chrome или Edge и выбрать этот браузер в приложении.',
        details
      ].join('\n')
    )
  }

  private async runWithCookieFallback<T>(
    auth: YtDlpAuthSettings,
    mode: CookieMode,
    task: (cookieArgs: string[]) => Promise<T>
  ): Promise<T> {
    const variants = this.cookieArgVariants(auth, mode)
    let lastError: unknown

    for (let index = 0; index < variants.length; index += 1) {
      try {
        return await task(variants[index])
      } catch (error) {
        if ((error as CommandFailure).code === 'ENOENT' || index === variants.length - 1) {
          throw error
        }

        lastError = error
      }
    }

    throw lastError
  }

  private cookieArgVariants(auth: YtDlpAuthSettings, mode: CookieMode): string[][] {
    if (mode === 'merge') {
      return [this.cookieArgs(auth)]
    }

    if (auth.cookiesFromBrowser && auth.cookieCacheEnabled) {
      return [this.cookieArgs({ cookiesFromBrowser: auth.cookiesFromBrowser }), this.cookieArgs({ cookieCacheEnabled: true })]
    }

    return [this.cookieArgs(auth)]
  }

  private cookieArgs(auth: YtDlpAuthSettings): string[] {
    const args: string[] = []

    if (auth.cookieCacheEnabled) {
      if (!this.cookieCachePath) {
        throw new AppError(
          'cookie-cache-failure',
          'Кэш cookies не настроен.',
          'Приложение не смогло определить локальный путь для файла cookies.'
        )
      }

      args.push('--cookies', this.cookieCachePath)
    }

    const browser = auth.cookiesFromBrowser

    if (!browser) {
      return args
    }

    if (!SUPPORTED_COOKIE_BROWSERS.has(browser)) {
      throw new AppError(
        'metadata-failure',
        'Выбранный браузер для cookies не поддерживается.',
        `Получено значение: ${browser}`
      )
    }

    args.push('--cookies-from-browser', this.cookiesFromBrowserValue(browser))
    return args
  }

  private cookiesFromBrowserValue(browser: CookieBrowser): string {
    if (browser !== 'yandex') {
      return browser
    }

    const localAppData = process.env.LOCALAPPDATA

    if (!localAppData) {
      throw new AppError(
        'metadata-failure',
        'Не удалось найти профиль Яндекс.Браузера.',
        'Переменная окружения LOCALAPPDATA недоступна.'
      )
    }

    return `chromium:${path.join(localAppData, 'Yandex', 'YandexBrowser', 'User Data', 'Default')}`
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
