import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  AppItem,
  GameItem,
  GameDataFile,
  HeightFilter,
  HomeScheme,
  TransformParams,
  WorkingCoordinateSystem,
} from '../types/editor'

// 生成简单的UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

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

export const useEditorStore = defineStore('editor', () => {
  // 多方案状态
  const schemes = ref<HomeScheme[]>([])
  const activeSchemeId = ref<string | null>(null)

  // 全局剪贴板（支持跨方案复制粘贴）
  const clipboard = ref<AppItem[]>([])

  // 工作坐标系状态
  const workingCoordinateSystem = ref<WorkingCoordinateSystem>({
    enabled: false,
    rotationAngle: 0,
  })

  // 计算属性：当前激活的方案
  const activeScheme = computed(
    () => schemes.value.find((s) => s.id === activeSchemeId.value) ?? null
  )

  // 向后兼容的计算属性（指向当前激活方案）
  const items = computed(() => activeScheme.value?.items ?? [])
  const heightFilter = computed(
    () =>
      activeScheme.value?.heightFilter ?? {
        min: 0,
        max: 0,
        currentMin: 0,
        currentMax: 0,
      }
  )
  const selectedItemIds = computed(() => activeScheme.value?.selectedItemIds ?? new Set<string>())
  const initialViewConfig = computed(() => activeScheme.value?.initialViewConfig ?? null)

  // 计算属性：边界框
  const bounds = computed(() => {
    if (items.value.length === 0) return null

    const xs = items.value.map((i) => i.x)
    const ys = items.value.map((i) => i.y)

    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      width: maxX - minX,
      height: maxY - minY,
    }
  })

  // 计算属性：可见物品（经过高度过滤）
  const visibleItems = computed(() => {
    return items.value.filter(
      (item) => item.z >= heightFilter.value.currentMin && item.z <= heightFilter.value.currentMax
    )
  })

  // 计算属性：统计信息
  const stats = computed(() => ({
    totalItems: items.value.length,
    visibleItems: visibleItems.value.length,
    selectedItems: selectedItemIds.value.size,
    zRange: {
      min: heightFilter.value.min,
      max: heightFilter.value.max,
    },
  }))

  // 计算属性：选中的物品列表
  const selectedItems = computed(() => {
    return items.value.filter((item) => selectedItemIds.value.has(item.internalId))
  })

  // 方案管理：创建新方案
  function createScheme(name: string = '未命名方案'): string {
    const newScheme: HomeScheme = {
      id: generateUUID(),
      name,
      items: [],
      heightFilter: {
        min: 0,
        max: 0,
        currentMin: 0,
        currentMax: 0,
      },
      selectedItemIds: new Set(),
    }

    schemes.value.push(newScheme)
    activeSchemeId.value = newScheme.id

    return newScheme.id
  }

  // 方案管理：导入JSON为新方案
  function importJSONAsScheme(
    fileContent: string,
    fileName: string,
    gamePathInfo?: {
      sourceType: 'game'
      gameFilePath: string
      gameFileHandle: FileSystemFileHandle
      gameDirHandle: FileSystemDirectoryHandle
    }
  ): { success: boolean; schemeId?: string; error?: string } {
    try {
      const data: GameDataFile = JSON.parse(fileContent)

      // 检查基本结构
      if (!data.hasOwnProperty('PlaceInfo')) {
        throw new Error('Invalid JSON format: PlaceInfo field not found')
      }

      // 处理 PlaceInfo 的不同格式
      let placeInfoArray: GameItem[] = []
      if (Array.isArray(data.PlaceInfo)) {
        // PlaceInfo 是数组（正常情况）
        placeInfoArray = data.PlaceInfo
      } else if (typeof data.PlaceInfo === 'object' && data.PlaceInfo !== null) {
        // PlaceInfo 是空对象 {}（游戏未建造或清空时），视为空数组
        placeInfoArray = []
      } else {
        throw new Error('Invalid JSON format: PlaceInfo must be an array or object')
      }

      // 转换为内部数据格式（允许空数组，创建空白方案）
      const newItems: AppItem[] = placeInfoArray.map((gameItem: GameItem) => ({
        internalId: generateUUID(),
        gameId: gameItem.ItemID,
        instanceId: gameItem.InstanceID,
        x: gameItem.Location.X,
        y: gameItem.Location.Y,
        z: gameItem.Location.Z,
        originalData: gameItem,
      }))

      // 自动计算Z轴范围
      let filter: HeightFilter = {
        min: 0,
        max: 0,
        currentMin: 0,
        currentMax: 0,
      }

      if (newItems.length > 0) {
        const zValues = newItems.map((item) => item.z)
        const minZ = Math.min(...zValues)
        const maxZ = Math.max(...zValues)
        filter = {
          min: minZ,
          max: maxZ,
          currentMin: minZ,
          currentMax: maxZ,
        }
      }

      // 从文件名提取方案名称（去除.json后缀）
      const schemeName = fileName.replace(/\.json$/i, '')

      // 创建新方案
      const newScheme: HomeScheme = {
        id: generateUUID(),
        name: schemeName,
        filePath: fileName,
        items: newItems,
        heightFilter: filter,
        selectedItemIds: new Set(),
        // 如果是从游戏路径导入，添加额外信息
        ...(gamePathInfo && {
          sourceType: gamePathInfo.sourceType,
          gameFilePath: gamePathInfo.gameFilePath,
          gameFileHandle: gamePathInfo.gameFileHandle,
          gameDirHandle: gamePathInfo.gameDirHandle,
        }),
      }

      schemes.value.push(newScheme)
      activeSchemeId.value = newScheme.id

      return { success: true, schemeId: newScheme.id }
    } catch (error) {
      console.error('Failed to import JSON:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  // 方案管理：关闭方案
  function closeScheme(schemeId: string) {
    const index = schemes.value.findIndex((s) => s.id === schemeId)
    if (index === -1) return

    schemes.value.splice(index, 1)

    // 如果关闭的是当前激活方案，切换到其他方案
    if (activeSchemeId.value === schemeId) {
      if (schemes.value.length > 0) {
        // 优先切换到前一个，否则切换到第一个
        const newIndex = Math.max(0, index - 1)
        const nextScheme = schemes.value[newIndex]
        if (nextScheme) {
          activeSchemeId.value = nextScheme.id
        }
      } else {
        activeSchemeId.value = null
      }
    }
  }

  // 方案管理：切换激活方案
  function setActiveScheme(schemeId: string) {
    if (schemes.value.some((s) => s.id === schemeId)) {
      activeSchemeId.value = schemeId
    }
  }

  // 方案管理：重命名方案
  function renameScheme(schemeId: string, newName: string) {
    const scheme = schemes.value.find((s) => s.id === schemeId)
    if (scheme) {
      scheme.name = newName
    }
  }

  // 更新高度过滤器
  function updateHeightFilter(newMin: number, newMax: number) {
    if (!activeScheme.value) return
    activeScheme.value.heightFilter.currentMin = newMin
    activeScheme.value.heightFilter.currentMax = newMax
  }

  // 更新初始视图配置
  function updateInitialViewConfig(config: { scale: number; x: number; y: number }) {
    if (!activeScheme.value) return
    activeScheme.value.initialViewConfig = config
  }

  // 清空数据
  function clearData() {
    schemes.value = []
    activeSchemeId.value = null
    clipboard.value = []
  }

  // 选择功能
  function toggleSelection(itemId: string, additive: boolean) {
    if (!activeScheme.value) return

    if (additive) {
      if (activeScheme.value.selectedItemIds.has(itemId)) {
        activeScheme.value.selectedItemIds.delete(itemId)
      } else {
        activeScheme.value.selectedItemIds.add(itemId)
      }
    } else {
      activeScheme.value.selectedItemIds.clear()
      activeScheme.value.selectedItemIds.add(itemId)
    }
  }

  function updateSelection(itemIds: string[], additive: boolean) {
    if (!activeScheme.value) return

    if (!additive) {
      activeScheme.value.selectedItemIds.clear()
    }
    itemIds.forEach((id) => activeScheme.value!.selectedItemIds.add(id))
  }

  function clearSelection() {
    if (!activeScheme.value) return
    activeScheme.value.selectedItemIds.clear()
  }

  // 移动选中物品
  function moveSelectedItems(dx: number, dy: number) {
    if (!activeScheme.value) return

    activeScheme.value.items = activeScheme.value.items.map((item) => {
      if (activeScheme.value!.selectedItemIds.has(item.internalId)) {
        return {
          ...item,
          x: item.x + dx,
          y: item.y + dy,
          originalData: {
            ...item.originalData,
            Location: {
              ...item.originalData.Location,
              X: item.x + dx,
              Y: item.y + dy,
            },
          },
        }
      }
      return item
    })
  }

  // 复制选中物品（带偏移）
  function duplicateSelected(offsetX: number = 50, offsetY: number = 50): string[] {
    if (!activeScheme.value) return []

    const newIds: string[] = []
    const duplicates: AppItem[] = []
    let nextInstanceId = getNextInstanceId()

    activeScheme.value.items.forEach((item) => {
      if (activeScheme.value!.selectedItemIds.has(item.internalId)) {
        const newId = generateUUID()
        const newInstanceId = nextInstanceId++
        newIds.push(newId)

        const newX = item.x + offsetX
        const newY = item.y + offsetY

        duplicates.push({
          ...item,
          internalId: newId,
          instanceId: newInstanceId,
          x: newX,
          y: newY,
          originalData: {
            ...item.originalData,
            InstanceID: newInstanceId,
            Location: {
              ...item.originalData.Location,
              X: newX,
              Y: newY,
            },
          },
        })
      }
    })

    activeScheme.value.items.push(...duplicates)

    // 选中新副本
    activeScheme.value.selectedItemIds.clear()
    newIds.forEach((id) => activeScheme.value!.selectedItemIds.add(id))

    return newIds
  }

  // 删除选中物品
  function deleteSelected() {
    if (!activeScheme.value) return

    activeScheme.value.items = activeScheme.value.items.filter(
      (item) => !activeScheme.value!.selectedItemIds.has(item.internalId)
    )
    activeScheme.value.selectedItemIds.clear()
  }

  // 全选可见物品
  function selectAll() {
    if (!activeScheme.value) return

    activeScheme.value.selectedItemIds.clear()
    visibleItems.value.forEach((item) => {
      activeScheme.value!.selectedItemIds.add(item.internalId)
    })
  }

  // 反选
  function invertSelection() {
    if (!activeScheme.value) return

    const newSelection = new Set<string>()
    visibleItems.value.forEach((item) => {
      if (!activeScheme.value!.selectedItemIds.has(item.internalId)) {
        newSelection.add(item.internalId)
      }
    })
    activeScheme.value.selectedItemIds = newSelection
  }

  // 获取下一个唯一的 InstanceID（自增策略）
  function getNextInstanceId(): number {
    if (!activeScheme.value || activeScheme.value.items.length === 0) return 1

    const maxId = activeScheme.value.items.reduce((max, item) => Math.max(max, item.instanceId), 0)
    return maxId + 1
  }

  // 跨方案剪贴板：复制到剪贴板
  function copyToClipboard() {
    if (!activeScheme.value) return

    clipboard.value = activeScheme.value.items
      .filter((item) => activeScheme.value!.selectedItemIds.has(item.internalId))
      .map((item) => ({ ...item })) // 深拷贝
  }

  // 跨方案剪贴板：剪切到剪贴板
  function cutToClipboard() {
    copyToClipboard()
    deleteSelected()
  }

  // 跨方案剪贴板：从剪贴板粘贴
  function pasteFromClipboard(offsetX: number = 50, offsetY: number = 50): string[] {
    if (!activeScheme.value || clipboard.value.length === 0) return []

    return pasteItems(clipboard.value, offsetX, offsetY)
  }

  // 粘贴物品（内部方法）
  function pasteItems(clipboardItems: AppItem[], offsetX: number, offsetY: number): string[] {
    if (!activeScheme.value) return []

    const newIds: string[] = []
    const newItems: AppItem[] = []
    let nextInstanceId = getNextInstanceId()

    clipboardItems.forEach((item) => {
      const newId = generateUUID()
      const newInstanceId = nextInstanceId++
      newIds.push(newId)

      const newX = item.x + offsetX
      const newY = item.y + offsetY

      newItems.push({
        ...item,
        internalId: newId,
        instanceId: newInstanceId,
        x: newX,
        y: newY,
        originalData: {
          ...item.originalData,
          InstanceID: newInstanceId,
          Location: {
            ...item.originalData.Location,
            X: newX,
            Y: newY,
          },
        },
      })
    })

    activeScheme.value.items.push(...newItems)

    // 选中新粘贴的物品
    activeScheme.value.selectedItemIds.clear()
    newIds.forEach((id) => activeScheme.value!.selectedItemIds.add(id))

    return newIds
  }

  // 精确变换选中物品（位置和旋转）
  function updateSelectedItemsTransform(params: TransformParams) {
    if (!activeScheme.value) return

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

  // 获取选中物品的中心坐标（用于UI显示）
  function getSelectedItemsCenter(): { x: number; y: number; z: number } | null {
    const selected = selectedItems.value
    if (selected.length === 0) return null

    return {
      x: selected.reduce((sum, item) => sum + item.x, 0) / selected.length,
      y: selected.reduce((sum, item) => sum + item.y, 0) / selected.length,
      z: selected.reduce((sum, item) => sum + item.z, 0) / selected.length,
    }
  }

  // 设置工作坐标系
  function setWorkingCoordinateSystem(enabled: boolean, angle: number) {
    workingCoordinateSystem.value.enabled = enabled
    workingCoordinateSystem.value.rotationAngle = angle
  }

  // 工作坐标系坐标转换：工作坐标系 -> 全局坐标系
  function workingToGlobal(point: {
    x: number
    y: number
    z: number
  }): { x: number; y: number; z: number } {
    if (!workingCoordinateSystem.value.enabled) {
      return point
    }

    const angleRad = (workingCoordinateSystem.value.rotationAngle * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)

    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
      z: point.z,
    }
  }

  // 工作坐标系坐标转换：全局坐标系 -> 工作坐标系
  function globalToWorking(point: {
    x: number
    y: number
    z: number
  }): { x: number; y: number; z: number } {
    if (!workingCoordinateSystem.value.enabled) {
      return point
    }

    const angleRad = (-workingCoordinateSystem.value.rotationAngle * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)

    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
      z: point.z,
    }
  }

  return {
    // 多方案状态
    schemes,
    activeSchemeId,
    activeScheme,
    clipboard,

    // 向后兼容的计算属性
    items,
    heightFilter,
    bounds,
    visibleItems,
    stats,
    selectedItemIds,
    selectedItems,
    initialViewConfig,

    // 方案管理
    createScheme,
    importJSONAsScheme,
    closeScheme,
    setActiveScheme,
    renameScheme,
    updateHeightFilter,
    updateInitialViewConfig,
    clearData,

    // 选择操作
    toggleSelection,
    updateSelection,
    clearSelection,
    selectAll,
    invertSelection,

    // 编辑操作
    moveSelectedItems,
    duplicateSelected,
    deleteSelected,
    updateSelectedItemsTransform,
    getSelectedItemsCenter,

    // 跨方案剪贴板
    copyToClipboard,
    cutToClipboard,
    pasteFromClipboard,
    pasteItems,

    // 工作坐标系
    workingCoordinateSystem,
    setWorkingCoordinateSystem,
    workingToGlobal,
    globalToWorking,
  }
})
