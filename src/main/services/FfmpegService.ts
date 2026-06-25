import { AppError } from './AppError'
import { runCommand, type CommandFailure } from './CommandRunner'
import { resolveToolPath } from './ToolPathResolver'

export class FfmpegService {
  private readonly binaryPath: string

  constructor(binaryPath = resolveToolPath('FFMPEG_PATH', 'ffmpeg')) {
    this.binaryPath = binaryPath
  }

  async isAvailable(): Promise<boolean> {
    try {
      await runCommand(this.binaryPath, ['-version'], 10_000)
      return true
    } catch {
      return false
    }
  }

  async assertAvailable(): Promise<void> {
    try {
      await runCommand(this.binaryPath, ['-version'], 10_000)
    } catch (error) {
      throw this.missingBinaryError(error)
    }
  }

  async exportMp3(
    inputUrl: string,
    startSeconds: number,
    endSeconds: number,
    outputPath: string
  ): Promise<void> {
    await this.assertAvailable()

    const durationSeconds = endSeconds - startSeconds

    try {
      await runCommand(
        this.binaryPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          String(startSeconds),
          '-i',
          inputUrl,
          '-t',
          String(durationSeconds),
          '-vn',
          '-codec:a',
          'libmp3lame',
          '-q:a',
          '2',
          outputPath
        ],
        180_000
      )
    } catch (error) {
      this.rethrowMissingBinary(error)
      throw new AppError(
        'export-failure',
        'ffmpeg не смог экспортировать выбранный MP3-фрагмент.',
        this.commandDetails(error)
      )
    }
  }

  async exportMp4(
    inputUrl: string,
    startSeconds: number,
    endSeconds: number,
    outputPath: string,
    inputHeaders: Record<string, string> = {}
  ): Promise<void> {
    await this.assertAvailable()

    const durationSeconds = endSeconds - startSeconds

    try {
      await runCommand(
        this.binaryPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          ...this.headerArgs(inputHeaders),
          '-ss',
          String(startSeconds),
          '-i',
          inputUrl,
          '-t',
          String(durationSeconds),
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-movflags',
          '+faststart',
          outputPath
        ],
        300_000
      )
    } catch (error) {
      this.rethrowMissingBinary(error)
      throw new AppError(
        'export-failure',
        'ffmpeg не смог экспортировать выбранный MP4-фрагмент.',
        this.commandDetails(error)
      )
    }
  }

  private headerArgs(headers: Record<string, string>): string[] {
    const headerLines = Object.entries(headers)
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => `${name}: ${value}`)

    return headerLines.length ? ['-headers', `${headerLines.join('\r\n')}\r\n`] : []
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

  private missingBinaryError(error?: unknown): AppError {
    return new AppError(
      'missing-ffmpeg',
      'Не найден ffmpeg.',
      [
        `Приложение пыталось запустить: ${this.binaryPath}`,
        'Проверьте `npm run check:tools` и команду `ffmpeg -version` в PowerShell.',
        'Если бинарник лежит не в PATH, задайте переменную окружения FFMPEG_PATH перед запуском приложения.',
        this.commandDetails(error)
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
}
