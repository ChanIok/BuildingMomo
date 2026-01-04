<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameDataStore } from '@/stores/gameDataStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEditorStore } from '@/stores/editorStore'
import { useEditorItemAdd } from '@/composables/editor/useEditorItemAdd'
import { useI18n } from '@/composables/useI18n'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { X, Search } from 'lucide-vue-next'

const gameDataStore = useGameDataStore()
const settingsStore = useSettingsStore()
const editorStore = useEditorStore()
const { addFurnitureItem } = useEditorItemAdd()
const { t } = useI18n()

// 控制显示
const isVisible = defineModel<boolean>('open', { default: false })

const searchQuery = ref('')

// 处理家具列表
const furnitureList = computed(() => {
  const data = gameDataStore.furnitureData
  const lang = settingsStore.settings.language

  return Object.entries(data).map(([id, item]) => ({
    id: parseInt(id),
    name: lang === 'zh' ? item.name_cn : item.name_en,
    icon: gameDataStore.getIconUrl(parseInt(id)),
  }))
})

// 搜索过滤
const filteredItems = computed(() => {
  if (!searchQuery.value.trim()) return furnitureList.value

  const query = searchQuery.value.toLowerCase()
  return furnitureList.value.filter(
    (item) => item.name.toLowerCase().includes(query) || item.id.toString().includes(query)
  )
})

const totalCount = computed(() => furnitureList.value.length)

// 添加家具
function handleAddItem(itemId: number) {
  if (!editorStore.activeScheme) return

  addFurnitureItem(itemId)
  // 不关闭面板，方便连续添加
}

function close() {
  isVisible.value = false
}
</script>

<template>
  <!-- 悬浮在画布左上角 -->
  <div
    v-if="isVisible"
    class="absolute top-4 left-4 z-50 flex h-[calc(100%-32px)] w-80 flex-col rounded-md border border-border bg-background/90 shadow-2xl backdrop-blur-md"
  >
    <!-- 顶部：标题 + 关闭按钮 -->
    <div class="flex items-center justify-between p-3">
      <h3 class="text-sm font-semibold">{{ t('furnitureLibrary.title') }}</h3>
      <Button variant="ghost" size="icon" class="h-6 w-6" @click="close">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <!-- 搜索框 -->
    <div class="p-3">
      <div class="relative">
        <Search class="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="searchQuery"
          :placeholder="t('furnitureLibrary.searchPlaceholder')"
          class="pl-8"
          autofocus
        />
      </div>
    </div>

    <!-- 家具网格（可滚动） -->
    <ScrollArea class="min-h-0 flex-1">
      <div class="grid grid-cols-3 gap-2 p-3">
        <button
          v-for="item in filteredItems"
          :key="item.id"
          @click="handleAddItem(item.id)"
          class="flex flex-col items-center rounded p-2 transition-colors hover:bg-accent active:scale-95"
          :title="item.name"
        >
          <img
            :src="item.icon"
            class="h-16 w-16 rounded border object-cover"
            :alt="item.name"
            loading="lazy"
            @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
          />
          <span class="mt-1 line-clamp-2 max-w-full text-center text-xs">
            {{ item.name }}
          </span>
        </button>
      </div>

      <!-- 空状态 -->
      <div
        v-if="filteredItems.length === 0"
        class="flex h-32 flex-col items-center justify-center text-muted-foreground"
      >
        <Search class="mb-2 h-8 w-8 opacity-50" />
        <span class="text-sm">{{ t('furnitureLibrary.noResults') }}</span>
      </div>

      <ScrollBar orientation="vertical" class="!w-1.5" />
    </ScrollArea>

    <!-- 底部：统计信息 -->
    <div class="border-t p-2 text-center text-xs text-muted-foreground">
      {{ t('furnitureLibrary.stats', { total: totalCount, showing: filteredItems.length }) }}
    </div>
  </div>
</template>
