import { PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { WebGLRenderer, Scene } from 'three'

/**
 * 管理场景的环境贴图 (IBL)
 * 使用 RoomEnvironment 动态生成高质量的环境光，无需加载外部 HDR 图片
 */
export function useThreeEnvironment() {
  /**
   * 初始化环境光
   * @param renderer WebGL 渲染器实例
   * @param scene 场景实例
   * @param intensity 环境光强度 (默认 1.0)
   */
  function setupEnvironment(renderer: WebGLRenderer, scene: Scene, intensity: number = 1.0) {
    // 1. 创建 PMREM 生成器（用于将环境图预处理为适合 PBR 渲染的格式）
    const pmremGenerator = new PMREMGenerator(renderer)
    pmremGenerator.compileEquirectangularShader()

    // 2. 创建虚拟的室内环境
    // RoomEnvironment 提供了一个明亮的、中性的摄影棚光照
    const roomEnvironment = new RoomEnvironment()

    // 3. 生成环境贴图
    const envMap = pmremGenerator.fromScene(roomEnvironment).texture

    // 4. 应用到主场景
    scene.environment = envMap

    // 5. 设置 IBL 强度
    // 1.0 = 默认亮度, 0.5 = 半亮, 2.0 = 两倍亮
    scene.environmentIntensity = intensity

    // 6. 清理资源
    roomEnvironment.dispose()
    pmremGenerator.dispose()

    console.log('[ThreeEnvironment] Generated RoomEnvironment IBL')

    return envMap
  }

  return {
    setupEnvironment,
  }
}
