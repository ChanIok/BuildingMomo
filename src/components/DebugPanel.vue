<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getThreeModelManager } from '@/composables/useThreeModelManager'
import { parseColorIndex } from '@/lib/colorMap'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

interface CameraDebugData {
  cameraPosition: [number, number, number]
  cameraLookAt: [number, number, number]
  orbitTarget: [number, number, number]
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
const modelManager = getThreeModelManager()

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
  const debugInfo = modelManager.getModelDebugInfo(item.gameId)
  const colorIndex = parseColorIndex(item.extra.ColorMap)
  const furniture = gameDataStore.getFurniture(item.gameId)

  // Build material info with variant textures (from runtime geometryCache)
  const runtimeMaterials = (debugInfo?.materials ?? []).map((mat) => {
    const variants = gameDataStore.getVariantTextures(mat.name)
    const safeIndex =
      colorIndex !== null && variants ? (colorIndex < variants.length ? colorIndex : 0) : null
    return {
      name: mat.name,
      variants,
      currentVariantIndex: safeIndex,
      currentVariantFile: safeIndex !== null && variants ? (variants[safeIndex] ?? null) : null,
    }
  })

  // Build meshes list from config, attach runtime materials
  // Use meshMaterialCounts to correctly distribute materials across meshes
  const meshMaterialCounts = debugInfo?.meshMaterialCounts ?? []
  let matCursor = 0
  const meshes =
    config?.meshes?.map((meshConfig, meshIndex) => {
      const count = meshMaterialCounts[meshIndex] ?? 0
      const meshMats = runtimeMaterials.slice(matCursor, matCursor + count)
      matCursor += count
      return {
        path: meshConfig.path,
        materials: meshMats,
      }
    }) ?? []

  return {
    name: furniture?.name_cn ?? config?.name ?? 'Unknown',
    gameId: item.gameId,
    internalId: item.internalId,
    colorIndex,
    geometry: debugInfo
      ? {
          vertexCount: debugInfo.vertexCount,
          triangleCount: debugInfo.triangleCount,
          attributes: debugInfo.attributes,
          boundingBox: debugInfo.boundingBox,
        }
      : null,
    meshes,
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
  <div class="absolute bottom-32 left-4">
    <button
      @click="showPanel = !showPanel"
      class="rounded border border-border bg-secondary px-2 py-1 text-xs text-secondary-foreground shadow-sm hover:bg-secondary/80"
    >
      {{ showPanel ? t('editor.debug.hide') : t('editor.debug.show') }}
    </button>

    <div
      v-if="showPanel"
      class="mt-2 max-h-[70vh] overflow-y-auto rounded border border-border bg-card/95 px-3 py-2 font-mono text-xs text-card-foreground shadow-xl backdrop-blur-sm"
      style="max-width: 380px"
    >
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
          <div class="mt-1 text-muted-foreground">{{ t('editor.debug.orbitCenter') }}:</div>
          <div class="pl-2">
            X: {{ cameraData.orbitTarget[0].toFixed(1) }}<br />
            Y: {{ cameraData.orbitTarget[1].toFixed(1) }}<br />
            Z: {{ cameraData.orbitTarget[2].toFixed(1) }}
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
              <span class="ml-2 text-muted-foreground">Color:</span>
              {{ modelDebugInfo.colorIndex ?? 'N/A' }}
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

            <!-- Meshes & Materials -->
            <div class="mt-1.5 font-semibold text-muted-foreground">
              ▸ Meshes ({{ modelDebugInfo.meshes.length }})
            </div>
            <div
              v-for="(mesh, mi) in modelDebugInfo.meshes"
              :key="mi"
              class="mt-0.5 border-l border-border/50 pl-2"
            >
              <div>[{{ mi }}] {{ mesh.path }}</div>
              <div v-for="(mat, matIdx) in mesh.materials" :key="matIdx" class="pl-2">
                <div class="text-muted-foreground">{{ mat.name }}</div>
                <template v-if="mat.variants && mat.variants.length > 0">
                  <div class="pl-2">
                    Variants ({{ mat.variants.length }}):
                    <span
                      v-for="(_v, vi) in mat.variants"
                      :key="vi"
                      class="mr-1"
                      :class="
                        vi === mat.currentVariantIndex
                          ? 'font-semibold text-primary'
                          : 'text-muted-foreground'
                      "
                    >
                      {{ vi }}
                    </span>
                  </div>
                  <div v-if="mat.currentVariantFile" class="pl-2 text-primary">
                    → {{ mat.currentVariantFile }}
                  </div>
                </template>
                <div v-else class="pl-2 text-muted-foreground italic">No variants</div>
              </div>
              <div v-if="mesh.materials.length === 0" class="pl-2 text-muted-foreground italic">
                No material info
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Hint when model mode but not single selection -->
      <template v-else-if="settingsStore.settings.threeDisplayMode === 'model' && !modelDebugInfo">
        <div class="mt-3 border-t border-border pt-2 text-muted-foreground italic">
          Select a single item to see model debug info
        </div>
      </template>
    </div>
  </div>
</template>
