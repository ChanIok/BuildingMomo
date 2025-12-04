import { computed, ref, watchEffect, markRaw, type Ref } from 'vue'
import { Object3D, Vector3, Euler } from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { useEditorHistory } from '@/composables/editor/useEditorHistory'
import { useEditorManipulation } from '@/composables/editor/useEditorManipulation'

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

  const settingsStore = useSettingsStore()
  const uiStore = useUIStore()
  const { saveHistory } = useEditorHistory()
  const { moveSelectedItems, getSelectedItemsCenter } = useEditorManipulation()
  const shouldShowGizmo = computed(
    () =>
      (editorStore.activeScheme?.selectedItemIds.value.size ?? 0) > 0 &&
      settingsStore.settings.showGizmo
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

    // 修复：由于 Gizmo 移到了 World Space (Z-up, Right-handed)，
    // 而 Game Logic 的可视化层在一个 Scale(1, -1, 1) 的组里。
    // 视觉上 items 在 (x, -y, z)，所以 Gizmo 也应该在这里。
    pivot.position.set(center.x, -center.y, center.z)

    // 更新 Gizmo 旋转以匹配工作坐标系
    if (uiStore.workingCoordinateSystem.enabled) {
      const angleRad = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180
      // Z-up 系统，绕 Z 轴旋转
      // 注意：由于世界空间 Y 轴被翻转 (Scale 1, -1, 1)，旋转方向也需要取反
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
      moveSelectedItems(last.x, last.y, last.z, { saveHistory: false })
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
    // 这里的 deltaThree 是 World Space 的增量
    const deltaThree = markRaw(
      new Vector3(current.x - lastThree.x, current.y - lastThree.y, current.z - lastThree.z)
    )

    // 如果没有移动则跳过
    if (deltaThree.lengthSq() === 0) {
      return
    }

    // 第一次真正发生位移时保存历史
    if (!hasStartedTransform.value) {
      saveHistory('edit')
      hasStartedTransform.value = true
    }

    // 关键修正：将 World Space 的增量转换为 Item Visual Space 的增量
    // Item Visual Space 的 Y 轴是翻转的 (Scale Y = -1)
    // World dy = +10 -> Item Visual y change = -10
    const deltaItemVisual = deltaThree.clone()
    deltaItemVisual.y = -deltaItemVisual.y

    // 直接更新实例矩阵（视觉变换，不触发 store）
    updateSelectedInstancesMatrix(
      editorStore.activeScheme?.selectedItemIds.value ?? new Set(),
      deltaItemVisual
    )

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
      // 同样需要修正 Y 轴翻转
      const gameDelta = {
        x: totalThreeDelta.x,
        y: -totalThreeDelta.y, // World dy -> Game dy (negated)
        z: totalThreeDelta.z,
      }
      lastApplied.value = { x: gameDelta.x, y: gameDelta.y, z: gameDelta.z }
    }
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
