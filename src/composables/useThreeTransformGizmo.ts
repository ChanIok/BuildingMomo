import { computed, ref, watchEffect, markRaw, type Ref } from 'vue'
import { Object3D, Vector3 } from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import { coordinates3D } from '@/lib/coordinates'

export function useThreeTransformGizmo(
  editorStore: ReturnType<typeof useEditorStore>,
  pivotRef: Ref<Object3D | null>,
  updateSelectedInstancesMatrix: (selectedIds: Set<string>, deltaPosition: Vector3) => void,
  isTransformDragging?: Ref<boolean>,
  orbitControlsRef?: Ref<any | null>
) {
  // 使用共享的 ref 或创建内部 ref（向后兼容）
  const _isTransformDragging = isTransformDragging || ref(false)

  const dragStartWorld = ref<Vector3 | null>(null)
  const lastApplied = ref({ x: 0, y: 0, z: 0 })
  const hasStartedTransform = ref(false)

  // 记录上一次应用的 Three 空间位置（用于计算增量）
  const lastThreePosition = ref<Vector3 | null>(null)

  const shouldShowGizmo = computed(() => editorStore.selectedItemIds.size > 0)

  // 跟随选中物品中心更新 gizmo 位置（非拖拽时）
  watchEffect(() => {
    if (_isTransformDragging.value) {
      return
    }

    const center = editorStore.getSelectedItemsCenter?.()
    const pivot = pivotRef.value

    if (!center || !pivot) {
      return
    }

    // 使用坐标转换工具
    coordinates3D.setThreeFromGame(pivot.position, center)
  })

  function setOrbitControlsEnabled(enabled: boolean) {
    if (!orbitControlsRef?.value) return

    const wrapper = orbitControlsRef.value as any
    const controls = wrapper.instance // 从测试中确认的正确路径
    
    if (controls && typeof controls.enabled === 'boolean') {
      controls.enabled = enabled
    }
  }

  function handleGizmoDragging(isDragging: boolean) {
    _isTransformDragging.value = isDragging

    if (isDragging) {
      // 开始拖拽时记录初始状态
      const pivot = pivotRef.value
      if (!pivot) {
        return
      }
      dragStartWorld.value = markRaw(pivot.position.clone())
      lastThreePosition.value = markRaw(pivot.position.clone())
      lastApplied.value = { x: 0, y: 0, z: 0 }
      hasStartedTransform.value = false

      // 拖拽开始时禁用相机控制
      setOrbitControlsEnabled(false)
    } else {
      // 结束拖拽时清理
      dragStartWorld.value = null
      lastThreePosition.value = null
      lastApplied.value = { x: 0, y: 0, z: 0 }
      hasStartedTransform.value = false

      // 拖拽结束时恢复相机控制
      setOrbitControlsEnabled(true)
    }
  }

  function handleGizmoMouseDown() {
    const pivot = pivotRef.value
    if (!pivot) {
      return
    }

    _isTransformDragging.value = true
    dragStartWorld.value = markRaw(pivot.position.clone())
    lastThreePosition.value = markRaw(pivot.position.clone())
    lastApplied.value = { x: 0, y: 0, z: 0 }
    hasStartedTransform.value = false

    // 鼠标按下时禁用相机控制
    setOrbitControlsEnabled(false)
  }

  function handleGizmoMouseUp() {
    // 松开鼠标时，提交最终的位置变化到 store
    const last = lastApplied.value

    if (hasStartedTransform.value && (last.x !== 0 || last.y !== 0 || last.z !== 0)) {
      // 提交真实数据更新
      if (editorStore.moveSelectedItems3D) {
        editorStore.moveSelectedItems3D(last.x, last.y, last.z)
      }
    }

    _isTransformDragging.value = false
    dragStartWorld.value = null
    lastThreePosition.value = null
    lastApplied.value = { x: 0, y: 0, z: 0 }
    hasStartedTransform.value = false

    // 松开鼠标后恢复相机控制
    setOrbitControlsEnabled(true)
  }

  function handleGizmoChange() {
    if (!_isTransformDragging.value) {
      return
    }

    const pivot = pivotRef.value
    const lastThree = lastThreePosition.value
    if (!pivot || !lastThree) {
      return
    }

    const current = pivot.position

    // 计算 Three 空间的增量（相对于上一帧）
    const deltaThree = markRaw(
      new Vector3(current.x - lastThree.x, current.y - lastThree.y, current.z - lastThree.z)
    )

    // 如果没有移动则跳过
    if (deltaThree.lengthSq() === 0) {
      return
    }

    // 第一次真正发生位移时保存历史
    if (!hasStartedTransform.value) {
      editorStore.saveHistory?.('edit')
      hasStartedTransform.value = true
    }

    // 直接更新实例矩阵（视觉变换，不触发 store）
    updateSelectedInstancesMatrix(editorStore.selectedItemIds, deltaThree)

    // 更新记录位置
    lastThreePosition.value = markRaw(current.clone())

    // 累积游戏坐标增量（用于最终提交）
    const start = dragStartWorld.value
    if (start) {
      const totalThreeDelta = {
        x: current.x - start.x,
        y: current.y - start.y,
        z: current.z - start.z,
      }
      const gameDelta = coordinates3D.threeDeltaToGameDelta(totalThreeDelta)
      lastApplied.value = { x: gameDelta.x, y: gameDelta.y, z: gameDelta.z }
    }
  }

  return {
    shouldShowGizmo,
    isTransformDragging: _isTransformDragging,
    handleGizmoDragging,
    handleGizmoMouseDown,
    handleGizmoMouseUp,
    handleGizmoChange,
  }
}
