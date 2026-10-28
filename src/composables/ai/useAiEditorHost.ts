import { onScopeDispose } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { furnitureRender } from '@/composables/useFurnitureRender'
import { useEditorOrganization } from '@/composables/editor/useEditorOrganization'
import { createAnalysisSnapshot } from '@/lib/sceneAnalysis/snapshot'
import { createAnalysisRenderSnapshot } from '@/lib/sceneAnalysis/renderSnapshot'
import { getAnalysisBounds } from '@/lib/sceneAnalysis/geometry'
import { renderAnalysisAtlas } from '@/lib/sceneAnalysis/catalogAtlas'
import { composeBoard } from '@/lib/sceneAnalysis/board'
import {
  organizationPostcondition,
  verifyOrganization,
} from '@/lib/sceneAnalysis/organizationState'
import { AiError, assertNotAborted, type EditorHost } from '@/lib/ai/types'
import type { AnalysisCaptureProvider, AnalysisImageOutput } from '@/lib/sceneAnalysis/images'

/** Captures explicit targets per operation; never owns a conversation-wide selection. */
export function useAiEditorHost(
  options: { getCaptureProvider?: () => AnalysisCaptureProvider | null } = {}
) {
  const editor = useEditorStore(),
    game = useGameDataStore(),
    settings = useSettingsStore()
  const organization = useEditorOrganization()
  const provider = options.getCaptureProvider ?? (() => null)
  const epoch = crypto.randomUUID()
  const revisions = new Map<string, { tokens: unknown[]; revision: number }>()
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })
  function getScheme(id: string) {
    if (disposed) throw new AiError('cancelled')
    const scheme = editor.getSchemeById(id)
    if (!scheme) throw new AiError('scope', `Scheme is not loaded: ${id}`)
    return scheme
  }
  const geometry = () => ({
    getFurnitureSize: game.getFurnitureSize,
    getModelConfig: game.getFurnitureModelConfig,
    getModelBoundingBox: (id: number) => furnitureRender.value?.getModelBounds(id) ?? null,
  })
  function revision(id: string) {
    const s = getScheme(id)
    const tokens = [
      s,
      s.items.value,
      s.collectionTree.value,
      s.groupOrigins.value,
      s.hiddenGroupIds.value,
      s.lockedGroupIds.value,
      s.hiddenCollectionIds.value,
      s.lockedCollectionIds.value,
      game.furnitureDBRevision,
    ]
    const previous = revisions.get(id)
    const changed = !previous || tokens.some((v, i) => previous.tokens[i] !== v)
    const next = changed ? { tokens, revision: (previous?.revision ?? 0) + 1 } : previous!
    revisions.set(id, next)
    return `${epoch}:${id}:${next.revision}`
  }
  const host: EditorHost = {
    context: () => ({
      schemeId: editor.activeScheme?.id ?? null,
      title: editor.activeScheme?.name.value,
    }),
    schemes: () => editor.schemes.map((s) => ({ id: s.id, name: s.name.value })),
    revision,
    selection: (id) => [...getScheme(id).selectedItemIds.value],
    structure(id) {
      const tree = getScheme(id).collectionTree.value
      return {
        groups: tree.groups.map((g) => ({ ...g })),
        collections: tree.nodes.map((c) => ({ ...c })),
      }
    },
    snapshot(id, members) {
      const scheme = getScheme(id)
      const editable = editor.getEditableItemIds(scheme)
      members ??= [...editable]
      if (members.some((id) => !editable.has(id)))
        throw new AiError('scope', 'Members must exist and be visible and unlocked')
      if (!members.length)
        return {
          version: 1,
          id: revision(id),
          schemeId: id,
          coordinateSystem: {
            position: 'world-z-up',
            lengthUnit: 'cm',
            rotation: 'visual-degrees',
            scale: 'visual-axes',
          },
          items: [],
          furniture: [],
          groups: [],
          collections: [],
        }
      return createAnalysisSnapshot({
        id: revision(id),
        schemeId: scheme.id,
        items: scheme.items.value,
        itemIds: members,
        collectionTree: scheme.collectionTree.value,
        groupOrigins: scheme.groupOrigins.value,
        getFurniture(gameId) {
          const item = game.getFurniture(gameId)
          if (!item) return null
          const category = game.furnitureCategories[item.categoryId]
          return {
            gameId,
            nameZh: item.name_cn,
            nameEn: item.name_en,
            sizeCm: item.size,
            iconUrl: game.getIconUrl(gameId) || null,
            category: category
              ? {
                  id: category.id,
                  nameZh: category.name_cn,
                  nameEn: category.name_en,
                  parentId: category.parentId,
                }
              : null,
          }
        },
        getBounds: (item) => getAnalysisBounds(item, geometry()),
      })
    },
    async render(id, panels, signal, layout) {
      const scheme = getScheme(id)
      // The capture provider borrows instance geometry/materials from the live
      // viewport. Another scheme can reuse internal IDs: never borrow its slots.
      const needsViewport = panels.some((panel) => panel.kind === 'scene')
      const assertViewport = () => {
        if (needsViewport && editor.activeScheme !== scheme)
          throw new AiError(
            'image',
            'Open the target scheme in the model viewport before scene rendering; atlas rendering does not require it.'
          )
      }
      assertViewport()
      const version = revision(id)
      const capture = provider()
      const captureRevision = capture?.revision?.()
      const policy = () =>
        JSON.stringify([
          settings.settings.threeDisplayMode,
          settings.settings.modelAssetProfile,
          settings.settings.materialAssetProfile,
          settings.settings.renderQuality,
          settings.settings.lightingMode,
          settings.settings.todMinute,
          settings.settings.shadowsEnabled,
        ])
      const renderPolicy = policy()
      const task = {
        signal,
        assertCurrent: () => {
          assertNotAborted(signal)
          assertViewport()
          if (
            revision(id) !== version ||
            capture !== provider() ||
            captureRevision !== capture?.revision?.() ||
            renderPolicy !== policy()
          )
            throw new AiError('stale')
        },
      }
      // Preflight every member set before the first image. Repeated views share
      // one immutable data/render snapshot for this batch, never a global cache.
      const batches = new Map<
        string,
        {
          snapshot: ReturnType<EditorHost['snapshot']>
          descriptor?: ReturnType<typeof createAnalysisRenderSnapshot>
        }
      >()
      const prepared = panels.map((panel) => {
        const key = JSON.stringify(panel.members)
        let batch = batches.get(key)
        if (!batch) {
          batch = { snapshot: host.snapshot(id, panel.members) }
          batches.set(key, batch)
        }
        return { panel, batch }
      })
      const outputs: { label: string; output: AnalysisImageOutput }[] = []
      for (const { panel, batch } of prepared) {
        task.assertCurrent()
        const snapshot = batch.snapshot
        let output: AnalysisImageOutput
        if (panel.kind === 'atlas') {
          output = await renderAnalysisAtlas(snapshot, panel.layout ?? {}, task)
        } else {
          const capture = provider()
          if (!capture) throw new AiError('image', 'Load the model viewport before rendering')
          const descriptor = (batch.descriptor ??= createAnalysisRenderSnapshot(
            snapshot,
            scheme.items.value,
            geometry()
          ))
          output = await capture.render(
            descriptor,
            {
              camera: panel.camera,
              focusItemIds: panel.focus,
              width: panel.width,
              height: panel.height,
              itemIds: panel.members,
              color: panel.color,
              labels: panel.labels
                ? Object.fromEntries(
                    snapshot.items
                      .filter((i) => !Array.isArray(panel.labels) || panel.labels.includes(i.id))
                      .map((i) => [i.id, String(i.instanceId)])
                  )
                : undefined,
            },
            task
          )
        }
        task.assertCurrent()
        if (panel.kind !== 'atlas') {
          const ids = new Map(snapshot.items.map((i) => [i.id, i.instanceId]))
          const missing = output.details.missingItemIds as string[] | undefined
          output = {
            ...output,
            details: {
              width: output.width,
              height: output.height,
              camera: output.details.camera,
              focus: panel.focus ? 'subset' : 'members',
              requested: panel.members.length,
              rendered: Array.isArray(output.details.renderedItemIds)
                ? output.details.renderedItemIds.length
                : null,
              missingCount: missing?.length ?? null,
              missingInstanceIds: missing?.slice(0, 10).map((id) => ids.get(id)),
              lighting: output.details.lighting,
              shadows: false,
            },
          }
        }
        outputs.push({ label: panel.label, output })
      }
      const board = await composeBoard(outputs, task, layout)
      task.assertCurrent()
      return board
    },
    apply(id, parameters, version) {
      const scheme = getScheme(id)
      if (revision(id) !== version)
        throw new AiError('stale', 'Scheme changed; refresh the items before editing.')
      const result = organization.organize(parameters, {
        schemeId: id,
        sceneVersion: editor.sceneVersion,
      })
      return {
        ok: true,
        data: result,
        edit: {
          schemeId: id,
          transactionId: result.transactionId,
          postcondition: organizationPostcondition(scheme, result),
        },
      }
    },
    verify: (edit) => verifyOrganization(editor.getSchemeById(edit.schemeId), edit.postcondition),
  }
  return { host }
}
