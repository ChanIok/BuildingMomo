import { ref, watch, markRaw, type Ref } from 'vue'
import {
  BoxGeometry,
  PlaneGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  InstancedBufferAttribute,
  Matrix4,
  ShaderMaterial,
  Quaternion,
  Vector3,
  GLSL3,
  Sphere,
} from 'three'
import type { useEditorStore } from '@/stores/editorStore'
import type { AppItem } from '@/types/editor'
import { coordinates3D } from '@/lib/coordinates'
import type { useFurnitureStore } from '@/stores/furnitureStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getThreeIconManager } from './useThreeIconManager'

const MAX_INSTANCES = 10000

// 当缺少尺寸信息时使用的默认尺寸（游戏坐标：X=长, Y=宽, Z=高）
const DEFAULT_FURNITURE_SIZE: [number, number, number] = [100, 100, 150]

export function useThreeInstancedRenderer(
  editorStore: ReturnType<typeof useEditorStore>,
  furnitureStore: ReturnType<typeof useFurnitureStore>,
  isTransformDragging?: Ref<boolean>
) {
  const settingsStore = useSettingsStore()

  // === Box 模式（原有） & Simple Box 模式（复用） ===
  // 基础几何体 1x1x1
  const baseGeometry = new BoxGeometry(1, 1, 1)

  // 创建带边框效果的 ShaderMaterial 辅助函数
  const createBoxMaterial = (opacity: number) => {
    return new ShaderMaterial({
      uniforms: {
        uOpacity: { value: opacity },
        uBorderWidth: { value: 0.6 }, // 物理边框宽度 (单位: 游戏世界单位)
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vScale;
        varying vec3 vLocalNormal; // 传递模型空间的原始法线

        void main() {
          vUv = uv;
          vLocalNormal = normal; // BoxGeometry 的原始法线是轴对齐的
          
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
          #endif

          // 从 instanceMatrix 提取缩放
          vec3 col0 = vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]);
          vec3 col1 = vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]);
          vec3 col2 = vec3(instanceMatrix[2][0], instanceMatrix[2][1], instanceMatrix[2][2]);
          
          vScale = vec3(length(col0), length(col1), length(col2));

          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        precision highp float;
        
        uniform float uOpacity;
        uniform float uBorderWidth;
        
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vScale;
        varying vec3 vLocalNormal;

        void main() {
          // === 物理等宽边框 + 平滑抗锯齿 + 面校正 ===
          
          // 根据法线判断当前渲染的是哪个面，并获取该面对应的物理尺寸
          // BoxGeometry 的 UV 映射规则:
          // 1. 顶/底面 (y轴): u -> x轴, v -> z轴
          // 2. 前/后面 (z轴): u -> x轴, v -> y轴
          // 3. 左/右面 (x轴): u -> z轴, v -> y轴
          
          vec3 absNormal = abs(vLocalNormal);
          vec2 faceScale = vec2(1.0);
          
          if (absNormal.y > 0.5) {
            // 顶面或底面
            faceScale = vec2(vScale.x, vScale.z);
          } else if (absNormal.z > 0.5) {
            // 前面或后面
            faceScale = vec2(vScale.x, vScale.y);
          } else {
            // 左面或右面 (x轴)
            faceScale = vec2(vScale.z, vScale.y);
          }
          
          // 1. 计算基础边框宽度 (UV空间)
          // 使用校正后的 faceScale
          vec2 baseUvBorder = uBorderWidth / max(faceScale, vec2(0.001));
          
          // 2. 计算平滑过渡区
          vec2 f = fwidth(vUv);
          vec2 smoothing = f * 1.5;
          
          // 3. smoothstep 平滑混合
          vec2 borderMin = smoothstep(baseUvBorder + smoothing, baseUvBorder, vUv);
          vec2 borderMax = smoothstep(1.0 - baseUvBorder - smoothing, 1.0 - baseUvBorder, vUv);
          
          float isBorder = max(max(borderMin.x, borderMax.x), max(borderMin.y, borderMax.y));
          isBorder = clamp(isBorder, 0.0, 1.0);

          // 边框颜色
          vec3 borderColor = vColor * 0.9;
          
          // 混合
          vec3 finalColor = mix(vColor, borderColor, isBorder);
          
          gl_FragColor = vec4(finalColor, uOpacity);
        }
      `,
      transparent: true,
      depthWrite: true,
      depthTest: true,
    })
  }

  const material = createBoxMaterial(0.9) // Box 透明度 0.9

  const instancedMesh = ref<InstancedMesh | null>(null)

  const indexToIdMap = ref(new Map<number, string>())
  const idToIndexMap = ref(new Map<string, number>())

  // 当前 hover 的物品（仅 3D 视图内部使用，不改变全局选中状态）
  const hoveredItemId = ref<string | null>(null)
  // 被抑制 hover 的物品 ID（用于在选中瞬间暂时屏蔽 hover 效果，直到鼠标移出）
  const suppressedHoverId = ref<string | null>(null)

  // 初始化 Box 实例
  const mesh = new InstancedMesh(baseGeometry, material, MAX_INSTANCES)
  // 关闭视锥体剔除，避免因包围球未更新导致大场景下消失
  mesh.frustumCulled = false
  // 确保 Raycaster 始终检测实例，不受默认包围球限制
  mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count = 0

  instancedMesh.value = markRaw(mesh)

  // === Simple Box 模式 ===
  // 复用 baseGeometry (1x1x1)，通过缩放实现 100x100x100 的效果
  const simpleBoxMaterial = createBoxMaterial(0.95) // 原 0.9

  const simpleBoxInstancedMesh = ref<InstancedMesh | null>(null)

  const simpleBoxMesh = new InstancedMesh(baseGeometry, simpleBoxMaterial, MAX_INSTANCES)
  simpleBoxMesh.frustumCulled = false
  // 确保 Raycaster 始终检测实例
  simpleBoxMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
  simpleBoxMesh.instanceMatrix.setUsage(DynamicDrawUsage)
  simpleBoxMesh.count = 0

  simpleBoxInstancedMesh.value = markRaw(simpleBoxMesh)

  // === Icon 模式（新增） ===
  const planeGeometry = new PlaneGeometry(100, 100)

  // 初始化纹理数组（使用 Texture2DArray）
  const iconManager = getThreeIconManager()
  const arrayTexture = iconManager.initTextureArray()

  // 为每个实例添加纹理索引属性（1个float: 纹理层索引）
  const textureIndices = new Float32Array(MAX_INSTANCES)
  planeGeometry.setAttribute('textureIndex', new InstancedBufferAttribute(textureIndices, 1))

  // 使用自定义 Shader 支持纹理数组和实例颜色
  const iconMaterial = new ShaderMaterial({
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
    // side: DoubleSide, // 双面渲染，确保 Raycaster 即使从背面射入也能检测到
  })

  const iconInstancedMesh = ref<InstancedMesh | null>(null)

  // Icon 模式使用相同的索引映射（与 Box 模式共享）

  // 初始化 Icon 实例
  const iconMesh = new InstancedMesh(planeGeometry, iconMaterial, MAX_INSTANCES)
  // 关闭视锥体剔除，避免因包围球未更新导致大场景下消失
  iconMesh.frustumCulled = false
  // 确保 Raycaster 始终检测实例
  iconMesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), Infinity)
  iconMesh.instanceMatrix.setUsage(DynamicDrawUsage)
  iconMesh.count = 0

  iconInstancedMesh.value = markRaw(iconMesh)

  // 存储当前的图标朝向（默认朝上，适配默认视图）
  const currentIconNormal = ref<[number, number, number]>([0, 1, 0])
  // 存储当前的图标 up 向量（用于约束旋转，防止绕法线旋转）
  const currentIconUp = ref<[number, number, number] | null>(null)

  const scratchMatrix = markRaw(new Matrix4())
  const scratchPosition = markRaw(new Vector3())
  const scratchEuler = markRaw(new Euler())
  const scratchQuaternion = markRaw(new Quaternion())
  const scratchScale = markRaw(new Vector3())
  const scratchColor = markRaw(new Color())
  const scratchTmpVec3 = markRaw(new Vector3(0, 0, 1))
  const scratchDefaultNormal = markRaw(new Vector3(0, 0, 1))
  const scratchUpVec3 = markRaw(new Vector3(0, 1, 0))
  const scratchLookAtTarget = markRaw(new Vector3())

  function convertColorToHex(colorStr: string | undefined): number {
    if (!colorStr) return 0x94a3b8
    const matches = colorStr.match(/\d+/g)
    if (!matches || matches.length < 3) return 0x94a3b8
    const r = parseInt(matches[0] ?? '148', 10)
    const g = parseInt(matches[1] ?? '163', 10)
    const b = parseInt(matches[2] ?? '184', 10)
    return (r << 16) | (g << 8) | b
  }

  function getItemColor(item: AppItem, type: 'box' | 'icon'): number {
    // hover 高亮优先级最高（即使物品已被选中，hover 时也显示为琥珀色）
    if (hoveredItemId.value === item.internalId) {
      return type === 'icon' ? 0xf59e0b : 0xf59e0b // Icon & Box/SimpleBox: amber-400
    }

    // 其次是选中高亮
    if (editorStore.selectedItemIds.has(item.internalId)) {
      return type === 'icon' ? 0x60a5fa : 0x60a5fa // Icon & Box/SimpleBox: blue-400
    }

    const groupId = item.originalData.GroupID
    if (groupId > 0) {
      return convertColorToHex(editorStore.getGroupColor(groupId))
    }

    return 0x94a3b8
  }

  // 仅更新实例颜色（用于选中状态变化或 hover 变化时的刷新）
  function updateInstancesColor() {
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = instancedMesh.value
    const iconMeshTarget = iconInstancedMesh.value
    const simpleBoxMeshTarget = simpleBoxInstancedMesh.value

    const items = editorStore.items
    const map = indexToIdMap.value
    if (!map || map.size === 0) return

    const itemById = new Map<string, AppItem>()
    for (const item of items) {
      itemById.set(item.internalId, item)
    }

    // 仅更新当前可见的 Mesh
    if (mode === 'box' && meshTarget) {
      for (const [index, id] of map.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        scratchColor.setHex(getItemColor(item, 'box'))
        meshTarget.setColorAt(index, scratchColor)
      }
      if (meshTarget.instanceColor) meshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'icon' && iconMeshTarget) {
      for (const [index, id] of map.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        scratchColor.setHex(getItemColor(item, 'icon'))
        iconMeshTarget.setColorAt(index, scratchColor)
      }
      if (iconMeshTarget.instanceColor) iconMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
      for (const [index, id] of map.entries()) {
        const item = itemById.get(id)
        if (!item) continue
        scratchColor.setHex(getItemColor(item, 'box'))
        simpleBoxMeshTarget.setColorAt(index, scratchColor)
      }
      if (simpleBoxMeshTarget.instanceColor) simpleBoxMeshTarget.instanceColor.needsUpdate = true
    }
  }

  // 局部更新单个物品的颜色（用于 hover 状态变化）
  function updateInstanceColorById(id: string) {
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = instancedMesh.value
    const iconMeshTarget = iconInstancedMesh.value
    const simpleBoxMeshTarget = simpleBoxInstancedMesh.value

    const index = idToIndexMap.value.get(id)
    if (index === undefined) return

    const item = editorStore.items.find((it) => it.internalId === id)
    if (!item) return

    if (mode === 'box' && meshTarget) {
      scratchColor.setHex(getItemColor(item, 'box'))
      meshTarget.setColorAt(index, scratchColor)
      if (meshTarget.instanceColor) meshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'icon' && iconMeshTarget) {
      scratchColor.setHex(getItemColor(item, 'icon'))
      iconMeshTarget.setColorAt(index, scratchColor)
      if (iconMeshTarget.instanceColor) iconMeshTarget.instanceColor.needsUpdate = true
    } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
      scratchColor.setHex(getItemColor(item, 'box'))
      simpleBoxMeshTarget.setColorAt(index, scratchColor)
      if (simpleBoxMeshTarget.instanceColor) simpleBoxMeshTarget.instanceColor.needsUpdate = true
    }
  }

  // 设置 hover 物品并局部刷新对应实例颜色
  function setHoveredItemId(id: string | null) {
    // 如果当前有被抑制的 hover ID，且传入的 ID 依然是它，则忽略（保持选中状态的颜色）
    if (suppressedHoverId.value && id === suppressedHoverId.value) {
      return
    }

    // 如果鼠标移到了其他物体或空处，解除抑制
    if (suppressedHoverId.value && id !== suppressedHoverId.value) {
      suppressedHoverId.value = null
    }

    const prevId = hoveredItemId.value
    hoveredItemId.value = id

    // 先恢复上一个 hover 的颜色，再应用新的 hover 颜色
    if (prevId && prevId !== id) {
      updateInstanceColorById(prevId)
    }

    if (id) {
      updateInstanceColorById(id)
    }
  }

  // 完整重建实例几何和索引映射（用于物品集合变化时）
  async function rebuildInstances() {
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = instancedMesh.value
    const iconMeshTarget = iconInstancedMesh.value
    const simpleBoxMeshTarget = simpleBoxInstancedMesh.value

    // 至少需要当前模式的 mesh 存在
    if (mode === 'box' && !meshTarget) return
    if (mode === 'icon' && !iconMeshTarget) return
    if (mode === 'simple-box' && !simpleBoxMeshTarget) return

    const items = editorStore.items
    const instanceCount = Math.min(items.length, MAX_INSTANCES)

    if (items.length > MAX_INSTANCES) {
      console.warn(
        `[ThreeInstancedRenderer] 当前可见物品数量 (${items.length}) 超过上限 ${MAX_INSTANCES}，仅渲染前 ${MAX_INSTANCES} 个`
      )
    }

    // 仅更新当前模式的 count
    if (mode === 'box' && meshTarget) meshTarget.count = instanceCount
    if (mode === 'icon' && iconMeshTarget) iconMeshTarget.count = instanceCount
    if (mode === 'simple-box' && simpleBoxMeshTarget) simpleBoxMeshTarget.count = instanceCount

    // 如果是 Icon 模式，需要预加载纹理
    if (mode === 'icon' && iconMeshTarget) {
      const itemIds = items.slice(0, instanceCount).map((item) => item.gameId)
      await iconManager.preloadIcons(itemIds).catch((err) => {
        console.warn('[ThreeInstancedRenderer] 图标预加载失败:', err)
      })

      // 预加载后更新纹理和深度 uniform
      const material = iconMeshTarget.material as ShaderMaterial
      if (material.uniforms) {
        if (material.uniforms.textureArray) {
          material.uniforms.textureArray.value = iconManager.getTextureArray()
        }
        if (material.uniforms.textureDepth) {
          material.uniforms.textureDepth.value = iconManager.getCurrentCapacity()
        }
      }
    }

    const map = new Map<number, string>()
    const symbolScale = settingsStore.settings.threeSymbolScale

    for (let index = 0; index < instanceCount; index++) {
      const item = items[index]
      if (!item) continue
      map.set(index, item.internalId)

      coordinates3D.setThreeFromGame(scratchPosition, { x: item.x, y: item.y, z: item.z })
      const { Rotation, Scale } = item.originalData

      // 1. Box 模式计算
      if (mode === 'box' && meshTarget) {
        scratchEuler.set(
          (Rotation.Roll * Math.PI) / 180,
          (Rotation.Yaw * Math.PI) / 180,
          (Rotation.Pitch * Math.PI) / 180,
          'XYZ'
        )
        scratchQuaternion.setFromEuler(scratchEuler)

        const furnitureSize = furnitureStore.getFurnitureSize(item.gameId) ?? DEFAULT_FURNITURE_SIZE
        const [sizeX, sizeY, sizeZ] = furnitureSize
        scratchScale.set((Scale.X || 1) * sizeX, (Scale.Z || 1) * sizeZ, (Scale.Y || 1) * sizeY)

        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        meshTarget.setMatrixAt(index, scratchMatrix)
      }

      // 2. Icon 模式计算
      if (mode === 'icon' && iconMeshTarget) {
        scratchTmpVec3
          .set(currentIconNormal.value[0], currentIconNormal.value[1], currentIconNormal.value[2])
          .normalize()

        if (currentIconUp.value) {
          scratchUpVec3
            .set(currentIconUp.value[0], currentIconUp.value[1], currentIconUp.value[2])
            .normalize()
          scratchLookAtTarget.set(-scratchTmpVec3.x, -scratchTmpVec3.y, -scratchTmpVec3.z)
          scratchMatrix.lookAt(new Vector3(0, 0, 0), scratchLookAtTarget, scratchUpVec3)
          scratchQuaternion.setFromRotationMatrix(scratchMatrix)
        } else {
          scratchQuaternion.setFromUnitVectors(scratchDefaultNormal, scratchTmpVec3)
        }

        scratchScale.set(symbolScale, symbolScale, symbolScale)
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        iconMeshTarget.setMatrixAt(index, scratchMatrix)

        const texIndex = iconManager.getTextureIndex(item.gameId)
        textureIndices[index] = texIndex
      }

      // 3. Simple Box 模式计算
      if (mode === 'simple-box' && simpleBoxMeshTarget) {
        // 旋转同 Box
        scratchEuler.set(
          (Rotation.Roll * Math.PI) / 180,
          (Rotation.Yaw * Math.PI) / 180,
          (Rotation.Pitch * Math.PI) / 180,
          'XYZ'
        )
        scratchQuaternion.setFromEuler(scratchEuler)

        // 缩放：基础 100 * symbolScale
        const s = 100 * symbolScale
        scratchScale.set(s, s, s)

        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        simpleBoxMeshTarget.setMatrixAt(index, scratchMatrix)
      }
    }

    // 标记更新
    if (mode === 'box' && meshTarget) meshTarget.instanceMatrix.needsUpdate = true
    if (mode === 'icon' && iconMeshTarget) {
      iconMeshTarget.instanceMatrix.needsUpdate = true
      const textureIndexAttr = planeGeometry.getAttribute('textureIndex')
      if (textureIndexAttr) textureIndexAttr.needsUpdate = true
    }
    if (mode === 'simple-box' && simpleBoxMeshTarget)
      simpleBoxMeshTarget.instanceMatrix.needsUpdate = true

    indexToIdMap.value = map
    const reverseMap = new Map<string, number>()
    for (const [index, id] of map.entries()) {
      reverseMap.set(id, index)
    }
    idToIndexMap.value = reverseMap

    // 刷新颜色
    updateInstancesColor()
  }

  // 辅助函数：应用位置增量到指定 Mesh
  function applyPositionDelta(mesh: InstancedMesh, index: number, delta: Vector3) {
    mesh.getMatrixAt(index, scratchMatrix)
    scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale)
    scratchPosition.add(delta)
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
    mesh.setMatrixAt(index, scratchMatrix)
    mesh.instanceMatrix.needsUpdate = true
  }

  // 局部更新选中物品的矩阵（用于拖拽时的视觉更新）
  function updateSelectedInstancesMatrix(selectedIds: Set<string>, deltaPosition: Vector3) {
    const mode = settingsStore.settings.threeDisplayMode
    const meshTarget = instancedMesh.value
    const iconMeshTarget = iconInstancedMesh.value
    const simpleBoxMeshTarget = simpleBoxInstancedMesh.value

    const reverseMap = idToIndexMap.value

    for (const id of selectedIds) {
      const index = reverseMap.get(id)
      if (index === undefined) continue

      if (mode === 'box' && meshTarget) {
        applyPositionDelta(meshTarget, index, deltaPosition)
      } else if (mode === 'icon' && iconMeshTarget) {
        applyPositionDelta(iconMeshTarget, index, deltaPosition)
      } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
        applyPositionDelta(simpleBoxMeshTarget, index, deltaPosition)
      }
    }
  }

  // 物品集合变化时重建实例；选中状态变化时仅刷新颜色
  watch(
    () => editorStore.items,
    () => {
      // 拖拽时不触发全量更新，由 handleGizmoChange 直接更新实例矩阵
      if (isTransformDragging?.value) {
        return
      }
      rebuildInstances()
    },
    { deep: true, immediate: true }
  )

  // 监听显示模式变化，立即重建实例
  watch(
    () => settingsStore.settings.threeDisplayMode,
    () => {
      rebuildInstances()
    }
  )

  // 更新 Icon 平面朝向（使其法线指向给定方向，同时约束up向量防止绕法线旋转）
  function updateIconFacing(normal: [number, number, number], up?: [number, number, number]) {
    // 仅在 Icon 模式下执行
    if (settingsStore.settings.threeDisplayMode !== 'icon') return

    // 归一化输入向量，避免存储大数值
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
    const normalized: [number, number, number] =
      len > 0.0001 ? [normal[0] / len, normal[1] / len, normal[2] / len] : [0, 0, 1] // 默认朝向

    // 保存归一化后的朝向和 up 向量，确保 rebuildInstances 时使用相同的旋转逻辑
    currentIconNormal.value = normalized
    currentIconUp.value = up || null

    const iconMeshTarget = iconInstancedMesh.value
    if (!iconMeshTarget) return

    const targetQuaternion = markRaw(new Quaternion())

    if (up) {
      // 如果提供了 up 向量，使用 lookAt 方法计算旋转（确保图标边缘平行于屏幕）
      // 构建一个临时的旋转矩阵：Z轴指向法线方向，Y轴尽量对齐up向量
      scratchTmpVec3.set(normalized[0], normalized[1], normalized[2])
      scratchUpVec3.set(up[0], up[1], up[2]).normalize()

      // 使用 Matrix4 的 lookAt 方法：从原点看向法线方向，up 向量约束旋转
      // 注意：lookAt 会让物体的 -Z 轴指向目标，但我们的平面默认法线是 +Z
      // 所以需要先 lookAt 反方向，然后旋转 180 度
      scratchLookAtTarget.set(-normalized[0], -normalized[1], -normalized[2])
      scratchMatrix.lookAt(new Vector3(0, 0, 0), scratchLookAtTarget, scratchUpVec3)

      // 提取旋转四元数
      targetQuaternion.setFromRotationMatrix(scratchMatrix)
    } else {
      // 如果没有提供 up 向量，使用原有的 setFromUnitVectors 方法（可能产生旋转）
      scratchTmpVec3.set(normalized[0], normalized[1], normalized[2])
      targetQuaternion.setFromUnitVectors(scratchDefaultNormal, scratchTmpVec3)
    }

    const scale = settingsStore.settings.threeSymbolScale
    scratchScale.set(scale, scale, scale)

    const count = iconMeshTarget.count

    for (let index = 0; index < count; index++) {
      // 读取现有矩阵，保留位置和缩放
      iconMeshTarget.getMatrixAt(index, scratchMatrix)
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchTmpVec3) // 使用临时变量接收旧缩放

      // 应用新朝向和当前设置的缩放
      scratchMatrix.compose(scratchPosition, targetQuaternion, scratchScale)
      iconMeshTarget.setMatrixAt(index, scratchMatrix)
    }

    iconMeshTarget.instanceMatrix.needsUpdate = true
  }

  // 更新图标和简化方块的缩放
  function updateSymbolsScale() {
    const mode = settingsStore.settings.threeDisplayMode
    const iconMeshTarget = iconInstancedMesh.value
    const simpleBoxMeshTarget = simpleBoxInstancedMesh.value
    const scale = settingsStore.settings.threeSymbolScale

    if (mode === 'icon' && iconMeshTarget) {
      scratchScale.set(scale, scale, scale)
      const count = iconMeshTarget.count
      for (let index = 0; index < count; index++) {
        iconMeshTarget.getMatrixAt(index, scratchMatrix)
        scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchTmpVec3)
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        iconMeshTarget.setMatrixAt(index, scratchMatrix)
      }
      iconMeshTarget.instanceMatrix.needsUpdate = true
    } else if (mode === 'simple-box' && simpleBoxMeshTarget) {
      // Simple Box 缩放需要 * 100
      const s = 100 * scale
      scratchScale.set(s, s, s)
      const count = simpleBoxMeshTarget.count
      for (let index = 0; index < count; index++) {
        simpleBoxMeshTarget.getMatrixAt(index, scratchMatrix)
        scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchTmpVec3)
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
        simpleBoxMeshTarget.setMatrixAt(index, scratchMatrix)
      }
      simpleBoxMeshTarget.instanceMatrix.needsUpdate = true
    }
  }

  // 监听图标/方块缩放设置变化
  watch(
    () => settingsStore.settings.threeSymbolScale,
    () => {
      updateSymbolsScale()
    }
  )

  watch(
    () => Array.from(editorStore.selectedItemIds),
    () => {
      if (isTransformDragging?.value) {
        return
      }

      // 1. 处理刚刚被选中的情况：抑制 Hover，使其显示选中色
      if (hoveredItemId.value && editorStore.selectedItemIds.has(hoveredItemId.value)) {
        suppressedHoverId.value = hoveredItemId.value
        hoveredItemId.value = null
      }

      // 2. 处理被抑制的物品不再被选中的情况：解除抑制
      if (suppressedHoverId.value && !editorStore.selectedItemIds.has(suppressedHoverId.value)) {
        suppressedHoverId.value = null
      }

      updateInstancesColor()
    }
  )

  return {
    instancedMesh,
    iconInstancedMesh,
    simpleBoxInstancedMesh,
    indexToIdMap,
    idToIndexMap,
    updateSelectedInstancesMatrix,
    setHoveredItemId,
    updateIconFacing,
  }
}
