<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
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
import type { ImageReference } from '@/lib/ai/types'

const chat = inject(aiChatKey)
if (!chat) throw new Error('AI sidebar requires EditorLayout')
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
const preview = ref<{ image: ImageReference; label: string } | null>(null)
const deleteOpen = ref(false),
  acknowledgeOpen = ref(false)
const referenceOpen = ref(false),
  referenceTitle = ref(''),
  referenceText = ref(''),
  referenceOffset = ref(0)
const referenceCode = ref(''),
  referenceRef = ref(''),
  referenceKind = ref(''),
  referenceError = ref('')
const canSelectReference = ref(false),
  referenceFreshness = ref('')
let referenceRequest = 0
async function openReference(ref: string) {
  const mine = ++referenceRequest
  referenceOpen.value = true
  referenceTitle.value = ref
  referenceText.value = ''
  referenceOffset.value = 0
  referenceCode.value = ''
  referenceKind.value = ''
  referenceFreshness.value = ''
  referenceError.value = ''
  canSelectReference.value = false
  referenceRef.value = ref
  try {
    const detail = await chat!.readReference(ref)
    if (detail && mine === referenceRequest) {
      referenceTitle.value = `${ref} · ${detail.reference.label}`
      referenceKind.value = t(`ai.referenceKinds.${detail.reference.kind}`)
      referenceFreshness.value = t(
        detail.current ? 'ai.referenceCurrent' : 'ai.referenceHistorical'
      )
      referenceText.value = JSON.stringify(detail.value, null, 2) ?? ''
      referenceCode.value = detail.code ?? ''
      canSelectReference.value = detail.reference.kind === 'set' && Boolean(detail.reference.count)
    }
  } catch {
    if (mine === referenceRequest) referenceText.value = t('ai.referenceUnavailable')
  }
}
async function selectReference() {
  const mine = referenceRequest
  try {
    const selected = await chat!.selectReference(referenceRef.value)
    if (mine !== referenceRequest) return
    if (selected) referenceOpen.value = false
    else referenceError.value = t('ai.referenceSelectionBlocked')
  } catch {
    if (mine === referenceRequest) referenceError.value = t('ai.referenceUnavailable')
  }
}
watch(sessionId, () => {
  referenceRequest++
  preview.value = null
  referenceOpen.value = false
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
async function scrollBottom() {
  await nextTick()
  // Recheck after the render: an upward gesture may have cancelled this queued follow.
  if (viewport.value && following.value) {
    viewport.value.scrollTop = viewport.value.scrollHeight
    lastScrollTop = viewport.value.scrollTop
  }
}
function onTimelineResize() {
  if (following.value) void scrollBottom()
}
// Markdown batches, folded reasoning and local images can resize after the text update.
useResizeObserver(timeline, onTimelineResize)
function bottom() {
  following.value = true
  void scrollBottom()
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
watch(
  progress,
  async () => {
    if (following.value) await scrollBottom()
  },
  { flush: 'post' }
)
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
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

const contextStats = computed(() => {
  const info = contextInfo?.value
  if (!info || !info.budget) return null
  const used = info.actual ?? info.estimated
  const total = info.budget
  const percent = Math.min(100, Math.max(0, Math.round((used / total) * 100)))
  return {
    percent,
    used,
    total,
    tokensText: `${formatTokens(used)} / ${formatTokens(total)} tokens`,
    images: info.images,
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
          <SelectContent class="max-h-72">
            <SelectItem
              v-for="session in sessions"
              :key="session.id"
              :value="session.id"
              class="text-xs"
            >
              <div class="flex w-full min-w-0 items-center justify-between gap-2 py-0.5">
                <span class="truncate font-medium">{{ session.title }}</span>
                <span class="shrink-0 text-[10px] text-muted-foreground">{{
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
        <div v-if="!entries.length" class="space-y-4 text-sm">
          <p class="font-medium">{{ t('ai.welcome') }}</p>
          <p class="leading-relaxed text-muted-foreground">{{ t('ai.intro') }}</p>
          <Button v-if="!isConfigured" variant="outline" size="sm" @click="settingsOpen = true">{{
            t('ai.configure')
          }}</Button>
          <button
            v-else
            type="button"
            class="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
            @click="useExample"
          >
            {{ t('ai.example') }}
          </button>
          <p class="text-xs leading-relaxed text-muted-foreground">{{ t('ai.privacy') }}</p>
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
            <div
              v-if="entry.role === 'tool'"
              class="space-y-2 rounded-md border border-border bg-muted/30 p-2.5"
            >
              <div class="flex items-center gap-2 text-xs">
                <LoaderCircle
                  v-if="entry.state === 'running'"
                  class="size-3.5 shrink-0 animate-spin"
                />
                <Check
                  v-else-if="entry.state === 'success'"
                  class="size-3.5 shrink-0 text-primary"
                />
                <CircleAlert v-else class="size-3.5 shrink-0 text-muted-foreground" />
                <Wrench class="size-3 shrink-0 text-muted-foreground" />
                <span class="min-w-0 break-words">{{ toolLabel(entry.toolName) }}</span>
                <span v-if="entry.state === 'cancelled'" class="ml-auto text-muted-foreground">{{
                  t('ai.cancelled')
                }}</span>
              </div>
              <p
                v-if="entry.text"
                class="text-xs break-words"
                :class="entry.state === 'error' ? 'text-destructive' : 'text-muted-foreground'"
              >
                {{ entry.text }}
              </p>
              <div v-if="entry.references?.length" class="flex flex-wrap gap-1.5">
                <button
                  v-for="a in entry.references"
                  :key="a.ref"
                  type="button"
                  class="rounded border border-border px-2 py-1 text-left text-xs hover:bg-accent"
                  @click="openReference(a.ref)"
                >
                  {{ a.ref }} · {{ a.label
                  }}<span v-if="a.count !== undefined"> · {{ a.count }}</span>
                </button>
              </div>
              <AiImage
                v-for="image in entry.images"
                :key="image.id"
                :image="image"
                :label="toolLabel(entry.toolName)"
                @open="preview = { image, label: toolLabel(entry.toolName) }"
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
              <div v-if="entry.references?.length" class="mb-2 flex flex-wrap gap-1.5">
                <button
                  v-for="a in entry.references"
                  :key="a.ref"
                  type="button"
                  class="rounded border border-border px-2 py-1 text-left text-xs hover:bg-accent"
                  @click="openReference(a.ref)"
                >
                  {{ a.ref }} · {{ a.label }} · {{ a.count }}
                </button>
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
              <TooltipContent side="top" align="start" class="space-y-1 p-2 text-xs">
                <div class="font-medium text-foreground">{{ t('ai.contextWindowTitle') }}</div>
                <div class="text-muted-foreground">
                  {{ t('ai.contextWindowUsed', { percent: contextStats.percent }) }}
                </div>
                <div class="text-[11px] text-muted-foreground">{{ contextStats.tokensText }}</div>
                <div v-if="contextStats.images" class="text-[11px] text-muted-foreground">
                  {{ t('ai.contextWindowImages', { images: contextStats.images }) }}
                </div>
                <div
                  v-if="compacted"
                  class="border-t border-border/50 pt-1 text-[10px] text-muted-foreground"
                >
                  {{ t('ai.contextWindowCompacted') }}
                </div>
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
    <Dialog v-model:open="referenceOpen">
      <DialogContent
        class="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
        :aria-describedby="undefined"
      >
        <DialogTitle>{{ referenceTitle }}</DialogTitle>
        <p class="text-xs text-muted-foreground">{{ referenceKind }} · {{ referenceFreshness }}</p>
        <pre class="max-h-[45vh] overflow-auto text-xs break-all whitespace-pre-wrap">{{
          referenceText.slice(referenceOffset, referenceOffset + 10000)
        }}</pre>
        <div class="flex items-center justify-between gap-2 text-xs">
          <Button
            variant="outline"
            size="sm"
            :disabled="referenceOffset === 0"
            @click="referenceOffset -= 10000"
            >←</Button
          >
          <span
            >{{ referenceText.length ? referenceOffset + 1 : 0 }}–{{
              Math.min(referenceOffset + 10000, referenceText.length)
            }}
            / {{ referenceText.length }}</span
          >
          <Button
            variant="outline"
            size="sm"
            :disabled="referenceOffset + 10000 >= referenceText.length"
            @click="referenceOffset += 10000"
            >→</Button
          >
        </div>
        <details v-if="referenceCode" class="text-xs">
          <summary class="cursor-pointer text-muted-foreground">{{ t('ai.sourceCode') }}</summary>
          <pre class="mt-2 max-h-48 overflow-auto break-all whitespace-pre-wrap">{{
            referenceCode
          }}</pre>
        </details>
        <p v-if="referenceError" role="alert" class="text-xs text-destructive">
          {{ referenceError }}
        </p>
        <Button
          v-if="canSelectReference"
          variant="outline"
          size="sm"
          :disabled="isLoading"
          @click="selectReference"
          >{{ t('ai.selectReference') }}</Button
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
    <Dialog
      :open="!!preview"
      @update:open="
        (open) => {
          if (!open) preview = null
        }
      "
    >
      <DialogContent class="max-h-[90vh] sm:max-w-5xl" :aria-describedby="undefined">
        <DialogTitle>{{ preview?.label }}</DialogTitle>
        <AiImage v-if="preview" :image="preview.image" :label="preview.label" eager />
      </DialogContent>
    </Dialog>
  </section>
</template>
