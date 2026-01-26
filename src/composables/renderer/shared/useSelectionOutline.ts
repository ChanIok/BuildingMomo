import { ref, onUnmounted, markRaw } from 'vue'
import {
  WebGLRenderTarget,
  Scene,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  Mesh,
  Color,
  LinearFilter,
  InstancedMesh,
  DoubleSide,
  DynamicDrawUsage,
  Sphere,
  Vector3,
  CustomBlending,
  MaxEquation,
  OneFactor,
  type WebGLRenderer,
  type Camera,
} from 'three'
import { scratchColor } from './scratchObjects'

// 颜色配置
const SELECTED_COLOR = new Color(0x60a5fa) // 蓝色
const HOVER_COLOR = new Color(0xf59e0b) // 琥珀色

// 用于读取颜色的临时对象
const tempColor = new Color()

/**
 * 选中描边管理器（屏幕空间）
 *
 * 通过离屏渲染 mask + 全屏后处理实现恒定像素描边
 */
export function useSelectionOutline() {
  // Mask RT（分辨率后续根据 canvas 动态调整）
  const maskRT = markRaw(
    new WebGLRenderTarget(1, 1, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    })
  )

  // Mask Scene（只放 mask meshes，不放到主场景）
  const maskScene = markRaw(new Scene())

  // itemId -> mask InstancedMesh
  const maskMeshMap = ref(new Map<number, InstancedMesh>())

  // 共享材质：使用自定义 shader 支持通过 instanceColor 控制实例可见性
  // depthTest=false 实现强穿透，fragment shader 通过 discard 排除未选中的实例
  // 双通道编码：R=选中状态，G=hover状态
  const maskMaterial = markRaw(
    new ShaderMaterial({
      vertexShader: `
        varying vec3 vInstanceColor;
        void main() {
          // Three.js 自动注入 instanceColor attribute
          vInstanceColor = instanceColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vInstanceColor;
        void main() {
          // R和G通道都为0表示不渲染
          if (vInstanceColor.r < 0.001 && vInstanceColor.g < 0.001) {
            discard;
          }
          // 输出RG通道用于后处理（R=选中，G=hover）
          gl_FragColor = vec4(vInstanceColor, 1.0);
        }
      `,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      // MAX 混合模式：防止后渲染的实例覆盖先渲染实例的颜色通道
      // 解决选中物品覆盖 hover 物品 G 通道导致描边残缺的问题
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    })
  )

  // Outline 全屏 quad
  const overlayScene = markRaw(new Scene())
  const overlayCamera = markRaw(new OrthographicCamera(-1, 1, 1, -1, 0, 1))

  // 缓存：是否有需要描边的内容（避免每帧遍历 maskMeshMap）
  const hasMaskContent = ref(false)

  const outlineShader = markRaw(
    new ShaderMaterial({
      uniforms: {
        uMask: { value: maskRT.texture },
        uResolution: { value: [1, 1] },
        uSelectedColor: { value: SELECTED_COLOR },
        uHoverColor: { value: HOVER_COLOR },
        uOutlineWidth: { value: 5.0 }, // 描边统一宽度
        uCoreWidth: { value: 2.5 }, // 核心实线宽度
      },
      vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
      fragmentShader: `
      precision highp float;
      
      uniform sampler2D uMask;
      uniform vec2 uResolution;
      uniform vec3 uSelectedColor;
      uniform vec3 uHoverColor;
      uniform float uOutlineWidth;
      uniform float uCoreWidth;
      
      varying vec2 vUv;
      
      void main() {
        vec2 texel = 1.0 / uResolution;
        
        // 中心点状态（RG双通道）
        vec2 centerMask = texture2D(uMask, vUv).rg;
        bool isInSelected = centerMask.r > 0.5;
        bool isInHovered = centerMask.g > 0.5;
        
        // 在 hover 物体内部 → 不画描边（外描边方案）
        if (isInHovered) {
          discard;
        }
        
        float selectedDist = 1000.0;
        float hoverDist = 1000.0;
        bool hasSelected = false;
        bool hasHover = false;
        
        // 采样范围
        int maxW = int(ceil(uOutlineWidth));
        
        for (int x = -maxW; x <= maxW; x++) {
          for (int y = -maxW; y <= maxW; y++) {
            if (x == 0 && y == 0) continue;
            
            vec2 offset = vec2(float(x), float(y)) * texel;
            vec2 val = texture2D(uMask, vUv + offset).rg;
            float dist = length(vec2(float(x), float(y)));
            
            // 检测 hover 边缘（G通道）- 始终检测，即使在选中物体内部
            if (val.g > 0.5 && dist <= uOutlineWidth && dist < hoverDist) {
              hoverDist = dist;
              hasHover = true;
            }
            
            // 检测选中边缘（R通道）- 仅在物体外部时检测
            if (!isInSelected) {
              if (val.r > 0.5 && dist <= uOutlineWidth && dist < selectedDist) {
                selectedDist = dist;
                hasSelected = true;
              }
            }
          }
        }
        
        // 如果在选中物体内部且没有检测到 hover 边缘 → discard
        if (isInSelected && !hasHover) {
          discard;
        }
        
        if (!hasSelected && !hasHover) {
          discard;
        }
        
        vec3 finalColor = vec3(0.0);
        float finalAlpha = 0.0;
        
        // 选中描边（底层）
        if (hasSelected) {
          float selectedAlpha;
          if (selectedDist <= uCoreWidth) {
            selectedAlpha = 1.0;
          } else {
            float range = uOutlineWidth - uCoreWidth;
            float d = selectedDist - uCoreWidth;
            selectedAlpha = pow(clamp(1.0 - d / range, 0.0, 1.0), 2.0);
          }
          finalColor = uSelectedColor;
          finalAlpha = selectedAlpha;
        }
        
        // hover 描边（顶层，覆盖选中描边）
        if (hasHover) {
          float hoverAlpha;
          if (hoverDist <= uCoreWidth) {
            hoverAlpha = 1.0;
          } else {
            float range = uOutlineWidth - uCoreWidth;
            float d = hoverDist - uCoreWidth;
            hoverAlpha = pow(clamp(1.0 - d / range, 0.0, 1.0), 2.0);
          }
          // hover 描边覆盖选中描边
          finalColor = uHoverColor;
          finalAlpha = max(finalAlpha, hoverAlpha);
        }
        
        gl_FragColor = vec4(finalColor, finalAlpha);
      }
    `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  )

  const overlayQuad = markRaw(new Mesh(new PlaneGeometry(2, 2), outlineShader))
  overlayScene.add(overlayQuad)

  /**
   * 初始化 mask mesh（为某个模型类型创建）
   *
   * 检测 originalMesh 是否变化（扩容、重建等），如果变化则重新创建 maskMesh
   */
  function initMaskMesh(
    itemId: number,
    originalMesh: InstancedMesh,
    maxInstances: number
  ): InstancedMesh {
    const existingMask = maskMeshMap.value.get(itemId)

    if (existingMask) {
      // 检查 geometry 是否匹配（mesh 重建会导致 geometry 引用变化）
      // 检查容量是否足够（扩容会导致 maxInstances 变化）
      const geometryMatch = existingMask.geometry === originalMesh.geometry
      const capacityMatch = existingMask.instanceMatrix.count >= originalMesh.instanceMatrix.count

      if (geometryMatch && capacityMatch) {
        // 可以复用现有的 maskMesh
        return existingMask
      }

      // geometry 或容量不匹配，需要重建
      disposeMaskMesh(itemId)
    }

    // 创建新的 maskMesh
    const maskMesh = new InstancedMesh(originalMesh.geometry, maskMaterial, maxInstances)

    maskMesh.frustumCulled = false
    maskMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    maskMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    maskMesh.count = 0

    const raw = markRaw(maskMesh)
    maskMeshMap.value.set(itemId, raw)
    maskScene.add(raw)

    return raw
  }

  /**
   * 更新 mask 状态
   *
   * 双通道编码：
   * - R通道 = 选中状态
   * - G通道 = hover状态
   * 两者可叠加，支持"选中且hover"的视觉反馈
   */
  function updateMasks(
    selectedIds: Set<string>,
    hoveredId: string | null,
    meshMap: Map<number, InstancedMesh>,
    internalIdToMeshInfo: Map<string, { itemId: number; localIndex: number }>,
    fallbackMesh: InstancedMesh | null
  ) {
    // ✅ 关键优化：让 mask mesh 共享主 mesh 的 instanceMatrix 缓冲区
    // 这样无需拷贝任何矩阵数据，完全消除 getMatrixAt 的 CPU-GPU 同步开销

    let hasContent = false

    for (const [itemId, maskMesh] of maskMeshMap.value.entries()) {
      let originalMesh: InstancedMesh | null = null
      if (itemId === -1 && fallbackMesh) {
        originalMesh = fallbackMesh
      } else {
        originalMesh = meshMap.get(itemId) || null
      }

      if (!originalMesh) {
        // 没有对应的 originalMesh（模型已被删除），隐藏这个 maskMesh
        maskMesh.count = 0
        continue
      }

      // 直接共享 instanceMatrix 缓冲区！
      maskMesh.instanceMatrix = originalMesh.instanceMatrix

      // ✅ 关键修复：maskMesh 的 count 应该等于主 mesh 的 count
      // 然后通过颜色来控制可见性
      maskMesh.count = originalMesh.count

      // 先将所有实例的颜色重置为 (0,0,0)
      for (let i = 0; i < originalMesh.count; i++) {
        scratchColor.setRGB(0, 0, 0)
        maskMesh.setColorAt(i, scratchColor)
      }
    }

    // 为选中的实例设置 R通道 = 1
    for (const id of selectedIds) {
      const meshInfo = internalIdToMeshInfo.get(id)
      if (!meshInfo) continue

      const { itemId, localIndex } = meshInfo
      const maskMesh = maskMeshMap.value.get(itemId)
      if (!maskMesh) continue

      // R=1 表示选中
      scratchColor.setRGB(1.0, 0.0, 0.0)
      maskMesh.setColorAt(localIndex, scratchColor)

      hasContent = true
    }

    // hover状态 → G通道 = 1（可叠加在选中之上）
    if (hoveredId) {
      const meshInfo = internalIdToMeshInfo.get(hoveredId)
      if (meshInfo) {
        const { itemId, localIndex } = meshInfo
        const maskMesh = maskMeshMap.value.get(itemId)
        if (maskMesh) {
          // 读取当前颜色，保留R通道，设置G通道
          maskMesh.getColorAt(localIndex, tempColor)
          tempColor.g = 1.0 // 叠加hover标记
          maskMesh.setColorAt(localIndex, tempColor)
          hasContent = true
        }
      }
    }

    // 更新所有 maskMesh 的 needsUpdate
    for (const maskMesh of maskMeshMap.value.values()) {
      if (maskMesh.instanceColor) {
        maskMesh.instanceColor.needsUpdate = true
      }
      maskMesh.instanceMatrix.needsUpdate = true
    }

    // 更新缓存标记
    hasMaskContent.value = hasContent
  }

  /**
   * 渲染 mask pass（在主场景渲染之前调用）
   *
   * @param renderer - WebGLRenderer
   * @param camera - 当前相机
   * @param canvasWidth - canvas CSS宽度
   * @param canvasHeight - canvas CSS高度
   */
  function renderMaskPass(
    renderer: WebGLRenderer,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number
  ) {
    if (!hasMaskContent.value) {
      return false
    }

    // ✅ DPI修复：考虑 devicePixelRatio，确保与实际渲染分辨率一致
    const pixelRatio = renderer.getPixelRatio()
    const width = Math.floor(canvasWidth * pixelRatio)
    const height = Math.floor(canvasHeight * pixelRatio)

    // 调整 RT 分辨率
    if (maskRT.width !== width || maskRT.height !== height) {
      maskRT.setSize(width, height)
      if (outlineShader.uniforms.uResolution) {
        outlineShader.uniforms.uResolution.value = [width, height]
      }
    }

    // 渲染 mask pass 到离屏 RT
    const oldRT = renderer.getRenderTarget()
    const oldClearColor = renderer.getClearColor(new Color())
    const oldClearAlpha = renderer.getClearAlpha()

    renderer.setRenderTarget(maskRT)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(maskScene, camera)

    // 恢复状态
    renderer.setRenderTarget(oldRT)
    renderer.setClearColor(oldClearColor, oldClearAlpha)

    return true
  }

  /**
   * 渲染 overlay（在主场景渲染之后调用）
   *
   * @param renderer - WebGLRenderer
   */
  function renderOverlay(renderer: WebGLRenderer) {
    // 在当前 RT 上叠加 overlay（不清空，不改变深度缓冲）
    const oldAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(overlayScene, overlayCamera)
    renderer.autoClear = oldAutoClear
  }

  /**
   * 同步 maskScene 的世界变换（处理 scale=[1,-1,1]）
   */
  function syncSceneTransform(scaleY: number) {
    maskScene.scale.set(1, scaleY, 1)
    maskScene.updateMatrixWorld(true)
  }

  function disposeMaskMesh(itemId: number) {
    const mesh = maskMeshMap.value.get(itemId)
    if (mesh) {
      maskScene.remove(mesh)
      mesh.geometry = null as any
      mesh.material = null as any
      maskMeshMap.value.delete(itemId)
    }
  }

  function dispose() {
    for (const [itemId] of maskMeshMap.value.entries()) {
      disposeMaskMesh(itemId)
    }
    maskMeshMap.value.clear()

    maskRT.dispose()
    maskMaterial.dispose()
    outlineShader.dispose()
    overlayQuad.geometry.dispose()
  }

  onUnmounted(() => {
    dispose()
  })

  return {
    initMaskMesh,
    updateMasks,
    renderMaskPass,
    renderOverlay,
    syncSceneTransform,
    disposeMaskMesh,
    dispose,
    // 暴露给调试
    maskScene,
    overlayScene,
  }
}
