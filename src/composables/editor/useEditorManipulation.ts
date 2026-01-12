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
import { transformOBBByMatrix } from '../../lib/collision'
import { getThreeModelManager } from '../useThreeModelManager'

/**
 * 计算物品在群组旋转后的新位置和姿态
 * 核心原则：模拟渲染管线进行正向构建，应用变换后再逆向还原。
 *
 * 渲染管线:
 * 1. Data Space: (x, y, z, Roll, Pitch, Yaw)
 * 2. Visual Euler: (-Roll, -Pitch, Yaw)  // 关键修正
 * 3. Render Matrix: compose(Visual Pos, Visual Euler, Scale)
 * 4. World Matrix: Scale(1, -1, 1) * Render Matrix
 *
 * 变换操作: World Matrix' = Delta Rotation * World Matrix
 *
 * 逆向还原:
 * 1. Render Matrix' = Scale(1, -1, 1) * World Matrix'
 * 2. 提取 Visual Euler
 * 3. Data Rotation: (-ex, -ey, ez) // 关键还原
 */
function calculateNewTransform(
  item: AppItem,
  center: { x: number; y: number; z: number },
  rotationDelta: { x?: number; y?: number; z?: number },
  positionOffset: { x: number; y: number; z: number }
) {
  // 1. 定义父级镜像变换矩阵 S (Scale 1, -1, 1)
  const S = new Matrix4().makeScale(1, -1, 1)

  // 2. 构建"渲染矩阵" (模拟 useThreeInstancedRenderer.ts 逻辑)
  const localPos = new Vector3(item.x, item.y, item.z)

  // 关键：渲染器使用了 Roll/Pitch 取反
  const localEuler = new Euler(
    MathUtils.degToRad(-(item.rotation.x ?? 0)),
    MathUtils.degToRad(-(item.rotation.y ?? 0)),
    MathUtils.degToRad(item.rotation.z ?? 0),
    'ZYX'
  )
  const localQuat = new Quaternion().setFromEuler(localEuler)
  const localScale = new Vector3(1, 1, 1)

  const mRendered = new Matrix4().compose(localPos, localQuat, localScale)

  // 3. 构建世界矩阵: M_world = S * M_rendered
  const mWorld = S.clone().multiply(mRendered)

  // 4. 构建旋转增量矩阵
  const deltaEuler = new Euler(
    MathUtils.degToRad(rotationDelta.x ?? 0),
    MathUtils.degToRad(rotationDelta.y ?? 0),
    MathUtils.degToRad(rotationDelta.z ?? 0),
    'ZYX'
  )
  const deltaQuat = new Quaternion().setFromEuler(deltaEuler)
  const mDeltaRot = new Matrix4().makeRotationFromQuaternion(deltaQuat)

  // 5. 计算新的世界位置 (Orbit 公转)
  const centerData = new Vector3(center.x, center.y, center.z)
  const centerWorld = centerData.clone().applyMatrix4(S) // (x, -y, z)

  const posWorld = new Vector3().setFromMatrixPosition(mWorld)

  const relativeVec = posWorld.clone().sub(centerWorld)
  relativeVec.applyQuaternion(deltaQuat)

  // 处理位置偏移 (positionOffset 是 Data Space 的增量，需应用 S 变换)
  const offsetVisual = new Vector3(
    positionOffset.x,
    positionOffset.y,
    positionOffset.z
  ).applyMatrix4(S)

  const newPosWorld = centerWorld.clone().add(relativeVec).add(offsetVisual)

  // 6. 计算新的世界姿态 (自转): M_new_world = M_delta_rot * M_world
  const mNewWorldRot = mDeltaRot.multiply(mWorld)
  mNewWorldRot.setPosition(newPosWorld)

  // 7. 还原回"渲染矩阵": M'_rendered = S * M'_world
  const mNewRendered = S.multiply(mNewWorldRot)

  // 8. 提取并逆向还原数据
  const newPos = new Vector3()
  const newQuat = new Quaternion()
  const newScale = new Vector3()
  mNewRendered.decompose(newPos, newQuat, newScale)

  const newEuler = new Euler().setFromQuaternion(newQuat, 'ZYX')

  return {
    x: newPos.x,
    y: newPos.y,
    z: newPos.z,
    // 关键：数据还原需再次取反 Roll/Pitch
    Roll: -MathUtils.radToDeg(newEuler.x),
    Pitch: -MathUtils.radToDeg(newEuler.y),
    Yaw: MathUtils.radToDeg(newEuler.z),
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
   * 获取旋转中心：如果启用了定点旋转，使用自定义中心，否则使用选区中心
   */
  function getRotationCenter(): { x: number; y: number; z: number } | null {
    if (uiStore.customPivotEnabled && uiStore.customPivotPosition) {
      return uiStore.customPivotPosition
    }
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

    // 计算旋转中心（支持定点旋转）和绝对位置的参考点
    const center = getRotationCenter()
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

      // 相对模式或无旋转指定：使用矩阵算法计算变换 (支持群组旋转)
      const result = calculateNewTransform(item, center, rotation || {}, positionOffset)

      return {
        ...item,
        x: result.x + scalePositionOffset.x,
        y: result.y + scalePositionOffset.y,
        z: result.z + scalePositionOffset.z,
        rotation: {
          x: result.Roll,
          y: result.Pitch,
          z: result.Yaw,
        },
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

  // 旋转选中物品（三轴旋转，角度单位：弧度）
  function rotateSelectedItems(
    deltaRotation: { x: number; y: number; z: number },
    options: { saveHistory?: boolean } = { saveHistory: true }
  ) {
    if (!activeScheme.value) {
      return
    }

    if (options.saveHistory) {
      saveHistory('edit')
    }

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size === 0) return

    const list = scheme.items.value
    const selectedItems = list.filter((item) => selectedIds.has(item.internalId))

    // 获取旋转中心（支持定点旋转）
    const center = getRotationCenter()
    if (!center) return

    // 构建增量旋转四元数（ZYX 顺序）
    const deltaEuler = new Euler(deltaRotation.x, deltaRotation.y, deltaRotation.z, 'ZYX')
    const deltaQuat = new Quaternion().setFromEuler(deltaEuler)
    const deltaMatrix = new Matrix4().makeRotationFromQuaternion(deltaQuat)

    // 更新每个选中物品
    for (const item of selectedItems) {
      // 1. 更新物品自身旋转（自转） - 使用四元数避免万向节锁
      const currentEuler = new Euler(
        MathUtils.degToRad(item.rotation.x ?? 0),
        MathUtils.degToRad(item.rotation.y ?? 0),
        MathUtils.degToRad(item.rotation.z ?? 0),
        'ZYX'
      )
      const currentQuat = new Quaternion().setFromEuler(currentEuler)

      // 复合旋转：newQuat = deltaQuat * currentQuat
      const newQuat = deltaQuat.clone().multiply(currentQuat)
      const newEuler = new Euler().setFromQuaternion(newQuat, 'ZYX')

      // 更新数据
      item.rotation.x = MathUtils.radToDeg(newEuler.x)
      item.rotation.y = MathUtils.radToDeg(newEuler.y)
      item.rotation.z = MathUtils.radToDeg(newEuler.z)

      // 2. 如果多选，需要绕中心点旋转位置（公转） - 使用 3D 旋转矩阵
      if (selectedItems.length > 1) {
        const relativePos = new Vector3(item.x - center.x, item.y - center.y, item.z - center.z)
        relativePos.applyMatrix4(deltaMatrix)
        item.x = center.x + relativePos.x
        item.y = center.y + relativePos.y
        item.z = center.z + relativePos.z
      }
    }

    // 触发更新
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

    // 转换到工作坐标系
    const workingCenter = uiStore.globalToWorking(globalCenter)

    // 更新每个选中物品
    activeScheme.value.items.value = activeScheme.value.items.value.map((item) => {
      if (!selectedIds.has(item.internalId)) {
        return item
      }

      // === 1. 位置镜像 ===
      // 转换到工作坐标系
      const workingPos = uiStore.globalToWorking({ x: item.x, y: item.y, z: item.z })

      // 沿指定轴镜像
      workingPos[axis] = 2 * workingCenter[axis] - workingPos[axis]

      // 转换回全局坐标系
      const newPos = uiStore.workingToGlobal(workingPos)

      // === 2. 旋转镜像 ===
      // 当启用工作坐标系时，需要将 Z 轴旋转转换到工作坐标系后再镜像
      let newRotation = { ...item.rotation }

      // 检查是否启用"同时镜像旋转"
      if (settingsStore.settings.mirrorWithRotation) {
        if (uiStore.workingCoordinateSystem.enabled) {
          // 将 Z 轴旋转转换到工作坐标系
          const workingYaw = item.rotation.z - uiStore.workingCoordinateSystem.rotationAngle

          // 在工作坐标系中执行镜像
          const mirroredRotation = mirrorRotationInWorkingCoord(
            { x: item.rotation.x, y: item.rotation.y, z: workingYaw },
            axis
          )

          // 将 Z 轴旋转转换回全局坐标系
          newRotation = {
            x: mirroredRotation.x,
            y: mirroredRotation.y,
            z: mirroredRotation.z + uiStore.workingCoordinateSystem.rotationAngle,
          }
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
   * 对齐选中物品（沿指定轴对齐到最小值/中心/最大值）
   *
   * 根据渲染模式使用不同的对齐策略：
   * - Box / Model 模式：使用包围盒边界进行对齐
   * - Simple-box / Icon 模式：使用中心点进行对齐
   *
   * 支持工作坐标系：当工作坐标系启用时，在工作坐标系下进行对齐
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

    const selectedItems = scheme.items.value.filter((item) => selectedIds.has(item.internalId))
    const currentMode = settingsStore.settings.threeDisplayMode

    // 快速路径：simple-box / icon 模式使用中心点对齐
    if (currentMode === 'simple-box' || currentMode === 'icon') {
      alignByCenterPoint(selectedItems, axis, mode)
      return
    }

    // Box / Model 模式：使用包围盒对齐
    alignByBoundingBox(selectedItems, axis, mode)
  }

  /**
   * 使用中心点进行对齐（用于 simple-box / icon 模式）
   */
  function alignByCenterPoint(
    selectedItems: AppItem[],
    axis: 'x' | 'y' | 'z',
    mode: 'min' | 'center' | 'max'
  ) {
    const scheme = activeScheme.value
    if (!scheme) return

    // 在工作坐标系下计算positions
    const workingPositions = selectedItems.map((item) => {
      const pos = { x: item.x, y: item.y, z: item.z }
      return uiStore.workingCoordinateSystem.enabled ? uiStore.globalToWorking(pos) : pos
    })

    // 计算对齐目标位置
    const axisValues = workingPositions.map((pos) => pos[axis])
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

    // 更新每个选中物品
    scheme.items.value = scheme.items.value.map((item) => {
      if (!scheme.selectedItemIds.value.has(item.internalId)) {
        return item
      }

      // 获取当前位置（工作坐标系）
      const workingPos = uiStore.workingCoordinateSystem.enabled
        ? uiStore.globalToWorking({ x: item.x, y: item.y, z: item.z })
        : { x: item.x, y: item.y, z: item.z }

      // 更新对齐轴
      workingPos[axis] = targetValue

      // 转换回全局坐标系
      const newPos = uiStore.workingCoordinateSystem.enabled
        ? uiStore.workingToGlobal(workingPos)
        : workingPos

      return {
        ...item,
        x: newPos.x,
        y: newPos.y,
        z: newPos.z,
      }
    })

    store.triggerSceneUpdate()
  }

  /**
   * 使用包围盒进行对齐（用于 box / model 模式）
   */
  function alignByBoundingBox(
    selectedItems: AppItem[],
    axis: 'x' | 'y' | 'z',
    mode: 'min' | 'center' | 'max'
  ) {
    const scheme = activeScheme.value
    if (!scheme) return

    const currentMode = settingsStore.settings.threeDisplayMode
    const modelManager = getThreeModelManager()
    const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]

    // 计算对齐轴在世界空间中的方向向量
    const alignAxisVector = new Vector3()
    if (axis === 'x') {
      alignAxisVector.set(1, 0, 0)
    } else if (axis === 'y') {
      alignAxisVector.set(0, 1, 0)
    } else {
      alignAxisVector.set(0, 0, 1)
    }

    // 如果启用了工作坐标系，旋转对齐轴向量
    if (uiStore.workingCoordinateSystem.enabled) {
      const angleRad = (uiStore.workingCoordinateSystem.rotationAngle * Math.PI) / 180
      alignAxisVector.applyAxisAngle(new Vector3(0, 0, 1), -angleRad)
    }

    // 为每个物品计算包围盒投影
    interface ItemProjection {
      item: AppItem
      projMin: number
      projMax: number
      projCenter: number
    }

    const itemProjections: ItemProjection[] = []

    for (const item of selectedItems) {
      // 1. 获取局部尺寸和中心
      let localSize: Vector3
      let localCenter: Vector3

      if (currentMode === 'model') {
        const modelBox = modelManager.getModelBoundingBox(item.gameId)
        if (modelBox) {
          // 模型有实际包围盒
          localSize = new Vector3()
          modelBox.getSize(localSize)
          localCenter = new Vector3()
          modelBox.getCenter(localCenter)
        } else {
          // 模型未加载，使用默认尺寸
          const size = gameDataStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
          localSize = new Vector3(...size)
          localCenter = new Vector3()
        }
      } else {
        // box 模式：尺寸已经编码在 matrix.scale 中（buildWorldMatrixFromItem 已处理）
        // 所以这里使用单位向量，避免重复计算导致尺寸被平方
        localSize = new Vector3(1, 1, 1)
        localCenter = new Vector3()
      }

      // 2. 构建世界矩阵
      const modelConfig = gameDataStore.getFurnitureModelConfig(item.gameId)
      const hasValidModel = modelConfig && modelConfig.meshes && modelConfig.meshes.length > 0
      const useModelScale = !!(currentMode === 'model' && hasValidModel)
      const matrix = matrixTransform.buildWorldMatrixFromItem(item, useModelScale)

      // 3. 生成 OBB
      const obb = transformOBBByMatrix(matrix, localSize, localCenter)

      // 4. 获取 OBB 的 8 个角点
      const corners = obb.getCorners()

      // 5. 将角点投影到对齐轴上
      let projMin = Infinity
      let projMax = -Infinity

      for (const corner of corners) {
        const projection = corner.dot(alignAxisVector)
        projMin = Math.min(projMin, projection)
        projMax = Math.max(projMax, projection)
      }

      const projCenter = (projMin + projMax) / 2

      itemProjections.push({
        item,
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
        targetValue = Math.max(...itemProjections.map((p) => p.projMax))
      } else {
        targetValue = Math.min(...itemProjections.map((p) => p.projMin))
      }
    } else if (mode === 'center') {
      const allMin = Math.min(...itemProjections.map((p) => p.projMin))
      const allMax = Math.max(...itemProjections.map((p) => p.projMax))
      targetValue = (allMin + allMax) / 2
    } else {
      // max
      if (shouldInvert) {
        targetValue = Math.min(...itemProjections.map((p) => p.projMin))
      } else {
        targetValue = Math.max(...itemProjections.map((p) => p.projMax))
      }
    }

    // 7. 计算每个物品需要移动的距离并应用
    scheme.items.value = scheme.items.value.map((item) => {
      if (!scheme.selectedItemIds.value.has(item.internalId)) {
        return item
      }

      // 找到对应的投影信息
      const proj = itemProjections.find((p) => p.item.internalId === item.internalId)
      if (!proj) return item

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

      return {
        ...item,
        x: item.x + dataDelta.x,
        y: item.y + dataDelta.y,
        z: item.z + dataDelta.z,
      }
    })

    store.triggerSceneUpdate()
  }

  /**
   * 分布选中物品（沿指定轴均匀分布）
   *
   * 支持工作坐标系：当工作坐标系启用时，在工作坐标系下进行分布
   *
   * @param axis - 分布轴 ('x' | 'y' | 'z')
   */
  function distributeSelectedItems(axis: 'x' | 'y' | 'z') {
    if (!activeScheme.value) return

    const scheme = activeScheme.value
    const selectedIds = scheme.selectedItemIds.value
    if (selectedIds.size < 3) return // 至少需要3个物品

    saveHistory('edit')

    const selectedItems = scheme.items.value.filter((item) => selectedIds.has(item.internalId))

    // 在工作坐标系下处理
    const itemsWithWorkingPos = selectedItems.map((item) => {
      const pos = { x: item.x, y: item.y, z: item.z }
      const workingPos = uiStore.workingCoordinateSystem.enabled
        ? uiStore.globalToWorking(pos)
        : pos
      return { item, workingPos }
    })

    // 按指定轴排序
    itemsWithWorkingPos.sort((a, b) => a.workingPos[axis] - b.workingPos[axis])

    // 计算首尾位置
    const firstItem = itemsWithWorkingPos[0]
    const lastItem = itemsWithWorkingPos[itemsWithWorkingPos.length - 1]
    if (!firstItem || !lastItem) return // 安全检查

    const first = firstItem.workingPos[axis]
    const last = lastItem.workingPos[axis]
    const spacing = (last - first) / (itemsWithWorkingPos.length - 1)

    // 创建ID到新位置的映射
    const newPositionsMap = new Map<string, { x: number; y: number; z: number }>()

    itemsWithWorkingPos.forEach(({ item, workingPos }, index) => {
      const newWorkingPos = { ...workingPos }
      newWorkingPos[axis] = first + spacing * index

      // 转换回全局坐标系
      const newGlobalPos = uiStore.workingCoordinateSystem.enabled
        ? uiStore.workingToGlobal(newWorkingPos)
        : newWorkingPos

      newPositionsMap.set(item.internalId, newGlobalPos)
    })

    // 更新所有物品
    activeScheme.value.items.value = activeScheme.value.items.value.map((item) => {
      const newPos = newPositionsMap.get(item.internalId)
      if (!newPos) return item

      return {
        ...item,
        x: newPos.x,
        y: newPos.y,
        z: newPos.z,
      }
    })

    store.triggerSceneUpdate()
  }

  return {
    getSelectedItemsCenter,
    deleteSelected,
    updateSelectedItemsTransform,
    moveSelectedItems,
    rotateSelectedItems,
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
