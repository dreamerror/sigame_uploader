export type SiqMediaKind = 'audio' | 'video' | 'image' | 'html'
export type SiqMediaPlacement = 'background' | 'screen'
export type SiqQuestionType =
  | ''
  | 'simple'
  | 'withButton'
  | 'stake'
  | 'stakeAll'
  | 'secret'
  | 'secretPublicPrice'
  | 'secretNoQuestion'
  | 'noRisk'
  | 'forYourself'
  | 'forAll'
export type SiqAnswerType = 'text' | 'number' | 'point' | 'select' | 'client'
export type SiqSelectionMode = '' | 'allPossible' | 'highest' | 'any' | 'exceptCurrent'

export interface SiqMediaAsset {
  kind: SiqMediaKind
  sourcePath: string
  fileName?: string
  placement?: SiqMediaPlacement
}

export interface SiqQuestionDraft {
  price: number
  text: string
  answer: string
  type?: SiqQuestionType
  answerType?: SiqAnswerType
  answerOptions?: string[]
  answerDeviation?: string
  selectionMode?: SiqSelectionMode
  secretTheme?: string
  secretPriceMinimum?: number
  secretPriceMaximum?: number
  secretPriceStep?: number
  acceptedAnswers?: string[]
  wrongAnswers?: string[]
  comments?: string
  media?: SiqMediaAsset
}

export interface SiqThemeDraft {
  name: string
  comments?: string
  questions: SiqQuestionDraft[]
}

export interface SiqRoundDraft {
  name: string
  type?: 'standard' | 'final'
  themes: SiqThemeDraft[]
}

export interface SiqPackageDraft {
  title: string
  author?: string
  tags?: string[]
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

export interface SiqPackageImportRequest {
  filePath: string
}

export interface SiqPackageImportResult {
  package: SiqPackageDraft
  sourcePath: string
}
