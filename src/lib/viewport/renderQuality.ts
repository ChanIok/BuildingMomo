import type { ShadingQuality } from '@nuan5-pro/render'

export type RenderQuality = 'original' | 'performance' | 'economy'

interface RenderQualityOptions {
  antialias: boolean
  shadingQuality: ShadingQuality
}

// Every reduced profile keeps authored geometry and swaps PBR for a cheaper
// BRDF; `performance` also keeps normal maps and foliage emission so the scene
// stays readable, `economy` drops surface detail on top of that.
const profiles: Record<RenderQuality, RenderQualityOptions> = {
  original: { antialias: true, shadingQuality: 'original' },
  performance: {
    antialias: false,
    shadingQuality: 'performance',
  },
  economy: {
    antialias: false,
    shadingQuality: 'economy',
  },
}

export function getRenderQuality(quality: RenderQuality): RenderQualityOptions {
  return profiles[quality] ?? profiles.original
}
