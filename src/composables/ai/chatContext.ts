import type { InjectionKey } from 'vue'
import type { ImageReference } from '@/lib/ai/types'
import type { useAiChat } from './useAiChat'

/** Display projection only. No UI entries are persisted. */
export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  /** Tool output is formatted only when its details are opened. */
  output?: () => string
  reasoning?: string
  toolName?: string
  state: 'running' | 'success' | 'error' | 'cancelled'
  images?: ImageReference[]
  code?: string
}

export const aiChatKey: InjectionKey<ReturnType<typeof useAiChat>> = Symbol('aiChat')
