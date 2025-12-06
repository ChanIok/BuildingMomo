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

const commandStore = useCommandStore()
const tabStore = useTabStore()
const { t } = useI18n()

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
          <h1 class="mb-3 text-4xl font-bold text-gray-900">{{ t('welcome.title') }}</h1>
          <p class="text-lg text-gray-600">{{ t('welcome.subtitle') }}</p>
        </div>

        <!-- 功能简介 -->
        <div class="mb-8 px-4 text-sm text-gray-500">
          <p class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span>{{ t('welcome.features.0') }}</span>
            <span class="text-gray-300">·</span>
            <span>{{ t('welcome.features.1') }}</span>
            <span class="text-gray-300">·</span>
            <span>{{ t('welcome.features.2') }}</span>
          </p>
        </div>

        <!-- 移动端提示 -->
        <div class="mx-4 mb-10 md:hidden">
          <div class="rounded-lg border-2 border-orange-200 bg-orange-50/60 p-6 text-center">
            <div class="mb-2 flex items-center justify-center gap-2">
              <Monitor :size="16" class="text-orange-600" :stroke-width="1.5" />
              <p class="text-base font-medium text-gray-900">{{ t('welcome.mobileOnly.title') }}</p>
            </div>
            <p class="text-sm text-gray-600">{{ t('welcome.mobileOnly.desc') }}</p>
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
                ? 'border-orange-200 bg-orange-50/60 hover:border-orange-400 hover:bg-orange-50'
                : 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60',
            ]"
            :title="
              isWatchModeSupported ? '选择游戏目录，自动检测建造数据更新' : '您的浏览器不支持此功能'
            "
          >
            <ItemMedia
              :class="[
                'h-12 w-12 transition-colors',
                isWatchModeSupported ? 'text-orange-600' : 'text-gray-400',
              ]"
            >
              <FolderSearch :size="24" :stroke-width="1.5" />
            </ItemMedia>

            <ItemContent>
              <ItemTitle
                :class="[
                  'text-lg font-semibold',
                  isWatchModeSupported ? 'text-gray-900' : 'text-gray-500',
                ]"
              >
                {{ t('welcome.selectGameDir') }}
              </ItemTitle>
              <ItemDescription
                :class="[
                  'mt-2 text-left text-sm',
                  isWatchModeSupported ? 'text-gray-600' : 'text-gray-400',
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
            class="flex h-32 w-72 cursor-pointer border-pink-200 bg-pink-50/60 p-6 transition-all duration-200 hover:border-pink-400 hover:bg-pink-50"
            title="手动选择 JSON 文件导入"
          >
            <ItemMedia class="h-12 w-12 text-pink-600">
              <FileJson :size="24" :stroke-width="1.5" />
            </ItemMedia>

            <ItemContent>
              <ItemTitle class="text-lg font-semibold text-gray-900">{{
                t('welcome.importData')
              }}</ItemTitle>
              <ItemDescription class="mt-2 text-left text-sm text-gray-600">
                {{ t('welcome.importDataDesc') }}
              </ItemDescription>
            </ItemContent>
          </Item>
        </div>

        <!-- 仓库信息 -->
        <div
          class="flex flex-wrap items-center justify-center gap-2 text-sm text-gray-500 md:gap-6"
        >
          <a
            href="https://github.com/ChanIok/BuildingMomo"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors hover:text-blue-600"
          >
            <Code2 :size="16" />
            <span>{{ t('welcome.github') }}</span>
            <ExternalLink :size="14" class="hidden md:inline" />
          </a>
          <span class="text-gray-300">·</span>
          <a
            href="https://chaniok.github.io/SpinningMomo/"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors hover:text-blue-600"
          >
            <img src="https://chaniok.github.io/SpinningMomo/logo.png" class="h-4 w-4" />
            <span>{{ t('welcome.spinningMomo') }}</span>
            <ExternalLink :size="14" class="hidden md:inline" />
          </a>
        </div>

        <!-- 井部提示与致谢信息 -->
        <div class="mt-8 px-4 text-xs text-gray-400">
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
