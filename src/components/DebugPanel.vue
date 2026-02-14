<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getThreeModelManager } from '@/composables/useThreeModelManager'
import { decodeColorMapToGroupMap, parseColorIndex, parseColorMapSlots } from '@/lib/colorMap'
import { useI18n } from '@/composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

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
  const furniture = gameDataStore.getFurniture(item.gameId)
  const decodedColorMap = decodeColorMapToGroupMap(item.extra.ColorMap)

  // 检查是否使用新系统（多槽染色）
  const dyeResult = gameDataStore.getDyePreset(item.gameId)
  let colorDisplay: string
  let colorIndex: number | null = null
  let slotValues: number[] | null = null

  if (dyeResult) {
    // 新系统：多槽染色
    const { slotIds } = dyeResult
    slotValues = parseColorMapSlots(item.extra.ColorMap, slotIds)
    // 显示格式："[2, 1, 0]" 并标注对应的 slotId
    colorDisplay = slotValues.map((v, i) => `${slotIds[i]}:${v}`).join(', ')
  } else {
    // 旧系统：优先使用统一解码规则；无 group 0 时回退旧解析
    colorIndex = decodedColorMap.get(0) ?? parseColorIndex(item.extra.ColorMap)

    if (colorIndex !== null) {
      colorDisplay = String(colorIndex)
    } else if (decodedColorMap.size > 0) {
      colorDisplay = Array.from(decodedColorMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([groupId, value]) => `${groupId}:${value}`)
        .join(', ')
    } else {
      colorDisplay = 'N/A'
    }
  }

  // Build meshes list with material info
  // 新系统：显示 preset 中的 slot 信息
  // 旧系统：显示 variantMap 中的变体信息
  interface MeshDebugInfo {
    path: string
    actualMaterials: string[]
    slots?: {
      slotIndex: number
      mi: string
      variantCount: number
      currentVariant: number
      missingMIs: string[]
    }[]
    materials?: {
      name: string
      variantType: 'color' | 'diffuse' | null
      variants: string[] | null
      currentVariantIndex: number | null
      currentVariantFile: string | null
    }[]
  }

  let meshes: MeshDebugInfo[] = []
  const meshMaterialCounts = debugInfo?.meshMaterialCounts ?? []
  const runtimeMaterials = (debugInfo?.materials ?? []).map((mat) => {
    const variantConfig = gameDataStore.getVariantConfig(mat.name)
    const variants = variantConfig?.file ?? null
    const safeIndex =
      colorIndex !== null && variants ? (colorIndex < variants.length ? colorIndex : 0) : null
    return {
      name: mat.name,
      variantType: variantConfig?.type ?? null,
      variants,
      currentVariantIndex: safeIndex,
      currentVariantFile: safeIndex !== null && variants ? (variants[safeIndex] ?? null) : null,
    }
  })
  const runtimeMaterialsByMesh: (typeof runtimeMaterials)[] = []
  let runtimeMatCursor = 0
  config?.meshes?.forEach((_meshConfig, meshIndex) => {
    const count = meshMaterialCounts[meshIndex] ?? 0
    runtimeMaterialsByMesh.push(runtimeMaterials.slice(runtimeMatCursor, runtimeMatCursor + count))
    runtimeMatCursor += count
  })

  if (dyeResult && slotValues) {
    // 新系统：按 mesh 分组显示 slot 信息
    const { preset, slotIds } = dyeResult
    meshes =
      config?.meshes?.map((meshConfig, meshIndex) => {
        const meshMats = runtimeMaterialsByMesh[meshIndex] ?? []
        const actualMaterialNames = meshMats.map((m) => m.name)
        const actualMaterialSet = new Set(actualMaterialNames)

        // 找出作用于这个 mesh 的所有 slots
        const slotsForMesh: MeshDebugInfo['slots'] = []
        preset.slots.forEach((slot, slotIdx) => {
          const targetsForMesh = slot.targets.filter((t) => t.mesh === meshIndex)
          if (targetsForMesh.length > 0) {
            const targetMIs = targetsForMesh.map((t) => t.mi)
            const missingMIs = targetMIs.filter((mi) => !actualMaterialSet.has(mi))
            slotsForMesh.push({
              slotIndex: slotIds[slotIdx]!,
              mi: targetMIs.join(', '),
              variantCount: slot.variants.length,
              currentVariant: slotValues![slotIdx]!,
              missingMIs,
            })
          }
        })
        return {
          path: meshConfig.path,
          actualMaterials: actualMaterialNames,
          slots: slotsForMesh,
        }
      }) ?? []
  } else {
    // 旧系统：显示 variantMap 信息
    meshes =
      config?.meshes?.map((meshConfig, meshIndex) => {
        const meshMats = runtimeMaterialsByMesh[meshIndex] ?? []
        return {
          path: meshConfig.path,
          actualMaterials: meshMats.map((m) => m.name),
          materials: meshMats,
        }
      }) ?? []
  }

  return {
    name: furniture?.name_cn ?? config?.name ?? 'Unknown',
    gameId: item.gameId,
    internalId: item.internalId,
    colorDisplay,
    isPresetDye: !!dyeResult,
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
              </div>
              <div>
                <span class="text-muted-foreground"
                  >{{ modelDebugInfo.isPresetDye ? 'Slots' : 'Color' }}:</span
                >
                {{ modelDebugInfo.colorDisplay }}
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

              <!-- Meshes & Materials/Slots -->
              <div class="mt-1.5 font-semibold text-muted-foreground">
                ▸ Meshes ({{ modelDebugInfo.meshes.length }})
              </div>
              <div
                v-for="(mesh, mi) in modelDebugInfo.meshes"
                :key="mi"
                class="mt-0.5 border-l border-border/50 pl-2"
              >
                <div>[{{ mi }}] {{ mesh.path }}</div>
                <div class="pl-2 text-muted-foreground">
                  Actual MI:
                  <template v-if="mesh.actualMaterials.length > 0">
                    {{ mesh.actualMaterials.join(', ') }}
                  </template>
                  <template v-else>(none)</template>
                </div>

                <!-- 新系统：显示 Slot 信息 -->
                <template v-if="mesh.slots && mesh.slots.length > 0">
                  <div v-for="(slot, slotIdx) in mesh.slots" :key="slotIdx" class="pl-2">
                    <div class="text-muted-foreground">
                      {{ slot.mi }}
                      <span v-if="slot.missingMIs.length === 0" class="text-primary">
                        (matched)</span
                      >
                      <span v-else class="text-destructive">
                        (missing: {{ slot.missingMIs.join(', ') }})
                      </span>
                    </div>
                    <div class="pl-2">
                      Slot {{ slot.slotIndex }}:
                      <span
                        v-for="vi in slot.variantCount"
                        :key="vi - 1"
                        class="mr-1"
                        :class="
                          vi - 1 === slot.currentVariant
                            ? 'font-semibold text-primary'
                            : 'text-muted-foreground'
                        "
                      >
                        {{ vi - 1 }}
                      </span>
                    </div>
                  </div>
                </template>

                <!-- 旧系统：显示 Material 信息 -->
                <template v-else-if="mesh.materials && mesh.materials.length > 0">
                  <div v-for="(mat, matIdx) in mesh.materials" :key="matIdx" class="pl-2">
                    <div class="text-muted-foreground">{{ mat.name }}</div>
                    <div class="pl-2 text-muted-foreground">
                      Type: {{ mat.variantType ?? 'none' }}
                    </div>
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
                </template>

                <!-- 无信息 -->
                <div v-else class="pl-2 text-muted-foreground italic">No slot/material info</div>
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
