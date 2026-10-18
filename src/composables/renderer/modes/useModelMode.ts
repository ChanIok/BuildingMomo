import { markRaw, shallowRef } from 'vue'
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three'
import { resolveCustomData } from '@nuan5-pro/render/furniture'
import type { FurnitureInstance } from '@nuan5-pro/render'
import type { AppItem } from '@/types/editor'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { furnitureRender, readyFurnitureRender } from '@/composables/useFurnitureRender'
import { decodeColorMapToGroupMap } from '@/lib/colorMap'
import {
  applyScaleRenderCompensationToPositionInPlace,
  resolveDisplayGeometryInfo,
} from '@/lib/scaleRenderCompensation'
import { resolveFurnitureSize } from '@/lib/slidePath'
import { invalidateScene } from '@/composables/useSceneInvalidate'
import { createBoxMaterial } from '@nuan5-pro/render'
import { nextInstancedPoolCapacity, requiredInstanceCount } from '@/lib/renderInstanceBudget'

export const MODEL_FALLBACK_MESH_KEY = '-1'

export function useModelMode() {
  const editorStore = useEditorStore(),
    gameDataStore = useGameDataStore()
  const loadingStore = useLoadingStore(),
    settingsStore = useSettingsStore()
  const meshMap = shallowRef(new Map<string, InstancedMesh>())
  const indexToIdMap = shallowRef(new Map<number, string>())
  const idToIndexMap = shallowRef(new Map<string, number>())
  const meshToLocalIndexMap = shallowRef(new Map<InstancedMesh, Map<number, string>>())
  const internalIdToMeshInfo = shallowRef(
    new Map<string, { meshKey: string; localIndex: number }>()
  )
  const fallbackMesh = shallowRef<InstancedMesh | null>(null)
  const fallbackGeometry = new BoxGeometry(1, 1, 1).translate(0, 0, 0.5)
  const position = new Vector3(),
    scale = new Vector3(),
    rotation = new Euler(),
    quaternion = new Quaternion()
  let controller = new AbortController()
  let loadingSession: number | undefined
  let scheme: typeof editorStore.activeScheme = null
  let profile = ''
  let previous = new Map<string, AppItem>()
  let renderVersion = -1
  let structureChanged = true
  let changedItems: AppItem[] = []
  const failedAssets = new Set<number>()

  function matrixFor(item: AppItem, model: boolean): Matrix4 {
    position.set(item.x, item.y, item.z)
    rotation.set(
      (-item.rotation.x * Math.PI) / 180,
      (-item.rotation.y * Math.PI) / 180,
      (item.rotation.z * Math.PI) / 180,
      'ZYX'
    )
    quaternion.setFromEuler(rotation)
    const size = resolveFurnitureSize(
      item.gameId,
      gameDataStore.getFurnitureSize(item.gameId) ?? [100, 100, 150]
    )
    const display = model
      ? resolveDisplayGeometryInfo(item, {
          currentMode: 'model',
          getFurnitureSize: () => size,
          getModelConfig: (id) => gameDataStore.getFurnitureModelConfig(id),
          getModelBoundingBox: (id) => furnitureRender.value?.getModelBounds(id) ?? null,
        })
      : { sizeX: size[0], sizeY: size[1] }
    applyScaleRenderCompensationToPositionInPlace(position, item, quaternion, display)
    scale.set(item.extra.Scale.Y || 1, item.extra.Scale.X || 1, item.extra.Scale.Z || 1)
    if (!model) scale.multiply(new Vector3(...size))
    return new Matrix4().compose(position, quaternion, scale)
  }

  function syncMappings(items: readonly AppItem[], fallback: AppItem[]) {
    const layer = furnitureRender.value!
    meshMap.value = new Map([...layer.batches].map(([id, mesh]) => [String(id), markRaw(mesh)]))
    const local = new Map<InstancedMesh, Map<number, string>>()
    const info = new Map<string, { meshKey: string; localIndex: number }>()
    const ids = new Map<number, string>(),
      indexes = new Map<string, number>()
    const capacity = nextInstancedPoolCapacity(
      fallback.length,
      fallbackMesh.value?.instanceMatrix.count ?? 0
    )
    if (!fallbackMesh.value || capacity > fallbackMesh.value.instanceMatrix.count) {
      const old = fallbackMesh.value
      if (old) {
        old.dispose()
        ;(old.material as any).dispose()
      }
      const mesh = new InstancedMesh(
        fallbackGeometry,
        createBoxMaterial(0.9),
        Math.max(32, capacity)
      )
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.matrixAutoUpdate = false
      fallbackMesh.value = markRaw(mesh)
    }
    fallbackMesh.value.count = fallback.length
    fallback.forEach((item, index) => {
      fallbackMesh.value!.setMatrixAt(index, matrixFor(item, false))
      fallbackMesh.value!.setColorAt(index, new Color(1, 1, 1))
      info.set(item.internalId, { meshKey: MODEL_FALLBACK_MESH_KEY, localIndex: index })
    })
    fallbackMesh.value.instanceMatrix.needsUpdate = true
    if (fallbackMesh.value.instanceColor) fallbackMesh.value.instanceColor.needsUpdate = true
    fallbackMesh.value.computeBoundingSphere()
    for (const item of items) {
      const instance = layer.getInstance(item.internalId)
      const fallbackInfo = info.get(item.internalId)
      const mesh = instance?.mesh ?? (fallbackInfo ? fallbackMesh.value : null)
      const index = instance?.index ?? fallbackInfo?.localIndex
      if (!mesh || index === undefined) continue
      if (instance) info.set(item.internalId, { meshKey: String(item.gameId), localIndex: index })
      let map = local.get(mesh)
      if (!map) {
        map = new Map()
        local.set(mesh, map)
      }
      map.set(index, item.internalId)
      indexes.set(item.internalId, ids.size)
      ids.set(ids.size, item.internalId)
    }
    indexToIdMap.value = ids
    idToIndexMap.value = indexes
    meshToLocalIndexMap.value = local
    internalIdToMeshInfo.value = info
  }

  function syncChangedModels(changes: Map<string, AppItem | null>) {
    const layer = furnitureRender.value!
    const affected = new Set<number>()
    for (const [id, item] of changes) {
      const old = previous.get(id)
      if (old) affected.add(old.gameId)
      if (item) affected.add(item.gameId)
      const index = idToIndexMap.value.get(id)
      if (!item && index !== undefined) {
        const last = indexToIdMap.value.size - 1
        const moved = indexToIdMap.value.get(last)!
        if (index !== last) {
          indexToIdMap.value.set(index, moved)
          idToIndexMap.value.set(moved, index)
        }
        indexToIdMap.value.delete(last)
        idToIndexMap.value.delete(id)
        internalIdToMeshInfo.value.delete(id)
      } else if (item && index === undefined) {
        const next = indexToIdMap.value.size
        indexToIdMap.value.set(next, id)
        idToIndexMap.value.set(id, next)
      }
      if (item) previous.set(id, item)
      else previous.delete(id)
    }
    for (const id of affected) {
      const key = String(id),
        old = meshMap.value.get(key)
      if (old) meshToLocalIndexMap.value.delete(old)
      const ids = layer.getBatchInstances(id)
      if (!ids.length) {
        meshMap.value.delete(key)
        continue
      }
      const mesh = markRaw(layer.getInstance(ids[0]!)!.mesh)
      const local = new Map<number, string>()
      ids.forEach((instanceId, index) => {
        local.set(index, instanceId)
        internalIdToMeshInfo.value.set(instanceId, { meshKey: key, localIndex: index })
      })
      meshMap.value.set(key, mesh)
      meshToLocalIndexMap.value.set(mesh, local)
    }
  }

  async function rebuild(options?: { isStale?: () => boolean }): Promise<boolean> {
    cancelPending()
    controller = new AbortController()
    const signal = controller.signal
    const current = editorStore.activeScheme
    const selection = {
      model: settingsStore.settings.modelAssetProfile,
      material: settingsStore.settings.materialAssetProfile,
    }
    const key = `${selection.model}:${selection.material}:${gameDataStore.furnitureDBRevision}`
    const stale = () =>
      signal.aborted || options?.isStale?.() || editorStore.activeScheme !== current
    let session = furnitureRender.value
      ? undefined
      : loadingStore.startLoading('model', 2, 'parallel')
    loadingSession = session
    try {
      const layer = await readyFurnitureRender()
      if (stale()) return false
      const resuming = !layer.root.visible
      layer.root.visible = current === scheme
      const changes =
        current === scheme && key === profile && current
          ? editorStore.getRenderChanges(current.id, renderVersion)
          : null
      if (
        !resuming &&
        changes &&
        [...changes].every(
          ([id, item]) => item && previous.get(id)?.gameId === item.gameId && layer.getInstance(id)
        )
      ) {
        const matrices = [],
          dyes = []
        changedItems = []
        for (const [id, item] of changes) {
          if (!item) continue
          changedItems.push(item)
          matrices.push({ id, matrix: matrixFor(item, true) })
          dyes.push({
            id,
            values: resolveCustomData(
              layer.getConfig(item.gameId)!,
              decodeColorMapToGroupMap(item.extra.ColorMap)
            ),
          })
          previous.set(id, item)
        }
        layer.updateMatrices(matrices)
        layer.updateDyes(dyes)
        renderVersion = editorStore.sceneVersion
        structureChanged = false
        return true
      }
      // Structural model edits rebuild only the affected batches' slot maps. The
      // scene-wide snapshot path remains for imports, tier changes and fallbacks.
      if (
        !resuming &&
        changes &&
        [...changes].every(
          ([id, item]) =>
            (!previous.has(id) || !!layer.getInstance(id)) &&
            (!item || (!!layer.getConfig(item.gameId) && !failedAssets.has(item.gameId)))
        )
      ) {
        const items = [...changes.values()].filter((item): item is AppItem => !!item)
        try {
          await layer.load([...new Set(items.map((item) => item.gameId))], { signal })
          if (stale()) return false
          layer.remove([...changes].filter(([, item]) => !item).map(([id]) => id))
          await layer.upsert(
            items.map((item) => ({
              id: item.internalId,
              assetId: item.gameId,
              matrix: matrixFor(item, true),
              customData: resolveCustomData(
                layer.getConfig(item.gameId)!,
                decodeColorMapToGroupMap(item.extra.ColorMap)
              ),
            })),
            { signal }
          )
          if (stale()) return false
          syncChangedModels(changes)
          renderVersion = editorStore.sceneVersion
          structureChanged = true
          invalidateScene()
          return true
        } catch (error) {
          if (stale()) return false
          console.warn('[ModelMode] Incremental asset load failed; rebuilding with fallback', error)
        }
      }
      structureChanged = true
      const items = (current?.items.value ?? []).slice(
        0,
        requiredInstanceCount(current?.items.value.length ?? 0)
      )
      let models = items.filter((item) => layer.getConfig(item.gameId))
      const fallback = items.filter((item) => !layer.getConfig(item.gameId))
      const changed = models.filter((item) => previous.get(item.internalId) !== item)
      const tierChange = current === scheme && key !== profile
      const replace = current !== scheme
      const assetIds = [...new Set((replace ? models : changed).map((item) => item.gameId))]
      const totalAssets = tierChange
        ? new Set(models.map((item) => item.gameId)).size
        : assetIds.length
      session = loadingStore.startLoading('model', totalAssets * 2, 'parallel')
      loadingSession = session
      let preloaded = false
      let loadedAssets = 0
      let preparedAssets = 0
      let progressTotal = totalAssets
      const reportProgress = () => {
        if (stale() || session === undefined || progressTotal <= 0) return
        const loading = loadedAssets < progressTotal
        loadingStore.setPhase(loading ? 'network' : 'shaders', progressTotal * 2, session)
        loadingStore.updateParallelProgress(
          loadedAssets,
          preparedAssets,
          failedAssets.size,
          session
        )
      }
      const task = {
        signal,
        onProgress: (progress: { phase: string; completed: number; total: number }) => {
          // Resource/preparation counts are assets; ready counts are instances.
          if (stale() || session === undefined || progress.total <= 0 || progress.phase === 'ready')
            return
          // Preloads already prepared the retained batches; assembly only rechecks them.
          if (preloaded) return
          progressTotal = progress.total
          if (progress.phase === 'loading') loadedAssets = progress.completed
          else preparedAssets = progress.completed
          reportProgress()
        },
      }
      // The old scheme is hidden. Remove its instances without discarding
      // same-tier assets/programs, so preloading and replacement share one store.
      if (replace) {
        const ids: string[] = []
        for (const assetId of layer.batches.keys()) {
          const batch = layer.getBatchInstances(assetId)
          // Remove from the tail to avoid copying slots in a discarded batch.
          for (let i = batch.length - 1; i >= 0; i--) ids.push(batch[i]!)
        }
        if (ids.length) layer.remove(ids)
      }
      if (stale()) return false
      if (key !== profile) {
        await layer.setTiers(selection, task)
      }
      if (replace) failedAssets.clear()
      if (assetIds.length) {
        progressTotal = assetIds.length
        loadedAssets = preparedAssets = 0
        loadingStore.setPhase('network', progressTotal * 2, session)
      }
      await Promise.all(
        assetIds.map(async (id) => {
          let loaded = false
          let prepared = false
          try {
            await layer.load([id], {
              signal,
              onProgress: ({ phase }) => {
                if (phase === 'loading') {
                  loaded = true
                  loadedAssets++
                } else if (phase === 'preparing') {
                  prepared = true
                  preparedAssets++
                }
                reportProgress()
              },
            })
            failedAssets.delete(id)
          } catch (error) {
            if (stale()) return
            failedAssets.add(id)
            console.warn(`[ModelMode] Asset ${id} failed; using fallback`, error)
          } finally {
            if (!loaded) loadedAssets++
            if (!prepared) preparedAssets++
            reportProgress()
          }
        })
      )
      if (stale()) return false
      if (assetIds.length && session !== undefined) {
        preloaded = true
      }
      fallback.push(...models.filter((item) => failedAssets.has(item.gameId)))
      models = models.filter((item) => !failedAssets.has(item.gameId))
      const renderItems = (
        replace ? models : changed.filter((item) => !failedAssets.has(item.gameId))
      ).map((item): FurnitureInstance => ({
        id: item.internalId,
        assetId: item.gameId,
        matrix: matrixFor(item, true),
        customData: resolveCustomData(
          layer.getConfig(item.gameId)!,
          decodeColorMapToGroupMap(item.extra.ColorMap)
        ),
      }))
      if (replace) await layer.replaceAll(renderItems, task)
      else {
        const ids = new Set(models.map((item) => item.internalId))
        layer.remove([...previous.keys()].filter((id) => !ids.has(id)))
        if (renderItems.length) await layer.upsert(renderItems, task)
      }
      if (tierChange)
        layer.updateMatrices(
          models.map((item) => ({ id: item.internalId, matrix: matrixFor(item, true) }))
        )
      if (stale()) return false
      previous = new Map(items.map((item) => [item.internalId, item]))
      scheme = current
      profile = key
      renderVersion = editorStore.sceneVersion
      syncMappings(items, fallback)
      layer.root.visible = true
      if (session !== undefined) loadingStore.finishLoading(session)
      invalidateScene()
      return true
    } catch (error) {
      if (stale()) return false
      if (session === undefined) {
        session = loadingStore.startLoading('model', 2, 'parallel')
        loadingSession = session
      }
      loadingStore.failLoading(error, session)
      throw error
    } finally {
      if (stale() && session !== undefined) loadingStore.cancelLoading(session)
    }
  }

  function cancelPending() {
    controller.abort()
    if (loadingSession !== undefined) loadingStore.cancelLoading(loadingSession)
    loadingSession = undefined
  }

  function clearScene() {
    cancelPending()
    previous.clear()
    scheme = null
    if (furnitureRender.value) furnitureRender.value.root.visible = false
    if (fallbackMesh.value) fallbackMesh.value.count = 0
    meshMap.value = new Map()
    indexToIdMap.value = new Map()
    idToIndexMap.value = new Map()
    meshToLocalIndexMap.value = new Map()
    internalIdToMeshInfo.value = new Map()
  }

  return {
    meshMap,
    indexToIdMap,
    idToIndexMap,
    meshToLocalIndexMap,
    internalIdToMeshInfo,
    fallbackMesh,
    get structureChanged() {
      return structureChanged
    },
    get changedItems() {
      return changedItems
    },
    rebuild,
    clearScene,
    cancelPending,
    setVisible(visible: boolean) {
      if (furnitureRender.value) furnitureRender.value.root.visible = visible
    },
    updateMatrices(values: Map<string, Matrix4>) {
      const inverse = furnitureRender.value?.root.matrixWorld.clone().invert()
      if (!inverse) return
      furnitureRender.value?.updateMatrices(
        [...values].map(([id, matrix]) => ({ id, matrix: inverse.clone().multiply(matrix) }))
      )
    },
    dispose() {
      clearScene()
      fallbackMesh.value?.dispose()
      if (fallbackMesh.value) (fallbackMesh.value.material as any).dispose()
      fallbackGeometry.dispose()
      fallbackMesh.value = null
    },
  }
}
