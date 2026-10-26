import { CustomToneMapping, ShaderChunk, Vector3, Vector4, type WebGLRenderer } from 'three'
import type { HomeTodSample } from '@/lib/homeTod'

const states = new WeakMap<WebGLRenderer, ReturnType<typeof createUniforms>>()

function createUniforms() {
  return {
    editorHomeFilm: { value: new Vector4(0.82, 0.5, 0.58, 0.005) },
    editorHomeGamma: { value: new Vector3(1, 0.9925, 0.985) },
  }
}

export function homeOutputUniforms(renderer: WebGLRenderer) {
  let state = states.get(renderer)
  if (!state) {
    state = createUniforms()
    states.set(renderer, state)
  }
  return state
}

// The captured CombineLUTS pass uses the source film curve in AP1, not Cineon.
// Keep its analytic toe/straight/shoulder and pre/post desaturation. Native
// glow, gamut expansion, regional grading and LUT quantization are omitted.
const filmShader = /* glsl */ `
uniform vec4 editorHomeFilm;
uniform vec3 editorHomeGamma;

vec3 CustomToneMapping( vec3 color ) {
  vec4 film = editorHomeFilm.x > 0.0 ? editorHomeFilm : vec4(.82, .5, .58, .005);
  vec3 gamma = editorHomeGamma.x > 0.0 ? editorHomeGamma : vec3(1., .9925, .985);
  const mat3 toAP1 = mat3(
    .6130974, .0701937, .0206156,
    .3395231, .9163539, .1095698,
    .0473795, .0134524, .8698146
  );
  const mat3 toSRGB = mat3(
    1.705051, -.1302564, -.0240034,
    -.621792, 1.1408046, -.1289690,
    -.0832589, -.0105483, 1.1529723
  );
  const vec3 luma = vec3(.272229, .674082, .053690);
  color = max(toAP1 * (color * toneMappingExposure), vec3(0.));
  color = pow(color, 1. / gamma);
  color = mix(vec3(dot(color, luma)), color, .96);
  float slope = film.x, toe = film.y, shoulder = film.z, black = film.w;
  float toeScale = 1. + black - toe;
  float shoulderScale = 1.04 - shoulder;
  float bt = (.18 + black) / toeScale;
  float toeMatch = log(.18) / log(10.) - .5 * log(bt / (2. - bt)) * toeScale / slope;
  float straightMatch = (1. - toe) / slope - toeMatch;
  float shoulderMatch = shoulder / slope - straightMatch;
  vec3 logColor = log(max(color, vec3(1e-7))) / log(10.);
  vec3 straight = slope * (logColor + straightMatch);
  vec3 low = 2. * toeScale / (1. + exp(-2. * slope / toeScale * (logColor - toeMatch))) - black;
  vec3 high = 1.04 - 2. * shoulderScale / (1. + exp(2. * slope / shoulderScale * (logColor - shoulderMatch)));
  // OutputPass is GLSL ES 1.00: convert boolean selectors to numeric 0/1 masks.
  low = mix(straight, low, vec3(lessThan(logColor, vec3(toeMatch))));
  high = mix(straight, high, vec3(greaterThan(logColor, vec3(shoulderMatch))));
  vec3 blend = clamp((logColor - toeMatch) / (shoulderMatch - toeMatch), 0., 1.);
  if (shoulderMatch < toeMatch) blend = 1. - blend;
  color = mix(low, high, blend * blend * (3. - 2. * blend));
  color = mix(vec3(dot(color, luma)), color, .93);
  return clamp(toSRGB * color, 0., 1.);
}
`

export function updateHomeOutput(renderer: WebGLRenderer, sample: HomeTodSample) {
  if (!ShaderChunk.tonemapping_pars_fragment.includes('uniform vec4 editorHomeFilm;')) {
    ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(
      'vec3 CustomToneMapping( vec3 color ) { return color; }',
      filmShader
    )
  }
  const uniforms = homeOutputUniforms(renderer)
  uniforms.editorHomeFilm.value.set(sample.filmSlope, sample.filmToe, 0.58, 0.005)
  uniforms.editorHomeGamma.value.fromArray(sample.colorGamma)
  renderer.toneMapping = CustomToneMapping
  // Noon capture: eye adaptation .52596623 / pre-exposure .51920623.
  // Fix that exposure for the editor; only source PP bias ratios vary with TOD.
  // No scene histogram, automatic adaptation, or hour sampling of the EV curve.
  renderer.toneMappingExposure = (0.525966227054596 / 0.5192062258720398) * 2 ** sample.exposureBias
}
