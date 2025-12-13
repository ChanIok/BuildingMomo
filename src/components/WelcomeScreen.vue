<script setup lang="ts">
import { computed } from 'vue'
import { useCommandStore } from '../stores/commandStore'
import { useTabStore } from '../stores/tabStore'
import { useI18n } from '../composables/useI18n'
import {
  FolderSearch,
  FileJson,
  Code2,
  ExternalLink,
  TriangleAlert,
  Monitor,
} from 'lucide-vue-next'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import spinningLogo from '@/assets/spinning-logo.png'

const commandStore = useCommandStore()
const tabStore = useTabStore()
const { t, locale } = useI18n()

// 仓库和文档链接
const githubUrl = computed(() => {
  return locale.value === 'en'
    ? 'https://github.com/ChanIok/BuildingMomo/blob/main/README.en.md'
    : 'https://github.com/ChanIok/BuildingMomo'
})

const spinningMomoUrl = computed(() => {
  return locale.value === 'en'
    ? 'https://spinning.infinitymomo.com/en/'
    : 'https://spinning.infinitymomo.com/'
})

// 检查 File System Access API 是否支持
const isWatchModeSupported = computed(() => commandStore.fileOps.isFileSystemAccessSupported)

// 执行命令
function startWatchMode() {
  commandStore.executeCommand('file.startWatchMode')
}

function importJSON() {
  commandStore.executeCommand('file.import')
}

function showSafetyNotice() {
  tabStore.openDocTab('faq')
}

function openQuickStart() {
  tabStore.openDocTab('quickstart')
}
</script>

<template>
  <ScrollArea class="h-full rounded-md bg-background">
    <div class="flex min-h-full w-full items-center justify-center py-8">
      <div class="w-full max-w-4xl px-8 text-center">
        <!-- Logo 和标题 -->
        <div class="mb-12">
          <img
            src="/logo.png"
            alt="BuildingMomo Logo"
            class="mx-auto mb-6 h-32 w-32 drop-shadow-lg"
          />
          <h1 class="mb-3 text-4xl font-bold text-foreground">{{ t('welcome.title') }}</h1>
          <p class="text-lg text-secondary-foreground">{{ t('welcome.subtitle') }}</p>
        </div>

        <!-- 功能简介 -->
        <div class="mb-8 px-4 text-sm text-muted-foreground">
          <p class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span>{{ t('welcome.features.0') }}</span>
            <span class="text-muted-foreground">·</span>
            <span>{{ t('welcome.features.1') }}</span>
            <span class="text-muted-foreground">·</span>
            <span>{{ t('welcome.features.2') }}</span>
          </p>
        </div>

        <!-- 移动端提示 -->
        <div class="mx-4 mb-10 md:hidden">
          <div
            class="rounded-lg border-2 border-amber-200 bg-amber-50/80 p-6 text-center dark:border-amber-800/95 dark:bg-amber-950/25"
          >
            <div class="mb-2 flex items-center justify-center gap-2">
              <Monitor :size="16" class="text-amber-600" :stroke-width="1.5" />
              <p class="text-base font-medium text-muted-foreground">
                {{ t('welcome.mobileOnly.title') }}
              </p>
            </div>
            <p class="text-sm text-muted-foreground">{{ t('welcome.mobileOnly.desc') }}</p>
          </div>
        </div>

        <!-- 两个大按钮 -->
        <div class="mb-10 hidden justify-center gap-6 md:flex">
          <!-- 选择游戏目录按钮 -->
          <Item
            as="button"
            @click="startWatchMode"
            :disabled="!isWatchModeSupported"
            variant="outline"
            :class="[
              'flex h-32 w-72 cursor-pointer p-6 transition-all duration-200',
              isWatchModeSupported
                ? 'border-amber-300 bg-amber-50/80 hover:border-amber-400 hover:bg-amber-50 dark:border-amber-800/95 dark:bg-amber-950/25 dark:hover:border-amber-700/90 dark:hover:bg-amber-950/30'
                : 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-gray-900/50',
            ]"
            :title="
              isWatchModeSupported ? t('welcome.selectGameDirDesc') : t('welcome.notSupported')
            "
          >
            <ItemMedia
              :class="[
                'h-12 w-12 transition-colors',
                isWatchModeSupported
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-400 dark:text-gray-600',
              ]"
            >
              <FolderSearch :size="24" :stroke-width="1.5" />
            </ItemMedia>

            <ItemContent>
              <ItemTitle
                :class="[
                  'text-lg font-semibold',
                  isWatchModeSupported ? 'text-foreground' : 'text-gray-500 dark:text-gray-500',
                ]"
              >
                {{ t('welcome.selectGameDir') }}
              </ItemTitle>
              <ItemDescription
                :class="[
                  'mt-2 text-left text-sm',
                  isWatchModeSupported
                    ? 'text-muted-foreground'
                    : 'text-gray-400 dark:text-gray-600',
                ]"
              >
                {{
                  isWatchModeSupported ? t('welcome.selectGameDirDesc') : t('welcome.notSupported')
                }}
              </ItemDescription>
            </ItemContent>
          </Item>

          <!-- 导入建造数据 按钮 -->
          <Item
            as="button"
            @click="importJSON"
            variant="outline"
            class="flex h-32 w-72 cursor-pointer border-rose-300/80 bg-rose-50/80 p-6 transition-all duration-200 hover:border-rose-400/90 hover:bg-rose-50 dark:border-rose-800/80 dark:bg-rose-950/20 dark:hover:border-rose-700/90 dark:hover:bg-rose-950/30"
            :title="t('welcome.importDataDesc')"
          >
            <ItemMedia class="h-12 w-12 text-rose-600 dark:text-rose-400">
              <FileJson :size="24" :stroke-width="1.5" />
            </ItemMedia>

            <ItemContent>
              <ItemTitle class="text-lg font-semibold text-foreground">{{
                t('welcome.importData')
              }}</ItemTitle>
              <ItemDescription class="mt-2 text-left text-sm text-muted-foreground">
                {{ t('welcome.importDataDesc') }}
              </ItemDescription>
            </ItemContent>
          </Item>
        </div>

        <!-- 仓库信息 -->
        <div
          class="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground md:gap-6"
        >
          <a
            :href="githubUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors hover:text-blue-500 dark:hover:text-blue-400"
          >
            <Code2 :size="16" />
            <span>{{ t('welcome.github') }}</span>
            <ExternalLink :size="14" class="hidden md:inline" />
          </a>
          <span class="text-muted-foreground/30">·</span>
          <a
            :href="spinningMomoUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors hover:text-blue-500 dark:hover:text-blue-400"
          >
            <img :src="spinningLogo" class="h-4 w-4" />
            <span>{{ t('welcome.spinningMomo') }}</span>
            <ExternalLink :size="14" class="hidden md:inline" />
          </a>
        </div>

        <!-- 井部提示与致谢信息 -->
        <div class="mt-8 px-4 text-xs text-muted-foreground">
          <p class="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span class="flex items-center">
              <TriangleAlert :size="14" class="mr-1 text-orange-500" />
              <button
                @click="showSafetyNotice"
                class="cursor-pointer text-orange-500 underline underline-offset-2 hover:text-orange-600"
              >
                {{ t('welcome.safety') }}
              </button>
            </span>
            <span class="text-gray-300">·</span>
            <span>{{ t('welcome.riskDisclaimer') }}</span>
          </p>

          <p class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span
              >{{ t('welcome.processLocal') }}
              <a href="#" @click.prevent="openQuickStart" class="text-blue-400 hover:underline">{{
                t('welcome.helpDoc')
              }}</a></span
            >
            <span class="text-gray-300">·</span>
            <span>
              {{ t('welcome.credit') }}
              <a
                href="https://NUAN5.PRO"
                target="_blank"
                rel="noopener noreferrer"
                class="text-green-500 transition-colors hover:text-green-600"
              >
                {{ t('welcome.creditLink') }}
              </a>
              {{ t('welcome.creditPowered') }}
            </span>
          </p>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
