import { shallowRef, type InjectionKey } from 'vue'
import type { AnalysisCaptureProvider } from '@/lib/sceneAnalysis/images'

/** The viewport owns GPU resources; this bridge only publishes its current capability. */
export function createAnalysisCaptureBridge() {
  const provider = shallowRef<AnalysisCaptureProvider | null>(null)
  return {
    provider,
    publish(owner: AnalysisCaptureProvider) {
      provider.value = owner
      return () => {
        if (provider.value === owner) provider.value = null
      }
    },
  }
}
export const analysisCaptureBridgeKey: InjectionKey<
  ReturnType<typeof createAnalysisCaptureBridge>
> = Symbol('analysisCaptureBridge')
