import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGameDataStore } from '../../stores/gameDataStore'
import { useEditorHistory } from './useEditorHistory'
import { matrixTransform } from '../../lib/matrixTransform'
import { getThreeModelManager } from '../useThreeModelManager'
import {
  buildItemOBB,
  calculateAlignAxisVector,
  calculateAlignTarget,
  calculateAlignDelta,
  shouldInvertForYAxis,
  type UnitProjection,
} from '../../lib/alignmentHelpers'
import type { AppItem } from '../../types/editor'

/**
 * 对齐单元：用于组合感知的对齐/分布操作
 * 可以是单个物品，也可以是整个组
 */
interface AlignUnit {
  type: 'single' | 'group'
  groupId: number | null
  items: AppItem[] // 单个物品或组内所有成员
}

interface GroupOriginContext {
  groupId: number
  originItem: AppItem
}

/**
 * 编辑器对齐/分布功能
 *
 * 提供物品对齐和分布操作，支持：
 * - 中心点对齐（icon/simple-box 模式）
 * - 包围盒对齐（box/model 模式）
 * - 参照物对齐
 * - 工作坐标系
 * - 组合感知
 */
export function useEditorAlignment() {
  const store = useEditorStore()
  const uiStore = useUIStore()
  const settingsStore = useSettingsStore()
  const gameDataStore = useGameDataStore()
  const { activeScheme } = storeToRefs(store)
  const { saveHistory } = useEditorHistory()

  /**
   * 获取当前选区可用的组合原点上下文
   *
   * 仅在“完整选中单一组合”时返回，行为与移动逻辑保持一致。
   */
  function getGroupOriginContext(selectedIds: Set<string>): GroupOriginContext | null {
    const scheme = activeScheme.value
    if (!scheme) return null

    const entireGroupId = store.getGroupIdIfEntireGroupSelected(selectedIds)
    if (entireGroupId === null) return null

    const originItemId = scheme.groupOrigins.value.get(entireGroupId)
    if (!originItemId) return null

    const originItem = store.itemsMap.get(originItemId)
    if (!originItem) return null

    return {
      groupId: entireGroupId,
      originItem,
    }
  }

  /**
   * 计算对齐单元中心（数据空间）
   *
   * 当完整选中一个有组合原点的组时，使用组合原点作为中心；
   * 其他情况回退到“所有成员平均位置”。
   */
  function getUnitCenterDataPosition(
    unit: AlignUnit,
    groupOriginContext: GroupOriginContext | null
  ): { x: number; y: number; z: number } {
    if (
      groupOriginContext &&
      unit.type === 'group' &&
      unit.groupId !== null &&
      unit.groupId === groupOriginContext.groupId
    ) {
      return {
        x: groupOriginContext.originItem.x,
        y: groupOriginContext.originItem.y,
        z: groupOriginContext.originItem.z,
      }
    }

    const sum = { x: 0, y: 0, z: 0 }
    unit.items.forEach((item) => {
      sum.x += item.x
      sum.y += item.y
      sum.z += item.z
    })

    return {
      x: sum.x / unit.items.length,
      y: sum.y / unit.items.length,
      z: sum.z / unit.items.length,
    }
  }

  /**
   * 将数据空间坐标投影到世界空间轴向量上
   */
  function projectDataPositionToAxis(
    dataPosition: { x: number; y: number; z: number },
    axisVector: { x: number; y: number; z: number }
  ): number {
    const worldPosition = matrixTransform.dataPositionToWorld(dataPosition)
    return (
      worldPosition.x * axisVector.x +
      worldPosition.y * axisVector.y +
      worldPosition.z * axisVector.z
    )
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
   * 支持参照物：如果设置了参照物，则对齐到参照物而非选区边界
   *
   * @param axis - 对齐轴 ('x' | 'y' | 'z')
   * @param mode - 对齐模式 ('min' | 'center' | 'max')
   */
  function alignSelectedItems(axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max') {
    if (!activeScheme.value) return

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value

    // 检查是否有参照物
    const referenceItemId = uiStore.alignReferenceItemId

    if (referenceItemId) {
      // 对齐到参照物：单选也能用
      if (selectedIds.size < 1) return
    } else {
      // 对齐到选区边界：至少需要2个物品
      if (selectedIds.size < 2) return
    }

    saveHistory('edit')

    const currentMode = settingsStore.settings.threeDisplayMode

    // 如果有参照物，使用参照物对齐逻辑
    if (referenceItemId) {
      const targetMode = uiStore.alignReferencePosition

      if (currentMode === 'simple-box' || currentMode === 'icon') {
        // 中心点模式：固定使用中心对中心对齐，不需要 mode 参数
        alignToReferenceByCenterPoint(selectedIds, axis, referenceItemId)
      } else {
        alignToReferenceByBoundingBox(selectedIds, axis, mode, referenceItemId, targetMode)
      }
      return
    }

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
    const groupOriginContext = getGroupOriginContext(selectedIds)

    // 为每个对齐单元计算中心点（工作坐标系）
    const unitCenters = alignUnits.map((unit) => {
      const dataCenter = getUnitCenterDataPosition(unit, groupOriginContext)

      // 使用 uiStore 统一 API 转换：数据空间 -> 工作坐标系
      const workingCenter = uiStore.dataToWorking(dataCenter)

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

      // 使用 uiStore 统一 API 转换：工作坐标系增量 -> 数据空间增量
      const dataDelta = uiStore.workingDeltaToData(workingDelta)

      unitDeltas.set(unit, dataDelta)
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
    const groupOriginContext = getGroupOriginContext(selectedIds)

    // 使用辅助函数计算对齐轴在世界空间中的方向向量
    const workingRotation = uiStore.workingCoordinateSystem.enabled
      ? uiStore.workingCoordinateSystem.rotation
      : null
    const alignAxisVector = calculateAlignAxisVector(axis, workingRotation)

    // 为每个对齐单元计算包围盒投影
    const unitProjections: (UnitProjection & { unit: AlignUnit })[] = []

    for (const unit of alignUnits) {
      // 收集单元内所有物品的 OBB
      const obbs: any[] = []

      for (const item of unit.items) {
        // 使用辅助函数构建 OBB
        const obb = buildItemOBB(item, currentMode, gameDataStore, modelManager)
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

      let projCenter = (projMin + projMax) / 2

      // 特殊中心：仅在完整选中单一组合时，center 使用组合原点
      if (
        groupOriginContext &&
        unit.type === 'group' &&
        unit.groupId !== null &&
        unit.groupId === groupOriginContext.groupId
      ) {
        projCenter = projectDataPositionToAxis(
          {
            x: groupOriginContext.originItem.x,
            y: groupOriginContext.originItem.y,
            z: groupOriginContext.originItem.z,
          },
          alignAxisVector
        )
      }

      unitProjections.push({
        unit,
        projMin,
        projMax,
        projCenter,
      })
    }

    // 使用辅助函数计算目标对齐值
    const targetValue = calculateAlignTarget(unitProjections, mode, axis)

    // 为每个单元计算位移增量
    const unitDeltas = new Map<AlignUnit, { x: number; y: number; z: number }>()

    for (const proj of unitProjections) {
      // 使用辅助函数计算需要移动的距离
      const delta = calculateAlignDelta(proj, targetValue, mode, axis)

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
   * 使用中心点对齐到参照物（用于 simple-box / icon 模式）
   *
   * 中心点模式固定使用中心对中心对齐，无需 min/max/center 模式选择
   */
  function alignToReferenceByCenterPoint(
    selectedIds: Set<string>,
    axis: 'x' | 'y' | 'z',
    referenceItemId: string
  ) {
    const scheme = activeScheme.value
    if (!scheme) return

    // 获取参照物
    const refItem = store.itemsMap.get(referenceItemId)
    if (!refItem) return

    // 使用 uiStore 统一 API 转换：数据空间 -> 工作坐标系
    const refWorkingCenter = uiStore.dataToWorking({ x: refItem.x, y: refItem.y, z: refItem.z })

    // 对于中心点模式，所有 mode 都映射到中心
    const targetValue = refWorkingCenter[axis]

    // 按组聚合选中物品
    const alignUnits = buildAlignUnits(selectedIds)
    const groupOriginContext = getGroupOriginContext(selectedIds)

    // 为每个对齐单元计算位移增量
    const unitDeltas = new Map<AlignUnit, { x: number; y: number; z: number }>()

    alignUnits.forEach((unit) => {
      // 跳过参照物自身
      if (unit.items.some((item) => item.internalId === referenceItemId)) {
        unitDeltas.set(unit, { x: 0, y: 0, z: 0 })
        return
      }

      const globalCenter = getUnitCenterDataPosition(unit, groupOriginContext)

      // 使用 uiStore 统一 API 转换：数据空间 -> 工作坐标系
      const workingCenter = uiStore.dataToWorking(globalCenter)

      // 计算位移
      const delta = targetValue - workingCenter[axis]

      // 构造工作坐标系下的位移向量
      const workingDelta = { x: 0, y: 0, z: 0 }
      workingDelta[axis] = delta

      // 使用 uiStore 统一 API 转换：工作坐标系增量 -> 数据空间增量
      const dataDelta = uiStore.workingDeltaToData(workingDelta)

      unitDeltas.set(unit, dataDelta)
    })

    // 应用位移到所有物品
    scheme.items.value = scheme.items.value.map((item) => {
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
   * 使用包围盒对齐到参照物（用于 box / model 模式）
   */
  function alignToReferenceByBoundingBox(
    selectedIds: Set<string>,
    axis: 'x' | 'y' | 'z',
    sourceMode: 'min' | 'center' | 'max',
    referenceItemId: string,
    targetMode: 'min' | 'center' | 'max'
  ) {
    const scheme = activeScheme.value
    if (!scheme) return

    const currentMode = settingsStore.settings.threeDisplayMode
    const modelManager = getThreeModelManager()

    // 获取参照物
    const refItem = store.itemsMap.get(referenceItemId)
    if (!refItem) return

    // 使用辅助函数计算对齐轴在世界空间中的方向向量
    const workingRotation = uiStore.workingCoordinateSystem.enabled
      ? uiStore.workingCoordinateSystem.rotation
      : null
    const alignAxisVector = calculateAlignAxisVector(axis, workingRotation)

    // 使用辅助函数计算参照物的包围盒
    const refObb = buildItemOBB(refItem, currentMode, gameDataStore, modelManager)

    // 计算参照物在对齐轴上的投影
    let refProjMin = Infinity
    let refProjMax = -Infinity
    const refCorners = refObb.getCorners()
    for (const corner of refCorners) {
      const projection = corner.dot(alignAxisVector)
      refProjMin = Math.min(refProjMin, projection)
      refProjMax = Math.max(refProjMax, projection)
    }
    const refProjCenter = (refProjMin + refProjMax) / 2

    // 根据 targetMode 确定目标值
    const shouldInvert = shouldInvertForYAxis(axis)
    let targetValue: number

    if (targetMode === 'min') {
      targetValue = shouldInvert ? refProjMax : refProjMin
    } else if (targetMode === 'center') {
      targetValue = refProjCenter
    } else {
      // max
      targetValue = shouldInvert ? refProjMin : refProjMax
    }

    // 按组聚合选中物品
    const alignUnits = buildAlignUnits(selectedIds)
    const groupOriginContext = getGroupOriginContext(selectedIds)

    // 为每个对齐单元计算包围盒投影
    const unitProjections: (UnitProjection & { unit: AlignUnit })[] = []

    for (const unit of alignUnits) {
      // 跳过参照物自身
      if (unit.items.some((item) => item.internalId === referenceItemId)) {
        continue
      }

      // 收集单元内所有物品的 OBB
      const obbs: any[] = []

      for (const item of unit.items) {
        // 使用辅助函数构建 OBB
        const obb = buildItemOBB(item, currentMode, gameDataStore, modelManager)
        obbs.push(obb)
      }

      // 合并单元内所有 OBB 的角点
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

      let projCenter = (projMin + projMax) / 2

      // 特殊中心：仅在完整选中单一组合时，center 使用组合原点
      if (
        groupOriginContext &&
        unit.type === 'group' &&
        unit.groupId !== null &&
        unit.groupId === groupOriginContext.groupId
      ) {
        projCenter = projectDataPositionToAxis(
          {
            x: groupOriginContext.originItem.x,
            y: groupOriginContext.originItem.y,
            z: groupOriginContext.originItem.z,
          },
          alignAxisVector
        )
      }

      unitProjections.push({
        unit,
        projMin,
        projMax,
        projCenter,
      })
    }

    // 为每个单元计算位移增量
    const unitDeltas = new Map<AlignUnit, { x: number; y: number; z: number }>()

    for (const proj of unitProjections) {
      // 使用辅助函数计算需要移动的距离
      const delta = calculateAlignDelta(proj, targetValue, sourceMode, axis)

      // 移动向量 = delta * alignAxisVector
      const moveVector = alignAxisVector.clone().multiplyScalar(delta)

      // 世界空间向量 -> 数据空间
      const dataDelta = matrixTransform.worldPositionToData({
        x: moveVector.x,
        y: moveVector.y,
        z: moveVector.z,
      })

      unitDeltas.set(proj.unit, dataDelta)
    }

    // 应用位移到所有物品
    scheme.items.value = scheme.items.value.map((item) => {
      // 跳过参照物自身
      if (item.internalId === referenceItemId) return item

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

      const dataCenter = {
        x: sum.x / unit.items.length,
        y: sum.y / unit.items.length,
        z: sum.z / unit.items.length,
      }

      // 使用 uiStore 统一 API 转换：数据空间 -> 工作坐标系
      const workingCenter = uiStore.dataToWorking(dataCenter)

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

      // 使用 uiStore 统一 API 转换：工作坐标系增量 -> 数据空间增量
      const dataDelta = uiStore.workingDeltaToData(workingDelta)

      unitDeltas.set(unit, dataDelta)
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
    alignSelectedItems,
    distributeSelectedItems,
  }
}
