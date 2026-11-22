// All five WorldBase TOD presets reference this same TextureCube. The Night and
// Midday01* assets are not substituted merely because their names seem relevant.
// Private static asset under the same path the Cloudflare middleware guards, so
// it must stay in `public/` instead of being bundled with a content hash.
export const homeEnvironmentAsset = import.meta.env.BASE_URL + 'assets/terrain/home-lighting.hdr'

// T_WorldBase_Midday.json: PackedIrradianceEnvironmentMapData, RGB-interleaved
// real SH coefficients (nine terms plus three padding terms). These encode
// radiance; Three convolves them with the cosine lobe once for diffuse lighting.
// HDR source SHA256: 287cb997e312456f5f1f0c1ec515e5aee805619858136f7ba256c5fbfedbdaf0.
export const homeEnvironmentSH = [
  [0.6542969, 0.77490234, 1.3105469],
  [0.05117798, 0.046051025, 0.053222656],
  [0.41601562, 0.50146484, 0.8881836],
  [-0.38989258, -0.34838867, -0.39453125],
  [-0.07501221, -0.06933594, -0.08203125],
  [0.041107178, 0.03829956, 0.046905518],
  [-0.27661133, -0.31054688, -0.4597168],
  [-0.3112793, -0.2861328, -0.34155273],
  [0.2763672, 0.2553711, 0.3022461],
] as const

// UE's real-SH basis has negative Y/X, YZ/XZ terms. Reflecting source Y once
// into editor world space gives these signs for Three's positive real-SH basis.
export const homeEnvironmentSHSigns = [1, 1, 1, -1, -1, 1, 1, -1, 1] as const
