import { AppError } from './AppError'
import { runCommand, type CommandFailure } from './CommandRunner'
import { resolveToolPath } from './ToolPathResolver'

export class MediaProbeService {
  private readonly binaryPath: string

  constructor(binaryPath = resolveToolPath('FFPROBE_PATH', 'ffprobe')) {
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

  async getDurationSeconds(inputUrl: string, inputHeaders: Record<string, string> = {}): Promise<number | undefined> {
    await this.assertAvailable()

    try {
      const result = await runCommand(
        this.binaryPath,
        [
          '-v',
          'error',
          ...this.headerArgs(inputHeaders),
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          inputUrl
        ],
        60_000
      )
      const duration = Number(result.stdout.trim())
      return Number.isFinite(duration) ? duration : undefined
    } catch (error) {
      this.rethrowMissingBinary(error)
      return undefined
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

  private missingBinaryError(error?: unknown): AppError {
    return new AppError(
      'missing-ffprobe',
      'Не найден ffprobe.',
      [
        `Приложение пыталось запустить: ${this.binaryPath}`,
        'ffprobe обычно устанавливается вместе с ffmpeg.',
        'Проверьте `npm run check:tools` и команду `ffprobe -version` в PowerShell.',
        'Если бинарник лежит не в PATH, задайте переменную окружения FFPROBE_PATH перед запуском приложения.',
        (error as CommandFailure | undefined)?.stderr || (error as CommandFailure | undefined)?.message
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
}
