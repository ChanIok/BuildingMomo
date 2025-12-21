import { computed, ref, watchEffect, markRaw, type Ref } from 'vue'
import { Object3D, Vector3, Euler, Quaternion, Matrix4, MathUtils } from 'three'
import { useEditorStore } from '@/stores/editorStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'

export function useThreeTransformGizmo(
  pivotRef: Ref<Object3D | null>,
  updateSelectedInstancesMatrix: (idToWorldMatrixMap: Map<string, Matrix4>) => void,
  getInstanceWorldMatrix: (id: string) => Matrix4 | null,
  isTransformDragging?: Ref<boolean>,
  orbitControlsRef?: Ref<any | null>
) {
  // 使用共享的 ref 或创建内部 ref（向后兼容）
  const _isTransformDragging = isTransformDragging || ref(false)

  // 矩阵变换状态
  const gizmoStartMatrix = markRaw(new Matrix4())
  // 记录拖拽开始时每个选中物品的世界矩阵
  const itemStartWorldMatrices = ref(new Map<string, Matrix4>())
  const hasStartedTransform = ref(false)

  // 临时变量

  const scratchDeltaMatrix = markRaw(new Matrix4())
  const scratchInverseStartMatrix = markRaw(new Matrix4())

  // 父级变换矩阵：Scale(1, -1, 1). 它的逆矩阵也是它自己
  const parentInverseMatrix = markRaw(new Matrix4().makeScale(1, -1, 1))

  const editorStore = useEditorStore()
  const uiStore = useUIStore()
  const { saveHistory } = useEditorHistory()
  const { commitBatchedTransform, getSelectedItemsCenter } = useEditorManipulation()

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
    if (_isTransformDragging.value) {
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

  function startTransform() {
    const pivot = pivotRef.value
    if (!pivot) return

    _isTransformDragging.value = true
    hasStartedTransform.value = false

    // 1. 记录 Gizmo 初始世界矩阵
    pivot.updateMatrixWorld(true) // 确保是最新的
    gizmoStartMatrix.copy(pivot.matrixWorld)

    // 2. 记录所有选中物品的初始世界矩阵 (直接从 Renderer 获取真实矩阵，保留缩放)
    const map = new Map<string, Matrix4>()
    const scheme = editorStore.activeScheme
    if (scheme) {
      const selectedIds = scheme.selectedItemIds.value
      for (const id of selectedIds) {
        const matrix = getInstanceWorldMatrix(id)
        if (matrix) {
          map.set(id, matrix)
        }
      }
    }
    itemStartWorldMatrices.value = map

    setOrbitControlsEnabled(false)
  }

  function endTransform() {
    _isTransformDragging.value = false
    itemStartWorldMatrices.value = new Map() // clear
    hasStartedTransform.value = false
    setOrbitControlsEnabled(true)
  }

  function handleGizmoDragging(isDragging: boolean) {
    if (isDragging) {
      startTransform()
    } else {
      endTransform()
    }
  }

  function handleGizmoMouseDown() {
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

  function handleGizmoChange() {
    if (!_isTransformDragging.value) return

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
        // 逆向计算回 Local Space
        // Local = ParentInverse * World
        const localMatrix = parentInverseMatrix.clone().multiply(worldMatrix)

        const pos = new Vector3()
        const quat = new Quaternion()
        const scale = new Vector3()
        localMatrix.decompose(pos, quat, scale)

        const euler = new Euler().setFromQuaternion(quat, 'ZYX')

        // 还原到数据格式
        // UseThreeInstancedRenderer: scratchEuler.set(-Rx, -Ry, Rz)
        // So: Data.x = -Visual.x, Data.y = -Visual.y, Data.z = Visual.z
        updates.push({
          id,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          rotation: {
            x: -MathUtils.radToDeg(euler.x),
            y: -MathUtils.radToDeg(euler.y),
            z: MathUtils.radToDeg(euler.z),
          },
        })
      }

      // 批量提交
      if (updates.length > 0) {
        commitBatchedTransform(updates, { saveHistory: false })
      }
    }

    endTransform()
  }

  return {
    shouldShowGizmo,
    isTransformDragging: _isTransformDragging,
    transformSpace,
    handleGizmoDragging,
    handleGizmoMouseDown,
    handleGizmoMouseUp,
    handleGizmoChange,
  }

  return {
    shouldShowGizmo,
    isTransformDragging: _isTransformDragging,
    transformSpace,
    handleGizmoDragging,
    handleGizmoMouseDown,
    handleGizmoMouseUp,
    handleGizmoChange,
  }
}
