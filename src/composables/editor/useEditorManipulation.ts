import { storeToRefs } from 'pinia'
import { Vector3, Quaternion, Euler, MathUtils } from 'three'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import type { TransformParams } from '../../types/editor'
import type { AppItem } from '../../types/editor'

/**
 * 计算物品在群组旋转后的新位置和姿态
 * 使用四元数确保旋转在世界坐标系下正确应用
 *
 * @param item - 要变换的物品
 * @param center - 旋转中心点
 * @param rotationDelta - 旋转增量 (度数: x=Roll, y=Pitch, z=Yaw)
 * @param positionOffset - 位置偏移
 */
function calculateNewTransform(
  item: AppItem,
  center: { x: number; y: number; z: number },
  rotationDelta: { x?: number; y?: number; z?: number },
  positionOffset: { x: number; y: number; z: number }
) {
  // 1. 准备基础数据
  const currentPos = new Vector3(item.x, item.y, item.z)
  const centerPos = new Vector3(center.x, center.y, center.z)

  // 构建当前姿态四元数 (注意顺序 ZYX，单位转弧度)
  const currentEuler = new Euler(
    MathUtils.degToRad(item.originalData.Rotation.Roll),
    MathUtils.degToRad(item.originalData.Rotation.Pitch),
    MathUtils.degToRad(item.originalData.Rotation.Yaw),
    'ZYX'
  )
  const qCurrent = new Quaternion().setFromEuler(currentEuler)

  // 构建增量旋转四元数 (同样使用 ZYX 顺序)
  const deltaEuler = new Euler(
    MathUtils.degToRad(rotationDelta.x ?? 0),
    MathUtils.degToRad(rotationDelta.y ?? 0),
    MathUtils.degToRad(rotationDelta.z ?? 0),
    'ZYX'
  )
  const qDelta = new Quaternion().setFromEuler(deltaEuler)

  // 2. 计算新位置 (公转 + 平移)
  // 向量：中心 -> 物体
  const relativePos = currentPos.clone().sub(centerPos)
  // 应用旋转
  relativePos.applyQuaternion(qDelta)
  // 加回中心 + 加绝对偏移
  const newPos = centerPos
    .clone()
    .add(relativePos)
    .add(new Vector3(positionOffset.x, positionOffset.y, positionOffset.z))

  // 3. 计算新姿态 (自转)
  // 左乘 qDelta 表示基于世界坐标系的旋转叠加
  const qNew = qDelta.clone().multiply(qCurrent)

  // 转回欧拉角
  const newEuler = new Euler().setFromQuaternion(qNew, 'ZYX')

  return {
    x: newPos.x,
    y: newPos.y,
    z: newPos.z,
    Roll: MathUtils.radToDeg(newEuler.x),
    Pitch: MathUtils.radToDeg(newEuler.y),
    Yaw: MathUtils.radToDeg(newEuler.z),
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

      // 使用新算法计算变换
      const result = calculateNewTransform(item, center, rotation || {}, positionOffset)

      return {
        ...item,
        x: result.x,
        y: result.y,
        z: result.z,
        originalData: {
          ...item.originalData,
          Location: {
            ...item.originalData.Location,
            X: result.x,
            Y: result.y,
            Z: result.z,
          },
          Rotation: {
            Roll: result.Roll,
            Pitch: result.Pitch,
            Yaw: result.Yaw,
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
