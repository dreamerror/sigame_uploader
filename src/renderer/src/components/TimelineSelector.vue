<script setup lang="ts">
import { computed, ref } from 'vue'
import { MIN_FRAGMENT_SECONDS, formatTimestamp, roundToMilliseconds } from '../../../shared/time'

const props = defineProps<{
  duration: number
  currentTime: number
  start: number
  end: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:start': [value: number]
  'update:end': [value: number]
  seek: [value: number]
}>()

const trackRef = ref<HTMLElement | null>(null)
const draggingHandle = ref<'start' | 'end' | null>(null)

const safeDuration = computed(() => Math.max(0, props.duration))
const safeStart = computed(() => clamp(props.start, 0, Math.max(0, safeDuration.value - MIN_FRAGMENT_SECONDS)))
const safeEnd = computed(() =>
  clamp(props.end, Math.min(safeDuration.value, safeStart.value + MIN_FRAGMENT_SECONDS), safeDuration.value)
)
const startPercent = computed(() => toPercent(safeStart.value))
const endPercent = computed(() => toPercent(safeEnd.value))
const currentPercent = computed(() => toPercent(clamp(props.currentTime, 0, safeDuration.value)))
const selectedWidth = computed(() => Math.max(0, endPercent.value - startPercent.value))
const selectedDuration = computed(() => roundToMilliseconds(Math.max(0, safeEnd.value - safeStart.value)))

function beginDrag(handle: 'start' | 'end', event: PointerEvent): void {
  if (props.disabled || safeDuration.value <= 0) {
    return
  }

  draggingHandle.value = handle
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  updateDraggedHandle(event)
}

function drag(event: PointerEvent): void {
  if (!draggingHandle.value) {
    return
  }

  updateDraggedHandle(event)
}

function endDrag(event: PointerEvent): void {
  if (!draggingHandle.value) {
    return
  }

  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  draggingHandle.value = null
}

function seekFromTrack(event: PointerEvent): void {
  if (props.disabled || safeDuration.value <= 0 || draggingHandle.value) {
    return
  }

  emit('seek', secondsFromEvent(event))
}

function seekFromKeyboard(event: KeyboardEvent): void {
  if (props.disabled || safeDuration.value <= 0) {
    return
  }

  const step = event.shiftKey ? 1 : 0.1
  let nextValue: number | undefined

  if (event.key === 'ArrowLeft') {
    nextValue = props.currentTime - step
  } else if (event.key === 'ArrowRight') {
    nextValue = props.currentTime + step
  } else if (event.key === 'Home') {
    nextValue = 0
  } else if (event.key === 'End') {
    nextValue = safeDuration.value
  }

  if (nextValue === undefined) {
    return
  }

  event.preventDefault()
  emit('seek', roundToMilliseconds(clamp(nextValue, 0, safeDuration.value)))
}

function updateDraggedHandle(event: PointerEvent): void {
  const value = secondsFromEvent(event)

  if (draggingHandle.value === 'start') {
    emit('update:start', roundToMilliseconds(clamp(value, 0, safeEnd.value - MIN_FRAGMENT_SECONDS)))
    return
  }

  if (draggingHandle.value === 'end') {
    emit('update:end', roundToMilliseconds(clamp(value, safeStart.value + MIN_FRAGMENT_SECONDS, safeDuration.value)))
  }
}

function secondsFromEvent(event: PointerEvent): number {
  if (!trackRef.value || safeDuration.value <= 0) {
    return 0
  }

  const rect = trackRef.value.getBoundingClientRect()
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)

  return roundToMilliseconds(ratio * safeDuration.value)
}

function toPercent(value: number): number {
  if (safeDuration.value <= 0) {
    return 0
  }

  return (value / safeDuration.value) * 100
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}
</script>

<template>
  <div class="timeline-selector" :class="{ disabled }">
    <div class="timeline-labels">
      <span>{{ formatTimestamp(0) }}</span>
      <span>{{ formatTimestamp(safeDuration) }}</span>
    </div>

    <div
      ref="trackRef"
      class="timeline-track"
      role="slider"
      tabindex="0"
      :aria-valuemin="0"
      :aria-valuemax="safeDuration"
      :aria-valuenow="currentTime"
      :aria-valuetext="formatTimestamp(currentTime)"
      @pointerdown="seekFromTrack"
      @keydown="seekFromKeyboard"
    >
      <div
        class="timeline-selection"
        :style="{ left: `${startPercent}%`, width: `${selectedWidth}%` }"
      ></div>
      <div class="timeline-current" :style="{ left: `${currentPercent}%` }"></div>
      <button
        class="timeline-handle start"
        type="button"
        title="Начало"
        :style="{ left: `${startPercent}%` }"
        :disabled="disabled"
        @pointerdown.stop="beginDrag('start', $event)"
        @pointermove.stop="drag"
        @pointerup.stop="endDrag"
        @pointercancel.stop="endDrag"
      ></button>
      <button
        class="timeline-handle end"
        type="button"
        title="Конец"
        :style="{ left: `${endPercent}%` }"
        :disabled="disabled"
        @pointerdown.stop="beginDrag('end', $event)"
        @pointermove.stop="drag"
        @pointerup.stop="endDrag"
        @pointercancel.stop="endDrag"
      ></button>
    </div>

    <div class="timeline-values">
      <span>Начало: {{ formatTimestamp(safeStart) }}</span>
      <span>Отрезок: {{ formatTimestamp(selectedDuration) }}</span>
      <span>Позиция: {{ formatTimestamp(currentTime) }}</span>
      <span>Конец: {{ formatTimestamp(safeEnd) }}</span>
    </div>
  </div>
</template>
