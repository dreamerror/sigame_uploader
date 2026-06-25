export interface MediaMetadata {
  sourceUrl: string
  title: string
  durationSeconds: number
  thumbnailUrl?: string
}

export type VideoQuality = '360p' | '480p' | '720p' | '1080p' | 'best'

export interface MediaCutRequest {
  sourceUrl: string
  startTimestamp: string
  endTimestamp: string
  outputDirectory: string
  outputFileName?: string
  outputFormat?: 'mp3' | 'mp4'
  videoQuality?: VideoQuality
  sourceDurationSeconds?: number
}

export interface ExportResult {
  outputPath: string
}

export interface ThumbnailDownloadRequest {
  thumbnailUrl: string
  outputDirectory: string
  outputFileName?: string
}

export interface ThumbnailDownloadResult {
  outputPath: string
}

export interface PreviewResult {
  previewUrl: string
  sourceUrl: string
}

export interface ToolStatus {
  ytDlp: boolean
  ffmpeg: boolean
  ffprobe: boolean
}

export type AppErrorCode =
  | 'missing-yt-dlp'
  | 'missing-ffmpeg'
  | 'missing-ffprobe'
  | 'invalid-url'
  | 'invalid-timestamps'
  | 'export-failure'
  | 'thumbnail-failure'
  | 'metadata-failure'
  | 'preview-failure'
  | 'folder-selection-cancelled'
  | 'unexpected-error'

export interface AppErrorPayload {
  code: AppErrorCode
  message: string
  details?: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload }

export interface SigameApi {
  checkTools(): Promise<ApiResult<ToolStatus>>
  fetchMetadata(url: string): Promise<ApiResult<MediaMetadata>>
  preparePreview(url: string): Promise<ApiResult<PreviewResult>>
  selectOutputFolder(): Promise<ApiResult<string>>
  exportClip(request: MediaCutRequest): Promise<ApiResult<ExportResult>>
  downloadThumbnail(request: ThumbnailDownloadRequest): Promise<ApiResult<ThumbnailDownloadResult>>
}
