# Заметки по интеграции с SiGame / SiQuester

## Цель

Подготовить основу для будущей генерации `.siq` пакетов из уже экспортированных MP3/MP4/thumbnail файлов.

Первый интеграционный slice должен быть маленьким: создать новый `.siq` пакет с одним раундом, одной темой, одним вопросом и одним вложенным медиафайлом. Полноценный редактор SiQuester, импорт существующих пакетов и сложное дерево вопросов пока не делаем.

## Источники

- Репозиторий SI: https://github.com/VladimirKhil/SI
- SIQuester находится в `src/SIQuester`.
- Модель и сохранение пакетов находятся в `src/Common/SIPackages`.
- Документация `SIPackages`: https://github.com/VladimirKhil/SI/blob/master/src/Common/SIPackages/README.md
- Схема формата указана в репозитории как `assets/siq_5.xsd`.

## Что известно о `.siq`

`.siq` - ZIP-based формат пакета SIGame.

Базовая структура архива:

```text
package.siq
├── content.xml
├── Images/
├── Audio/
├── Video/
└── Html/
```

`content.xml` содержит структуру пакета и вопросы. Медиафайлы лежат в соответствующих папках и используются из вопроса как ссылки.

Первичный пример от пользователя: `мне бы лишь бы компьютер.siq`, созданный в SiQuester.

Состав примера:

- `content.xml`;
- `Audio/` с MP3-файлами;
- `Images/` с PNG-файлами;
- `[Content_Types].xml` в этом конкретном архиве отсутствует.

Статистика примера:

- root: `<package>`;
- `version="5"`;
- namespace: `https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd`;
- 4 раунда;
- 21 тема;
- 93 вопроса;
- 1 тег пакета;
- 1 автор;
- 5 вложенных audio items;
- 4 вложенных image items;
- много external image URL items без `isRef`.

## Основная модель SIPackages

По документации `SIPackages` важные сущности:

- `SIDocument` - главный объект документа пакета.
- `Package` - метаданные и структура игры.
- `Round` - раунд.
- `Theme` - тема внутри раунда.
- `Question` - вопрос.
- `ContentItem` - текст, изображение, аудио, видео или HTML.
- `DataCollection` - коллекция файлов в категориях `Images`, `Audio`, `Video`, `Html`.

Минимальные поля, которые нужны для первого slice:

- package:
  - name;
  - author;
  - date;
  - language;
  - difficulty;
  - rounds.
- round:
  - name;
  - type, вероятно `standard`.
- theme:
  - name;
  - questions.
- question:
  - price;
  - body content;
  - right answers.
- media:
  - type: audio/video/image/html/text;
  - fileName;
  - package path/category;
  - `isRef: true` для вложенных файлов.

## Реальная XML-структура из примера SiQuester

Root:

```xml
<package
  name="мне бы лишь бы компьютер"
  version="5"
  id="..."
  date="16.10.2025"
  difficulty="5"
  xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">
```

Метаданные:

```xml
<tags>
  <tag>Игры</tag>
</tags>
<info>
  <authors>
    <author>dreamer_ror</author>
  </authors>
</info>
```

Текстовый вопрос:

```xml
<question price="100">
  <params>
    <param name="question" type="content">
      <item>Текст вопроса</item>
    </param>
  </params>
  <right>
    <answer>Правильный ответ</answer>
  </right>
</question>
```

Аудио-вопрос с вложенным MP3:

```xml
<question price="300">
  <params>
    <param name="question" type="content">
      <item type="audio" isRef="True" placement="background">Dark Souls_ Full Prologue [4lmEqpgg3B4] (mp3cut.net).mp3</item>
    </param>
  </params>
  <right>
    <answer>Dark Souls</answer>
  </right>
</question>
```

Файл при этом лежит в архиве в папке `Audio/`. Имя файла в ZIP URL-encoded, а в `content.xml` хранится человекочитаемое имя без префикса `Audio/`.

Изображение как external URL:

```xml
<item type="image">https://example.com/image.jpg</item>
```

Изображение как вложенный файл:

```xml
<item type="image" isRef="True">Снимок экрана 2025-10-31 175105.png</item>
```

Файл при этом лежит в архиве в папке `Images/`.

Комментарии встречаются в `info/comments` у тем и отдельных вопросов:

```xml
<info>
  <comments>Комментарий</comments>
</info>
```

## Предлагаемая архитектура в нашем приложении

Renderer не должен писать `.siq` напрямую и не должен работать с ZIP/XML/file system напрямую.

Будущие main-process сервисы:

- `SiqPackageService` - high-level сценарий создания `.siq`.
- `SiqArchiveService` - ZIP-архив и `[Content_Types].xml`.
- `SiqContentXmlService` - генерация `content.xml`.
- `SiqMediaService` - копирование/именование вложенных медиафайлов.

На первом этапе можно начать с одного сервиса `SiqPackageService`, если декомпозиция окажется преждевременной. Главное - не переносить файловую работу в renderer.

## Что уже реализовано в первом slice

- Добавлен `SiqPackageService` в main-process.
- Добавлен простой `ZipArchiveService` без внешних зависимостей; архив пишется методом store, без сжатия.
- Добавлен typed IPC/preload метод создания `.siq`.
- В UI добавлен компактный блок "Создать .siq" после успешного MP3/MP4-экспорта.
- Renderer передаёт только черновик пакета и путь к последнему экспортированному файлу; ZIP/XML/file system остаются в main-process.
- Генерируется один пакет с одним раундом, одной темой, одним вопросом и одним вложенным медиафайлом.

## Первый вертикальный slice

Вход:

- путь к уже экспортированному MP3 или MP4;
- опциональный thumbnail;
- имя пакета;
- автор;
- название раунда;
- название темы;
- текст вопроса;
- правильный ответ;
- стоимость вопроса;
- папка сохранения `.siq`.

Выход:

- один `.siq` файл;
- статус успеха/ошибки;
- путь к созданному файлу.

Проверка:

1. Создать `.siq` из одного экспортированного фрагмента.
2. Открыть файл в SiQuester.
3. Убедиться, что пакет открывается.
4. Убедиться, что вопрос, ответ, цена и медиа видны.
5. Проверить воспроизведение медиа в SiQuester/SIGame.

## Важные риски

- Нужно точно подтвердить XML-структуру `content.xml` на реальном минимальном `.siq`.
- Нужно проверить, требуется ли `[Content_Types].xml` для новых пакетов. В пользовательском примере из SiQuester его нет.
- Нужно аккуратно нормализовать имена файлов внутри архива.
- Нужно URL-encode имена файлов внутри ZIP, но сохранять человекочитаемое имя в `content.xml`.
- Нужно проверить кодировку XML.
- Нужно проверить совместимость с актуальной версией SiQuester.
- Нельзя делать вид, что приложение является заменой SiQuester; сначала только экспорт результата media-flow в простой пакет.

## Следующие шаги

1. Открыть сгенерированный приложением `.siq` в SiQuester и проверить совместимость.
2. Создать через SiQuester минимальный `.siq` с одним вопросом и одним локальным MP3, чтобы сравнить XML с нашим генератором.
3. Создать через SiQuester минимальный `.siq` с одним вопросом и одним локальным MP4, чтобы подтвердить `type="video"` и папку `Video/`.
4. При необходимости поправить XML-порядок, namespace, атрибуты или ZIP-структуру.
5. Решить, нужен ли `[Content_Types].xml` для новых пакетов или достаточно структуры из пользовательского примера.
6. После подтверждения совместимости перейти к модели редактирования нескольких раундов/тем/вопросов.
