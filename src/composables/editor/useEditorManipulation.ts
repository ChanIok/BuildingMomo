import { storeToRefs } from 'pinia'
import { Vector3, Quaternion, Euler, MathUtils, Matrix4 } from 'three'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGameDataStore } from '../../stores/gameDataStore'
import { calculateBounds } from '../../lib/geometry'
import { applyTransformToItems } from '../../lib/itemTransform'
import { useEditorHistory } from './useEditorHistory'
import type { TransformParams } from '../../types/editor'
import type { AppItem } from '../../types/editor'
import { matrixTransform } from '../../lib/matrixTransform'
import {
  convertRotationGlobalToWorking,
  convertRotationWorkingToGlobal,
} from '../../lib/coordinateTransform'

export function useEditorManipulation() {
  const store = useEditorStore()
  const uiStore = useUIStore()
  const settingsStore = useSettingsStore()
  const gameDataStore = useGameDataStore()
  const { activeScheme } = storeToRefs(store)
  const { saveHistory } = useEditorHistory()

  /**
   * 获取选中物品的中心坐标（包围盒中心）
   * 算法：(Min + Max) / 2
   */
  function getSelectedItemsCenter(): { x: number; y: number; z: number } | null {
    const scheme = activeScheme.value
    if (!scheme) return null
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return null

    const list = scheme.items.value
    const selectedItems = list.filter((item) => selectedIds.has(item.internalId))

    const bounds = calculateBounds(selectedItems)
    if (!bounds) return null

    return {
      x: bounds.centerX,
      y: bounds.centerY,
      z: bounds.centerZ,
    }
  }

  /**
   * 获取旋转中心：优先级：定点旋转 > 组合原点 > 几何中心
   */
  function getRotationCenter(): { x: number; y: number; z: number } | null {
    // 优先级 1: 定点旋转
    if (uiStore.customPivotEnabled && uiStore.customPivotPosition) {
      return uiStore.customPivotPosition
    }

    // 优先级 2: 组合原点
    const scheme = activeScheme.value
    if (scheme) {
      const selectedIds = scheme.selectedItemIds.value
      const groupId = store.getGroupIdIfEntireGroupSelected(selectedIds)
      if (groupId !== null) {
        const originItemId = scheme.groupOrigins.value.get(groupId)
        if (originItemId) {
          const originItem = store.itemsMap.get(originItemId)
          if (originItem) {
            return { x: originItem.x, y: originItem.y, z: originItem.z }
          }
        }
      }
    }

    // 优先级 3: 几何中心
    return getSelectedItemsCenter()
  }

  // 删除选中物品
  function deleteSelected() {
    if (!activeScheme.value) return

    saveHistory('edit')

    activeScheme.value.items.value = activeScheme.value.items.value.filter(
      (item) => !activeScheme.value!.selectedItemIds.value.has(item.internalId)
    )
    activeScheme.value.selectedItemIds.value.clear()

    store.triggerSceneUpdate()
    store.triggerSelectionUpdate()
  }

  // 精确变换选中物品（位置、旋转和缩放）
  function updateSelectedItemsTransform(params: TransformParams) {
    if (!activeScheme.value) return

    saveHistory('edit')

    const scheme = activeScheme.value
    const ids = scheme.selectedItemIds.value
    if (ids.size === 0) return

    // 计算旋转中心（支持定点旋转）
    const rotationCenter = getRotationCenter()
    if (!rotationCenter) return

    // 位置参考点：组合原点 > 几何中心（与显示端保持一致，但不受定点旋转影响）
    let positionReferencePoint: { x: number; y: number; z: number } | null = null

    // 优先级 1: 组合原点
    const groupId = store.getGroupIdIfEntireGroupSelected(ids)
    if (groupId !== null) {
      const originItemId = scheme.groupOrigins.value.get(groupId)
      if (originItemId) {
        const originItem = store.itemsMap.get(originItemId)
        if (originItem) {
          positionReferencePoint = { x: originItem.x, y: originItem.y, z: originItem.z }
        }
      }
    }

    // 优先级 2: 几何中心
    if (!positionReferencePoint) {
      positionReferencePoint = getSelectedItemsCenter() || rotationCenter
    }

    // 这里统一走共享变换核心，确保手动编辑与高级粘贴的数学保持完全一致。
    const selectedItems = scheme.items.value.filter((item) => ids.has(item.internalId))
    const effectiveWorkingRotation = uiStore.getEffectiveCoordinateRotation(
      ids,
      store.itemsMap
    ) || { x: 0, y: 0, z: 0 }

    const transformedItems = applyTransformToItems(selectedItems, params, {
      rotationCenter,
      positionReferencePoint,
      effectiveWorkingRotation,
      limitScaleValues: settingsStore.settings.enableLimitDetection,
      getScaleRange: (gameId) => gameDataStore.getFurniture(gameId)?.scaleRange ?? null,
    })
    const transformedMap = new Map(transformedItems.map((item) => [item.internalId, item]))

    // 注意：使用 ShallowRef 后，map 返回新数组会直接触发更新。
    activeScheme.value.items.value = activeScheme.value.items.value.map(
      (item) => transformedMap.get(item.internalId) ?? item
    )

    // 显式触发更新 (虽然直接赋值 .value = mapResult 也会触发，但保持一致性)
    store.triggerSceneUpdate()
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

    // 优化：如果只是移动，可以直接修改对象属性，然后 triggerRef，避免 map 创建新数组
    // 对于高性能移动（如拖拽中），这是关键
    // 但 moveSelectedItems 目前主要用于"完成后的提交"或"步进移动"
    // 为了撤销/重做系统的简单性（它依赖不可变性或快照），这里如果修改原对象，需要确保 History 存的是拷贝

    // 这里我们采用：原地修改 + triggerRef 模式，以获得最佳性能
    // 注意：useEditorHistory.ts 中的 cloneItems 需要正确处理这种情况（深拷贝或浅拷贝+Extra引用）

    const list = activeScheme.value.items.value
    const selected = activeScheme.value.selectedItemIds.value

    for (const item of list) {
      if (selected.has(item.internalId)) {
        item.x += dx
        item.y += dy
        item.z += dz
      }
    }

    // 必须手动触发更新
    store.triggerSceneUpdate()
  }

  /**
   * 镜像选中物品（沿指定轴镜像）
   *
   * 支持工作坐标系：当工作坐标系启用时，沿工作坐标系的轴镜像
   *
   * @param axis - 镜像轴 ('x' | 'y' | 'z')
   */
  function mirrorSelectedItems(axis: 'x' | 'y' | 'z') {
    if (!activeScheme.value) return

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return

    saveHistory('edit')

    // 获取旋转/镜像中心（支持定点旋转）
    const globalCenter = getRotationCenter()
    if (!globalCenter) return

    // 使用 uiStore 的统一方法获取有效的坐标系旋转（视觉空间）
    const effectiveWorkingRotation = uiStore.getEffectiveCoordinateRotation(
      selectedIds,
      store.itemsMap
    ) || { x: 0, y: 0, z: 0 }

    // 直接使用视觉空间的旋转值
    // convertPosition* 和 convertRotation* 函数内部已经对 Z 轴做了正确的取反处理（与 Gizmo 一致）

    // 使用 uiStore 统一 API 转换：数据空间 -> 工作坐标系
    // 注意：镜像需要世界空间语义的 workingCenter，所以这里手动处理
    const worldCenter = matrixTransform.dataPositionToWorld(globalCenter)
    const workingCenter = uiStore.worldToWorking(worldCenter)

    // 更新每个选中物品
    activeScheme.value.items.value = activeScheme.value.items.value.map((item) => {
      if (!selectedIds.has(item.internalId)) {
        return item
      }

      // === 1. 位置镜像 ===
      // 数据空间 -> 世界空间 -> 工作坐标系
      const worldPos = matrixTransform.dataPositionToWorld({ x: item.x, y: item.y, z: item.z })
      const workingPos = uiStore.worldToWorking(worldPos)

      // 沿指定轴镜像
      workingPos[axis] = 2 * workingCenter[axis] - workingPos[axis]

      // 工作坐标系 -> 世界空间 -> 数据空间
      const newWorldPos = uiStore.workingToWorld(workingPos)
      const newPos = matrixTransform.worldPositionToData(newWorldPos)

      // === 2. 旋转镜像（支持完整三轴）===
      let newRotation = { ...item.rotation }

      // 检查是否启用"同时镜像旋转"
      if (settingsStore.settings.mirrorWithRotation) {
        const hasEffectiveRotation =
          effectiveWorkingRotation.x !== 0 ||
          effectiveWorkingRotation.y !== 0 ||
          effectiveWorkingRotation.z !== 0

        if (hasEffectiveRotation) {
          // 1. 数据空间 → 视觉空间（convert* 函数期望视觉空间输入）
          const visualRotation = matrixTransform.dataRotationToVisual(item.rotation)

          // 2. 视觉空间/全局 → 视觉空间/工作坐标系
          const workingVisual = convertRotationGlobalToWorking(
            visualRotation,
            effectiveWorkingRotation
          )

          // 3. 视觉空间 → 数据空间（mirrorRotationInWorkingCoord 在数据空间工作）
          const workingData = matrixTransform.visualRotationToData(workingVisual)

          // 4. 在数据空间执行镜像
          const mirroredData = mirrorRotationInWorkingCoord(workingData, axis)

          // 5. 数据空间 → 视觉空间（convert* 函数期望视觉空间输入）
          const mirroredVisual = matrixTransform.dataRotationToVisual(mirroredData)

          // 6. 视觉空间/工作坐标系 → 视觉空间/全局
          const globalVisual = convertRotationWorkingToGlobal(
            mirroredVisual,
            effectiveWorkingRotation
          )

          // 7. 视觉空间 → 数据空间（存储到 item.rotation）
          newRotation = matrixTransform.visualRotationToData(globalVisual)
        } else {
          // 未启用工作坐标系，直接在全局坐标系中镜像
          newRotation = mirrorRotationInWorkingCoord(item.rotation, axis)
        }
      }
      // 否则：不修改旋转，newRotation 保持为 item.rotation

      return {
        ...item,
        x: newPos.x,
        y: newPos.y,
        z: newPos.z,
        rotation: newRotation,
      }
    })

    store.triggerSceneUpdate()
  }

  /**
   * 在工作坐标系中执行旋转镜像
   *
   * 使用镜像旋转公式：R' = M · R · D
   * - M: 世界空间反射矩阵（翻转指定坐标轴）
   * - R: 原始旋转矩阵
   * - D: 局部空间手性修正矩阵（使结果 det = +1，成为合法旋转）
   *
   * 这个公式直接在数据空间工作，不涉及渲染管线的 Roll/Pitch 取反和场景 Y 轴翻转。
   */
  function mirrorRotationInWorkingCoord(
    rotation: { x: number; y: number; z: number },
    axis: 'x' | 'y' | 'z'
  ): { x: number; y: number; z: number } {
    // 1. 原始旋转：Euler -> 旋转矩阵 R
    const euler = new Euler(
      MathUtils.degToRad(rotation.x), // Roll
      MathUtils.degToRad(rotation.y), // Pitch
      MathUtils.degToRad(rotation.z), // Yaw
      'ZYX'
    )
    const R = new Matrix4().makeRotationFromEuler(euler)

    // 2. 构建世界空间反射矩阵 M
    const M = new Matrix4()
    switch (axis) {
      case 'x':
        M.makeScale(-1, 1, 1) // 翻转 X 轴
        break
      case 'y':
        M.makeScale(1, -1, 1) // 翻转 Y 轴
        break
      case 'z':
        M.makeScale(1, 1, -1) // 翻转 Z 轴
        break
    }

    // 3. 构建局部空间手性修正矩阵 D
    // 目的：使 det(M·R·D) = +1，恢复为合法旋转
    // 三种镜像统一使用 diag(1, -1, 1)，翻转局部 Y 轴
    const D = new Matrix4().makeScale(1, -1, 1)

    // 4. 应用镜像公式：R' = M · R · D
    const Rp = new Matrix4().multiplyMatrices(M, R).multiply(D)

    // 5. 提取旋转部分并转回 Euler
    const pos = new Vector3()
    const quat = new Quaternion()
    const scale = new Vector3()
    Rp.decompose(pos, quat, scale)

    const newEuler = new Euler().setFromQuaternion(quat, 'ZYX')

    return {
      x: MathUtils.radToDeg(newEuler.x), // Roll
      y: MathUtils.radToDeg(newEuler.y), // Pitch
      z: MathUtils.radToDeg(newEuler.z), // Yaw
    }
  }

  /**
   * 以原点物品为基准旋转组合（绝对模式）
   *
   * - 原点物品：直接设置为目标绝对旋转
   * - 其他物品：以原点位置为中心，应用原点物品的实际旋转变换
   *
   * 算法：使用四元数计算原点物品从当前旋转到目标旋转的实际变换，
   * 而不是简单的欧拉角差值（欧拉角差值 ≠ 实际旋转增量）
   *
   * @param originItemId 原点物品 ID
   * @param axis 旋转轴
   * @param absoluteValue 目标绝对值（工作坐标系下）
   */
  function rotateSelectionAroundOrigin(
    originItemId: string,
    axis: 'x' | 'y' | 'z',
    absoluteValue: number
  ) {
    if (!activeScheme.value) return

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return

    // 获取原点物品
    const originItem = store.itemsMap.get(originItemId)
    if (!originItem) return

    saveHistory('edit')

    // 获取有效的工作坐标系旋转
    const effectiveWorkingRotation = uiStore.getEffectiveCoordinateRotation(
      selectedIds,
      store.itemsMap
    ) || { x: 0, y: 0, z: 0 }

    // 获取原点物品当前旋转（视觉空间）
    const originVisualRotation = matrixTransform.dataRotationToVisual({
      x: originItem.rotation.x,
      y: originItem.rotation.y,
      z: originItem.rotation.z,
    })

    // 转换到工作坐标系
    const originWorkingRotation = convertRotationGlobalToWorking(
      originVisualRotation,
      effectiveWorkingRotation
    )

    // 检查是否有变化
    const deltaAngle = absoluteValue - originWorkingRotation[axis]
    if (Math.abs(deltaAngle) < 0.0001) return // 无变化

    // 构建原点物品的目标旋转（工作坐标系下）
    const targetWorkingRotation = { ...originWorkingRotation }
    targetWorkingRotation[axis] = absoluteValue

    // 转换为全局旋转（视觉空间）
    const targetGlobalRotation = convertRotationWorkingToGlobal(
      targetWorkingRotation,
      effectiveWorkingRotation
    )

    // 转换为数据空间
    const targetDataRotation = matrixTransform.visualRotationToData(targetGlobalRotation)

    // === 使用四元数计算实际旋转变换 ===
    // 原点物品当前旋转的四元数（从世界矩阵提取，确保与渲染一致）
    const currentMatrix = matrixTransform.buildWorldMatrixFromItem(originItem, false)
    const currentQuat = new Quaternion()
    currentMatrix.decompose(new Vector3(), currentQuat, new Vector3())

    // 原点物品目标旋转的四元数
    // 构建一个临时物品来获取目标世界矩阵
    const targetItem = { ...originItem, rotation: targetDataRotation }
    const targetMatrix = matrixTransform.buildWorldMatrixFromItem(targetItem, false)
    const targetQuat = new Quaternion()
    targetMatrix.decompose(new Vector3(), targetQuat, new Vector3())

    // 计算增量旋转：Q_delta = Q_target * Q_current^(-1)
    const deltaQuat = targetQuat.clone().multiply(currentQuat.clone().invert())

    // 原点物品的位置（作为旋转中心，世界空间）
    const centerWorld = matrixTransform.dataPositionToWorld({
      x: originItem.x,
      y: originItem.y,
      z: originItem.z,
    })
    const centerVec = new Vector3(centerWorld.x, centerWorld.y, centerWorld.z)

    // 构建增量旋转矩阵
    const deltaRotationMatrix = new Matrix4().makeRotationFromQuaternion(deltaQuat)

    // 分离原点物品和其他物品
    const otherItems = scheme.items.value.filter(
      (item) => selectedIds.has(item.internalId) && item.internalId !== originItemId
    )

    // 对其他物品应用四元数旋转变换（以原点为中心）
    const rotatedOtherItems = otherItems.map((item) => {
      // 获取物品当前的世界矩阵
      const itemMatrix = matrixTransform.buildWorldMatrixFromItem(item, false)

      // 提取当前位置
      const itemPos = new Vector3().setFromMatrixPosition(itemMatrix)

      // 计算相对于旋转中心的位置
      const relativePos = itemPos.clone().sub(centerVec)

      // 旋转相对位置（公转）
      relativePos.applyMatrix4(deltaRotationMatrix)

      // 计算新位置
      const newPos = centerVec.clone().add(relativePos)

      // 应用旋转到物品本身（自转）
      const newMatrix = deltaRotationMatrix.clone().multiply(itemMatrix)
      newMatrix.setPosition(newPos)

      // 还原为游戏数据
      const newData = matrixTransform.extractItemDataFromWorldMatrix(newMatrix)

      return {
        ...item,
        x: newData.x,
        y: newData.y,
        z: newData.z,
        rotation: newData.rotation,
      }
    })

    // 构建更新后的物品映射
    const updatedItemsMap = new Map<string, AppItem>()
    for (const item of rotatedOtherItems) {
      updatedItemsMap.set(item.internalId, item)
    }

    // 更新所有物品
    scheme.items.value = scheme.items.value.map((item) => {
      if (!selectedIds.has(item.internalId)) {
        return item
      }

      if (item.internalId === originItemId) {
        // 原点物品：直接设置绝对旋转
        return {
          ...item,
          rotation: targetDataRotation,
        }
      }

      // 其他物品：使用旋转后的结果
      const rotatedItem = updatedItemsMap.get(item.internalId)
      if (rotatedItem) {
        return rotatedItem
      }

      return item
    })

    store.triggerSceneUpdate()
  }

  /**
   * 多选绝对旋转（工作坐标系语义）
   *
   * 对每个选中物品执行：
   * 1. 数据空间 -> 视觉空间
   * 2. 全局旋转 -> 工作坐标系旋转（如有有效坐标系）
   * 3. 设置目标轴绝对值
   * 4. 工作坐标系旋转 -> 全局旋转（如有有效坐标系）
   * 5. 视觉空间 -> 数据空间并写回
   */
  function setSelectedItemsAbsoluteRotationInWorking(axis: 'x' | 'y' | 'z', absoluteValue: number) {
    if (!activeScheme.value) return

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return

    saveHistory('edit')

    const effectiveWorkingRotation = uiStore.getEffectiveCoordinateRotation(
      selectedIds,
      store.itemsMap
    )

    scheme.items.value = scheme.items.value.map((item) => {
      if (!selectedIds.has(item.internalId)) {
        return item
      }

      // 当前物品旋转：数据空间 -> 视觉空间
      const globalVisualRotation = matrixTransform.dataRotationToVisual(item.rotation)

      // 转到工作坐标系（若无有效坐标系则直接用全局）
      const workingVisualRotation = effectiveWorkingRotation
        ? convertRotationGlobalToWorking(globalVisualRotation, effectiveWorkingRotation)
        : globalVisualRotation

      // 设置目标轴的绝对值
      const targetWorkingVisualRotation = {
        ...workingVisualRotation,
        [axis]: absoluteValue,
      }

      // 转回全局旋转（视觉空间）
      const targetGlobalVisualRotation = effectiveWorkingRotation
        ? convertRotationWorkingToGlobal(targetWorkingVisualRotation, effectiveWorkingRotation)
        : targetWorkingVisualRotation

      // 写回数据空间
      const targetDataRotation = matrixTransform.visualRotationToData(targetGlobalVisualRotation)

      return {
        ...item,
        rotation: targetDataRotation,
      }
    })

    store.triggerSceneUpdate()
  }

  // 批量提交变换（优化性能，用于 Gizmo 拖拽结束）
  function commitBatchedTransform(
    items: {
      id: string
      x: number
      y: number
      z: number
      rotation: { x: number; y: number; z: number }
    }[],
    options: { saveHistory?: boolean } = { saveHistory: true }
  ) {
    if (!activeScheme.value) return

    if (options.saveHistory) {
      saveHistory('edit')
    }

    const itemMap = store.itemsMap
    for (const update of items) {
      const item = itemMap.get(update.id)
      if (item) {
        item.x = update.x
        item.y = update.y
        item.z = update.z
        item.rotation = update.rotation
      }
    }

    store.triggerSceneUpdate()
  }

  return {
    getSelectedItemsCenter,
    getRotationCenter,
    deleteSelected,
    updateSelectedItemsTransform,
    moveSelectedItems,
    mirrorSelectedItems,
    rotateSelectionAroundOrigin,
    setSelectedItemsAbsoluteRotationInWorking,
    commitBatchedTransform,
  }
}
