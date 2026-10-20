import type { ShadingQuality } from '@nuan5-pro/render'

export type RenderQuality = 'original' | 'performance' | 'economy'

interface RenderQualityOptions {
  antialias: boolean
  shadingQuality: ShadingQuality
}

// Performance profiles simplify shading while retaining authored geometry.
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
