import type { InjectionKey } from 'vue'
import type { ArtifactRecord, ImageReference } from '@/lib/ai/types'
import type { useAiChat } from './useAiChat'

/** Display projection only. No UI entries are persisted. */
export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  reasoning?: string
  toolName?: string
  state: 'running' | 'success' | 'error' | 'cancelled'
  images?: ImageReference[]
  references?: ArtifactRecord[]
}

export const aiChatKey: InjectionKey<ReturnType<typeof useAiChat>> = Symbol('aiChat')
