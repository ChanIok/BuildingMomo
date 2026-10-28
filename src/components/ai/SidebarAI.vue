<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  LoaderCircle,
  Plus,
  Settings2,
  Square,
  Trash2,
  Wrench,
} from 'lucide-vue-next'
import { aiChatKey, type ChatEntry } from '@/composables/ai/chatContext'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveAiConfig } from '@/lib/ai/context'
import { useI18n } from '@/composables/useI18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { downloadBlob } from '@/composables/fileOps/download'
import AiSettingsDialog from './AiSettingsDialog.vue'
import AiImage from './AiImage.vue'
import AiMarkdown from './AiMarkdown.vue'
import AiImagePreviewModal from './AiImagePreviewModal.vue'
import type { ImageReference } from '@/lib/ai/types'

const chat = inject(aiChatKey)
if (!chat) throw new Error('AI sidebar requires the application chat provider')
const {
  entries,
  isRunning,
  error,
  requestStatus,
  requestWarnings,
  canExportTrace,
  isLoading,
  storageState,
  contextInfo,
  compacted,
  interrupted,
  sessions,
  sessionId,
  uncertain,
} = chat
const settings = useSettingsStore()
const isConfigured = computed(() => {
  try {
    return Boolean(resolveAiConfig(settings.ai))
  } catch {
    return false
  }
})
const { t, getLocaleDict } = useI18n()
const settingsOpen = ref(false),
  draft = ref('')
const exportOpen = ref(false),
  includeImages = ref(false),
  exportError = ref('')
const preview = ref<ImageReference | null>(null)
const deleteOpen = ref(false),
  acknowledgeOpen = ref(false)
watch(sessionId, () => {
  preview.value = null
  deleteOpen.value = false
  acknowledgeOpen.value = false
  void bottom()
})
const viewport = ref<HTMLElement | null>(null),
  input = ref<HTMLTextAreaElement | null>(null)
const timeline = ref<HTMLElement | null>(null)
const following = ref(true)
let lastScrollTop = 0,
  touchY: number | undefined
let scrollFrame: number | undefined
const canSend = computed(() => Boolean(draft.value.trim()) && !isRunning.value && !isLoading.value)
const visibleEntries = computed(() =>
  entries.value.filter(
    (entry) =>
      entry.role !== 'assistant' || entry.text || entry.reasoning || entry.state === 'running'
  )
)
/** Thinking streams open while it is being produced, then folds to one line once the turn ends. */
const reasoningOverride = ref<Record<string, boolean>>({})
function reasoningOpen(entry: ChatEntry) {
  return reasoningOverride.value[entry.id] ?? entry.state === 'running'
}
function toggleReasoning(entry: ChatEntry) {
  reasoningOverride.value = { ...reasoningOverride.value, [entry.id]: !reasoningOpen(entry) }
}
const toolDetailsOverride = ref<Record<string, boolean>>({})
function isToolOpen(entry: ChatEntry) {
  return toolDetailsOverride.value[entry.id] ?? entry.state === 'error'
}
function toggleTool(entry: ChatEntry) {
  toolDetailsOverride.value = { ...toolDetailsOverride.value, [entry.id]: !isToolOpen(entry) }
}
function toolStatusLabel(entry: ChatEntry) {
  if (entry.state === 'running') return t('ai.toolExecuting')
  if (entry.state === 'cancelled') return t('ai.toolCancelled')
  if (entry.state === 'error') return t('ai.toolFailed')
  if (entry.state === 'success') return t('ai.toolExecuted')
  return toolLabel(entry.toolName)
}
function onScroll() {
  const el = viewport.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 1
  if (el.scrollTop < lastScrollTop && !atBottom) following.value = false
  else if (el.scrollTop > lastScrollTop && atBottom) following.value = true
  lastScrollTop = el.scrollTop
}
function onWheel(event: WheelEvent) {
  if (event.deltaY < 0 && !event.ctrlKey) following.value = false
}
function onTouchStart(event: TouchEvent) {
  touchY = event.touches[0]?.clientY
}
function onTouchMove(event: TouchEvent) {
  const y = event.touches[0]?.clientY
  if (y !== undefined && touchY !== undefined && y > touchY) following.value = false
  touchY = y
}
function onViewportKeydown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    (event.target as HTMLElement).closest(
      'input, textarea, select, button, [contenteditable="true"], [role="combobox"]'
    )
  )
    return
  if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey))
    following.value = false
}
function scrollBottom() {
  if (!following.value || scrollFrame !== undefined) return
  // Coalesce content and resize updates after Vue's pending DOM updates.
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = undefined
    // An upward gesture may have cancelled this queued follow.
    if (viewport.value && following.value) {
      viewport.value.scrollTop = viewport.value.scrollHeight
      lastScrollTop = viewport.value.scrollTop
    }
  })
}
onBeforeUnmount(() => {
  if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
})
function onTimelineResize() {
  scrollBottom()
}
// Markdown batches, folded reasoning and local images can resize after the text update.
useResizeObserver(timeline, onTimelineResize)
function bottom() {
  following.value = true
  scrollBottom()
}
async function loadOlder() {
  const el = viewport.value
  if (!el) return
  const height = el.scrollHeight,
    top = el.scrollTop
  following.value = false
  chat!.loadOlder()
  await nextTick()
  el.scrollTop = top + el.scrollHeight - height
  lastScrollTop = el.scrollTop
}
const progress = computed(() => {
  const list = entries.value,
    last = list.length ? list[list.length - 1] : undefined
  return `${list.length}:${last?.id ?? ''}:${last?.text.length ?? 0}:${last?.reasoning?.length ?? 0}:${last?.state ?? ''}:${last?.images?.length ?? 0}`
})
watch(progress, scrollBottom, { flush: 'post' })
watch(draft, async () => {
  await nextTick()
  if (input.value) {
    input.value.style.height = 'auto'
    input.value.style.height = `${Math.min(192, input.value.scrollHeight)}px`
  }
})
function send() {
  if (!isConfigured.value) {
    settingsOpen.value = true
    return
  }
  if (!canSend.value) return
  void chat!.send(draft.value)
  if (isRunning.value) {
    draft.value = ''
    void bottom()
  }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    send()
  }
}
function reset() {
  void chat!.reset()
  draft.value = ''
  following.value = true
}
function useExample() {
  draft.value = t('ai.example')
  input.value?.focus()
}
function confirmDelete() {
  deleteOpen.value = false
  void chat!.deleteSession()
}
function confirmAcknowledge() {
  acknowledgeOpen.value = false
  void chat!.acknowledgeUncertain()
}
const currentSession = computed(() => sessions.value.find((s) => s.id === sessionId.value))
const currentSessionTitle = computed(() => currentSession.value?.title || t('ai.newChat'))

function formatSessionDate(timestamp: number) {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTokens(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

const contextStats = computed(() => {
  const info = contextInfo?.value
  if (!info || !info.contextWindow) return null
  const used = info.estimated
  const total = info.contextWindow
  const percentNum = Math.min(100, Math.max(0, (used / total) * 100))
  const percent = percentNum.toFixed(1)
  const usedText = formatTokens(used)
  const totalText = formatTokens(total)
  const summary = t(info.images ? 'ai.contextUsedSummaryWithImages' : 'ai.contextUsedSummary', {
    percent,
    used: usedText,
    total: totalText,
    images: info.images,
  })
  return {
    percent: percentNum,
    summary,
  }
})

function chooseSession(val: unknown) {
  if (typeof val === 'string' && val && val !== sessionId.value) {
    void chat!.openSession(val)
  }
}
function toolLabel(name?: string) {
  return getLocaleDict().ai.tools[name ?? ''] ?? name ?? ''
}
function openExport() {
  includeImages.value = false
  exportError.value = ''
  exportOpen.value = true
}
async function downloadTrace() {
  try {
    const json = await chat!.exportTrace(includeImages.value)
    if (!json) return
    downloadBlob(
      new Blob([json], { type: 'application/json' }),
      `buildingmomo-ai-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    )
    exportOpen.value = false
  } catch {
    exportError.value = t('ai.trace.failed')
  }
}
</script>

<template>
  <section class="flex h-full min-w-0 flex-col" :aria-label="t('ai.title')">
    <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
      <div class="min-w-0 flex-1">
        <Select
          :model-value="sessionId"
          :disabled="isLoading || !sessions.length"
          @update:model-value="chooseSession"
        >
          <SelectTrigger size="sm" class="w-full text-xs" :aria-label="t('ai.history')">
            <SelectValue :placeholder="t('ai.newChat')">
              <span class="truncate">{{ currentSessionTitle }}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            class="max-h-72 w-[var(--reka-select-trigger-width)] max-w-[var(--reka-select-trigger-width)] min-w-[var(--reka-select-trigger-width)]"
          >
            <SelectItem
              v-for="session in sessions"
              :key="session.id"
              :value="session.id"
              class="text-xs"
              :title="session.title"
            >
              <div class="flex w-full min-w-0 items-center justify-between gap-1.5 py-0.5">
                <span class="min-w-0 flex-1 truncate font-medium">{{ session.title }}</span>
                <span class="shrink-0 text-[10px] text-muted-foreground tabular-nums">{{
                  formatSessionDate(session.updatedAt)
                }}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="!canExportTrace"
          :title="t('ai.trace.title')"
          :aria-label="t('ai.trace.title')"
          @click="openExport"
          ><Download class="size-4"
        /></Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="isLoading"
          :title="t('ai.newChat')"
          :aria-label="t('ai.newChat')"
          @click="reset"
          ><Plus class="size-4"
        /></Button>
        <Button
          v-if="sessionId"
          variant="ghost"
          size="icon-sm"
          :disabled="isLoading"
          :title="t('ai.deleteChat')"
          :aria-label="t('ai.deleteChat')"
          @click="deleteOpen = true"
          ><Trash2 class="size-4"
        /></Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="isRunning"
          :title="t('ai.settings')"
          :aria-label="t('ai.settings')"
          @click="settingsOpen = true"
          ><Settings2 class="size-4"
        /></Button>
      </div>
    </div>
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div
        ref="viewport"
        tabindex="0"
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-sidebar px-3 py-4"
        @scroll.passive="onScroll"
        @wheel.passive="onWheel"
        @touchstart.passive="onTouchStart"
        @touchmove.passive="onTouchMove"
        @keydown="onViewportKeydown"
      >
        <div v-if="!entries.length" class="space-y-3 pt-2 text-sm">
          <p class="font-medium text-foreground">{{ t('ai.welcome') }}</p>
          <p class="text-xs leading-relaxed text-muted-foreground">{{ t('ai.intro') }}</p>
          <Button v-if="!isConfigured" variant="outline" size="sm" @click="settingsOpen = true">{{
            t('ai.configure')
          }}</Button>
          <button
            v-else
            type="button"
            class="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            @click="useExample"
          >
            {{ t('ai.example') }}
          </button>
        </div>
        <div ref="timeline" class="min-w-0 space-y-4" role="log" :aria-label="t('ai.conversation')">
          <Button
            v-if="chat.hasOlder.value"
            variant="outline"
            size="sm"
            class="w-full"
            @click="loadOlder"
            >{{ t('ai.loadOlder') }}</Button
          >
          <article v-for="entry in visibleEntries" :key="entry.id" class="min-w-0">
            <div v-if="entry.role === 'tool'" class="space-y-2">
              <div class="rounded-md border border-border bg-muted/20">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  :aria-expanded="isToolOpen(entry)"
                  @click="toggleTool(entry)"
                >
                  <LoaderCircle
                    v-if="entry.state === 'running'"
                    class="size-3.5 shrink-0 animate-spin text-primary"
                  />
                  <Check
                    v-else-if="entry.state === 'success'"
                    class="size-3.5 shrink-0 text-primary"
                  />
                  <CircleAlert
                    v-else-if="entry.state === 'error'"
                    class="size-3.5 shrink-0 text-destructive"
                  />
                  <CircleAlert v-else class="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    class="min-w-0 flex-1 truncate font-medium"
                    :class="entry.state === 'error' ? 'text-destructive' : ''"
                  >
                    {{ toolStatusLabel(entry) }}
                  </span>
                  <span
                    v-if="entry.code || entry.output"
                    class="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                  >
                    <span>{{ isToolOpen(entry) ? t('ai.hideDetails') : t('ai.viewDetails') }}</span>
                    <ChevronRight
                      class="size-3 transition-transform"
                      :class="isToolOpen(entry) ? 'rotate-90' : ''"
                    />
                  </span>
                </button>
                <div
                  v-if="isToolOpen(entry) && (entry.code || entry.output)"
                  class="space-y-2 border-t border-border/50 p-2.5 text-xs"
                >
                  <div v-if="entry.code" class="space-y-1">
                    <span class="font-mono text-[10px] text-muted-foreground uppercase">{{
                      t('ai.sourceCode')
                    }}</span>
                    <pre
                      class="max-h-48 overflow-auto rounded bg-background/50 p-2 font-mono text-[11px] break-all whitespace-pre-wrap"
                      >{{ entry.code }}</pre>
                  </div>
                  <div v-if="entry.output" class="space-y-1">
                    <span class="font-mono text-[10px] text-muted-foreground uppercase">{{
                      t('ai.toolOutput')
                    }}</span>
                    <pre
                      class="max-h-60 overflow-auto rounded bg-background/50 p-2 font-mono text-[11px] break-words whitespace-pre-wrap"
                      :class="
                        entry.state === 'error' ? 'text-destructive' : 'text-muted-foreground'
                      "
                      >{{ entry.output() }}</pre>
                  </div>
                </div>
              </div>
              <AiImage
                v-for="image in entry.images"
                :key="image.id"
                :image="image"
                :label="toolStatusLabel(entry)"
                @open="preview = image"
              />
            </div>
            <div
              v-else
              :class="entry.role === 'user' ? 'ml-5 rounded-lg bg-muted px-3 py-2' : 'space-y-1'"
            >
              <div v-if="entry.reasoning" class="mb-1">
                <button
                  type="button"
                  class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  :aria-expanded="reasoningOpen(entry)"
                  @click="toggleReasoning(entry)"
                >
                  <ChevronRight
                    class="size-3 shrink-0 transition-transform"
                    :class="reasoningOpen(entry) ? 'rotate-90' : ''"
                  />
                  {{ entry.state === 'running' ? t('ai.thinking') : t('ai.thought') }}
                </button>
                <AiMarkdown
                  v-if="reasoningOpen(entry)"
                  class="mt-1 rounded border border-border bg-muted/30 p-2 text-xs leading-relaxed text-muted-foreground"
                  :content="entry.reasoning"
                  :final="entry.state !== 'running'"
                />
              </div>
              <AiMarkdown
                v-if="entry.role === 'assistant'"
                class="text-sm leading-relaxed"
                :content="entry.text"
                :final="entry.state !== 'running'"
              />
              <p
                v-else
                class="text-sm leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap"
              >
                {{ entry.text }}
              </p>
              <LoaderCircle
                v-if="entry.state === 'running'"
                class="mt-2 size-4 animate-spin text-muted-foreground"
              />
              <span v-if="entry.state === 'cancelled'" class="text-xs text-muted-foreground">{{
                t('ai.cancelled')
              }}</span>
            </div>
          </article>
        </div>
      </div>
      <Button
        v-if="!following && entries.length"
        variant="secondary"
        size="sm"
        class="absolute right-3 bottom-2 shadow"
        @click="bottom"
        ><ArrowDown class="size-3.5" />{{ t('ai.latest') }}</Button
      >
    </div>
    <div class="shrink-0 space-y-2 p-3">
      <p v-if="isLoading" class="text-xs text-muted-foreground">{{ t('ai.restoring') }}</p>
      <p v-if="storageState === 'error'" role="status" class="text-xs text-destructive">
        {{ t('ai.storage.error') }}
      </p>
      <p v-if="interrupted && !isRunning" class="text-xs text-muted-foreground">
        {{ t('ai.recovered') }}
      </p>
      <p v-if="requestStatus" class="text-xs text-muted-foreground">{{ requestStatus }}</p>
      <details
        v-if="requestWarnings?.length"
        :open="requestWarnings.some((warning) => /reasoning|thinking|effort/i.test(warning))"
        class="rounded border border-border bg-muted/30 p-2 text-sm"
        role="status"
      >
        <summary class="cursor-pointer">
          {{ t('ai.requestWarnings', { count: requestWarnings.length }) }}
        </summary>
        <ul class="mt-2 space-y-2">
          <li
            v-for="(warning, index) in requestWarnings"
            :key="index"
            class="break-words whitespace-pre-wrap"
          >
            {{ warning }}
          </li>
        </ul>
      </details>
      <p
        v-if="error"
        role="alert"
        class="text-xs leading-relaxed break-words whitespace-pre-line text-destructive"
      >
        {{ error }}
      </p>
      <div
        v-if="uncertain.length"
        class="space-y-2 rounded border border-destructive/40 p-2 text-xs"
      >
        <p>{{ t('ai.uncertainHint') }}</p>
        <Button
          variant="outline"
          size="sm"
          :disabled="isRunning || isLoading"
          @click="acknowledgeOpen = true"
          >{{ t('ai.acknowledge') }}</Button
        >
      </div>
      <Button
        v-if="interrupted && !isRunning"
        variant="outline"
        size="sm"
        class="w-full"
        :disabled="isLoading"
        @click="chat.resume"
        >{{ t('ai.resume') }}</Button
      >
      <form
        class="rounded-lg border border-input bg-background p-2 focus-within:ring-1 focus-within:ring-ring"
        @submit.prevent="send"
      >
        <textarea
          ref="input"
          v-model="draft"
          rows="3"
          :placeholder="t('ai.placeholder')"
          :aria-label="t('ai.placeholder')"
          :disabled="isLoading"
          class="block max-h-48 min-h-16 w-full resize-none bg-transparent text-sm leading-relaxed outline-none disabled:opacity-50"
          @keydown="keydown"
        />
        <div class="mt-2 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Tooltip v-if="contextStats">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex size-6 items-center justify-center rounded transition-colors hover:bg-accent focus:outline-none"
                  :aria-label="t('ai.contextWindowTitle')"
                >
                  <svg class="size-4 -rotate-90 transform" viewBox="0 0 20 20">
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      class="stroke-muted-foreground/25"
                      stroke-width="2.5"
                      fill="none"
                    />
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      :class="
                        contextStats.percent >= 95
                          ? 'stroke-destructive'
                          : contextStats.percent >= 80
                            ? 'stroke-amber-500'
                            : 'stroke-primary/70'
                      "
                      stroke-width="2.5"
                      stroke-linecap="round"
                      fill="none"
                      :stroke-dasharray="43.98"
                      :stroke-dashoffset="43.98 * (1 - contextStats.percent / 100)"
                    />
                  </svg>
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                class="text-xs whitespace-nowrap"
                :side-offset="4"
              >
                <span>{{ contextStats.summary }}</span>
              </TooltipContent>
            </Tooltip>
          </div>
          <div class="flex items-center gap-2">
            <Button
              v-if="isRunning"
              type="button"
              size="icon-sm"
              variant="secondary"
              :title="t('ai.stop')"
              :aria-label="t('ai.stop')"
              @click="chat.stop"
              ><Square class="size-4"
            /></Button>
            <Button
              v-else
              type="submit"
              size="icon-sm"
              :disabled="!canSend"
              :title="t('ai.send')"
              :aria-label="t('ai.send')"
              ><ArrowUp class="size-4"
            /></Button>
          </div>
        </div>
      </form>
    </div>
    <Dialog v-model:open="deleteOpen">
      <DialogContent class="sm:max-w-md"
        ><DialogHeader
          ><DialogTitle>{{ t('ai.deleteChat') }}</DialogTitle
          ><DialogDescription>{{ t('ai.deleteHint') }}</DialogDescription></DialogHeader
        >
        <DialogFooter
          ><Button variant="outline" @click="deleteOpen = false">{{ t('ai.cancel') }}</Button
          ><Button variant="destructive" @click="confirmDelete">{{
            t('ai.deleteChat')
          }}</Button></DialogFooter
        >
      </DialogContent>
    </Dialog>
    <Dialog v-model:open="acknowledgeOpen">
      <DialogContent class="sm:max-w-md"
        ><DialogHeader
          ><DialogTitle>{{ t('ai.acknowledge') }}</DialogTitle
          ><DialogDescription>{{ t('ai.acknowledgeHint') }}</DialogDescription></DialogHeader
        >
        <DialogFooter
          ><Button variant="outline" @click="acknowledgeOpen = false">{{ t('ai.cancel') }}</Button
          ><Button @click="confirmAcknowledge">{{ t('ai.acknowledge') }}</Button></DialogFooter
        >
      </DialogContent>
    </Dialog>
    <AiSettingsDialog v-model:open="settingsOpen" :running="isRunning" />
    <Dialog v-model:open="exportOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('ai.trace.title') }}</DialogTitle>
          <DialogDescription>{{ t('ai.trace.description') }}</DialogDescription>
        </DialogHeader>
        <p class="text-sm leading-relaxed text-muted-foreground">{{ t('ai.trace.retention') }}</p>
        <div class="flex items-start gap-3">
          <Checkbox id="ai-trace-images" v-model="includeImages" class="mt-0.5" />
          <div class="space-y-1">
            <Label for="ai-trace-images">{{ t('ai.trace.includeImages') }}</Label>
            <p class="text-xs leading-relaxed text-muted-foreground">
              {{ t('ai.trace.imageHint') }}
            </p>
          </div>
        </div>
        <p v-if="exportError" role="alert" class="text-sm text-destructive">{{ exportError }}</p>
        <DialogFooter
          ><Button @click="downloadTrace"
            ><Download class="size-4" />{{ t('ai.trace.download') }}</Button
          ></DialogFooter
        >
      </DialogContent>
    </Dialog>
    <AiImagePreviewModal
      :open="!!preview"
      :image="preview"
      @update:open="
        (open) => {
          if (!open) preview = null
        }
      "
    />
  </section>
</template>
