export const MIN_FRAGMENT_SECONDS = 0.5

export function roundToMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function parseTimestampToSeconds(value: string): number {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error('Укажите начальную и конечную отметки времени.')
  }

  const parts = trimmed.split(':').map((part) => part.trim())

  if (parts.length > 3 || parts.some((part) => part === '')) {
    throw new Error('Используйте формат SS, SS.mmm, MM:SS.mmm или HH:MM:SS.mmm.')
  }

  const lastPart = parts[parts.length - 1]

  if (!/^\d+(?:\.\d{1,3})?$/.test(lastPart)) {
    throw new Error('Секунды должны быть числом с точностью не более 3 знаков после точки.')
  }

  const leadingParts = parts.slice(0, -1)

  if (!leadingParts.every((part) => /^\d+$/.test(part))) {
    throw new Error('Часы и минуты должны быть целыми неотрицательными числами.')
  }

  const numbers = parts.map((part) => Number(part))

  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error('Отметки времени должны быть неотрицательными числами.')
  }

  if (numbers.length === 1) {
    return roundToMilliseconds(numbers[0])
  }

  if (numbers.length === 2) {
    if (numbers[1] >= 60) {
      throw new Error('Для формата MM:SS секунды должны быть меньше 60.')
    }

    return roundToMilliseconds(numbers[0] * 60 + numbers[1])
  }

  if (numbers[1] >= 60 || numbers[2] >= 60) {
    throw new Error('Для формата HH:MM:SS минуты и секунды должны быть меньше 60.')
  }

  return roundToMilliseconds(numbers[0] * 3600 + numbers[1] * 60 + numbers[2])
}

export function formatTimestamp(totalSeconds: number): string {
  const rounded = Math.max(0, roundToMilliseconds(totalSeconds))
  const wholeSeconds = Math.floor(rounded)
  const milliseconds = Math.round((rounded - wholeSeconds) * 1000)
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const seconds = wholeSeconds % 60
  const secondLabel = `${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secondLabel}`
  }

  return `${String(minutes).padStart(2, '0')}:${secondLabel}`
}

