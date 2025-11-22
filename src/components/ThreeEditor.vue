<script setup lang="ts">
import {
  ref,
  computed,
  markRaw,
  watch,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  toRef,
} from 'vue'
import { TresCanvas } from '@tresjs/core'
import { OrbitControls, TransformControls, Grid } from '@tresjs/cientos'
import { Object3D, MOUSE, TextureLoader, SRGBColorSpace } from 'three'
import backgroundUrl from '@/assets/home.webp'
import { useEditorStore } from '@/stores/editorStore'
import { useCommandStore } from '@/stores/commandStore'
import { useFurnitureStore } from '@/stores/furnitureStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThreeSelection } from '@/composables/useThreeSelection'
import { useThreeTransformGizmo } from '@/composables/useThreeTransformGizmo'
import { useThreeInstancedRenderer } from '@/composables/useThreeInstancedRenderer'
import { useThreeTooltip } from '@/composables/useThreeTooltip'
import { useThreeCamera, type ViewPreset } from '@/composables/useThreeCamera'
import { releaseThreeIconManager } from '@/composables/useThreeIconManager'
import { useThrottleFn, useMagicKeys, useElementSize } from '@vueuse/core'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

// 开发环境标志
const isDev = import.meta.env.DEV

// 3D 选择 & gizmo 相关引用
const threeContainerRef = ref<HTMLElement | null>(null)
// 监听容器尺寸变化，用于更新正交相机视锥体
const { width: containerWidth, height: containerHeight } = useElementSize(threeContainerRef)

const cameraRef = ref<any | null>(null) // 透视相机
const orthoCameraRef = ref<any | null>(null) // 正交相机
const orbitControlsRef = ref<any | null>(null)
const gizmoPivot = ref<Object3D | null>(markRaw(new Object3D()))

// 监听按键状态
const { Ctrl } = useMagicKeys()
const isCtrlPressed = computed(() => Ctrl?.value ?? false)

// 调试面板状态
const showCameraDebug = ref(false)

// 背景图相关
const backgroundTexture = ref<any>(null)
const backgroundSize = ref<{ width: number; height: number }>({ width: 100, height: 100 })
const backgroundPosition = ref<[number, number, number]>([0, -50, 0])

// 加载背景图
onMounted(() => {
  const loader = new TextureLoader()
  loader.load(backgroundUrl, (texture) => {
    texture.colorSpace = SRGBColorSpace
    backgroundTexture.value = texture

    const img = texture.image
    const scale = 11.2
    const xOffset = -20000
    const yOffset = -18000 // Canvas Y -> Three Z

    const width = img.width * scale
    const height = img.height * scale

    backgroundSize.value = { width, height }

    // ThreeEditor: x,y 是左上角
    // Three Plane: position 是中心点
    backgroundPosition.value = [
      xOffset + width / 2,
      -1, // 微下移避免与网格 Z-fighting
      yOffset + height / 2,
    ]
  })
})

// 创建共享的 isTransformDragging ref
const isTransformDragging = ref(false)

// Orbit 模式下的中心点：用于中键绕场景/选中物品旋转
const orbitTarget = ref<[number, number, number]>([0, 0, 0])

// 响应式绑定当前方案的视图状态
// 已移至 useThreeCamera 内部处理

// 相机导航（WASD/Q/Space）
const {
  cameraPosition,
  cameraLookAt,
  cameraUp,
  cameraZoom,
  controlMode,
  currentViewPreset,
  isOrthographic,
  isViewFocused,
  isNavKeyPressed,
  cameraDistance,
  handleNavPointerDown,
  handleNavPointerMove,
  handleNavPointerUp,
  setPoseFromLookAt,
  setZoom,
  switchToViewPreset,
  fitCameraToScene,
  focusOnSelection,
} = useThreeCamera(
  {
    baseSpeed: 1500,
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

// 当前活动的相机（根据视图类型动态切换）
const activeCameraRef = computed(() => {
  return isOrthographic.value ? orthoCameraRef.value : cameraRef.value
})

// 先初始化 renderer 获取 updateSelectedInstancesMatrix 函数
const {
  instancedMesh,
  iconInstancedMesh,
  simpleBoxInstancedMesh,
  indexToIdMap,
  updateSelectedInstancesMatrix,
  setHoveredItemId,
  updateIconFacing,
} = useThreeInstancedRenderer(editorStore, furnitureStore, isTransformDragging)

// 当前 3D 显示模式（根据设置和视图类型动态决定）
// 当前 3D 显示模式（完全由用户设置决定）
const currentDisplayMode = computed(() => {
  return settingsStore.settings.threeDisplayMode
})

// 是否显示 Box mesh
const shouldShowBoxMesh = computed(() => currentDisplayMode.value === 'box')

// 是否显示 Icon mesh
const shouldShowIconMesh = computed(() => currentDisplayMode.value === 'icon')

// 是否显示 Simple Box mesh
const shouldShowSimpleBoxMesh = computed(() => currentDisplayMode.value === 'simple-box')

// 当前用于拾取/选择的 InstancedMesh（根据显示模式切换）
// 当前用于拾取/选择的 InstancedMesh（根据显示模式切换）
const pickInstancedMesh = computed(() => {
  if (shouldShowIconMesh.value) return iconInstancedMesh.value
  if (shouldShowSimpleBoxMesh.value) return simpleBoxInstancedMesh.value
  return instancedMesh.value
})

// 创建节流函数，用于透视视图下的图标朝向更新（避免过于频繁的更新）
const updateIconFacingThrottled = useThrottleFn(
  (normal: [number, number, number], up?: [number, number, number]) => {
    updateIconFacing(normal, up)
  },
  150
) // 每150ms最多更新一次

// 在视图或模式变化时，更新 Icon 面朝方向（仅图标模式）
watch(
  [
    () => currentDisplayMode.value,
    () => currentViewPreset.value,
    () => cameraPosition.value, // 监听相机位置，用于透视视图下的实时跟随
    () => cameraLookAt.value, // 监听相机目标，用于计算朝向
  ],
  ([mode, preset, camPos, camTarget]) => {
    if (mode !== 'icon') {
      return
    }

    let normal: [number, number, number] = [0, 0, 1]

    // 如果是正交视图预设，使用固定朝向（保持现有逻辑）
    if (preset && preset !== 'perspective') {
      switch (preset) {
        case 'top':
          normal = [0, 1, 0]
          break
        case 'bottom':
          normal = [0, -1, 0]
          break
        case 'front':
          normal = [0, 0, 1]
          break
        case 'back':
          normal = [0, 0, -1]
          break
        case 'right':
          normal = [1, 0, 0]
          break
        case 'left':
          normal = [-1, 0, 0]
          break
      }
      // 正交视图：立即更新，无需节流（切换频率低）
      updateIconFacing(normal)
    } else {
      // 透视视图：计算从目标点指向相机的方向，使图标法线朝向相机（图标面向相机）
      const dirX = camPos[0] - camTarget[0]
      const dirY = camPos[1] - camTarget[1]
      const dirZ = camPos[2] - camTarget[2]

      // 归一化向量
      const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ)
      if (len > 0.0001) {
        normal = [dirX / len, dirY / len, dirZ / len]
      }

      // 透视视图：使用节流更新，并传入 cameraUp 向量防止图标绕法线旋转
      updateIconFacingThrottled(normal, cameraUp.value)
    }
  },
  { immediate: true }
)

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
    instancedMesh: pickInstancedMesh,
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
    instancedMesh: pickInstancedMesh,
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

// 滑块绑定的代理（Slider 组件通常使用数组）
const symbolScaleProxy = computed({
  get: () => [settingsStore.settings.threeSymbolScale],
  set: (val) => {
    if (val && val.length > 0 && typeof val[0] === 'number') {
      settingsStore.settings.threeSymbolScale = val[0]
    }
  },
})

// 处理容器滚轮事件（用于 Ctrl+滚轮 缩放图标/方块）
function handleContainerWheel(evt: WheelEvent) {
  // 仅在图标或简化方块模式下且按下 Ctrl 键时生效
  if ((shouldShowIconMesh.value || shouldShowSimpleBoxMesh.value) && evt.ctrlKey) {
    evt.preventDefault()
    evt.stopPropagation()

    // 计算新的缩放值
    const delta = evt.deltaY > 0 ? -0.1 : 0.1
    const current = settingsStore.settings.threeSymbolScale
    const next = Math.min(Math.max(current + delta, 0.1), 3.0)

    // 保留一位小数
    settingsStore.settings.threeSymbolScale = Number(next.toFixed(1))
  }
}

// 容器级指针事件：先交给导航，再交给选择/tooltip
function handleContainerPointerDown(evt: PointerEvent) {
  // 捕获指针，确保移出画布后仍能响应事件
  ;(evt.target as HTMLElement).setPointerCapture(evt.pointerId)

  // 如果右键菜单已打开，点击画布任意位置先关闭菜单
  if (contextMenuOpen.value) {
    contextMenuOpen.value = false
  }

  handleNavPointerDown(evt)
  handlePointerDown(evt)
}

function handleContainerPointerMove(evt: PointerEvent) {
  handleNavPointerMove(evt)
  handlePointerMoveWithTooltip(evt)
}

function handleContainerPointerUp(evt: PointerEvent) {
  ;(evt.target as HTMLElement).releasePointerCapture(evt.pointerId)
  handleNavPointerUp(evt)
  handlePointerUp(evt)
}

function handleContainerPointerLeave() {
  hideTooltip()
}

// 右键菜单状态
const contextMenuOpen = ref(false)
const menuPosition = ref({ x: 0, y: 0 })

// 处理右键菜单（参考 Blender：右键不改变选中状态）
function handleContextMenu(evt: PointerEvent) {
  evt.preventDefault()
  evt.stopPropagation()

  // 更新菜单位置
  menuPosition.value = {
    x: evt.clientX,
    y: evt.clientY,
  }

  // 直接打开菜单，不改变任何选中状态
  contextMenuOpen.value = true
}

// OrbitControls 变更时，同步内部状态（仅在 orbit 模式下）
function handleOrbitChange() {
  if (controlMode.value !== 'orbit') return
  if (!activeCameraRef.value) return

  // 尝试获取 OrbitControls 的内部实例
  // Cientos v4+ 通过 .instance 暴露底层 Three.js 实例
  const controls = orbitControlsRef.value?.instance || orbitControlsRef.value?.value
  if (!controls) return

  const cam = activeCameraRef.value as any
  const pos = cam.position

  // 从控制器实例直接获取最新的 target
  const currentTarget = controls.target
  if (!currentTarget) return

  const targetArray: [number, number, number] = [currentTarget.x, currentTarget.y, currentTarget.z]

  // 同步更新本地的 orbitTarget，确保下次切换视图时读取到的是正确位置
  // 注意：这里更新 ref 会触发 OrbitControls 的 props 更新，但因为值相同，通常不会造成问题
  orbitTarget.value = targetArray

  // 记录当前的 Zoom
  if (cam.zoom !== undefined) {
    setZoom(cam.zoom)
  }

  // 同步相机姿态（位置和目标点）
  setPoseFromLookAt([pos.x, pos.y, pos.z], targetArray)
}

// 计算正交相机的视锥体参数
const orthoFrustum = computed(() => {
  const distance = cameraDistance.value
  // 使用距离作为视锥体大小的基准，留一些余量
  const size = distance * 0.93

  // 获取容器宽高比（默认 16:9，实际会由 TresCanvas 自动适配）
  const w = containerWidth.value
  const h = containerHeight.value
  const aspect = h > 0 ? w / h : 16 / 9

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
      // 前视图: XY 平面，法线朝 +Z
      return [Math.PI / 2, 0, 0]
    case 'back':
      // 后视图: XY 平面，法线朝 -Z
      return [-Math.PI / 2, 0, 0]

    case 'left':
      // 左视图: YZ 平面，法线朝 -X
      return [0, 0, Math.PI / 2]
    case 'right':
      // 右视图: YZ 平面，法线朝 +X
      return [0, 0, -Math.PI / 2]

    case 'bottom':
      // 底视图: XZ 平面，法线朝 -Y
      return [Math.PI, 0, 0]

    case 'top':
    case 'perspective':
    default:
      // 顶/透视视图: XZ 平面，法线朝 +Y
      return [0, 0, 0]
  }
})

// 聚焦到整个场景 (别名，兼容 CommandStore 命名)

// 背景显示条件
const shouldShowBackground = computed(() => {
  if (!settingsStore.settings.showBackground) return false
  // 仅在 顶/底/透视 视图显示，侧视图隐藏
  const hiddenPresets = ['front', 'back', 'left', 'right']
  if (currentViewPreset.value && hiddenPresets.includes(currentViewPreset.value)) {
    return false
  }
  return true
})

// 智能更新视图：方案切换或首次加载时重置视角
// 已移至 useThreeCamera 内部处理，通过监听 activeSchemeId 自动恢复快照或设置默认视图

// 视图切换函数（供命令系统调用）
function switchToView(preset: ViewPreset) {
  switchToViewPreset(preset)
}

// 当 3D 视图激活时，注册视图函数
onActivated(() => {
  // 3D视图不需要缩放功能，但需要重置视图和聚焦选中功能
  commandStore.setZoomFunctions(null, null, fitCameraToScene, focusOnSelection)
  // 注册视图切换函数
  commandStore.setViewPresetFunction(switchToView)
})

// 当 3D 视图停用时，清除函数
onDeactivated(() => {
  commandStore.setZoomFunctions(null, null, null, null)
  commandStore.setViewPresetFunction(null)
})

// 组件卸载时释放纹理数组引用
onUnmounted(() => {
  // 释放纹理数组的引用计数
  // 当所有 ThreeEditor 组件都卸载后，纹理数组会自动清理 GPU 内存
  releaseThreeIconManager()
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

    <!-- 右键菜单 -->
    <DropdownMenu v-model:open="contextMenuOpen" :modal="false">
      <!-- 虚拟触发器：不可见但存在于 DOM 中，动态定位到鼠标位置 -->
      <DropdownMenuTrigger as-child>
        <div
          :style="{
            position: 'fixed',
            left: `${menuPosition.x}px`,
            top: `${menuPosition.y}px`,
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
          <span>剪切</span>
          <DropdownMenuShortcut>Ctrl+X</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!commandStore.isCommandEnabled('edit.copy')"
          @select="commandStore.executeCommand('edit.copy')"
        >
          <span>复制</span>
          <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!commandStore.isCommandEnabled('edit.paste')"
          @select="commandStore.executeCommand('edit.paste')"
        >
          <span>粘贴</span>
          <DropdownMenuShortcut>Ctrl+V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          :disabled="!commandStore.isCommandEnabled('edit.move')"
          @select="commandStore.executeCommand('edit.move')"
        >
          <span>移动和旋转</span>
          <DropdownMenuShortcut>Ctrl+M</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="!commandStore.isCommandEnabled('view.focusSelection')"
          @select="commandStore.executeCommand('view.focusSelection')"
        >
          <span>聚焦选中</span>
          <DropdownMenuShortcut>F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          :disabled="!commandStore.isCommandEnabled('edit.delete')"
          @select="commandStore.executeCommand('edit.delete')"
          variant="destructive"
        >
          <span>删除</span>
          <DropdownMenuShortcut>Delete</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- Three.js 场景 + 选择层 -->
    <div
      v-if="editorStore.items.length > 0"
      ref="threeContainerRef"
      class="absolute inset-0 overflow-hidden"
      @pointerdown="handleContainerPointerDown"
      @pointermove="handleContainerPointerMove"
      @pointerup="handleContainerPointerUp"
      @pointerleave="handleContainerPointerLeave"
      @contextmenu="handleContextMenu"
      @wheel="handleContainerWheel"
    >
      <TresCanvas clear-color="#f3f4f6">
        <!-- 透视相机 - perspective 视图 -->
        <TresPerspectiveCamera
          v-if="!isOrthographic"
          ref="cameraRef"
          :position="cameraPosition"
          :look-at="cameraLookAt"
          :up="cameraUp"
          :zoom="cameraZoom"
          :fov="50"
          :near="100"
          :far="100000"
        />

        <!-- 正交相机 - 六个方向视图 -->
        <TresOrthographicCamera
          v-if="isOrthographic"
          ref="orthoCameraRef"
          :position="cameraPosition"
          :look-at="cameraLookAt"
          :up="cameraUp"
          :zoom="cameraZoom"
          :left="orthoFrustum.left"
          :right="orthoFrustum.right"
          :top="orthoFrustum.top"
          :bottom="orthoFrustum.bottom"
          :near="100"
          :far="100000"
        />

        <!-- 轨道控制器：透视视图下使用中键旋转，正交视图下使用中键平移 -->
        <OrbitControls
          ref="orbitControlsRef"
          :target="orbitTarget"
          :enableDamping="controlMode === 'orbit'"
          :dampingFactor="0.3"
          :enabled="controlMode === 'orbit'"
          :enableRotate="!isOrthographic"
          :enablePan="isOrthographic"
          :enable-zoom="!isCtrlPressed"
          :zoomSpeed="2.5"
          :mouseButtons="isOrthographic ? { MIDDLE: MOUSE.PAN } : { MIDDLE: MOUSE.ROTATE }"
          @change="handleOrbitChange"
        />

        <!-- 光照 -->
        <TresAmbientLight :intensity="0.6" />
        <TresDirectionalLight :position="[1000, 2000, 1000]" :intensity="0.8" :cast-shadow="true" />

        <!-- 背景地图 -->
        <TresMesh
          v-if="backgroundTexture && shouldShowBackground"
          :position="backgroundPosition"
          :rotation="[-Math.PI / 2, 0, 0]"
        >
          <TresPlaneGeometry :args="[backgroundSize.width, backgroundSize.height]" />
          <TresMeshBasicMaterial :map="backgroundTexture" :tone-mapped="false" />
        </TresMesh>

        <!-- 辅助元素 - 适配大场景 -->
        <TresGroup :rotation="gridRotation">
          <!-- 使用 Grid 组件替换 TresGridHelper -->
          <Grid
            v-if="backgroundTexture"
            :args="[backgroundSize.width, backgroundSize.height]"
            :position="[backgroundPosition[0], 0, backgroundPosition[2]]"
            :cell-size="1000"
            :section-size="1000"
            :cell-color="'#cccccc'"
            :section-color="'#cccccc'"
            :fade-distance="50000"
            :fade-strength="0.5"
            :infinite-grid="false"
          />
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

        <!-- Instanced 渲染：按显示模式切换 -->
        <primitive v-if="shouldShowBoxMesh && instancedMesh" :object="instancedMesh" />
        <primitive v-if="shouldShowIconMesh && iconInstancedMesh" :object="iconInstancedMesh" />
        <primitive
          v-if="shouldShowSimpleBoxMesh && simpleBoxInstancedMesh"
          :object="simpleBoxInstancedMesh"
        />
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
            <span>
              {{
                !isOrthographic
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
                            : currentViewPreset === 'left'
                              ? '左视图'
                              : '正交视图'
              }}
            </span>
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
        <div>物品数量: {{ editorStore.items.length }}</div>
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

    <!-- 图标/方块大小控制 (仅在图标或简化方块模式显示) -->
    <div v-if="shouldShowIconMesh || shouldShowSimpleBoxMesh" class="absolute bottom-4 left-4 w-64">
      <Item
        variant="muted"
        size="sm"
        class="border-gray-200 bg-white/90 shadow-md backdrop-blur-sm"
      >
        <ItemContent>
          <div class="mb-2 flex items-center justify-between">
            <ItemTitle class="text-xs font-medium">图标/方块大小</ItemTitle>
            <span class="text-xs text-gray-500"
              >{{ Math.round(settingsStore.settings.threeSymbolScale * 100) }}%</span
            >
          </div>
          <Slider v-model="symbolScaleProxy" :max="3" :min="0.1" :step="0.1" />
          <ItemDescription class="mt-2 text-[10px] text-gray-400">
            Ctrl + 滚轮快速调整
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>

    <!-- 相机状态调试面板 (开发模式) -->
    <div v-if="isDev" class="absolute bottom-32 left-4">
      <button
        @click="showCameraDebug = !showCameraDebug"
        class="rounded-md bg-gray-800/80 px-2 py-1 text-xs text-white hover:bg-gray-700/80"
      >
        {{ showCameraDebug ? '隐藏' : '显示' }}相机调试
      </button>
      <div
        v-if="showCameraDebug"
        class="mt-2 max-h-96 overflow-y-auto rounded-md bg-gray-900/90 px-3 py-2 font-mono text-xs text-green-400 shadow-lg"
        style="max-width: 350px"
      >
        <div class="mb-1 font-bold text-green-300">📷 相机状态</div>
        <div class="space-y-0.5">
          <div><span class="text-gray-400">模式:</span> {{ controlMode }}</div>
          <div>
            <span class="text-gray-400">视图:</span>
            {{ !isOrthographic ? '透视' : currentViewPreset || '正交' }}
          </div>
          <div><span class="text-gray-400">投影:</span> {{ isOrthographic ? '正交' : '透视' }}</div>
          <div class="mt-1 text-gray-400">位置:</div>
          <div class="pl-2">
            X: {{ cameraPosition[0].toFixed(1) }}<br />
            Y: {{ cameraPosition[1].toFixed(1) }}<br />
            Z: {{ cameraPosition[2].toFixed(1) }}
          </div>
          <div class="mt-1 text-gray-400">目标:</div>
          <div class="pl-2">
            X: {{ cameraLookAt[0].toFixed(1) }}<br />
            Y: {{ cameraLookAt[1].toFixed(1) }}<br />
            Z: {{ cameraLookAt[2].toFixed(1) }}
          </div>
          <div class="mt-1 text-gray-400">轨道中心:</div>
          <div class="pl-2">
            X: {{ orbitTarget[0].toFixed(1) }}<br />
            Y: {{ orbitTarget[1].toFixed(1) }}<br />
            Z: {{ orbitTarget[2].toFixed(1) }}
          </div>
          <div class="mt-1">
            <span class="text-gray-400">视图聚焦:</span> {{ isViewFocused ? '是' : '否' }}
          </div>
          <div>
            <span class="text-gray-400">导航键:</span> {{ isNavKeyPressed ? '激活' : '未激活' }}
          </div>
          <div><span class="text-gray-400">缩放:</span> {{ cameraZoom.toFixed(2) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
