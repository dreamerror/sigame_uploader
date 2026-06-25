import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  ApiResult,
  ExportResult,
  MediaCutRequest,
  MediaMetadata,
  PreviewResult,
  SigameApi,
  ThumbnailDownloadRequest,
  ThumbnailDownloadResult,
  ToolStatus
} from '../shared/types'

const api: SigameApi = {
  checkTools: () => ipcRenderer.invoke(IPC_CHANNELS.checkTools) as Promise<ApiResult<ToolStatus>>,
  fetchMetadata: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fetchMetadata, url) as Promise<ApiResult<MediaMetadata>>,
  preparePreview: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.preparePreview, url) as Promise<ApiResult<PreviewResult>>,
  selectOutputFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectOutputFolder) as Promise<ApiResult<string>>,
  exportClip: (request: MediaCutRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportClip, request) as Promise<ApiResult<ExportResult>>,
  downloadThumbnail: (request: ThumbnailDownloadRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.downloadThumbnail, request) as Promise<ApiResult<ThumbnailDownloadResult>>
}

contextBridge.exposeInMainWorld('sigameApi', api)
