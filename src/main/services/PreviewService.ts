import type { PreviewResult } from '../../shared/types'
import { PreviewProxyService } from './PreviewProxyService'
import { YtDlpService } from './YtDlpService'

export class PreviewService {
  constructor(
    private readonly ytDlpService: YtDlpService,
    private readonly previewProxyService: PreviewProxyService
  ) {}

  async preparePreview(url: string): Promise<PreviewResult> {
    const sourceUrl = this.ytDlpService.validateYouTubeUrl(url)
    const previewMedia = await this.ytDlpService.getPreviewMediaInfo(sourceUrl)
    const previewUrl = await this.previewProxyService.registerTarget({
      mediaUrl: previewMedia.url,
      httpHeaders: previewMedia.httpHeaders
    })

    return {
      sourceUrl,
      previewUrl
    }
  }
}
