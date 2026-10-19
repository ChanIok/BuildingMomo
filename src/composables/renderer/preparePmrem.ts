import type { PMREMGenerator, Texture, WebGLRenderer, WebGLRenderTarget } from 'three'

/** PMREM's public conversion API draws synchronously. Submit its actual pass
 * programs first, without rasterizing, so the filtering draw never waits for
 * shader compilation. Both passes reuse the generator's own shaders/targets. */
export async function preparePmrem(
  renderer: WebGLRenderer,
  generator: PMREMGenerator,
  texture: Texture,
  stale: () => boolean
): Promise<WebGLRenderTarget | undefined> {
  const previous = new Set(renderer.info.programs ?? [])
  const render = renderer.render
  let target: WebGLRenderTarget | undefined
  try {
    renderer.render = (object, camera) => {
      renderer.compile(object, camera)
    }
    try {
      target = generator.fromEquirectangular(texture)
    } finally {
      renderer.render = render
    }

    const programs = (renderer.info.programs ?? []).filter(
      (program) => !previous.has(program)
    ) as unknown as { program: WebGLProgram }[]
    const gl = renderer.getContext()
    const parallel = gl.getExtension('KHR_parallel_shader_compile')
    if (parallel) {
      while (
        !stale() &&
        !gl.isContextLost() &&
        programs.some(
          ({ program }) => !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)
        )
      ) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }
    if (stale() || gl.isContextLost()) {
      target.dispose()
      return
    }
    // Conversion cleanup disables scissoring for consumers; the filtering
    // passes need the freshly allocated target's original scissor behavior.
    target.scissorTest = true
    return generator.fromEquirectangular(texture, target)
  } catch (error) {
    target?.dispose()
    throw error
  }
}
