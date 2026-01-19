import { storeToRefs } from 'pinia'
import { Vector3, Quaternion, Euler, MathUtils, Matrix4 } from 'three'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGameDataStore } from '../../stores/gameDataStore'
import { calculateBounds } from '../../lib/geometry'
import { useEditorHistory } from './useEditorHistory'
import type { TransformParams } from '../../types/editor'
import type { AppItem } from '../../types/editor'
import { matrixTransform } from '../../lib/matrixTransform'
import { transformOBBByMatrix, getOBBFromMatrixAndModelBox } from '../../lib/collision'
import { getThreeModelManager } from '../useThreeModelManager'
import {
  rotateItemsInWorkingCoordinate,
  extractSingleAxisRotation,
} from '../../lib/rotationTransform'
import {
  convertPositionGlobalToWorking,
  convertPositionWorkingToGlobal,
  convertRotationGlobalToWorking,
  convertRotationWorkingToGlobal,
} from '../../lib/coordinateTransform'

/**
 * 应用位置偏移（纯位置变换，不涉及旋转）
 */
function applyPositionOffset(
  item: AppItem,
  positionOffset: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return {
    x: item.x + positionOffset.x,
    y: item.y + positionOffset.y,
    z: item.z + positionOffset.z,
  }
}

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
   * 检查当前选区是否完整选中了某个组的所有成员
   * @param selectedIds 选中的物品 ID 集合
   * @returns 组 ID，如果不是完整组选择则返回 null
   */
  function getGroupIdIfEntireGroupSelected(selectedIds: Set<string>): number | null {
    if (selectedIds.size === 0) return null

    // 收集选中物品的组 ID
    const groupIds = new Set<number>()
    selectedIds.forEach((id) => {
      const item = store.itemsMap.get(id)
      if (item && item.groupId > 0) {
        groupIds.add(item.groupId)
      }
    })

    // 必须所有选中物品都属于同一个组
    if (groupIds.size !== 1) return null

    const groupId = Array.from(groupIds)[0]!
    const groupMemberIds = store.groupsMap.get(groupId)

    // 检查是否选中了组的所有成员
    if (!groupMemberIds || groupMemberIds.size !== selectedIds.size) return null

    for (const memberId of groupMemberIds) {
      if (!selectedIds.has(memberId)) return null
    }

    return groupId
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
      const groupId = getGroupIdIfEntireGroupSelected(selectedIds)
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

    const { mode, position, rotation, scale } = params
    const scheme = activeScheme.value
    const ids = scheme.selectedItemIds.value
    if (ids.size === 0) return

    // 计算旋转中心（支持定点旋转）
    const center = getRotationCenter()
    if (!center) return

    // 使用旋转中心作为位置参考点
    const referencePoint = center

    // 计算位置偏移量
    let positionOffset = { x: 0, y: 0, z: 0 }

    if (mode === 'absolute' && position) {
      // 绝对模式：移动到指定坐标
      positionOffset = {
        x: (position.x ?? referencePoint.x) - referencePoint.x,
        y: (position.y ?? referencePoint.y) - referencePoint.y,
        z: (position.z ?? referencePoint.z) - referencePoint.z,
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
    // 注意：使用 ShallowRef 后，map 返回新数组会直接触发更新
    activeScheme.value.items.value = activeScheme.value.items.value.map((item) => {
      if (!activeScheme.value!.selectedItemIds.value.has(item.internalId)) {
        return item
      }

      // 处理缩放（独立于位置和旋转）
      let newScale = item.extra.Scale || { X: 1, Y: 1, Z: 1 }
      let scalePositionOffset = { x: 0, y: 0, z: 0 } // 缩放导致的位置偏移（多选整体缩放）

      if (scale) {
        const isLimitEnabled = settingsStore.settings.enableLimitDetection

        if (mode === 'absolute') {
          // 绝对模式：直接设置缩放值
          newScale = {
            X: scale.x !== undefined ? scale.x : newScale.X,
            Y: scale.y !== undefined ? scale.y : newScale.Y,
            Z: scale.z !== undefined ? scale.z : newScale.Z,
          }

          // 应用范围限制
          if (isLimitEnabled) {
            const furniture = gameDataStore.getFurniture(item.gameId)
            if (furniture) {
              const [min, max] = furniture.scaleRange
              newScale.X = Math.max(min, Math.min(max, newScale.X))
              newScale.Y = Math.max(min, Math.min(max, newScale.Y))
              newScale.Z = Math.max(min, Math.min(max, newScale.Z))
            }
          }
        } else {
          // 相对模式：简单的局部空间缩放（直接乘以倍数）
          const scaleMultiplier = {
            x: scale.x ?? 1,
            y: scale.y ?? 1,
            z: scale.z ?? 1,
          }

          newScale = {
            X: newScale.X * scaleMultiplier.x,
            Y: newScale.Y * scaleMultiplier.y,
            Z: newScale.Z * scaleMultiplier.z,
          }

          // 应用范围限制
          if (isLimitEnabled) {
            const furniture = gameDataStore.getFurniture(item.gameId)
            if (furniture) {
              const [min, max] = furniture.scaleRange
              newScale.X = Math.max(min, Math.min(max, newScale.X))
              newScale.Y = Math.max(min, Math.min(max, newScale.Y))
              newScale.Z = Math.max(min, Math.min(max, newScale.Z))
            }
          }

          // 多选时：实现整体缩放，同步调整物品相对于中心的位置
          if (ids.size > 1) {
            const relativeX = item.x - center.x
            const relativeY = item.y - center.y
            const relativeZ = item.z - center.z

            // 注意：游戏坐标系映射（Scale.X 实际控制南北，Scale.Y 实际控制东西）
            scalePositionOffset = {
              x: relativeX * (scaleMultiplier.y - 1),
              y: relativeY * (scaleMultiplier.x - 1),
              z: relativeZ * (scaleMultiplier.z - 1),
            }
          }
        }
      }

      // 处理绝对旋转模式 (仅更新旋转，位置不变)
      if (mode === 'absolute' && rotation) {
        const newRotation = {
          x: rotation.x ?? item.rotation.x ?? 0,
          y: rotation.y ?? item.rotation.y ?? 0,
          z: rotation.z ?? item.rotation.z ?? 0,
        }

        // 如果同时也传入了绝对位置更新
        let newX = item.x
        let newY = item.y
        let newZ = item.z

        if (position) {
          // 如果是绝对位置模式，直接应用位置偏移
          newX += positionOffset.x
          newY += positionOffset.y
          newZ += positionOffset.z
        }

        // 应用缩放导致的位置偏移（整体缩放）
        newX += scalePositionOffset.x
        newY += scalePositionOffset.y
        newZ += scalePositionOffset.z

        return {
          ...item,
          x: newX,
          y: newY,
          z: newZ,
          rotation: newRotation,
          extra: {
            ...item.extra,
            Scale: newScale,
          },
        }
      }

      // 相对模式：检查是否有旋转，且需要在工作坐标系下处理
      if (mode === 'relative' && rotation) {
        const rotationInfo = extractSingleAxisRotation(rotation)
        if (rotationInfo) {
          // 使用 uiStore 的统一方法获取有效的工作坐标系旋转（视觉空间）
          const effectiveWorkingRotation = uiStore.getEffectiveCoordinateRotation(
            ids,
            store.itemsMap
          ) || { x: 0, y: 0, z: 0 }

          // 转换为数据空间（与工作坐标系处理一致）
          const dataSpaceRotation = matrixTransform.visualRotationToUI(effectiveWorkingRotation)

          // 使用新的工作坐标系旋转函数（单物品情况）
          // 注意：这里临时使用单物品数组调用，后续会在外层优化为批量处理
          const rotatedItems = rotateItemsInWorkingCoordinate(
            [item],
            rotationInfo.axis,
            rotationInfo.angle,
            center,
            dataSpaceRotation, // 使用数据空间的旋转值
            false // 暂不使用模型缩放（box 模式）
          )
          const rotatedItem = rotatedItems[0]

          // 应用位置偏移和缩放偏移
          if (rotatedItem) {
            return {
              ...rotatedItem,
              x: rotatedItem.x + positionOffset.x + scalePositionOffset.x,
              y: rotatedItem.y + positionOffset.y + scalePositionOffset.y,
              z: rotatedItem.z + positionOffset.z + scalePositionOffset.z,
              extra: {
                ...item.extra,
                Scale: newScale,
              },
            }
          }
        }
      }

      // 相对模式无旋转，仅应用位置偏移
      const newPos = applyPositionOffset(item, positionOffset)

      return {
        ...item,
        x: newPos.x + scalePositionOffset.x,
        y: newPos.y + scalePositionOffset.y,
        z: newPos.z + scalePositionOffset.z,
        // 旋转保持不变
        extra: {
          ...item.extra,
          Scale: newScale,
        },
      }
    })

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

    // 转换为数据空间（与工作坐标系处理一致）
    const dataSpaceRotation = matrixTransform.visualRotationToUI(effectiveWorkingRotation)

    // 转换到有效坐标系
    const workingCenter = convertPositionGlobalToWorking(globalCenter, dataSpaceRotation)

    // 更新每个选中物品
    activeScheme.value.items.value = activeScheme.value.items.value.map((item) => {
      if (!selectedIds.has(item.internalId)) {
        return item
      }

      // === 1. 位置镜像 ===
      // 转换到有效坐标系
      const workingPos = convertPositionGlobalToWorking(
        { x: item.x, y: item.y, z: item.z },
        dataSpaceRotation
      )

      // 沿指定轴镜像
      workingPos[axis] = 2 * workingCenter[axis] - workingPos[axis]

      // 转换回全局坐标系
      const newPos = convertPositionWorkingToGlobal(workingPos, dataSpaceRotation)

      // === 2. 旋转镜像（支持完整三轴）===
      let newRotation = { ...item.rotation }

      // 检查是否启用"同时镜像旋转"
      if (settingsStore.settings.mirrorWithRotation) {
        const hasEffectiveRotation =
          effectiveWorkingRotation.x !== 0 ||
          effectiveWorkingRotation.y !== 0 ||
          effectiveWorkingRotation.z !== 0

        if (hasEffectiveRotation) {
          // 转换到工作坐标系
          const workingRotation = convertRotationGlobalToWorking(item.rotation, dataSpaceRotation)

          // 在工作坐标系中执行镜像
          const mirroredWorking = mirrorRotationInWorkingCoord(workingRotation, axis)

          // 转回全局坐标系
          newRotation = convertRotationWorkingToGlobal(mirroredWorking, dataSpaceRotation)
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
   * 对齐单元：用于组合感知的对齐/分布操作
   * 可以是单个物品，也可以是整个组
   */
  interface AlignUnit {
    type: 'single' | 'group'
    groupId: number | null
    items: AppItem[] // 单个物品或组内所有成员
  }

  /**
   * 按组聚合选中物品，构建对齐单元
   *
   * 策略：任一成员选中 → 整组参与
   * - 如果选中的物品属于某个组，将整个组作为一个单元
   * - 未成组的物品各自独立为一个单元
   *
   * @param selectedIds 选中的物品ID集合
   * @returns 对齐单元数组
   */
  function buildAlignUnits(selectedIds: Set<string>): AlignUnit[] {
    const processedGroups = new Set<number>()
    const units: AlignUnit[] = []

    for (const itemId of selectedIds) {
      const item = store.itemsMap.get(itemId)
      if (!item) continue

      if (item.groupId > 0) {
        // 有组的物品 → 整组作为一个单元（避免重复处理）
        if (processedGroups.has(item.groupId)) continue
        processedGroups.add(item.groupId)

        // 获取组内所有物品（不仅仅是选中的）
        const groupMemberIds = store.groupsMap.get(item.groupId)
        if (!groupMemberIds) continue

        const allGroupMembers: AppItem[] = []
        groupMemberIds.forEach((memberId) => {
          const member = store.itemsMap.get(memberId)
          if (member) allGroupMembers.push(member)
        })

        units.push({
          type: 'group',
          groupId: item.groupId,
          items: allGroupMembers,
        })
      } else {
        // 未成组的独立物品
        units.push({
          type: 'single',
          groupId: null,
          items: [item],
        })
      }
    }

    return units
  }

  /**
   * 对齐选中物品（沿指定轴对齐到最小值/中心/最大值）
   *
   * 根据渲染模式使用不同的对齐策略：
   * - Box / Model 模式：使用包围盒边界进行对齐
   * - Simple-box / Icon 模式：使用中心点进行对齐
   *
   * 支持工作坐标系：当工作坐标系启用时，在工作坐标系下进行对齐
   * 支持组合：选中的物品如果属于组，整个组作为一个单元参与对齐
   *
   * @param axis - 对齐轴 ('x' | 'y' | 'z')
   * @param mode - 对齐模式 ('min' | 'center' | 'max')
   */
  function alignSelectedItems(axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max') {
    if (!activeScheme.value) return

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size < 2) return // 至少需要2个物品

    saveHistory('edit')

    const currentMode = settingsStore.settings.threeDisplayMode

    // 快速路径：simple-box / icon 模式使用中心点对齐
    if (currentMode === 'simple-box' || currentMode === 'icon') {
      alignByCenterPoint(selectedIds, axis, mode)
      return
    }

    // Box / Model 模式：使用包围盒对齐
    alignByBoundingBox(selectedIds, axis, mode)
  }

  /**
   * 使用中心点进行对齐（用于 simple-box / icon 模式）
   */
  function alignByCenterPoint(
    selectedIds: Set<string>,
    axis: 'x' | 'y' | 'z',
    mode: 'min' | 'center' | 'max'
  ) {
    const scheme = activeScheme.value
    if (!scheme) return

    // 按组聚合选中物品
    const alignUnits = buildAlignUnits(selectedIds)

    // 为每个对齐单元计算中心点（工作坐标系）
    const unitCenters = alignUnits.map((unit) => {
      // 计算单元的中心（所有成员的平均位置）
      const sum = { x: 0, y: 0, z: 0 }
      unit.items.forEach((item) => {
        sum.x += item.x
        sum.y += item.y
        sum.z += item.z
      })

      const globalCenter = {
        x: sum.x / unit.items.length,
        y: sum.y / unit.items.length,
        z: sum.z / unit.items.length,
      }

      const workingCenter = uiStore.workingCoordinateSystem.enabled
        ? uiStore.globalToWorking(globalCenter)
        : globalCenter

      return { unit, workingCenter }
    })

    // 计算对齐目标位置
    const axisValues = unitCenters.map((uc) => uc.workingCenter[axis])
    let targetValue: number

    switch (mode) {
      case 'min':
        targetValue = Math.min(...axisValues)
        break
      case 'center':
        targetValue = (Math.min(...axisValues) + Math.max(...axisValues)) / 2
        break
      case 'max':
        targetValue = Math.max(...axisValues)
        break
    }

    // 为每个单元计算位移增量
    const unitDeltas = new Map<AlignUnit, { x: number; y: number; z: number }>()

    unitCenters.forEach(({ unit, workingCenter }) => {
      const delta = targetValue - workingCenter[axis]

      // 构造工作坐标系下的位移向量
      const workingDelta = { x: 0, y: 0, z: 0 }
      workingDelta[axis] = delta

      // 转换回全局坐标系
      const globalDelta = uiStore.workingCoordinateSystem.enabled
        ? uiStore.workingToGlobal(workingDelta)
        : workingDelta

      unitDeltas.set(unit, globalDelta)
    })

    // 应用位移到所有物品
    scheme.items.value = scheme.items.value.map((item) => {
      // 找到该物品所属的对齐单元
      const unit = alignUnits.find((u) => u.items.some((i) => i.internalId === item.internalId))
      if (!unit) return item

      const delta = unitDeltas.get(unit)
      if (!delta) return item

      return {
        ...item,
        x: item.x + delta.x,
        y: item.y + delta.y,
        z: item.z + delta.z,
      }
    })

    store.triggerSceneUpdate()
  }

  /**
   * 使用包围盒进行对齐（用于 box / model 模式）
   */
  function alignByBoundingBox(
    selectedIds: Set<string>,
    axis: 'x' | 'y' | 'z',
    mode: 'min' | 'center' | 'max'
  ) {
    const scheme = activeScheme.value
    if (!scheme) return

    const currentMode = settingsStore.settings.threeDisplayMode
    const modelManager = getThreeModelManager()

    // 按组聚合选中物品
    const alignUnits = buildAlignUnits(selectedIds)

    // 计算对齐轴在世界空间中的方向向量
    const alignAxisVector = new Vector3()
    if (axis === 'x') {
      alignAxisVector.set(1, 0, 0)
    } else if (axis === 'y') {
      alignAxisVector.set(0, 1, 0)
    } else {
      alignAxisVector.set(0, 0, 1)
    }

    // 如果启用了工作坐标系，旋转对齐轴向量（支持完整三轴）
    if (uiStore.workingCoordinateSystem.enabled) {
      // 将工作坐标系旋转从视觉空间转换回数据空间
      const workingDataRotation = matrixTransform.visualRotationToUI(
        uiStore.workingCoordinateSystem.rotation
      )
      const euler = new Euler(
        (workingDataRotation.x * Math.PI) / 180,
        (workingDataRotation.y * Math.PI) / 180,
        -(workingDataRotation.z * Math.PI) / 180, // 与 coordinateTransform 一致
        'ZYX'
      )
      alignAxisVector.applyEuler(euler)
    }

    // 为每个对齐单元计算包围盒投影
    interface UnitProjection {
      unit: AlignUnit
      projMin: number
      projMax: number
      projCenter: number
    }

    const unitProjections: UnitProjection[] = []

    for (const unit of alignUnits) {
      // 收集单元内所有物品的 OBB
      const obbs: any[] = []

      for (const item of unit.items) {
        // 1. 先判断是否真的有可用的模型配置
        const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
        const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
        const useModelScale = !!(currentMode === 'model' && hasValidModel)

        // 2. 构建世界矩阵
        const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)

        // 3. 根据 useModelScale 决定 OBB 计算方式
        let obb

        if (useModelScale) {
          // 真正的 Model 模式：matrix 不含尺寸，需要从 modelBox 获取
          const modelBox = modelManager.getModelBoundingBox(item.gameId)
          if (modelBox) {
            obb = getOBBFromMatrixAndModelBox(matrix, modelBox)
          } else {
            console.warn(`Model ${item.gameId} has valid config but no bounding box`)
            obb = transformOBBByMatrix(matrix, new Vector3(1, 1, 1), new Vector3())
          }
        } else {
          // Box 模式 或 Model Fallback：matrix 已包含完整尺寸
          obb = transformOBBByMatrix(matrix, new Vector3(1, 1, 1), new Vector3())
        }

        obbs.push(obb)
      }

      // 合并单元内所有 OBB 的角点，计算在对齐轴上的投影范围
      let projMin = Infinity
      let projMax = -Infinity

      for (const obb of obbs) {
        const corners = obb.getCorners()
        for (const corner of corners) {
          const projection = corner.dot(alignAxisVector)
          projMin = Math.min(projMin, projection)
          projMax = Math.max(projMax, projection)
        }
      }

      const projCenter = (projMin + projMax) / 2

      unitProjections.push({
        unit,
        projMin,
        projMax,
        projCenter,
      })
    }

    // 6. 计算目标对齐值
    // Y轴特殊处理：由于渲染时使用 Scale(1, -1, 1) 翻转了Y轴
    // 需要反转min/max逻辑以符合用户的视觉预期
    const shouldInvert = axis === 'y'
    let targetValue: number

    if (mode === 'min') {
      if (shouldInvert) {
        targetValue = Math.max(...unitProjections.map((p) => p.projMax))
      } else {
        targetValue = Math.min(...unitProjections.map((p) => p.projMin))
      }
    } else if (mode === 'center') {
      const allMin = Math.min(...unitProjections.map((p) => p.projMin))
      const allMax = Math.max(...unitProjections.map((p) => p.projMax))
      targetValue = (allMin + allMax) / 2
    } else {
      // max
      if (shouldInvert) {
        targetValue = Math.min(...unitProjections.map((p) => p.projMin))
      } else {
        targetValue = Math.max(...unitProjections.map((p) => p.projMax))
      }
    }

    // 7. 为每个单元计算位移增量
    const unitDeltas = new Map<AlignUnit, { x: number; y: number; z: number }>()

    for (const proj of unitProjections) {
      // 计算需要移动的距离
      // Y轴反转时，min对应projMax，max对应projMin
      let delta: number
      if (mode === 'min') {
        delta = shouldInvert ? targetValue - proj.projMax : targetValue - proj.projMin
      } else if (mode === 'center') {
        delta = targetValue - proj.projCenter
      } else {
        // max
        delta = shouldInvert ? targetValue - proj.projMin : targetValue - proj.projMax
      }

      // 移动向量 = delta * alignAxisVector
      const moveVector = alignAxisVector.clone().multiplyScalar(delta)

      // 应用移动（moveVector 是在世界空间中，需要转换到数据空间）
      // 数据空间 = (x, y, z) 在渲染中被 Scale(1, -1, 1) 变换
      // 所以数据空间的增量 = (moveVector.x, -moveVector.y, moveVector.z)
      const dataDelta = {
        x: moveVector.x,
        y: -moveVector.y, // 注意 Y 轴翻转
        z: moveVector.z,
      }

      unitDeltas.set(proj.unit, dataDelta)
    }

    // 8. 应用位移到所有物品
    scheme.items.value = scheme.items.value.map((item) => {
      // 找到该物品所属的对齐单元
      const unit = alignUnits.find((u) => u.items.some((i) => i.internalId === item.internalId))
      if (!unit) return item

      const delta = unitDeltas.get(unit)
      if (!delta) return item

      return {
        ...item,
        x: item.x + delta.x,
        y: item.y + delta.y,
        z: item.z + delta.z,
      }
    })

    store.triggerSceneUpdate()
  }

  /**
   * 分布选中物品（沿指定轴均匀分布）
   *
   * 支持工作坐标系：当工作坐标系启用时，在工作坐标系下进行分布
   * 支持组合：选中的物品如果属于组，整个组作为一个单元参与分布
   *
   * @param axis - 分布轴 ('x' | 'y' | 'z')
   */
  function distributeSelectedItems(axis: 'x' | 'y' | 'z') {
    if (!activeScheme.value) return

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size < 3) return // 至少需要3个物品

    saveHistory('edit')

    // 按组聚合选中物品
    const alignUnits = buildAlignUnits(selectedIds)

    // 为每个对齐单元计算中心点（工作坐标系）
    const unitsWithCenter = alignUnits.map((unit) => {
      // 计算单元的中心（所有成员的平均位置）
      const sum = { x: 0, y: 0, z: 0 }
      unit.items.forEach((item) => {
        sum.x += item.x
        sum.y += item.y
        sum.z += item.z
      })

      const globalCenter = {
        x: sum.x / unit.items.length,
        y: sum.y / unit.items.length,
        z: sum.z / unit.items.length,
      }

      const workingCenter = uiStore.workingCoordinateSystem.enabled
        ? uiStore.globalToWorking(globalCenter)
        : globalCenter

      return { unit, workingCenter }
    })

    // 按指定轴排序
    unitsWithCenter.sort((a, b) => a.workingCenter[axis] - b.workingCenter[axis])

    // 计算首尾位置
    const firstUnit = unitsWithCenter[0]
    const lastUnit = unitsWithCenter[unitsWithCenter.length - 1]
    if (!firstUnit || !lastUnit) return // 安全检查

    const first = firstUnit.workingCenter[axis]
    const last = lastUnit.workingCenter[axis]
    const spacing = (last - first) / (unitsWithCenter.length - 1)

    // 为每个单元计算位移增量
    const unitDeltas = new Map<AlignUnit, { x: number; y: number; z: number }>()

    unitsWithCenter.forEach(({ unit, workingCenter }, index) => {
      const newValue = first + spacing * index
      const delta = newValue - workingCenter[axis]

      // 构造工作坐标系下的位移向量
      const workingDelta = { x: 0, y: 0, z: 0 }
      workingDelta[axis] = delta

      // 转换回全局坐标系
      const globalDelta = uiStore.workingCoordinateSystem.enabled
        ? uiStore.workingToGlobal(workingDelta)
        : workingDelta

      unitDeltas.set(unit, globalDelta)
    })

    // 应用位移到所有物品
    activeScheme.value.items.value = activeScheme.value.items.value.map((item) => {
      // 找到该物品所属的对齐单元
      const unit = alignUnits.find((u) => u.items.some((i) => i.internalId === item.internalId))
      if (!unit) return item

      const delta = unitDeltas.get(unit)
      if (!delta) return item

      return {
        ...item,
        x: item.x + delta.x,
        y: item.y + delta.y,
        z: item.z + delta.z,
      }
    })

    store.triggerSceneUpdate()
  }

  return {
    getSelectedItemsCenter,
    getRotationCenter,
    deleteSelected,
    updateSelectedItemsTransform,
    moveSelectedItems,
    mirrorSelectedItems,
    alignSelectedItems,
    distributeSelectedItems,
    commitBatchedTransform,
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
}
