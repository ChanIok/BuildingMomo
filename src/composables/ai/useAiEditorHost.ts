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
  let previous: unknown[] = [],
    revision = 0,
    disposed = false,
    writing = false
  onScopeDispose(() => {
    disposed = true
  })
  const geometry = () => ({
    getFurnitureSize: game.getFurnitureSize,
    getModelConfig: game.getFurnitureModelConfig,
    getModelBoundingBox: (id: number) => furnitureRender.value?.getModelBounds(id) ?? null,
  })
  function current() {
    if (disposed) throw new AiError('cancelled')
    const s = editor.activeScheme
    if (!s) throw new AiError('scope', 'No active scheme')
    const capture = provider()
    const tokens = [
      s.id,
      s.items.value,
      editor.sceneVersion,
      s.collectionTree.value,
      s.groupOrigins.value,
      s.hiddenGroupIds.value,
      s.lockedGroupIds.value,
      s.hiddenCollectionIds.value,
      s.lockedCollectionIds.value,
      game.furnitureDBRevision,
      furnitureRender.value,
      settings.settings.threeDisplayMode,
      settings.settings.modelAssetProfile,
      settings.settings.materialAssetProfile,
      settings.settings.renderQuality,
      settings.settings.lightingMode,
      settings.settings.todMinute,
      settings.settings.shadowsEnabled,
      capture,
      capture?.revision?.(),
    ]
    if (tokens.length !== previous.length || tokens.some((v, i) => v !== previous[i])) {
      previous = tokens
      revision++
    }
    return { version: `${epoch}:${revision}`, summary: { schemeId: s.id, title: s.name.value } }
  }
  const host: EditorHost = {
    current,
    selection() {
      const { version, summary } = current()
      return {
        schemeId: summary.schemeId,
        revision: version,
        members: [...editor.activeScheme!.selectedItemIds.value],
      }
    },
    assertCurrent(version) {
      if (current().version !== version) throw new AiError('stale')
    },
    snapshot(members) {
      const state = current(),
        scheme = editor.activeScheme!
      if (!members.length || members.some((id) => !editor.isItemEditable(id)))
        throw new AiError('scope', 'Members must exist and be visible and unlocked')
      return createAnalysisSnapshot({
        id: state.version,
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
    async render(panels, signal, layout) {
      const version = current().version
      const task = {
        signal,
        assertCurrent: () => {
          assertNotAborted(signal)
          host.assertCurrent(version)
        },
      }
      const outputs: { label: string; output: AnalysisImageOutput }[] = []
      for (const panel of panels) {
        task.assertCurrent()
        const snapshot = host.snapshot(panel.members)
        let output: AnalysisImageOutput
        if (panel.kind === 'atlas') {
          output = await renderAnalysisAtlas(snapshot, panel.layout ?? {}, task)
        } else {
          const capture = provider()
          if (!capture) throw new AiError('image', 'Load the model viewport before rendering')
          const descriptor = createAnalysisRenderSnapshot(
            snapshot,
            editor.activeScheme!.items.value,
            geometry()
          )
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
    apply(parameters, version) {
      host.assertCurrent(version)
      writing = true
      try {
        const result = organization.organize(parameters, {
          schemeId: editor.activeScheme!.id,
          sceneVersion: editor.sceneVersion,
        })
        return {
          ok: true,
          data: result,
          edit: {
            transactionId: result.transactionId,
            postcondition: organizationPostcondition(editor.activeScheme!, result),
          },
        }
      } finally {
        writing = false
      }
    },
    verify: (edit) => verifyOrganization(editor.activeScheme, edit.postcondition),
  }
  return {
    host,
    get writing() {
      return writing
    },
  }
}
