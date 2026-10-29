<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import {
  Bot,
  Check,
  ChevronLeft,
  Copy,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-vue-next'
import { externalAiKey } from '@/composables/ai/useExternalAi'
import { useI18n } from '@/composables/useI18n'
import { aiExecutionBusy } from '@/lib/ai/executionGate'
import type { ImageReference, ToolRecord } from '@/lib/ai/types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import ExternalAiSettingsDialog from './ExternalAiSettingsDialog.vue'
import AiImage from './AiImage.vue'
import AiImagePreviewModal from './AiImagePreviewModal.vue'

const service = inject(externalAiKey)!
const { supported, enabled, running, error, sessions, selected, uncertain } = service
const { t, locale } = useI18n()
const workspace = inject<
  { panel: any; switchTo: (mode: 'builtin' | 'external') => void } | undefined
>('aiWorkspacePanel', undefined)

const copied = ref('')
const copyFailed = ref(false)
const settingsOpen = ref(false)
const deleteOpen = ref(false)
const acknowledgeOpen = ref(false)
const preview = ref<ImageReference | null>(null)
const visibleCount = ref(50)
const expanded = ref(new Set<string>())
const tools = computed(() => selected.value?.tools.slice(-visibleCount.value) ?? [])

function formatSessionDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const currentContextTitle = computed(() => {
  if (!selected.value) return t('ai.external.newContext')
  return `${selected.value.conversation.title} · ${formatSessionDate(selected.value.conversation.createdAt)}`
})

function chooseContext(val: unknown) {
  if (typeof val === 'string' && val && val !== selected.value?.conversation.id) {
    void service.loadContext(val)
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(timer))

watch(
  () => selected.value?.conversation.id,
  () => {
    preview.value = null
    visibleCount.value = 50
    expanded.value = new Set()
  }
)

async function copy(value: string, key: string) {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = key
    copyFailed.value = false
    clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = ''
    }, 2000)
  } catch {
    copyFailed.value = true
  }
}

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}

function output(tool: ToolRecord) {
  return JSON.stringify({ ...tool.result, edits: tool.edits }, null, 2)
}

function stateLabel(tool: ToolRecord) {
  if (['requested', 'prepared'].includes(tool.state)) return t('ai.toolExecuting')
  if (tool.state === 'succeeded') return t('ai.toolExecuted')
  if (tool.state === 'interrupted') return t('ai.toolCancelled')
  return t('ai.toolFailed')
}

function confirmDelete() {
  deleteOpen.value = false
  void service.removeContext()
}

function confirmAcknowledge() {
  acknowledgeOpen.value = false
  void service.acknowledge()
}
</script>

<template>
  <section class="flex h-full min-w-0 flex-col" :aria-label="t('ai.external.external')">
    <!-- 顶栏：返回按钮 + 任务下拉框 + 状态药丸 + 新建 + 更多菜单 -->
    <div class="flex shrink-0 items-center justify-between gap-1.5 px-3 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :title="t('ai.external.switchToBuiltin')"
        :aria-label="t('ai.external.switchToBuiltin')"
        @click="workspace?.switchTo('builtin')"
      >
        <ChevronLeft class="size-4" />
      </Button>

      <div class="min-w-0 flex-1">
        <Select
          :model-value="selected?.conversation.id ?? ''"
          :disabled="!sessions.length"
          @update:model-value="chooseContext"
        >
          <SelectTrigger size="sm" class="w-full text-xs" :aria-label="t('ai.external.contexts')">
            <SelectValue :placeholder="t('ai.external.newContext')">
              <span class="truncate">{{ currentContextTitle }}</span>
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
                  formatSessionDate(session.createdAt)
                }}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <!-- 状态药丸 Badge：对齐客户端设置中的状态胶囊样式（无边框、对应配色与圆点） -->
        <button
          type="button"
          class="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-opacity hover:opacity-80 active:opacity-90"
          :class="
            enabled
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
          "
          :title="t('ai.external.openSettings')"
          @click="settingsOpen = true"
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :class="enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
          />
          <span>{{ t(enabled ? 'ai.external.statusEnabled' : 'ai.external.statusDisabled') }}</span>
        </button>

        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="aiExecutionBusy || !supported"
          :title="t('ai.external.newContext')"
          :aria-label="t('ai.external.newContext')"
          @click="service.newContext"
        >
          <Plus class="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" :title="t('ai.more')" :aria-label="t('ai.more')">
              <MoreHorizontal class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuItem @click="settingsOpen = true">
              <Settings2 class="mr-2 size-4" />
              <span>{{ t('ai.external.openSettings') }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="!selected"
              @click="selected && copy(selected.conversation.id, 'context')"
            >
              <Copy class="mr-2 size-4" />
              <span>{{ t('ai.external.copyContext') }}</span>
            </DropdownMenuItem>
            <DropdownMenuItem @click="workspace?.switchTo('builtin')">
              <Bot class="mr-2 size-4" />
              <span>{{ t('ai.external.switchToBuiltin') }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="text-destructive focus:text-destructive"
              :disabled="aiExecutionBusy || !selected"
              @click="deleteOpen = true"
            >
              <Trash2 class="mr-2 size-4" />
              <span>{{ t('ai.external.deleteContext') }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- 版本过旧不支持提示 -->
    <div
      v-if="!supported"
      class="border-b border-sidebar-border bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <p>{{ t('ai.external.upgrade') }}</p>
    </div>

    <!-- 内容与日志主体 -->
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
      <!-- 服务未开启时的流式引导（对齐内置 AI 的说明排版） -->
      <div v-if="!enabled" class="space-y-3.5 pt-1 text-sm">
        <p class="font-medium text-foreground">{{ t('ai.external.external') }}</p>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {{ t('ai.external.intro') }}
        </p>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" class="text-xs" @click="settingsOpen = true">
            <Settings2 class="mr-1.5 size-3.5" />
            {{ t('ai.external.openSettings') }}
          </Button>
          <Button size="sm" class="text-xs" @click="service.configure(true)">
            {{ t('ai.external.startService') }}
          </Button>
        </div>

        <div class="space-y-2 rounded-md bg-muted/30 p-3 pt-2.5">
          <p class="text-xs font-medium text-foreground/90">{{ t('ai.external.stepsTitle') }}</p>
          <ol class="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>{{ t('ai.external.step1') }}</li>
            <li>{{ t('ai.external.step2') }}</li>
            <li>{{ t('ai.external.step3') }}</li>
          </ol>
        </div>
      </div>

      <!-- 服务已开启但无任务 -->
      <div v-else-if="!sessions.length" class="space-y-2 pt-2 text-xs text-muted-foreground">
        <p class="leading-relaxed">{{ t('ai.external.empty') }}</p>
      </div>

      <!-- 任务执行记录与工具调用 -->
      <template v-else>
        <p v-if="error" role="alert" class="text-xs text-destructive">
          {{ t(`ai.errors.${error}`) }}
        </p>

        <div v-if="uncertain.length" class="space-y-2 rounded-md border border-border p-3 text-xs">
          <p class="leading-relaxed">{{ t('ai.uncertainHint') }}</p>
          <Button
            variant="outline"
            size="sm"
            class="h-auto w-full text-xs whitespace-normal"
            :disabled="running"
            @click="acknowledgeOpen = true"
          >
            {{ t('ai.acknowledge') }}
          </Button>
        </div>

        <Button
          v-if="selected && selected.tools.length > visibleCount"
          variant="outline"
          size="sm"
          class="w-full text-xs"
          @click="visibleCount += 50"
        >
          {{ t('ai.loadOlder') }}
        </Button>

        <p v-if="selected && !tools.length" class="text-xs text-muted-foreground">
          {{ t('ai.external.noExecutions') }}
        </p>

        <article v-for="tool in tools" :key="tool.id" class="space-y-2">
          <div class="rounded-md border border-border">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
              :aria-expanded="expanded.has(tool.id)"
              @click="toggle(tool.id)"
            >
              <LoaderCircle
                v-if="['requested', 'prepared'].includes(tool.state)"
                class="size-3.5 animate-spin"
              />
              <Check v-else-if="tool.state === 'succeeded'" class="size-3.5 text-primary" />
              <span
                class="flex-1 truncate"
                :class="['failed', 'uncertain'].includes(tool.state) ? 'text-destructive' : ''"
              >
                {{ stateLabel(tool) }}
              </span>
              <span class="text-[11px] text-muted-foreground">
                {{ t(expanded.has(tool.id) ? 'ai.hideDetails' : 'ai.viewDetails') }}
              </span>
            </button>
            <div v-if="expanded.has(tool.id)" class="space-y-2 border-t border-border p-2.5">
              <pre
                class="max-h-56 overflow-auto font-mono text-[11px] break-all whitespace-pre-wrap"
                >{{ (tool.input as { code: string }).code }}</pre>
              <pre
                class="max-h-64 overflow-auto font-mono text-[11px] break-all whitespace-pre-wrap text-muted-foreground"
                >{{ output(tool) }}</pre>
            </div>
          </div>
          <AiImage
            v-for="image in tool.assets"
            :key="image.id"
            :image="image"
            :label="t('ai.previewTitle')"
            :load-image="service.loadImage"
            @open="preview = image"
          />
        </article>
      </template>
    </div>

    <!-- 弹窗部分 -->
    <ExternalAiSettingsDialog v-model:open="settingsOpen" />

    <AiImagePreviewModal
      :open="!!preview"
      :image="preview"
      :load-image="service.loadImage"
      @update:open="preview = $event ? preview : null"
    />

    <Dialog :open="deleteOpen" @update:open="deleteOpen = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('ai.external.deleteContext') }}</DialogTitle>
          <DialogDescription>{{ t('ai.deleteHint') }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="deleteOpen = false">{{ t('ai.cancel') }}</Button>
          <Button variant="destructive" @click="confirmDelete">
            {{ t('ai.external.deleteContext') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="acknowledgeOpen" @update:open="acknowledgeOpen = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('ai.acknowledge') }}</DialogTitle>
          <DialogDescription>{{ t('ai.acknowledgeHint') }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="acknowledgeOpen = false">{{ t('ai.cancel') }}</Button>
          <Button @click="confirmAcknowledge">
            {{ t('ai.acknowledge') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
</template>
