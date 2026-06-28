<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import type { AppErrorPayload } from '../../../shared/types'
import type {
  SiqMediaKind,
  SiqPackageDraft,
  SiqQuestionDraft,
  SiqQuestionType,
  SiqRoundDraft,
  SiqSelectionMode,
  SiqThemeDraft
} from '../../../shared/siq'

const props = defineProps<{
  lastExportPath: string
}>()

const emit = defineEmits<{
  openMediaEditor: []
}>()

type StatusKind = 'idle' | 'success' | 'error'
type EditorSection = 'package' | 'round' | 'theme' | 'question' | 'media'
type DragItem =
  | { kind: 'round'; roundIndex: number }
  | { kind: 'theme'; roundIndex: number; themeIndex: number }
  | { kind: 'question'; roundIndex: number; themeIndex: number; questionIndex: number }
interface PersistedPackageEditorState {
  packageDraft: SiqPackageDraft
  outputDirectory: string
  outputFileName: string
  loadedSourcePath: string
  savedOutputPath: string
  selectedRoundIndex: number
  selectedThemeIndex: number
  selectedQuestionIndex: number
  collapsedRounds: string[]
  collapsedThemes: string[]
  collapsedQuestions: string[]
  collapsedEditorSections: EditorSection[]
  isPackageDirty: boolean
}

const questionTypeOptions = [
  { value: '', label: 'По умолчанию' },
  { value: 'simple', label: 'Обычный' },
  { value: 'withButton', label: 'С кнопкой' },
  { value: 'stake', label: 'Со ставкой' },
  { value: 'stakeAll', label: 'Ставка для всех' },
  { value: 'secret', label: 'Секрет' },
  { value: 'secretPublicPrice', label: 'Секрет с открытой ценой' },
  { value: 'secretNoQuestion', label: 'Секрет без вопроса' },
  { value: 'noRisk', label: 'Без риска' },
  { value: 'forYourself', label: 'Для себя' },
  { value: 'forAll', label: 'Для всех' }
] as const
const answerTypeOptions = [
  { value: 'text', label: 'Текст' },
  { value: 'number', label: 'Число' },
  { value: 'point', label: 'Точка' },
  { value: 'select', label: 'Выбор варианта' },
  { value: 'client', label: 'Клиентский ввод' }
] as const
const secretQuestionTypes = new Set<SiqQuestionType>(['secret', 'secretPublicPrice', 'secretNoQuestion'])
const stakeQuestionTypes = new Set<SiqQuestionType>(['stake', 'stakeAll'])
const secretSelectionOptions: Array<{ value: SiqSelectionMode; label: string }> = [
  { value: 'exceptCurrent', label: 'Кроме текущего игрока' },
  { value: 'any', label: 'Любому игроку' }
]
const stakeSelectionOptions: Array<{ value: SiqSelectionMode; label: string }> = [
  { value: 'allPossible', label: 'Все, кто может ставить' },
  { value: 'highest', label: 'Игрок с максимальной суммой' },
  { value: 'any', label: 'Любой игрок' },
  { value: 'exceptCurrent', label: 'Кроме текущего игрока' }
]
const packageEditorStorageKey = 'sigame-media-cutter:package-editor-state:v1'

const packageDraft = ref<SiqPackageDraft>(createEmptyPackage())
const outputDirectory = ref('')
const outputFileName = ref('')
const loadedSourcePath = ref('')
const savedOutputPath = ref('')
const selectedRoundIndex = ref(0)
const selectedThemeIndex = ref(0)
const selectedQuestionIndex = ref(0)
const collapsedRounds = ref<Set<string>>(new Set())
const collapsedThemes = ref<Set<string>>(new Set())
const collapsedQuestions = ref<Set<string>>(new Set())
const collapsedEditorSections = ref<Set<EditorSection>>(new Set())
const isBusy = ref(false)
const statusKind = ref<StatusKind>('idle')
const statusMessage = ref('')
const errorDetails = ref('')
const mediaPreviewUrl = ref('')
const mediaPreviewError = ref('')
const dragItem = ref<DragItem | undefined>()
const isPackageDirty = ref(false)
const isApplyingPersistedState = ref(false)

const currentRound = computed(() => packageDraft.value.rounds[selectedRoundIndex.value])
const currentTheme = computed(() => currentRound.value?.themes[selectedThemeIndex.value])
const currentQuestion = computed(() => currentTheme.value?.questions[selectedQuestionIndex.value])
const currentQuestionMedia = computed(() => currentQuestion.value?.media)
const canSave = computed(() => Boolean(outputDirectory.value.trim()) && Boolean(packageDraft.value.title.trim()) && !isBusy.value)
const lastExportMediaKind = computed<SiqMediaKind | undefined>(() => mediaKindFromPath(props.lastExportPath))
const mediaPreviewKind = computed(() => currentQuestionMedia.value?.kind)
const draftWarningCount = computed(() => countDraftWarnings(packageDraft.value))
collapseAllStructure()

watch(
  [
    packageDraft,
    outputDirectory,
    outputFileName,
    loadedSourcePath,
    selectedRoundIndex,
    selectedThemeIndex,
    selectedQuestionIndex,
    collapsedRounds,
    collapsedThemes,
    collapsedQuestions,
    collapsedEditorSections
  ],
  () => {
    if (!isApplyingPersistedState.value) {
      isPackageDirty.value = true
    }

    persistPackageEditorState()
  },
  { deep: true, flush: 'sync' }
)

onMounted(() => {
  restorePackageEditorState()
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

function createEmptyPackage(): SiqPackageDraft {
  return {
    title: 'Новый пакет',
    author: '',
    difficulty: 5,
    rounds: [createRound('1', 'standard', 0)]
  }
}

function createRound(name: string, type: 'standard' | 'final' = 'standard', roundIndex = 0): SiqRoundDraft {
  return {
    name,
    type,
    themes: [createTheme('Новая тема', roundIndex)]
  }
}

function createTheme(name: string, roundIndex: number): SiqThemeDraft {
  return {
    name,
    questions: [createQuestion(roundPriceStep(roundIndex))]
  }
}

function createQuestion(price: number): SiqQuestionDraft {
  return {
    price,
    type: '',
    answerType: 'text',
    text: '',
    answer: ''
  }
}

function newPackage(): void {
  packageDraft.value = createEmptyPackage()
  outputFileName.value = ''
  loadedSourcePath.value = ''
  savedOutputPath.value = ''
  collapseAllStructure()
  collapsedEditorSections.value = new Set()
  selectItem(0, 0, 0)
  isPackageDirty.value = true
  persistPackageEditorState()
  showStatus('idle', 'Создан новый черновик пакета.')
}

async function openPackage(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  clearStatus()
  isBusy.value = true

  try {
    const selected = await api.selectSiqPackage()

    if (!selected.ok) {
      if (selected.error.code !== 'folder-selection-cancelled') {
        showError(selected.error)
      }
      return
    }

    const imported = await api.importSiqPackage({ filePath: selected.data })

    if (!imported.ok) {
      showError(imported.error)
      return
    }

    packageDraft.value = imported.data.package
    loadedSourcePath.value = imported.data.sourcePath
    outputDirectory.value = directoryName(imported.data.sourcePath)
    outputFileName.value = fileBaseName(imported.data.sourcePath)
    savedOutputPath.value = ''
    collapseAllStructure()
    collapsedEditorSections.value = new Set()
    selectItem(0, 0, 0)
    isPackageDirty.value = false
    persistPackageEditorState()
    showStatus('success', `Пакет открыт: ${imported.data.sourcePath}`)
  } catch (error) {
    showUnexpectedError(error, 'Не удалось открыть .siq пакет.')
  } finally {
    isBusy.value = false
  }
}

async function selectOutputFolder(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  const result = await api.selectOutputFolder()

  if (!result.ok) {
    if (result.error.code !== 'folder-selection-cancelled') {
      showError(result.error)
    }
    return
  }

  outputDirectory.value = result.data
}

async function savePackage(): Promise<void> {
  const api = getApi()

  if (!api) {
    return
  }

  clearStatus()
  isBusy.value = true

  try {
    const result = await api.createSiqPackage({
      package: cloneForIpc(packageDraft.value),
      outputDirectory: outputDirectory.value,
      outputFileName: outputFileName.value || packageDraft.value.title
    })

    if (!result.ok) {
      showError(result.error)
      return
    }

    savedOutputPath.value = result.data.outputPath
    isPackageDirty.value = false
    persistPackageEditorState()
    showStatus('success', `Пакет сохранён: ${result.data.outputPath}`)
  } catch (error) {
    showUnexpectedError(error, 'Не удалось сохранить .siq пакет.')
  } finally {
    isBusy.value = false
  }
}

function addRound(): void {
  const roundIndex = packageDraft.value.rounds.length

  packageDraft.value.rounds.push(createRound(String(roundIndex + 1), 'standard', roundIndex))
  collapseNewRound(roundIndex)
  selectItem(roundIndex, 0, 0)
}

function addFinalRound(): void {
  const roundIndex = packageDraft.value.rounds.length

  packageDraft.value.rounds.push(createRound('Финал', 'final', roundIndex))
  collapseNewRound(roundIndex)
  selectItem(roundIndex, 0, 0)
}

function removeRound(roundIndex: number): void {
  if (packageDraft.value.rounds.length <= 1) {
    return
  }

  packageDraft.value.rounds.splice(roundIndex, 1)
  collapseAllStructure()
  selectItem(Math.max(0, roundIndex - 1), 0, 0)
}

function addThemeToRound(roundIndex: number): void {
  const round = packageDraft.value.rounds[roundIndex]

  if (!round) {
    return
  }

  round.themes.push(createTheme('Новая тема', roundIndex))
  collapseNewTheme(roundIndex, round.themes.length - 1)
  selectItem(roundIndex, round.themes.length - 1, 0)
}

function removeTheme(roundIndex: number, themeIndex: number): void {
  const round = packageDraft.value.rounds[roundIndex]

  if (!round || round.themes.length <= 1) {
    return
  }

  round.themes.splice(themeIndex, 1)
  selectItem(roundIndex, Math.max(0, themeIndex - 1), 0)
}

function addQuestionToTheme(roundIndex: number, themeIndex: number): void {
  const theme = packageDraft.value.rounds[roundIndex]?.themes[themeIndex]

  if (!theme) {
    return
  }

  theme.questions.push(createQuestion((theme.questions.length + 1) * roundPriceStep(roundIndex)))
  collapseNewQuestion(roundIndex, themeIndex, theme.questions.length - 1)
  selectItem(roundIndex, themeIndex, theme.questions.length - 1)
}

function removeQuestion(roundIndex: number, themeIndex: number, questionIndex: number): void {
  const theme = packageDraft.value.rounds[roundIndex]?.themes[themeIndex]

  if (!theme || theme.questions.length <= 1) {
    return
  }

  theme.questions.splice(questionIndex, 1)
  selectItem(roundIndex, themeIndex, Math.max(0, questionIndex - 1))
}

function selectItem(roundIndex: number, themeIndex: number, questionIndex: number): void {
  selectedRoundIndex.value = clampIndex(roundIndex, packageDraft.value.rounds.length)
  selectedThemeIndex.value = clampIndex(themeIndex, currentRound.value?.themes.length ?? 0)
  selectedQuestionIndex.value = clampIndex(questionIndex, currentTheme.value?.questions.length ?? 0)
  void refreshLocalMediaPreview()
}

async function useLastExportAsMedia(): Promise<void> {
  if (!currentQuestion.value || !props.lastExportPath || !lastExportMediaKind.value) {
    showStatus('error', 'Сначала экспортируйте MP3 или MP4 во вкладке медиа.')
    return
  }

  currentQuestion.value.media = {
    kind: lastExportMediaKind.value,
    sourcePath: props.lastExportPath,
    fileName: fileName(props.lastExportPath),
    placement: lastExportMediaKind.value === 'audio' ? 'background' : undefined
  }
  await refreshLocalMediaPreview()
  showStatus('success', 'Последний экспорт добавлен как медиа вопроса.')
}

async function selectMediaFromDisk(): Promise<void> {
  const api = getApi()

  if (!api || !currentQuestion.value) {
    return
  }

  const result = await api.selectMediaFile()

  if (!result.ok) {
    if (result.error.code !== 'folder-selection-cancelled') {
      showError(result.error)
    }
    return
  }

  const kind = mediaKindFromPath(result.data)

  if (!kind) {
    showStatus('error', 'Этот тип медиа пока нельзя добавить в вопрос.', 'Поддерживаются audio, video, image и html-файлы.')
    return
  }

  currentQuestion.value.media = {
    kind,
    sourcePath: result.data,
    fileName: fileName(result.data),
    placement: kind === 'audio' ? 'background' : undefined
  }
  await refreshLocalMediaPreview()
  showStatus('success', 'Медиафайл с диска добавлен в вопрос.')
}

function clearQuestionMedia(): void {
  if (currentQuestion.value) {
    currentQuestion.value.media = undefined
  }

  mediaPreviewUrl.value = ''
  mediaPreviewError.value = ''
}

function toggleRound(roundIndex: number): void {
  toggleSetValue(collapsedRounds.value, `r:${roundIndex}`)
}

function toggleTheme(roundIndex: number, themeIndex: number): void {
  toggleSetValue(collapsedThemes.value, `t:${roundIndex}:${themeIndex}`)
}

function toggleQuestion(roundIndex: number, themeIndex: number, questionIndex: number): void {
  toggleSetValue(collapsedQuestions.value, `q:${roundIndex}:${themeIndex}:${questionIndex}`)
}

function isRoundCollapsed(roundIndex: number): boolean {
  return collapsedRounds.value.has(`r:${roundIndex}`)
}

function isThemeCollapsed(roundIndex: number, themeIndex: number): boolean {
  return collapsedThemes.value.has(`t:${roundIndex}:${themeIndex}`)
}

function isQuestionCollapsed(roundIndex: number, themeIndex: number, questionIndex: number): boolean {
  return collapsedQuestions.value.has(`q:${roundIndex}:${themeIndex}:${questionIndex}`)
}

function toggleEditorSection(section: EditorSection): void {
  const nextValues = new Set(collapsedEditorSections.value)

  if (nextValues.has(section)) {
    nextValues.delete(section)
  } else {
    nextValues.add(section)
  }

  collapsedEditorSections.value = nextValues
}

function isEditorSectionCollapsed(section: EditorSection): boolean {
  return collapsedEditorSections.value.has(section)
}

async function refreshLocalMediaPreview(): Promise<void> {
  const media = currentQuestionMedia.value

  mediaPreviewUrl.value = ''
  mediaPreviewError.value = ''

  if (!media || media.kind === 'html') {
    return
  }

  const api = getApi()

  if (!api) {
    return
  }

  const result = await api.prepareLocalMediaPreview({ filePath: media.sourcePath })

  if (!result.ok) {
    mediaPreviewError.value = result.error.message
    return
  }

  mediaPreviewUrl.value = result.data.previewUrl
}

function toggleSetValue(values: Set<string>, value: string): void {
  const nextValues = new Set(values)

  if (nextValues.has(value)) {
    nextValues.delete(value)
  } else {
    nextValues.add(value)
  }

  if (value.startsWith('r:')) {
    collapsedRounds.value = nextValues
  } else if (value.startsWith('t:')) {
    collapsedThemes.value = nextValues
  } else {
    collapsedQuestions.value = nextValues
  }
}

function collapseAllStructure(): void {
  const roundKeys = new Set<string>()
  const themeKeys = new Set<string>()
  const questionKeys = new Set<string>()

  packageDraft.value.rounds.forEach((round, roundIndex) => {
    roundKeys.add(`r:${roundIndex}`)
    round.themes.forEach((theme, themeIndex) => {
      themeKeys.add(`t:${roundIndex}:${themeIndex}`)
      theme.questions.forEach((_question, questionIndex) => {
        questionKeys.add(`q:${roundIndex}:${themeIndex}:${questionIndex}`)
      })
    })
  })

  collapsedRounds.value = roundKeys
  collapsedThemes.value = themeKeys
  collapsedQuestions.value = questionKeys
}

function collapseNewRound(roundIndex: number): void {
  collapsedRounds.value = new Set([...collapsedRounds.value, `r:${roundIndex}`])
  collapseNewTheme(roundIndex, 0)
}

function collapseNewTheme(roundIndex: number, themeIndex: number): void {
  collapsedThemes.value = new Set([...collapsedThemes.value, `t:${roundIndex}:${themeIndex}`])
  collapseNewQuestion(roundIndex, themeIndex, 0)
}

function collapseNewQuestion(roundIndex: number, themeIndex: number, questionIndex: number): void {
  collapsedQuestions.value = new Set([...collapsedQuestions.value, `q:${roundIndex}:${themeIndex}:${questionIndex}`])
}

function roundPriceStep(roundIndex: number): number {
  return (roundIndex + 1) * 100
}

function recalculateQuestionPrices(): void {
  packageDraft.value.rounds.forEach((round, roundIndex) => {
    const priceStep = roundPriceStep(roundIndex)

    round.themes.forEach((theme) => {
      theme.questions.forEach((question, questionIndex) => {
        question.price = (questionIndex + 1) * priceStep
      })
    })
  })
}

function startDrag(item: DragItem, event: DragEvent): void {
  dragItem.value = item
  event.dataTransfer?.setData('text/plain', JSON.stringify(item))

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function endDrag(): void {
  dragItem.value = undefined
}

function dropRound(targetRoundIndex: number): void {
  const item = dragItem.value

  if (!item || item.kind !== 'round' || item.roundIndex === targetRoundIndex) {
    return
  }

  moveArrayItem(packageDraft.value.rounds, item.roundIndex, targetRoundIndex)
  recalculateQuestionPrices()
  selectItem(targetRoundIndex, 0, 0)
  endDrag()
}

function dropTheme(roundIndex: number, targetThemeIndex: number): void {
  const item = dragItem.value
  const themes = packageDraft.value.rounds[roundIndex]?.themes

  if (!item || item.kind !== 'theme' || item.roundIndex !== roundIndex || !themes || item.themeIndex === targetThemeIndex) {
    return
  }

  moveArrayItem(themes, item.themeIndex, targetThemeIndex)
  recalculateQuestionPrices()
  selectItem(roundIndex, targetThemeIndex, 0)
  endDrag()
}

function dropQuestion(roundIndex: number, themeIndex: number, targetQuestionIndex: number): void {
  const item = dragItem.value
  const questions = packageDraft.value.rounds[roundIndex]?.themes[themeIndex]?.questions

  if (
    !item ||
    item.kind !== 'question' ||
    item.roundIndex !== roundIndex ||
    item.themeIndex !== themeIndex ||
    !questions ||
    item.questionIndex === targetQuestionIndex
  ) {
    return
  }

  moveArrayItem(questions, item.questionIndex, targetQuestionIndex)
  recalculateQuestionPrices()
  selectItem(roundIndex, themeIndex, targetQuestionIndex)
  endDrag()
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): void {
  const [item] = items.splice(fromIndex, 1)

  if (!item) {
    return
  }

  items.splice(toIndex, 0, item)
}

function isSecretQuestion(type?: SiqQuestionType): boolean {
  return secretQuestionTypes.has(type ?? '')
}

function isStakeQuestion(type?: SiqQuestionType): boolean {
  return stakeQuestionTypes.has(type ?? '')
}

function isQuestionDraftIncomplete(question: SiqQuestionDraft): boolean {
  return !question.answer.trim() || (!question.text.trim() && !question.media)
}

function countDraftWarnings(packageValue: SiqPackageDraft): number {
  return packageValue.rounds.reduce(
    (total, round) =>
      total +
      round.themes.reduce(
        (themeTotal, theme) => themeTotal + theme.questions.filter((question) => isQuestionDraftIncomplete(question)).length,
        0
      ),
    0
  )
}

function persistPackageEditorState(): void {
  try {
    const state: PersistedPackageEditorState = {
      packageDraft: cloneForIpc(packageDraft.value),
      outputDirectory: outputDirectory.value,
      outputFileName: outputFileName.value,
      loadedSourcePath: loadedSourcePath.value,
      savedOutputPath: savedOutputPath.value,
      selectedRoundIndex: selectedRoundIndex.value,
      selectedThemeIndex: selectedThemeIndex.value,
      selectedQuestionIndex: selectedQuestionIndex.value,
      collapsedRounds: [...collapsedRounds.value],
      collapsedThemes: [...collapsedThemes.value],
      collapsedQuestions: [...collapsedQuestions.value],
      collapsedEditorSections: [...collapsedEditorSections.value],
      isPackageDirty: isPackageDirty.value
    }

    localStorage.setItem(packageEditorStorageKey, JSON.stringify(state))
  } catch {
    // localStorage may be unavailable; package export remains the source of truth.
  }
}

function restorePackageEditorState(): void {
  const rawState = localStorage.getItem(packageEditorStorageKey)

  if (!rawState) {
    return
  }

  try {
    const state = JSON.parse(rawState) as Partial<PersistedPackageEditorState>

    if (!state.packageDraft?.rounds?.length) {
      return
    }

    isApplyingPersistedState.value = true
    packageDraft.value = state.packageDraft
    outputDirectory.value = state.outputDirectory ?? ''
    outputFileName.value = state.outputFileName ?? ''
    loadedSourcePath.value = state.loadedSourcePath ?? ''
    savedOutputPath.value = state.savedOutputPath ?? ''
    collapsedRounds.value = new Set(state.collapsedRounds ?? [])
    collapsedThemes.value = new Set(state.collapsedThemes ?? [])
    collapsedQuestions.value = new Set(state.collapsedQuestions ?? [])
    collapsedEditorSections.value = new Set(state.collapsedEditorSections ?? [])
    selectItem(state.selectedRoundIndex ?? 0, state.selectedThemeIndex ?? 0, state.selectedQuestionIndex ?? 0)
    isPackageDirty.value = Boolean(state.isPackageDirty)
    showStatus('idle', 'Восстановлен последний черновик пакета.')
  } catch {
    localStorage.removeItem(packageEditorStorageKey)
  } finally {
    isApplyingPersistedState.value = false
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  persistPackageEditorState()

  if (!isPackageDirty.value) {
    return
  }

  event.preventDefault()
  event.returnValue = 'В редакторе пакета есть несохранённые изменения. Закрыть приложение?'
}

function mediaKindFromPath(value: string): SiqMediaKind | undefined {
  const lower = value.toLowerCase()

  if (/\.(mp3|wav|ogg|m4a)$/i.test(lower)) {
    return 'audio'
  }

  if (/\.(mp4|webm|mov)$/i.test(lower)) {
    return 'video'
  }

  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(lower)) {
    return 'image'
  }

  if (/\.(html|htm)$/i.test(lower)) {
    return 'html'
  }

  return undefined
}

function cloneForIpc(value: SiqPackageDraft): SiqPackageDraft {
  return JSON.parse(JSON.stringify(toRaw(value))) as SiqPackageDraft
}

function getApi(): typeof window.sigameApi | undefined {
  if (window.sigameApi) {
    return window.sigameApi
  }

  showStatus('error', 'Preload API не загружен.', 'Перезапустите приложение.')
  return undefined
}

function showError(error: AppErrorPayload): void {
  showStatus('error', error.message, error.details)
}

function showUnexpectedError(error: unknown, message: string): void {
  showStatus('error', message, error instanceof Error ? error.message : String(error))
}

function showStatus(kind: StatusKind, message: string, details = ''): void {
  statusKind.value = kind
  statusMessage.value = message
  errorDetails.value = details
}

function clearStatus(): void {
  showStatus('idle', '')
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }

  return Math.min(Math.max(index, 0), length - 1)
}

function directoryName(value: string): string {
  return value.replace(/[\\/][^\\/]*$/, '')
}

function fileName(value: string): string {
  return value.split(/[\\/]/).pop() || value
}

function fileBaseName(value: string): string {
  return fileName(value).replace(/\.siq$/i, '')
}

function formatList(value: string[] | undefined): string {
  return (value ?? []).join('\n')
}

function parseList(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function eventValue(event: Event): string {
  return event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement ? event.target.value : ''
}
</script>

<template>
  <section class="package-editor">
    <header class="package-toolbar">
      <div class="panel-title-row">
        <span class="section-kicker">Package editor</span>
        <h1>Редактор пакета</h1>
        <span v-if="draftWarningCount > 0" class="draft-warning-pill">
          Черновиковые вопросы: {{ draftWarningCount }}
        </span>
      </div>
      <div class="header-actions">
        <button type="button" @click="newPackage">Новый</button>
        <button type="button" :disabled="isBusy" @click="openPackage">
          {{ isBusy ? 'Открываю...' : 'Открыть .siq' }}
        </button>
        <button class="primary-button" type="button" :disabled="!canSave" @click="savePackage">
          {{ isBusy ? 'Сохраняю...' : 'Сохранить .siq' }}
        </button>
      </div>
    </header>

    <section class="package-layout">
      <aside class="package-tree">
        <div class="tree-actions">
          <button type="button" @click="addRound">+ Раунд</button>
          <button type="button" @click="addFinalRound">+ Финал</button>
        </div>

        <div v-for="(round, roundIndex) in packageDraft.rounds" :key="roundIndex" class="tree-round">
          <div class="tree-row">
            <button type="button" class="tree-toggle" :aria-expanded="!isRoundCollapsed(roundIndex)" @click="toggleRound(roundIndex)">
              {{ isRoundCollapsed(roundIndex) ? '›' : '⌄' }}
            </button>
            <button
              type="button"
              class="tree-node round-node"
              :class="{ selected: selectedRoundIndex === roundIndex }"
              @click="selectItem(roundIndex, 0, 0)"
            >
              {{ round.type === 'final' ? 'Финал' : 'Раунд' }}: {{ round.name }}
            </button>
          </div>

          <template v-if="!isRoundCollapsed(roundIndex)">
            <div v-for="(theme, themeIndex) in round.themes" :key="themeIndex" class="tree-theme">
              <div class="tree-row">
                <button
                  type="button"
                  class="tree-toggle"
                  :aria-expanded="!isThemeCollapsed(roundIndex, themeIndex)"
                  @click="toggleTheme(roundIndex, themeIndex)"
                >
                  {{ isThemeCollapsed(roundIndex, themeIndex) ? '›' : '⌄' }}
                </button>
                <button
                  type="button"
                  class="tree-node theme-node"
                  :class="{ selected: selectedRoundIndex === roundIndex && selectedThemeIndex === themeIndex }"
                  @click="selectItem(roundIndex, themeIndex, 0)"
                >
                  {{ theme.name }}
                </button>
              </div>

              <template v-if="!isThemeCollapsed(roundIndex, themeIndex)">
                <button
                  v-for="(question, questionIndex) in theme.questions"
                  :key="questionIndex"
                  type="button"
                  class="tree-node question-node"
                  :class="{
                    invalid: isQuestionDraftIncomplete(question),
                    selected:
                      selectedRoundIndex === roundIndex &&
                      selectedThemeIndex === themeIndex &&
                      selectedQuestionIndex === questionIndex
                  }"
                  @click="selectItem(roundIndex, themeIndex, questionIndex)"
                >
                  {{ question.price }}: {{ question.answer || 'Без ответа' }}
                </button>
              </template>
            </div>
          </template>
        </div>
      </aside>

      <section class="package-properties">
        <section class="workspace-panel package-section">
          <div class="panel-header compact">
            <div class="panel-title-row">
              <span class="section-kicker">Package</span>
              <h2>Свойства пакета</h2>
            </div>
            <button
              type="button"
              class="section-collapse-button"
              :aria-expanded="!isEditorSectionCollapsed('package')"
              @click="toggleEditorSection('package')"
            >
              {{ isEditorSectionCollapsed('package') ? '›' : '⌄' }}
            </button>
          </div>

          <template v-if="!isEditorSectionCollapsed('package')">
            <div class="editor-grid">
              <label>
                <span>Название</span>
                <input v-model="packageDraft.title" autocomplete="off" />
              </label>
              <label>
                <span>Автор</span>
                <input v-model="packageDraft.author" autocomplete="off" />
              </label>
              <label>
                <span>Сложность</span>
                <input v-model.number="packageDraft.difficulty" type="number" min="1" max="10" />
              </label>
            </div>

            <label>
              <span>Папка сохранения</span>
              <div class="input-row">
                <input :value="outputDirectory" readonly placeholder="Папка не выбрана" :title="outputDirectory" />
                <button type="button" @click="selectOutputFolder">Выбрать</button>
              </div>
            </label>

            <label>
              <span>Имя файла</span>
              <input v-model="outputFileName" placeholder="По умолчанию используется название пакета" autocomplete="off" />
            </label>

            <p v-if="loadedSourcePath" class="path-hint" :title="loadedSourcePath">Открыт: {{ loadedSourcePath }}</p>
            <p v-if="savedOutputPath" class="path-hint" :title="savedOutputPath">Сохранён: {{ savedOutputPath }}</p>
          </template>
        </section>

        <section
          v-for="(round, roundIndex) in packageDraft.rounds"
          :key="roundIndex"
          class="workspace-panel package-section document-round"
          :class="{ selected: selectedRoundIndex === roundIndex }"
          @dragover.prevent
          @drop.prevent="dropRound(roundIndex)"
        >
          <div class="panel-header compact">
            <div class="panel-title-row">
              <span class="section-kicker">{{ round.type === 'final' ? 'Final round' : 'Round' }}</span>
              <h2>{{ round.name || 'Раунд без названия' }}</h2>
            </div>
            <div class="header-actions">
              <span
                class="drag-handle"
                draggable="true"
                title="Перетащить раунд"
                @dragstart="startDrag({ kind: 'round', roundIndex }, $event)"
                @dragend="endDrag"
              >
                ⇅
              </span>
              <button type="button" @click="addThemeToRound(roundIndex)">+ Тема</button>
              <button type="button" :disabled="packageDraft.rounds.length <= 1" @click="removeRound(roundIndex)">Удалить</button>
              <button type="button" class="section-collapse-button" :aria-expanded="!isRoundCollapsed(roundIndex)" @click="toggleRound(roundIndex)">
                {{ isRoundCollapsed(roundIndex) ? '›' : '⌄' }}
              </button>
            </div>
          </div>

          <template v-if="!isRoundCollapsed(roundIndex)">
            <div class="editor-grid">
              <label>
                <span>Название раунда</span>
                <input v-model="round.name" autocomplete="off" @focus="selectItem(roundIndex, 0, 0)" />
              </label>
              <label>
                <span>Тип</span>
                <select v-model="round.type" @focus="selectItem(roundIndex, 0, 0)">
                  <option value="standard">Обычный</option>
                  <option value="final">Финальный</option>
                </select>
              </label>
            </div>

            <section
              v-for="(theme, themeIndex) in round.themes"
              :key="themeIndex"
              class="document-theme"
              :class="{ selected: selectedRoundIndex === roundIndex && selectedThemeIndex === themeIndex }"
              @dragover.prevent
              @drop.stop.prevent="dropTheme(roundIndex, themeIndex)"
            >
              <div class="panel-header compact">
                <div class="panel-title-row">
                  <span class="section-kicker">Theme</span>
                  <h3>{{ theme.name || 'Тема без названия' }}</h3>
                </div>
                <div class="header-actions">
                  <span
                    class="drag-handle"
                    draggable="true"
                    title="Перетащить тему"
                    @dragstart.stop="startDrag({ kind: 'theme', roundIndex, themeIndex }, $event)"
                    @dragend.stop="endDrag"
                  >
                    ⇅
                  </span>
                  <button type="button" @click="addQuestionToTheme(roundIndex, themeIndex)">+ Вопрос</button>
                  <button type="button" :disabled="round.themes.length <= 1" @click="removeTheme(roundIndex, themeIndex)">Удалить</button>
                  <button
                    type="button"
                    class="section-collapse-button"
                    :aria-expanded="!isThemeCollapsed(roundIndex, themeIndex)"
                    @click="toggleTheme(roundIndex, themeIndex)"
                  >
                    {{ isThemeCollapsed(roundIndex, themeIndex) ? '›' : '⌄' }}
                  </button>
                </div>
              </div>

              <template v-if="!isThemeCollapsed(roundIndex, themeIndex)">
                <div class="editor-grid">
                  <label>
                    <span>Название темы</span>
                    <input v-model="theme.name" autocomplete="off" @focus="selectItem(roundIndex, themeIndex, 0)" />
                  </label>
                  <label>
                    <span>Комментарий к теме</span>
                    <input v-model="theme.comments" autocomplete="off" @focus="selectItem(roundIndex, themeIndex, 0)" />
                  </label>
                </div>

                <section
                  v-for="(question, questionIndex) in theme.questions"
                  :key="questionIndex"
                  class="document-question"
                  :class="{
                    invalid: isQuestionDraftIncomplete(question),
                    selected:
                      selectedRoundIndex === roundIndex &&
                      selectedThemeIndex === themeIndex &&
                      selectedQuestionIndex === questionIndex
                  }"
                  @dragover.prevent
                  @drop.stop.prevent="dropQuestion(roundIndex, themeIndex, questionIndex)"
                >
                  <div class="panel-header compact">
                    <div class="panel-title-row">
                      <span class="section-kicker">Question</span>
                      <h3>{{ question.price }}: {{ question.answer || 'Без ответа' }}</h3>
                    </div>
                    <div class="header-actions">
                      <span
                        class="drag-handle"
                        draggable="true"
                        title="Перетащить вопрос"
                        @dragstart.stop="startDrag({ kind: 'question', roundIndex, themeIndex, questionIndex }, $event)"
                        @dragend.stop="endDrag"
                      >
                        ⇅
                      </span>
                      <button type="button" :disabled="theme.questions.length <= 1" @click="removeQuestion(roundIndex, themeIndex, questionIndex)">Удалить</button>
                      <button
                        type="button"
                        class="section-collapse-button"
                        :aria-expanded="!isQuestionCollapsed(roundIndex, themeIndex, questionIndex)"
                        @click="toggleQuestion(roundIndex, themeIndex, questionIndex)"
                      >
                        {{ isQuestionCollapsed(roundIndex, themeIndex, questionIndex) ? '›' : '⌄' }}
                      </button>
                    </div>
                  </div>

                  <template v-if="!isQuestionCollapsed(roundIndex, themeIndex, questionIndex)">
                    <div class="editor-grid">
                      <label>
                        <span>Цена</span>
                        <input v-model.number="question.price" type="number" min="1" step="100" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                      </label>
                      <label>
                        <span>Тип вопроса</span>
                        <select v-model="question.type" @focus="selectItem(roundIndex, themeIndex, questionIndex)">
                          <option v-for="option in questionTypeOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                      </label>
                      <label>
                        <span>Тип ответа</span>
                        <select v-model="question.answerType" @focus="selectItem(roundIndex, themeIndex, questionIndex)">
                          <option v-for="option in answerTypeOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                          </option>
                        </select>
                      </label>
                      <label>
                        <span>Ответ</span>
                        <input v-model="question.answer" autocomplete="off" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                      </label>
                      <label>
                        <span>Допуск ответа</span>
                        <input v-model="question.answerDeviation" placeholder="Для числа/точки" autocomplete="off" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                      </label>
                    </div>

                    <section v-if="isSecretQuestion(question.type)" class="special-question-panel">
                      <div class="panel-title-row">
                        <span class="section-kicker">Secret</span>
                        <h3>Параметры секрета</h3>
                      </div>
                      <div class="editor-grid">
                        <label>
                          <span>Тема секрета</span>
                          <input v-model="question.secretTheme" autocomplete="off" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                        </label>
                        <label>
                          <span>Кому можно отдать</span>
                          <select v-model="question.selectionMode" @focus="selectItem(roundIndex, themeIndex, questionIndex)">
                            <option value="">По умолчанию SiGame</option>
                            <option v-for="option in secretSelectionOptions" :key="option.value" :value="option.value">
                              {{ option.label }}
                            </option>
                          </select>
                        </label>
                        <label>
                          <span>Мин. цена</span>
                          <input v-model.number="question.secretPriceMinimum" type="number" min="0" step="100" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                        </label>
                        <label>
                          <span>Макс. цена</span>
                          <input v-model.number="question.secretPriceMaximum" type="number" min="0" step="100" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                        </label>
                        <label>
                          <span>Шаг цены</span>
                          <input v-model.number="question.secretPriceStep" type="number" min="1" step="100" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                        </label>
                      </div>
                    </section>

                    <section v-if="isStakeQuestion(question.type)" class="special-question-panel">
                      <div class="panel-title-row">
                        <span class="section-kicker">Stake</span>
                        <h3>Параметры ставки</h3>
                      </div>
                      <div class="editor-grid">
                        <label>
                          <span>Режим выбора</span>
                          <select v-model="question.selectionMode" @focus="selectItem(roundIndex, themeIndex, questionIndex)">
                            <option value="">По умолчанию SiGame</option>
                            <option v-for="option in stakeSelectionOptions" :key="option.value" :value="option.value">
                              {{ option.label }}
                            </option>
                          </select>
                        </label>
                      </div>
                    </section>

                    <label>
                      <span>Текст вопроса</span>
                      <textarea v-model="question.text" rows="3" @focus="selectItem(roundIndex, themeIndex, questionIndex)"></textarea>
                    </label>

                    <label>
                      <span>Комментарий</span>
                      <input v-model="question.comments" autocomplete="off" @focus="selectItem(roundIndex, themeIndex, questionIndex)" />
                    </label>

                    <div class="editor-grid answer-lists-grid">
                      <label>
                        <span>Дополнительные зачёты</span>
                        <textarea
                          :value="formatList(question.acceptedAnswers)"
                          rows="3"
                          placeholder="Один вариант на строку"
                          @focus="selectItem(roundIndex, themeIndex, questionIndex)"
                          @input="question.acceptedAnswers = parseList(eventValue($event))"
                        ></textarea>
                      </label>
                      <label>
                        <span>Незачётные варианты</span>
                        <textarea
                          :value="formatList(question.wrongAnswers)"
                          rows="3"
                          placeholder="Один вариант на строку"
                          @focus="selectItem(roundIndex, themeIndex, questionIndex)"
                          @input="question.wrongAnswers = parseList(eventValue($event))"
                        ></textarea>
                      </label>
                      <label>
                        <span>Варианты выбора</span>
                        <textarea
                          :value="formatList(question.answerOptions)"
                          rows="3"
                          placeholder="Для типа ответа 'Выбор варианта'"
                          @focus="selectItem(roundIndex, themeIndex, questionIndex)"
                          @input="question.answerOptions = parseList(eventValue($event))"
                        ></textarea>
                      </label>
                    </div>

                    <section class="question-media-section">
                      <div class="panel-header compact">
                        <div class="panel-title-row">
                          <span class="section-kicker">Media</span>
                          <h3>Медиа вопроса</h3>
                        </div>
                      </div>

                      <div class="media-picker">
                        <div>
                          <p class="path-hint" :title="question.media?.sourcePath || 'Медиа не выбрано'">
                            {{ question.media?.fileName || question.media?.sourcePath || 'Медиа не выбрано' }}
                          </p>
                          <p v-if="question.media" class="path-hint">
                            При сохранении `.siq` файл будет встроен в пакет. Исходный файл после проверки можно удалить с диска.
                          </p>
                        </div>
                        <div class="header-actions">
                          <button
                            type="button"
                            :disabled="!lastExportMediaKind"
                            @click="selectItem(roundIndex, themeIndex, questionIndex); useLastExportAsMedia()"
                          >
                            Последний экспорт
                          </button>
                          <button type="button" @click="selectItem(roundIndex, themeIndex, questionIndex); selectMediaFromDisk()">Файл с диска</button>
                          <button type="button" @click="emit('openMediaEditor')">Открыть редактор медиа</button>
                          <button
                            type="button"
                            :disabled="!question.media"
                            @click="selectItem(roundIndex, themeIndex, questionIndex); clearQuestionMedia()"
                          >
                            Убрать
                          </button>
                        </div>
                      </div>

                      <div
                        v-if="
                          question.media &&
                          selectedRoundIndex === roundIndex &&
                          selectedThemeIndex === themeIndex &&
                          selectedQuestionIndex === questionIndex
                        "
                        class="question-media-preview"
                      >
                        <p v-if="mediaPreviewError" class="inline-error">{{ mediaPreviewError }}</p>
                        <template v-else-if="mediaPreviewUrl">
                          <audio v-if="mediaPreviewKind === 'audio'" :src="mediaPreviewUrl" controls></audio>
                          <video v-else-if="mediaPreviewKind === 'video'" :src="mediaPreviewUrl" controls></video>
                          <img v-else-if="mediaPreviewKind === 'image'" :src="mediaPreviewUrl" alt="" />
                        </template>
                        <p v-else class="path-hint">Для этого типа медиа preview пока не отображается, но файл будет встроен в пакет при сохранении.</p>
                      </div>
                    </section>
                  </template>
                </section>
              </template>
            </section>
          </template>
        </section>
      </section>
    </section>

    <footer v-if="statusMessage || errorDetails" class="package-status" :class="statusKind">
      <strong>{{ statusMessage }}</strong>
      <span v-if="errorDetails">{{ errorDetails }}</span>
    </footer>
  </section>
</template>
