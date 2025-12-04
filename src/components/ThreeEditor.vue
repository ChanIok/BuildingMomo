<script setup lang="ts">
import { ref, computed, markRaw, watch, onActivated, onDeactivated, onMounted, toRef } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { OrbitControls, TransformControls, Grid } from '@tresjs/cientos'
import { Object3D, MOUSE, TextureLoader, SRGBColorSpace, Color } from 'three'
import backgroundUrl from '@/assets/home.webp'
import { useEditorStore } from '@/stores/editorStore'
import { useCommandStore } from '@/stores/commandStore'
import { useFurnitureStore } from '@/stores/furnitureStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useThreeSelection } from '@/composables/useThreeSelection'
import { useThreeTransformGizmo } from '@/composables/useThreeTransformGizmo'
import { useThreeInstancedRenderer } from '@/composables/useThreeInstancedRenderer'
import { useThreeTooltip } from '@/composables/useThreeTooltip'
import { useThreeCamera, type ViewPreset } from '@/composables/useThreeCamera'
import { useThreeGrid } from '@/composables/useThreeGrid'
import { useI18n } from '@/composables/useI18n'
import { useThrottleFn, useMagicKeys, useElementSize, useResizeObserver } from '@vueuse/core'
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

// 设置 Three.js 全局 Z 轴向上
Object3D.DEFAULT_UP.set(0, 0, 1)

const { t } = useI18n()

const editorStore = useEditorStore()
const commandStore = useCommandStore()
const furnitureStore = useFurnitureStore()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()

// 开发环境标志
const isDev = import.meta.env.DEV

// 3D 选择 & gizmo 相关引用
const threeContainerRef = ref<HTMLElement | null>(null)
// 监听容器尺寸变化，用于更新正交相机视锥体
const { width: containerWidth, height: containerHeight } = useElementSize(threeContainerRef)

// 监听容器 Rect 变化并同步到 UI Store，供其他 Composable 使用（性能优化）
useResizeObserver(threeContainerRef, (entries) => {
  const entry = entries[0]
  if (entry && entry.target) {
    const rect = entry.target.getBoundingClientRect()
    uiStore.updateEditorContainerRect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
  }
})

const cameraRef = ref<any | null>(null) // 透视相机
const orthoCameraRef = ref<any | null>(null) // 正交相机
const orbitControlsRef = ref<any | null>(null)
const transformRef = ref()
const axesRef = ref()
const gizmoPivot = ref<Object3D | null>(markRaw(new Object3D()))

// 监听按键状态
const { Ctrl, Space } = useMagicKeys()
const isCtrlPressed = computed(() => Ctrl?.value ?? false)
const isSpacePressed = computed(() => Space?.value ?? false)

// 调试面板状态
const showCameraDebug = ref(false)

// 背景图相关
const backgroundTexture = ref<any>(null)
const backgroundSize = ref<{ width: number; height: number }>({ width: 100, height: 100 })
const backgroundPosition = ref<[number, number, number]>([0, 0, -50]) // Z轴位置调整
const mapCenter = ref<[number, number, number]>([0, 0, 0]) // 地图中心(世界坐标)

// 加载背景图
onMounted(() => {
  const loader = new TextureLoader()
  loader.load(backgroundUrl, (texture) => {
    texture.colorSpace = SRGBColorSpace
    backgroundTexture.value = texture

    const img = texture.image
    const scale = 11.2
    const xOffset = -20000
    const yOffset = -28000 // Canvas Y -> Game Y

    const width = img.width * scale
    const height = img.height * scale

    backgroundSize.value = { width, height }

    // 计算地图中心的世界坐标
    mapCenter.value = [xOffset + width / 2, yOffset + height / 2, 0]

    // ThreeEditor: x,y 是左上角
    // Three Plane: position 是中心点
    backgroundPosition.value = [
      xOffset + width / 2,
      -(yOffset + height / 2), // 对应 Game Y (Y轴取反)
      -1, // 微下移避免与网格 Z-fighting (Z-up)
    ]
  })
})

// 创建共享的 isTransformDragging ref
const isTransformDragging = ref(false)

// 从 UI Store 获取当前视图预设
const currentViewPreset = computed(() => uiStore.currentViewPreset)

// Orbit 模式下的中心点：用于中键绕场景/选中物品旋转
const orbitTarget = ref<[number, number, number]>([0, 0, 0])

// 相机导航（WASD/Q/Space）
const {
  cameraPosition,
  cameraLookAt,
  cameraUp,
  cameraZoom,
  controlMode,
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
    defaultCenter: mapCenter,
  }
)

// 计算 OrbitControls 的鼠标按钮映射
const orbitMouseButtons = computed(() => {
  // 如果在正交视图下按住空格键，左键临时用于平移
  if (isOrthographic.value && isSpacePressed.value) {
    return {
      LEFT: MOUSE.PAN,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.ROTATE,
    }
  }

  // 如果是手形工具，左键用于平移（正交）或旋转（透视）
  if (editorStore.currentTool === 'hand') {
    if (isOrthographic.value) {
      return {
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.ROTATE, // 保持中键习惯
        RIGHT: MOUSE.ROTATE,
      }
    } else {
      return {
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.PAN,
        RIGHT: MOUSE.PAN,
      }
    }
  }

  // 默认模式（选择工具）：左键留给框选，中键操作相机
  return isOrthographic.value ? { MIDDLE: MOUSE.PAN } : { MIDDLE: MOUSE.ROTATE }
})

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

    // 如果是正交视图预设，使用固定朝向
    if (preset && preset !== 'perspective') {
      let up: [number, number, number] = [0, 0, 1]

      switch (preset) {
        case 'top':
          normal = [0, 0, 1] // 顶视图看 XY 平面
          up = [0, 1, 0] // Y轴朝上
          break
        case 'bottom':
          normal = [0, 0, -1]
          up = [0, -1, 0] // 翻转 180 度
          break
        case 'front':
          normal = [0, -1, 0]
          up = [0, 0, 1] // Z轴朝上
          break
        case 'back':
          normal = [0, 1, 0]
          up = [0, 0, 1] // Z轴朝上
          break
        case 'right':
          normal = [1, 0, 0]
          up = [0, 0, 1] // Z轴朝上
          break
        case 'left':
          normal = [-1, 0, 0]
          up = [0, 0, 1] // Z轴朝上
          break
      }
      // 正交视图：立即更新，无需节流（切换频率低）
      updateIconFacing(normal, up)
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
  transformSpace,
} = useThreeTransformGizmo(
  editorStore,
  gizmoPivot,
  updateSelectedInstancesMatrix,
  isTransformDragging,
  orbitControlsRef
)

// 现代配色方案
const axisColors = {
  x: 0xef4444, // red-500
  y: 0x84cc16, // lime-500
  z: 0x3b82f6, // blue-500
}

// 自定义 TransformControls (Gizmo) 颜色
watch(transformRef, (v) => {
  const controls = v?.instance || v?.value
  if (!controls) return

  const updateGizmo = () => {
    const gizmo = controls.gizmo || controls.children?.[0]
    gizmo?.traverse((obj: any) => {
      if (!obj.material || !obj.name) return

      let color
      if (/^(X|XYZX)$/.test(obj.name)) color = axisColors.x
      else if (/^(Y|XYZY)$/.test(obj.name)) color = axisColors.y
      else if (/^(Z|XYZZ)$/.test(obj.name)) color = axisColors.z

      if (color) {
        obj.material.color.set(color)
        // 关键：覆盖 tempColor 防止颜色被重置
        obj.material.tempColor = obj.material.tempColor || new Color()
        obj.material.tempColor.set(color)
      }
    })
  }

  updateGizmo()
})

// 自定义 AxesHelper (坐标轴) 颜色
watch(axesRef, (v) => {
  const axes = v?.instance || v?.value || v
  // AxesHelper.setColors available since r133
  if (axes && typeof axes.setColors === 'function') {
    axes.setColors(new Color(axisColors.x), new Color(axisColors.y), new Color(axisColors.z))
  }
})

const { selectionRect, lassoPoints, handlePointerDown, handlePointerMove, handlePointerUp } =
  useThreeSelection(
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
  // 如果是手形工具或正交视图按住空格，跳过选择逻辑
  if (editorStore.currentTool === 'hand' || (isOrthographic.value && isSpacePressed.value)) {
    hideTooltip()
    return
  }

  handlePointerMove(evt)
  // 3D 中没有拖动选框以外的拖拽逻辑，这里直接用 selectionRect 是否存在来判断是否在框选
  const isSelecting = !!selectionRect.value || lassoPoints.value.length > 0
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

  // 手形工具或正交视图按住空格下禁用框选/点击选择
  if (editorStore.currentTool !== 'hand' && !(isOrthographic.value && isSpacePressed.value)) {
    handlePointerDown(evt)
  }
}

function handleContainerPointerMove(evt: PointerEvent) {
  handleNavPointerMove(evt)
  handlePointerMoveWithTooltip(evt)
}

function handleContainerPointerUp(evt: PointerEvent) {
  ;(evt.target as HTMLElement).releasePointerCapture(evt.pointerId)
  handleNavPointerUp(evt)

  if (editorStore.currentTool !== 'hand' && !(isOrthographic.value && isSpacePressed.value)) {
    handlePointerUp(evt)
  }
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

// 网格控制逻辑
const { containerRotation, innerRotation, gridPosition } = useThreeGrid(uiStore, backgroundPosition)

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

// 判断是否需要禁用地图深度写入（实现透视效果）
// 当处于 图标/简易方块 模式 且 处于 顶视图/底视图 时，让地图不参与遮挡
const isMapDepthDisabled = computed(() => {
  const isTopOrBottom = currentViewPreset.value === 'top' || currentViewPreset.value === 'bottom'
  const isSimpleMode = shouldShowIconMesh.value || shouldShowSimpleBoxMesh.value
  return isTopOrBottom && isSimpleMode
})

// 视图切换函数（供命令系统调用）
function switchToView(preset: ViewPreset) {
  switchToViewPreset(preset)
}

// 当 3D 视图激活时，注册视图函数
onActivated(() => {
  commandStore.setZoomFunctions(null, null, fitCameraToScene, focusOnSelection)
  commandStore.setViewPresetFunction(switchToView)
})

// 当 3D 视图停用时，清除函数
onDeactivated(() => {
  commandStore.setZoomFunctions(null, null, null, null)
  commandStore.setViewPresetFunction(null)
})
</script>

<template>
  <div class="absolute inset-0 bg-gray-100">
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

    <!-- Three.js 场景 + 选择层 -->
    <div
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
          :mouseButtons="orbitMouseButtons"
          @change="handleOrbitChange"
        />

        <!-- 光照: 调整位置为 Z-up -->
        <TresAmbientLight :intensity="0.6" />
        <TresDirectionalLight :position="[1000, 1000, 2000]" :intensity="0.8" :cast-shadow="true" />

        <!-- 场景内容容器：Y轴翻转以实现左手坐标系视觉（Y轴朝南） -->
        <TresGroup :scale="[1, -1, 1]">
          <!-- 背景地图 -->
          <!-- 由于父级 Group 翻转了 Y 轴，这里再次翻转 Y 轴以保持地图图片方向正确（北朝上） -->
          <TresMesh
            v-if="backgroundTexture && shouldShowBackground"
            :position="backgroundPosition"
            :scale="[1, -1, 1]"
            :render-order="isMapDepthDisabled ? -1 : 0"
          >
            <TresPlaneGeometry :args="[backgroundSize.width, backgroundSize.height]" />
            <TresMeshBasicMaterial
              :map="backgroundTexture"
              :tone-mapped="false"
              :side="2"
              :depth-write="!isMapDepthDisabled"
            />
          </TresMesh>

          <TresAxesHelper ref="axesRef" :args="[5000]" />

          <!-- 原点标记 - 放大以适应大场景 -->
          <TresGroup :position="[0, 0, 0]">
            <TresMesh>
              <TresSphereGeometry :args="[200, 16, 16]" />
              <TresMeshBasicMaterial :color="0xef4444" />
            </TresMesh>
          </TresGroup>

          <!-- Instanced 渲染：按显示模式切换 -->
          <primitive v-if="shouldShowBoxMesh && instancedMesh" :object="instancedMesh" />
          <primitive v-if="shouldShowIconMesh && iconInstancedMesh" :object="iconInstancedMesh" />
          <primitive
            v-if="shouldShowSimpleBoxMesh && simpleBoxInstancedMesh"
            :object="simpleBoxInstancedMesh"
          />
        </TresGroup>

        <!-- 辅助元素 - 适配大场景 - 移至世界空间 -->
        <TresGroup v-if="backgroundTexture" :position="gridPosition" :rotation="containerRotation">
          <TresGroup :rotation="innerRotation">
            <!-- Grid 组件 -->
            <Grid
              :args="[backgroundSize.width, backgroundSize.height]"
              :cell-size="1000"
              :section-size="1000"
              :cell-color="'#cccccc'"
              :section-color="'#cccccc'"
              :fade-distance="50000"
              :fade-strength="0.5"
              :infinite-grid="false"
            />
          </TresGroup>
        </TresGroup>

        <!-- 选中物品的 Transform Gizmo 的锚点 - 移至世界空间 -->
        <primitive v-if="shouldShowGizmo && gizmoPivot" :object="gizmoPivot" />

        <!-- TransformControls 放在世界空间 -->
        <TransformControls
          v-if="shouldShowGizmo && gizmoPivot"
          ref="transformRef"
          :object="gizmoPivot"
          :camera="activeCameraRef"
          :mode="'translate'"
          :space="transformSpace"
          @dragging="handleGizmoDragging"
          @mouseDown="handleGizmoMouseDown"
          @mouseUp="handleGizmoMouseUp"
          @change="handleGizmoChange"
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

      <!-- 3D 套索路径 -->
      <svg
        v-if="lassoPoints && lassoPoints.length > 0"
        class="pointer-events-none absolute inset-0 z-10 overflow-visible"
        style="width: 100%; height: 100%"
      >
        <polygon
          :points="lassoPoints.map((p) => `${p.x},${p.y}`).join(' ')"
          fill="rgba(59, 130, 246, 0.1)"
          stroke="rgba(96, 165, 250, 0.8)"
          stroke-width="1"
          stroke-linejoin="round"
          fill-rule="evenodd"
        />
      </svg>

      <!-- 3D Tooltip -->
      <div
        v-if="tooltipVisible && tooltipData"
        class="pointer-events-none absolute z-50 rounded border bg-background/90 p-1 shadow-xl backdrop-blur-sm"
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
            class="h-12 w-12 rounded border"
            :alt="tooltipData.name"
            @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
          />
          <div class="flex-shrink-0 px-1">
            <div class="font-medium">{{ tooltipData.name }}</div>
          </div>
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
            {{
              isOrthographic
                ? t('editor.viewMode.orthographic')
                : controlMode === 'flight'
                  ? t('editor.viewMode.flight')
                  : t('editor.viewMode.perspective')
            }}
          </div>
          <div class="mt-1 text-[10px] text-gray-500">
            <template v-if="isOrthographic"> {{ t('editor.controls.ortho') }} </template>
            <template v-else-if="controlMode === 'orbit'">
              {{ t('editor.controls.orbit') }}
            </template>
            <template v-else> {{ t('editor.controls.flight') }} </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 图标/方块大小控制 (仅在图标或简化方块模式显示) -->
    <div v-if="shouldShowIconMesh || shouldShowSimpleBoxMesh" class="absolute bottom-4 left-4">
      <Item
        variant="muted"
        size="sm"
        class="h-14 rounded-md bg-background/90 px-3 py-2 shadow-md backdrop-blur-sm"
      >
        <ItemContent>
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-baseline gap-2 pr-4">
              <ItemTitle class="text-xs font-medium">
                {{
                  shouldShowSimpleBoxMesh
                    ? t('editor.sizeControl.box')
                    : t('editor.sizeControl.icon')
                }}
              </ItemTitle>
              <span class="text-[10px] text-gray-500">{{ t('editor.sizeControl.shortcut') }}</span>
            </div>
            <span class="w-8 text-right text-xs text-gray-500"
              >{{ Math.round(settingsStore.settings.threeSymbolScale * 100) }}%</span
            >
          </div>
          <Slider v-model="symbolScaleProxy" :max="3" :min="0.1" :step="0.1" variant="thin" />
        </ItemContent>
      </Item>
    </div>

    <!-- 相机状态调试面板 (开发模式) -->
    <div v-if="isDev" class="absolute bottom-32 left-4">
      <button
        @click="showCameraDebug = !showCameraDebug"
        class="rounded bg-gray-800/80 px-2 py-1 text-xs text-white hover:bg-gray-700/80"
      >
        {{ showCameraDebug ? t('editor.debug.hide') : t('editor.debug.show') }}
      </button>
      <div
        v-if="showCameraDebug"
        class="mt-2 max-h-96 overflow-y-auto rounded bg-gray-900/90 px-3 py-2 font-mono text-xs text-green-400 shadow-lg"
        style="max-width: 350px"
      >
        <div class="mb-1 font-bold text-green-300">{{ t('editor.debug.title') }}</div>
        <div class="space-y-0.5">
          <div>
            <span class="text-gray-400">{{ t('editor.debug.mode') }}:</span> {{ controlMode }}
          </div>
          <div>
            <span class="text-gray-400">{{ t('editor.debug.view') }}:</span>
            {{
              !isOrthographic
                ? t('editor.viewMode.perspective')
                : currentViewPreset || t('editor.viewMode.orthographic')
            }}
          </div>
          <div>
            <span class="text-gray-400">{{ t('editor.debug.projection') }}:</span>
            {{
              isOrthographic ? t('editor.viewMode.orthographic') : t('editor.viewMode.perspective')
            }}
          </div>
          <div class="mt-1 text-gray-400">{{ t('editor.debug.position') }}:</div>
          <div class="pl-2">
            X: {{ cameraPosition[0].toFixed(1) }}<br />
            Y: {{ cameraPosition[1].toFixed(1) }}<br />
            Z: {{ cameraPosition[2].toFixed(1) }}
          </div>
          <div class="mt-1 text-gray-400">{{ t('editor.debug.target') }}:</div>
          <div class="pl-2">
            X: {{ cameraLookAt[0].toFixed(1) }}<br />
            Y: {{ cameraLookAt[1].toFixed(1) }}<br />
            Z: {{ cameraLookAt[2].toFixed(1) }}
          </div>
          <div class="mt-1 text-gray-400">{{ t('editor.debug.orbitCenter') }}:</div>
          <div class="pl-2">
            X: {{ orbitTarget[0].toFixed(1) }}<br />
            Y: {{ orbitTarget[1].toFixed(1) }}<br />
            Z: {{ orbitTarget[2].toFixed(1) }}
          </div>
          <div class="mt-1">
            <span class="text-gray-400">{{ t('editor.debug.viewFocused') }}:</span>
            {{ isViewFocused ? t('editor.debug.yes') : t('editor.debug.no') }}
          </div>
          <div>
            <span class="text-gray-400">{{ t('editor.debug.navKey') }}:</span>
            {{ isNavKeyPressed ? t('editor.debug.active') : t('editor.debug.inactive') }}
          </div>
          <div>
            <span class="text-gray-400">{{ t('editor.debug.zoom') }}:</span>
            {{ cameraZoom.toFixed(2) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
