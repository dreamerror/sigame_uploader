<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { MIN_FRAGMENT_SECONDS, formatTimestamp, parseTimestampToSeconds, roundToMilliseconds } from '../../shared/time'
import type {
  AppErrorPayload,
  CookieBrowser,
  CookieCacheStatus,
  MediaMetadata,
  ToolStatus,
  VideoQuality,
  YtDlpAuthSettings
} from '../../shared/types'
import SeekTimeline from './components/SeekTimeline.vue'
import TimelineSelector from './components/TimelineSelector.vue'

type ExportFormat = 'mp3' | 'mp4'
const videoQualityOptions: Array<{ value: VideoQuality; label: string }> = [
  { value: '360p', label: '360p' },
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: 'best', label: 'Лучшее' }
]
const cookieBrowserOptions: Array<{ value: CookieBrowser; label: string }> = [
  { value: 'chrome', label: 'Google Chrome' },
  { value: 'edge', label: 'Microsoft Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
  { value: 'yandex', label: 'Яндекс.Браузер' },
  { value: 'vivaldi', label: 'Vivaldi' },
  { value: 'opera', label: 'Opera' },
  { value: 'chromium', label: 'Chromium' }
]
const AUTH_ENABLED_STORAGE_KEY = 'sigame.auth.cookies.enabled'
const AUTH_BROWSER_STORAGE_KEY = 'sigame.auth.cookies.browser'
const COOKIE_CACHE_ENABLED_STORAGE_KEY = 'sigame.auth.cookies.cache.enabled'

const url = ref('')
const startTimestamp = ref('')
const endTimestamp = ref('')
const outputDirectory = ref('')
const exportFormat = ref<ExportFormat>('mp3')
const videoQuality = ref<VideoQuality>('720p')
const useBrowserCookies = ref(false)
const useCookieCache = ref(false)
const cookieBrowser = ref<CookieBrowser>('chrome')
const cookieCacheStatus = ref<CookieCacheStatus | null>(null)
const metadata = ref<MediaMetadata | null>(null)
const tools = ref<ToolStatus | null>(null)
const isLoadingMetadata = ref(false)
const isPreparingPreview = ref(false)
const isExporting = ref(false)
const isDownloadingThumbnail = ref(false)
const isRefreshingCookieCache = ref(false)
const isClearingCookieCache = ref(false)
const statusKind = ref<'idle' | 'success' | 'error'>('idle')
const statusMessage = ref('')
const errorDetails = ref('')
const lastOutputPath = ref('')
const progressMessage = ref('')
const elapsedSeconds = ref(0)
const previewUrl = ref('')
const previewRenderKey = ref(0)
const playerFrameRef = ref<HTMLElement | null>(null)
const playerRef = ref<HTMLVideoElement | null>(null)
const currentTime = ref(0)
const playerVolume = ref(1)
const isPlayerFullscreen = ref(false)
const isPlayerPlaying = ref(false)
const isPlayingSelection = ref(false)
const previewError = ref('')
const playbackFeedback = ref<'play' | 'pause' | ''>('')
const playbackFeedbackKey = ref(0)
let progressTimer: number | undefined
let autoPreviewRetryTimer: number | undefined
let playbackFeedbackTimer: number | undefined
let lastPreviewWasAutomatic = false
let autoPreviewRetryUsed = false

const durationLabel = computed(() => {
  if (!metadata.value?.durationSeconds) {
    return 'Длительность неизвестна'
  }

  return formatTimestamp(metadata.value.durationSeconds)
})

const durationSeconds = computed(() => metadata.value?.durationSeconds || 0)
const startSeconds = computed(() => parseTimestampSafely(startTimestamp.value))
const endSeconds = computed(() => parseTimestampSafely(endTimestamp.value))

const canExport = computed(
  () =>
    Boolean(metadata.value?.sourceUrl) &&
    Boolean(startTimestamp.value.trim()) &&
    Boolean(endTimestamp.value.trim()) &&
    Boolean(outputDirectory.value.trim()) &&
    !isExporting.value
)

const canDownloadThumbnail = computed(
  () =>
    Boolean(metadata.value?.thumbnailUrl) &&
    Boolean(outputDirectory.value.trim()) &&
    !isDownloadingThumbnail.value
)

const canUseSelectionControls = computed(() => durationSeconds.value > 0 && startSeconds.value !== undefined && endSeconds.value !== undefined)
const isBusy = computed(
  () =>
    isLoadingMetadata.value ||
    isPreparingPreview.value ||
    isExporting.value ||
    isDownloadingThumbnail.value ||
    isRefreshingCookieCache.value ||
    isClearingCookieCache.value
)
const cookieCacheLabel = computed(() => {
  if (!cookieCacheStatus.value) {
    return 'Статус кэша неизвестен'
  }

  if (!cookieCacheStatus.value.exists) {
    return 'Кэш cookies пуст'
  }

  const updatedAt = cookieCacheStatus.value.updatedAt ? new Date(cookieCacheStatus.value.updatedAt).toLocaleString('ru-RU') : ''
  return updatedAt ? `Кэш обновлён: ${updatedAt}` : 'Кэш cookies сохранён'
})
const canRefreshCookieCache = computed(() => useBrowserCookies.value && Boolean(url.value.trim()) && !isRefreshingCookieCache.value)
const selectedQualityLabel = computed(
  () => videoQualityOptions.find((option) => option.value === videoQuality.value)?.label ?? videoQuality.value
)
const exportLabel = computed(() => (exportFormat.value === 'mp4' ? `MP4 ${selectedQualityLabel.value}` : 'MP3'))
const selectedDurationSeconds = computed(() => {
  if (startSeconds.value === undefined || endSeconds.value === undefined) {
    return 0
  }

  return roundToMilliseconds(Math.max(0, endSeconds.value - startSeconds.value))
})
const selectedDurationLabel = computed(() => formatTimestamp(selectedDurationSeconds.value))
const previewState = computed(() => {
  if (isPreparingPreview.value) {
    return 'loading'
  }

  if (previewError.value) {
    return 'error'
  }

  if (previewUrl.value) {
    return 'ready'
  }

  return 'idle'
})
const previewStateLabel = computed(() => {
  if (previewState.value === 'loading') {
    return 'Готовится'
  }

  if (previewState.value === 'error') {
    return 'Ошибка'
  }

  if (previewState.value === 'ready') {
    return 'Готов'
  }

  return 'Не готов'
})
const selectionPlayButtonLabel = computed(() => (isPlayingSelection.value ? '■ Отрезок' : '▶ Отрезок'))
const selectionPlayButtonTitle = computed(() => (isPlayingSelection.value ? 'Остановить отрезок' : 'Проиграть выбранный отрезок'))
const playbackButtonLabel = computed(() => (isPlayerPlaying.value ? '⏸' : '▶'))
const playbackButtonTitle = computed(() => (isPlayerPlaying.value ? 'Пауза' : 'Воспроизвести'))
const fullscreenButtonLabel = computed(() => (isPlayerFullscreen.value ? '⤢' : '⛶'))
const fullscreenButtonTitle = computed(() => (isPlayerFullscreen.value ? 'Выйти из fullscreen' : 'Открыть fullscreen'))

const outputFileName = computed(() => {
  if (!metadata.value) {
    return ''
  }

  return `${outputFileBaseName.value}.${exportFormat.value}`
})

const outputFileBaseName = computed(() => {
  if (!metadata.value) {
    return ''
  }

  return sanitizeOutputBaseName(`${metadata.value.title} ${startTimestamp.value}-${endTimestamp.value}`)
})

const thumbnailFileBaseName = computed(() => {
  if (!metadata.value) {
    return ''
  }

  return sanitizeOutputBaseName(`${metadata.value.title} thumbnail`)
})

const plannedOutputPath = computed(() => {
  if (!outputDirectory.value || !outputFileName.value) {
    return ''
  }

  return `${outputDirectory.value}\\${outputFileName.value}`
})

const toolWarning = computed(() => {
  if (!tools.value) {
    return ''
  }

  const missing = [
    tools.value.ytDlp ? '' : 'yt-dlp',
    tools.value.ffmpeg ? '' : 'ffmpeg',
    tools.value.ffprobe ? '' : 'ffprobe'
  ].filter(Boolean)

  return missing.length ? `Не найдены инструменты: ${missing.join(', ')}` : ''
})

onMounted(async () => {
  document.addEventListener('fullscreenchange', updateFullscreenState)
  restoreAuthSettings()
  const api = getApi()

  if (!api) {
    return
  }

  const result = await api.checkTools()

  if (result.ok) {
    tools.value = result.data
  } else {
    showError(result.error)
  }

  await refreshCookieCacheStatus()
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', updateFullscreenState)
  stopProgress()
  clearAutoPreviewRetry()
  clearPlaybackFeedback()
})

async function fetchMetadata(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  clearStatus()
  metadata.value = null
  previewUrl.value = ''
  previewError.value = ''
  clearAutoPreviewRetry()
  autoPreviewRetryUsed = false
  currentTime.value = 0
  lastOutputPath.value = ''
  isLoadingMetadata.value = true
  startProgress('Получаю метаданные через yt-dlp. При медленной сети или VPN это может занять до двух минут.')
  let shouldPreparePreview = false

  try {
    const result = await api.fetchMetadata({
      url: url.value,
      auth: authSettings()
    })

    if (!result.ok) {
      showError(result.error)
      return
    }

    metadata.value = result.data
    url.value = result.data.sourceUrl
    ensureDefaultSelection(result.data.durationSeconds)
    statusKind.value = 'success'
    statusMessage.value = 'Метаданные загружены.'
    shouldPreparePreview = true
  } catch (error) {
    showUnexpectedError(error, 'Не удалось завершить запрос метаданных.')
  } finally {
    isLoadingMetadata.value = false
    stopProgress()
  }

  if (shouldPreparePreview) {
    void preparePreview({ auto: true })
  }
}

async function preparePreview(options: { auto?: boolean; retry?: boolean } = {}): Promise<boolean> {
  if (!metadata.value) {
    return false
  }

  const api = getApi()

  if (!api) {
    return false
  }

  if (!options.auto) {
    clearStatus()
  }

  clearAutoPreviewRetry()
  previewUrl.value = ''
  previewError.value = ''
  isPreparingPreview.value = true
  currentTime.value = 0
  isPlayerPlaying.value = false
  isPlayingSelection.value = false
  lastPreviewWasAutomatic = Boolean(options.auto)
  startProgress(
    options.auto
      ? options.retry
        ? 'Первый preview-поток не открылся. Пробую обновить preview автоматически.'
        : 'Автоматически готовлю preview через yt-dlp.'
      : 'Готовлю preview через yt-dlp и локальный proxy. Это может зависеть от сети и VPN.'
  )

  try {
    const result = await api.preparePreview({
      url: metadata.value.sourceUrl,
      auth: authSettings()
    })

    if (!result.ok) {
      showError(result.error)
      return false
    }

    previewUrl.value = result.data.previewUrl
    previewRenderKey.value += 1
    if (!options.auto) {
      statusKind.value = 'success'
      statusMessage.value = 'Preview готов.'
    }

    await nextTick()
    playerRef.value?.load()
    return true
  } catch (error) {
    showUnexpectedError(error, 'Не удалось подготовить preview.')
    return false
  } finally {
    isPreparingPreview.value = false
    stopProgress()
  }
}

async function selectOutputFolder(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  clearStatus()
  const result = await api.selectOutputFolder()

  if (!result.ok) {
    if (result.error.code !== 'folder-selection-cancelled') {
      showError(result.error)
    }
    return
  }

  outputDirectory.value = result.data
  lastOutputPath.value = ''
}

function onPlayerTimeUpdate(): void {
  if (!playerRef.value) {
    return
  }

  currentTime.value = roundToMilliseconds(playerRef.value.currentTime)

  if (isPlayingSelection.value && endSeconds.value !== undefined && currentTime.value >= endSeconds.value) {
    playerRef.value.pause()
    playerRef.value.currentTime = endSeconds.value
    currentTime.value = endSeconds.value
    isPlayingSelection.value = false
  }
}

function onPlayerLoadedMetadata(): void {
  if (playerRef.value) {
    playerRef.value.volume = playerVolume.value
    currentTime.value = roundToMilliseconds(playerRef.value.currentTime)
  }

  previewError.value = ''
}

function onPlayerEnded(): void {
  isPlayerPlaying.value = false
  isPlayingSelection.value = false
}

function onPlayerPlay(): void {
  isPlayerPlaying.value = true
}

function onPlayerPause(): void {
  isPlayerPlaying.value = false
  isPlayingSelection.value = false
}

function onPlayerError(): void {
  isPlayerPlaying.value = false
  isPlayingSelection.value = false

  if (lastPreviewWasAutomatic && !autoPreviewRetryUsed && metadata.value && !isPreparingPreview.value) {
    autoPreviewRetryUsed = true
    previewError.value = 'Первый preview-поток не открылся. Автоматически пробую обновить preview.'
    clearAutoPreviewRetry()
    autoPreviewRetryTimer = window.setTimeout(() => {
      autoPreviewRetryTimer = undefined
      void preparePreview({ auto: true, retry: true })
    }, 500)
    return
  }

  previewError.value =
    'Плеер не смог открыть локальный preview-поток. Можно обновить preview или продолжить ручной выбор и экспорт без preview.'
}

function seekPlayer(value: number): void {
  const rounded = clampSelectionTime(value)
  currentTime.value = rounded

  if (playerRef.value) {
    playerRef.value.currentTime = rounded
  }
}

function setPlayerVolume(value: number): void {
  playerVolume.value = clamp(value, 0, 1)

  if (playerRef.value) {
    playerRef.value.volume = playerVolume.value
  }
}

async function toggleFullscreen(): Promise<void> {
  if (!document.fullscreenEnabled) {
    showUnexpectedError('Fullscreen недоступен в текущем окружении.', 'Не удалось открыть fullscreen.')
    return
  }

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await playerFrameRef.value?.requestFullscreen()
  } catch (error) {
    showUnexpectedError(error, 'Не удалось переключить fullscreen.')
  }
}

function updateFullscreenState(): void {
  isPlayerFullscreen.value = document.fullscreenElement === playerFrameRef.value
}

async function togglePlayback(): Promise<void> {
  if (!previewUrl.value && !(await preparePreview())) {
    return
  }

  await nextTick()

  if (!playerRef.value) {
    showUnexpectedError('Плеер недоступен.', 'Не удалось управлять воспроизведением.')
    return
  }

  if (isPlayerPlaying.value) {
    playerRef.value.pause()
    showPlaybackFeedback('pause')
    return
  }

  isPlayingSelection.value = false

  try {
    await playerRef.value.play()
    showPlaybackFeedback('play')
  } catch (error) {
    isPlayerPlaying.value = false
    showUnexpectedError(error, 'Не удалось запустить воспроизведение.')
  }
}

async function playSelectedSegment(): Promise<void> {
  if (!canUseSelectionControls.value || startSeconds.value === undefined || endSeconds.value === undefined) {
    showInvalidTimestampStatus()
    return
  }

  if (!previewUrl.value && !(await preparePreview())) {
    return
  }

  await nextTick()

  if (!playerRef.value) {
    showUnexpectedError('Плеер недоступен.', 'Не удалось проиграть выбранный отрезок.')
    return
  }

  seekPlayer(startSeconds.value)
  isPlayingSelection.value = true

  try {
    await playerRef.value.play()
  } catch (error) {
    isPlayingSelection.value = false
    showUnexpectedError(error, 'Не удалось запустить воспроизведение.')
  }
}

function stopSelectedSegment(): void {
  isPlayerPlaying.value = false
  isPlayingSelection.value = false
  playerRef.value?.pause()
}

async function toggleSelectedSegment(): Promise<void> {
  if (isPlayingSelection.value) {
    stopSelectedSegment()
    return
  }

  await playSelectedSegment()
}

function setStartFromCurrent(): void {
  setStartSeconds(currentTime.value)
}

function setEndFromCurrent(): void {
  setEndSeconds(currentTime.value)
}

function seekToSelectionStart(): void {
  if (startSeconds.value === undefined) {
    showInvalidTimestampStatus()
    return
  }

  seekPlayer(startSeconds.value)
}

function seekToSelectionEnd(): void {
  if (endSeconds.value === undefined) {
    showInvalidTimestampStatus()
    return
  }

  seekPlayer(endSeconds.value)
}

function nudgeStart(delta: number): void {
  if (startSeconds.value === undefined) {
    showInvalidTimestampStatus()
    return
  }

  setStartSeconds(startSeconds.value + delta)
}

function nudgeEnd(delta: number): void {
  if (endSeconds.value === undefined) {
    showInvalidTimestampStatus()
    return
  }

  setEndSeconds(endSeconds.value + delta)
}

function setStartSeconds(value: number): void {
  const maxStart = Math.max(0, (endSeconds.value ?? durationSeconds.value) - MIN_FRAGMENT_SECONDS)
  startTimestamp.value = formatTimestamp(roundToMilliseconds(clamp(value, 0, maxStart)))
}

function setEndSeconds(value: number): void {
  const minEnd = (startSeconds.value ?? 0) + MIN_FRAGMENT_SECONDS
  const maxEnd = durationSeconds.value > 0 ? durationSeconds.value : Number.POSITIVE_INFINITY
  endTimestamp.value = formatTimestamp(roundToMilliseconds(clamp(value, minEnd, maxEnd)))
}

function normalizeTimestamp(field: 'start' | 'end'): void {
  const value = field === 'start' ? startSeconds.value : endSeconds.value

  if (value === undefined) {
    return
  }

  if (field === 'start') {
    setStartSeconds(value)
    return
  }

  setEndSeconds(value)
}

function ensureDefaultSelection(duration: number): void {
  if (!startTimestamp.value.trim()) {
    startTimestamp.value = formatTimestamp(0)
  }

  if (!endTimestamp.value.trim()) {
    endTimestamp.value = formatTimestamp(duration > 0 ? Math.min(duration, 30) : 30)
  }
}

function showInvalidTimestampStatus(): void {
  statusKind.value = 'error'
  statusMessage.value = 'Проверьте начало и конец фрагмента.'
  errorDetails.value = 'Используйте формат SS, SS.mmm, MM:SS.mmm или HH:MM:SS.mmm.'
}

async function exportClip(): Promise<void> {
  if (!metadata.value) {
    return
  }

  const api = getApi()

  if (!api) {
    return
  }

  clearStatus()
  isExporting.value = true
  startProgress(
    exportFormat.value === 'mp4'
      ? `Экспортирую ${exportLabel.value} через yt-dlp и ffmpeg. Видео может обрабатываться дольше MP3.`
      : 'Экспортирую MP3 через yt-dlp и ffmpeg. Длительность зависит от сети и размера фрагмента.'
  )

  try {
    const result = await api.exportClip({
      sourceUrl: metadata.value.sourceUrl,
      startTimestamp: startTimestamp.value,
      endTimestamp: endTimestamp.value,
      outputDirectory: outputDirectory.value,
      outputFileName: outputFileBaseName.value,
      outputFormat: exportFormat.value,
      videoQuality: videoQuality.value,
      auth: authSettings(),
      sourceDurationSeconds: metadata.value.durationSeconds > 0 ? metadata.value.durationSeconds : undefined
    })

    if (!result.ok) {
      showError(result.error)
      return
    }

    statusKind.value = 'success'
    lastOutputPath.value = result.data.outputPath
    statusMessage.value = `${exportLabel.value} экспортирован: ${result.data.outputPath}`
  } catch (error) {
    showUnexpectedError(error, 'Не удалось завершить экспорт.')
  } finally {
    isExporting.value = false
    stopProgress()
  }
}

async function downloadThumbnail(): Promise<void> {
  if (!metadata.value) {
    return
  }

  const api = getApi()

  if (!api) {
    return
  }

  clearStatus()
  isDownloadingThumbnail.value = true
  startProgress('Скачиваю thumbnail в выбранную папку.')

  try {
    const result = await api.downloadThumbnail({
      thumbnailUrl: metadata.value.thumbnailUrl || '',
      outputDirectory: outputDirectory.value,
      outputFileName: thumbnailFileBaseName.value
    })

    if (!result.ok) {
      showError(result.error)
      return
    }

    statusKind.value = 'success'
    statusMessage.value = `Thumbnail сохранён: ${result.data.outputPath}`
  } catch (error) {
    showUnexpectedError(error, 'Не удалось скачать thumbnail.')
  } finally {
    isDownloadingThumbnail.value = false
    stopProgress()
  }
}

function showError(error: AppErrorPayload): void {
  statusKind.value = 'error'
  statusMessage.value = error.message
  errorDetails.value = error.details || ''
}

function showUnexpectedError(error: unknown, message: string): void {
  statusKind.value = 'error'
  statusMessage.value = message
  errorDetails.value = error instanceof Error ? error.message : String(error)
}

function getApi(): typeof window.sigameApi | undefined {
  if (window.sigameApi) {
    return window.sigameApi
  }

  statusKind.value = 'error'
  statusMessage.value = 'Preload API не загружен.'
  errorDetails.value =
    'Перезапустите приложение. Если ошибка повторяется, проверьте desktop-сборку: main-процесс должен загружать out/preload/index.mjs.'

  return undefined
}

function clearStatus(): void {
  statusKind.value = 'idle'
  statusMessage.value = ''
  errorDetails.value = ''
}

async function openYouTubeSignIn(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  const result = await api.openYouTubeSignIn()

  if (!result.ok) {
    showError(result.error)
  }
}

async function refreshCookieCacheStatus(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  const result = await api.getCookieCacheStatus()

  if (result.ok) {
    cookieCacheStatus.value = result.data
  }
}

async function refreshCookieCache(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  if (!url.value.trim()) {
    statusKind.value = 'error'
    statusMessage.value = 'Вставьте ссылку YouTube перед обновлением кэша cookies.'
    errorDetails.value = 'yt-dlp обновляет кэш на реальном запросе к YouTube, поэтому нужна текущая ссылка.'
    return
  }

  if (!useBrowserCookies.value) {
    statusKind.value = 'error'
    statusMessage.value = 'Включите cookies из браузера перед обновлением кэша.'
    errorDetails.value = 'Кэш создаётся из браузера, где уже выполнен вход в YouTube.'
    return
  }

  clearStatus()
  isRefreshingCookieCache.value = true
  startProgress('Обновляю локальный кэш cookies через yt-dlp. Если браузер открыт, он может блокировать файл cookies.')

  try {
    const result = await api.refreshCookieCache({
      url: url.value,
      auth: {
        cookiesFromBrowser: cookieBrowser.value,
        cookieCacheEnabled: true
      }
    })

    if (!result.ok) {
      showError(result.error)
      return
    }

    cookieCacheStatus.value = result.data
    useCookieCache.value = true
    saveAuthSettings()
    statusKind.value = 'success'
    statusMessage.value = 'Кэш cookies обновлён. Теперь можно использовать его без повторного чтения браузера.'
  } catch (error) {
    showUnexpectedError(error, 'Не удалось обновить кэш cookies.')
  } finally {
    isRefreshingCookieCache.value = false
    stopProgress()
  }
}

async function clearCookieCache(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  clearStatus()
  isClearingCookieCache.value = true

  try {
    const result = await api.clearCookieCache()

    if (!result.ok) {
      showError(result.error)
      return
    }

    cookieCacheStatus.value = result.data
    useCookieCache.value = false
    saveAuthSettings()
    statusKind.value = 'success'
    statusMessage.value = 'Кэш cookies очищен.'
  } catch (error) {
    showUnexpectedError(error, 'Не удалось очистить кэш cookies.')
  } finally {
    isClearingCookieCache.value = false
  }
}

function authSettings(): YtDlpAuthSettings {
  return {
    ...(useBrowserCookies.value ? { cookiesFromBrowser: cookieBrowser.value } : {}),
    ...(useCookieCache.value ? { cookieCacheEnabled: true } : {})
  }
}

function saveAuthSettings(): void {
  window.localStorage.setItem(AUTH_ENABLED_STORAGE_KEY, String(useBrowserCookies.value))
  window.localStorage.setItem(AUTH_BROWSER_STORAGE_KEY, cookieBrowser.value)
  window.localStorage.setItem(COOKIE_CACHE_ENABLED_STORAGE_KEY, String(useCookieCache.value))
}

function restoreAuthSettings(): void {
  useBrowserCookies.value = window.localStorage.getItem(AUTH_ENABLED_STORAGE_KEY) === 'true'
  useCookieCache.value = window.localStorage.getItem(COOKIE_CACHE_ENABLED_STORAGE_KEY) === 'true'
  const browser = window.localStorage.getItem(AUTH_BROWSER_STORAGE_KEY)

  if (isCookieBrowser(browser)) {
    cookieBrowser.value = browser
  }
}

function isCookieBrowser(value: string | null): value is CookieBrowser {
  return cookieBrowserOptions.some((option) => option.value === value)
}

function startProgress(message: string): void {
  stopProgress()
  progressMessage.value = message
  elapsedSeconds.value = 0
  progressTimer = window.setInterval(() => {
    elapsedSeconds.value += 1
  }, 1000)
}

function stopProgress(): void {
  if (progressTimer !== undefined) {
    window.clearInterval(progressTimer)
    progressTimer = undefined
  }

  progressMessage.value = ''
  elapsedSeconds.value = 0
}

function clearAutoPreviewRetry(): void {
  if (autoPreviewRetryTimer !== undefined) {
    window.clearTimeout(autoPreviewRetryTimer)
    autoPreviewRetryTimer = undefined
  }
}

function showPlaybackFeedback(kind: 'play' | 'pause'): void {
  clearPlaybackFeedback()
  playbackFeedback.value = kind
  playbackFeedbackKey.value += 1
  playbackFeedbackTimer = window.setTimeout(() => {
    playbackFeedback.value = ''
    playbackFeedbackTimer = undefined
  }, 520)
}

function clearPlaybackFeedback(): void {
  if (playbackFeedbackTimer !== undefined) {
    window.clearTimeout(playbackFeedbackTimer)
    playbackFeedbackTimer = undefined
  }
}

function sanitizeOutputBaseName(value: string): string {
  const fallback = `sigame_clip_${new Date().toISOString().replace(/[:.]/g, '-')}`
  const candidate = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)

  return candidate || fallback
}

function parseTimestampSafely(value: string): number | undefined {
  try {
    return parseTimestampToSeconds(value)
  } catch {
    return undefined
  }
}

function clampSelectionTime(value: number): number {
  return roundToMilliseconds(clamp(value, 0, durationSeconds.value || Math.max(value, 0)))
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}
</script>

<template>
  <main class="app-shell">
    <section class="app-frame">
      <header class="command-bar">
        <div class="brand-block">
          <strong>SiGame Media Cutter</strong>
          <span>Dark Precision Utility</span>
        </div>

        <form class="source-form" @submit.prevent="fetchMetadata">
          <label class="sr-only" for="url">Ссылка YouTube</label>
          <input
            id="url"
            v-model="url"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            autocomplete="off"
            required
          />
          <button class="primary-button" type="submit" :disabled="isLoadingMetadata">
            {{ isLoadingMetadata ? 'Получаю...' : 'Получить данные' }}
          </button>
        </form>

        <div class="command-status">
          <span v-if="isBusy" class="operation-pill">
            {{ progressMessage }}
            <strong>{{ elapsedSeconds }} сек.</strong>
          </span>
          <span v-else class="tool-status" :class="{ warning: toolWarning }">
            {{ toolWarning || 'Инструменты найдены' }}
          </span>
        </div>
      </header>

      <section class="workbench">
        <section class="media-workspace">
          <section class="workspace-panel player-panel">
            <div class="panel-header">
              <div class="panel-title-row">
                <span class="section-kicker">Media workspace</span>
                <h1>Preview и точный отрезок</h1>
              </div>
              <div class="header-actions">
                <span class="preview-state" :class="previewState">{{ previewStateLabel }}</span>
                <button type="button" :disabled="!metadata || isPreparingPreview" @click="() => preparePreview()">
                  {{ isPreparingPreview ? 'Готовлю...' : previewUrl ? 'Обновить preview' : 'Подготовить preview' }}
                </button>
              </div>
            </div>

            <div ref="playerFrameRef" class="player-frame" :class="{ fullscreen: isPlayerFullscreen }">
              <template v-if="previewUrl">
                <video
                  ref="playerRef"
                  :key="previewRenderKey"
                  class="media-player"
                  :src="previewUrl"
                  preload="metadata"
                  playsinline
                  tabindex="0"
                  @click="togglePlayback"
                  @keydown.space.prevent="togglePlayback"
                  @timeupdate="onPlayerTimeUpdate"
                  @loadedmetadata="onPlayerLoadedMetadata"
                  @play="onPlayerPlay"
                  @ended="onPlayerEnded"
                  @pause="onPlayerPause"
                  @error="onPlayerError"
                ></video>
                <div v-if="playbackFeedback" :key="playbackFeedbackKey" class="playback-feedback" aria-hidden="true">
                  {{ playbackFeedback === 'play' ? '▶' : '⏸' }}
                </div>

                <div class="player-overlay">
                  <SeekTimeline
                    v-if="durationSeconds > 0"
                    :duration="durationSeconds"
                    :current-time="currentTime"
                    :start="startSeconds ?? 0"
                    :end="endSeconds ?? Math.min(durationSeconds, MIN_FRAGMENT_SECONDS)"
                    :disabled="!canUseSelectionControls"
                    @seek="seekPlayer"
                  />

                  <div class="player-transport">
                    <button
                      class="transport-icon-button"
                      type="button"
                      :aria-label="playbackButtonTitle"
                      :title="playbackButtonTitle"
                      @click.stop="togglePlayback"
                    >
                      {{ playbackButtonLabel }}
                    </button>
                    <button
                      class="transport-segment-button"
                      type="button"
                      :disabled="!canUseSelectionControls"
                      :aria-label="selectionPlayButtonTitle"
                      :title="selectionPlayButtonTitle"
                      @click.stop="toggleSelectedSegment"
                    >
                      {{ selectionPlayButtonLabel }}
                    </button>
                    <label class="volume-control" @click.stop>
                      <span>Громкость</span>
                      <input
                        v-model.number="playerVolume"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        :aria-valuetext="`${Math.round(playerVolume * 100)}%`"
                        @input="setPlayerVolume(playerVolume)"
                      />
                    </label>
                    <span class="transport-time">{{ formatTimestamp(currentTime) }} / {{ durationLabel }}</span>
                    <button
                      class="transport-icon-button fullscreen-button"
                      type="button"
                      :aria-label="fullscreenButtonTitle"
                      :title="fullscreenButtonTitle"
                      @click.stop="toggleFullscreen"
                    >
                      {{ fullscreenButtonLabel }}
                    </button>
                  </div>

                  <div v-if="isPlayerFullscreen && durationSeconds > 0" class="fullscreen-trim-panel">
                    <div class="fullscreen-trim-header">
                      <span>Отрезок {{ selectedDurationLabel }}</span>
                      <span>{{ startSeconds !== undefined ? formatTimestamp(startSeconds) : '—' }} → {{ endSeconds !== undefined ? formatTimestamp(endSeconds) : '—' }}</span>
                    </div>
                    <TimelineSelector
                      :duration="durationSeconds"
                      :current-time="currentTime"
                      :start="startSeconds ?? 0"
                      :end="endSeconds ?? Math.min(durationSeconds, MIN_FRAGMENT_SECONDS)"
                      :disabled="!canUseSelectionControls"
                      @update:start="setStartSeconds"
                      @update:end="setEndSeconds"
                    />
                  </div>
                </div>
              </template>
              <div v-else class="media-player-placeholder" :class="{ loading: isPreparingPreview }">
                <strong>
                  {{ metadata ? (isPreparingPreview ? 'Preview готовится' : 'Preview ещё не готов') : 'Вставьте ссылку и получите данные' }}
                </strong>
                <span>
                  {{
                    metadata
                      ? isPreparingPreview
                        ? 'Плеер появится после подготовки локального proxy-потока.'
                        : 'Можно задать start/end вручную и экспортировать без preview.'
                      : 'После metadata здесь появится плеер, timeline и точная настройка фрагмента.'
                  }}
                </span>
              </div>
            </div>

            <p v-if="previewError" class="inline-error">{{ previewError }}</p>
            <p v-else class="path-hint">
              Preview идёт через локальный streaming proxy без временных файлов. Export-flow остаётся доступен отдельно.
            </p>
          </section>

          <section class="workspace-panel timeline-panel">
            <div class="panel-header compact">
              <div class="panel-title-row">
                <span class="section-kicker">Timeline</span>
                <h2>Границы фрагмента</h2>
              </div>
              <div class="selection-stats">
                <span>Позиция {{ formatTimestamp(currentTime) }}</span>
                <span>Отрезок {{ selectedDurationLabel }}</span>
              </div>
            </div>

            <TimelineSelector
              v-if="metadata && durationSeconds > 0"
              :duration="durationSeconds"
              :current-time="currentTime"
              :start="startSeconds ?? 0"
              :end="endSeconds ?? Math.min(durationSeconds, MIN_FRAGMENT_SECONDS)"
              :disabled="!canUseSelectionControls"
              @update:start="setStartSeconds"
              @update:end="setEndSeconds"
            />
            <div v-else class="timeline-empty">
              Timeline появится после загрузки metadata.
            </div>

            <div class="clip-controls">
              <div class="time-grid">
                <label>
                  <span>Начало</span>
                  <input
                    v-model="startTimestamp"
                    class="time-input"
                    placeholder="01:12.250"
                    autocomplete="off"
                    @blur="normalizeTimestamp('start')"
                  />
                </label>
                <label>
                  <span>Конец</span>
                  <input
                    v-model="endTimestamp"
                    class="time-input"
                    placeholder="01:42.750"
                    autocomplete="off"
                    @blur="normalizeTimestamp('end')"
                  />
                </label>
              </div>

              <div class="selection-toolbar">
                <div class="player-controls">
                  <button type="button" :disabled="!canUseSelectionControls" @click="seekToSelectionStart">К началу</button>
                  <button type="button" :disabled="!canUseSelectionControls" @click="seekToSelectionEnd">К концу</button>
                  <button type="button" :disabled="!metadata" @click="setStartFromCurrent">Начало из позиции</button>
                  <button type="button" :disabled="!metadata" @click="setEndFromCurrent">Конец из позиции</button>
                </div>
              </div>

              <div class="trim-controls">
                <div class="trim-control-group">
                  <span>Начало</span>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeStart(-1)">-1с</button>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeStart(-0.1)">-0.1с</button>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeStart(0.1)">+0.1с</button>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeStart(1)">+1с</button>
                </div>
                <div class="trim-control-group">
                  <span>Конец</span>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeEnd(-1)">-1с</button>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeEnd(-0.1)">-0.1с</button>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeEnd(0.1)">+0.1с</button>
                  <button type="button" :disabled="!canUseSelectionControls" @click="nudgeEnd(1)">+1с</button>
                </div>
              </div>
            </div>
          </section>
        </section>

        <aside class="side-panel">
          <section class="side-section metadata-section">
            <div class="panel-title-row">
              <span class="section-kicker">Source</span>
              <h2>Материал</h2>
            </div>
            <div v-if="metadata" class="media-card">
              <img v-if="metadata.thumbnailUrl" :src="metadata.thumbnailUrl" alt="" />
              <div class="media-copy">
                <h3>{{ metadata.title }}</h3>
                <p>{{ durationLabel }}</p>
              </div>
            </div>
            <div v-else class="empty-state">
              Metadata ещё не загружены.
            </div>
          </section>

          <section class="side-section export-section">
            <div class="panel-title-row">
              <span class="section-kicker">Export</span>
              <h2>Параметры</h2>
              <span class="preview-state ready">{{ exportLabel }}</span>
            </div>

            <div class="format-toggle" role="radiogroup" aria-label="Формат экспорта">
              <span>Формат</span>
              <label>
                <input v-model="exportFormat" type="radio" value="mp3" />
                MP3
              </label>
              <label>
                <input v-model="exportFormat" type="radio" value="mp4" />
                MP4
              </label>
            </div>

            <div
              class="format-toggle quality-toggle"
              :class="{ disabled: exportFormat !== 'mp4' }"
              role="radiogroup"
              aria-label="Качество MP4"
            >
              <span>Качество</span>
              <label v-for="option in videoQualityOptions" :key="option.value">
                <input v-model="videoQuality" type="radio" :value="option.value" :disabled="exportFormat !== 'mp4'" />
                {{ option.label }}
              </label>
              <small v-if="exportFormat !== 'mp4'">Доступно при MP4. По умолчанию: 720p.</small>
            </div>

            <label for="folder">Папка сохранения</label>
            <div class="input-row">
              <input id="folder" :value="outputDirectory" readonly placeholder="Папка не выбрана" :title="outputDirectory" />
              <button type="button" @click="selectOutputFolder">Выбрать</button>
            </div>

            <p v-if="plannedOutputPath" class="path-hint" :title="plannedOutputPath">{{ exportLabel }} будет сохранён: {{ plannedOutputPath }}</p>
            <p v-if="lastOutputPath" class="path-hint" :title="lastOutputPath">Последний экспорт: {{ lastOutputPath }}</p>

            <div class="action-row">
              <button class="export-button primary-button" type="button" :disabled="!canExport" @click="exportClip">
                {{ isExporting ? 'Экспорт...' : `Экспорт ${exportLabel}` }}
              </button>
              <button type="button" :disabled="!canDownloadThumbnail" @click="downloadThumbnail">
                {{ isDownloadingThumbnail ? 'Скачиваю...' : 'Скачать thumbnail' }}
              </button>
            </div>
          </section>

          <details class="side-section auth-panel">
            <summary>
              <span>Доступ YouTube</span>
              <span class="preview-state" :class="useBrowserCookies || useCookieCache ? 'ready' : 'idle'">
                {{ useBrowserCookies || useCookieCache ? 'Cookies включены' : 'Без cookies' }}
              </span>
            </summary>

            <label class="checkbox-row">
              <input v-model="useBrowserCookies" type="checkbox" @change="saveAuthSettings" />
              <span>Использовать cookies из браузера для yt-dlp</span>
            </label>

            <label class="checkbox-row">
              <input v-model="useCookieCache" type="checkbox" @change="saveAuthSettings" />
              <span>Использовать локальный кэш cookies</span>
            </label>

            <div class="auth-controls">
              <label>
                <span>Браузер</span>
                <select v-model="cookieBrowser" :disabled="!useBrowserCookies" @change="saveAuthSettings">
                  <option v-for="option in cookieBrowserOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <button type="button" @click="openYouTubeSignIn">Открыть вход</button>
            </div>

            <div class="cache-status">
              <span>Кэш cookies</span>
              <strong>{{ cookieCacheLabel }}</strong>
            </div>
            <div class="auth-actions">
              <button type="button" :disabled="!canRefreshCookieCache" @click="refreshCookieCache">
                {{ isRefreshingCookieCache ? 'Обновляю...' : 'Обновить кэш' }}
              </button>
              <button type="button" :disabled="isClearingCookieCache || !cookieCacheStatus?.exists" @click="clearCookieCache">
                {{ isClearingCookieCache ? 'Очищаю...' : 'Очистить' }}
              </button>
            </div>

            <p class="path-hint">
              Cookies не передаются в renderer. `yt-dlp` читает выбранный браузер или локальный app-data кэш в main-процессе.
            </p>
          </details>
        </aside>
      </section>

      <footer class="status-bar" :class="[statusKind, { busy: isBusy }]" role="status" aria-live="polite">
        <div class="status-main">
          <span v-if="isBusy" class="status-dot"></span>
          <strong>{{ progressMessage || statusMessage || 'Готов к работе' }}</strong>
          <span v-if="isBusy">{{ elapsedSeconds }} сек.</span>
          <span v-else-if="toolWarning">{{ toolWarning }}</span>
          <span v-else>{{ metadata ? 'Metadata загружены' : 'Ожидаю ссылку YouTube' }}</span>
        </div>
        <div class="status-detail">
          <span v-if="errorDetails">{{ errorDetails }}</span>
          <span v-else-if="lastOutputPath" :title="lastOutputPath">Последний экспорт: {{ lastOutputPath }}</span>
          <span v-else-if="plannedOutputPath" :title="plannedOutputPath">План: {{ plannedOutputPath }}</span>
          <span v-else>Локальная подготовка медиа для материалов, которые пользователь имеет право использовать.</span>
        </div>
      </footer>
    </section>
  </main>
</template>
