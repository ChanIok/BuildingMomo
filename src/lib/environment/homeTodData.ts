export type HomeTodColor = [number, number, number]

interface CurveKey {
  time: number
  value: number
  mode: 'linear' | 'cubic'
  arrive: number
  leave: number
}

export interface HomeTodPhaseData {
  name: string
  hour: number
  endHour: number
  sunColor: HomeTodColor
  sunIntensity: number
  skyColor: HomeTodColor
  skyIntensity: number
  skyZenith: HomeTodColor
  skyHorizon: HomeTodColor
  skyGradientPower: number
  skyHorizonOffset: number
  skyHorizonWidth: number
  waterReflectionTint: HomeTodColor
  generalReflectionTint: HomeTodColor | null
  hemisphereDiffuseTint: HomeTodColor
  cloudShade: HomeTodColor
  cloudLight: HomeTodColor
  filmSlope: number
  filmToe: number
  colorGamma: HomeTodColor
  exposureBias: number
}

// Serialized inheritance of DT_NiKKiHomeOutdoor01_TOD and its five TOD/PP/sky MI rows.
// RGB is source linear data; sky boosts are material factors, not measured radiance.
export const homeTodPhases: readonly HomeTodPhaseData[] = [
  {
    name: 'Sunrise',
    hour: 3.5,
    endHour: 4,
    sunColor: [1, 0.45, 0.34],
    sunIntensity: 8,
    skyColor: [0.385624, 0.378996, 0.536458],
    skyIntensity: 1.5,
    skyZenith: [4, 3.4, 3.599999],
    skyHorizon: [20, 3.333334, 0],
    skyGradientPower: 4,
    skyHorizonOffset: 0.7,
    skyHorizonWidth: 0.25,
    waterReflectionTint: [0.215861, 0.097839, 0.063158],
    generalReflectionTint: [0.75, 0.75, 0.75],
    hemisphereDiffuseTint: [1.8, 1.094429, 0.665626],
    cloudShade: [0.5, 0.085, 0.119583],
    cloudLight: [2, 1.124241, 0.863103],
    filmSlope: 0.7,
    filmToe: 0.45,
    colorGamma: [0.95, 0.95, 0.95],
    exposureBias: 0,
  },
  {
    name: 'Morning',
    hour: 4.5,
    endHour: 6,
    sunColor: [1, 0.770833, 0.75],
    sunIntensity: 6,
    skyColor: [0.8, 0.883333, 1],
    skyIntensity: 1.6,
    skyZenith: [3.6, 4.199999, 4.5],
    skyHorizon: [3, 2.65, 2.4],
    skyGradientPower: 5,
    skyHorizonOffset: 0.68,
    skyHorizonWidth: 0.18,
    waterReflectionTint: [0.659, 0.371893, 0.181593],
    generalReflectionTint: [0.6, 0.533626, 0.471306],
    hemisphereDiffuseTint: [1.5, 1.012465, 0.577199],
    cloudShade: [0.3, 0.039, 0.2565],
    cloudLight: [3.2, 2.41087, 1.166667],
    filmSlope: 0.78,
    filmToe: 0.48,
    colorGamma: [0.97, 0.97, 0.97],
    exposureBias: 0.3,
  },
  {
    name: 'Midday',
    hour: 6.5,
    endHour: 20,
    sunColor: [1, 0.810232, 0.6],
    sunIntensity: 7,
    skyColor: [0.7, 0.775, 1],
    skyIntensity: 3,
    skyZenith: [2, 2.749999, 5],
    skyHorizon: [2.8, 3.01, 3.5],
    skyGradientPower: 5,
    skyHorizonOffset: 0.68,
    skyHorizonWidth: 0.168,
    waterReflectionTint: [0.162029, 0.171441, 0.205079],
    generalReflectionTint: null,
    hemisphereDiffuseTint: [1.2, 0.824562, 0.449583],
    cloudShade: [0.55, 0.839298, 1.1],
    cloudLight: [2.3, 2.094731, 1.665105],
    filmSlope: 0.82,
    filmToe: 0.5,
    colorGamma: [1, 0.9925, 0.985],
    exposureBias: 0,
  },
  {
    name: 'Dusk',
    hour: 20.5,
    endHour: 21,
    sunColor: [1, 0.925, 0.9],
    sunIntensity: 4.5,
    skyColor: [0.75, 0.791667, 1],
    skyIntensity: 2.5,
    skyZenith: [1.4, 2.146666, 7],
    skyHorizon: [10, 3.333334, 0],
    skyGradientPower: 8,
    skyHorizonOffset: 0.67,
    skyHorizonWidth: 0.16,
    waterReflectionTint: [0.301, 0.220598, 0.183422],
    generalReflectionTint: [0.958333, 0.894695, 0.703776],
    hemisphereDiffuseTint: [1.5, 0.905349, 0.578125],
    cloudShade: [0.902056, 0.835381, 2],
    cloudLight: [5, 2.443922, 2.057292],
    filmSlope: 0.8,
    filmToe: 0.5,
    colorGamma: [0.98, 0.98, 0.98],
    exposureBias: 0,
  },
  {
    name: 'Night',
    hour: 21.5,
    endHour: 3,
    sunColor: [0.65, 0.65, 1],
    sunIntensity: 3.5,
    skyColor: [0.065625, 0.070807, 0.09],
    skyIntensity: 4.5,
    skyZenith: [0.556773, 0.4, 1],
    skyHorizon: [0.737095, 0.852379, 1],
    skyGradientPower: 2,
    skyHorizonOffset: 0.72,
    skyHorizonWidth: 0.3,
    waterReflectionTint: [0.119031, 0.138625, 0.203125],
    generalReflectionTint: null,
    hemisphereDiffuseTint: [3.2, 2.120749, 1.365455],
    cloudShade: [0.073324, 0.124002, 0.276042],
    cloudLight: [3.779649, 4.190386, 5],
    filmSlope: 0.7,
    filmToe: 0.42,
    colorGamma: [0.97, 0.97, 0.97],
    exposureBias: 0.3,
  },
]

// C_W01_SunRotator_02: only Y (Limited) and Z (signed swap) are needed here.
// Source JSON SHA256: fcfbbdac0dca5844c3ea56eb4030c59cf90db39e72770621135ae7fcfce1d601.
// All keys are WeightedNone, with explicit constant pre/post extrapolation.
// Stored tangents are retained; nonzero weight fields are intentionally unused.
export const homeTodLimitedCurve: readonly CurveKey[] = [
  { time: 0, value: 5.963198, mode: 'linear', arrive: 0, leave: 0 },
  { time: 2.696444, value: -56.60247, mode: 'cubic', arrive: -6.167901, leave: -6.167901 },
  { time: 3.5244176, value: -57.661522, mode: 'cubic', arrive: 2.843734, leave: 2.843734 },
  { time: 21.078356, value: 44.841976, mode: 'cubic', arrive: 0, leave: 0 },
  { time: 21.641317, value: 44.318295, mode: 'cubic', arrive: -2.2368703, leave: -2.2368703 },
  { time: 22.611752, value: 39.777447, mode: 'linear', arrive: -10.039044, leave: 0 },
  { time: 24, value: 5.963198, mode: 'linear', arrive: 0, leave: 0 },
]

export const homeTodSwapCurve: readonly CurveKey[] = [
  { time: 2.78944, value: -1, mode: 'cubic', arrive: 0, leave: 0 },
  { time: 3.043966, value: 0, mode: 'cubic', arrive: 0.153043, leave: 0.153043 },
  { time: 3.254695, value: 1, mode: 'cubic', arrive: 0, leave: 0 },
  { time: 21.092289, value: 1, mode: 'cubic', arrive: 0, leave: 0 },
  { time: 21.212225, value: 0, mode: 'cubic', arrive: -0.059086, leave: -0.059086 },
  { time: 21.310438, value: -1, mode: 'cubic', arrive: 0, leave: 0 },
]
