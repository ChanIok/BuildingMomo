import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three'

vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  onUnmounted: vi.fn(),
}))
vi.mock('@/composables/renderer/modes/useModelMode', () => ({ MODEL_FALLBACK_MESH_KEY: '-1' }))

import { useSelectionOutline } from '@/composables/renderer/shared/useSelectionOutline'

describe('selection outline instance packing', () => {
  it('draws only highlighted slots, combines channels, and follows preview matrices', () => {
    const outline = useSelectionOutline()
    const material = new MeshBasicMaterial()
    const source = new InstancedMesh(new BoxGeometry(), material, 1000)
    source.setMatrixAt(499, new Matrix4().makeTranslation(10, 20, 30))
    source.setMatrixAt(999, new Matrix4().makeTranslation(40, 50, 60))
    const meshes = new Map([['model', source]])
    const ids = new Map([
      ['selected', { meshKey: 'model', localIndex: 499 }],
      ['hovered', { meshKey: 'model', localIndex: 999 }],
    ])

    outline.reconcileMaskMeshes(meshes, null)
    expect(outline.maskScene.children).toHaveLength(0)
    outline.updateMasks(new Set(['selected']), new Set(['selected', 'hovered']), meshes, ids, null)
    const mask = outline.maskScene.children[0] as InstancedMesh
    expect(mask.count).toBe(2)
    expect(mask.instanceMatrix.count).toBeLessThan(source.count)
    expect(mask.instanceMatrix).not.toBe(source.instanceMatrix)
    const color = new Color()
    mask.getColorAt(0, color)
    expect(color.toArray()).toEqual([1, 1, 0])
    mask.getColorAt(1, color)
    expect(color.toArray()).toEqual([0, 1, 0])

    source.setMatrixAt(499, new Matrix4().makeTranslation(70, 80, 90))
    outline.updateMatrices(meshes, null)
    const matrix = new Matrix4()
    mask.getMatrixAt(0, matrix)
    expect(matrix.elements.slice(12, 15)).toEqual([70, 80, 90])

    outline.updateMasks(new Set(), new Set(['hovered']), meshes, ids, null)
    expect(outline.maskScene.children[0]).toBe(mask)
    expect(mask.count).toBe(1)
    mask.getMatrixAt(0, matrix)
    expect(matrix.elements.slice(12, 15)).toEqual([40, 50, 60])
    outline.updateMasks(new Set(), null, meshes, ids, null)
    expect(mask.visible).toBe(false)
    expect(mask.count).toBe(0)
    outline.dispose()
    source.geometry.dispose()
    material.dispose()
  })

  it('handles fallback slots and releases replaced masks without disposing source geometry', () => {
    const outline = useSelectionOutline()
    const material = new MeshBasicMaterial()
    const fallback = new InstancedMesh(new BoxGeometry(), material, 2)
    const ids = new Map([['fallback', { meshKey: '-1', localIndex: 1 }]])
    outline.updateMasks(new Set(['fallback']), null, new Map(), ids, fallback)
    const mask = outline.maskScene.children[0] as InstancedMesh
    const dispose = vi.fn()
    mask.addEventListener('dispose', dispose)
    const geometryDispose = vi.spyOn(fallback.geometry, 'dispose')
    outline.reconcileMaskMeshes(new Map(), null)
    expect(dispose).toHaveBeenCalledOnce()
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(outline.maskScene.children).toHaveLength(0)
    outline.updateMasks(new Set(['fallback']), null, new Map(), ids, null)
    expect(outline.maskScene.children).toHaveLength(0)
    outline.dispose()
    fallback.geometry.dispose()
    material.dispose()
  })
})
