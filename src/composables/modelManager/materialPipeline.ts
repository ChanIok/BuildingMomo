import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Material,
  type MeshStandardMaterialParameters,
  type Texture,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

/**
 * 懒加载贴图引用：支持内嵌贴图和 Lite 外链贴图两种来源。
 * _cache: undefined = 未加载；null = 加载失败；Texture = 已加载
 * _loading: 正在进行中的加载 Promise，防止并发重复解码
 */
export interface TextureRefBase {
  name: string
  _cache?: Texture | null
  _loading?: Promise<Texture | null>
}

export interface EmbeddedTextureRef extends TextureRefBase {
  kind: 'embedded'
  result: GLTF
}

export interface ExternalTextureRef extends TextureRefBase {
  kind: 'external'
  url: string
}

export type TextureRef = EmbeddedTextureRef | ExternalTextureRef

/** 单个 baseName 下各类型贴图的变体映射（懒加载引用） */
export interface MaterialRegistryEntry {
  D: Map<number, TextureRef> // diffuse 变体
  M: Map<number, TextureRef> // dye mask 变体
  N: Map<number, TextureRef> // normal 变体
  O: Map<number, TextureRef> // ORM 变体
  T: Map<number, TextureRef> // tint 调色板变体
}

/** 材质注册表：baseName → 各类型变体贴图 */
export type MaterialRegistry = Map<string, MaterialRegistryEntry>

interface ResolvedMaterialTextures {
  diffuse: Texture | null
  mask: Texture | null
  normal: Texture | null
  orm: Texture | null
  tint: Texture | null
}

interface ParsedMaterialName {
  baseName: string
  type: 'D' | 'M' | 'N' | 'O' | 'T'
  variantIdx: number
}

export interface TextureSourceSummary {
  textureSourceMode: 'external' | 'embedded' | 'mixed' | 'unknown'
  externalTextureRefs: number
  embeddedTextureRefs: number
}

// ─── 全局 fallback 贴图与外部贴图缓存（模块生命周期，不随 ModelManager 实例 dispose） ──

let whiteTex: DataTexture | null = null
const externalTextureLoader = new TextureLoader()
/** 外部贴图全局缓存，跨 profile 可复用，不随单个 ModelManager 实例的 dispose 清理 */
const externalTextureCache = new Map<string, Texture | null>()
const externalTextureLoading = new Map<string, Promise<Texture | null>>()

/** 材质名格式：{baseName}_{type}{variantIdx}，D=diffuse/M=mask/N=normal/O=ORM/T=tint */
const MATERIAL_NAME_RE = /^(?<baseName>.+)_(?<type>[DMNOT])(?<variantIdx>\d+)$/

/** 1×1 白色贴图（tint fallback：白色 × 任何颜色 = 原色） */
function getWhiteTex(): DataTexture {
  if (!whiteTex) {
    whiteTex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
    whiteTex.needsUpdate = true
  }

  return whiteTex
}

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
    entry = { D: new Map(), M: new Map(), N: new Map(), O: new Map(), T: new Map() }
    registry.set(baseName, entry)
  }

  return entry
}

function getMaterialDebugName(mat: Material): string {
  return mat.name?.trim() || '(unnamed)'
}

export function getMaterialVariantRefs(
  mat: Material
): Partial<Record<ParsedMaterialName['type'], string[]>> {
  const refs: Partial<Record<ParsedMaterialName['type'], string[]>> = {}
  const userData = mat.userData as Record<string, unknown>

  for (const type of ['D', 'M', 'N', 'O', 'T'] as const) {
    const raw = userData[type]
    if (!Array.isArray(raw)) continue

    const names = raw.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    )
    if (names.length > 0) refs[type] = names
  }

  return refs
}

export function resolveMaterialBaseName(mat: Material): string | null {
  const baseNames = new Set<string>()
  const variantRefs = getMaterialVariantRefs(mat)

  for (const type of ['D', 'M', 'N', 'O', 'T'] as const) {
    for (const textureName of variantRefs[type] ?? []) {
      const parsed = parseMaterialName(textureName)
      if (parsed) baseNames.add(parsed.baseName)
    }
  }

  if (baseNames.size === 1) {
    return Array.from(baseNames)[0] ?? null
  }

  return null
}

/** 对已解码贴图设置采样参数 */
function applyTextureSettings(
  texture: Texture,
  type: 'D' | 'M' | 'N' | 'O' | 'T',
  name: string
): void {
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

async function loadExternalTextureByUrl(url: string, textureName: string): Promise<Texture | null> {
  if (externalTextureCache.has(url)) {
    return externalTextureCache.get(url) ?? null
  }

  const pending = externalTextureLoading.get(url)
  if (pending) return pending

  const loadPromise = externalTextureLoader
    .loadAsync(url)
    .then((texture) => {
      const parsed = parseMaterialName(textureName)
      if (parsed) applyTextureSettings(texture, parsed.type, textureName)
      externalTextureCache.set(url, texture)
      externalTextureLoading.delete(url)
      return texture
    })
    .catch((error) => {
      console.warn(`[ModelManager] Failed to load external texture: ${url}`, error)
      externalTextureCache.set(url, null)
      externalTextureLoading.delete(url)
      return null
    })

  externalTextureLoading.set(url, loadPromise)
  return loadPromise
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

/**
 * 按需解码贴图，结果缓存在 TextureRef 上。
 * 相同 ref 并发调用时共享同一个加载 Promise，不会重复解码。
 */
async function resolveTextureRef(ref: TextureRef): Promise<Texture | null> {
  if ('_cache' in ref) return ref._cache ?? null
  if (ref._loading) return ref._loading

  const texturePromise =
    ref.kind === 'external'
      ? loadExternalTextureByUrl(ref.url, ref.name)
      : loadImageTextureByName(ref.result, ref.name).then((texture) => {
          const parsed = parseMaterialName(ref.name)
          if (texture && parsed) applyTextureSettings(texture, parsed.type, ref.name)
          return texture
        })

  ref._loading = texturePromise.then((texture) => {
    ref._cache = texture ?? null
    ref._loading = undefined
    return ref._cache
  })

  return ref._loading
}

/** 注册懒加载引用（不解码图片） */
function registerLazyVariant(
  registry: MaterialRegistry,
  textureName: string,
  result: GLTF,
  options?: { externalUrl?: string | null }
): void {
  const parsed = parseMaterialName(textureName)
  if (!parsed) return

  const entry = getOrCreateRegistryEntry(registry, parsed.baseName)
  const nextRef: TextureRef = options?.externalUrl
    ? { kind: 'external', name: textureName, url: options.externalUrl }
    : { kind: 'embedded', name: textureName, result }

  const existingRef = entry[parsed.type].get(parsed.variantIdx)
  if (!existingRef || (nextRef.kind === 'external' && existingRef.kind !== 'external')) {
    entry[parsed.type].set(parsed.variantIdx, nextRef)
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

/** 从现有材质上提取可复用贴图，作为注册表缺失时的兜底来源。 */
function getSourceMaterialTextures(sourceMat: Material): ResolvedMaterialTextures {
  return {
    diffuse: extractTexture(sourceMat, 'D'),
    mask: null,
    normal: extractTexture(sourceMat, 'N'),
    orm: extractTexture(sourceMat, 'O'),
    tint: null,
  }
}

function hasResolvedTextures(textures: ResolvedMaterialTextures): boolean {
  return !!(textures.diffuse || textures.mask || textures.normal || textures.orm || textures.tint)
}

/**
 * 判断材质是否具备参与运行时染色的基本信号。
 *
 * 如果既没有 D/M/N/O/T extras，也没有可复用的原始贴图，
 * 通常说明该槽位并不属于当前运行时染色体系，应静默回退到 plain 材质。
 */
function hasRuntimeDyeSignals(sourceMat: Material): boolean {
  const variantRefs = getMaterialVariantRefs(sourceMat)
  for (const type of ['D', 'M', 'N', 'O', 'T'] as const) {
    if ((variantRefs[type]?.length ?? 0) > 0) return true
  }

  return hasResolvedTextures(getSourceMaterialTextures(sourceMat))
}

/** 优先取指定变体，缺失时回退到 0 号默认变体。 */
function getTextureVariantRef(
  entry: MaterialRegistryEntry | undefined,
  type: keyof MaterialRegistryEntry,
  variantIdx: number
): TextureRef | undefined {
  return entry?.[type].get(variantIdx) ?? entry?.[type].get(0)
}

function resolveOptionalTexture(
  ref: TextureRef | undefined,
  fallback: Texture | null
): Promise<Texture | null> {
  return ref ? resolveTextureRef(ref) : Promise.resolve(fallback)
}

/**
 * 解析某个材质槽位最终要使用的贴图集合。
 * 这样 plain / dyed 两条路径都走同一套贴图决策，避免重复分支。
 */
async function resolveMaterialTextures({
  sourceMat,
  registryEntry,
  patternVariant = 0,
  tintVariant = 0,
}: {
  sourceMat: Material
  registryEntry?: MaterialRegistryEntry
  patternVariant?: number
  tintVariant?: number
}): Promise<ResolvedMaterialTextures> {
  const fallbackTextures = getSourceMaterialTextures(sourceMat)

  const [diffuse, mask, normal, orm, tint] = await Promise.all([
    resolveOptionalTexture(
      getTextureVariantRef(registryEntry, 'D', patternVariant),
      fallbackTextures.diffuse
    ),
    resolveOptionalTexture(getTextureVariantRef(registryEntry, 'M', patternVariant), null),
    resolveOptionalTexture(
      getTextureVariantRef(registryEntry, 'N', patternVariant),
      fallbackTextures.normal
    ),
    resolveOptionalTexture(
      getTextureVariantRef(registryEntry, 'O', patternVariant),
      fallbackTextures.orm
    ),
    resolveOptionalTexture(getTextureVariantRef(registryEntry, 'T', tintVariant), null),
  ])

  return { diffuse, mask, normal, orm, tint }
}

/** 染色遮罩优先使用独立 M 贴图，其次回退到 ORM 的 alpha。 */
function getMaterialMaskTexture(textures: ResolvedMaterialTextures): Texture | null {
  return textures.mask ?? textures.orm ?? null
}

/** 只有确实需要 tint 或 ORM alpha 蒙版时才挂 shader patch。 */
function shouldApplyDyeShader(textures: ResolvedMaterialTextures): boolean {
  return !!(textures.tint || textures.orm)
}

/**
 * 统一创建模型材质。
 * 这里负责基础 PBR 参数、贴图挂载，以及按需启用染色 shader。
 */
function createModelMaterial(textures: ResolvedMaterialTextures): MeshStandardMaterial {
  const params: MeshStandardMaterialParameters = {
    roughness: 0.8,
    metalness: 0.1,
    normalScale: new Vector2(1, 1),
    aoMapIntensity: 1.0,
    emissive: new Color(0x222222),
    emissiveIntensity: 0.03,
  }

  if (textures.diffuse) params.map = textures.diffuse
  if (textures.normal) params.normalMap = textures.normal
  if (textures.orm) {
    params.roughnessMap = textures.orm
    params.metalnessMap = textures.orm
    params.aoMap = textures.orm
  }

  const mat = new MeshStandardMaterial(params)
  const maskTex = getMaterialMaskTexture(textures)

  if (shouldApplyDyeShader(textures)) {
    applyDyeShaderPatch(mat, textures.tint, maskTex)
  }

  return mat
}

/**
 * 为材质注入染色 shader 管线（通过 onBeforeCompile 修改 MeshStandardMaterial）：
 *
 * Shader 管线（对应 Blender 节点图）：
 *   UV0 → D（albedo）贴图 ┐
 *   UV2 → T（调色板）贴图 ┘ Mix(Multiply, factor = Mask.a) → Base Color → Principled BSDF
 *   N（法线）→ Normal
 *   O（ORM，可选）→ R=AO, G=Roughness, B=Metallic, A=ORM Mask
 *   M（Mask，可选）→ A=Tint Mask
 *
 * 当前约定：
 *   1) 染色遮罩优先使用 M 的 A 通道，缺失时回退到 O 的 A 通道
 *   2) ORM 的 A 通道仅在存在 ORM 时，继续控制 roughness/metalness/AO 的生效区域
 */
function applyDyeShaderPatch(
  mat: MeshStandardMaterial,
  tTex: Texture | null,
  maskTex: Texture | null
): void {
  const effectiveTint = tTex ?? getWhiteTex()
  const effectiveMask = maskTex ?? getWhiteTex()

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

    // Fragment: Mix(Multiply, factor = Mask.a)（在 map_fragment 之后插入）
    // 使用 vMeshUv0 采样 dyeMaskMap，避免依赖仅在 USE_MAP 时才声明的 vMapUv
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
vec3 baseColor = diffuseColor.rgb;
vec4 dyeTint = texture2D(dyeTintMap, vTintUv);
float dyeMask = clamp(texture2D(dyeMaskMap, vMeshUv0).a, 0.0, 1.0);

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

  mat.customProgramCacheKey = () => 'dye_shader_v7_mask_map'
  mat.needsUpdate = true
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

export async function buildDefaultPlainMaterial(
  sourceMat: Material,
  baseName: string | null,
  registry: MaterialRegistry
): Promise<Material> {
  if (!baseName) return sourceMat

  const resolvedTextures = await resolveMaterialTextures({
    sourceMat,
    registryEntry: registry.get(baseName),
  })

  if (!hasResolvedTextures(resolvedTextures)) return sourceMat

  const resolvedMat = createModelMaterial(resolvedTextures)
  copyMaterialPresentation(resolvedMat, sourceMat)
  return resolvedMat
}

/**
 * 为合并几何体的每个材质槽位创建染色材质数组。
 *
 * 每个槽位先映射回其源 mesh 索引，再到 dyeMap 中查找该 mesh 的染色配置。
 * 命中 dyeMap → 按 pattern/tint 从注册表取贴图 → createModelMaterial
 * 未命中 dyeMap → 复用默认组装材质（D0/M0/N0/O0/T0）
 */
export async function buildDyedMaterials(
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

      const isDefaultVariant = dyeEntry.pattern === 0 && dyeEntry.tint === 0
      const baseName = meshBaseNames[idx]

      if (!baseName) {
        if (!isDefaultVariant && hasRuntimeDyeSignals(plainMat)) {
          console.warn(`[ModelManager][BuildDyed] ${debugLabel} slot=${idx} unresolved baseName`, {
            material: getMaterialDebugName(plainMat),
            meshIndex,
            dyeEntry,
          })
        }

        return plainMat
      }

      const resolvedTextures = await resolveMaterialTextures({
        sourceMat: plainMat,
        registryEntry: registry.get(baseName),
        patternVariant: dyeEntry.pattern,
        tintVariant: dyeEntry.tint,
      })

      if (!hasResolvedTextures(resolvedTextures)) return plainMat

      const dyedMat = createModelMaterial(resolvedTextures)
      copyMaterialPresentation(dyedMat, plainMat)
      return dyedMat
    })
  )

  return result.length === 1 ? result[0]! : (result as Material[])
}

/** 克隆 GLB 原始材质供单个 item 使用，同时深拷贝 userData（含变体引用信息） */
export function cloneSourceMaterialForItem(source: Material): Material {
  const cloned = source.clone()
  cloned.userData = { ...(source.userData as Record<string, unknown>) }
  return cloned
}

/**
 * 将 source 注册表合并进 target。
 * 合并规则：同一 baseName + type + variantIdx 下，external 引用优先于 embedded——
 * 因为 Lite 模式外链贴图质量更可控，且可被全局贴图缓存命中。
 */
export function mergeMaterialRegistry(target: MaterialRegistry, source: MaterialRegistry): void {
  for (const [baseName, sourceEntry] of source.entries()) {
    const targetEntry = getOrCreateRegistryEntry(target, baseName)
    for (const type of ['D', 'M', 'N', 'O', 'T'] as const) {
      for (const [variantIdx, ref] of sourceEntry[type].entries()) {
        const existingRef = targetEntry[type].get(variantIdx)
        if (!existingRef || (ref.kind === 'external' && existingRef.kind !== 'external')) {
          targetEntry[type].set(variantIdx, ref)
        }
      }
    }
  }
}

/** 释放注册表中所有已加载的内嵌贴图，并清空加载中状态 */
export function disposeMaterialRegistry(registry: MaterialRegistry): void {
  for (const entry of registry.values()) {
    for (const type of ['D', 'M', 'N', 'O', 'T'] as const) {
      for (const ref of entry[type].values()) {
        if (ref.kind === 'embedded' && ref._cache) {
          ref._cache.dispose()
          ref._cache = null
        }

        ref._loading = undefined
      }
    }
  }
}

/**
 * 从 GLTF JSON 的 material.extras 中扫描贴图变体名，注册懒加载引用到 MaterialRegistry。
 * 此阶段不解码任何图片，仅建立 baseName → TextureRef 的映射关系。
 * Lite 模式下通过 resolveExternalTextureUrl 将内嵌贴图替换为外链 URL。
 */
export function buildMaterialRegistryFromGLTF(
  result: GLTF,
  meshPath: string,
  profile: 'lite' | 'full',
  resolveExternalTextureUrl?: (meshPath: string, textureName: string) => string | null
): MaterialRegistry {
  const materialRegistry: MaterialRegistry = new Map()

  const getExternalUrl = (textureName: string) => {
    if (profile !== 'lite' || !resolveExternalTextureUrl) return null
    return resolveExternalTextureUrl(meshPath, textureName)
  }

  const rawMaterials = (result.parser.json.materials ?? []) as Array<{
    extras?: Record<string, unknown>
  }>

  for (const rawMat of rawMaterials) {
    const extras = rawMat.extras
    if (!extras) continue

    for (const type of ['D', 'M', 'N', 'O', 'T'] as const) {
      const raw = extras[type]
      if (!Array.isArray(raw)) continue

      for (const textureName of raw) {
        if (typeof textureName !== 'string' || !textureName.trim()) continue

        const normalizedTextureName = textureName.trim()
        registerLazyVariant(materialRegistry, normalizedTextureName, result, {
          externalUrl: getExternalUrl(normalizedTextureName),
        })
      }
    }
  }

  return materialRegistry
}

export function summarizeRegistryTextureSources(
  materialRegistry: MaterialRegistry
): TextureSourceSummary {
  let externalTextureRefs = 0
  let embeddedTextureRefs = 0

  for (const entry of materialRegistry.values()) {
    for (const type of ['D', 'M', 'N', 'O', 'T'] as const) {
      for (const ref of entry[type].values()) {
        if (ref.kind === 'external') externalTextureRefs++
        else embeddedTextureRefs++
      }
    }
  }

  const textureSourceMode =
    externalTextureRefs > 0 && embeddedTextureRefs > 0
      ? 'mixed'
      : externalTextureRefs > 0
        ? 'external'
        : embeddedTextureRefs > 0
          ? 'embedded'
          : 'unknown'

  return {
    textureSourceMode,
    externalTextureRefs,
    embeddedTextureRefs,
  }
}
