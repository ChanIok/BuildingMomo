<script setup lang="ts">
import { ref, computed, markRaw, watch, onActivated, onDeactivated, toRef } from 'vue'
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
import { useThreeNavigation } from '@/composables/useThreeNavigation'

const editorStore = useEditorStore()
const commandStore = useCommandStore()
const furnitureStore = useFurnitureStore()
const settingsStore = useSettingsStore()

// 3D 选择 & gizmo 相关引用
const threeContainerRef = ref<HTMLElement | null>(null)
const cameraRef = ref<any | null>(null)
const orbitControlsRef = ref<any | null>(null)
const gizmoPivot = ref<Object3D | null>(markRaw(new Object3D()))

// 创建共享的 isTransformDragging ref
const isTransformDragging = ref(false)

// Orbit 模式下的中心点：用于中键绕场景/选中物品旋转
const orbitTarget = ref<[number, number, number]>([0, 0, 0])

// 相机导航（WASD/Q/Space）
const {
  cameraPosition,
  cameraLookAt,
  isNavKeyPressed,
  handleNavPointerDown,
  setPoseFromLookAt,
  lookAtTarget,
} = useThreeNavigation(
  {
    baseSpeed: 2000,
    mouseSensitivity: 0.002,
    pitchLimits: { min: -90, max: 90 },
    minHeight: -10000,
  },
  {
    isTransformDragging,
    // 导航时同步更新 OrbitControls 的 target，使其跟随相机
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
  cameraRef,
  {
    instancedMesh,
    indexToIdMap,
  },
  threeContainerRef,
  isTransformDragging
)

// 导航键按下时，临时禁用 OrbitControls，避免其阻尼效果干扰自由飞行
// 由于导航时会持续更新 orbitTarget，重新启用时不会产生瞬移
watch(
  () => isNavKeyPressed.value,
  (pressed) => {
    const wrapper = orbitControlsRef.value as any
    const controls = wrapper?.instance
    if (!controls || typeof controls.enabled !== 'boolean') return

    if (pressed) {
      // 导航键按下时，禁用 OrbitControls 以完全接管相机控制
      controls.enabled = false
    } else if (!isTransformDragging.value) {
      // 导航键抬起且未拖动 Gizmo 时，恢复 OrbitControls
      // 此时 orbitTarget 已经被导航系统更新到相机前方，不会瞬移
      controls.enabled = true
    }
  }
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
  cameraRef,
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
  handlePointerMoveWithTooltip(evt)
}

function handleContainerPointerUp(evt: PointerEvent) {
  handlePointerUp(evt)
}

function handleContainerPointerLeave(evt: PointerEvent) {
  handleContainerPointerUp(evt)
  hideTooltip()
}

// OrbitControls 变更时，同步导航相机姿态，避免两种视角模式之间跳变
function handleOrbitChange() {
  const cam = cameraRef.value as any
  if (!cam) return

  // 如果当前处于导航模式（按键按下），不要反向同步，避免循环更新
  if (isNavKeyPressed.value) return

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
  const center = editorStore.getSelectedItemsCenter?.()
  if (center) {
    const target: [number, number, number] = [center.x, center.z, center.y]
    orbitTarget.value = target
    lookAtTarget(target)
  }
}

// 聚焦到整个场景
function focusOnScene() {
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

// 当3D视图激活时，注册视图函数
onActivated(() => {
  // 3D视图不需要缩放功能，但需要重置视图和聚焦选中功能
  commandStore.setZoomFunctions(null, null, resetView3D, focusOnSelection)
})

// 当3D视图停用时，清除函数
onDeactivated(() => {
  commandStore.setZoomFunctions(null, null, null, null)
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
        <!-- 相机 - 适配大坐标场景 -->
        <TresPerspectiveCamera
          ref="cameraRef"
          :position="cameraPosition"
          :look-at="cameraLookAt"
          :fov="50"
          :near="100"
          :far="150000"
        />

        <!-- 轨道控制器：使用中键进行卫星式绕 orbitTarget 旋转，由导航系统接管右键飞行与 WASD 位移 -->
        <OrbitControls
          ref="orbitControlsRef"
          :target="orbitTarget"
          :enableDamping="false"
          :enableRotate="true"
          :enablePan="false"
          :mouseButtons="{ MIDDLE: MOUSE.ROTATE }"
          @change="handleOrbitChange"
        />

        <!-- 光照 -->
        <TresAmbientLight :intensity="0.6" />
        <TresDirectionalLight :position="[1000, 2000, 1000]" :intensity="0.8" :cast-shadow="true" />

        <!-- 辅助元素 - 适配大场景 -->
        <TresGridHelper :args="[40000, 100, 0xcccccc, 0xe5e5e5]" />
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
          :camera="cameraRef"
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
          左键选择/框选 · 中键绕场景旋转 · 滚轮缩放 · WASD/Q/空格移动相机
        </div>
      </div>
    </div>
  </div>
</template>
