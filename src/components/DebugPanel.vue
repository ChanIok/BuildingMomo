<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getThreeModelManager } from '@/composables/useThreeModelManager'
import { decodeColorMapToGroupMap } from '@/lib/colorMap'
import { resolveModelDyePlan } from '@/lib/modelDye'
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

  return {
    name: furniture?.name_cn ?? config?.name ?? 'Unknown',
    gameId: item.gameId,
    colorDisplay,
    dyeMode: dyePlan.mode,
    dyeEntries,
    geometry: debugInfo
      ? {
          vertexCount: debugInfo.vertexCount,
          triangleCount: debugInfo.triangleCount,
          attributes: debugInfo.attributes,
          boundingBox: debugInfo.boundingBox,
        }
      : null,
    registryBaseNames: debugInfo?.registryBaseNames ?? [],
    materials: debugInfo?.materials ?? [],
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

        <!-- Model Debug Section -->
        <template v-if="modelDebugInfo">
          <div class="mt-3 border-t border-border pt-2">
            <div class="mb-1 font-bold text-primary">Model Debug</div>
            <div class="space-y-0.5">
              <div>
                <span class="text-muted-foreground">Name:</span>
                {{ modelDebugInfo.name }}
              </div>
              <div>
                <span class="text-muted-foreground">GameID:</span>
                {{ modelDebugInfo.gameId }}
              </div>
              <div>
                <span class="text-muted-foreground">ColorMap:</span>
                {{ modelDebugInfo.colorDisplay }}
              </div>
              <div>
                <span class="text-muted-foreground">DyePlan:</span>
                <span
                  :class="
                    modelDebugInfo.dyeMode === 'dyed' ? 'text-primary' : 'text-muted-foreground'
                  "
                  >{{ modelDebugInfo.dyeMode }}</span
                >
              </div>
              <div
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
                    Attrs:
                    <span class="text-muted-foreground">{{
                      modelDebugInfo.geometry.attributes.join(', ')
                    }}</span>
                  </div>
                  <div>
                    BBox:
                    {{ fmtSize(modelDebugInfo.geometry.boundingBox.size[0]) }} ×
                    {{ fmtSize(modelDebugInfo.geometry.boundingBox.size[1]) }} ×
                    {{ fmtSize(modelDebugInfo.geometry.boundingBox.size[2]) }}
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="mt-1 text-muted-foreground italic">Geometry not cached (fallback)</div>
              </template>

              <!-- Material Registry -->
              <template v-if="modelDebugInfo.registryBaseNames.length > 0">
                <div class="mt-1.5 font-semibold text-muted-foreground">
                  ▸ Registry ({{ modelDebugInfo.registryBaseNames.length }})
                </div>
                <div class="pl-2 text-muted-foreground">
                  {{ modelDebugInfo.registryBaseNames.join(', ') }}
                </div>
              </template>

              <!-- Materials -->
              <div class="mt-1.5 font-semibold text-muted-foreground">
                ▸ Materials ({{ modelDebugInfo.materials.length }})
              </div>
              <div
                v-for="(mat, mi) in modelDebugInfo.materials"
                :key="mi"
                class="mt-0.5 border-l border-border/50 pl-2"
              >
                <div>[{{ mi }}] {{ mat.name }}</div>
                <div v-if="mat.baseName" class="pl-2 text-muted-foreground">
                  base: {{ mat.baseName }}
                </div>
              </div>
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
