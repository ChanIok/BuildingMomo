<script setup lang="ts">
import { ref, computed, markRaw, watch, onActivated, onDeactivated, onMounted, toRef } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { OrbitControls, TransformControls } from '@tresjs/cientos'
import { Object3D, MOUSE } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useCommandStore } from '@/stores/commandStore'
import { useFurnitureStore } from '@/stores/furnitureStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThreeSelection } from '@/composables/useThreeSelection'
import { useThreeTransformGizmo } from '@/composables/useThreeTransformGizmo'
import { useThreeInstancedRenderer } from '@/composables/useThreeInstancedRenderer'
import { useThreeTooltip } from '@/composables/useThreeTooltip'
import { useThreeNavigation, type ViewPreset } from '@/composables/useThreeNavigation'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Button } from '@/components/ui/button'
import {
  Camera,
  Eye,
  ChevronsUp,
  ChevronsDown,
  ChevronsRight,
  ChevronsLeft,
  ChevronRight,
  ChevronLeft,
} from 'lucide-vue-next'

const editorStore = useEditorStore()
const commandStore = useCommandStore()
const furnitureStore = useFurnitureStore()
const settingsStore = useSettingsStore()

// 3D 选择 & gizmo 相关引用
const threeContainerRef = ref<HTMLElement | null>(null)
const cameraRef = ref<any | null>(null) // 透视相机
const orthoCameraRef = ref<any | null>(null) // 正交相机
const orbitControlsRef = ref<any | null>(null)
const gridRef = ref<any | null>(null) // 网格引用
const gizmoPivot = ref<Object3D | null>(markRaw(new Object3D()))

// 当前活动的相机（根据视图类型动态切换）
const activeCameraRef = computed(() => {
  return isOrthographic.value ? orthoCameraRef.value : cameraRef.value
})

// 创建共享的 isTransformDragging ref
const isTransformDragging = ref(false)

// Orbit 模式下的中心点：用于中键绕场景/选中物品旋转
const orbitTarget = ref<[number, number, number]>([0, 0, 0])

// 相机导航（WASD/Q/Space）
const {
  cameraPosition,
  cameraLookAt,
  controlMode,
  currentViewPreset,
  isOrthographic,
  handleNavPointerDown,
  handleNavPointerMove,
  handleNavPointerUp,
  setPoseFromLookAt,
  lookAtTarget,
  switchToOrbitMode,
  setViewPreset,
} = useThreeNavigation(
  {
    baseSpeed: 1000,
    shiftSpeedMultiplier: 4,
    mouseSensitivity: 0.002,
    pitchLimits: { min: -90, max: 90 },
    minHeight: -10000,
  },
  {
    isTransformDragging,
    // 从 flight 切回 orbit 时，更新 OrbitControls 的 target
    onOrbitTargetUpdate: (target) => {
      orbitTarget.value = target
    },
  }
)

// 先初始化 renderer 获取 updateSelectedInstancesMatrix 函数
const { instancedMesh, indexToIdMap, updateSelectedInstancesMatrix, setHoveredItemId } =
  useThreeInstancedRenderer(editorStore, furnitureStore, isTransformDragging)

// 然后初始化 gizmo，传入 updateSelectedInstancesMatrix
const {
  shouldShowGizmo,
  handleGizmoDragging,
  handleGizmoMouseDown,
  handleGizmoMouseUp,
  handleGizmoChange,
} = useThreeTransformGizmo(
  editorStore,
  gizmoPivot,
  updateSelectedInstancesMatrix,
  isTransformDragging,
  orbitControlsRef
)

const { selectionRect, handlePointerDown, handlePointerMove, handlePointerUp } = useThreeSelection(
  editorStore,
  activeCameraRef,
  {
    instancedMesh,
    indexToIdMap,
  },
  threeContainerRef,
  isTransformDragging
)

// 3D Tooltip 系统（与 2D 复用同一开关）
const {
  tooltipVisible,
  tooltipData,
  handlePointerMove: handleTooltipPointerMove,
  hideTooltip,
} = useThreeTooltip(
  editorStore,
  furnitureStore,
  activeCameraRef,
  threeContainerRef,
  {
    instancedMesh,
    indexToIdMap,
  },
  toRef(settingsStore.settings, 'showFurnitureTooltip'),
  isTransformDragging,
  setHoveredItemId
)

function handlePointerMoveWithTooltip(evt: PointerEvent) {
  handlePointerMove(evt)
  // 3D 中没有拖动选框以外的拖拽逻辑，这里直接用 selectionRect 是否存在来判断是否在框选
  const isSelecting = !!selectionRect.value
  handleTooltipPointerMove(evt, isSelecting)
}

// 容器级指针事件：先交给导航，再交给选择/tooltip
function handleContainerPointerDown(evt: PointerEvent) {
  handleNavPointerDown(evt)
  handlePointerDown(evt)
}

function handleContainerPointerMove(evt: PointerEvent) {
  handleNavPointerMove(evt)
  handlePointerMoveWithTooltip(evt)
}

function handleContainerPointerUp(evt: PointerEvent) {
  handleNavPointerUp(evt)
  handlePointerUp(evt)
}

function handleContainerPointerLeave(evt: PointerEvent) {
  handleContainerPointerUp(evt)
  hideTooltip()
}

// OrbitControls 变更时，同步导航相机姿态，避免两种视角模式之间跳变
function handleOrbitChange() {
  const cam = activeCameraRef.value as any
  if (!cam) return

  // flight 模式下不反向同步，避免循环
  if (controlMode.value === 'flight') return

  // 正交视图下，平移时不应该改变朝向，直接返回
  if (isOrthographic.value) return

  const pos = cam.position
  const target = orbitTarget.value

  // 使用当前 orbitTarget 作为观察目标，将导航系统的姿态对齐到 Orbit 的结果
  setPoseFromLookAt([pos.x, pos.y, pos.z], target)
}

// 计算场景中心（用于初始化相机位置）
const sceneCenter = computed<[number, number, number]>(() => {
  if (editorStore.items.length === 0) {
    return [0, 0, 0]
  }

  const bounds = editorStore.bounds
  const heightFilter = editorStore.heightFilter

  // 安全检查：bounds 可能为 null
  if (!bounds) {
    return [0, (heightFilter.min + heightFilter.max) / 2, 0]
  }

  return [
    (bounds.minX + bounds.maxX) / 2,
    (heightFilter.min + heightFilter.max) / 2, // Z轴（高度）
    (bounds.minY + bounds.maxY) / 2,
  ]
})

// 计算合适的相机距离
const cameraDistance = computed(() => {
  if (editorStore.items.length === 0) {
    return 5000
  }

  const bounds = editorStore.bounds
  const heightFilter = editorStore.heightFilter

  // 安全检查：bounds 可能为 null
  if (!bounds) {
    const rangeZ = heightFilter.max - heightFilter.min
    return Math.max(rangeZ * 2, 3000)
  }

  const rangeX = bounds.maxX - bounds.minX
  const rangeY = bounds.maxY - bounds.minY
  const rangeZ = heightFilter.max - heightFilter.min

  const maxRange = Math.max(rangeX, rangeY, rangeZ)
  return Math.max(maxRange * 2, 3000)
})

// 计算正交相机的视锥体参数
const orthoFrustum = computed(() => {
  const distance = cameraDistance.value
  // 使用距离作为视锥体大小的基准，留一些余量
  const size = distance * 0.6

  // 获取容器宽高比（默认 16:9，实际会由 TresCanvas 自动适配）
  const container = threeContainerRef.value
  const aspect = container ? container.clientWidth / container.clientHeight : 16 / 9

  return {
    left: (-size * aspect) / 2,
    right: (size * aspect) / 2,
    top: size / 2,
    bottom: -size / 2,
  }
})

// 根据当前视图计算网格的旋转角度
const gridRotation = computed<[number, number, number]>(() => {
  const preset = currentViewPreset.value

  switch (preset) {
    case 'front':
    case 'back':
      // 前/后视图: XY 平面（垂直墙面），绕 X 轴旋转 90°
      return [Math.PI / 2, 0, 0]

    case 'left':
    case 'right':
      // 左/右视图: YZ 平面（垂直墙面），绕 Z 轴旋转 90°
      return [0, 0, Math.PI / 2]

    case 'top':
    case 'bottom':
    case 'perspective':
    default:
      // 顶/底/透视视图: XZ 平面（水平地面），默认方向
      return [0, 0, 0]
  }
})

// 计算并设置最佳相机位置（类似2D视图的fitToView）
function fitCameraToScene() {
  const center = sceneCenter.value
  const distance = cameraDistance.value

  const position: [number, number, number] = [
    center[0] + distance * 0.6,
    center[1] + distance * 0.8,
    center[2] + distance * 0.6,
  ]

  orbitTarget.value = center
  setPoseFromLookAt(position, center)
}

// 聚焦到选中物品的中心
function focusOnSelection() {
  const newTarget = switchToOrbitMode()
  if (newTarget) orbitTarget.value = newTarget
  const center = editorStore.getSelectedItemsCenter?.()
  if (center) {
    const target: [number, number, number] = [center.x, center.z, center.y]
    orbitTarget.value = target
    lookAtTarget(target)
  }
}

// 聚焦到整个场景
function focusOnScene() {
  const newTarget = switchToOrbitMode()
  if (newTarget) orbitTarget.value = newTarget
  fitCameraToScene()
}

// 智能更新视图：方案切换或首次加载时重置视角
watch(
  () => editorStore.activeSchemeId,
  () => {
    if (editorStore.activeSchemeId) {
      fitCameraToScene()
    }
  },
  { immediate: true }
)

// 重置3D视图（用于命令系统）
function resetView3D() {
  focusOnScene() // 这会同时重置轨道中心和相机位置
}

// 视图切换函数（供命令系统调用）
function switchToView(preset: ViewPreset) {
  const center = sceneCenter.value
  const distance = cameraDistance.value

  // 切换到预设视图（带动画）
  setViewPreset(preset, center, distance)

  // 确保在 Orbit 模式
  const newTarget = switchToOrbitMode()
  if (newTarget) orbitTarget.value = newTarget
}

// 当 3D 视图激活时，注册视图函数
onActivated(() => {
  // 3D视图不需要缩放功能，但需要重置视图和聚焦选中功能
  commandStore.setZoomFunctions(null, null, resetView3D, focusOnSelection)
  // 注册视图切换函数
  commandStore.setViewPresetFunction(switchToView)
})

// 当 3D 视图停用时，清除函数
onDeactivated(() => {
  commandStore.setZoomFunctions(null, null, null, null)
  commandStore.setViewPresetFunction(null)
})

// 设置网格深度控制，使其显示在物体后面
onMounted(() => {
  if (gridRef.value) {
    const grid = gridRef.value
    if (grid.material) {
      grid.material.depthWrite = false
      grid.renderOrder = -1
    }
  }
})
</script>

<template>
  <div class="absolute inset-0 bg-gray-100">
    <!-- 空状态提示 -->
    <div
      v-if="editorStore.items.length === 0"
      class="absolute inset-0 flex items-center justify-center text-lg text-gray-400"
    >
      <div class="text-center">
        <svg
          class="mx-auto mb-4 h-24 w-24 text-gray-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          ></path>
        </svg>
        <p>请导入 JSON 文件以查看物品</p>
        <p class="mt-2 text-sm text-gray-300">使用中键拖拽绕场景旋转视角</p>
        <p class="text-sm text-gray-300">滚轮缩放，WASD/Q/空格移动相机</p>
      </div>
    </div>

    <!-- Three.js 场景 + 选择层 -->
    <div
      v-if="editorStore.items.length > 0"
      ref="threeContainerRef"
      class="absolute inset-0"
      @pointerdown="handleContainerPointerDown"
      @pointermove="handleContainerPointerMove"
      @pointerup="handleContainerPointerUp"
      @pointerleave="handleContainerPointerLeave"
      @mousedown.right.prevent.stop
      @contextmenu.prevent
    >
      <TresCanvas clear-color="#f3f4f6">
        <!-- 透视相机 - perspective 视图 -->
        <TresPerspectiveCamera
          v-if="!isOrthographic"
          ref="cameraRef"
          :position="cameraPosition"
          :look-at="cameraLookAt"
          :fov="50"
          :near="100"
          :far="150000"
        />

        <!-- 正交相机 - 六个方向视图 -->
        <TresOrthographicCamera
          v-if="isOrthographic"
          ref="orthoCameraRef"
          :position="cameraPosition"
          :look-at="cameraLookAt"
          :left="orthoFrustum.left"
          :right="orthoFrustum.right"
          :top="orthoFrustum.top"
          :bottom="orthoFrustum.bottom"
          :near="100"
          :far="150000"
        />

        <!-- 轨道控制器：透视视图下使用中键旋转，正交视图下使用中键平移 -->
        <OrbitControls
          ref="orbitControlsRef"
          :target="orbitTarget"
          :enableDamping="false"
          :enabled="controlMode === 'orbit'"
          :enableRotate="!isOrthographic"
          :enablePan="isOrthographic"
          :mouseButtons="isOrthographic ? { MIDDLE: MOUSE.PAN } : { MIDDLE: MOUSE.ROTATE }"
          @change="handleOrbitChange"
        />

        <!-- 光照 -->
        <TresAmbientLight :intensity="0.6" />
        <TresDirectionalLight :position="[1000, 2000, 1000]" :intensity="0.8" :cast-shadow="true" />

        <!-- 辅助元素 - 适配大场景 -->
        <TresGroup :rotation="gridRotation">
          <TresGridHelper ref="gridRef" :args="[40000, 100, 0xcccccc, 0xe5e5e5]" />
        </TresGroup>
        <TresAxesHelper :args="[5000]" />

        <!-- 原点标记 - 放大以适应大场景 -->
        <TresGroup :position="[0, 0, 0]">
          <TresMesh>
            <TresSphereGeometry :args="[200, 16, 16]" />
            <TresMeshBasicMaterial :color="0xef4444" />
          </TresMesh>
        </TresGroup>

        <!-- 选中物品的 Transform Gizmo -->
        <primitive v-if="shouldShowGizmo && gizmoPivot" :object="gizmoPivot" />
        <TransformControls
          v-if="shouldShowGizmo && gizmoPivot"
          :object="gizmoPivot"
          :camera="activeCameraRef"
          mode="translate"
          @dragging="handleGizmoDragging"
          @mouseDown="handleGizmoMouseDown"
          @mouseUp="handleGizmoMouseUp"
          @change="handleGizmoChange"
        />

        <!-- Instanced 渲染 -->
        <primitive v-if="instancedMesh" :object="instancedMesh" />
      </TresCanvas>

      <!-- 3D 框选矩形 -->
      <div
        v-if="selectionRect"
        class="pointer-events-none absolute border border-blue-400/80 bg-blue-500/10"
        :style="{
          left: selectionRect.x + 'px',
          top: selectionRect.y + 'px',
          width: selectionRect.width + 'px',
          height: selectionRect.height + 'px',
        }"
      ></div>

      <!-- 3D Tooltip -->
      <div
        v-if="tooltipVisible && tooltipData"
        class="pointer-events-none absolute z-50 rounded-md border border-gray-200 bg-white/80 p-1 shadow-xl backdrop-blur-sm"
        :style="{
          left: `${tooltipData.position.x + 12}px`,
          top: `${tooltipData.position.y - 10}px`,
          transform: 'translateY(-100%)',
        }"
      >
        <div class="flex items-center gap-2 text-sm">
          <img
            v-if="tooltipData.icon"
            :src="tooltipData.icon"
            class="h-12 w-12 rounded border border-gray-300"
            :alt="tooltipData.name"
            @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
          />
          <div class="px-1 text-gray-900">
            <div class="font-medium">{{ tooltipData.name }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 视图切换按钮 -->
    <div v-if="editorStore.items.length > 0" class="absolute top-4 right-4">
      <HoverCard :open-delay="200" :close-delay="100">
        <HoverCardTrigger as-child>
          <Button variant="outline" size="sm" class="shadow-md">
            <Camera class="mr-2 h-4 w-4" />
            <span v-if="currentViewPreset">
              {{
                currentViewPreset === 'perspective'
                  ? '透视'
                  : currentViewPreset === 'top'
                    ? '顶视图'
                    : currentViewPreset === 'bottom'
                      ? '底视图'
                      : currentViewPreset === 'front'
                        ? '前视图'
                        : currentViewPreset === 'back'
                          ? '后视图'
                          : currentViewPreset === 'right'
                            ? '右视图'
                            : '左视图'
              }}
            </span>
            <span v-else>自定义</span>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent align="end" class="w-48 p-1">
          <div class="space-y-1">
            <button
              class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              @click="commandStore.executeCommand('view.setViewPerspective')"
            >
              <Eye class="mr-2 h-4 w-4" />
              <span class="flex-1 text-left">透视视图</span>
              <span class="text-xs text-muted-foreground">0</span>
            </button>
            <div class="my-1 h-px bg-border" />
            <button
              class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              @click="commandStore.executeCommand('view.setViewTop')"
            >
              <ChevronsUp class="mr-2 h-4 w-4" />
              <span class="flex-1 text-left">顶视图</span>
              <span class="text-xs text-muted-foreground">7</span>
            </button>
            <button
              class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              @click="commandStore.executeCommand('view.setViewBottom')"
            >
              <ChevronsDown class="mr-2 h-4 w-4" />
              <span class="flex-1 text-left">底视图</span>
              <span class="text-xs text-muted-foreground">9</span>
            </button>
            <div class="my-1 h-px bg-border" />
            <button
              class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              @click="commandStore.executeCommand('view.setViewFront')"
            >
              <ChevronsRight class="mr-2 h-4 w-4" />
              <span class="flex-1 text-left">前视图</span>
              <span class="text-xs text-muted-foreground">1</span>
            </button>
            <button
              class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              @click="commandStore.executeCommand('view.setViewBack')"
            >
              <ChevronsLeft class="mr-2 h-4 w-4" />
              <span class="flex-1 text-left">后视图</span>
            </button>
            <div class="my-1 h-px bg-border" />
            <button
              class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              @click="commandStore.executeCommand('view.setViewRight')"
            >
              <ChevronRight class="mr-2 h-4 w-4" />
              <span class="flex-1 text-left">右侧视图</span>
              <span class="text-xs text-muted-foreground">3</span>
            </button>
            <button
              class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              @click="commandStore.executeCommand('view.setViewLeft')"
            >
              <ChevronLeft class="mr-2 h-4 w-4" />
              <span class="flex-1 text-left">左侧视图</span>
            </button>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>

    <!-- 视图信息 -->
    <div v-if="editorStore.items.length > 0" class="absolute right-4 bottom-4 space-y-2">
      <div class="rounded-md bg-white/90 px-3 py-2 text-xs text-gray-600 shadow-sm">
        <div>物品数量: {{ editorStore.visibleItems.length }} / {{ editorStore.items.length }}</div>
        <div v-if="editorStore.selectedItemIds.size > 0">
          已选中: {{ editorStore.selectedItemIds.size }}
        </div>
      </div>

      <div class="rounded-md bg-blue-500/90 px-3 py-2 text-xs text-white shadow-sm">
        <div class="font-medium">3D 预览模式</div>
        <div class="mt-1 text-[10px] opacity-80">
          <template v-if="isOrthographic"> 左键选择/框选 · 中键平移 · 滚轮缩放 </template>
          <template v-else>
            左键选择/框选 · 中键绕场景旋转 · 滚轮缩放 · WASD/Q/空格移动相机
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
