import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '../../stores/editorStore'
import { useEditorHistory } from './useEditorHistory'
import type { AppItem } from '../../types/editor'

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
  const { saveHistory } = useEditorHistory()

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
    let position: [number, number, number]

    if (getAddPositionFn.value) {
      const hitPosition = getAddPositionFn.value()
      if (hitPosition) {
        position = hitPosition
      } else {
        // 射线检测失败：使用视野中心，Z=0（地面）
        console.warn('[EditorItemAdd] Raycast failed, using fallback position')
        position = [0, 0, 0]
      }
    } else {
      // 位置函数未注册：使用默认位置
      console.warn('[EditorItemAdd] Position function not registered, using default')
      position = [0, 0, 0]
    }

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
      },
    }

    // 4. 保存历史记录（用于撤销）
    saveHistory('edit')

    // 5. 添加到场景（创建新数组以触发响应式更新）
    scheme.items.value = [...scheme.items.value, newItem]

    // 6. 触发场景更新
    editorStore.triggerSceneUpdate()

    // 7. 自动选中新物品
    scheme.selectedItemIds.value = new Set([newItem.internalId])
    editorStore.triggerSelectionUpdate()

    console.log('[EditorItemAdd] Added item:', {
      gameId: itemId,
      instanceId,
      position,
    })

    return newItem
  }

  return {
    addFurnitureItem,
    getAddPositionFn,
  }
}
