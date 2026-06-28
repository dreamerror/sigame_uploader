<script setup lang="ts">
import { computed, ref, toRaw } from 'vue'
import type { AppErrorPayload } from '../../../shared/types'
import type { SiqMediaKind, SiqPackageDraft, SiqQuestionDraft, SiqRoundDraft, SiqThemeDraft } from '../../../shared/siq'

const props = defineProps<{
  lastExportPath: string
}>()

const emit = defineEmits<{
  openMediaEditor: []
}>()

type StatusKind = 'idle' | 'success' | 'error'
type EditorSection = 'package' | 'round' | 'theme' | 'question' | 'media'

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

const currentRound = computed(() => packageDraft.value.rounds[selectedRoundIndex.value])
const currentTheme = computed(() => currentRound.value?.themes[selectedThemeIndex.value])
const currentQuestion = computed(() => currentTheme.value?.questions[selectedQuestionIndex.value])
const currentQuestionMedia = computed(() => currentQuestion.value?.media)
const canSave = computed(() => Boolean(outputDirectory.value.trim()) && Boolean(packageDraft.value.title.trim()) && !isBusy.value)
const lastExportMediaKind = computed<SiqMediaKind | undefined>(() => mediaKindFromPath(props.lastExportPath))
const mediaPreviewKind = computed(() => currentQuestionMedia.value?.kind)
collapseAllStructure()

function createEmptyPackage(): SiqPackageDraft {
  return {
    title: 'Новый пакет',
    author: '',
    difficulty: 5,
    rounds: [createRound('1')]
  }
}

function createRound(name: string, type: 'standard' | 'final' = 'standard'): SiqRoundDraft {
  return {
    name,
    type,
    themes: [createTheme('Новая тема')]
  }
}

function createTheme(name: string): SiqThemeDraft {
  return {
    name,
    questions: [createQuestion(100)]
  }
}

function createQuestion(price: number): SiqQuestionDraft {
  return {
    price,
    type: '',
    answerType: 'text',
    text: 'Текст вопроса',
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
    showStatus('success', `Пакет сохранён: ${result.data.outputPath}`)
  } catch (error) {
    showUnexpectedError(error, 'Не удалось сохранить .siq пакет.')
  } finally {
    isBusy.value = false
  }
}

function addRound(): void {
  packageDraft.value.rounds.push(createRound(String(packageDraft.value.rounds.length + 1)))
  collapseAllStructure()
  selectItem(packageDraft.value.rounds.length - 1, 0, 0)
}

function addFinalRound(): void {
  packageDraft.value.rounds.push(createRound('Финал', 'final'))
  collapseAllStructure()
  selectItem(packageDraft.value.rounds.length - 1, 0, 0)
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

  round.themes.push(createTheme('Новая тема'))
  collapseAllStructure()
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

  theme.questions.push(createQuestion((theme.questions.length + 1) * 100))
  collapseAllStructure()
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
        >
          <div class="panel-header compact">
            <div class="panel-title-row">
              <span class="section-kicker">{{ round.type === 'final' ? 'Final round' : 'Round' }}</span>
              <h2>{{ round.name || 'Раунд без названия' }}</h2>
            </div>
            <div class="header-actions">
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
            >
              <div class="panel-header compact">
                <div class="panel-title-row">
                  <span class="section-kicker">Theme</span>
                  <h3>{{ theme.name || 'Тема без названия' }}</h3>
                </div>
                <div class="header-actions">
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
                    selected:
                      selectedRoundIndex === roundIndex &&
                      selectedThemeIndex === themeIndex &&
                      selectedQuestionIndex === questionIndex
                  }"
                >
                  <div class="panel-header compact">
                    <div class="panel-title-row">
                      <span class="section-kicker">Question</span>
                      <h3>{{ question.price }}: {{ question.answer || 'Без ответа' }}</h3>
                    </div>
                    <div class="header-actions">
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
