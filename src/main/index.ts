import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  ThumbnailDownloadRequest,
  ThumbnailDownloadResult,
  ToolStatus
} from '../shared/types'
import { AppError } from './services/AppError'
import { CookieCacheService } from './services/CookieCacheService'
import { ExportService } from './services/ExportService'
import { FfmpegService } from './services/FfmpegService'
import { MediaProbeService } from './services/MediaProbeService'
import { PreviewProxyService } from './services/PreviewProxyService'
import { PreviewService } from './services/PreviewService'
import { SiqPackageService } from './services/SiqPackageService'
import { ThumbnailService } from './services/ThumbnailService'
import { YtDlpService } from './services/YtDlpService'
import type {
  SiqPackageExportRequest,
  SiqPackageExportResult,
  SiqPackageImportRequest,
  SiqPackageImportResult
} from '../shared/siq'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cookieCacheService = new CookieCacheService(app.getPath('userData'))
const ytDlpService = new YtDlpService(undefined, cookieCacheService.getCookieFilePath())
const ffmpegService = new FfmpegService()
const mediaProbeService = new MediaProbeService()
const exportService = new ExportService(ytDlpService, ffmpegService, mediaProbeService)
const previewProxyService = new PreviewProxyService()
const previewService = new PreviewService(ytDlpService, previewProxyService)
const thumbnailService = new ThumbnailService()
const siqPackageService = new SiqPackageService(app.getPath('userData'))

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

async function ensureCookieCacheDirectory(auth?: { cookieCacheEnabled?: boolean }): Promise<void> {
  if (auth?.cookieCacheEnabled) {
    await cookieCacheService.ensureDirectory()
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.checkTools, () =>
    toResult<ToolStatus>(async () => ({
      ytDlp: await ytDlpService.isAvailable(),
      ffmpeg: await ffmpegService.isAvailable(),
      ffprobe: await mediaProbeService.isAvailable()
    }))
  )

  ipcMain.handle(IPC_CHANNELS.fetchMetadata, (_event, request: MediaMetadataRequest) =>
    toResult<MediaMetadata>(async () => {
      await ensureCookieCacheDirectory(request.auth)
      return ytDlpService.fetchMetadata(request.url, request.auth)
    })
  )

  ipcMain.handle(IPC_CHANNELS.preparePreview, (_event, request: PreviewRequest) =>
    toResult<PreviewResult>(async () => {
      await ensureCookieCacheDirectory(request.auth)
      return previewService.preparePreview(request.url, request.auth)
    })
  )

  ipcMain.handle(IPC_CHANNELS.prepareLocalMediaPreview, (_event, request: LocalMediaPreviewRequest) =>
    toResult<PreviewResult>(async () => ({
      sourceUrl: request.filePath,
      previewUrl: await previewProxyService.registerLocalFile(request.filePath)
    }))
  )

  ipcMain.handle(IPC_CHANNELS.getCookieCacheStatus, () =>
    toResult<CookieCacheStatus>(() => cookieCacheService.getStatus())
  )

  ipcMain.handle(IPC_CHANNELS.refreshCookieCache, (_event, request: CookieCacheRefreshRequest) =>
    toResult<CookieCacheStatus>(async () => {
      if (!request.auth?.cookiesFromBrowser) {
        throw new AppError(
          'cookie-cache-failure',
          'Выберите браузер для обновления кэша cookies.',
          'Кэш обновляется через yt-dlp и --cookies-from-browser, поэтому нужен браузер, где уже выполнен вход в YouTube.'
        )
      }

      await cookieCacheService.ensureDirectory()
      await ytDlpService.fetchMetadata(
        request.url,
        {
          ...request.auth,
          cookieCacheEnabled: true
        },
        'merge'
      )
      return cookieCacheService.getStatus()
    })
  )

  ipcMain.handle(IPC_CHANNELS.clearCookieCache, () =>
    toResult<CookieCacheStatus>(() => cookieCacheService.clear())
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

  ipcMain.handle(IPC_CHANNELS.selectSiqPackage, () =>
    toResult<string>(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Выберите пакет SiGame',
        filters: [{ name: 'SiGame package', extensions: ['siq'] }],
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths[0]) {
        throw new AppError('folder-selection-cancelled', 'Выбор .siq пакета отменён.')
      }

      return result.filePaths[0]
    })
  )

  ipcMain.handle(IPC_CHANNELS.selectMediaFile, () =>
    toResult<string>(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Выберите медиафайл для вопроса',
        filters: [
          { name: 'Media', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'mov', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'html', 'htm'] },
          { name: 'All files', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (result.canceled || !result.filePaths[0]) {
        throw new AppError('folder-selection-cancelled', 'Выбор медиафайла отменён.')
      }

      return result.filePaths[0]
    })
  )

  ipcMain.handle(IPC_CHANNELS.exportClip, (_event, request: MediaCutRequest) =>
    toResult<ExportResult>(async () => {
      await ensureCookieCacheDirectory(request.auth)
      return exportService.exportClip(request)
    })
  )

  ipcMain.handle(IPC_CHANNELS.downloadThumbnail, (_event, request: ThumbnailDownloadRequest) =>
    toResult<ThumbnailDownloadResult>(() => thumbnailService.downloadThumbnail(request))
  )

  ipcMain.handle(IPC_CHANNELS.importSiqPackage, (_event, request: SiqPackageImportRequest) =>
    toResult<SiqPackageImportResult>(() => siqPackageService.importPackage(request))
  )

  ipcMain.handle(IPC_CHANNELS.createSiqPackage, (_event, request: SiqPackageExportRequest) =>
    toResult<SiqPackageExportResult>(() => siqPackageService.exportPackage(request))
  )

  ipcMain.handle(IPC_CHANNELS.openYouTubeSignIn, () =>
    toResult<void>(async () => {
      await shell.openExternal('https://accounts.google.com/ServiceLogin?service=youtube')
    })
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
