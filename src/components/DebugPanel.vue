<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getThreeModelManager } from '@/composables/useThreeModelManager'
import { decodeColorMapToGroupMap } from '@/lib/colorMap'
import { buildModelMeshKey, resolveModelDyePlan } from '@/lib/modelDye'
import { useI18n } from '@/composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

const { t } = useI18n()

interface CameraDebugData {
  cameraPosition: [number, number, number]
  cameraLookAt: [number, number, number]
  controlMode: string
  currentViewPreset: string | null
  isOrthographic: boolean
  isViewFocused: boolean
  isNavKeyPressed: boolean
  cameraZoom: number
}

defineProps<{
  cameraData?: CameraDebugData | null
}>()

const editorStore = useEditorStore()
const gameDataStore = useGameDataStore()
const settingsStore = useSettingsStore()

const showPanel = ref(false)

const rendererDebugInfo = computed(() => {
  const isModelMode = settingsStore.settings.threeDisplayMode === 'model'
  const managerStats = isModelMode ? getThreeModelManager().getStats() : null
  const manifestStatus =
    settingsStore.settings.modelAssetProfile !== 'lite'
      ? 'n/a'
      : !gameDataStore.liteTextureManifestMeta
        ? 'none'
        : gameDataStore.isLiteTextureManifestLoaded
          ? 'loaded'
          : 'pending'

  return {
    displayMode: settingsStore.settings.threeDisplayMode,
    assetProfile: settingsStore.settings.modelAssetProfile,
    manifestStatus,
    activeMeshes: managerStats?.activeMeshes ?? 0,
    cachedGeometries: managerStats?.cachedGeometries ?? 0,
    cachedColoredMaterials: managerStats?.cachedColoredMaterials ?? 0,
  }
})

// ========== Model Debug Info ==========

const modelDebugInfo = computed(() => {
  if (settingsStore.settings.threeDisplayMode !== 'model') return null

  const scheme = editorStore.activeScheme
  if (!scheme) return null

  const selectedIds = scheme.selectedItemIds.value
  if (selectedIds.size !== 1) return null

  const selectedId = selectedIds.values().next().value as string
  const item = editorStore.itemsMap.get(selectedId)
  if (!item) return null

  const config = gameDataStore.getFurnitureModelConfig(item.gameId)
  const debugInfo = getThreeModelManager().getModelDebugInfo(item.gameId)
  const furniture = gameDataStore.getFurniture(item.gameId)

  const decodedColorMap = decodeColorMapToGroupMap(item.extra.ColorMap)
  const colorDisplay =
    decodedColorMap.size > 0
      ? Array.from(decodedColorMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([groupId, value]) => `${groupId}:${value}`)
          .join(', ')
      : 'N/A'

  const dyePlan = resolveModelDyePlan({ item, colorsConfig: config?.colors })
  const dyeEntries =
    dyePlan.mode === 'dyed' ? Array.from(dyePlan.dyeMap.entries()).sort(([a], [b]) => a - b) : []
  const meshKey = buildModelMeshKey(item.gameId, dyePlan)
  const meshPaths = (config?.meshes ?? [])
    .map((mesh) => mesh.path?.trim())
    .filter((path): path is string => !!path)
  const textureSummary =
    debugInfo?.textureSourceMode === 'external'
      ? `external (${debugInfo.externalTextureRefs} ext)`
      : debugInfo?.textureSourceMode === 'embedded'
        ? `embedded (${debugInfo.embeddedTextureRefs} emb)`
        : debugInfo?.textureSourceMode === 'mixed'
          ? `mixed (${debugInfo.externalTextureRefs} ext / ${debugInfo.embeddedTextureRefs} emb)`
          : 'unknown'

  return {
    name: furniture?.name_cn ?? config?.name ?? 'Unknown',
    gameId: item.gameId,
    meshKey,
    colorDisplay: colorDisplay !== 'N/A' ? colorDisplay : null,
    dyeMode: dyePlan.mode,
    dyeEntries,
    meshPaths,
    textureSummary,
    geometry: debugInfo
      ? {
          vertexCount: debugInfo.vertexCount,
          triangleCount: debugInfo.triangleCount,
          boundingBox: debugInfo.boundingBox,
        }
      : null,
    meshMaterialCounts: debugInfo?.meshMaterialCounts ?? [],
  }
})

function fmt(n: number): string {
  return n.toLocaleString()
}

function fmtSize(v: number): string {
  return v.toFixed(1)
}
</script>

<template>
  <div class="absolute bottom-4 left-4">
    <button
      @click="showPanel = !showPanel"
      class="rounded border border-border bg-secondary px-2 py-1 text-xs text-secondary-foreground shadow-sm hover:bg-secondary/80"
    >
      {{ showPanel ? t('editor.debug.hide') : t('editor.debug.show') }}
    </button>

    <ScrollArea
      v-if="showPanel"
      class="mt-2 max-h-[70vh] rounded border border-border bg-card/95 font-mono text-xs text-card-foreground shadow-xl backdrop-blur-sm"
      style="max-width: 380px"
    >
      <div class="px-3 py-2">
        <!-- Camera Debug Section -->
        <template v-if="cameraData">
          <div class="mb-1 font-bold text-primary">{{ t('editor.debug.title') }}</div>
          <div class="space-y-0.5">
            <div>
              <span class="text-muted-foreground">{{ t('editor.debug.mode') }}:</span>
              {{ cameraData.controlMode }}
            </div>
            <div>
              <span class="text-muted-foreground">{{ t('editor.debug.view') }}:</span>
              {{
                !cameraData.isOrthographic
                  ? t('editor.viewMode.perspective')
                  : cameraData.currentViewPreset || t('editor.viewMode.orthographic')
              }}
            </div>
            <div>
              <span class="text-muted-foreground">{{ t('editor.debug.projection') }}:</span>
              {{
                cameraData.isOrthographic
                  ? t('editor.viewMode.orthographic')
                  : t('editor.viewMode.perspective')
              }}
            </div>
            <div class="mt-1 text-muted-foreground">{{ t('editor.debug.position') }}:</div>
            <div class="pl-2">
              X: {{ cameraData.cameraPosition[0].toFixed(1) }}<br />
              Y: {{ cameraData.cameraPosition[1].toFixed(1) }}<br />
              Z: {{ cameraData.cameraPosition[2].toFixed(1) }}
            </div>
            <div class="mt-1 text-muted-foreground">{{ t('editor.debug.target') }}:</div>
            <div class="pl-2">
              X: {{ cameraData.cameraLookAt[0].toFixed(1) }}<br />
              Y: {{ cameraData.cameraLookAt[1].toFixed(1) }}<br />
              Z: {{ cameraData.cameraLookAt[2].toFixed(1) }}
            </div>
          </div>
        </template>

        <div class="mt-3 border-t border-border pt-2">
          <div class="mb-1 font-bold text-primary">Renderer</div>
          <div class="space-y-0.5">
            <div>
              <span class="text-muted-foreground">Display:</span>
              {{ rendererDebugInfo.displayMode }}
            </div>
            <div>
              <span class="text-muted-foreground">Assets:</span>
              {{ rendererDebugInfo.assetProfile }}
            </div>
            <div v-if="rendererDebugInfo.assetProfile === 'lite'">
              <span class="text-muted-foreground">Manifest:</span>
              {{ rendererDebugInfo.manifestStatus }}
            </div>
            <div v-if="rendererDebugInfo.displayMode === 'model'">
              <span class="text-muted-foreground">Meshes:</span>
              {{ rendererDebugInfo.activeMeshes }}
            </div>
            <div v-if="rendererDebugInfo.displayMode === 'model'">
              <span class="text-muted-foreground">Geom Cache:</span>
              {{ rendererDebugInfo.cachedGeometries }}
            </div>
            <div v-if="rendererDebugInfo.displayMode === 'model'">
              <span class="text-muted-foreground">Dyed Mats:</span>
              {{ rendererDebugInfo.cachedColoredMaterials }}
            </div>
          </div>
        </div>

        <!-- Model Debug Section -->
        <template v-if="modelDebugInfo">
          <div class="mt-3 border-t border-border pt-2">
            <div class="mb-1 font-bold text-primary">Selection</div>
            <div class="space-y-0.5">
              <div>
                <span class="text-muted-foreground">Name:</span>
                {{ modelDebugInfo.name }}
              </div>
              <div>
                <span class="text-muted-foreground">GameID:</span>
                {{ modelDebugInfo.gameId }}
              </div>
              <div v-if="modelDebugInfo.colorDisplay">
                <span class="text-muted-foreground">ColorMap:</span>
                {{ modelDebugInfo.colorDisplay }}
              </div>
              <div>
                <span class="text-muted-foreground">Textures:</span>
                {{ modelDebugInfo.textureSummary }}
              </div>
              <div v-if="modelDebugInfo.meshPaths.length > 0" class="mt-1.5">
                <div class="font-semibold text-muted-foreground">
                  ▸ GLBs ({{ modelDebugInfo.meshPaths.length }})
                </div>
                <div
                  v-for="meshPath in modelDebugInfo.meshPaths"
                  :key="meshPath"
                  class="pl-2 text-[11px] break-all text-muted-foreground"
                >
                  {{ meshPath }}
                </div>
              </div>
              <div
                v-if="modelDebugInfo.dyeMode === 'dyed'"
                v-for="[meshIdx, entry] in modelDebugInfo.dyeEntries"
                :key="meshIdx"
                class="pl-2 text-xs"
              >
                <span class="text-muted-foreground">[{{ meshIdx }}]</span>
                D{{ entry.pattern }} T{{ entry.tint }}
              </div>

              <!-- Geometry -->
              <template v-if="modelDebugInfo.geometry">
                <div class="mt-1.5 font-semibold text-muted-foreground">▸ Geometry</div>
                <div class="pl-2">
                  <div>
                    Verts: {{ fmt(modelDebugInfo.geometry.vertexCount) }} | Tris:
                    {{ fmt(modelDebugInfo.geometry.triangleCount) }}
                  </div>
                  <div>
                    BBox:
                    {{ fmtSize(modelDebugInfo.geometry.boundingBox.size[0]) }} ×
                    {{ fmtSize(modelDebugInfo.geometry.boundingBox.size[1]) }} ×
                    {{ fmtSize(modelDebugInfo.geometry.boundingBox.size[2]) }}
                  </div>
                  <div v-if="modelDebugInfo.meshMaterialCounts.length > 0">
                    Mesh Slots:
                    <span class="text-muted-foreground">{{
                      modelDebugInfo.meshMaterialCounts.join(', ')
                    }}</span>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="mt-1 text-muted-foreground italic">Geometry not cached (fallback)</div>
              </template>
            </div>
          </div>
        </template>

        <!-- Hint when model mode but not single selection -->
        <template
          v-else-if="settingsStore.settings.threeDisplayMode === 'model' && !modelDebugInfo"
        >
          <div class="mt-3 border-t border-border pt-2 text-muted-foreground italic">
            Select a single item to see model debug info
          </div>
        </template>
      </div>
      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>
  </div>
</template>
