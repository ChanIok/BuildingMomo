<script setup lang="ts">
import { computed } from 'vue'
import { useCommandStore } from '../stores/commandStore'
import { FolderSearch, FileJson, Github, ExternalLink } from 'lucide-vue-next'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'

const commandStore = useCommandStore()

// 检查 File System Access API 是否支持
const isWatchModeSupported = computed(() => commandStore.fileOps.isFileSystemAccessSupported)

// 执行命令
function startWatchMode() {
  commandStore.executeCommand('file.startWatchMode')
}

function importJSON() {
  commandStore.executeCommand('file.import')
}
</script>

<template>
  <div class="flex h-full items-center justify-center rounded-md bg-background">
    <div class="w-full max-w-4xl px-8 text-center">
      <!-- Logo 和标题 -->
      <div class="mb-12">
        <img
          src="/logo.png"
          alt="BuildingMomo Logo"
          class="mx-auto mb-6 h-32 w-32 drop-shadow-lg"
        />
        <h1 class="mb-3 text-4xl font-bold text-gray-900">搬砖吧大喵</h1>
        <p class="text-lg text-gray-600">《无限暖暖》家园方案可视化编辑工具</p>
      </div>

      <!-- 功能简介 -->
      <div class="mb-8 text-sm text-gray-500">
        快速移动/复制/删除大型建筑群 · 在不同家园方案间自由合并建筑群 · 可视化编辑坐标
      </div>

      <!-- 两个大按钮 -->
      <div class="mb-10 flex justify-center gap-6">
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
              选择游戏目录
            </ItemTitle>
            <ItemDescription
              :class="[
                'mt-2 text-left text-sm',
                isWatchModeSupported ? 'text-gray-600' : 'text-gray-400',
              ]"
            >
              自动检测建造数据更新
            </ItemDescription>
          </ItemContent>

          <!-- 不支持提示 -->
          <div
            v-if="!isWatchModeSupported"
            class="absolute bottom-4 rounded-md bg-orange-100 px-3 py-1 text-xs text-orange-700"
          >
            浏览器不支持此功能
          </div>
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
            <ItemTitle class="text-lg font-semibold text-gray-900"> 导入建造数据 </ItemTitle>
            <ItemDescription class="mt-2 text-left text-sm text-gray-600">
              手动选择建造数据文件
            </ItemDescription>
          </ItemContent>
        </Item>
      </div>

      <!-- 仓库信息 -->
      <div class="flex items-center justify-center gap-6 text-sm text-gray-500">
        <a
          href="https://github.com/ChanIok/BuildingMomo"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors hover:text-blue-600"
        >
          <Github :size="18" />
          <span>GitHub 仓库</span>
          <ExternalLink :size="14" />
        </a>
        <span class="text-gray-300">·</span>
        <a
          href="https://github.com/ChanIok/SpinningMomo"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors hover:text-blue-600"
        >
          <span>SpinningMomo 项目</span>
          <ExternalLink :size="14" />
        </a>
      </div>

      <!-- 底部提示 -->
      <div class="mt-8 text-xs text-gray-400">
        <p>文件将在浏览器中本地处理，不会上传到任何服务器</p>
      </div>
    </div>
  </div>
</template>
