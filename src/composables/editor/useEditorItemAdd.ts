import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import type { AppItem } from '../../types/editor'
import type {
  FurnitureCombinationColorPreset,
  FurnitureCombinationMember,
} from '../../types/furniture'

// 生成简单的UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// 位置获取函数（由 ThreeEditor 注册）- 单例模式，所有调用共享同一个 ref
const getAddPositionFn = ref<(() => [number, number, number] | null) | null>(null)

function getAddPosition(): [number, number, number] {
  if (!getAddPositionFn.value) {
    console.warn('[EditorItemAdd] Position function not registered, using default')
    return [0, 0, 0]
  }

  const position = getAddPositionFn.value()
  if (position) return position

  console.warn('[EditorItemAdd] Raycast failed, using fallback position')
  return [0, 0, 0]
}

/**
 * 添加物品到场景的 Composable
 *
 * 提供：
 * - addFurnitureItem: 添加家具物品
 * - getAddPositionFn: 位置获取函数（由 ThreeEditor 注册）
 */
export function useEditorItemAdd() {
  const editorStore = useEditorStore()
  const { activeScheme } = storeToRefs(editorStore)
  const { recordTransaction } = useEditorHistory()

  /**
   * 添加家具物品到当前方案
   * @param itemId 家具的 ItemID（游戏ID）
   * @returns 新创建的 AppItem，如果失败返回 null
   */
  function addFurnitureItem(itemId: number): AppItem | null {
    const scheme = activeScheme.value
    if (!scheme) {
      console.warn('[EditorItemAdd] No active scheme')
      return null
    }

    // 1. 获取添加位置（屏幕中心射线检测结果）
    const position = getAddPosition()

    // 2. 分配 Instance ID
    const instanceId = ++scheme.maxInstanceId.value

    // 3. 创建新物品
    const newItem: AppItem = {
      internalId: generateUUID(),
      gameId: itemId,
      instanceId,
      x: position[0],
      y: position[1], // 注意：position 已经是游戏坐标系（Y 已转换）
      z: position[2],
      rotation: {
        x: 0, // Roll
        y: 0, // Pitch
        z: 0, // Yaw
      },
      groupId: 0, // 未成组
      extra: {
        Scale: { X: 1, Y: 1, Z: 1 },
        AttachID: 0,
        TempInfo: {},
        ColorMap: { '0': 0 },
      },
    }

    recordTransaction('item.add', () => {
      // 4. 添加到场景（创建新数组以触发推断引擎）
      scheme.items.value = [...scheme.items.value, newItem]
      editorStore.triggerSceneUpdate()
      scheme.selectedItemIds.value = new Set([newItem.internalId])
      editorStore.triggerSelectionUpdate()
    })

    console.log('[EditorItemAdd] Added item:', {
      gameId: itemId,
      instanceId,
      position,
    })

    return newItem
  }

  function addFurnitureCombination(
    members: FurnitureCombinationMember[],
    colorPreset?: FurnitureCombinationColorPreset
  ): AppItem[] | null {
    const scheme = activeScheme.value
    if (!scheme || members.length === 0) return null
    if (colorPreset && colorPreset.colorMaps.length !== members.length) {
      console.warn('[EditorItemAdd] Combination color preset does not match its members')
      return null
    }

    const position = getAddPosition()
    const groupId = scheme.maxGroupId.value + 1
    let instanceId = scheme.maxInstanceId.value
    const newItems = members.map((member, index): AppItem => {
      instanceId++
      return {
        internalId: generateUUID(),
        gameId: member.itemId,
        instanceId,
        x: position[0] + member.position[0],
        y: position[1] + member.position[1],
        z: position[2] + member.position[2],
        rotation: {
          x: member.rotation[0],
          y: member.rotation[1],
          z: member.rotation[2],
        },
        groupId,
        extra: {
          Scale: { X: member.scale[0], Y: member.scale[1], Z: member.scale[2] },
          AttachID: 0,
          TempInfo: {},
          ColorMap: colorPreset ? { ...colorPreset.colorMaps[index] } : { '0': 0 },
        },
      }
    })

    recordTransaction('item.add.combination', () => {
      scheme.items.value = [...scheme.items.value, ...newItems]
      scheme.maxInstanceId.value = instanceId
      scheme.maxGroupId.value = groupId
      scheme.selectedItemIds.value = new Set(newItems.map((item) => item.internalId))
      editorStore.triggerSceneUpdate()
      editorStore.triggerSelectionUpdate()
    })

    return newItems
  }

  return {
    addFurnitureItem,
    addFurnitureCombination,
    getAddPositionFn,
  }
}
