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
  MeshBasicMaterial,
  DoubleSide,
  DynamicDrawUsage,
  Sphere,
  Vector3,
  type WebGLRenderer,
  type Camera,
} from 'three'
import { scratchMatrix, scratchColor } from './scratchObjects'

// 颜色配置
const SELECTED_COLOR = new Color(0x60a5fa) // 蓝色
const HOVER_COLOR = new Color(0xf59e0b) // 琥珀色

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

  // 共享材质：depthTest=false 实现强穿透
  const maskMaterial = markRaw(
    new MeshBasicMaterial({
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
  )

  // Outline 全屏 quad
  const overlayScene = markRaw(new Scene())
  const overlayCamera = markRaw(new OrthographicCamera(-1, 1, 1, -1, 0, 1))

  const outlineShader = markRaw(
    new ShaderMaterial({
      uniforms: {
        uMask: { value: maskRT.texture },
        uResolution: { value: [1, 1] },
        uSelectedColor: { value: SELECTED_COLOR },
        uHoverColor: { value: HOVER_COLOR },
        uOutlineWidth: { value: 5.0 }, // 描边总宽度
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
        
        // 中心点（物体本身）
        float centerMask = texture2D(uMask, vUv).r;
        
        if (centerMask > 0.001) {
          discard;
        }
        
        float maxVal = 0.0;
        float minDist = 1000.0;
        
        // 采样范围
        int w = int(ceil(uOutlineWidth));
        
        for (int x = -w; x <= w; x++) {
          for (int y = -w; y <= w; y++) {
            if (x == 0 && y == 0) continue;
            
            vec2 offset = vec2(float(x), float(y)) * texel;
            float val = texture2D(uMask, vUv + offset).r;
            
            if (val > 0.001) {
              float dist = length(vec2(float(x), float(y)));
              
              if (dist <= uOutlineWidth) {
                if (dist < minDist) {
                  minDist = dist;
                  maxVal = max(maxVal, val);
                }
              }
            }
          }
        }
        
        if (maxVal < 0.001) {
          discard;
        }
        
        // 双层描边：核心完全不透明，外围柔和衰减
        float alpha;
        if (minDist <= uCoreWidth) {
          // 核心区域：完全不透明
          alpha = 1.0;
        } else {
          // 外围区域：从核心边界到总宽度之间平滑衰减
          float edgeRange = uOutlineWidth - uCoreWidth;
          float edgeDist = minDist - uCoreWidth;
          float edgeIntensity = 1.0 - (edgeDist / edgeRange);
          edgeIntensity = clamp(edgeIntensity, 0.0, 1.0);
          alpha = pow(edgeIntensity, 3.0); // 适度的衰减曲线
        }

        vec3 col = (maxVal > 0.75) ? uSelectedColor : uHoverColor;
        
        gl_FragColor = vec4(col, alpha);
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
   */
  function initMaskMesh(
    itemId: number,
    originalMesh: InstancedMesh,
    maxInstances: number
  ): InstancedMesh {
    if (maskMeshMap.value.has(itemId)) {
      return maskMeshMap.value.get(itemId)!
    }

    const maskMesh = new InstancedMesh(originalMesh.geometry, maskMaterial, maxInstances)

    maskMesh.frustumCulled = false
    maskMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
    maskMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    maskMesh.count = 0

    const raw = markRaw(maskMesh)
    maskMeshMap.value.set(itemId, raw)
    maskScene.add(raw)

    console.log(
      `[SelectionOutline] initMaskMesh created for itemId=${itemId}, total maskMeshes=${maskMeshMap.value.size}`
    )

    return raw
  }

  /**
   * 更新 mask 状态
   */
  function updateMasks(
    selectedIds: Set<string>,
    hoveredId: string | null,
    meshMap: Map<number, InstancedMesh>,
    internalIdToMeshInfo: Map<string, { itemId: number; localIndex: number }>,
    fallbackMesh: InstancedMesh | null
  ) {
    console.log('[SelectionOutline] updateMasks called:', {
      selectedIds: Array.from(selectedIds),
      hoveredId,
      meshMapSize: meshMap.size,
      internalIdToMeshInfoSize: internalIdToMeshInfo.size,
      maskMeshMapSize: maskMeshMap.value.size,
      fallbackMeshExists: !!fallbackMesh,
    })

    // 重置所有 mask mesh 的 count
    for (const maskMesh of maskMeshMap.value.values()) {
      maskMesh.count = 0
    }

    const maskIndexMap = new Map<number, number>()

    function addMaskInstance(internalId: string, isSelected: boolean) {
      const meshInfo = internalIdToMeshInfo.get(internalId)
      if (!meshInfo) {
        console.warn(`[SelectionOutline] No meshInfo found for internalId=${internalId}`)
        return
      }

      const { itemId, localIndex } = meshInfo

      let originalMesh: InstancedMesh | null = null
      if (itemId === -1 && fallbackMesh) {
        originalMesh = fallbackMesh
      } else {
        originalMesh = meshMap.get(itemId) || null
      }
      if (!originalMesh) {
        console.warn(`[SelectionOutline] No originalMesh found for itemId=${itemId}`)
        return
      }

      const maskMesh = maskMeshMap.value.get(itemId)
      if (!maskMesh) {
        console.warn(`[SelectionOutline] No maskMesh found for itemId=${itemId}`)
        return
      }

      console.log(
        `[SelectionOutline] Adding mask instance: internalId=${internalId}, itemId=${itemId}, localIndex=${localIndex}, isSelected=${isSelected}`
      )

      // 拷贝原始矩阵（不放大）
      originalMesh.getMatrixAt(localIndex, scratchMatrix)

      const maskIndex = maskIndexMap.get(itemId) || 0

      maskMesh.setMatrixAt(maskIndex, scratchMatrix)

      // 用 r 通道编码状态：selected=1, hover=0.5
      const stateValue = isSelected ? 1.0 : 0.5
      scratchColor.setRGB(stateValue, stateValue, stateValue)
      maskMesh.setColorAt(maskIndex, scratchColor)

      maskIndexMap.set(itemId, maskIndex + 1)
    }

    // 先添加选中实例
    for (const id of selectedIds) {
      addMaskInstance(id, true)
    }

    // hover 且不在选中列表中
    if (hoveredId && !selectedIds.has(hoveredId)) {
      addMaskInstance(hoveredId, false)
    }

    // 更新 count 和标记
    for (const [itemId, maskMesh] of maskMeshMap.value.entries()) {
      const count = maskIndexMap.get(itemId) || 0
      maskMesh.count = count

      if (count > 0) {
        console.log(`[SelectionOutline] Updated maskMesh itemId=${itemId}, count=${count}`)
        maskMesh.instanceMatrix.needsUpdate = true
        if (maskMesh.instanceColor) {
          maskMesh.instanceColor.needsUpdate = true
        }
      }
    }

    console.log('[SelectionOutline] updateMasks complete')
  }

  /**
   * 渲染 mask pass（在主场景渲染之前调用）
   *
   * @param renderer - WebGLRenderer
   * @param camera - 当前相机
   * @param width - canvas 宽度
   * @param height - canvas 高度
   */
  function renderMaskPass(renderer: WebGLRenderer, camera: Camera, width: number, height: number) {
    // 检查是否有需要描边的实例
    let hasContent = false
    for (const maskMesh of maskMeshMap.value.values()) {
      if (maskMesh.count > 0) {
        hasContent = true
        break
      }
    }

    if (!hasContent) {
      return false
    }

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
