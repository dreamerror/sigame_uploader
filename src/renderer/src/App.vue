<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { MIN_FRAGMENT_SECONDS, formatTimestamp, parseTimestampToSeconds, roundToMilliseconds } from '../../shared/time'
import type { AppErrorPayload, MediaMetadata, ToolStatus, VideoQuality } from '../../shared/types'
import TimelineSelector from './components/TimelineSelector.vue'

type ExportFormat = 'mp3' | 'mp4'
const videoQualityOptions: Array<{ value: VideoQuality; label: string }> = [
  { value: '360p', label: '360p' },
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: 'best', label: 'Лучшее' }
]

const url = ref('')
const startTimestamp = ref('')
const endTimestamp = ref('')
const outputDirectory = ref('')
const exportFormat = ref<ExportFormat>('mp3')
const videoQuality = ref<VideoQuality>('720p')
const metadata = ref<MediaMetadata | null>(null)
const tools = ref<ToolStatus | null>(null)
const isLoadingMetadata = ref(false)
const isPreparingPreview = ref(false)
const isExporting = ref(false)
const isDownloadingThumbnail = ref(false)
const statusKind = ref<'idle' | 'success' | 'error'>('idle')
const statusMessage = ref('')
const errorDetails = ref('')
const lastOutputPath = ref('')
const progressMessage = ref('')
const elapsedSeconds = ref(0)
const previewUrl = ref('')
const previewRenderKey = ref(0)
const playerRef = ref<HTMLVideoElement | null>(null)
const currentTime = ref(0)
const isPlayingSelection = ref(false)
const previewError = ref('')
let progressTimer: number | undefined
let autoPreviewRetryTimer: number | undefined
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
const isBusy = computed(() => isLoadingMetadata.value || isPreparingPreview.value || isExporting.value || isDownloadingThumbnail.value)
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
const selectionPlayButtonLabel = computed(() => (isPlayingSelection.value ? 'Остановить' : 'Проиграть отрезок'))

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
})

onBeforeUnmount(() => {
  stopProgress()
  clearAutoPreviewRetry()
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
    const result = await api.fetchMetadata(url.value)

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
    const result = await api.preparePreview(metadata.value.sourceUrl)

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
    currentTime.value = roundToMilliseconds(playerRef.value.currentTime)
  }

  previewError.value = ''
}

function onPlayerEnded(): void {
  isPlayingSelection.value = false
}

function onPlayerPause(): void {
  isPlayingSelection.value = false
}

function onPlayerError(): void {
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
    <section class="workspace">
      <header class="app-header">
        <div>
          <p class="eyebrow">Локальная настольная утилита</p>
          <h1>SiGame Media Cutter</h1>
        </div>
        <div class="tool-status" :class="{ warning: toolWarning }">
          {{ toolWarning || 'Инструменты найдены' }}
        </div>
      </header>

      <form class="panel" @submit.prevent="fetchMetadata">
        <label for="url">Ссылка YouTube</label>
        <div class="input-row">
          <input
            id="url"
            v-model="url"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            autocomplete="off"
            required
          />
          <button type="submit" :disabled="isLoadingMetadata">
            {{ isLoadingMetadata ? 'Загрузка...' : 'Получить' }}
          </button>
        </div>
      </form>

      <section v-if="isBusy" class="progress-panel" role="status" aria-live="polite">
        <div class="progress-copy">
          <strong>{{ progressMessage }}</strong>
          <span>{{ elapsedSeconds }} сек.</span>
        </div>
        <div class="progress-track" aria-hidden="true">
          <div class="progress-bar"></div>
        </div>
      </section>

      <section v-if="metadata" class="media-preview">
        <img v-if="metadata.thumbnailUrl" :src="metadata.thumbnailUrl" alt="" />
        <div class="media-copy">
          <h2>{{ metadata.title }}</h2>
          <p>{{ durationLabel }}</p>
        </div>
      </section>

      <section v-if="metadata" class="panel preview-panel">
        <div class="panel-header">
          <div class="panel-title-row">
            <h2>Preview</h2>
            <span class="preview-state" :class="previewState">{{ previewStateLabel }}</span>
          </div>
          <button type="button" :disabled="isPreparingPreview" @click="() => preparePreview()">
            {{ isPreparingPreview ? 'Готовлю...' : previewUrl ? 'Обновить preview' : 'Подготовить preview' }}
          </button>
        </div>

        <video
          v-if="previewUrl"
          ref="playerRef"
          :key="previewRenderKey"
          class="media-player"
          :src="previewUrl"
          controls
          preload="metadata"
          playsinline
          @timeupdate="onPlayerTimeUpdate"
          @loadedmetadata="onPlayerLoadedMetadata"
          @ended="onPlayerEnded"
          @pause="onPlayerPause"
          @error="onPlayerError"
        ></video>
        <div v-else class="media-player-placeholder" :class="{ loading: isPreparingPreview }">
          <strong>{{ isPreparingPreview ? 'Preview готовится' : 'Preview ещё не готов' }}</strong>
          <span>{{ isPreparingPreview ? 'Плеер появится после подготовки потока.' : 'Можно задать start/end вручную и экспортировать без preview.' }}</span>
        </div>
        <p v-if="previewError" class="inline-error">{{ previewError }}</p>
        <p v-else class="path-hint">
          Preview идёт через локальный streaming proxy без временных файлов. Если preview не загрузится, ручной ввод и экспорт всё равно доступны.
        </p>

        <div v-if="previewUrl" class="selection-toolbar">
          <div class="selection-stats">
            <span>Позиция: {{ formatTimestamp(currentTime) }}</span>
            <span>Отрезок: {{ selectedDurationLabel }}</span>
            <span>Start: {{ startSeconds !== undefined ? formatTimestamp(startSeconds) : '—' }}</span>
            <span>End: {{ endSeconds !== undefined ? formatTimestamp(endSeconds) : '—' }}</span>
          </div>
          <div class="player-controls">
            <button type="button" :disabled="!canUseSelectionControls" @click="seekToSelectionStart">К началу</button>
            <button type="button" :disabled="!canUseSelectionControls" @click="seekToSelectionEnd">К концу</button>
            <button type="button" @click="setStartFromCurrent">Начало из позиции</button>
            <button type="button" @click="setEndFromCurrent">Конец из позиции</button>
            <button type="button" :disabled="!canUseSelectionControls" @click="toggleSelectedSegment">
              {{ selectionPlayButtonLabel }}
            </button>
          </div>
        </div>

        <TimelineSelector
          v-if="durationSeconds > 0"
          :duration="durationSeconds"
          :current-time="currentTime"
          :start="startSeconds ?? 0"
          :end="endSeconds ?? Math.min(durationSeconds, MIN_FRAGMENT_SECONDS)"
          :disabled="!canUseSelectionControls"
          @update:start="setStartSeconds"
          @update:end="setEndSeconds"
          @seek="seekPlayer"
        />

        <div class="clip-controls">
          <div class="time-grid">
            <label>
              <span>Начало</span>
              <input v-model="startTimestamp" placeholder="01:12.250" autocomplete="off" @blur="normalizeTimestamp('start')" />
            </label>
            <label>
              <span>Конец</span>
              <input v-model="endTimestamp" placeholder="01:42.750" autocomplete="off" @blur="normalizeTimestamp('end')" />
            </label>
          </div>

          <div class="trim-controls">
            <div class="trim-control-group">
              <span>Начало</span>
              <button type="button" @click="nudgeStart(-1)">-1с</button>
              <button type="button" @click="nudgeStart(-0.1)">-0.1с</button>
              <button type="button" @click="nudgeStart(0.1)">+0.1с</button>
              <button type="button" @click="nudgeStart(1)">+1с</button>
              <button type="button" @click="setStartFromCurrent">Взять из позиции</button>
            </div>
            <div class="trim-control-group">
              <span>Конец</span>
              <button type="button" @click="nudgeEnd(-1)">-1с</button>
              <button type="button" @click="nudgeEnd(-0.1)">-0.1с</button>
              <button type="button" @click="nudgeEnd(0.1)">+0.1с</button>
              <button type="button" @click="nudgeEnd(1)">+1с</button>
              <button type="button" @click="setEndFromCurrent">Взять из позиции</button>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title-row">
          <h2>Экспорт</h2>
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

        <div class="format-toggle quality-toggle" :class="{ disabled: exportFormat !== 'mp4' }" role="radiogroup" aria-label="Качество MP4">
          <span>Качество MP4</span>
          <label v-for="option in videoQualityOptions" :key="option.value">
            <input v-model="videoQuality" type="radio" :value="option.value" :disabled="exportFormat !== 'mp4'" />
            {{ option.label }}
          </label>
          <small v-if="exportFormat !== 'mp4'">Выберите MP4, чтобы изменить качество. По умолчанию: 720p.</small>
        </div>

        <label for="folder">Папка для сохранения</label>
        <div class="input-row">
          <input id="folder" :value="outputDirectory" readonly placeholder="Папка не выбрана" />
          <button type="button" @click="selectOutputFolder">Выбрать</button>
        </div>

        <p v-if="plannedOutputPath" class="path-hint">{{ exportLabel }} будет сохранён: {{ plannedOutputPath }}</p>
        <p v-if="lastOutputPath" class="path-hint">Последний экспорт: {{ lastOutputPath }}</p>

        <div class="action-row">
          <button class="export-button" type="button" :disabled="!canExport" @click="exportClip">
            {{ isExporting ? 'Экспорт...' : `Экспорт ${exportLabel}` }}
          </button>
          <button type="button" :disabled="!canDownloadThumbnail" @click="downloadThumbnail">
            {{ isDownloadingThumbnail ? 'Скачиваю...' : 'Скачать thumbnail' }}
          </button>
        </div>
      </section>

      <section v-if="statusMessage" class="status" :class="statusKind" role="status">
        <strong>{{ statusMessage }}</strong>
        <p v-if="errorDetails">{{ errorDetails }}</p>
      </section>
    </section>
  </main>
</template>
