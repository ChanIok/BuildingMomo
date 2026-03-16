import {
  Box3,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { FurnitureModelConfig, ModelAssetProfile } from '@/types/furniture'
import type { MeshAssetData } from './assetPipeline'
import {
  buildDefaultPlainMaterial,
  cloneSourceMaterialForItem,
  mergeMaterialRegistry,
  type MaterialRegistry,
} from './materialPipeline'

export interface GeometryData {
  geometry: BufferGeometry
  plainMaterials: Material[]
  meshBaseNames: (string | null)[]
  slotMeshIndices: number[]
  mergedMaterial: Material | Material[]
  materialRegistry: MaterialRegistry
  boundingBox: Box3
  meshMaterialCounts: number[]
}

/**
 * 标准化几何体属性，确保合并时各几何体属性集一致。
 * - 关键属性（position, normal, uv）：交集，缺失则删除
 * - color 和 uv2：并集，缺失则补默认值（color→白色，uv2→零）
 * - 其他属性：交集，缺失则删除
 */
function normalizeGeometryAttributes(geometries: BufferGeometry[]): void {
  if (geometries.length <= 1) return

  const attributeSets = geometries.map((geom) => new Set(Object.keys(geom.attributes)))
  const commonAttributes = new Set(attributeSets[0])

  for (let index = 1; index < attributeSets.length; index++) {
    const currentSet = attributeSets[index]!
    for (const attr of commonAttributes) {
      if (!currentSet.has(attr)) commonAttributes.delete(attr)
    }
  }

  const unionAttributes = new Set<string>()
  for (const attrSet of attributeSets) {
    for (const attr of attrSet) {
      if (attr === 'color' || attr.startsWith('color_') || attr === 'uv2') {
        unionAttributes.add(attr)
      }
    }
  }

  for (const geom of geometries) {
    const attrs = Object.keys(geom.attributes)

    for (const attr of attrs) {
      if (!commonAttributes.has(attr) && !unionAttributes.has(attr)) {
        geom.deleteAttribute(attr)
      }
    }

    for (const unionAttr of unionAttributes) {
      if (geom.attributes[unionAttr]) continue

      const vertexCount = geom.attributes.position?.count
      if (!vertexCount) continue

      let referenceAttr = null
      for (const refGeom of geometries) {
        if (refGeom.attributes[unionAttr]) {
          referenceAttr = refGeom.attributes[unionAttr]
          break
        }
      }
      if (!referenceAttr) continue

      const itemSize = referenceAttr.itemSize
      const normalized = referenceAttr.normalized
      const ArrayType = referenceAttr.array.constructor as any
      const dataArray = new ArrayType(vertexCount * itemSize)

      const isColorAttr = unionAttr === 'color' || unionAttr.startsWith('color_')
      const fillValue = isColorAttr ? (ArrayType === Float32Array ? 1.0 : 255) : 0
      for (let index = 0; index < dataArray.length; index++) {
        dataArray[index] = fillValue
      }

      const BufferAttrType = referenceAttr.constructor as any
      geom.setAttribute(unionAttr, new BufferAttrType(dataArray, itemSize, normalized))
    }
  }
}

/** 反转三角面顶点顺序，用于 scale(-1,1,1) 后恢复正确的正面朝向 */
function reverseGeometryWinding(geometry: BufferGeometry): void {
  const index = geometry.getIndex()

  if (index) {
    const array = index.array
    for (let cursor = 0; cursor < array.length; cursor += 3) {
      const second = array[cursor + 1]
      array[cursor + 1] = array[cursor + 2]!
      array[cursor + 2] = second!
    }
    index.needsUpdate = true
    return
  }

  for (const attribute of Object.values(geometry.attributes)) {
    const array = attribute.array
    const itemSize = attribute.itemSize

    for (let vertexIndex = 0; vertexIndex < attribute.count; vertexIndex += 3) {
      const secondOffset = (vertexIndex + 1) * itemSize
      const thirdOffset = (vertexIndex + 2) * itemSize

      for (let componentIndex = 0; componentIndex < itemSize; componentIndex++) {
        const second = array[secondOffset + componentIndex]
        array[secondOffset + componentIndex] = array[thirdOffset + componentIndex]!
        array[thirdOffset + componentIndex] = second!
      }
    }

    attribute.needsUpdate = true
  }
}

/**
 * 处理家具几何体：加载、变换、合并，并构建材质注册表。
 *
 * 只有名称符合 {baseName}_D0 或无命名规范的材质才计入实际材质槽位；
 * D1+, N*, O*, T* 变体材质通过 GLTF parser 加载到注册表，不占用几何体 group。
 */
export async function processGeometryForItem(
  itemId: number,
  config: FurnitureModelConfig,
  profile: ModelAssetProfile,
  getMeshAsset: (meshPath: string, hash?: string) => Promise<MeshAssetData | null>
): Promise<GeometryData | undefined> {
  const allGeometries: BufferGeometry[] = []
  const sourceMaterials: Material[] = []
  const meshBaseNames: (string | null)[] = []
  const slotMeshIndices: number[] = []
  const meshMaterialCounts: number[] = []
  const materialRegistry: MaterialRegistry = new Map()
  const tempMatrix = new Matrix4()
  const tempQuat = new Quaternion()
  const tempScale = new Vector3()
  const tempTrans = new Vector3()

  // Phase 1: 获取当前 item 依赖的共享 mesh 资产
  const meshAssets = await Promise.all(
    config.meshes.map((meshConfig) =>
      getMeshAsset(
        meshConfig.path,
        meshConfig.hashes?.[profile] ?? meshConfig.hashes?.full ?? meshConfig.hashes?.lite
      )
    )
  )

  // Phase 2: 串行处理几何体（维护材质数组顺序）
  for (let meshIdx = 0; meshIdx < config.meshes.length; meshIdx++) {
    const meshConfig = config.meshes[meshIdx]!
    const meshAsset = meshAssets[meshIdx]

    if (!meshAsset) {
      console.warn(`[ModelManager] Failed to load mesh: ${meshConfig.path}`)
      meshMaterialCounts.push(0)
      continue
    }

    const materialCountBefore = sourceMaterials.length
    mergeMaterialRegistry(materialRegistry, meshAsset.materialRegistry)

    for (const meshEntry of meshAsset.meshEntries) {
      const geom = meshEntry.geometry.clone()
      geom.applyMatrix4(meshEntry.localMatrix)

      // 游戏坐标系 X/Y/Z → Three.js X/Z/Y，trans 单位厘米 (/100)，Y 取反
      tempScale.set(meshConfig.scale.x, meshConfig.scale.z, meshConfig.scale.y)
      tempQuat.set(
        meshConfig.rotation.x,
        meshConfig.rotation.z,
        meshConfig.rotation.y,
        meshConfig.rotation.w
      )
      tempTrans.set(meshConfig.trans.x / 100, meshConfig.trans.z / 100, -meshConfig.trans.y / 100)
      tempMatrix.compose(tempTrans, tempQuat, tempScale)
      geom.applyMatrix4(tempMatrix)

      allGeometries.push(geom)
      sourceMaterials.push(cloneSourceMaterialForItem(meshEntry.material))
      meshBaseNames.push(meshEntry.baseName)
      slotMeshIndices.push(meshIdx)
    }

    meshMaterialCounts.push(sourceMaterials.length - materialCountBefore)
  }

  if (allGeometries.length === 0) {
    console.warn(`[ModelManager] No geometries loaded for itemId: ${itemId}`)
    return undefined
  }

  // 标准化属性并合并几何体
  if (allGeometries.length > 1) normalizeGeometryAttributes(allGeometries)

  let geometry: BufferGeometry
  if (allGeometries.length === 1) {
    geometry = allGeometries[0]!
  } else {
    const merged = mergeGeometries(allGeometries, true)
    if (!merged) {
      console.warn(`[ModelManager] Failed to merge geometries for itemId: ${itemId}`)
      return undefined
    }
    geometry = merged
  }

  // root_offset 单位厘米，scale(100) 转为米；游戏 Y-Up → 场景 Z-Up 需 X 镜像 + winding 反转 + rotateY/X
  const offset = config.root_offset
  geometry.translate(offset.y / 100, offset.z / 100, offset.x / 100)
  geometry.scale(100, 100, 100)

  geometry.scale(-1, 1, 1)
  reverseGeometryWinding(geometry)
  geometry.computeVertexNormals()
  geometry.rotateY(Math.PI / 2)
  geometry.rotateX(Math.PI / 2)

  geometry.computeBoundingBox()
  const boundingBox = geometry.boundingBox!.clone()

  // Phase 3: 构建默认材质（只加载 D0/M0/N0/O0/T0，其余变体在染色时按需加载）
  const plainMaterials = await Promise.all(
    sourceMaterials.map((sourceMat, idx) =>
      buildDefaultPlainMaterial(sourceMat, meshBaseNames[idx] ?? null, materialRegistry)
    )
  )

  const mergedMaterial: Material | Material[] =
    plainMaterials.length > 1 ? plainMaterials : (plainMaterials[0] ?? new MeshStandardMaterial())

  return {
    geometry,
    plainMaterials,
    meshBaseNames,
    slotMeshIndices,
    mergedMaterial,
    materialRegistry,
    boundingBox,
    meshMaterialCounts,
  }
}
