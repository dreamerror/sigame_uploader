# Инструкции для агентов

## Назначение проекта

SiGame Media Cutter — локальная некоммерческая настольная утилита для быстрой подготовки коротких аудио/видео-фрагментов для пакетов SiGame.

Первый MVP сфокусирован на простом сценарии: пользователь вставляет ссылку YouTube, получает метаданные, вручную задаёт начало и конец фрагмента, затем экспортирует MP3/MP4 в выбранную локальную папку. Thumbnail можно скачать отдельной кнопкой.

## Важное позиционирование

- Это локальная утилита подготовки материалов, а не публичный сервис скачивания.
- Приложение предназначено для медиа, которое пользователь имеет право использовать.
- Нельзя позиционировать проект как инструмент пиратства, обхода авторских прав или copyright circumvention.

## Язык общения

Все ответы агента пользователю должны быть на русском.

Короткие технические комментарии в коде могут быть на английском, если они действительно полезны.

Пользовательская документация должна быть на русском, кроме общеупотребимых технических терминов вроде `renderer`, `preload`, `main process`, `PATH`, `TypeScript`.

## Технологический стек

- Electron
- Vue 3
- TypeScript
- electron-vite
- `yt-dlp`
- `ffmpeg`
- `ffprobe`

## Архитектура

- Renderer не должен запускать `child_process` напрямую.
- Renderer общается с Electron main process только через типизированный preload API.
- Вызовы `yt-dlp`, `ffmpeg` и `ffprobe` должны находиться в сервисах main-процесса.
- Текущая структура сервисов:
- `YtDlpService`
- `FfmpegService`
- `MediaProbeService`
- `ExportService`
- `PreviewService`
- `PreviewProxyService`
- `ThumbnailService`
- `CookieCacheService`
- Общие типы API находятся в `src/shared/types.ts`.
- IPC-каналы находятся в `src/shared/ipc.ts`.
- Preload bridge находится в `src/preload/index.ts`.

## Важные директории и файлы

- `src/main/index.ts` — создание окна, регистрация IPC handlers, сборка сервисов.
- `src/main/services/` — main-process сервисы для внешних инструментов и экспорта.
- `src/main/services/CookieCacheService.ts` — локальный кэш cookies в папке данных приложения.
- `src/preload/index.ts` — типизированный API, доступный renderer как `window.sigameApi`.
- `src/shared/types.ts` — общие типы `MediaMetadata`, `MediaCutRequest`, `ApiResult` и ошибки.
- `src/shared/ipc.ts` — имена IPC-каналов.
- `src/shared/time.ts` — общий парсинг и форматирование таймкодов до миллисекунд.
- `src/renderer/src/App.vue` — простой MVP UI.
- `src/renderer/src/components/TimelineSelector.vue` — timeline без waveform для выбора start/end.
- `src/renderer/src/style.css` — стили MVP UI.
- `README.md` — инструкция запуска для пользователя/разработчика.
- `DEVELOPMENT_LOG.md` — журнал значимых изменений, способов тестирования и ограничений.
- `package.json` — npm-команды и зависимости.
- `electron.vite.config.ts` — конфигурация electron-vite.

## Команды

```powershell
npm install
npm run dev
npm run check:tools
npm run typecheck
npm run build
npm run package
npm run dist
npm run preview
```

Отдельного lint-скрипта сейчас нет.

`npm run build` уже включает `vue-tsc --noEmit`, но при отдельной проверке типов используйте `npm run typecheck`.

`npm run check:tools` проверяет доступность `yt-dlp`, `ffmpeg`, `ffprobe` с учётом `YT_DLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`, стандартной папки `%LOCALAPPDATA%\Microsoft\WinGet\Links` и fallback на `PATH`.

Dev-сервер renderer должен использовать `127.0.0.1:5173` со строгим портом. Не возвращайте dev-запуск на неявный `localhost`, чтобы не ломать локальную проверку при VPN.

`npm run package` собирает unpacked desktop-приложение через `electron-builder --dir`; `npm run dist` собирает Windows portable `.exe`.

Windows-сборка сейчас настроена для локального тестирования: `signAndEditExecutable: false`, без подписи кода, иконки и автообновлений.

## Текущая функциональность MVP

- Ввод ссылки YouTube.
- Получение метаданных через `yt-dlp`:
  - название;
  - длительность;
  - thumbnail.
- Ручной ввод start/end timestamp.
- Проверка корректности ссылки и временных отметок.
- Выбор папки сохранения через Electron dialog.
- Preview-плеер через локальный streaming proxy `127.0.0.1`, подготовленный в main-процессе без временных файлов.
- Timeline без waveform для выбора start/end.
- Точный ввод времени до миллисекунд.
- Проигрывание выбранного отрезка.
- Экспорт MP3/MP4 через `yt-dlp` + `ffmpeg`.
- Выбор качества MP4-экспорта: 360p, 480p, 720p по умолчанию, 1080p, best.
- Скачивание thumbnail в выбранную папку через main-process `ThumbnailService`.
- Опциональное использование cookies браузера для `yt-dlp` через `--cookies-from-browser`, если YouTube требует sign-in/anti-bot подтверждение.
- Опциональный локальный кэш cookies для `yt-dlp` через `--cookies`, который обновляется из выбранного браузера только по действию пользователя.
- Если включены и browser cookies, и локальный кэш, обычные metadata/preview/export запросы должны сначала пробовать `--cookies-from-browser`, а затем fallback на локальный `--cookies`. Обновление кэша остаётся отдельным режимом, где оба аргумента используются вместе для записи cookie-файла.
- Яндекс.Браузер поддерживается через Chromium-профиль `%LOCALAPPDATA%\Yandex\YandexBrowser\User Data\Default`, потому что `yt-dlp` не поддерживает `yandex` как отдельное имя браузера.
- Проверка наличия `yt-dlp`, `ffmpeg`, `ffprobe`.
- Понятные состояния успеха и ошибки в UI.

## Выбранное дизайн-направление

Текущий UI развивается в направлении `Dark Precision Utility`:

- тёмная media-workspace эстетика;
- плеер и timeline — визуальный центр приложения;
- URL/source command bar сверху;
- metadata/export/settings — компактная правая или нижняя панель;
- status/errors — компактная нижняя status bar или inline-зона;
- без SaaS/AI-dashboard стилистики;
- без hero-блоков, glassmorphism, ярких градиентов и waveform на текущем этапе;
- без тяжёлых UI-библиотек и внешних icon libraries без отдельного решения.

## Известные ограничения

- Поддерживается только YouTube.
- Живой экспорт требует сеть, корректную ссылку YouTube и локально установленные `yt-dlp`, `ffmpeg`, `ffprobe`.
- Нет waveform.
- Нет очереди заданий.
- Нет нарезки локальных файлов.
- Нет Freesound/Jamendo.
- Нет Яндекс.Музыки.
- Нет собственной авторизации в приложении; есть только явная локальная передача браузерной сессии в `yt-dlp` по выбору пользователя.
- Нет сборки полноценного SiGame-пакета.
- Нет отдельного экрана настроек путей к бинарникам.
- Нет автоматических тестов живого экспорта.
- Desktop-сборка пока не включает `yt-dlp`, `ffmpeg`, `ffprobe` внутрь приложения.
- Preview всё ещё может быть недоступен для browser media engine; export-flow должен оставаться рабочим отдельно.
- Локальный кэш cookies хранит чувствительные сессионные данные в app data пользователя и должен оставаться явно управляемым: включить, обновить, очистить.

## Внешние инструменты

Приложение ищет инструменты через переменные окружения:

- `YT_DLP_PATH`
- `FFMPEG_PATH`
- `FFPROBE_PATH`

Если переменная не задана, приложение сначала проверяет `%LOCALAPPDATA%\Microsoft\WinGet\Links`, затем использует команду из `PATH`:

- `yt-dlp`
- `ffmpeg`
- `ffprobe`

Проверка в PowerShell:

```powershell
yt-dlp --version
ffmpeg -version
ffprobe -version
```

## Правила разработки

- Держите изменения маленькими и сфокусированными.
- Сохраняйте TypeScript strictness.
- Не ослабляйте типы ради быстрого обхода ошибки.
- Сохраняйте чистые границы сервисов main-процесса.
- Не переносите `child_process` в renderer.
- Preview-логика, связанная с `yt-dlp`, должна оставаться в main-процессе.
- Renderer не должен получать прямой YouTube/Googlevideo URL для preview, если можно использовать локальный main-process proxy.
- Renderer не должен читать cookies напрямую. Для YouTube sign-in/anti-bot случаев передавайте в main-process только выбранный браузер, а cookies должен читать `yt-dlp` через `--cookies-from-browser`.
- Если используется кэш cookies, renderer не должен получать путь к cookie-файлу или содержимое cookies. Управление файлом должно оставаться в main-process `CookieCacheService`, а `yt-dlp` должен получать только `--cookies`.
- Для Яндекс.Браузера передавайте в `yt-dlp` значение вида `chromium:<путь-к-профилю>`, а не `yandex`.
- Не сохраняйте cookies, tokens или данные аккаунта в проекте или репозитории. Допустим только явный локальный app-data кэш cookies пользователя с кнопкой очистки.
- Не добавляйте интеграцию с Яндекс.Музыкой на текущем этапе.
- Timeline и preview не должны превращаться в тяжёлый видеоредактор.
- Не добавляйте Freesound/Jamendo или локальную нарезку файлов в этой итерации без явного запроса.
- После каждого значимого изменения обновляйте `DEVELOPMENT_LOG.md`.
- Не запускайте `npm audit fix --force` без явного запроса пользователя.
- Репозиторий Git инициализирован. Можно использовать read-only Git-команды для диагностики (`git status`, `git diff`, `git log`, `git show`). Не запускайте команды, которые меняют состояние репозитория, без явного запроса пользователя.
- Сборка desktop-приложения не должна ломать текущий MVP export-flow.
- Внешние бинарники пока должны искаться через env vars, winget Links или `PATH`; не встраивайте их без отдельного решения.
- Не включайте code signing, автообновления или сложные ресурсы сборки без отдельной задачи.

## Безопасность и права

Приложение должно оставаться локальной утилитой подготовки материалов. Пользователь отвечает за то, что использует только те медиа, которые имеет право использовать. Не описывайте и не развивайте проект как инструмент обхода ограничений, пиратства или нарушения авторских прав.
