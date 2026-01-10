import { computed, ref, watchEffect, markRaw, watch, type Ref } from 'vue'
import { useMagicKeys } from '@vueuse/core'
import {
  Object3D,
  Vector3,
  Euler,
  Matrix4,
  Color,
  Plane,
  Raycaster,
  Vector2,
  Box3Helper,
  type Camera,
} from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useClipboard } from '@/composables/useClipboard'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { matrixTransform } from '@/lib/matrixTransform'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import type { AppItem } from '@/types/editor'
import {
  OBB,
  OBBHelper,
  getOBBFromMatrix,
  getOBBFromMatrixAndModelBox,
  mergeOBBs,
  calculateOBBSnapVector,
  transformOBBByMatrix,
} from '@/lib/collision'
import { getThreeModelManager } from '@/composables/useThreeModelManager'

// 现代配色方案
const AXIS_COLORS = {
  x: 0xef4444, // red-500
  y: 0x84cc16, // lime-500
  z: 0x3b82f6, // blue-500
}

export function useThreeTransformGizmo(
  pivotRef: Ref<Object3D | null>,
  updateSelectedInstancesMatrix: (
    idToWorldMatrixMap: Map<string, Matrix4>,
    skipBVHRefit?: boolean
  ) => void,
  isTransformDragging: Ref<boolean>, // 必需：用于多个 composable 之间的状态共享
  orbitControlsRef?: Ref<any | null>,
  activeCameraRef?: Ref<any | null>,
  transformRef?: Ref<any | null>
) {
  // 直接使用传入的 ref（多个 composable 之间共享状态）

  // 矩阵变换状态
  const gizmoStartMatrix = markRaw(new Matrix4())
  // 记录拖拽开始时每个选中物品的世界矩阵
  const itemStartWorldMatrices = ref(new Map<string, Matrix4>())
  // 记录拖拽开始时所有静止物品的预计算碰撞数据
  interface StaticCollisionData {
    matrix: Matrix4
    obb: OBB
    // 🚀 性能优化：预计算的角点（避免在拖拽循环中重复调用 getCorners）
    corners: Vector3[]
    // 用于快速距离剔除的包围球数据
    center: Vector3
    radius: number
  }
  const staticWorldMatrices = ref(new Map<string, StaticCollisionData>())
  // 🚀 记录选中物品的局部 OBB 信息（形状数据，不含位置/旋转）
  // 这些信息在拖拽过程中不变，只需计算一次，然后用增量矩阵更新
  interface SelectedItemOBBInfo {
    id: string
    localSize: Vector3 // 局部尺寸（不含缩放）
    localCenter: Vector3 // 局部中心偏移
  }
  const selectedItemsOBBInfo = ref<SelectedItemOBBInfo[]>([])
  const hasStartedTransform = ref(false)

  // Alt+拖拽复制状态
  const altDragCopyPending = ref(false)
  const altDragCopyExecuted = ref(false)
  const gizmoStartScreenPosition = ref({ x: 0, y: 0 })

  // 旋转模式状态：基于角度的旋转计算
  const isRotateMode = ref(false)
  const rotateAxis = ref<'X' | 'Y' | 'Z' | null>(null)
  const startMouseAngle = ref(0)
  const startGizmoRotation = markRaw(new Euler())
  const lastAppliedAngle = ref(0) // 已应用到 gizmoPivot 的累积角度
  const hasInitializedRotation = ref(false) // 是否已初始化旋转起始角度

  // 碰撞吸附状态：记录起始位置用于计算移动方向
  const gizmoStartPosition = markRaw(new Vector3())

  // 🔧 调试：包围盒可视化（设为 true 启用调试）
  const DEBUG_SHOW_BOUNDING_BOXES = false
  const debugHelpers: (Box3Helper | OBBHelper)[] = []

  // 临时变量
  const scratchDeltaMatrix = markRaw(new Matrix4())
  const scratchInverseStartMatrix = markRaw(new Matrix4())

  const editorStore = useEditorStore()
  const uiStore = useUIStore()
  const gameDataStore = useGameDataStore()
  const settingsStore = useSettingsStore()
  const { saveHistory } = useEditorHistory()
  const { commitBatchedTransform, getSelectedItemsCenter } = useEditorManipulation()
  const { pasteItems } = useClipboard()

  // 键盘状态
  const { Alt } = useMagicKeys()

  /**
   * 计算鼠标在旋转平面上的角度
   * @param gizmoWorldPos Gizmo 中心的世界坐标
   * @param mouseEvent 鼠标事件，用于获取屏幕坐标
   * @param camera 当前相机
   * @param axis 旋转轴
   * @param containerRect 容器的布局信息
   * @returns 角度（弧度），失败返回 null
   */
  function calculateRotationAngle(
    gizmoWorldPos: Vector3,
    mouseClientX: number,
    mouseClientY: number,
    camera: Camera,
    axis: 'X' | 'Y' | 'Z',
    containerRect: { left: number; top: number; width: number; height: number }
  ): number | null {
    // 1. 将鼠标屏幕坐标转为 NDC
    const mouseNDC = new Vector2(
      ((mouseClientX - containerRect.left) / containerRect.width) * 2 - 1,
      -((mouseClientY - containerRect.top) / containerRect.height) * 2 + 1
    )

    // 2. 构造旋转平面（过 gizmo 中心，法线为旋转轴）
    let planeNormal: Vector3
    if (axis === 'X') {
      planeNormal = new Vector3(1, 0, 0)
    } else if (axis === 'Y') {
      planeNormal = new Vector3(0, 1, 0)
    } else {
      // Z
      planeNormal = new Vector3(0, 0, 1)
    }

    // 如果启用了工作坐标系，需要旋转平面法线
    if (uiStore.workingCoordinateSystem.enabled && pivotRef.value) {
      const angleRad = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180
      planeNormal.applyAxisAngle(new Vector3(0, 0, 1), -angleRad)
    }

    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, gizmoWorldPos)

    // 3. 从鼠标发射射线，与平面求交
    const raycaster = new Raycaster()
    raycaster.setFromCamera(mouseNDC, camera)
    const intersection = new Vector3()
    const hit = raycaster.ray.intersectPlane(plane, intersection)

    if (!hit) {
      return null // 射线与平面平行，无交点
    }

    // 4. 计算交点相对于 gizmo 中心的角度
    const localPos = intersection.clone().sub(gizmoWorldPos)

    // 根据轴选择正确的两个分量计算 atan2
    let angle: number
    if (axis === 'X') {
      // 绕 X 轴旋转，Y-Z 平面
      angle = Math.atan2(localPos.z, localPos.y)
    } else if (axis === 'Y') {
      // 绕 Y 轴旋转，Z-X 平面
      angle = Math.atan2(localPos.x, localPos.z)
    } else {
      // 绕 Z 轴旋转，X-Y 平面
      angle = Math.atan2(localPos.y, localPos.x)
    }

    return angle
  }

  const shouldShowGizmo = computed(
    () =>
      (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0 &&
      editorStore.gizmoMode !== null
  )

  // Gizmo 空间模式：如果启用了工作坐标系，则使用 local 模式
  const transformSpace = computed(() =>
    uiStore.workingCoordinateSystem.enabled ? 'local' : 'world'
  )

  // 跟随选中物品中心更新 gizmo 位置（非拖拽时）
  watchEffect(() => {
    if (isTransformDragging.value) {
      return
    }

    const center = getSelectedItemsCenter()
    const pivot = pivotRef.value

    if (!center || !pivot) {
      return
    }

    // Gizmo 移到了 World Space (Z-up, Right-handed)，
    // 而 Game Logic 的 Visual Space 在一个 Scale(1, -1, 1) 的组里。
    // 视觉上 items 在 (x, -y, z)，所以 Gizmo 也应该在这里。
    pivot.position.set(center.x, -center.y, center.z)

    // 更新 Gizmo 旋转以匹配工作坐标系
    if (uiStore.workingCoordinateSystem.enabled) {
      const angleRad = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180
      // Z-up 系统，绕 Z 轴旋转
      pivot.setRotationFromEuler(new Euler(0, 0, -angleRad))
    } else {
      pivot.setRotationFromEuler(new Euler(0, 0, 0))
    }
  })

  function setOrbitControlsEnabled(enabled: boolean) {
    if (!orbitControlsRef?.value) return

    const wrapper = orbitControlsRef.value as any
    const controls = wrapper.instance // 从测试中确认的正确路径

    if (controls && typeof controls.enabled === 'boolean') {
      controls.enabled = enabled
    }
  }

  function startTransform(mouseX?: number, mouseY?: number) {
    const pivot = pivotRef.value
    if (!pivot) return

    isTransformDragging.value = true
    hasStartedTransform.value = false

    // 1. 检测Alt键状态，设置复制待定标志（但不立即执行复制）
    const scheme = editorStore.activeScheme
    if (Alt && Alt.value && scheme && scheme.selectedItemIds.value.size > 0) {
      altDragCopyPending.value = true
      altDragCopyExecuted.value = false
      // 记录初始鼠标位置（用于计算移动距离）
      if (mouseX !== undefined && mouseY !== undefined) {
        gizmoStartScreenPosition.value = { x: mouseX, y: mouseY }
      }
    } else {
      altDragCopyPending.value = false
      altDragCopyExecuted.value = false
    }

    // 2. 记录 Gizmo 初始世界矩阵和位置
    pivot.updateMatrixWorld(true) // 确保是最新的
    gizmoStartMatrix.copy(pivot.matrixWorld)
    gizmoStartPosition.setFromMatrixPosition(pivot.matrixWorld)

    // 3. 检测是否为旋转模式，并记录初始状态
    if (editorStore.gizmoMode === 'rotate' && transformRef?.value) {
      const controls = transformRef.value.instance || transformRef.value.value
      if (controls && controls.axis) {
        const axis = controls.axis.toUpperCase()
        if (axis === 'X' || axis === 'Y' || axis === 'Z') {
          isRotateMode.value = true
          rotateAxis.value = axis as 'X' | 'Y' | 'Z'
          startGizmoRotation.copy(pivot.rotation)
          lastAppliedAngle.value = 0
          hasInitializedRotation.value = false // 重置初始化标志
        }
      }
    } else {
      isRotateMode.value = false
      rotateAxis.value = null
    }

    // 4. 记录所有选中物品的初始世界矩阵 (根据数据从头计算，而不是读取渲染器可能被 Icon 模式修改过的矩阵)
    if (scheme) {
      itemStartWorldMatrices.value = buildItemWorldMatricesMap(scheme, scheme.selectedItemIds.value)

      // 🚀 性能优化：预计算选中和静止物品的碰撞数据
      const currentMode = settingsStore.settings.threeDisplayMode
      const modelManager = getThreeModelManager()
      const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]

      // 🚀 预计算选中物品的局部 OBB 信息（形状数据，不含位置/旋转）
      // 这是第二轮性能优化的关键：避免每帧重新查询 item 数据和模型包围盒
      const obbInfoList: SelectedItemOBBInfo[] = []

      for (const id of scheme.selectedItemIds.value) {
        const item = scheme.items.value.find((i) => i.internalId === id)
        if (!item) continue

        let localSize: Vector3
        let localCenter: Vector3

        if (currentMode === 'model') {
          const modelBox = modelManager.getModelBoundingBox(item.gameId)
          if (modelBox) {
            // 模型有实际包围盒
            localSize = new Vector3()
            modelBox.getSize(localSize)
            localCenter = new Vector3()
            modelBox.getCenter(localCenter)
          } else {
            // 模型未加载，使用默认尺寸
            const size = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
            localSize = new Vector3(...size)
            localCenter = new Vector3()
          }
        } else {
          // Simple/Icon 模式：使用单位立方体
          localSize = new Vector3(1, 1, 1)
          localCenter = new Vector3()
        }

        obbInfoList.push({ id, localSize, localCenter })
      }

      selectedItemsOBBInfo.value = obbInfoList

      // 5. 构建静止物品的预计算碰撞数据
      // 🚀 核心优化：一次性计算所有昂贵的 OBB、包围球和角点，避免在拖拽循环中重复计算
      const staticMatrices = new Map<string, StaticCollisionData>()

      for (const item of scheme.items.value) {
        if (!scheme.selectedItemIds.value.has(item.internalId)) {
          const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
          const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
          const useModelScale = !!(currentMode === 'model' && hasValidModel)
          const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)
          const furnitureSize =
            gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE

          // 预计算 OBB
          let obb: OBB
          if (currentMode === 'model') {
            const modelBox = modelManager.getModelBoundingBox(item.gameId)
            if (modelBox) {
              obb = getOBBFromMatrixAndModelBox(matrix, modelBox)
            } else {
              obb = getOBBFromMatrix(matrix, new Vector3(...furnitureSize))
            }
          } else {
            obb = getOBBFromMatrix(matrix, new Vector3(1, 1, 1))
          }

          // 🚀 预计算角点：这是性能优化的关键！
          // 每个静止物品的角点在拖拽过程中是不变的，一次性计算可以避免每帧数百次的重复计算
          const corners = obb.getCorners()

          // 预计算包围球用于快速剔除
          // 使用 OBB 的半对角线长度作为半径
          const radius = obb.halfExtents.length()

          staticMatrices.set(item.internalId, {
            matrix,
            obb,
            corners,
            center: obb.center.clone(),
            radius,
          })
        }
      }
      staticWorldMatrices.value = staticMatrices
    }

    setOrbitControlsEnabled(false)
  }

  function endTransform() {
    isTransformDragging.value = false
    itemStartWorldMatrices.value = new Map() // clear
    staticWorldMatrices.value = new Map() // clear
    selectedItemsOBBInfo.value = [] // clear
    hasStartedTransform.value = false
    altDragCopyPending.value = false
    altDragCopyExecuted.value = false
    isRotateMode.value = false
    rotateAxis.value = null
    hasInitializedRotation.value = false

    // 🔧 调试：清理包围盒辅助对象
    clearDebugHelpers()

    setOrbitControlsEnabled(true)
  }

  /**
   * 清理调试用的包围盒辅助对象
   */
  function clearDebugHelpers() {
    if (!DEBUG_SHOW_BOUNDING_BOXES) return

    const pivot = pivotRef.value
    if (!pivot || !pivot.parent) return

    for (const helper of debugHelpers) {
      pivot.parent.remove(helper)
      helper.dispose()
    }
    debugHelpers.length = 0
  }

  function handleGizmoDragging(isDragging: boolean) {
    if (!isDragging) {
      // 只在拖拽结束时调用 endTransform
      endTransform()
    }
    // 拖拽开始时不调用 startTransform，因为 mouseDown 已经调用了
  }

  function handleGizmoMouseDown() {
    // mouseDown 时初始化变换（记录初始状态）
    startTransform()
  }

  /**
   * 应用吸附：统一的紧贴吸附逻辑
   *
   * 策略：
   * 1. 计算每个静止物体与选区的"紧贴距离"
   * 2. 如果距离在阈值范围内（-50 到 +50），触发吸附
   * 3. 吸附到紧贴状态（距离=0）
   * 4. 只在当前 Gizmo 拖动的轴上进行吸附
   */
  function applyCollisionSnap(newWorldMatrices: Map<string, Matrix4>): Map<string, Matrix4> {
    // 1. 检查是否启用
    if (!settingsStore.settings.enableSurfaceSnap) {
      return newWorldMatrices
    }

    // 2. 仅对平移模式生效
    if (editorStore.gizmoMode !== 'translate') {
      return newWorldMatrices
    }

    // 3. 获取当前 TransformControls 的活动轴
    const enabledAxes = { x: false, y: false, z: false }

    if (transformRef?.value) {
      const controls = transformRef.value.instance || transformRef.value.value
      if (controls && controls.axis) {
        const axis = controls.axis.toUpperCase()
        // TransformControls 的 axis 可能是: 'X', 'Y', 'Z', 'XY', 'XZ', 'YZ', 'XYZ' 等
        if (axis.includes('X')) enabledAxes.x = true
        if (axis.includes('Y')) enabledAxes.y = true
        if (axis.includes('Z')) enabledAxes.z = true
      }
    }

    // 如果没有检测到任何活动轴，跳过吸附（避免误触发）
    if (!enabledAxes.x && !enabledAxes.y && !enabledAxes.z) {
      console.log('[Snap] 未检测到活动轴，跳过吸附')
      return newWorldMatrices
    }

    // 4. 计算 Gizmo 局部轴在世界空间中的表示
    // 当启用工作坐标系时，Gizmo 的局部 X/Y 轴会随工作坐标系旋转
    // 吸附应该约束在这些旋转后的局部轴上，而不是世界轴
    let gizmoWorldAxes = {
      x: new Vector3(1, 0, 0), // 默认：世界轴
      y: new Vector3(0, 1, 0),
      z: new Vector3(0, 0, 1),
    }

    if (uiStore.workingCoordinateSystem.enabled) {
      const angleRad = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180
      // 绕 Z 轴旋转后的局部 X/Y 轴（注意符号：Gizmo pivot 用的是 -angleRad）
      gizmoWorldAxes.x = new Vector3(Math.cos(-angleRad), Math.sin(-angleRad), 0).normalize()
      gizmoWorldAxes.y = new Vector3(-Math.sin(-angleRad), Math.cos(-angleRad), 0).normalize()
      // Z 轴不变
    }

    // 4. 计算选中物品的合并包围盒
    const scheme = editorStore.activeScheme
    if (!scheme) return newWorldMatrices

    // 🚀 使用预计算的局部 OBB 信息 + 增量变换，替代每帧重新计算
    // 这避免了：
    // - 每帧遍历 scheme.items.value.find()
    // - 每帧调用 getModelBoundingBox()
    // - 每帧创建多个 OBB 对象
    const selectedOBBs: OBB[] = []

    for (const obbInfo of selectedItemsOBBInfo.value) {
      const matrix = newWorldMatrices.get(obbInfo.id)
      if (!matrix) continue

      // 使用预计算的局部信息 + 当前世界矩阵，快速生成 OBB
      const obb = transformOBBByMatrix(matrix, obbInfo.localSize, obbInfo.localCenter)
      selectedOBBs.push(obb)
    }

    if (selectedOBBs.length === 0) return newWorldMatrices

    // 合并选区包围盒（单个物体时直接使用，避免退化为轴对齐）
    // TypeScript: selectedOBBs 非空已验证，结果必定非 undefined
    const selectionOBB = (selectedOBBs.length === 1 ? selectedOBBs[0] : mergeOBBs(selectedOBBs))!

    // 🔧 调试：可视化选区包围盒
    if (DEBUG_SHOW_BOUNDING_BOXES) {
      clearDebugHelpers() // 清理旧的辅助对象

      const pivot = pivotRef.value
      if (pivot && pivot.parent) {
        // 青色实线：OBB（定向包围盒）
        const obbHelper = new OBBHelper(selectionOBB, new Color(0x00ffff))
        pivot.parent.add(obbHelper)
        debugHelpers.push(obbHelper)

        // 绿色半透明：AABB（从 OBB 派生，用于对比可视化）
        const aabbHelper = new Box3Helper(selectionOBB.getAABB(), new Color(0x00ff00))
        pivot.parent.add(aabbHelper)
        debugHelpers.push(aabbHelper)
      }
    }

    // 5. 遍历静止物体，检测吸附
    // 按轴独立累积修正：每个轴选择最优修正，最后合并
    const correctionByAxis = {
      x: { vector: null as Vector3 | null, distance: Infinity },
      y: { vector: null as Vector3 | null, distance: Infinity },
      z: { vector: null as Vector3 | null, distance: Infinity },
    }

    const snapThreshold = settingsStore.settings.surfaceSnapThreshold

    // 计算选区中心和尺寸，用于距离剔除
    // 直接使用 OBB 的 center 和 halfExtents，无需额外计算
    const selectionCenter = selectionOBB.center
    // selectionOBB 的半径 (半对角线)
    const selectionRadius = selectionOBB.halfExtents.length()

    // 🚀 为选中物品的 OBB 预计算角点（对象复用）
    // 创建一个可复用的向量数组，避免在循环中反复创建对象
    const selectionCornersPool: Vector3[] = Array.from({ length: 8 }, () => new Vector3())
    const selectionCorners = selectionOBB.getCorners(selectionCornersPool)

    let checkedCount = 0
    let culledCount = 0

    // 核心优化：直接遍历预计算的数据，无需查找 invalidId 或重新计算 OBB
    for (const data of staticWorldMatrices.value.values()) {
      // 动态计算剔除半径：选区半径 + 候选物体半径 + 吸附距离
      // 两个球体相交检测：dist <= r1 + r2
      const dynamicCullRadius = selectionRadius + data.radius + snapThreshold
      const distanceToCandidate = selectionCenter.distanceTo(data.center)

      if (distanceToCandidate > dynamicCullRadius) {
        culledCount++
        continue
      }

      checkedCount++

      // 🚀 使用预计算的角点进行精确的吸附检测
      // 静止物品的角点已经在 startTransform() 中预计算
      // 选中物品的角点在上方预计算，并复用同一个数组
      const snapVector = calculateOBBSnapVector(
        selectionOBB,
        data.obb,
        snapThreshold,
        enabledAxes,
        selectionCorners, // 传入选中物品的预计算角点
        data.corners // 传入静止物品的预计算角点
      )

      if (snapVector) {
        // 按 Gizmo 局部轴投影分解吸附向量，每个轴独立选择最优吸附
        // 关键修复：使用 gizmoWorldAxes 而不是固定的世界轴，解决工作坐标系下的吸附方向错误

        if (enabledAxes.x) {
          const projX = snapVector.dot(gizmoWorldAxes.x)
          if (Math.abs(projX) > 0.1) {
            const distX = Math.abs(projX)
            if (distX < correctionByAxis.x.distance) {
              correctionByAxis.x.vector = gizmoWorldAxes.x.clone().multiplyScalar(projX)
              correctionByAxis.x.distance = distX
            }
          }
        }

        if (enabledAxes.y) {
          const projY = snapVector.dot(gizmoWorldAxes.y)
          if (Math.abs(projY) > 0.1) {
            const distY = Math.abs(projY)
            if (distY < correctionByAxis.y.distance) {
              correctionByAxis.y.vector = gizmoWorldAxes.y.clone().multiplyScalar(projY)
              correctionByAxis.y.distance = distY
            }
          }
        }

        if (enabledAxes.z) {
          const projZ = snapVector.dot(gizmoWorldAxes.z)
          if (Math.abs(projZ) > 0.1) {
            const distZ = Math.abs(projZ)
            if (distZ < correctionByAxis.z.distance) {
              correctionByAxis.z.vector = gizmoWorldAxes.z.clone().multiplyScalar(projZ)
              correctionByAxis.z.distance = distZ
            }
          }
        }
      }
    }

    // 6. 合并所有轴的吸附向量
    const finalCorrection = new Vector3()
    const appliedAxes: string[] = []

    if (correctionByAxis.x.vector) {
      finalCorrection.add(correctionByAxis.x.vector)
      appliedAxes.push(`X(${correctionByAxis.x.distance.toFixed(2)})`)
    }
    if (correctionByAxis.y.vector) {
      finalCorrection.add(correctionByAxis.y.vector)
      appliedAxes.push(`Y(${correctionByAxis.y.distance.toFixed(2)})`)
    }
    if (correctionByAxis.z.vector) {
      finalCorrection.add(correctionByAxis.z.vector)
      appliedAxes.push(`Z(${correctionByAxis.z.distance.toFixed(2)})`)
    }

    // 7. 应用吸附修正
    if (finalCorrection.length() > 0.1) {
      const correctedMatrices = new Map<string, Matrix4>()

      for (const [id, matrix] of newWorldMatrices) {
        const corrected = matrix.clone()
        const pos = new Vector3().setFromMatrixPosition(corrected)
        pos.add(finalCorrection)
        corrected.setPosition(pos)
        correctedMatrices.set(id, corrected)
      }

      return correctedMatrices
    }
    return newWorldMatrices
  }

  /**
   * 统一处理变换的核心逻辑：根据当前 Gizmo 状态计算所有物品的新状态
   */
  function calculateCurrentTransforms() {
    const pivot = pivotRef.value
    if (!pivot) return null

    // 1. 计算 Gizmo 的变换增量
    // Delta = Current * Inverse(Start)
    pivot.updateMatrixWorld(true)
    const currentGizmoMatrix = pivot.matrixWorld

    scratchInverseStartMatrix.copy(gizmoStartMatrix).invert()
    scratchDeltaMatrix.multiplyMatrices(currentGizmoMatrix, scratchInverseStartMatrix)

    // 2. 检查是否有实质性变化
    // 简单的检查对角线元素和位移
    // 这里我们假设如果触发了 change 事件就是有变化，或者交给提交时去 diff

    // 3. 计算每个物品的新世界矩阵
    const newWorldMatrices = new Map<string, Matrix4>()
    for (const [id, startWorldMatrix] of itemStartWorldMatrices.value.entries()) {
      const newWorldMatrix = scratchDeltaMatrix.clone().multiply(startWorldMatrix)
      newWorldMatrices.set(id, newWorldMatrix)
    }

    return newWorldMatrices
  }

  async function handleGizmoChange(event?: any) {
    if (!isTransformDragging.value) return

    const pivot = pivotRef.value
    if (!pivot) return

    // 旋转模式：用自定义角度计算替换 TransformControls 的默认计算
    if (
      isRotateMode.value &&
      rotateAxis.value &&
      activeCameraRef?.value &&
      uiStore.editorContainerRect
    ) {
      // 获取当前鼠标位置（从 window.event 或者 TransformControls 事件）
      const mouseEvent = event?.sourceEvent || (window as any).event
      if (mouseEvent && mouseEvent.clientX !== undefined && mouseEvent.clientY !== undefined) {
        const cameraComponent = activeCameraRef.value
        const camera = cameraComponent?.value || cameraComponent?.instance || cameraComponent
        const gizmoPos = new Vector3().setFromMatrixPosition(pivot.matrixWorld)

        const currentAngle = calculateRotationAngle(
          gizmoPos,
          mouseEvent.clientX,
          mouseEvent.clientY,
          camera,
          rotateAxis.value,
          uiStore.editorContainerRect
        )

        if (currentAngle !== null) {
          // 第一次计算角度：将其设为起始角度，不应用任何旋转
          if (!hasInitializedRotation.value) {
            startMouseAngle.value = currentAngle
            hasInitializedRotation.value = true
            return // 第一帧不应用变换，避免跳变
          }

          // 计算角度增量
          let deltaAngle = currentAngle - startMouseAngle.value

          // 处理角度跳变（从 -π 到 +π）
          if (deltaAngle > Math.PI) {
            deltaAngle -= 2 * Math.PI
          } else if (deltaAngle < -Math.PI) {
            deltaAngle += 2 * Math.PI
          }

          // 应用旋转吸附（如果启用）
          if (settingsStore.settings.rotationSnap && settingsStore.settings.rotationSnap > 0) {
            const snapRad = settingsStore.settings.rotationSnap // 已经是弧度值
            deltaAngle = Math.round(deltaAngle / snapRad) * snapRad
          }

          // 直接设置 gizmoPivot 的旋转
          const newRotation = startGizmoRotation.clone()
          if (rotateAxis.value === 'X') {
            newRotation.x += deltaAngle
          } else if (rotateAxis.value === 'Y') {
            newRotation.y += deltaAngle
          } else {
            newRotation.z += deltaAngle
          }
          pivot.rotation.copy(newRotation)
          pivot.updateMatrixWorld(true)

          lastAppliedAngle.value = deltaAngle
        }
      }
    }

    // Alt+拖拽复制：检查是否需要执行延迟复制
    if (altDragCopyPending.value && !altDragCopyExecuted.value) {
      // 计算Gizmo移动距离（世界空间）
      pivot.updateMatrixWorld(true)
      const currentPos = new Vector3().setFromMatrixPosition(pivot.matrixWorld)
      const startPos = new Vector3().setFromMatrixPosition(gizmoStartMatrix)
      const distance = currentPos.distanceTo(startPos)

      // 阈值：使用世界空间距离 10 单位
      if (distance > 10) {
        // 执行复制
        const scheme = editorStore.activeScheme
        if (scheme && scheme.selectedItemIds.value.size > 0) {
          const selectedIds = scheme.selectedItemIds.value
          const selectedItems = scheme.items.value
            .filter((item) => selectedIds.has(item.internalId))
            .map((item) => ({ ...item }))

          if (selectedItems.length > 0) {
            // 临时关闭拖拽标志，允许渲染器rebuild新物品
            isTransformDragging.value = false

            // 原地粘贴
            pasteItems(selectedItems, 0, 0)

            // 标记已执行
            altDragCopyExecuted.value = true

            // 等待下一帧，确保渲染器完成rebuild
            // 这样新创建的物品才会有对应的实例
            await new Promise((resolve) => requestAnimationFrame(resolve))

            // 恢复拖拽标志
            isTransformDragging.value = true

            // 重新记录新选中物品的初始矩阵（因为现在选中的是副本）
            itemStartWorldMatrices.value = buildItemWorldMatricesMap(
              scheme,
              scheme.selectedItemIds.value
            )

            // 注意：不更新 gizmoStartMatrix！
            // 保持原始的起始位置，这样后续的增量计算才是正确的
            // Delta = Current - Start (原始位置)
          }
        }
        // 复制完成后，继续执行后续的矩阵更新逻辑（不return）
      } else {
        // 距离 <= 50：还未触发复制，直接返回，不更新任何矩阵
        // 这样原物品保持静止，直到超过阈值
        return
      }
    }

    let newWorldMatrices = calculateCurrentTransforms()
    if (!newWorldMatrices) return

    // 应用碰撞吸附
    newWorldMatrices = applyCollisionSnap(newWorldMatrices)

    // 第一次真正发生变换时保存历史
    if (!hasStartedTransform.value) {
      saveHistory('edit')
      hasStartedTransform.value = true
    }

    // 更新视觉层（拖拽过程中跳过 BVH 重建以提升性能）
    updateSelectedInstancesMatrix(newWorldMatrices, true)
  }

  function handleGizmoMouseUp() {
    // 此时 Gizmo 还在终点位置，最后一次计算变换并提交
    if (!hasStartedTransform.value) {
      endTransform()
      return
    }

    let newWorldMatrices = calculateCurrentTransforms()

    if (newWorldMatrices) {
      // ✅ 关键修复：松开鼠标时也要应用碰撞吸附，确保与拖拽过程中的处理一致
      newWorldMatrices = applyCollisionSnap(newWorldMatrices)

      // 最后一次更新：进行 BVH 重建（拖拽结束，恢复拾取精度）
      updateSelectedInstancesMatrix(newWorldMatrices, false)

      const updates: any[] = []

      for (const [id, worldMatrix] of newWorldMatrices.entries()) {
        // 使用统一的工具类从世界矩阵还原到游戏数据
        const itemData = matrixTransform.extractItemDataFromWorldMatrix(worldMatrix)
        updates.push({ id, ...itemData })
      }

      // 批量提交
      if (updates.length > 0) {
        commitBatchedTransform(updates, { saveHistory: false })
      }
    }

    endTransform()
  }

  /**
   * 构建选中物品的世界矩阵映射表（辅助函数）
   */
  function buildItemWorldMatricesMap(scheme: any, selectedIds: Set<string>): Map<string, Matrix4> {
    const map = new Map<string, Matrix4>()
    const itemMap = new Map<string, AppItem>()

    // 构建查找表以快速获取 item 对象
    scheme.items.value.forEach((item: AppItem) => {
      if (selectedIds.has(item.internalId)) {
        itemMap.set(item.internalId, item)
      }
    })

    // 计算每个选中物品的世界矩阵
    for (const id of selectedIds) {
      const item = itemMap.get(id)
      if (item) {
        // Model 模式且有模型配置时，使用纯 scale 值（模型已含尺寸）
        // 其他模式（box/icon/simple-box）或 fallback 物品使用 scale * furnitureSize
        const currentMode = settingsStore.settings.threeDisplayMode
        const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)

        // Model 模式下,只有当 modelConfig 存在且 meshes 数组非空时,才使用纯 scale 值
        // 否则(包括 fallback 物品)需要乘以 furnitureSize
        const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
        const useModelScale = !!(currentMode === 'model' && hasValidModel)
        const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)
        map.set(id, matrix)
      }
    }

    return map
  }

  /**
   * 设置 Gizmo 外观自定义
   *
   * 包括：
   * - 轴颜色自定义
   * - 隐藏 E 轴（视野平面旋转圈）
   * - 处理旋转轴限制（限制检测开启时根据家具数据隐藏 X/Y 轴）
   * - Y 轴几何体翻转（适配游戏坐标系）
   */
  function setupGizmoAppearance(transformRef: Ref<any | null>, axesRef?: Ref<any | null>) {
    const settingsStore = useSettingsStore()

    // 计算当前选中物品的约束信息
    const computeConstraints = () => {
      const scheme = editorStore.activeScheme
      if (!scheme || scheme.selectedItemIds.value.size === 0) {
        return { canRotateX: true, canRotateY: true }
      }

      const selectedIds = scheme.selectedItemIds.value
      let canRotateX = true
      let canRotateY = true

      for (const id of selectedIds) {
        const item = scheme.items.value.find((i) => i.internalId === id)
        if (item) {
          const furniture = gameDataStore.getFurniture(item.gameId)
          if (furniture) {
            canRotateX &&= furniture.rotationAllowed.x
            canRotateY &&= furniture.rotationAllowed.y
          }
        }
      }

      return { canRotateX, canRotateY }
    }

    // 自定义 TransformControls (Gizmo) 颜色，并隐藏 E 轴，同时处理旋转轴限制
    watch(
      [
        transformRef,
        () => editorStore.gizmoMode,
        () => settingsStore.settings.enableLimitDetection,
        () => editorStore.selectionVersion, // 监听选择变化
      ],
      ([v]) => {
        const controls = v?.instance || v?.value
        if (!controls) return

        // 限制处理：如果开启限制检测且处于旋转模式，则根据家具数据控制轴显示
        const isRotate = editorStore.gizmoMode === 'rotate'
        const isLimitEnabled = settingsStore.settings.enableLimitDetection

        if (isRotate && isLimitEnabled) {
          const constraints = computeConstraints()
          controls.showX = constraints.canRotateX
          controls.showY = constraints.canRotateY
          controls.showZ = true // Z 轴总是显示
        } else {
          controls.showX = true
          controls.showY = true
          controls.showZ = true
        }

        const updateGizmo = () => {
          // 1. 颜色设置 & 收集需要移除的 'E' 和 'XYZE' 轴对象
          const objectsToRemove: any[] = []

          // 遍历 helper/gizmo 结构
          const mainGizmo = controls.gizmo || controls.children?.[0]
          if (mainGizmo) {
            mainGizmo.traverse((obj: any) => {
              // 标记需要移除的辅助轴
              if (obj.name === 'E' || obj.name === 'XYZE') {
                objectsToRemove.push(obj)
                return
              }

              // 设置轴颜色
              if (!obj.material || !obj.name) return

              let color
              if (/^(X|XYZX)$/.test(obj.name)) color = AXIS_COLORS.x
              else if (/^(Y|XYZY)$/.test(obj.name)) {
                color = AXIS_COLORS.y
                // 翻转 Y 轴几何体的顶点方向，使其在视觉上指向"下方"以匹配游戏数据坐标系
                // 检查标记：防止重复翻转
                if (!obj.userData.hasFlippedY) {
                  const posAttr = obj.geometry?.attributes?.position
                  if (posAttr) {
                    for (let i = 0; i < posAttr.count; i++) {
                      posAttr.setY(i, -posAttr.getY(i))
                    }
                    posAttr.needsUpdate = true
                    obj.userData.hasFlippedY = true
                  }
                }
              } else if (/^(Z|XYZZ)$/.test(obj.name)) color = AXIS_COLORS.z

              if (color) {
                obj.material.color.set(color)
                // 关键：覆盖 tempColor 防止颜色被重置
                obj.material.tempColor = obj.material.tempColor || new Color()
                obj.material.tempColor.set(color)
              }
            })
          }

          // 遍历 picker 结构 (用于点击检测的隐藏物体)
          if (controls.picker) {
            controls.picker.traverse((obj: any) => {
              if (obj.name === 'E' || obj.name === 'XYZE') {
                objectsToRemove.push(obj)
              }
            })
          }

          // 2. 统一移除
          objectsToRemove.forEach((obj) => {
            if (obj.parent) {
              obj.parent.remove(obj)
            }
          })
        }

        updateGizmo()
      }
    )

    // 自定义 AxesHelper (坐标轴) 颜色
    if (axesRef) {
      watch(axesRef, (v) => {
        const axes = v?.instance || v?.value || v
        // AxesHelper.setColors available since r133
        if (axes && typeof axes.setColors === 'function') {
          axes.setColors(
            new Color(AXIS_COLORS.x),
            new Color(AXIS_COLORS.y),
            new Color(AXIS_COLORS.z)
          )
        }
      })
    }
  }

  return {
    shouldShowGizmo,
    isTransformDragging,
    transformSpace,
    handleGizmoDragging,
    handleGizmoMouseDown,
    handleGizmoMouseUp,
    handleGizmoChange,
    setupGizmoAppearance,
  }
}
