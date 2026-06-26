import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  ApiResult,
  CookieCacheRefreshRequest,
  CookieCacheStatus,
  ExportResult,
  MediaCutRequest,
  MediaMetadataRequest,
  MediaMetadata,
  PreviewRequest,
  PreviewResult,
  SigameApi,
  ThumbnailDownloadRequest,
  ThumbnailDownloadResult,
  ToolStatus
} from '../shared/types'

const api: SigameApi = {
  checkTools: () => ipcRenderer.invoke(IPC_CHANNELS.checkTools) as Promise<ApiResult<ToolStatus>>,
  fetchMetadata: (request: MediaMetadataRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.fetchMetadata, request) as Promise<ApiResult<MediaMetadata>>,
  preparePreview: (request: PreviewRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.preparePreview, request) as Promise<ApiResult<PreviewResult>>,
  getCookieCacheStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getCookieCacheStatus) as Promise<ApiResult<CookieCacheStatus>>,
  refreshCookieCache: (request: CookieCacheRefreshRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.refreshCookieCache, request) as Promise<ApiResult<CookieCacheStatus>>,
  clearCookieCache: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearCookieCache) as Promise<ApiResult<CookieCacheStatus>>,
  selectOutputFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectOutputFolder) as Promise<ApiResult<string>>,
  exportClip: (request: MediaCutRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportClip, request) as Promise<ApiResult<ExportResult>>,
  downloadThumbnail: (request: ThumbnailDownloadRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.downloadThumbnail, request) as Promise<ApiResult<ThumbnailDownloadResult>>,
  openYouTubeSignIn: () => ipcRenderer.invoke(IPC_CHANNELS.openYouTubeSignIn) as Promise<ApiResult<void>>
}

contextBridge.exposeInMainWorld('sigameApi', api)
