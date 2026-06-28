import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  ApiResult,
  CookieCacheRefreshRequest,
  CookieCacheStatus,
  ExportResult,
  LocalMediaPreviewRequest,
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
import type {
  SiqPackageExportRequest,
  SiqPackageExportResult,
  SiqPackageImportRequest,
  SiqPackageImportResult
} from '../shared/siq'

const api: SigameApi = {
  checkTools: () => ipcRenderer.invoke(IPC_CHANNELS.checkTools) as Promise<ApiResult<ToolStatus>>,
  fetchMetadata: (request: MediaMetadataRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.fetchMetadata, request) as Promise<ApiResult<MediaMetadata>>,
  preparePreview: (request: PreviewRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.preparePreview, request) as Promise<ApiResult<PreviewResult>>,
  prepareLocalMediaPreview: (request: LocalMediaPreviewRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.prepareLocalMediaPreview, request) as Promise<ApiResult<PreviewResult>>,
  getCookieCacheStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getCookieCacheStatus) as Promise<ApiResult<CookieCacheStatus>>,
  refreshCookieCache: (request: CookieCacheRefreshRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.refreshCookieCache, request) as Promise<ApiResult<CookieCacheStatus>>,
  clearCookieCache: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearCookieCache) as Promise<ApiResult<CookieCacheStatus>>,
  selectOutputFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectOutputFolder) as Promise<ApiResult<string>>,
  selectSiqPackage: () => ipcRenderer.invoke(IPC_CHANNELS.selectSiqPackage) as Promise<ApiResult<string>>,
  selectMediaFile: () => ipcRenderer.invoke(IPC_CHANNELS.selectMediaFile) as Promise<ApiResult<string>>,
  exportClip: (request: MediaCutRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportClip, request) as Promise<ApiResult<ExportResult>>,
  downloadThumbnail: (request: ThumbnailDownloadRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.downloadThumbnail, request) as Promise<ApiResult<ThumbnailDownloadResult>>,
  importSiqPackage: (request: SiqPackageImportRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.importSiqPackage, request) as Promise<ApiResult<SiqPackageImportResult>>,
  createSiqPackage: (request: SiqPackageExportRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.createSiqPackage, request) as Promise<ApiResult<SiqPackageExportResult>>,
  openYouTubeSignIn: () => ipcRenderer.invoke(IPC_CHANNELS.openYouTubeSignIn) as Promise<ApiResult<void>>
}

contextBridge.exposeInMainWorld('sigameApi', api)
