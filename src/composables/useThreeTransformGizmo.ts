import { computed, ref, watchEffect, markRaw, watch, type Ref } from 'vue'
import { useMagicKeys } from '@vueuse/core'
import { Object3D, Vector3, Euler, Matrix4, Color } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useClipboard } from '@/composables/useClipboard'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { matrixTransform } from '@/lib/matrixTransform'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'
import type { AppItem } from '@/types/editor'

// 现代配色方案
const AXIS_COLORS = {
  x: 0xef4444, // red-500
  y: 0x84cc16, // lime-500
  z: 0x3b82f6, // blue-500
}

export function useThreeTransformGizmo(
  pivotRef: Ref<Object3D | null>,
  updateSelectedInstancesMatrix: (idToWorldMatrixMap: Map<string, Matrix4>) => void,
  isTransformDragging: Ref<boolean>, // 必需：用于多个 composable 之间的状态共享
  orbitControlsRef?: Ref<any | null>
) {
  // 直接使用传入的 ref（多个 composable 之间共享状态）

  // 矩阵变换状态
  const gizmoStartMatrix = markRaw(new Matrix4())
  // 记录拖拽开始时每个选中物品的世界矩阵
  const itemStartWorldMatrices = ref(new Map<string, Matrix4>())
  const hasStartedTransform = ref(false)

  // Alt+拖拽复制状态
  const altDragCopyPending = ref(false)
  const altDragCopyExecuted = ref(false)
  const gizmoStartScreenPosition = ref({ x: 0, y: 0 })

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

    // 2. 记录 Gizmo 初始世界矩阵
    pivot.updateMatrixWorld(true) // 确保是最新的
    gizmoStartMatrix.copy(pivot.matrixWorld)

    // 2. 记录所有选中物品的初始世界矩阵 (根据数据从头计算，而不是读取渲染器可能被 Icon 模式修改过的矩阵)
    if (scheme) {
      itemStartWorldMatrices.value = buildItemWorldMatricesMap(scheme, scheme.selectedItemIds.value)
    }

    setOrbitControlsEnabled(false)
  }

  function endTransform() {
    isTransformDragging.value = false
    itemStartWorldMatrices.value = new Map() // clear
    hasStartedTransform.value = false
    altDragCopyPending.value = false
    altDragCopyExecuted.value = false
    setOrbitControlsEnabled(true)
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

  // 统一处理变换的核心逻辑：根据当前 Gizmo 状态计算所有物品的新状态
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

  async function handleGizmoChange() {
    if (!isTransformDragging.value) return

    const pivot = pivotRef.value
    if (!pivot) return

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

    const newWorldMatrices = calculateCurrentTransforms()
    if (!newWorldMatrices) return

    // 第一次真正发生变换时保存历史
    if (!hasStartedTransform.value) {
      saveHistory('edit')
      hasStartedTransform.value = true
    }

    // 更新视觉层
    updateSelectedInstancesMatrix(newWorldMatrices)
  }

  function handleGizmoMouseUp() {
    // 此时 Gizmo 还在终点位置，最后一次计算变换并提交
    if (!hasStartedTransform.value) {
      endTransform()
      return
    }

    const newWorldMatrices = calculateCurrentTransforms()

    if (newWorldMatrices) {
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
        // 其他模式（box/icon/simple-box）使用 scale * furnitureSize
        const currentMode = settingsStore.settings.threeDisplayMode
        const useModelScale =
          currentMode === 'model' && !!gameDataStore.getFurnitureModelConfig(item.gameId)
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
   * - 处理旋转轴限制（限制检测开启时隐藏 X/Y 轴）
   * - Y 轴几何体翻转（适配游戏坐标系）
   */
  function setupGizmoAppearance(transformRef: Ref<any | null>, axesRef?: Ref<any | null>) {
    const settingsStore = useSettingsStore()

    // 自定义 TransformControls (Gizmo) 颜色，并隐藏 E 轴，同时处理旋转轴限制
    watch(
      [
        transformRef,
        () => editorStore.gizmoMode,
        () => settingsStore.settings.enableLimitDetection,
      ],
      ([v]) => {
        const controls = v?.instance || v?.value
        if (!controls) return

        // 限制处理：如果开启限制检测且处于旋转模式，则隐藏 X/Y 轴
        const isRotate = editorStore.gizmoMode === 'rotate'
        const isLimitEnabled = settingsStore.settings.enableLimitDetection

        if (isRotate && isLimitEnabled) {
          controls.showX = false
          controls.showY = false
        } else {
          controls.showX = true
          controls.showY = true
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
