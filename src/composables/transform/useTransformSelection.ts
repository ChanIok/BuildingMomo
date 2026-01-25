import { computed } from 'vue'
import { Euler, Matrix4, Vector3 } from 'three'
import { useEditorStore } from '../../stores/editorStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGameDataStore } from '../../stores/gameDataStore'
import { useEditorManipulation } from '../editor/useEditorManipulation'
import { useI18n } from '../useI18n'
import {
  convertPositionGlobalToWorking,
  convertRotationGlobalToWorking,
} from '../../lib/coordinateTransform'
import { matrixTransform } from '../../lib/matrixTransform'

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
  const { getRotationCenter } = useEditorManipulation()

  /**
   * 选区信息 computed
   */
  const selectionInfo = computed<SelectionInfo | null>(() => {
    const scheme = editorStore.activeScheme
    if (!scheme) return null
    const ids = scheme.selectedItemIds.value
    if (ids.size === 0) return null
    const selected = scheme.items.value.filter((item) => ids.has(item.internalId))

    // 位置中心点（用于绝对模式显示）
    let center = { x: 0, y: 0, z: 0 }

    // 使用 getRotationCenter 获取有效中心（包含定点旋转、组合原点优先级的处理）
    center = getRotationCenter() || { x: 0, y: 0, z: 0 }

    // 使用 uiStore 的统一方法获取有效的坐标系旋转（视觉空间）
    const effectiveCoordRotation = uiStore.getEffectiveCoordinateRotation(
      scheme.selectedItemIds.value,
      editorStore.itemsMap
    )

    // 关键：由于 Gizmo 的 Y 轴箭头几何体被翻转了（setupGizmoAppearance），
    // 视觉上向上的箭头实际对应数据空间的 +Y（向下）
    // 所以侧边栏应该直接显示数据空间的值，与 Gizmo 视觉方向一致
    // 数据空间 -> 世界空间：Y 轴翻转
    const worldCenter = { x: center.x, y: -center.y, z: center.z }

    // 如果有有效的坐标系，将世界空间坐标转换到工作坐标系
    if (effectiveCoordRotation) {
      // 工作坐标系输出的是世界空间语义的坐标
      const workingCenter = convertPositionGlobalToWorking(worldCenter, effectiveCoordRotation)
      // 世界空间 -> 数据空间：Y 轴翻转回来，与 Gizmo 视觉一致
      center = { x: workingCenter.x, y: -workingCenter.y, z: workingCenter.z }
    }
    // 没有工作坐标系时，直接使用数据空间的值（center 本身就是）

    // 旋转角度（用于绝对模式显示）
    let rotation = { x: 0, y: 0, z: 0 }
    if (selected.length === 1) {
      const item = selected[0]
      if (item) {
        rotation = matrixTransform.dataRotationToVisual({
          x: item.rotation.x,
          y: item.rotation.y,
          z: item.rotation.z,
        })
        // 如果有有效的坐标系，将全局旋转转换为相对旋转（使用四元数精确转换）
        if (effectiveCoordRotation) {
          // 直接使用视觉空间的旋转值，与 Gizmo 一致
          rotation = convertRotationGlobalToWorking(rotation, effectiveCoordRotation)
        }
      }
    }
    // 多选绝对模式显示 0（相对模式会单独处理）

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
      const points = selected.map((i) => ({ x: i.x, y: i.y, z: i.z }))

      // 修复 BUG: 正确处理坐标空间转换
      // 数据空间 -> 世界空间 -> 工作坐标系 -> 数据空间语义
      const transformedPoints = effectiveCoordRotation
        ? points.map((p) => {
            // 数据空间 -> 世界空间：Y 轴翻转
            const worldPos = { x: p.x, y: -p.y, z: p.z }
            // 世界空间 -> 工作坐标系
            const workingPos = convertPositionGlobalToWorking(worldPos, effectiveCoordRotation)
            // 世界空间 -> 数据空间语义：Y 轴翻转回来
            return { x: workingPos.x, y: -workingPos.y, z: workingPos.z }
          })
        : points

      const xs = transformedPoints.map((p) => p.x)
      const ys = transformedPoints.map((p) => p.y)
      const zs = transformedPoints.map((p) => p.z)

      bounds = {
        min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
        max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
      }
    }

    // 包围盒范围（考虑尺寸、旋转、缩放）
    let bboxBounds = null
    if (selected.length > 1) {
      // 计算每个物品的 8 个包围盒角点
      const allCorners: { x: number; y: number; z: number }[] = []

      for (const item of selected) {
        const furniture = gameDataStore.getFurniture(item.gameId)
        const furnitureSize = furniture?.size ?? [100, 100, 150]
        const [sizeX, sizeY, sizeZ] = furnitureSize

        // 获取缩放
        const scaleX = item.extra?.Scale?.X ?? 1
        const scaleY = item.extra?.Scale?.Y ?? 1
        const scaleZ = item.extra?.Scale?.Z ?? 1

        // 计算实际尺寸（数据空间）
        // 注意：游戏坐标系中 X/Y 与渲染空间交换
        const halfX = (sizeY * scaleX) / 2 // 数据空间 X 使用 sizeY * scaleX
        const halfY = (sizeX * scaleY) / 2 // 数据空间 Y 使用 sizeX * scaleY
        const halfZ = (sizeZ * scaleZ) / 2

        // 8 个角点（物品局部空间，中心为原点）
        const localCorners = [
          { x: -halfX, y: -halfY, z: -halfZ },
          { x: +halfX, y: -halfY, z: -halfZ },
          { x: -halfX, y: +halfY, z: -halfZ },
          { x: +halfX, y: +halfY, z: -halfZ },
          { x: -halfX, y: -halfY, z: +halfZ },
          { x: +halfX, y: -halfY, z: +halfZ },
          { x: -halfX, y: +halfY, z: +halfZ },
          { x: +halfX, y: +halfY, z: +halfZ },
        ]

        // 旋转矩阵（数据空间）
        const visualRot = matrixTransform.dataRotationToVisual(item.rotation)
        const euler = new Euler(
          (visualRot.x * Math.PI) / 180,
          (visualRot.y * Math.PI) / 180,
          -(visualRot.z * Math.PI) / 180,
          'ZYX'
        )
        const rotationMatrix = new Matrix4().makeRotationFromEuler(euler)

        // 变换到世界空间并加上物品位置
        for (const corner of localCorners) {
          const vec = new Vector3(corner.x, corner.y, corner.z)
          vec.applyMatrix4(rotationMatrix)
          vec.x += item.x
          vec.y += item.y
          vec.z += item.z

          // 如果有工作坐标系，转换到工作坐标系
          if (effectiveCoordRotation) {
            // 数据空间 -> 世界空间：Y 轴翻转
            const worldPos = { x: vec.x, y: -vec.y, z: vec.z }
            // 世界空间 -> 工作坐标系
            const workingPos = convertPositionGlobalToWorking(worldPos, effectiveCoordRotation)
            // 世界空间 -> 数据空间语义：Y 轴翻转回来
            allCorners.push({ x: workingPos.x, y: -workingPos.y, z: workingPos.z })
          } else {
            allCorners.push({ x: vec.x, y: vec.y, z: vec.z })
          }
        }
      }

      // 计算 AABB
      if (allCorners.length > 0) {
        const xs = allCorners.map((p) => p.x)
        const ys = allCorners.map((p) => p.y)
        const zs = allCorners.map((p) => p.z)

        bboxBounds = {
          min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
          max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
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
