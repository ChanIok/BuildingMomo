<script setup lang="ts">
import { computed } from 'vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/composables/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ThreeTooltipData } from '@/composables/useThreeTooltip'
import LoadingProgress from './LoadingProgress.vue'
import CanvasToolbar from './CanvasToolbar.vue'
import FurnitureLibrary from './FurnitureLibrary.vue'
import DyePanel from './DyePanel.vue'
import DebugPanel from './DebugPanel.vue'

const { t } = useI18n()

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

interface ContextMenuState {
  open: boolean
  x: number
  y: number
}

interface TooltipState {
  visible: boolean
  data: ThreeTooltipData | null
}

interface SelectionState {
  rect: SelectionRect | null
  lasso: { x: number; y: number }[]
}

interface ViewInfo {
  isOrthographic: boolean
  controlMode: 'orbit' | 'flight'
  currentViewPreset: string | null
}

interface CameraDebugData {
  cameraPosition: [number, number, number]
  cameraLookAt: [number, number, number]
  orbitTarget: [number, number, number]
  controlMode: string
  currentViewPreset: string | null
  isOrthographic: boolean
  isViewFocused: boolean
  isNavKeyPressed: boolean
  cameraZoom: number
}

interface Props {
  contextMenu: ContextMenuState
  tooltip: TooltipState
  selection: SelectionState
  viewInfo: ViewInfo
  cameraDebugData?: CameraDebugData | null
  isDev?: boolean
  commandStore: any
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:contextMenu': [value: ContextMenuState]
}>()

// 控制右键菜单
const contextMenuOpen = computed({
  get: () => props.contextMenu.open,
  set: (val) => {
    emit('update:contextMenu', { ...props.contextMenu, open: val })
  },
})

const settingsStore = useSettingsStore()

function getControlKeyName(key: 'orbitRotate' | 'flightLook') {
  const binding = settingsStore.settings.inputBindings.camera[key]
  return t(`settings.inputBindings.keysShort.${binding}`)
}

function handleViewInfoClick() {
  if (props.viewInfo.isOrthographic) return
  props.commandStore.executeCommand('view.toggleCameraMode')
}
</script>

<template>
  <!-- 右上角状态信息组 -->
  <div class="absolute top-4 right-4 z-30 flex flex-col items-end gap-2">
    <!-- 视图信息 -->
    <div
      class="flex items-baseline rounded-md border bg-background/90 px-3 py-2 text-xs shadow-xs backdrop-blur-sm"
    >
      <div class="flex items-baseline gap-2">
        <div
          class="font-medium transition-colors"
          :class="{
            'cursor-pointer hover:text-primary': !viewInfo.isOrthographic,
            'cursor-default': viewInfo.isOrthographic,
          }"
          @click.stop="handleViewInfoClick"
        >
          <template v-if="viewInfo.isOrthographic">
            {{ t('editor.viewMode.orthographic') }}
          </template>
          <template v-else>
            {{
              viewInfo.controlMode === 'flight'
                ? t('editor.viewMode.flight')
                : t('editor.viewMode.orbit')
            }}
            <span class="ml-1 text-[10px]">· {{ t('editor.controls.tabSwitch') }}</span>
          </template>
        </div>
        <div class="text-[10px] text-muted-foreground">
          <template v-if="viewInfo.isOrthographic">
            {{
              t('editor.controls.ortho', {
                pan: getControlKeyName('orbitRotate'),
              })
            }}
          </template>
          <template v-else-if="viewInfo.controlMode === 'orbit'">
            {{
              t('editor.controls.orbit', {
                rotate: getControlKeyName('orbitRotate'),
              })
            }}
          </template>
          <template v-else>
            {{
              t('editor.controls.flight', {
                look: getControlKeyName('flightLook'),
              })
            }}
          </template>
        </div>
      </div>
    </div>

    <!-- 加载进度显示（右上角） -->
    <LoadingProgress />
  </div>

  <!-- 画布工具栏（底部居中） -->
  <div class="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
    <CanvasToolbar />
  </div>

  <!-- 左侧面板 -->
  <FurnitureLibrary v-model:open="commandStore.showFurnitureLibrary" />
  <DyePanel v-model:open="commandStore.showDyePanel" />

  <!-- 右键菜单 -->
  <DropdownMenu v-model:open="contextMenuOpen" :modal="false">
    <!-- 虚拟触发器：不可见但存在于 DOM 中，动态定位到鼠标位置 -->
    <DropdownMenuTrigger as-child>
      <div
        :style="{
          position: 'fixed',
          left: `${contextMenu.x}px`,
          top: `${contextMenu.y}px`,
          width: '1px',
          height: '1px',
          pointerEvents: 'none',
          opacity: 0,
        }"
      />
    </DropdownMenuTrigger>

    <!-- 菜单内容 -->
    <DropdownMenuContent
      :side="'bottom'"
      :align="'start'"
      :side-offset="0"
      :align-offset="0"
      @escape-key-down="contextMenuOpen = false"
      @pointer-down-outside="contextMenuOpen = false"
    >
      <DropdownMenuItem
        :disabled="!commandStore.isCommandEnabled('edit.cut')"
        @select="commandStore.executeCommand('edit.cut')"
      >
        <span>{{ t('command.edit.cut') }}</span>
        <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        :disabled="!commandStore.isCommandEnabled('edit.copy')"
        @select="commandStore.executeCommand('edit.copy')"
      >
        <span>{{ t('command.edit.copy') }}</span>
        <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        :disabled="!commandStore.isCommandEnabled('edit.paste')"
        @select="commandStore.executeCommand('edit.paste')"
      >
        <span>{{ t('command.edit.paste') }}</span>
        <DropdownMenuShortcut>Ctrl+V</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        :disabled="!commandStore.isCommandEnabled('edit.group')"
        @select="commandStore.executeCommand('edit.group')"
      >
        <span>{{ t('command.edit.group') }}</span>
        <DropdownMenuShortcut>Ctrl+G</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        :disabled="!commandStore.isCommandEnabled('edit.ungroup')"
        @select="commandStore.executeCommand('edit.ungroup')"
      >
        <span>{{ t('command.edit.ungroup') }}</span>
        <DropdownMenuShortcut>Ctrl+Shift+G</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        :disabled="!commandStore.isCommandEnabled('view.focusSelection')"
        @select="commandStore.executeCommand('view.focusSelection')"
      >
        <span>{{ t('command.view.focusSelection') }}</span>
        <DropdownMenuShortcut>F</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        :disabled="!commandStore.isCommandEnabled('edit.delete')"
        @select="commandStore.executeCommand('edit.delete')"
        variant="destructive"
      >
        <span>{{ t('command.edit.delete') }}</span>
        <DropdownMenuShortcut>Delete</DropdownMenuShortcut>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  <!-- 3D 框选矩形 -->
  <div
    v-if="selection.rect"
    class="pointer-events-none absolute border border-blue-400/80 bg-blue-500/10"
    :style="{
      left: selection.rect.x + 'px',
      top: selection.rect.y + 'px',
      width: selection.rect.width + 'px',
      height: selection.rect.height + 'px',
    }"
  ></div>

  <!-- 3D 套索路径 -->
  <svg
    v-if="selection.lasso && selection.lasso.length > 0"
    class="pointer-events-none absolute inset-0 z-10 overflow-visible"
    style="width: 100%; height: 100%"
  >
    <polygon
      :points="selection.lasso.map((p) => `${p.x},${p.y}`).join(' ')"
      fill="rgba(59, 130, 246, 0.1)"
      stroke="rgba(96, 165, 250, 0.8)"
      stroke-width="1"
      stroke-linejoin="round"
      fill-rule="evenodd"
    />
  </svg>

  <!-- 3D Tooltip -->
  <div
    v-if="tooltip.visible && tooltip.data"
    class="pointer-events-none absolute z-50 min-w-max rounded border bg-background/90 p-1 shadow-xl backdrop-blur-sm"
    :style="{
      left: `${tooltip.data.position.x + 12}px`,
      top: `${tooltip.data.position.y - 10}px`,
      transform: 'translateY(-100%)',
    }"
  >
    <div class="flex items-center gap-2 text-sm">
      <img
        v-if="tooltip.data.icon"
        :src="tooltip.data.icon"
        class="h-12 w-12 rounded border"
        :alt="tooltip.data.name"
        @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
      />
      <div class="flex-shrink-0 px-1">
        <div class="font-medium">{{ tooltip.data.name }}</div>
      </div>
      <div
        v-if="isDev"
        class="ml-1 flex flex-col border-l pl-2 font-mono text-[12px] leading-tight text-muted-foreground"
      >
        <span>ID: {{ tooltip.data.gameId }}</span>
        <span>INS: {{ tooltip.data.instanceId }}</span>
      </div>
    </div>
  </div>

  <!-- 调试面板 (开发模式) -->
  <DebugPanel v-if="isDev" :camera-data="cameraDebugData" />
</template>
