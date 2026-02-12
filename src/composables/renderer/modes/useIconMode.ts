import { ref, markRaw } from 'vue'
import {
  PlaneGeometry,
  InstancedMesh,
  InstancedBufferAttribute,
  DynamicDrawUsage,
  Sphere,
  Vector3,
  ShaderMaterial,
  GLSL3,
  DoubleSide,
  Color,
  Quaternion,
} from 'three'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorStore } from '@/stores/editorStore'
import { useLoadingStore } from '@/stores/loadingStore'
import { getThreeIconManager, disposeThreeIconManager } from '@/composables/useThreeIconManager'
import {
  scratchMatrix,
  scratchPosition,
  scratchScale,
  scratchTmpVec3,
  scratchDefaultNormal,
  scratchUpVec3,
  scratchLookAtTarget,
  scratchQuaternion,
} from '../shared/scratchObjects'
import { MAX_RENDER_INSTANCES as MAX_INSTANCES } from '@/types/constants'

/**
 * Icon 渲染模式
 *
 * 平面图标渲染（基于纹理数组）
 * 支持 Billboard 朝向控制和符号缩放
 */
export function useIconMode() {
  const settingsStore = useSettingsStore()
  const editorStore = useEditorStore()
  const loadingStore = useLoadingStore()
  const iconManager = getThreeIconManager()

  // 资源延迟初始化
  let planeGeometry: PlaneGeometry | null = null
  let iconMaterial: ShaderMaterial | null = null
  let iconMesh: InstancedMesh | null = null
  // 纹理索引属性数组（复用，按最大实例数分配）
  const textureIndices = new Float32Array(MAX_INSTANCES)

  const iconInstancedMesh = ref<InstancedMesh | null>(null)

  // 存储当前的图标朝向（默认朝上，适配默认视图）
  // Z-Up: 默认朝向 +Z (0,0,1)
  const currentIconNormal = ref<[number, number, number]>([0, 0, 1])
  // 存储当前的图标 up 向量（用于约束旋转，防止绕法线旋转）
  const currentIconUp = ref<[number, number, number] | null>(null)

  /**
   * 确保图标相关资源已初始化
   */
  function ensureIconResources(minCapacity: number = 32) {
    if (iconInstancedMesh.value) return

    console.log(`[IconMode] 初始化图标资源，请求容量: ${minCapacity}`)

    // 1. 初始化纹理数组
    // 如果已经初始化过且容量足够，initTextureArray 内部会直接返回现有纹理
    const arrayTexture = iconManager.initTextureArray(minCapacity)

    // 2. 初始化几何体
    if (!planeGeometry) {
      planeGeometry = new PlaneGeometry(100, 100)
      // 为每个实例添加纹理索引属性（1个float: 纹理层索引）
      planeGeometry.setAttribute('textureIndex', new InstancedBufferAttribute(textureIndices, 1))
      // 构建 BVH 加速结构
      planeGeometry.computeBoundsTree({
        setBoundingBox: true,
      })
    }

    // 3. 初始化材质
    if (!iconMaterial) {
      iconMaterial = new ShaderMaterial({
        uniforms: {
          textureArray: { value: arrayTexture },
          textureDepth: { value: iconManager.getCurrentCapacity() }, // 动态纹理深度
          uDefaultColor: { value: new Color(0x94a3b8) }, // 默认颜色
        },
        vertexShader: `
        // 自定义 attribute
        in float textureIndex;
        
        // Varyings
        out vec2 vUv;
        out float vTextureIndex;
        out vec3 vInstanceColor;
        
        void main() {
          vUv = uv;
          vTextureIndex = textureIndex;
          
          // instanceColor 由 Three.js 自动注入（当 USE_INSTANCING_COLOR 定义时）
          #ifdef USE_INSTANCING_COLOR
            vInstanceColor = instanceColor;
          #else
            vInstanceColor = vec3(1.0);
          #endif
          
          // 应用实例矩阵变换（instanceMatrix 由 Three.js 自动注入）
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
        fragmentShader: `
        precision highp sampler3D;
        
        uniform sampler3D textureArray;  // 3D 纹理数组
        uniform float textureDepth;      // 纹理数组的深度（动态）
        uniform vec3 uDefaultColor;      // 默认颜色
        
        in vec2 vUv;
        in float vTextureIndex;
        in vec3 vInstanceColor;
        
        out vec4 fragColor;
        
        void main() {
          // 将索引转换为归一化的 Z 坐标 (0.0 ~ 1.0)
          // 注意：为了精准采样，需要偏移到层中心
          float z = (vTextureIndex + 0.5) / textureDepth;
          
          // 从 3D 纹理中采样
          vec4 texColor = texture(textureArray, vec3(vUv.x, 1.0 - vUv.y, z));
          
          // 计算边框 (3% 宽度)
          float borderW = 0.03;
          bool isBorder = vUv.x < borderW || vUv.x > (1.0 - borderW) || 
                         vUv.y < borderW || vUv.y > (1.0 - borderW);
                         
          // 检查是否为默认颜色
          // 使用 uniform 传入的默认颜色进行比较，避免硬编码导致的精度问题
          float colorDist = distance(vInstanceColor, uDefaultColor);
          // 稍微放宽容差以防万一
          bool isDefaultColor = colorDist < 0.05;
          
          if (isBorder && !isDefaultColor) {
            // 显示实心边框
            fragColor = vec4(vInstanceColor, 1.0);
          } else {
            // 仅显示图标 (无底色)
            fragColor = texColor;
          }
          
          // Alpha 测试：如果几乎完全透明，则丢弃像素
          // 解决 depthWrite: true 导致的透明遮挡问题
          if (fragColor.a < 0.5) {
            discard;
          }
        }
      `,
        transparent: false,
        depthWrite: true,
        depthTest: true,
        glslVersion: GLSL3, // 启用 GLSL 3.0 （WebGL2）
        side: DoubleSide, // 双面渲染，确保 Raycaster 即使从背面射入也能检测到，且防止因镜像缩放导致的背面剔除
      })
    } else {
      // 如果材质已存在（可能是之前 dispose 后又重建），更新 uniforms
      if (iconMaterial.uniforms.textureArray) {
        iconMaterial.uniforms.textureArray.value = arrayTexture
      }
      if (iconMaterial.uniforms.textureDepth) {
        iconMaterial.uniforms.textureDepth.value = iconManager.getCurrentCapacity()
      }
    }

    // 4. 初始化 Mesh
    if (!iconMesh) {
      iconMesh = new InstancedMesh(planeGeometry, iconMaterial, MAX_INSTANCES)
      // 关闭视锥体剔除，避免因包围球未更新导致大场景下消失
      iconMesh.frustumCulled = false
      // 确保 Raycaster 始终检测实例
      iconMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
      iconMesh.instanceMatrix.setUsage(DynamicDrawUsage)
      iconMesh.count = 0
    }

    iconInstancedMesh.value = markRaw(iconMesh)
  }

  /**
   * 重建所有实例
   */
  async function rebuild() {
    const items = editorStore.activeScheme?.items.value ?? []
    const instanceCount = Math.min(items.length, MAX_INSTANCES)

    // 计算唯一图标数量并初始化资源
    const uniqueItemIdsSet = new Set(items.slice(0, instanceCount).map((item) => item.gameId))
    const initialCapacity = Math.max(32, uniqueItemIdsSet.size + 16)
    ensureIconResources(initialCapacity)

    const currentIconMeshTarget = iconInstancedMesh.value
    if (!currentIconMeshTarget) return

    currentIconMeshTarget.count = instanceCount

    // 预加载纹理
    const itemIds = items.slice(0, instanceCount).map((item) => item.gameId)
    const uniqueItemIds = Array.from(new Set(itemIds))

    // 先过滤出未加载的图标，避免进度条数量不匹配
    const unloadedIds = iconManager.getUnloadedIcons(uniqueItemIds)

    if (unloadedIds.length > 0) {
      // 开始加载，报告总数（使用simple模式）
      loadingStore.startLoading('icon', unloadedIds.length, 'simple')

      await iconManager
        .preloadIcons(itemIds, (current, total, failed) => {
          // 如果 total === 0，说明全部缓存命中，取消加载提示
          if (total === 0) {
            loadingStore.cancelLoading()
          } else {
            loadingStore.updateProgress(current, failed)
          }
        })
        .catch((err) => {
          console.warn('[IconMode] 图标预加载失败:', err)
          loadingStore.cancelLoading()
        })
    }
    // 如果全部已缓存，无需显示加载提示

    // 更新 uniform
    const material = currentIconMeshTarget.material as ShaderMaterial
    if (material.uniforms) {
      if (material.uniforms.textureArray) {
        material.uniforms.textureArray.value = iconManager.getTextureArray()
      }
      if (material.uniforms.textureDepth) {
        material.uniforms.textureDepth.value = iconManager.getCurrentCapacity()
      }
    }

    const symbolScale = settingsStore.settings.threeSymbolScale

    // 设置每个实例的矩阵和纹理索引
    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) continue

      // 位置
      scratchPosition.set(item.x, item.y, item.z)

      // 1. 计算基础旋转矩阵 (World Space LookAt)
      scratchTmpVec3
        .set(currentIconNormal.value[0], currentIconNormal.value[1], currentIconNormal.value[2])
        .normalize()

      if (currentIconUp.value) {
        scratchUpVec3
          .set(currentIconUp.value[0], currentIconUp.value[1], currentIconUp.value[2])
          .normalize()

        scratchLookAtTarget.set(-scratchTmpVec3.x, -scratchTmpVec3.y, -scratchTmpVec3.z)
        scratchMatrix.lookAt(new Vector3(0, 0, 0), scratchLookAtTarget, scratchUpVec3)
      } else {
        scratchQuaternion.setFromUnitVectors(scratchDefaultNormal, scratchTmpVec3)
        scratchMatrix.makeRotationFromQuaternion(scratchQuaternion)
      }

      // 2. 修正父级 Y 轴翻转 (Parent Scale: 1, -1, 1)
      // 将矩阵的第二行 (Row 1) 取反
      const el = scratchMatrix.elements
      el[1] = -el[1]
      el[5] = -el[5]
      el[9] = -el[9]
      // 注意：不翻转位移部分 (el[13])，因为 scratchPosition 已经是基于游戏坐标（即 Flip 后的坐标）

      // 3. 应用缩放
      scratchScale.set(symbolScale, symbolScale, symbolScale)
      scratchMatrix.scale(scratchScale)

      // 4. 应用位置
      scratchMatrix.setPosition(scratchPosition)

      currentIconMeshTarget.setMatrixAt(index, scratchMatrix)

      const texIndex = iconManager.getTextureIndex(item.gameId)
      textureIndices[index] = texIndex
    }

    currentIconMeshTarget.instanceMatrix.needsUpdate = true
    const textureIndexAttr = planeGeometry?.getAttribute('textureIndex')
    if (textureIndexAttr) textureIndexAttr.needsUpdate = true
  }

  /**
   * 更新 Icon 平面朝向（使其法线指向给定方向，同时约束up向量防止绕法线旋转）
   */
  function updateFacing(normal: [number, number, number], up?: [number, number, number]) {
    // 归一化输入向量，避免存储大数值
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
    const normalized: [number, number, number] =
      len > 0.0001 ? [normal[0] / len, normal[1] / len, normal[2] / len] : [0, 0, 1] // 默认朝向 +Z

    // 保存归一化后的朝向和 up 向量，确保 rebuild 时使用相同的旋转逻辑
    currentIconNormal.value = normalized
    currentIconUp.value = up || null

    const iconMeshTarget = iconInstancedMesh.value
    if (!iconMeshTarget) return

    // 1. 计算目标旋转矩阵 (World Space LookAt)
    if (up) {
      scratchTmpVec3.set(normalized[0], normalized[1], normalized[2])
      scratchUpVec3.set(up[0], up[1], up[2]).normalize()

      scratchLookAtTarget.set(-normalized[0], -normalized[1], -normalized[2])
      scratchMatrix.lookAt(new Vector3(0, 0, 0), scratchLookAtTarget, scratchUpVec3)
    } else {
      scratchTmpVec3.set(normalized[0], normalized[1], normalized[2])
      const quat = markRaw(new Quaternion())
      quat.setFromUnitVectors(scratchDefaultNormal, scratchTmpVec3)
      scratchMatrix.makeRotationFromQuaternion(quat)
    }

    // 2. 修正父级 Y 轴翻转
    const el = scratchMatrix.elements
    el[1] = -el[1]
    el[5] = -el[5]
    el[9] = -el[9]

    // 3. 预应用缩放
    const scale = settingsStore.settings.threeSymbolScale
    scratchScale.set(scale, scale, scale)
    scratchMatrix.scale(scratchScale)

    // 准备好纯旋转+缩放矩阵 (Target Matrix)
    // 我们将其拷贝到临时变量以供循环中使用
    const targetMatrix = scratchMatrix.clone()

    const count = iconMeshTarget.count

    for (let index = 0; index < count; index++) {
      // 获取当前矩阵以提取位置
      iconMeshTarget.getMatrixAt(index, scratchMatrix)

      // 提取位置 (Column 3: elements 12, 13, 14)
      scratchPosition.setFromMatrixPosition(scratchMatrix)

      // 使用预计算的旋转缩放矩阵
      scratchMatrix.copy(targetMatrix)

      // 恢复位置
      scratchMatrix.setPosition(scratchPosition)

      iconMeshTarget.setMatrixAt(index, scratchMatrix)
    }

    iconMeshTarget.instanceMatrix.needsUpdate = true
  }

  /**
   * 清理资源
   */
  function dispose() {
    if (iconMaterial?.uniforms.textureArray) {
      iconMaterial.uniforms.textureArray.value = null
    }
    if (iconMaterial?.uniforms.uDefaultColor) {
      iconMaterial.uniforms.uDefaultColor.value = null
    }
    if (planeGeometry?.boundsTree) {
      planeGeometry.disposeBoundsTree()
    }
    planeGeometry?.dispose()
    iconMaterial?.dispose()
    if (iconMesh) {
      iconMesh.geometry = null as any
      iconMesh.material = null as any
      iconMesh = null
    }
    if (iconInstancedMesh.value) {
      iconInstancedMesh.value = null
    }
    disposeThreeIconManager()
  }

  return {
    mesh: iconInstancedMesh,
    currentIconNormal,
    currentIconUp,
    rebuild,
    updateFacing,
    dispose,
  }
}
