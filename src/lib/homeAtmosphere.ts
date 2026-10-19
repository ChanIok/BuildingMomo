import type { HomeTodColor } from './homeTodData'

export interface HomeAtmosphere {
  rayleigh: HomeTodColor
  rayleighHeight: number
  mie: HomeTodColor
  mieAbsorption: HomeTodColor
  mieHeight: number
  mieG: number
  ozone: HomeTodColor
  luminance: HomeTodColor
  lightIntensity: number
  fog: HomeTodColor
  fogColor: HomeTodColor
  secondFog: HomeTodColor
  secondFogColor: HomeTodColor
  fogStart: number
}

// NiKKiHomeOutdoor01 + WorldBase inheritance. Coefficients are km^-1,
// exponential distribution heights are km, and luminance is a linear multiplier.
// Unserialized native defaults are explicit here, not inferred from colour hex.
const absorption: HomeTodColor = [0.000444, 0.000444, 0.000444]
export const homeAtmospheres: readonly HomeAtmosphere[] = [
  {
    rayleigh: [0.0081, 0.01649499, 0.03],
    rayleighHeight: 6.5,
    mie: [0.02, 0.02, 0.02],
    mieAbsorption: [0.000444, 0.0004169786, 0.000397677],
    mieHeight: 3.3,
    mieG: 0.85,
    ozone: [0.000652150224, 0.001881, 0.000084995],
    luminance: [3.6, 4.359629, 6],
    lightIntensity: 6,
    fog: [0.012, 0.15, -3000],
    fogColor: [0.25, 0.145, 0.17494],
    secondFog: [0.035, 0.5, 0],
    secondFogColor: [0.042, 0.027, 0.052],
    fogStart: 4000,
  },
  {
    rayleigh: [0.0069, 0.01537002, 0.03],
    rayleighHeight: 7,
    mie: [0.006, 0.006, 0.006],
    mieAbsorption: [0.0001, 0.0000939141, 0.0000895669],
    mieHeight: 0.7,
    mieG: 0.8,
    ozone: [0.000652150224, 0.001881, 0.000084995],
    luminance: [2.75, 3.125, 5],
    lightIntensity: 5,
    fog: [0.012, 0.15, -1500],
    fogColor: [0.07, 0.0775, 0.1],
    secondFog: [0.052, 0.2, 0],
    secondFogColor: [1, 0.51, 0.3],
    fogStart: 3000,
  },
  {
    rayleigh: [0.006, 0.00733333, 0.01],
    rayleighHeight: 20,
    mie: [0.002, 0.002, 0.002],
    mieAbsorption: absorption,
    mieHeight: 1.1,
    mieG: 0.8,
    ozone: [0.000446197653, 0.001881, 0],
    luminance: [3.25, 3.979166, 5],
    lightIntensity: 3,
    fog: [0.01, 0.3, -5000],
    fogColor: [0.35, 0.729167, 1],
    secondFog: [0.15, 0.35, -2000],
    secondFogColor: [0.4, 0.7, 1],
    fogStart: 4000,
  },
  {
    rayleigh: [0.0125, 0.01875, 0.025],
    rayleighHeight: 6,
    mie: [0.005, 0.00125, 0],
    mieAbsorption: absorption,
    mieHeight: 1,
    mieG: 0.9,
    ozone: [0.00065, 0.001881, 0.000085],
    luminance: [2.7, 2.30625, 1.755],
    lightIntensity: 6,
    fog: [0.3, 0.35, -11000],
    fogColor: [0.227112, 0.262386, 0.3],
    secondFog: [0.04, 0.2, 0],
    secondFogColor: [1, 0.476402, 0.212387],
    fogStart: 4000,
  },
  {
    rayleigh: [0.1, 0.0936296, 0.084375],
    rayleighHeight: 8,
    mie: [0.04, 0.04, 0.04],
    mieAbsorption: absorption,
    mieHeight: 1.1,
    mieG: 0.7,
    ozone: [0.000345561, 0.001, 0.000045189],
    luminance: [0.03, 0.05, 0.15],
    lightIntensity: 1,
    fog: [0.03, 0.1, -16000],
    fogColor: [0.04, 0.05, 0.1],
    secondFog: [0.11, 0.18, -16000],
    secondFogColor: [0.03, 0.041667, 0.1],
    fogStart: 3000,
  },
]

const RADIUS = 6360
const TOP = 6420
// Fixed near-ground viewpoint for the simplified background, not live camera
// height or a claim that the native atmospheric LUT uses this exact origin.
const EYE = RADIUS + 0.01
const VIEW_STEPS = 24
const SUN_STEPS = 12

/** Bounded single-scattering approximation, not the native multi-scattering LUT.
 * No captured pixels or display colours enter this linear-radiance calculation.
 * View and sun vectors use a local Z-up planet tangent frame. */
export function sampleAtmosphere(
  atmosphere: HomeAtmosphere,
  elevation: number,
  azimuth: number,
  sunZ: number
): HomeTodColor {
  const viewX = Math.cos(elevation),
    viewZ = Math.sin(elevation)
  const sunX = Math.sqrt(Math.max(0, 1 - sunZ * sunZ)) * Math.cos(azimuth)
  const mu = viewX * sunX + viewZ * sunZ
  const phaseR = (3 * (1 + mu * mu)) / (16 * Math.PI)
  const g = atmosphere.mieG
  const phaseM = (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * mu, 1.5))
  const distance = -EYE * viewZ + Math.sqrt(EYE * EYE * (viewZ * viewZ - 1) + TOP * TOP)
  const depth: HomeTodColor = [0, 0, 0]
  const result: HomeTodColor = [0, 0, 0]
  for (let i = 0; i < VIEW_STEPS; i++) {
    // Quadratic spacing resolves the thin near-ground Mie layer even at zenith.
    const start = distance * (i / VIEW_STEPS) ** 2
    const end = distance * ((i + 1) / VIEW_STEPS) ** 2
    const t = (start + end) * 0.5,
      step = end - start
    const x = viewX * t,
      z = EYE + viewZ * t
    const radius = Math.hypot(x, z)
    const height = Math.max(0, radius - RADIUS)
    const density: HomeTodColor = [
      Math.exp(-height / atmosphere.rayleighHeight),
      Math.exp(-height / atmosphere.mieHeight),
      Math.max(0, 1 - Math.abs(height - 25) / 15),
    ]
    const dot = x * sunX + z * sunZ
    const ground = dot * dot - radius * radius + RADIUS * RADIUS
    const shadow = dot < 0 && ground >= 0
    const sunDepth: HomeTodColor = [0, 0, 0]
    if (!shadow) {
      const sunDistance = -dot + Math.sqrt(dot * dot - radius * radius + TOP * TOP)
      const ds = sunDistance / SUN_STEPS
      for (let j = 0; j < SUN_STEPS; j++) {
        const s = (j + 0.5) * ds
        const height = Math.sqrt(radius * radius + s * s + 2 * dot * s) - RADIUS
        sunDepth[0] += Math.exp(-height / atmosphere.rayleighHeight) * ds
        sunDepth[1] += Math.exp(-height / atmosphere.mieHeight) * ds
        sunDepth[2] += Math.max(0, 1 - Math.abs(height - 25) / 15) * ds
      }
    }
    for (let c = 0; c < 3; c++) {
      const extinction =
        atmosphere.rayleigh[c]! * density[0] +
        (atmosphere.mie[c]! + atmosphere.mieAbsorption[c]!) * density[1] +
        atmosphere.ozone[c]! * density[2]
      if (!shadow) {
        const solarDepth =
          atmosphere.rayleigh[c]! * sunDepth[0] +
          (atmosphere.mie[c]! + atmosphere.mieAbsorption[c]!) * sunDepth[1] +
          atmosphere.ozone[c]! * sunDepth[2]
        const scattering =
          atmosphere.rayleigh[c]! * density[0] * phaseR + atmosphere.mie[c]! * density[1] * phaseM
        result[c]! +=
          Math.exp(-depth[c]! - extinction * step * 0.5 - solarDepth) * scattering * step
      }
      depth[c]! += extinction * step
    }
  }
  return result.map(
    (value, c) => value * atmosphere.luminance[c]! * atmosphere.lightIntensity
  ) as HomeTodColor
}
