<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CodeBlockNodeProps } from 'markstream-vue'
import { Check, Copy } from 'lucide-vue-next'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<Pick<CodeBlockNodeProps, 'node'>>()
const { t } = useI18n()
const copied = ref(false),
  failed = ref(false)
const code = computed(() => props.node.code)
watch(code, () => {
  copied.value = false
  failed.value = false
})
async function copy() {
  const value = code.value
  try {
    await navigator.clipboard.writeText(value)
    if (code.value === value) {
      copied.value = true
      failed.value = false
    }
  } catch {
    if (code.value === value) failed.value = true
  }
}
</script>

<template>
  <div class="ai-code-block min-w-0 overflow-hidden rounded-md border border-border bg-muted/50">
    <div
      class="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span class="truncate font-mono">{{ node.language || 'text' }}</span>
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        @click="copy"
      >
        <Check v-if="copied" class="size-3" /><Copy v-else class="size-3" />
        {{ t(copied ? 'ai.codeCopied' : 'ai.copyCode') }}
      </button>
    </div>
    <pre
      class="m-0 max-h-96 overflow-auto p-3 text-xs leading-relaxed"
      tabindex="0"
    ><code>{{ code }}</code></pre>
    <p v-if="failed" role="status" class="px-3 pb-2 text-xs text-destructive">
      {{ t('ai.codeCopyFailed') }}
    </p>
  </div>
</template>
