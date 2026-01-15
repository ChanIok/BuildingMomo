import { ShaderMaterial } from 'three'

/**
 * 创建带边框效果的 ShaderMaterial
 *
 * 用于 Box 和 Simple Box 模式的渲染
 *
 * @param opacity - 材质透明度 (0.0 ~ 1.0)
 * @returns ShaderMaterial 实例
 */
export function createBoxMaterial(opacity: number): ShaderMaterial {
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
        // === 物理等宽边框 + 平滑抗锯齿 + 面处理 ===
        
        // 根据法线判断当前渲染的是哪个面，并获取该面对应的物理尺寸
        // BoxGeometry 的 UV 映射规则:
        // 1. 顶/底面 (y轴): u -> x轴, v -> z轴 (Z-Up: Normal.z > 0.5)
        // 2. 前/后面 (z轴): u -> x轴, v -> y轴 (Z-Up: Normal.y > 0.5)
        // 3. 左/右面 (x轴): u -> z轴, v -> y轴 (Z-Up: Normal.x > 0.5)
        
        vec3 absNormal = abs(vLocalNormal);
        vec2 faceScale = vec2(1.0);
        
        // Z-Up 处理：Z 轴是高度
        if (absNormal.z > 0.5) {
          // 顶面或底面 (XY Plane)
          faceScale = vec2(vScale.x, vScale.y);
        } else if (absNormal.y > 0.5) {
          // 前面或后面 (XZ Plane)
          faceScale = vec2(vScale.x, vScale.z);
        } else {
          // 左面或右面 (YZ Plane) (Normal.x)
          faceScale = vec2(vScale.z, vScale.y); // 待验证 UV 方向
          // Box UV: x faces have UVs mapping (z, y) usually
          faceScale = vec2(vScale.y, vScale.z); // Swap? BoxGeometry default UVs for X faces are Z,Y
        }
        
        // 1. 计算基础边框宽度 (UV空间)
        // 使用处理后的 faceScale
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
