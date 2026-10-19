import type { InstancedBufferAttribute, InstancedMesh } from 'three'

/** Compact the visible intersection in place, preserving matrices, colors and mode attributes. */
export function retainInstances(
  mesh: InstancedMesh,
  indexToId: ReadonlyMap<number, string>,
  desiredIds: ReadonlySet<string>,
  extraAttributes: readonly InstancedBufferAttribute[] = []
): Map<number, string> {
  const retained = new Map<number, string>()
  const attributes = [mesh.instanceMatrix, ...extraAttributes]
  if (mesh.instanceColor) attributes.push(mesh.instanceColor)
  let moved = false
  for (let source = 0; source < mesh.count; source++) {
    const id = indexToId.get(source)
    if (id === undefined || !desiredIds.has(id)) continue
    const target = retained.size
    if (target !== source) {
      for (const attribute of attributes) attribute.copyAt(target, attribute, source)
      moved = true
    }
    retained.set(target, id)
  }
  mesh.count = retained.size
  if (moved) for (const attribute of attributes) attribute.needsUpdate = true
  return retained
}
