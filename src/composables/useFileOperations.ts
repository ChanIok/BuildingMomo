import { ref } from 'vue'
import type { useEditorStore } from '../stores/editorStore'
import type { GameDataFile, GameItem } from '../types/editor'

export function useFileOperations(
  editorStore: ReturnType<typeof useEditorStore>,
  onImportSuccess?: () => void
) {
  const fileInputRef = ref<HTMLInputElement | null>(null)

  // 导入 JSON 文件
  async function importJSON(): Promise<void> {
    return new Promise((resolve) => {
      // 创建临时的文件选择器
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'

      input.onchange = (event: Event) => {
        const target = event.target as HTMLInputElement
        const file = target.files?.[0]

        if (!file) {
          resolve()
          return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
          const content = e.target?.result as string
          const result = editorStore.importJSON(content)

          if (result.success) {
            console.log(`[FileOps] Successfully imported ${result.itemCount} items`)
            // 导入成功后调用回调
            onImportSuccess?.()
          } else {
            alert(`导入失败: ${result.error}`)
          }

          resolve()
        }

        reader.onerror = () => {
          alert('文件读取失败')
          resolve()
        }

        reader.readAsText(file)
      }

      // 触发文件选择
      input.click()
    })
  }

  // 导出 JSON 文件
  function exportJSON(filename?: string): void {
    if (editorStore.items.length === 0) {
      alert('没有可导出的数据')
      return
    }

    // 将 AppItem[] 转换回 GameItem[]
    const gameItems: GameItem[] = editorStore.items.map((item) => ({
      ...item.originalData,
      Location: {
        X: item.x,
        Y: item.y,
        Z: item.z,
      },
    }))

    // 构造导出数据
    const exportData: GameDataFile = {
      NeedRestore: true,
      PlaceInfo: gameItems,
    }

    // 生成 JSON 字符串
    const jsonString = JSON.stringify(exportData, null, 2)

    // 创建 Blob 并下载
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = filename || `edited_${Date.now()}.json`
    link.click()

    // 清理
    URL.revokeObjectURL(url)

    console.log(`[FileOps] Exported ${gameItems.length} items to ${link.download}`)
  }

  return {
    fileInputRef,
    importJSON,
    exportJSON,
  }
}
