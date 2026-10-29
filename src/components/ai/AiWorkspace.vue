<script setup lang="ts">
import { computed, provide } from 'vue'
import { useDesktopStore } from '@/stores/desktopStore'
import { useSettingsStore } from '@/stores/settingsStore'
import SidebarAI from './SidebarAI.vue'
import SidebarExternalAI from './SidebarExternalAI.vue'

const desktop = useDesktopStore()
const settings = useSettingsStore()
const panel = computed({
  get: () => settings.ai.panelMode,
  set: (mode: 'builtin' | 'external') => {
    settings.ai.panelMode = mode
  },
})
const external = computed(() => desktop.isDesktop && panel.value === 'external')

provide('aiWorkspacePanel', {
  panel,
  switchTo(mode: 'builtin' | 'external') {
    panel.value = mode
  },
})
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col">
    <SidebarExternalAI v-if="external" class="min-h-0 flex-1" />
    <SidebarAI v-else class="min-h-0 flex-1" />
  </section>
</template>
