import { computed } from 'vue'
import { Vector3 } from 'three'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGameDataStore } from '../../stores/gameDataStore'
import { useEditorManipulation } from '../editor/useEditorManipulation'
import { useI18n } from '../useI18n'
import { convertRotationGlobalToWorking } from '../../lib/coordinateTransform'
import { matrixTransform } from '../../lib/matrixTransform'
import { getOBBFromMatrix, getOBBFromMatrixAndModelBox, type OBB } from '../../lib/collision'
import { getThreeModelManager } from '../useThreeModelManager'

/**
 * 选区信息接口
 */
export interface SelectionInfo {
  count: number
  center: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  bounds: {
    min: { x: number; y: number; z: number }
    max: { x: number; y: number; z: number }
  } | null
  bboxBounds: {
    min: { x: number; y: number; z: number }
    max: { x: number; y: number; z: number }
  } | null
  /** 原点物品 ID（仅当完整选中一个有原点设置的组时有值） */
  originItemId: string | null
}

/**
 * 变换约束接口
 */
export interface TransformConstraints {
  scaleRange: [number, number]
  rotationAllowed: { x: boolean; y: boolean; z: boolean }
  isScaleLocked: boolean
}

/**
 * 数字格式化辅助函数
 */
export const fmt = (n: number) => Math.round(n * 100) / 100

/**
 * Transform 面板选区计算逻辑
 */
export function useTransformSelection() {
  const editorStore = useEditorStore()
  const uiStore = useUIStore()
  const settingsStore = useSettingsStore()
  const gameDataStore = useGameDataStore()
  const { t, locale } = useI18n()
  const { getSelectedItemsCenter } = useEditorManipulation()

  /**
   * 选区信息 computed
   */
  const selectionInfo = computed<SelectionInfo | null>(() => {
    const scheme = editorStore.activeScheme
    if (!scheme) return null
    const ids = scheme.selectedItemIds.value
    if (ids.size === 0) return null
    const selected = scheme.items.value.filter((item) => ids.has(item.internalId))

    // 检测原点物品
    let originItemId: string | null = null
    let originItem: (typeof selected)[0] | null = null

    if (selected.length > 1) {
      const groupId = editorStore.getGroupIdIfEntireGroupSelected(ids)
      if (groupId !== null) {
        const originId = scheme.groupOrigins.value.get(groupId)
        if (originId) {
          originItem = editorStore.itemsMap.get(originId) || null
          if (originItem) {
            originItemId = originId
          }
        }
      }
    }

    // 位置中心点（用于绝对模式显示）
    // 优先级：组合原点 > 选区几何中心（与 Gizmo 保持一致，但不受定点旋转影响）
    let dataCenter: { x: number; y: number; z: number } | null = null

    // 优先级 1: 组合原点
    if (originItem) {
      dataCenter = { x: originItem.x, y: originItem.y, z: originItem.z }
    }

    // 优先级 2: 几何中心
    if (!dataCenter) {
      dataCenter = getSelectedItemsCenter() || { x: 0, y: 0, z: 0 }
    }

    // 使用 uiStore 统一 API 转换：数据空间 -> 工作坐标系（用于 UI 显示）
    const center = uiStore.dataToWorking(dataCenter)

    // 使用 uiStore 的统一方法获取有效的坐标系旋转（视觉空间）
    const effectiveCoordRotation = uiStore.getEffectiveCoordinateRotation(
      scheme.selectedItemIds.value,
      editorStore.itemsMap
    )

    // 旋转角度（用于绝对模式显示）
    let rotation = { x: 0, y: 0, z: 0 }

    // 确定旋转显示的来源物品：单选使用该物品，多选有原点使用原点物品
    const rotationSourceItem = selected.length === 1 ? selected[0] : originItem

    if (rotationSourceItem) {
      rotation = matrixTransform.dataRotationToVisual({
        x: rotationSourceItem.rotation.x,
        y: rotationSourceItem.rotation.y,
        z: rotationSourceItem.rotation.z,
      })
      // 如果有有效的坐标系，将全局旋转转换为相对旋转（使用四元数精确转换）
      if (effectiveCoordRotation) {
        // 直接使用视觉空间的旋转值，与 Gizmo 一致
        rotation = convertRotationGlobalToWorking(rotation, effectiveCoordRotation)
      }
    }
    // 多选无原点时绝对模式显示 0（相对模式会单独处理）

    // 缩放（不受工作坐标系影响）
    let scale = { x: 1, y: 1, z: 1 }
    if (selected.length === 1) {
      const item = selected[0]
      if (item && item.extra.Scale) {
        scale = {
          x: item.extra.Scale.X,
          y: item.extra.Scale.Y,
          z: item.extra.Scale.Z,
        }
      }
    } else if (selected.length > 1) {
      // 多选时计算平均缩放
      const scales = selected.map((item) => item.extra.Scale || { X: 1, Y: 1, Z: 1 })
      const avgX = scales.reduce((sum, s) => sum + s.X, 0) / scales.length
      const avgY = scales.reduce((sum, s) => sum + s.Y, 0) / scales.length
      const avgZ = scales.reduce((sum, s) => sum + s.Z, 0) / scales.length
      scale = { x: avgX, y: avgY, z: avgZ }
    }

    // 边界（最小/最大值）- 轴点范围
    let bounds = null
    if (selected.length > 1) {
      // 使用 uiStore 统一 API 转换每个点：数据空间 -> 工作坐标系
      const transformedPoints = selected.map((i) =>
        uiStore.dataToWorking({ x: i.x, y: i.y, z: i.z })
      )

      // 使用 reduce 代替 spread 避免大数组栈溢出
      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity
      let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity
      for (const p of transformedPoints) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.z < minZ) minZ = p.z
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
        if (p.z > maxZ) maxZ = p.z
      }

      bounds = {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
      }
    }

    // 包围盒范围（考虑尺寸、旋转、缩放）
    // 使用 collision.ts 的 OBB 工具，与 Gizmo 吸附功能保持一致
    let bboxBounds = null
    if (selected.length > 1) {
      const modelManager = getThreeModelManager()
      const allCorners: { x: number; y: number; z: number }[] = []

      for (const item of selected) {
        // 判断是否使用模型包围盒（只有 box 和 model 模式才有准确的体积信息）
        const currentMode = settingsStore.settings.threeDisplayMode
        const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
        const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
        const useModelScale = !!(currentMode === 'model' && hasValidModel)

        // 复用 matrixTransform 构建世界矩阵（封装了坐标系交换逻辑）
        const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)

        // 生成 OBB（封装了 8 角点计算）
        let obb: OBB
        if (useModelScale) {
          const modelBox = modelManager.getModelBoundingBox(item.gameId)
          if (modelBox) {
            obb = getOBBFromMatrixAndModelBox(matrix, modelBox)
          } else {
            // Model 模式但模型未加载，fallback 到 box 模式
            obb = getOBBFromMatrix(matrix, new Vector3(1, 1, 1))
          }
        } else {
          // Box 模式或其他模式：使用单位立方体
          obb = getOBBFromMatrix(matrix, new Vector3(1, 1, 1))
        }

        // 获取 OBB 的 8 个角点
        const corners = obb.getCorners()

        // 转换到工作坐标系（如果启用）
        // OBB 角点已经在世界空间，需要转换到数据空间语义后再转换到工作坐标系
        for (const corner of corners) {
          // 世界空间 -> 数据空间
          const dataPos = matrixTransform.worldPositionToData(corner)
          // 数据空间 -> 工作坐标系
          allCorners.push(uiStore.dataToWorking(dataPos))
        }
      }

      // 计算 AABB（使用循环代替 spread 避免大数组栈溢出）
      if (allCorners.length > 0) {
        let minX = Infinity,
          minY = Infinity,
          minZ = Infinity
        let maxX = -Infinity,
          maxY = -Infinity,
          maxZ = -Infinity
        for (const p of allCorners) {
          if (p.x < minX) minX = p.x
          if (p.y < minY) minY = p.y
          if (p.z < minZ) minZ = p.z
          if (p.x > maxX) maxX = p.x
          if (p.y > maxY) maxY = p.y
          if (p.z > maxZ) maxZ = p.z
        }

        bboxBounds = {
          min: { x: minX, y: minY, z: minZ },
          max: { x: maxX, y: maxY, z: maxZ },
        }
      }
    }

    return {
      count: selected.length,
      center,
      rotation,
      scale,
      bounds,
      bboxBounds,
      originItemId,
    }
  })

  /**
   * 获取当前选中物品的变换约束信息
   */
  const transformConstraints = computed<TransformConstraints | null>(() => {
    if (!selectionInfo.value) return null

    const scheme = editorStore.activeScheme
    if (!scheme) return null

    const selected = scheme.items.value.filter((item) =>
      scheme.selectedItemIds.value.has(item.internalId)
    )

    if (selected.length === 0) return null

    // 多选时取交集（最严格限制）
    let scaleMin = 0
    let scaleMax = Infinity
    let canRotateX = true
    let canRotateY = true

    for (const item of selected) {
      const furniture = gameDataStore.getFurniture(item.gameId)
      if (furniture) {
        scaleMin = Math.max(scaleMin, furniture.scaleRange[0])
        scaleMax = Math.min(scaleMax, furniture.scaleRange[1])
        canRotateX &&= furniture.rotationAllowed.x
        canRotateY &&= furniture.rotationAllowed.y
      }
    }

    return {
      scaleRange: [scaleMin, scaleMax] as [number, number],
      rotationAllowed: { x: canRotateX, y: canRotateY, z: true },
      isScaleLocked: scaleMin >= scaleMax,
    }
  })

  /**
   * 计算各个控制的可用性
   */
  const isRotationXAllowed = computed(() => {
    if (!settingsStore.settings.enableLimitDetection) return true
    return transformConstraints.value?.rotationAllowed.x ?? false
  })

  const isRotationYAllowed = computed(() => {
    if (!settingsStore.settings.enableLimitDetection) return true
    return transformConstraints.value?.rotationAllowed.y ?? false
  })

  const isScaleAllowed = computed(() => {
    if (!settingsStore.settings.enableLimitDetection) return true
    return !(transformConstraints.value?.isScaleLocked ?? false)
  })

  /**
   * 获取参照物名称
   */
  const alignReferenceItemName = computed(() => {
    const itemId = uiStore.alignReferenceItemId
    if (!itemId) return ''

    const item = editorStore.itemsMap.get(itemId)
    if (!item) return ''

    const furniture = gameDataStore.getFurniture(item.gameId)
    if (!furniture) return t('sidebar.itemDefaultName', { id: item.gameId })
    if (locale.value === 'zh') return furniture.name_cn
    return furniture.name_en || furniture.name_cn
  })

  return {
    selectionInfo,
    transformConstraints,
    isRotationXAllowed,
    isRotationYAllowed,
    isScaleAllowed,
    alignReferenceItemName,
    fmt,
  }
}
