<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatTimestamp, roundToMilliseconds } from '../../../shared/time'

const props = defineProps<{
  duration: number
  currentTime: number
  start: number
  end: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  seek: [value: number]
}>()

const trackRef = ref<HTMLElement | null>(null)
const isScrubbing = ref(false)

const safeDuration = computed(() => Math.max(0, props.duration))
const currentPercent = computed(() => toPercent(clamp(props.currentTime, 0, safeDuration.value)))
const startPercent = computed(() => toPercent(clamp(props.start, 0, safeDuration.value)))
const endPercent = computed(() => toPercent(clamp(props.end, 0, safeDuration.value)))
const selectedWidth = computed(() => Math.max(0, endPercent.value - startPercent.value))

function beginSeek(event: PointerEvent): void {
  if (props.disabled || safeDuration.value <= 0) {
    return
  }

  isScrubbing.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  emit('seek', secondsFromEvent(event))
}

function dragSeek(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return
  }

  emit('seek', secondsFromEvent(event))
}

function endSeek(event: PointerEvent): void {
  if (!isScrubbing.value) {
    return
  }

  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  isScrubbing.value = false
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
  <div class="seek-timeline" :class="{ disabled }">
    <div
      ref="trackRef"
      class="seek-track"
      role="slider"
      tabindex="0"
      :aria-valuemin="0"
      :aria-valuemax="safeDuration"
      :aria-valuenow="currentTime"
      :aria-valuetext="formatTimestamp(currentTime)"
      @pointerdown="beginSeek"
      @pointermove="dragSeek"
      @pointerup="endSeek"
      @pointercancel="endSeek"
      @keydown="seekFromKeyboard"
    >
      <div class="seek-range" :style="{ left: `${startPercent}%`, width: `${selectedWidth}%` }"></div>
      <div class="seek-progress" :style="{ width: `${currentPercent}%` }"></div>
      <div class="seek-playhead" :style="{ left: `${currentPercent}%` }"></div>
    </div>
  </div>
</template>
