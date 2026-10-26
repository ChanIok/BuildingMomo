<script setup lang="ts">
import type { ImageNodeProps } from 'markstream-vue'
import { useI18n } from '@/composables/useI18n'

defineProps<Pick<ImageNodeProps, 'node'>>()
const { t } = useI18n()
</script>

<template>
  <span class="text-muted-foreground"
    >[{{ t('ai.markdownImageBlocked') }}<template v-if="node.alt">: {{ node.alt }}</template
    >]</span
  >
</template>
