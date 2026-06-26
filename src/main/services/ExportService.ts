import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ExportResult, MediaCutRequest } from '../../shared/types'
import { AppError } from './AppError'
import { FfmpegService } from './FfmpegService'
import { MediaProbeService } from './MediaProbeService'
import { validateCutRange } from './timestamps'
import { YtDlpService } from './YtDlpService'

export class ExportService {
  constructor(
    private readonly ytDlpService: YtDlpService,
    private readonly ffmpegService: FfmpegService,
    private readonly mediaProbeService: MediaProbeService
  ) {}

  async exportClip(request: MediaCutRequest): Promise<ExportResult> {
    const sourceUrl = this.ytDlpService.validateYouTubeUrl(request.sourceUrl)
    const outputFormat = request.outputFormat ?? 'mp3'
    const { startSeconds, endSeconds } = validateCutRange(request.startTimestamp, request.endTimestamp, {
      durationSeconds: request.sourceDurationSeconds
    })

    if (!request.outputDirectory.trim()) {
      throw new AppError('export-failure', 'Перед экспортом выберите папку для сохранения.')
    }

    const outputDirectory = path.resolve(request.outputDirectory)
    await this.ensureOutputDirectory(outputDirectory)

    await this.mediaProbeService.assertAvailable()

    if (outputFormat === 'mp4') {
      const previewMedia = await this.ytDlpService.getPreviewMediaInfo(sourceUrl, request.videoQuality, request.auth)
      const probedDuration = await this.mediaProbeService.getDurationSeconds(previewMedia.url, previewMedia.httpHeaders)

      validateCutRange(request.startTimestamp, request.endTimestamp, { durationSeconds: probedDuration })

      const outputPath = path.join(outputDirectory, `${this.safeBaseName(request.outputFileName)}.mp4`)
      await this.ffmpegService.exportMp4(
        previewMedia.url,
        startSeconds,
        endSeconds,
        outputPath,
        previewMedia.httpHeaders
      )

      return { outputPath }
    }

    const streamUrl = await this.ytDlpService.getBestAudioUrl(sourceUrl, request.auth)
    const probedDuration = await this.mediaProbeService.getDurationSeconds(streamUrl)

    validateCutRange(request.startTimestamp, request.endTimestamp, { durationSeconds: probedDuration })

    const outputPath = path.join(outputDirectory, `${this.safeBaseName(request.outputFileName)}.mp3`)
    await this.ffmpegService.exportMp3(streamUrl, startSeconds, endSeconds, outputPath)

    return { outputPath }
  }

  private async ensureOutputDirectory(outputDirectory: string): Promise<void> {
    try {
      await mkdir(outputDirectory, { recursive: true })
      await access(outputDirectory)
    } catch (error) {
      throw new AppError('export-failure', 'Выбранную папку для сохранения нельзя использовать.', String(error))
    }
  }

  private safeBaseName(value?: string): string {
    const fallback = `sigame_clip_${new Date().toISOString().replace(/[:.]/g, '-')}`
    const candidate = (value || fallback)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90)

    return candidate || fallback
  }
}
