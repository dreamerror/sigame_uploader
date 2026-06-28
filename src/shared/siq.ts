export type SiqMediaKind = 'audio' | 'video' | 'image' | 'html'

export interface SiqMediaAsset {
  kind: SiqMediaKind
  sourcePath: string
  fileName?: string
}

export interface SiqQuestionDraft {
  price: number
  text: string
  answer: string
  media?: SiqMediaAsset
}

export interface SiqThemeDraft {
  name: string
  questions: SiqQuestionDraft[]
}

export interface SiqRoundDraft {
  name: string
  themes: SiqThemeDraft[]
}

export interface SiqPackageDraft {
  title: string
  author?: string
  language?: string
  difficulty?: number
  rounds: SiqRoundDraft[]
}

export interface SiqPackageExportRequest {
  package: SiqPackageDraft
  outputDirectory: string
  outputFileName?: string
}

export interface SiqPackageExportResult {
  outputPath: string
}
