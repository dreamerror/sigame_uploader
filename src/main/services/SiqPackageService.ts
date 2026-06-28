import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from './AppError'
import { ZipArchiveService } from './ZipArchiveService'
import type { SiqMediaAsset, SiqPackageExportRequest, SiqPackageExportResult } from '../../shared/siq'

interface ArchiveMedia {
  asset: SiqMediaAsset
  displayName: string
  archivePath: string
  data: Buffer
}

const SIQ_NAMESPACE = 'https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd'

export class SiqPackageService {
  constructor(private readonly zipArchiveService = new ZipArchiveService()) {}

  async exportPackage(request: SiqPackageExportRequest): Promise<SiqPackageExportResult> {
    this.validateRequest(request)

    const outputPath = path.join(
      request.outputDirectory,
      this.ensureExtension(sanitizeFileName(request.outputFileName || request.package.title), '.siq')
    )
    const media = await this.collectMedia(request)
    const contentXml = this.createContentXml(request, media)

    await fs.mkdir(request.outputDirectory, { recursive: true })
    await this.zipArchiveService.writeArchive(outputPath, [
      {
        path: 'content.xml',
        data: Buffer.from(contentXml, 'utf8')
      },
      ...media.map((item) => ({
        path: item.archivePath,
        data: item.data
      }))
    ])

    return { outputPath }
  }

  private validateRequest(request: SiqPackageExportRequest): void {
    if (!request.package.title.trim()) {
      throw new AppError('siq-failure', 'Укажите название пакета SiGame.')
    }

    if (!request.outputDirectory.trim()) {
      throw new AppError('siq-failure', 'Выберите папку для сохранения .siq.')
    }

    if (request.package.rounds.length === 0) {
      throw new AppError('siq-failure', 'Добавьте хотя бы один раунд.')
    }

    for (const round of request.package.rounds) {
      if (!round.name.trim()) {
        throw new AppError('siq-failure', 'Укажите название раунда.')
      }

      if (round.themes.length === 0) {
        throw new AppError('siq-failure', 'Добавьте хотя бы одну тему.')
      }

      for (const theme of round.themes) {
        if (!theme.name.trim()) {
          throw new AppError('siq-failure', 'Укажите название темы.')
        }

        if (theme.questions.length === 0) {
          throw new AppError('siq-failure', 'Добавьте хотя бы один вопрос.')
        }

        for (const question of theme.questions) {
          if (!Number.isFinite(question.price) || question.price <= 0) {
            throw new AppError('siq-failure', 'Стоимость вопроса должна быть положительным числом.')
          }

          if (!question.text.trim() && !question.media) {
            throw new AppError('siq-failure', 'Добавьте текст вопроса или медиафайл.')
          }

          if (!question.answer.trim()) {
            throw new AppError('siq-failure', 'Укажите правильный ответ.')
          }
        }
      }
    }
  }

  private async collectMedia(request: SiqPackageExportRequest): Promise<ArchiveMedia[]> {
    const result: ArchiveMedia[] = []
    const usedNames = new Set<string>()

    for (const round of request.package.rounds) {
      for (const theme of round.themes) {
        for (const question of theme.questions) {
          if (!question.media) {
            continue
          }

          const asset = question.media
          const data = await this.readMedia(asset)
          const displayName = this.uniqueMediaName(asset.fileName || path.basename(asset.sourcePath), usedNames)
          const archivePath = `${this.mediaFolder(asset)}/${encodeArchiveFileName(displayName)}`

          result.push({
            asset,
            displayName,
            archivePath,
            data
          })
        }
      }
    }

    return result
  }

  private async readMedia(asset: SiqMediaAsset): Promise<Buffer> {
    try {
      const stats = await fs.stat(asset.sourcePath)

      if (!stats.isFile()) {
        throw new AppError('siq-failure', 'Медиа для .siq должно быть файлом.', asset.sourcePath)
      }

      return await fs.readFile(asset.sourcePath)
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }

      throw new AppError(
        'siq-failure',
        'Не удалось прочитать медиафайл для .siq.',
        error instanceof Error ? `${asset.sourcePath}\n${error.message}` : asset.sourcePath
      )
    }
  }

  private createContentXml(request: SiqPackageExportRequest, media: ArchiveMedia[]): string {
    let mediaIndex = 0
    const packageDraft = request.package
    const date = new Intl.DateTimeFormat('ru-RU').format(new Date())

    return [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<package name="${escapeXml(packageDraft.title)}" version="5" id="${randomUUID()}" date="${date}" difficulty="${packageDraft.difficulty ?? 5}" xmlns="${SIQ_NAMESPACE}">`,
      this.createTagsXml(packageDraft.tags),
      this.createInfoXml(packageDraft.author),
      '<rounds>',
      ...packageDraft.rounds.map((round) => [
        `<round name="${escapeXml(round.name)}">`,
        '<themes>',
        ...round.themes.map((theme) => [
          `<theme name="${escapeXml(theme.name)}">`,
          this.createCommentsXml(theme.comments),
          '<questions>',
          ...theme.questions.map((question) => {
            const questionMedia = question.media ? media[mediaIndex++] : undefined

            return [
              `<question price="${question.price}">`,
              this.createCommentsXml(question.comments),
              '<params><param name="question" type="content">',
              question.text.trim() ? `<item>${escapeXml(question.text.trim())}</item>` : '',
              questionMedia ? this.createMediaItemXml(questionMedia) : '',
              '</param></params>',
              `<right><answer>${escapeXml(question.answer.trim())}</answer></right>`,
              '</question>'
            ].join('')
          }),
          '</questions>',
          '</theme>'
        ].join('')),
        '</themes>',
        '</round>'
      ].join('')),
      '</rounds>',
      '</package>'
    ].join('')
  }

  private createTagsXml(tags: string[] = []): string {
    const cleanTags = tags.map((tag) => tag.trim()).filter(Boolean)

    if (cleanTags.length === 0) {
      return ''
    }

    return `<tags>${cleanTags.map((tag) => `<tag>${escapeXml(tag)}</tag>`).join('')}</tags>`
  }

  private createInfoXml(author?: string): string {
    const cleanAuthor = author?.trim()

    if (!cleanAuthor) {
      return ''
    }

    return `<info><authors><author>${escapeXml(cleanAuthor)}</author></authors></info>`
  }

  private createCommentsXml(comments?: string): string {
    const cleanComments = comments?.trim()

    if (!cleanComments) {
      return ''
    }

    return `<info><comments>${escapeXml(cleanComments)}</comments></info>`
  }

  private createMediaItemXml(media: ArchiveMedia): string {
    const attributes = [`type="${media.asset.kind}"`, 'isRef="True"']

    if (media.asset.kind === 'audio') {
      attributes.push(`placement="${media.asset.placement ?? 'background'}"`)
    } else if (media.asset.placement) {
      attributes.push(`placement="${media.asset.placement}"`)
    }

    return `<item ${attributes.join(' ')}>${escapeXml(media.displayName)}</item>`
  }

  private mediaFolder(asset: SiqMediaAsset): string {
    if (asset.kind === 'audio') {
      return 'Audio'
    }

    if (asset.kind === 'video') {
      return 'Video'
    }

    if (asset.kind === 'image') {
      return 'Images'
    }

    return 'Html'
  }

  private uniqueMediaName(value: string, usedNames: Set<string>): string {
    const candidate = sanitizeFileName(value)
    const extension = path.extname(candidate)
    const baseName = extension ? candidate.slice(0, -extension.length) : candidate
    let result = candidate
    let index = 2

    while (usedNames.has(result.toLowerCase())) {
      result = `${baseName}-${index}${extension}`
      index += 1
    }

    usedNames.add(result.toLowerCase())
    return result
  }

  private ensureExtension(value: string, extension: string): string {
    return value.toLowerCase().endsWith(extension) ? value : `${value}${extension}`
  }
}

function sanitizeFileName(value: string): string {
  const fallback = `sigame-package-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const candidate = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

  return candidate || fallback
}

function encodeArchiveFileName(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, '_')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
