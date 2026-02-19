import { watch, type Ref } from 'vue'
import { Color } from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import type { useGameDataStore } from '@/stores/gameDataStore'
import type { useSettingsStore } from '@/stores/settingsStore'
import type { useUIStore } from '@/stores/uiStore'

const AXIS_COLORS = {
  x: 0xef4444, // red-500
  y: 0x84cc16, // lime-500
  z: 0x3b82f6, // blue-500
}

export function createGizmoAppearanceManager(
  editorStore: ReturnType<typeof useEditorStore>,
  gameDataStore: ReturnType<typeof useGameDataStore>,
  settingsStore: ReturnType<typeof useSettingsStore>,
  uiStore: ReturnType<typeof useUIStore>
) {
  return function setupGizmoAppearance(
    transformRef: Ref<any | null>,
    axesRef?: Ref<any | null>,
    onAppearanceApplied?: () => void
  ) {
    const computeConstraints = () => {
      const scheme = editorStore.activeScheme
      if (!scheme || scheme.selectedItemIds.value.size === 0) {
        return { canRotateX: true, canRotateY: true }
      }

      let canRotateX = true
      let canRotateY = true

      for (const id of scheme.selectedItemIds.value) {
        const item = editorStore.itemsMap.get(id)
        if (!item) continue

        const furniture = gameDataStore.getFurniture(item.gameId)
        if (!furniture) continue

        canRotateX &&= furniture.rotationAllowed.x
        canRotateY &&= furniture.rotationAllowed.y
      }

      return { canRotateX, canRotateY }
    }

    const updateGizmoAppearance = (controls: any) => {
      if (!controls) return

      const isRotate = editorStore.gizmoMode === 'rotate'
      const isLimitEnabled = settingsStore.settings.enableLimitDetection

      if (isRotate && isLimitEnabled) {
        const constraints = computeConstraints()
        controls.showX = constraints.canRotateX
        controls.showY = constraints.canRotateY
        controls.showZ = true
      } else {
        controls.showX = true
        controls.showY = true
        controls.showZ = true
      }

      const gizmoObj = controls._gizmo || controls.gizmo || controls.children?.[0]
      if (!gizmoObj) return

      const objectsToRemove: any[] = []
      const currentMode = editorStore.gizmoMode || 'translate'

      const visualGizmo = gizmoObj.gizmo?.[currentMode]
      if (visualGizmo) {
        visualGizmo.traverse((obj: any) => {
          if (obj.name === 'E' || obj.name === 'XYZE') {
            objectsToRemove.push(obj)
            return
          }

          if (!obj.material || !obj.name) return

          let color
          if (/^(X|XYZX)$/.test(obj.name)) color = AXIS_COLORS.x
          else if (/^(Y|XYZY)$/.test(obj.name)) {
            color = AXIS_COLORS.y

            if (obj.type === 'Mesh' && !obj.userData.hasFlippedY) {
              const posAttr = obj.geometry?.attributes?.position
              if (posAttr) {
                let minY = Infinity
                let maxY = -Infinity

                for (let i = 0; i < posAttr.count; i++) {
                  const y = posAttr.getY(i)
                  if (y < minY) minY = y
                  if (y > maxY) maxY = y
                }

                const centerY = (minY + maxY) / 2
                for (let i = 0; i < posAttr.count; i++) {
                  const y = posAttr.getY(i)
                  posAttr.setY(i, 2 * centerY - y)
                }
                posAttr.needsUpdate = true

                const geo = obj.geometry
                if (geo) {
                  geo.computeBoundingSphere()
                  geo.computeBoundingBox()
                }

                obj.userData.hasFlippedY = true
              }
            }
          } else if (/^(Z|XYZZ)$/.test(obj.name)) {
            color = AXIS_COLORS.z
          }

          if (color) {
            obj.material.color.set(color)
            obj.material.tempColor = obj.material.tempColor || new Color()
            obj.material.tempColor.set(color)
          }
        })
      }

      const pickerContainer = gizmoObj?.picker?.[currentMode]
      if (pickerContainer) {
        pickerContainer.traverse((obj: any) => {
          if (obj.name === 'E' || obj.name === 'XYZE') {
            objectsToRemove.push(obj)
          }
        })
      }

      objectsToRemove.forEach((obj) => {
        if (obj.parent) {
          obj.parent.remove(obj)
        }
      })
    }

    watch(
      [
        transformRef,
        () => editorStore.gizmoMode,
        () => settingsStore.settings.enableLimitDetection,
        () => editorStore.selectionVersion,
        () => uiStore.currentViewPreset,
      ],
      () => {
        const currentControls = transformRef.value?.instance || transformRef.value?.value
        if (currentControls) {
          currentControls.visible = false
        }

        requestAnimationFrame(() => {
          const latestControls = transformRef.value?.instance || transformRef.value?.value
          if (!latestControls) return

          updateGizmoAppearance(latestControls)
          latestControls.visible = true
          onAppearanceApplied?.()
        })
      }
    )

    if (axesRef) {
      watch(axesRef, (v) => {
        const axes = v?.instance || v?.value || v
        if (axes && typeof axes.setColors === 'function') {
          axes.setColors(
            new Color(AXIS_COLORS.x),
            new Color(AXIS_COLORS.y),
            new Color(AXIS_COLORS.z)
          )
        }
      })
    }
  }
}
