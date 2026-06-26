export interface MediaMetadata {
  sourceUrl: string
  title: string
  durationSeconds: number
  thumbnailUrl?: string
}

export type VideoQuality = '360p' | '480p' | '720p' | '1080p' | 'best'
export type CookieBrowser = 'chrome' | 'edge' | 'firefox' | 'brave' | 'vivaldi' | 'opera' | 'chromium' | 'yandex'

export interface YtDlpAuthSettings {
  cookiesFromBrowser?: CookieBrowser
  cookieCacheEnabled?: boolean
}

export interface MediaMetadataRequest {
  url: string
  auth?: YtDlpAuthSettings
}

export interface PreviewRequest {
  url: string
  auth?: YtDlpAuthSettings
}

export interface MediaCutRequest {
  sourceUrl: string
  startTimestamp: string
  endTimestamp: string
  outputDirectory: string
  outputFileName?: string
  outputFormat?: 'mp3' | 'mp4'
  videoQuality?: VideoQuality
  sourceDurationSeconds?: number
  auth?: YtDlpAuthSettings
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

export interface CookieCacheStatus {
  exists: boolean
  updatedAt?: string
}

export interface CookieCacheRefreshRequest {
  url: string
  auth?: YtDlpAuthSettings
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
  | 'cookie-cache-failure'
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
  fetchMetadata(request: MediaMetadataRequest): Promise<ApiResult<MediaMetadata>>
  preparePreview(request: PreviewRequest): Promise<ApiResult<PreviewResult>>
  getCookieCacheStatus(): Promise<ApiResult<CookieCacheStatus>>
  refreshCookieCache(request: CookieCacheRefreshRequest): Promise<ApiResult<CookieCacheStatus>>
  clearCookieCache(): Promise<ApiResult<CookieCacheStatus>>
  selectOutputFolder(): Promise<ApiResult<string>>
  exportClip(request: MediaCutRequest): Promise<ApiResult<ExportResult>>
  downloadThumbnail(request: ThumbnailDownloadRequest): Promise<ApiResult<ThumbnailDownloadResult>>
  openYouTubeSignIn(): Promise<ApiResult<void>>
}
