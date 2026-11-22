import {
  homeTodLimitedCurve,
  homeTodPhases,
  homeTodSwapCurve,
  type HomeTodColor,
} from './homeTodData'
import { homeAtmospheres, type HomeAtmosphere } from './homeAtmosphere'

export interface HomeTodSample {
  /** Wrapped minutes since midnight; fractional minutes are supported. */
  minute: number
  /** Unit vector TO the source-informed light, in renderer world space (Z-up). */
  sunDirectionWorld: HomeTodColor
  sunColor: HomeTodColor
  /** Source Intensity only; no temperature, multiplier or editor calibration. */
  sunIntensity: number
  skyColor: HomeTodColor
  skyIntensity: number
  /** Source material boosts, not calibrated sky radiance. */
  skyZenith: HomeTodColor
  skyHorizon: HomeTodColor
  skyGradientPower: number
  skyHorizonOffset: number
  skyHorizonWidth: number
  groundColor: HomeTodColor
  waterReflectionTint: HomeTodColor
  generalReflectionTint: HomeTodColor
  generalReflectionKnown: boolean
  /** Active render row, not the Lua time category; retained through its transition. */
  phase: string
  /** Positive source Z, clamped for visible solar disk only; never gate the light. */
  sunVisible: number
  /** Unclamped source MPC curve; material day/night mixing is not solar-disk visibility. */
  swapLightFactor: number
  /** Authored PP tint used to grade the simplified diffuse probe, not specular IBL. */
  hemisphereDiffuseTint: HomeTodColor
  /** Static-cloud shader inputs: PaintFogColorB and CloudBloomTint, not ambient light. */
  cloudShade: HomeTodColor
  cloudLight: HomeTodColor
  filmSlope: number
  filmToe: number
  colorGamma: HomeTodColor
  /** Source PP compensation in stops, not the EV100 exposure curve. */
  exposureBias: number
  atmosphere: HomeAtmosphere
}

function lerp(a: number, b: number, weight: number): number {
  return a + (b - a) * weight
}

function mixColor(a: HomeTodColor, b: HomeTodColor, weight: number): HomeTodColor {
  return [lerp(a[0], b[0], weight), lerp(a[1], b[1], weight), lerp(a[2], b[2], weight)]
}

function sampleCurve(keys: typeof homeTodLimitedCurve, hour: number): number {
  if (hour <= keys[0]!.time) return keys[0]!.value
  for (let i = 1; i < keys.length; i++) {
    const right = keys[i]!
    if (hour > right.time) continue
    const left = keys[i - 1]!
    const duration = right.time - left.time
    const u = (hour - left.time) / duration
    if (left.mode === 'linear') return lerp(left.value, right.value, u)

    const u2 = u * u
    const u3 = u2 * u
    return (
      (2 * u3 - 3 * u2 + 1) * left.value +
      (u3 - 2 * u2 + u) * duration * left.leave +
      (-2 * u3 + 3 * u2) * right.value +
      (u3 - u2) * duration * right.arrive
    )
  }
  return keys[keys.length - 1]!.value
}

function limitedDirection(hour: number): HomeTodColor {
  // BP_DyEnvSky: local cone Pitch=105, then spot (Roll=-Y, Pitch=40, Yaw=-40).
  // Nominal editor policy: identity root, literal cone, no track/manual override.
  // UE positive pitch is up. These are the forward/Z axes of its Rotator matrix.
  const radians = Math.PI / 180
  const roll = -sampleCurve(homeTodLimitedCurve, hour) * radians
  const pitch = 40 * radians
  const yaw = -40 * radians
  const cone = 105 * radians
  const cr = Math.cos(roll),
    sr = Math.sin(roll)
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch)
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw)
  const cc = Math.cos(cone),
    sc = Math.sin(cone)
  const x = cc * cp * cy - sc * (cr * sp * cy + sr * sy)
  const y = cc * cp * sy + sc * (sr * cy - cr * sp * sy)
  const z = cc * sp + sc * cr * cp
  const length = Math.hypot(x, y, z)

  // Same data→world Y reflection as matrixTransform, without its Three/store imports.
  // Night retains this authored track; no invented moon orbit or horizon flip.
  return [x / length, -y / length, z / length]
}

/** Pure, manual-time sample. Source curves are exact double-precision Hermite;
 * phase mixing is an editor policy, not the unobserved native preset mixer.
 */
export function sampleHomeTod(minute: number): HomeTodSample {
  if (!Number.isFinite(minute)) throw new RangeError('Home TOD minute must be finite')
  const wrappedMinute = ((minute % 1440) + 1440) % 1440
  const hour = wrappedMinute / 60
  const sampleHour = hour < homeTodPhases[0]!.hour ? hour + 24 : hour
  let index = homeTodPhases.length - 1
  for (let i = 0; i < homeTodPhases.length; i++) {
    if (hour >= homeTodPhases[i]!.hour) index = i
  }
  const current = homeTodPhases[index]!
  const next = homeTodPhases[(index + 1) % homeTodPhases.length]!
  const endHour = current.endHour < current.hour ? current.endHour + 24 : current.endHour
  const nextHour = next.hour <= current.hour ? next.hour + 24 : next.hour

  // Hold through EndTime, then linear transition to the next NowHours, across midnight.
  // Property-specific native LerpTo/MI curves have no proved common input contract here.
  const weight = Math.max(0, Math.min(1, (sampleHour - endHour) / (nextHour - endHour)))
  const identity: HomeTodColor = [1, 1, 1]
  const a = homeAtmospheres[index]!,
    b = homeAtmospheres[(index + 1) % homeAtmospheres.length]!
  return {
    minute: wrappedMinute,
    sunDirectionWorld: limitedDirection(hour),
    sunColor: mixColor(current.sunColor, next.sunColor, weight),
    sunIntensity: lerp(current.sunIntensity, next.sunIntensity, weight),
    skyColor: mixColor(current.skyColor, next.skyColor, weight),
    skyIntensity: lerp(current.skyIntensity, next.skyIntensity, weight),
    skyZenith: mixColor(current.skyZenith, next.skyZenith, weight),
    skyHorizon: mixColor(current.skyHorizon, next.skyHorizon, weight),
    skyGradientPower: lerp(current.skyGradientPower, next.skyGradientPower, weight),
    skyHorizonOffset: lerp(current.skyHorizonOffset, next.skyHorizonOffset, weight),
    skyHorizonWidth: lerp(current.skyHorizonWidth, next.skyHorizonWidth, weight),
    groundColor: [0.5, 0.5, 0.5],
    waterReflectionTint: mixColor(current.waterReflectionTint, next.waterReflectionTint, weight),
    generalReflectionTint: mixColor(
      current.generalReflectionTint ?? identity,
      next.generalReflectionTint ?? identity,
      weight
    ),
    generalReflectionKnown:
      (weight === 1 || current.generalReflectionTint !== null) &&
      (weight === 0 || next.generalReflectionTint !== null),
    phase: current.name,
    sunVisible: Math.max(0, Math.min(1, sampleCurve(homeTodSwapCurve, hour))),
    swapLightFactor: sampleCurve(homeTodSwapCurve, hour),
    hemisphereDiffuseTint: mixColor(
      current.hemisphereDiffuseTint,
      next.hemisphereDiffuseTint,
      weight
    ),
    cloudShade: mixColor(current.cloudShade, next.cloudShade, weight),
    cloudLight: mixColor(current.cloudLight, next.cloudLight, weight),
    filmSlope: lerp(current.filmSlope, next.filmSlope, weight),
    filmToe: lerp(current.filmToe, next.filmToe, weight),
    colorGamma: mixColor(current.colorGamma, next.colorGamma, weight),
    exposureBias: lerp(current.exposureBias, next.exposureBias, weight),
    atmosphere: {
      rayleigh: mixColor(a.rayleigh, b.rayleigh, weight),
      rayleighHeight: lerp(a.rayleighHeight, b.rayleighHeight, weight),
      mie: mixColor(a.mie, b.mie, weight),
      mieAbsorption: mixColor(a.mieAbsorption, b.mieAbsorption, weight),
      mieHeight: lerp(a.mieHeight, b.mieHeight, weight),
      mieG: lerp(a.mieG, b.mieG, weight),
      ozone: mixColor(a.ozone, b.ozone, weight),
      luminance: mixColor(a.luminance, b.luminance, weight),
      lightIntensity: lerp(a.lightIntensity, b.lightIntensity, weight),
      fog: mixColor(a.fog, b.fog, weight),
      fogColor: mixColor(a.fogColor, b.fogColor, weight),
      secondFog: mixColor(a.secondFog, b.secondFog, weight),
      secondFogColor: mixColor(a.secondFogColor, b.secondFogColor, weight),
      fogStart: lerp(a.fogStart, b.fogStart, weight),
    },
  }
}
