import {
  InstancedMesh,
  DynamicDrawUsage,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Color,
  Matrix4,
  Quaternion,
  type Object3D,
  Box3,
  DataTexture,
  RGBAFormat,
  NearestFilter,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  Vector2,
  SRGBColorSpace,
  NoColorSpace,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import type { Texture } from 'three'
import { useGameDataStore } from '@/stores/gameDataStore'
import { MAX_RENDER_INSTANCES } from '@/types/constants'
import type { ModelDyePlan } from '@/lib/modelDye'
import { getGLBCacheEntry, putGLBCacheEntry } from '@/lib/glbCache'

// ─── 材质注册表类型 ───────────────────────────────────────────────────────────

/**
 * 懒加载贴图引用：持有 GLB 解析器引用，按需解码图片
 * _cache: undefined = 未加载；null = 加载失败；Texture = 已加载
 * _loading: 正在进行中的加载 Promise，防止并发重复解码
 */
interface TextureRef {
  name: string
  result: GLTF
  _cache?: Texture | null
  _loading?: Promise<Texture | null>
}

/** 单个 baseName 下各类型贴图的变体映射（懒加载引用） */
interface MaterialRegistryEntry {
  D: Map<number, TextureRef> // diffuse 变体
  N: Map<number, TextureRef> // normal 变体
  O: Map<number, TextureRef> // ORM 变体
  T: Map<number, TextureRef> // tint 调色板变体
}

/** 材质注册表：baseName → 各类型变体贴图 */
type MaterialRegistry = Map<string, MaterialRegistryEntry>

// ─── 全局 fallback 贴图 ───────────────────────────────────────────────────────

let _whiteTex: DataTexture | null = null

/** 1×1 白色贴图（tint fallback：白色 × 任何颜色 = 原色） */
function getWhiteTex(): DataTexture {
  if (!_whiteTex) {
    _whiteTex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
    _whiteTex.needsUpdate = true
  }
  return _whiteTex
}

// ─── 材质名解析 ───────────────────────────────────────────────────────────────

interface ParsedMaterialName {
  baseName: string
  type: 'D' | 'N' | 'O' | 'T'
  variantIdx: number
}

const MATERIAL_NAME_RE = /^(?<baseName>.+)_(?<type>[DNOT])(?<variantIdx>\d+)$/

function parseMaterialName(name: string): ParsedMaterialName | null {
  const trimmed = name.trim()
  if (!trimmed) return null

  const match = MATERIAL_NAME_RE.exec(trimmed)
  if (!match?.groups) return null
  const { baseName, type, variantIdx } = match.groups
  if (!baseName || !type || !variantIdx) return null

  return {
    baseName,
    type: type as ParsedMaterialName['type'],
    variantIdx: Number(variantIdx),
  }
}

function getOrCreateRegistryEntry(
  registry: MaterialRegistry,
  baseName: string
): MaterialRegistryEntry {
  let entry = registry.get(baseName)
  if (!entry) {
    entry = { D: new Map(), N: new Map(), O: new Map(), T: new Map() }
    registry.set(baseName, entry)
  }
  return entry
}

function getMaterialDebugName(mat: Material): string {
  return mat.name?.trim() || '(unnamed)'
}

function resolveMaterialBaseName(mat: Material): string | null {
  const baseNames = new Set<string>()
  const variantRefs = getMaterialVariantRefs(mat)
  for (const type of ['D', 'N', 'O', 'T'] as const) {
    for (const textureName of variantRefs[type] ?? []) {
      const parsed = parseMaterialName(textureName)
      if (parsed) baseNames.add(parsed.baseName)
    }
  }
  if (baseNames.size === 1) return Array.from(baseNames)[0] ?? null

  return null
}

/** 对已解码贴图设置采样参数 */
function applyTextureSettings(texture: Texture, type: 'D' | 'N' | 'O' | 'T', name: string): void {
  texture.flipY = false
  texture.name = name
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.colorSpace = type === 'D' || type === 'T' ? SRGBColorSpace : NoColorSpace

  if (type === 'T') {
    texture.minFilter = NearestFilter
    texture.magFilter = NearestFilter
    texture.generateMipmaps = false
  } else {
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = true
  }

  texture.needsUpdate = true
}

/**
 * 按需解码贴图，结果缓存在 TextureRef 上
 * 相同 ref 并发调用时共享同一个加载 Promise，不会重复解码
 */
async function resolveTextureRef(ref: TextureRef): Promise<Texture | null> {
  if ('_cache' in ref) return ref._cache ?? null
  if (ref._loading) return ref._loading
  ref._loading = loadImageTextureByName(ref.result, ref.name).then((texture) => {
    const parsed = parseMaterialName(ref.name)
    if (texture && parsed) applyTextureSettings(texture, parsed.type, ref.name)
    ref._cache = texture ?? null
    ref._loading = undefined
    return ref._cache
  })
  return ref._loading
}

/** 注册懒加载引用（不解码图片） */
function registerLazyVariant(registry: MaterialRegistry, textureName: string, result: GLTF): void {
  const parsed = parseMaterialName(textureName)
  if (!parsed) return
  const entry = getOrCreateRegistryEntry(registry, parsed.baseName)
  if (!entry[parsed.type].has(parsed.variantIdx)) {
    entry[parsed.type].set(parsed.variantIdx, { name: textureName, result })
  }
}

function getMaterialVariantRefs(
  mat: Material
): Partial<Record<ParsedMaterialName['type'], string[]>> {
  const refs: Partial<Record<ParsedMaterialName['type'], string[]>> = {}
  const userData = mat.userData as Record<string, unknown>

  for (const type of ['D', 'N', 'O', 'T'] as const) {
    const raw = userData[type]
    if (!Array.isArray(raw)) continue

    const names = raw.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    )
    if (names.length > 0) refs[type] = names
  }

  return refs
}

async function loadImageTextureByName(result: GLTF, imageName: string): Promise<Texture | null> {
  const parser = result.parser as any
  const images = (parser.json?.images ?? []) as Array<{ name?: string }>
  const imageIndex = images.findIndex((image) => image?.name === imageName)
  if (imageIndex < 0) {
    console.warn(`[ModelManager][TextureLoad] image not found in GLB: ${imageName}`)
    return null
  }

  const textureLoader = parser.textureLoader
  if (!textureLoader || typeof parser.loadImageSource !== 'function') {
    console.warn(`[ModelManager][TextureLoad] parser cannot load image source: ${imageName}`)
    return null
  }

  try {
    return (await parser.loadImageSource(imageIndex, textureLoader)) as Texture
  } catch (error) {
    console.warn(`[ModelManager] Failed to load image texture from GLB: ${imageName}`, error)
    return null
  }
}

function extractTexture(mat: Material, type: 'D' | 'N' | 'O'): Texture | null {
  if (!(mat as any).isMeshStandardMaterial) return null

  const stdMat = mat as MeshStandardMaterial
  switch (type) {
    case 'D':
      return stdMat.map ?? null
    case 'N':
      return stdMat.normalMap ?? null
    case 'O':
      return stdMat.roughnessMap ?? stdMat.metalnessMap ?? null
  }
}

// ─── Dye Shader（onBeforeCompile patch） ────────────────────────────────────

/**
 * 为材质注入染色 shader 管线（通过 onBeforeCompile 修改 MeshStandardMaterial）：
 *
 * Shader 管线（对应 Blender 节点图）：
 *   UV0 → D（albedo）贴图 ┐
 *   UV2 → T（调色板）贴图 ┘ Mix(Multiply, factor = ORM.a) → Base Color → Principled BSDF
 *   N（法线）→ Normal
 *   O（ORM）→ R=AO, G=Roughness, B=Metallic, A=Tint Mask
 *
 * O 的 A 通道同时控制三件事：
 *   1) D 与 D*T 的 mix factor（tint 染色强度）
 *   2) G/B 通道的生效遮罩（A=0 的区域不应用 roughness/metalness，保持默认值 1.0）
 *   3) R 通道的生效遮罩（A=0 的区域 AO=1.0，即无遮蔽）
 */
function applyDyeShaderPatch(
  mat: MeshStandardMaterial,
  tTex: Texture | null,
  oTex: Texture | null
): void {
  const effectiveTint = tTex ?? getWhiteTex()
  const effectiveMask = oTex ?? getWhiteTex()

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.dyeTintMap = { value: effectiveTint }
    shader.uniforms.dyeMaskMap = { value: effectiveMask }

    // Vertex: 声明 uv2 attribute、vTintUv（UV2）和 vMeshUv0（UV0）varying
    // vMeshUv0 直接读取内置 uv 属性，不依赖 Three.js 的条件宏（USE_MAP 等）
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute vec2 uv2;
varying vec2 vTintUv;
varying vec2 vMeshUv0;`
    )
    // Vertex: 传递 UV2 和 UV0
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vTintUv = uv2;
vMeshUv0 = uv;`
    )

    // Fragment: 声明 uniform 和 varying
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform sampler2D dyeTintMap;
uniform sampler2D dyeMaskMap;
varying vec2 vTintUv;
varying vec2 vMeshUv0;`
    )

    // Fragment: Mix(Multiply, factor = ORM.a)（在 map_fragment 之后插入）
    // 使用 vMeshUv0 采样 dyeMaskMap，避免依赖仅在 USE_MAP 时才声明的 vMapUv
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
vec3 baseColor = diffuseColor.rgb;
vec4 dyeTint = texture2D(dyeTintMap, vTintUv);
float dyeMask = clamp(texture2D(dyeMaskMap, vMeshUv0).a, 0.0, 1.0);

// vec3 dyedColor = baseColor * dyeTint.rgb * 2.0;

float tintLum = dot(dyeTint.rgb, vec3(0.299, 0.587, 0.114));
float boost = 1.0 / max(tintLum, 0.4);
vec3 dyedColor = clamp(baseColor * dyeTint.rgb * boost, 0.0, 1.0);

diffuseColor.rgb = mix(baseColor, dyedColor, dyeMask);`
    )

    // Fragment: ORM G/B 通道受 A 通道遮罩（使用 Three.js 官方 roughnessMap / vRoughnessMapUv）
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
{
  vec4 ormSample = texture2D( roughnessMap, vRoughnessMapUv );
  float ormAlpha = clamp(ormSample.a, 0.0, 1.0);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * ormSample.g, ormAlpha);
}
#endif`
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
{
  vec4 ormSample = texture2D( metalnessMap, vMetalnessMapUv );
  float ormAlpha = clamp(ormSample.a, 0.0, 1.0);
  metalnessFactor = mix(metalnessFactor, metalnessFactor * ormSample.b, ormAlpha);
}
#endif`
    )

    // Fragment: ORM R 通道 AO — 受 A 通道遮罩（A=0 区域 AO=1.0 即无遮蔽）
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      `#ifdef USE_AOMAP
{
  vec4 ormSampleAO = texture2D( aoMap, vAoMapUv );
  float ormAlphaAO = clamp(ormSampleAO.a, 0.0, 1.0);
  float ambientOcclusion = mix(1.0, ( ormSampleAO.r - 1.0 ) * aoMapIntensity + 1.0, ormAlphaAO);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}
#endif`
    )
  }

  // 同一套 patch 的所有材质共享编译缓存（shader 代码完全相同）
  mat.customProgramCacheKey = () => 'dye_shader_v6'
  mat.needsUpdate = true
}

/**
 * 根据染色贴图创建新材质
 *
 * @param dTex diffuse 贴图（D{pattern}），null 时无 map
 * @param nTex normal 贴图（N{pattern}），null 时无法线扰动
 * @param oTex ORM 贴图（O{pattern}），null 时不处理 roughness/metalness
 * @param tTex tint 调色板贴图（T{tint}），null 时用白色（无染色效果）
 */
function buildDyeMaterial(
  dTex: Texture | null,
  nTex: Texture | null,
  oTex: Texture | null,
  tTex: Texture | null
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    map: dTex ?? undefined,
    normalMap: nTex ?? undefined,
    normalScale: new Vector2(1, 1),
    // ORM：Three.js 负责 UV / 色彩空间，shader patch 叠加 A 通道遮罩
    roughnessMap: oTex ?? undefined,
    metalnessMap: oTex ?? undefined,
    aoMap: oTex ?? undefined,
    aoMapIntensity: 1.0,
    emissive: new Color(0x111111),
    emissiveIntensity: 0.02,
  })

  applyDyeShaderPatch(mat, tTex, oTex)
  return mat
}

function copyMaterialPresentation(target: Material, source: Material): void {
  target.name = source.name
  target.side = source.side
  target.transparent = source.transparent
  target.opacity = source.opacity
  target.alphaTest = source.alphaTest
  target.depthWrite = source.depthWrite
  target.depthTest = source.depthTest
  target.colorWrite = source.colorWrite
  target.toneMapped = source.toneMapped
  target.premultipliedAlpha = source.premultipliedAlpha
  target.blending = source.blending
  target.visible = source.visible

  if ((target as any).isMeshStandardMaterial && (source as any).isMeshStandardMaterial) {
    ;(target as MeshStandardMaterial).color.copy((source as MeshStandardMaterial).color)
  }
}

async function buildDefaultPlainMaterial(
  sourceMat: Material,
  baseName: string | null,
  registry: MaterialRegistry
): Promise<Material> {
  if (!baseName) return sourceMat

  const regEntry = registry.get(baseName)
  const d0 = regEntry?.D.get(0)
  const n0 = regEntry?.N.get(0)
  const o0 = regEntry?.O.get(0)
  const t0 = regEntry?.T.get(0)

  const [dTex, nTex, oTex, tTex] = await Promise.all([
    d0 ? resolveTextureRef(d0) : Promise.resolve(extractTexture(sourceMat, 'D')),
    n0 ? resolveTextureRef(n0) : Promise.resolve(extractTexture(sourceMat, 'N')),
    o0 ? resolveTextureRef(o0) : Promise.resolve(extractTexture(sourceMat, 'O')),
    t0 ? resolveTextureRef(t0) : Promise.resolve(null),
  ])

  // 没有默认贴图可用时，回退原始材质。
  if (!dTex && !nTex && !oTex && !tTex) return sourceMat

  const resolvedMat = buildDyeMaterial(dTex, nTex, oTex, tTex)
  copyMaterialPresentation(resolvedMat, sourceMat)
  return resolvedMat
}

/**
 * 为合并几何体的每个材质槽位创建染色材质数组
 *
 * 每个槽位先映射回其源 mesh 索引，再到 dyeMap 中查找该 mesh 的染色配置。
 * 命中 dyeMap → 按 pattern/tint 从注册表取贴图 → buildDyeMaterial
 * 未命中 dyeMap → 复用默认组装材质（D0/N0/O0/T0）
 */
async function buildDyedMaterials(
  plainMats: Material[],
  meshBaseNames: (string | null)[],
  slotMeshIndices: number[],
  registry: MaterialRegistry,
  dyeMap: Map<number, { pattern: number; tint: number }>,
  debugLabel: string
): Promise<Material | Material[]> {
  const result = await Promise.all(
    plainMats.map(async (plainMat, idx) => {
      const meshIndex = slotMeshIndices[idx] ?? -1
      const dyeEntry = dyeMap.get(meshIndex)
      if (!dyeEntry) return plainMat

      const baseName = meshBaseNames[idx]
      if (!baseName) {
        console.warn(`[ModelManager][BuildDyed] ${debugLabel} slot=${idx} unresolved baseName`, {
          material: getMaterialDebugName(plainMat),
          meshIndex,
          dyeEntry,
        })
        return plainMat
      }

      const regEntry = registry.get(baseName)
      const dRef = regEntry?.D.get(dyeEntry.pattern) ?? regEntry?.D.get(0)
      const nRef = regEntry?.N.get(dyeEntry.pattern) ?? regEntry?.N.get(0)
      const oRef = regEntry?.O.get(dyeEntry.pattern) ?? regEntry?.O.get(0)
      const tRef = regEntry?.T.get(dyeEntry.tint) ?? regEntry?.T.get(0)

      const [dTex, nTex, oTex, tTex] = await Promise.all([
        dRef ? resolveTextureRef(dRef) : Promise.resolve(extractTexture(plainMat, 'D')),
        nRef ? resolveTextureRef(nRef) : Promise.resolve(extractTexture(plainMat, 'N')),
        oRef ? resolveTextureRef(oRef) : Promise.resolve(extractTexture(plainMat, 'O')),
        tRef ? resolveTextureRef(tRef) : Promise.resolve(null),
      ])

      const dyedMat = buildDyeMaterial(dTex, nTex, oTex, tTex)
      copyMaterialPresentation(dyedMat, plainMat)
      return dyedMat
    })
  )

  return result.length === 1 ? result[0]! : (result as Material[])
}

// ─── 几何体标准化 ─────────────────────────────────────────────────────────────

/**
 * 标准化几何体属性，确保合并时各几何体属性集一致
 * - 关键属性（position, normal, uv）：交集，缺失则删除
 * - color 和 uv2：并集，缺失则补默认值（color→白色，uv2→零）
 * - 其他属性：交集，缺失则删除
 */
function normalizeGeometryAttributes(geometries: BufferGeometry[]): void {
  if (geometries.length <= 1) return

  const attributeSets = geometries.map((geom) => new Set(Object.keys(geom.attributes)))

  const commonAttributes = new Set(attributeSets[0])
  for (let i = 1; i < attributeSets.length; i++) {
    const currentSet = attributeSets[i]!
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

  for (let i = 0; i < geometries.length; i++) {
    const geom = geometries[i]!
    const attrs = Object.keys(geom.attributes)

    for (const attr of attrs) {
      if (!commonAttributes.has(attr) && !unionAttributes.has(attr)) {
        geom.deleteAttribute(attr)
      }
    }

    for (const unionAttr of unionAttributes) {
      if (!geom.attributes[unionAttr]) {
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
        for (let j = 0; j < dataArray.length; j++) dataArray[j] = fillValue

        const BufferAttrType = referenceAttr.constructor as any
        geom.setAttribute(unionAttr, new BufferAttrType(dataArray, itemSize, normalized))
      }
    }
  }
}

function reverseGeometryWinding(geometry: BufferGeometry): void {
  const index = geometry.getIndex()

  if (index) {
    const array = index.array
    for (let i = 0; i < array.length; i += 3) {
      const second = array[i + 1]
      array[i + 1] = array[i + 2]!
      array[i + 2] = second!
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

// ─── GLB 加载 ─────────────────────────────────────────────────────────────────

async function loadGLBModel(
  gltfLoader: GLTFLoader,
  MODEL_BASE_URL: string,
  meshPath: string,
  hash?: string
): Promise<GLTF | null> {
  const fileName = meshPath.endsWith('.glb') ? meshPath : `${meshPath}.glb`
  const url = `${MODEL_BASE_URL}${fileName}`

  try {
    // 有 hash 时查缓存，key = path，比对 hash 决定是否命中
    if (hash) {
      const entry = await getGLBCacheEntry(meshPath)
      if (entry?.hash === hash) {
        return (await gltfLoader.parseAsync(entry.buffer, url)) as GLTF
      }
    }

    // 缓存未命中或 hash 更新：fetch 原始 ArrayBuffer
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()

    // 异步写入 IDB（hash 变更时覆盖旧记录），不阻塞解析
    if (hash) putGLBCacheEntry(meshPath, hash, buffer).catch(() => {})

    return (await gltfLoader.parseAsync(buffer, url)) as GLTF
  } catch (error) {
    console.warn(`[ModelManager] Failed to load GLB: ${meshPath}`, error)
    return null
  }
}

// ─── 几何体处理 ───────────────────────────────────────────────────────────────

interface GeometryData {
  geometry: BufferGeometry
  /** 实际渲染的默认材质（由 registry 的 D0/N0/O0/T0 组装） */
  plainMaterials: Material[]
  /** plainMaterials 对应的 baseName，用于按槽位查找染色变体 */
  meshBaseNames: (string | null)[]
  /** plainMaterials 对应的源 mesh 索引（config.meshes 下标） */
  slotMeshIndices: number[]
  /** 合并后的单/多材质（plain InstancedMesh 用） */
  mergedMaterial: Material | Material[]
  /** 材质注册表：baseName → { D/N/O/T 变体贴图 } */
  materialRegistry: MaterialRegistry
  boundingBox: Box3
  meshMaterialCounts: number[]
}

/**
 * 处理家具几何体：加载、变换、合并，并构建材质注册表
 *
 * 只有名称符合 {baseName}_D0 或无命名规范的材质才计入实际材质槽位；
 * D1+, N*, O*, T* 变体材质通过 GLTF parser 加载到注册表，不占用几何体 group。
 */
async function processGeometryForItem(
  itemId: number,
  config: any,
  gltfLoader: GLTFLoader,
  MODEL_BASE_URL: string
): Promise<GeometryData | undefined> {
  const allGeometries: BufferGeometry[] = []
  const sourceMaterials: Material[] = []
  const meshBaseNames: (string | null)[] = []
  const slotMeshIndices: number[] = []
  const meshMaterialCounts: number[] = []
  const tempMatrix = new Matrix4()
  const tempQuat = new Quaternion()
  const tempScale = new Vector3()
  const tempTrans = new Vector3()

  // Phase 1: 并发加载所有 GLB（有 hash 时优先从 IDB 缓存读取）
  const gltfResults: GLTF[] = await Promise.all(
    config.meshes.map((meshConfig: any) =>
      loadGLBModel(gltfLoader, MODEL_BASE_URL, meshConfig.path, meshConfig.hash)
    )
  )

  // Phase 2: 串行处理几何体（维护材质数组顺序）
  for (let meshIdx = 0; meshIdx < config.meshes.length; meshIdx++) {
    const meshConfig = config.meshes[meshIdx]
    const result = gltfResults[meshIdx]

    if (!result) {
      console.warn(`[ModelManager] Failed to load mesh: ${meshConfig.path}`)
      meshMaterialCounts.push(0)
      continue
    }

    const materialCountBefore = sourceMaterials.length

    result.scene.traverse((child: Object3D) => {
      if (!(child as any).isMesh) return
      const mesh = child as Mesh
      const mat = mesh.material as Material

      const geom = mesh.geometry.clone()
      geom.applyMatrix4(mesh.matrix)

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

      const baseName = resolveMaterialBaseName(mat)

      allGeometries.push(geom)
      sourceMaterials.push(mat)
      meshBaseNames.push(baseName)
      slotMeshIndices.push(meshIdx)
    })

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

  // root_offset + 单位换算
  const offset = config.root_offset
  geometry.translate(offset.y / 100, offset.z / 100, offset.x / 100)
  geometry.scale(100, 100, 100)

  // 坐标系转换：GLTF Y-Up → 场景 Z-Up
  geometry.scale(-1, 1, 1)
  reverseGeometryWinding(geometry)
  geometry.computeVertexNormals()
  geometry.rotateY(Math.PI / 2)
  geometry.rotateX(Math.PI / 2)

  geometry.computeBoundingBox()
  const boundingBox = geometry.boundingBox!.clone()

  // Phase 3: 扫描材质 extras，注册懒加载引用（不解码任何图片）
  const materialRegistry: MaterialRegistry = new Map()
  for (const result of gltfResults) {
    if (!result) continue
    const rawMaterials = (result.parser.json.materials ?? []) as Array<{
      extras?: Record<string, unknown>
    }>
    for (const rawMat of rawMaterials) {
      const extras = rawMat.extras
      if (!extras) continue
      for (const type of ['D', 'N', 'O', 'T'] as const) {
        const raw = extras[type]
        if (!Array.isArray(raw)) continue
        for (const textureName of raw) {
          if (typeof textureName === 'string' && textureName.trim()) {
            registerLazyVariant(materialRegistry, textureName.trim(), result)
          }
        }
      }
    }
  }

  // 构建默认材质（只加载 D0/N0/O0/T0，其余变体在染色时按需加载）
  const plainMaterials = await Promise.all(
    sourceMaterials.map((sourceMat, idx) =>
      buildDefaultPlainMaterial(sourceMat, meshBaseNames[idx] ?? null, materialRegistry)
    )
  )

  for (const mat of plainMaterials) {
    if ((mat as any).isMeshStandardMaterial) {
      const stdMat = mat as MeshStandardMaterial
      stdMat.roughness = 0.8
      stdMat.metalness = 0.1
      stdMat.emissive = new Color(0x222222)
      stdMat.emissiveIntensity = 0.03
      stdMat.needsUpdate = true
    }
  }

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

// ─── Three.js 模型管理器 ──────────────────────────────────────────────────────

export function useThreeModelManager() {
  const gameDataStore = useGameDataStore()

  const gltfLoader = new GLTFLoader()
  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath(import.meta.env.BASE_URL + 'draco/')
  gltfLoader.setDRACOLoader(dracoLoader)

  const MODEL_BASE_URL = import.meta.env.BASE_URL + 'assets/furniture-model/'

  /** cacheKey → InstancedMesh */
  const meshMap = new Map<string, InstancedMesh>()

  /** itemId → 几何体数据（与染色无关） */
  const geometryCache = new Map<number, GeometryData>()

  /** cacheKey → 染色材质（与 meshMap 生命周期一致） */
  const coloredMaterialCache = new Map<string, Material | Material[]>()

  /**
   * 为指定家具创建 InstancedMesh
   */
  async function createInstancedMesh(
    itemId: number,
    cacheKey: string,
    instanceCount: number,
    dyePlan: ModelDyePlan
  ): Promise<InstancedMesh | null> {
    // 复用已有（容量足够时）
    if (meshMap.has(cacheKey)) {
      const existing = meshMap.get(cacheKey)!
      if (existing.instanceMatrix.count >= instanceCount) {
        return existing
      }
      console.log(
        `[ModelManager] 容量不足 ${cacheKey}: 需 ${instanceCount}, 当前 ${existing.instanceMatrix.count} → 重建`
      )
      disposeMesh(cacheKey)
    }

    // 加载几何体（缓存命中则直接使用）
    let geomData = geometryCache.get(itemId)
    if (!geomData) {
      const config = gameDataStore.getFurnitureModelConfig(itemId)
      if (!config || !config.meshes?.length) {
        console.warn(`[ModelManager] No model config for itemId: ${itemId}`)
        return null
      }
      const result = await processGeometryForItem(itemId, config, gltfLoader, MODEL_BASE_URL)
      if (!result) return null
      geomData = result
      geometryCache.set(itemId, geomData)
    }

    // 确定材质
    let material: Material | Material[]
    if (dyePlan.mode === 'plain') {
      material = geomData.mergedMaterial
    } else {
      let coloredMat = coloredMaterialCache.get(cacheKey)
      if (!coloredMat) {
        coloredMat = await buildDyedMaterials(
          geomData.plainMaterials,
          geomData.meshBaseNames,
          geomData.slotMeshIndices,
          geomData.materialRegistry,
          dyePlan.dyeMap,
          `itemId=${itemId} cacheKey=${cacheKey}`
        )
        coloredMaterialCache.set(cacheKey, coloredMat)
      }
      material = coloredMat
    }

    // Headroom 分配策略
    const allocatedCapacity = Math.min(
      Math.max(instanceCount + 16, Math.floor(instanceCount * 1.5), 32),
      MAX_RENDER_INSTANCES
    )

    const instancedMesh = new InstancedMesh(geomData.geometry, material, allocatedCapacity)
    instancedMesh.frustumCulled = false
    instancedMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    instancedMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    instancedMesh.count = 0

    meshMap.set(cacheKey, instancedMesh)
    return instancedMesh
  }

  function getMesh(cacheKey: string): InstancedMesh | null {
    return meshMap.get(cacheKey) ?? null
  }

  function getAllMeshes(): InstancedMesh[] {
    return Array.from(meshMap.values())
  }

  function getUnloadedModels(itemIds: number[]): number[] {
    return Array.from(new Set(itemIds)).filter((id) => !geometryCache.has(id))
  }

  function getModelBoundingBox(itemId: number): Box3 | null {
    return geometryCache.get(itemId)?.boundingBox ?? null
  }

  async function preloadModels(
    itemIds: number[],
    onProgress?: (current: number, total: number, failed: number) => void
  ): Promise<void> {
    const unloadedIds = Array.from(new Set(itemIds)).filter((id) => !geometryCache.has(id))

    if (unloadedIds.length === 0) {
      onProgress?.(0, 0, 0)
      return
    }

    console.log(`[ModelManager] Preloading ${unloadedIds.length} furniture models...`)
    let completed = 0
    let failed = 0

    await Promise.all(
      unloadedIds.map(async (itemId) => {
        try {
          const config = gameDataStore.getFurnitureModelConfig(itemId)
          if (!config?.meshes?.length) {
            failed++
            completed++
            onProgress?.(completed, unloadedIds.length, failed)
            return
          }
          const geomData = await processGeometryForItem(itemId, config, gltfLoader, MODEL_BASE_URL)
          if (geomData) {
            geometryCache.set(itemId, geomData)
          } else {
            failed++
          }
        } catch (err) {
          console.error(`[ModelManager] Error processing itemId ${itemId}:`, err)
          failed++
        }
        completed++
        onProgress?.(completed, unloadedIds.length, failed)
      })
    )

    console.log(`[ModelManager] Complete: ${completed - failed}/${unloadedIds.length} models`)
  }

  function disposeMesh(cacheKey: string): void {
    meshMap.delete(cacheKey)
  }

  function dispose(): void {
    console.log('[ModelManager] Disposing resources...')
    meshMap.clear()

    for (const { geometry, mergedMaterial } of geometryCache.values()) {
      geometry.dispose()
      if (Array.isArray(mergedMaterial)) {
        mergedMaterial.forEach((m) => m.dispose())
      } else {
        mergedMaterial.dispose()
      }
    }
    geometryCache.clear()

    for (const mat of coloredMaterialCache.values()) {
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    }
    coloredMaterialCache.clear()

    console.log('[ModelManager] Resources disposed')
  }

  function getStats() {
    return {
      activeMeshes: meshMap.size,
      cachedGeometries: geometryCache.size,
      cachedColoredMaterials: coloredMaterialCache.size,
    }
  }

  function getModelDebugInfo(itemId: number) {
    const data = geometryCache.get(itemId)
    if (!data) return null

    const {
      geometry,
      plainMaterials,
      meshBaseNames,
      boundingBox,
      meshMaterialCounts,
      materialRegistry,
    } = data
    const vertexCount = geometry.attributes.position?.count ?? 0
    const indexCount = geometry.index?.count ?? 0
    const triangleCount = Math.floor(indexCount > 0 ? indexCount / 3 : vertexCount / 3)
    const sizeX = boundingBox.max.x - boundingBox.min.x
    const sizeY = boundingBox.max.y - boundingBox.min.y
    const sizeZ = boundingBox.max.z - boundingBox.min.z

    return {
      vertexCount,
      triangleCount,
      boundingBox: {
        min: [boundingBox.min.x, boundingBox.min.y, boundingBox.min.z] as [number, number, number],
        max: [boundingBox.max.x, boundingBox.max.y, boundingBox.max.z] as [number, number, number],
        size: [sizeX, sizeY, sizeZ] as [number, number, number],
      },
      attributes: Object.keys(geometry.attributes),
      materials: plainMaterials.map(({ name }, index) => ({
        name: name || '(unnamed)',
        baseName: meshBaseNames[index] ?? null,
      })),
      meshMaterialCounts,
      registryBaseNames: Array.from(materialRegistry.keys()),
    }
  }

  return {
    createInstancedMesh,
    getMesh,
    getAllMeshes,
    getModelBoundingBox,
    getUnloadedModels,
    preloadModels,
    disposeMesh,
    dispose,
    getStats,
    getModelDebugInfo,
  }
}

// ─── 单例管理 ─────────────────────────────────────────────────────────────────

let managerInstance: ReturnType<typeof useThreeModelManager> | null = null

export function getThreeModelManager(): ReturnType<typeof useThreeModelManager> {
  if (!managerInstance) {
    managerInstance = useThreeModelManager()
    console.log('[ModelManager] 创建新实例')
  }
  return managerInstance
}

export function disposeThreeModelManager(): void {
  if (managerInstance) {
    console.log('[ModelManager] 清理资源')
    managerInstance.dispose()
    managerInstance = null
  }
}
