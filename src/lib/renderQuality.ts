import type { ShadingQuality } from '@nuan5-pro/render'

// The simplified profile keeps the render library's `economy` shading; the UI
// presents it as "Performance" because it is the only reduced-quality option.
export type RenderQuality = 'original' | 'economy'

interface RenderQualityOptions {
  antialias: boolean
  shadingQuality: ShadingQuality
}

// Performance profile simplifies shading while retaining authored geometry.
const profiles: Record<RenderQuality, RenderQualityOptions> = {
  original: { antialias: true, shadingQuality: 'original' },
  economy: {
    antialias: false,
    shadingQuality: 'economy',
  },
}

export function getRenderQuality(quality: RenderQuality): RenderQualityOptions {
  return profiles[quality] ?? profiles.original
}
