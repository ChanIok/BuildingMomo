import type { Texture, WebGLRenderer } from 'three'

function createUniforms() {
  return {
    editorCloudTODCurve: { value: null as Texture | null },
    editorCloudTODTime: { value: 0 },
    editorCloudTODReady: { value: false },
  }
}

const states = new WeakMap<WebGLRenderer, ReturnType<typeof createUniforms>>()

/** The sky owns the source atlas; clouds and the flat map share its manual TOD sample. */
export function homeTodCurveUniforms(renderer: WebGLRenderer) {
  let state = states.get(renderer)
  if (!state) {
    state = createUniforms()
    states.set(renderer, state)
  }
  return state
}

export const homeTodCurveShader = /* glsl */ `
uniform sampler2D editorCloudTODCurve;
uniform float editorCloudTODTime;
uniform bool editorCloudTODReady;
vec3 homeCloudTODColor() {
  if (!editorCloudTODReady) return vec3(1.);
  // M_StaticClouds samples hour / 24 at the centre of row 0 of the 256-row atlas.
  return texture2D(editorCloudTODCurve, vec2(editorCloudTODTime, .5 / 256.)).rgb;
}
`
