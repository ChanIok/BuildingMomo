import { useEditorStore } from '@/stores/editorStore'
import { useCloudSchemeStore } from '@/stores/cloudSchemeStore'
import { useEditorHistory } from './useEditorHistory'
import { getCollectionItems } from '@/lib/selectionReference'

export function useEditorCollectionOrigins() {
  const store = useEditorStore()
  const cloud = useCloudSchemeStore()
  const { recordTransaction } = useEditorHistory()

  function canEditCollectionOrigin(id: string) {
    const scheme = store.activeScheme
    if (!scheme || !scheme.collectionTree.value.nodes.some((node) => node.id === id)) return false
    if (
      scheme.source.value === 'cloud' &&
      (!scheme.collectionsSupported.value || !cloud.isConnected || cloud.schemeId !== scheme.id)
    )
      return false
    const members = getCollectionItems(scheme.collectionTree.value, scheme.items.value, id)
    return members.length > 0 && members.every((item) => store.isItemEditable(item.internalId))
  }

  function setCollectionOrigin(id: string, itemId: string) {
    const scheme = store.activeScheme
    if (!scheme || !canEditCollectionOrigin(id)) return false
    const members = getCollectionItems(scheme.collectionTree.value, scheme.items.value, id)
    if (!members.some((item) => item.internalId === itemId)) return false
    if (scheme.collectionTree.value.nodes.find((node) => node.id === id)?.originItemId === itemId)
      return true
    recordTransaction('collection.origin.set', () => {
      scheme.collectionTree.value = {
        ...scheme.collectionTree.value,
        nodes: scheme.collectionTree.value.nodes.map((node) =>
          node.id === id ? { ...node, originItemId: itemId } : node
        ),
      }
    })
    return true
  }

  function clearCollectionOrigin(id: string) {
    const scheme = store.activeScheme
    if (
      !scheme ||
      !canEditCollectionOrigin(id) ||
      !scheme.collectionTree.value.nodes.find((node) => node.id === id)?.originItemId
    )
      return
    recordTransaction('collection.origin.clear', () => {
      scheme.collectionTree.value = {
        ...scheme.collectionTree.value,
        nodes: scheme.collectionTree.value.nodes.map((node) => {
          if (node.id !== id) return node
          const { originItemId: _origin, ...rest } = node
          return rest
        }),
      }
    })
  }

  return { canEditCollectionOrigin, setCollectionOrigin, clearCollectionOrigin }
}
