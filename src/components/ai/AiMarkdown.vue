<script lang="ts">
import { setCustomComponents } from 'markstream-vue'
import AiMarkdownCode from './AiMarkdownCode.vue'
import AiMarkdownImage from './AiMarkdownImage.vue'

const scope = 'buildingmomo-ai-markdown'
// Scoped application policy: no network images, diagram runtimes or HTML previews.
setCustomComponents(scope, {
  image: AiMarkdownImage,
  code_block: AiMarkdownCode,
  mermaid: AiMarkdownCode,
  d2: AiMarkdownCode,
  infographic: AiMarkdownCode,
})
</script>

<script setup lang="ts">
import MarkdownRender from 'markstream-vue'
import { configureAiMarkdown } from '@/lib/ai/markdown'

withDefaults(defineProps<{ content: string; final?: boolean }>(), { final: true })
</script>

<template>
  <MarkdownRender
    class="ai-markdown"
    :custom-id="scope"
    :content="content"
    :final="final"
    mode="chat"
    html-policy="escape"
    :custom-markdown-it="configureAiMarkdown"
    :render-code-blocks-as-pre="true"
    :smooth-streaming="false"
    :fade="false"
    :show-tooltips="false"
    :defer-nodes-until-visible="false"
  />
</template>

<style scoped>
.ai-markdown {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: inherit;
  color: inherit;
  --ms-text-body: inherit;
  --ms-leading-body: inherit;
  --ms-text-h1: 1.25em;
  --ms-text-h2: 1.15em;
  --ms-text-h3: 1.05em;
  --ms-text-h4: 1em;
  --ms-text-h5: 1em;
  --ms-text-h6: 1em;
  --ms-flow-paragraph-y: 0.5em;
  --ms-flow-list-y: 0.5em;
  --ms-flow-codeblock-y: 0.75em;
  --inline-code-bg: var(--muted);
  --inline-code-fg: var(--foreground);
  --inline-code-border: var(--border);
  --table-border: var(--border);
  --table-header-bg: var(--muted);
  --link-color: var(--foreground);
  --blockquote-border: var(--border);
  --list-marker: var(--muted-foreground);
  --list-counter-marker: var(--muted-foreground);
  --hr-border: var(--border);
}
.ai-markdown :deep(a) {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.ai-markdown :deep(table) {
  table-layout: auto;
}
.ai-markdown :deep(pre) {
  white-space: pre;
  overflow-wrap: normal;
}
.ai-markdown :deep(pre code) {
  background: none;
  color: inherit;
}
.ai-markdown :deep(.node-slot:first-child .heading-node) {
  margin-top: 0;
}
</style>
