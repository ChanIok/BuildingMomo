<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  startFpsMonitor,
  stopFpsMonitor,
  getInstantFps,
  getFrameMs,
  getFpsHistory,
} from '@/composables/useFpsMonitor'

const CANVAS_W = 120
const CANVAS_H = 32

const canvasRef = ref<HTMLCanvasElement | null>(null)
const displayFps = ref(0)
const displayMs = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

const fpsColor = computed(() =>
  displayFps.value >= 50 ? '#4ade80' : displayFps.value >= 25 ? '#facc15' : '#f87171'
)

function draw(): void {
  displayFps.value = Math.round(getInstantFps())
  displayMs.value = getFrameMs()

  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  const { data, ptr, size } = getFpsHistory()
  const maxFps = Math.max(60, Math.ceil((Math.max(displayFps.value, ...data) * 1.15) / 30) * 30)
  const graphY = (fps: number) => 3 + (CANVAS_H - 6) * (1 - fps / maxFps)

  ctx.lineWidth = 0.5
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.setLineDash([2, 3])
  for (const target of [maxFps / 3, (maxFps * 2) / 3]) {
    const y = graphY(target)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(CANVAS_W, y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 历史折线：从 ring buffer 中按时间顺序读取
  ctx.beginPath()
  for (let i = 0; i < size; i++) {
    const idx = (ptr + i) % size
    const val = (data[idx] as number) || 0
    const x = 2 + (i / (size - 1)) * (CANVAS_W - 4)
    const y = graphY(val)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = fpsColor.value
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 最右侧当前值高亮点
  if (ptr > 0) {
    const lastVal = (data[(ptr - 1 + size) % size] as number) || 0
    const dotY = graphY(lastVal)
    ctx.beginPath()
    ctx.arc(CANVAS_W - 2, dotY, 2, 0, Math.PI * 2)
    ctx.fillStyle = fpsColor.value
    ctx.fill()
  }
  ctx.font = '9px monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.textAlign = 'right'
  ctx.fillText(String(maxFps), CANVAS_W - 2, 9)
}

onMounted(() => {
  const canvas = canvasRef.value!
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(CANVAS_W * dpr)
  canvas.height = Math.round(CANVAS_H * dpr)
  canvas.getContext('2d')?.scale(dpr, dpr)

  startFpsMonitor()
  draw()
  timer = setInterval(draw, 100)
})

onUnmounted(() => {
  clearInterval(timer)
  stopFpsMonitor()
})
</script>

<template>
  <div class="pointer-events-none font-mono select-none">
    <!-- 数值行 -->
    <div class="mb-1 flex items-baseline gap-1.5">
      <span class="text-base leading-none font-bold tabular-nums" :style="{ color: fpsColor }">{{
        displayFps
      }}</span>
      <span class="text-[11px] text-white/50">fps</span>
      <span class="text-[10px] text-white/40 tabular-nums">
        {{ displayFps > 0 ? displayMs.toFixed(1) + 'ms' : '--' }}
      </span>
    </div>
    <!-- 历史折线图 -->
    <canvas ref="canvasRef" :style="`width:${CANVAS_W}px;height:${CANVAS_H}px`" class="block" />
  </div>
</template>
