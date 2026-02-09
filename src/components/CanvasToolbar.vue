<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useCommandStore } from '@/stores/commandStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/composables/useI18n'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import {
  SquareMousePointer,
  Lasso,
  Hand,
  Move,
  RotateCw,
  ChevronDown,
  Package,
} from 'lucide-vue-next'
import IconSelectionNew from '@/components/icons/IconSelectionNew.vue'
import IconSelectionAdd from '@/components/icons/IconSelectionAdd.vue'
import IconSelectionSubtract from '@/components/icons/IconSelectionSubtract.vue'
import IconSelectionIntersect from '@/components/icons/IconSelectionIntersect.vue'
import IconSelectionToggle from '@/components/icons/IconSelectionToggle.vue'

const editorStore = useEditorStore()
const commandStore = useCommandStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

/**
 * 格式化修饰键字符串为显示格式
 * @param key 键位定义（如 'shift', 'shift+alt'）
 * @returns 格式化后的字符串（如 'Shift', 'Shift+Alt'），如果为 'none' 则返回 null
 */
function formatModifierKey(key: string): string | null {
  if (key === 'none') return null
  return key
    .split('+')
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join('+')
}

/**
 * 根据选择模式 ID 获取对应的快捷键
 * @param actionId 选择模式 ID
 * @returns 格式化后的快捷键字符串，如果没有则返回 null
 */
function getSelectionActionShortcut(actionId: string): string | null {
  const bindings = settingsStore.settings.inputBindings.selection
  switch (actionId) {
    case 'new':
      return null // 新选区没有快捷键
    case 'add':
      return formatModifierKey(bindings.add)
    case 'subtract':
      return formatModifierKey(bindings.subtract)
    case 'intersect':
      return formatModifierKey(bindings.intersect)
    case 'toggle':
      return formatModifierKey(bindings.toggleIndividual)
    default:
      return null
  }
}

// 选择工具配置
const selectionTools = computed(() => [
  {
    id: 'box',
    icon: SquareMousePointer,
    label: t('command.tool.select'),
    shortcut: 'V',
    isActive: editorStore.currentTool === 'select' && editorStore.selectionMode === 'box',
    action: () => {
      editorStore.currentTool = 'select'
      editorStore.selectionMode = 'box'
    },
  },
  {
    id: 'lasso',
    icon: Lasso,
    label: t('command.tool.lasso'),
    shortcut: 'L',
    isActive: editorStore.currentTool === 'select' && editorStore.selectionMode === 'lasso',
    action: () => {
      editorStore.currentTool = 'select'
      editorStore.selectionMode = 'lasso'
    },
  },
  {
    id: 'hand',
    icon: Hand,
    label: t('command.tool.hand'),
    shortcut: 'H',
    isActive: editorStore.currentTool === 'hand',
    action: () => {
      editorStore.currentTool = 'hand'
    },
  },
])

// 选择模式配置
const selectionActions = computed(() => [
  {
    id: 'new',
    icon: IconSelectionNew,
    label: t('command.selectionAction.new'),
    shortcut: getSelectionActionShortcut('new'),
  },
  {
    id: 'add',
    icon: IconSelectionAdd,
    label: t('command.selectionAction.add'),
    shortcut: getSelectionActionShortcut('add'),
  },
  {
    id: 'subtract',
    icon: IconSelectionSubtract,
    label: t('command.selectionAction.subtract'),
    shortcut: getSelectionActionShortcut('subtract'),
  },
  {
    id: 'intersect',
    icon: IconSelectionIntersect,
    label: t('command.selectionAction.intersect'),
    shortcut: getSelectionActionShortcut('intersect'),
  },
  {
    id: 'toggle',
    icon: IconSelectionToggle,
    label: t('command.selectionAction.toggle'),
    shortcut: getSelectionActionShortcut('toggle'),
  },
])

// 当前激活的选择模式
const activeSelectionAction = computed(() => {
  return selectionActions.value.find((a) => a.id === editorStore.selectionAction)
})

// 背包状态
const showFurnitureLibrary = computed({
  get: () => commandStore.showFurnitureLibrary,
  set: (val) => {
    commandStore.showFurnitureLibrary = val
  },
})
</script>

<template>
  <div
    class="canvas-toolbar flex h-11 items-center gap-2 rounded-lg border bg-background/90 px-2 shadow-md backdrop-blur-sm"
  >
    <TooltipProvider :delay-duration="1000" :skip-delay-duration="300">
      <!-- 1. 选择工具 Toggle 组 -->
      <Tooltip v-for="tool in selectionTools" :key="tool.id">
        <TooltipTrigger as-child>
          <div class="inline-flex">
            <Toggle
              size="sm"
              :model-value="tool.isActive"
              @update:model-value="(v) => v && tool.action()"
            >
              <component :is="tool.icon" class="h-4 w-4" />
            </Toggle>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" class="text-xs">
          {{ tool.label }}
          <Kbd v-if="tool.shortcut" class="ml-1">{{ tool.shortcut }}</Kbd>
        </TooltipContent>
      </Tooltip>

      <!-- 2. 选择模式下拉菜单 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="sm" class="h-8 gap-1 px-1.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="flex items-center gap-1">
                  <component :is="activeSelectionAction?.icon" class="h-4 w-4" />
                  <ChevronDown class="h-3 w-3" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" class="text-xs">
                {{ activeSelectionAction?.label }}
                <Kbd v-if="activeSelectionAction?.shortcut" class="ml-1">{{
                  activeSelectionAction.shortcut
                }}</Kbd>
              </TooltipContent>
            </Tooltip>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem
            v-for="action in selectionActions"
            :key="action.id"
            @select="editorStore.selectionAction = action.id as any"
            class="flex items-center justify-between gap-4"
          >
            <div class="flex items-center gap-2">
              <component :is="action.icon" class="h-4 w-4" />
              <span>{{ action.label }}</span>
            </div>
            <DropdownMenuShortcut v-if="action.shortcut">
              {{ action.shortcut }}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 3. 移动 Gizmo Toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <div class="inline-flex">
            <Toggle
              size="sm"
              :model-value="editorStore.gizmoMode === 'translate'"
              @update:model-value="
                (v) => {
                  editorStore.gizmoMode = v ? 'translate' : null
                }
              "
            >
              <Move class="h-4 w-4" />
            </Toggle>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" class="text-xs">
          {{ t('command.tool.toggleTranslate') }}
          <Kbd class="ml-1">G</Kbd>
        </TooltipContent>
      </Tooltip>

      <!-- 4. 旋转 Gizmo Toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <div class="inline-flex">
            <Toggle
              size="sm"
              :model-value="editorStore.gizmoMode === 'rotate'"
              @update:model-value="
                (v) => {
                  editorStore.gizmoMode = v ? 'rotate' : null
                }
              "
            >
              <RotateCw class="h-4 w-4" />
            </Toggle>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" class="text-xs">
          {{ t('command.tool.toggleRotate') }}
          <Kbd class="ml-1">R</Kbd>
        </TooltipContent>
      </Tooltip>

      <!-- 分割线 -->
      <div class="h-6 w-px bg-border"></div>

      <!-- 5. 家具背包 Toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <div class="inline-flex">
            <Toggle size="sm" v-model="showFurnitureLibrary">
              <Package class="h-4 w-4" />
            </Toggle>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" class="text-xs">
          {{ t('command.tool.toggleFurnitureLibrary') }}
          <Kbd class="ml-1">B</Kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>

<style scoped>
.canvas-toolbar {
  --accent: color-mix(in srgb, var(--primary) 20%, transparent);
  --accent-foreground: var(--primary);
  --muted: color-mix(in srgb, var(--primary) 20%, transparent);
  --muted-foreground: var(--primary);
}

/* Toggle 选中状态使用完整的 primary 色 */
.canvas-toolbar :deep([data-slot='toggle'][data-state='on']) {
  background: var(--primary);
  color: var(--primary-foreground);
}

/* Button hover 在暗色模式下统一使用 20% 透明，覆盖默认的 50% */
.canvas-toolbar :deep([data-slot='button']:hover),
.canvas-toolbar :deep([data-slot='dropdown-menu-trigger']:hover) {
  background: var(--accent) !important;
}
</style>
