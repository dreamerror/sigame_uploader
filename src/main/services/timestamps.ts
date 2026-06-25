import { AppError } from './AppError'
import { MIN_FRAGMENT_SECONDS, parseTimestampToSeconds } from '../../shared/time'

export function parseTimestamp(value: string): number {
  try {
    return parseTimestampToSeconds(value)
  } catch (error) {
    throw new AppError(
      'invalid-timestamps',
      error instanceof Error ? error.message : 'Некорректная отметка времени.'
    )
  }
}

interface ValidateCutRangeOptions {
  durationSeconds?: number
}

export function validateCutRange(startTimestamp: string, endTimestamp: string, options: ValidateCutRangeOptions = {}): {
  startSeconds: number
  endSeconds: number
} {
  const startSeconds = parseTimestamp(startTimestamp)
  const endSeconds = parseTimestamp(endTimestamp)

  if (endSeconds <= startSeconds) {
    throw new AppError('invalid-timestamps', 'Конечная отметка должна быть позже начальной.')
  }

  if (endSeconds - startSeconds < MIN_FRAGMENT_SECONDS) {
    throw new AppError(
      'invalid-timestamps',
      `Фрагмент слишком короткий. Минимальная длительность — ${MIN_FRAGMENT_SECONDS} секунды.`
    )
  }

  if (
    options.durationSeconds !== undefined &&
    Number.isFinite(options.durationSeconds) &&
    endSeconds > options.durationSeconds
  ) {
    throw new AppError('invalid-timestamps', 'Конечная отметка находится за пределами длительности медиа.')
  }

  return { startSeconds, endSeconds }
}
