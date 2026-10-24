import { computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { groupMetadataInput, inheritGroupMetadata } from '@/lib/groupMetadataInheritance'
import { useEditorHistory } from './useEditorHistory'

export function useGroupMetadataImport() {
  const store = useEditorStore()
  const cloud = useCloudSchemeStore()
  const { recordTransaction } = useEditorHistory()
  const canImport = computed(() => {
    const target = store.activeScheme
    return (
      !!target &&
      (target.source.value !== 'cloud' ||
        (target.collectionsSupported.value && cloud.isConnected && cloud.schemeId === target.id))
    )
  })

  function preview(sourceId: string) {
    const source = store.getSchemeById(sourceId)
    const target = store.activeScheme
    if (!source || !target || source.id === target.id) return null
    return inheritGroupMetadata(groupMetadataInput(source), groupMetadataInput(target))
  }

  function importFrom(sourceId: string, targetId: string) {
    if (!canImport.value || store.activeSchemeId !== targetId) return null
    const target = store.activeScheme!
    // 提交时重新读取，不能应用弹窗打开时缓存的方案数据。
    const result = preview(sourceId)
    if (!result?.changedGroupCount) return null
    recordTransaction('group.importMetadata', () => {
      target.collectionTree.value = result.collectionTree
      if (result.groupOrigins !== target.groupOrigins.value) {
        target.groupOrigins.value = new Map(result.groupOrigins)
      }
      if (store.constrainSelectionToEditable()) store.triggerSelectionUpdate()
    })
    return result
  }
  return { canImport, preview, importFrom }
}
