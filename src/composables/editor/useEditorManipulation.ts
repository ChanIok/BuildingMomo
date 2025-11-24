import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import type { TransformParams } from '../../types/editor'

// 3D旋转：将点绕中心旋转（群组旋转）
function rotatePoint3D(
  point: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  rotation: { x?: number; y?: number; z?: number }
): { x: number; y: number; z: number } {
  // 转换为相对中心的坐标
  let px = point.x - center.x
  let py = point.y - center.y
  let pz = point.z - center.z

  // 依次应用旋转（顺序：X -> Y -> Z，对应 Roll -> Pitch -> Yaw）
  // 1. 绕X轴旋转（Roll）
  if (rotation.x) {
    const angleRad = (rotation.x * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const newPy = py * cos - pz * sin
    const newPz = py * sin + pz * cos
    py = newPy
    pz = newPz
  }

  // 2. 绕Y轴旋转（Pitch）
  if (rotation.y) {
    const angleRad = (rotation.y * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const newPx = px * cos + pz * sin
    const newPz = -px * sin + pz * cos
    px = newPx
    pz = newPz
  }

  // 3. 绕Z轴旋转（Yaw）
  if (rotation.z) {
    const angleRad = (rotation.z * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)
    const newPx = px * cos - py * sin
    const newPy = px * sin + py * cos
    px = newPx
    py = newPy
  }

  // 转回世界坐标
  return {
    x: px + center.x,
    y: py + center.y,
    z: pz + center.z,
  }
}

export function useEditorManipulation() {
  const store = useEditorStore()
  const { activeScheme, selectedItems } = storeToRefs(store)
  const { getSelectedItemsCenter } = store // This is still in store, or we could move it here too.
  const { saveHistory } = useEditorHistory()

  // 删除选中物品
  function deleteSelected() {
    if (!activeScheme.value) return

    // 保存历史（编辑操作）
    saveHistory('edit')

    activeScheme.value.items = activeScheme.value.items.filter(
      (item) => !activeScheme.value!.selectedItemIds.has(item.internalId)
    )
    activeScheme.value.selectedItemIds.clear()
  }

  // 精确变换选中物品（位置和旋转）
  function updateSelectedItemsTransform(params: TransformParams) {
    if (!activeScheme.value) return

    // 保存历史（编辑操作）
    saveHistory('edit')

    const { mode, position, rotation } = params
    const selected = selectedItems.value

    if (selected.length === 0) return

    // 计算选区中心（用于旋转和绝对位置）
    const center = getSelectedItemsCenter()
    if (!center) return

    // 计算位置偏移量
    let positionOffset = { x: 0, y: 0, z: 0 }

    if (mode === 'absolute' && position) {
      // 绝对模式：移动到指定坐标
      positionOffset = {
        x: (position.x ?? center.x) - center.x,
        y: (position.y ?? center.y) - center.y,
        z: (position.z ?? center.z) - center.z,
      }
    } else if (mode === 'relative' && position) {
      // 相对模式：偏移指定距离
      positionOffset = {
        x: position.x ?? 0,
        y: position.y ?? 0,
        z: position.z ?? 0,
      }
    }

    // 更新物品
    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (!activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return item
      }

      let newX = item.x
      let newY = item.y
      let newZ = item.z
      const currentRotation = item.originalData.Rotation
      let newRoll = currentRotation.Roll
      let newPitch = currentRotation.Pitch
      let newYaw = currentRotation.Yaw

      // 应用旋转（群组旋转：位置绕中心旋转 + 朝向同步旋转）
      if (rotation && (rotation.x || rotation.y || rotation.z)) {
        // 1. 位置绕中心旋转（公转）
        const rotatedPos = rotatePoint3D({ x: item.x, y: item.y, z: item.z }, center, rotation)
        newX = rotatedPos.x
        newY = rotatedPos.y
        newZ = rotatedPos.z

        // 2. 朝向同步旋转（自转）
        newRoll += rotation.x ?? 0
        newPitch += rotation.y ?? 0
        newYaw += rotation.z ?? 0
      }

      // 应用位置偏移
      newX += positionOffset.x
      newY += positionOffset.y
      newZ += positionOffset.z

      return {
        ...item,
        x: newX,
        y: newY,
        z: newZ,
        originalData: {
          ...item.originalData,
          Location: {
            ...item.originalData.Location,
            X: newX,
            Y: newY,
            Z: newZ,
          },
          Rotation: {
            Pitch: newPitch,
            Yaw: newYaw,
            Roll: newRoll,
          },
        },
      }
    })
  }

  // 移动选中物品（XYZ）
  function moveSelectedItems(
    dx: number,
    dy: number,
    dz: number,
    options: { saveHistory?: boolean } = { saveHistory: true }
  ) {
    if (!activeScheme.value) {
      return
    }

    if (options.saveHistory) {
      saveHistory('edit')
    }

    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (!activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return item
      }

      const newX = item.x + dx
      const newY = item.y + dy
      const newZ = item.z + dz

      return {
        ...item,
        x: newX,
        y: newY,
        z: newZ,
        originalData: {
          ...item.originalData,
          Location: {
            ...item.originalData.Location,
            X: newX,
            Y: newY,
            Z: newZ,
          },
        },
      }
    })
  }

  return {
    deleteSelected,
    updateSelectedItemsTransform,
    moveSelectedItems,
  }
}
