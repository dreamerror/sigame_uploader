import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  ApiResult,
  ExportResult,
  MediaCutRequest,
  MediaMetadata,
  PreviewResult,
  ThumbnailDownloadRequest,
  ThumbnailDownloadResult,
  ToolStatus
} from '../shared/types'
import { AppError } from './services/AppError'
import { ExportService } from './services/ExportService'
import { FfmpegService } from './services/FfmpegService'
import { MediaProbeService } from './services/MediaProbeService'
import { PreviewProxyService } from './services/PreviewProxyService'
import { PreviewService } from './services/PreviewService'
import { ThumbnailService } from './services/ThumbnailService'
import { YtDlpService } from './services/YtDlpService'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ytDlpService = new YtDlpService()
const ffmpegService = new FfmpegService()
const mediaProbeService = new MediaProbeService()
const exportService = new ExportService(ytDlpService, ffmpegService, mediaProbeService)
const previewProxyService = new PreviewProxyService()
const previewService = new PreviewService(ytDlpService, previewProxyService)
const thumbnailService = new ThumbnailService()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: 'SiGame Media Cutter',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function toResult<T>(task: () => Promise<T>): Promise<ApiResult<T>> {
  return task()
    .then((data) => ({ ok: true as const, data }))
    .catch((error: unknown) => {
      if (error instanceof AppError) {
        return {
          ok: false as const,
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          }
        }
      }

      return {
        ok: false as const,
        error: {
          code: 'unexpected-error',
          message: 'Неожиданная ошибка приложения.',
          details: error instanceof Error ? error.message : String(error)
        }
      }
    })
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.checkTools, () =>
    toResult<ToolStatus>(async () => ({
      ytDlp: await ytDlpService.isAvailable(),
      ffmpeg: await ffmpegService.isAvailable(),
      ffprobe: await mediaProbeService.isAvailable()
    }))
  )

  ipcMain.handle(IPC_CHANNELS.fetchMetadata, (_event, url: string) =>
    toResult<MediaMetadata>(() => ytDlpService.fetchMetadata(url))
  )

  ipcMain.handle(IPC_CHANNELS.preparePreview, (_event, url: string) =>
    toResult<PreviewResult>(() => previewService.preparePreview(url))
  )

  ipcMain.handle(IPC_CHANNELS.selectOutputFolder, () =>
    toResult<string>(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Выберите папку для сохранения',
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || !result.filePaths[0]) {
        throw new AppError('folder-selection-cancelled', 'Выбор папки для сохранения отменён.')
      }

      return result.filePaths[0]
    })
  )

  ipcMain.handle(IPC_CHANNELS.exportClip, (_event, request: MediaCutRequest) =>
    toResult<ExportResult>(() => exportService.exportClip(request))
  )

  ipcMain.handle(IPC_CHANNELS.downloadThumbnail, (_event, request: ThumbnailDownloadRequest) =>
    toResult<ThumbnailDownloadResult>(() => thumbnailService.downloadThumbnail(request))
  )
}

registerIpcHandlers()

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  previewProxyService.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
