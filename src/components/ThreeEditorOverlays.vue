<script setup lang="ts">
import { computed } from 'vue'
import { Slider } from '@/components/ui/slider'
import { Item, ItemContent, ItemTitle } from '@/components/ui/item'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/composables/useI18n'
import type { ThreeTooltipData } from '@/composables/useThreeTooltip'
import LoadingProgress from './LoadingProgress.vue'

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

interface SymbolScaleControl {
  value: number
  show: boolean
}

interface DebugInfo {
  show: boolean
  data: {
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
}

interface Props {
  contextMenu: ContextMenuState
  tooltip: TooltipState
  selection: SelectionState
  viewInfo: ViewInfo
  symbolScale: SymbolScaleControl
  debug?: DebugInfo | null
  isDev?: boolean
  commandStore: any
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:contextMenu': [value: ContextMenuState]
  'update:symbolScale': [value: number]
  'update:showDebug': [value: boolean]
}>()

// 滑块绑定的代理（Slider 组件使用数组）
const symbolScaleProxy = computed({
  get: () => [props.symbolScale.value],
  set: (val) => {
    if (val && val.length > 0 && typeof val[0] === 'number') {
      emit('update:symbolScale', val[0])
    }
  },
})

// 控制右键菜单
const contextMenuOpen = computed({
  get: () => props.contextMenu.open,
  set: (val) => {
    emit('update:contextMenu', { ...props.contextMenu, open: val })
  },
})

// 控制调试面板
const showCameraDebug = computed({
  get: () => props.debug?.show ?? false,
  set: (val) => {
    emit('update:showDebug', val)
  },
})
</script>

<template>
  <!-- 加载进度显示（右上角） -->
  <LoadingProgress class="absolute top-4 right-4" />

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
    class="pointer-events-none absolute z-50 rounded border bg-background/90 p-1 shadow-xl backdrop-blur-sm"
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

  <!-- 视图信息 -->
  <div class="absolute right-4 bottom-4">
    <div
      class="flex h-14 items-center rounded-md border bg-background/90 px-3 py-2 text-xs shadow-md backdrop-blur-sm"
    >
      <div>
        <div class="font-medium">
          <template v-if="viewInfo.isOrthographic">
            {{ t('editor.viewMode.orthographic') }}
          </template>
          <template v-else>
            {{
              viewInfo.controlMode === 'flight'
                ? t('editor.viewMode.flight')
                : t('editor.viewMode.orbit')
            }}
            <span class="ml-1 text-[10px] opacity-60">· {{ t('editor.controls.tabSwitch') }}</span>
          </template>
        </div>
        <div class="mt-1 text-[10px] text-muted-foreground">
          <template v-if="viewInfo.isOrthographic"> {{ t('editor.controls.ortho') }} </template>
          <template v-else-if="viewInfo.controlMode === 'orbit'">
            {{ t('editor.controls.orbit') }}
          </template>
          <template v-else> {{ t('editor.controls.flight') }} </template>
        </div>
      </div>
    </div>
  </div>

  <!-- 图标/方块大小控制 (仅在图标或简化方块模式显示) -->
  <div v-if="symbolScale.show" class="absolute bottom-4 left-4">
    <Item
      variant="muted"
      size="sm"
      class="h-14 rounded-md bg-background/90 px-3 py-2 shadow-md backdrop-blur-sm"
    >
      <ItemContent>
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-baseline gap-2 pr-4">
            <ItemTitle class="text-xs font-medium">
              {{ t('editor.sizeControl.icon') }}
            </ItemTitle>
            <span class="text-[10px] text-muted-foreground">{{
              t('editor.sizeControl.shortcut')
            }}</span>
          </div>
          <span class="w-8 text-right text-xs text-muted-foreground"
            >{{ Math.round(symbolScale.value * 100) }}%</span
          >
        </div>
        <Slider v-model="symbolScaleProxy" :max="3" :min="0.1" :step="0.1" variant="thin" />
      </ItemContent>
    </Item>
  </div>

  <!-- 相机状态调试面板 (开发模式) -->
  <div v-if="debug && isDev" class="absolute bottom-32 left-4">
    <button
      @click="showCameraDebug = !showCameraDebug"
      class="rounded border border-border bg-secondary px-2 py-1 text-xs text-secondary-foreground shadow-sm hover:bg-secondary/80"
    >
      {{ showCameraDebug ? t('editor.debug.hide') : t('editor.debug.show') }}
    </button>
    <div
      v-if="showCameraDebug"
      class="mt-2 max-h-96 overflow-y-auto rounded border border-border bg-card/95 px-3 py-2 font-mono text-xs text-card-foreground shadow-xl backdrop-blur-sm"
      style="max-width: 350px"
    >
      <div class="mb-1 font-bold text-primary">{{ t('editor.debug.title') }}</div>
      <div class="space-y-0.5">
        <div>
          <span class="text-muted-foreground">{{ t('editor.debug.mode') }}:</span>
          {{ debug.data.controlMode }}
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('editor.debug.view') }}:</span>
          {{
            !debug.data.isOrthographic
              ? t('editor.viewMode.perspective')
              : debug.data.currentViewPreset || t('editor.viewMode.orthographic')
          }}
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('editor.debug.projection') }}:</span>
          {{
            debug.data.isOrthographic
              ? t('editor.viewMode.orthographic')
              : t('editor.viewMode.perspective')
          }}
        </div>
        <div class="mt-1 text-muted-foreground">{{ t('editor.debug.position') }}:</div>
        <div class="pl-2">
          X: {{ debug.data.cameraPosition[0].toFixed(1) }}<br />
          Y: {{ debug.data.cameraPosition[1].toFixed(1) }}<br />
          Z: {{ debug.data.cameraPosition[2].toFixed(1) }}
        </div>
        <div class="mt-1 text-muted-foreground">{{ t('editor.debug.target') }}:</div>
        <div class="pl-2">
          X: {{ debug.data.cameraLookAt[0].toFixed(1) }}<br />
          Y: {{ debug.data.cameraLookAt[1].toFixed(1) }}<br />
          Z: {{ debug.data.cameraLookAt[2].toFixed(1) }}
        </div>
        <div class="mt-1 text-muted-foreground">{{ t('editor.debug.orbitCenter') }}:</div>
        <div class="pl-2">
          X: {{ debug.data.orbitTarget[0].toFixed(1) }}<br />
          Y: {{ debug.data.orbitTarget[1].toFixed(1) }}<br />
          Z: {{ debug.data.orbitTarget[2].toFixed(1) }}
        </div>
        <div class="mt-1">
          <span class="text-muted-foreground">{{ t('editor.debug.viewFocused') }}:</span>
          {{ debug.data.isViewFocused ? t('editor.debug.yes') : t('editor.debug.no') }}
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('editor.debug.navKey') }}:</span>
          {{ debug.data.isNavKeyPressed ? t('editor.debug.active') : t('editor.debug.inactive') }}
        </div>
        <div>
          <span class="text-muted-foreground">{{ t('editor.debug.zoom') }}:</span>
          {{ debug.data.cameraZoom.toFixed(2) }}
        </div>
      </div>
    </div>
  </div>
</template>
