<script setup lang="ts">
import { computed } from 'vue'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@/components/ui/menubar'
import { useCommandStore } from '../stores/commandStore'

// 使用命令系统 Store
const commandStore = useCommandStore()

// 按分类获取命令
const fileCommands = computed(() => commandStore.getCommandsByCategory('file'))
const editCommands = computed(() => commandStore.getCommandsByCategory('edit'))
const viewCommands = computed(() => commandStore.getCommandsByCategory('view'))

// 监控状态
const watchState = computed(() => commandStore.fileOps.watchState)

// 执行命令
function handleCommand(commandId: string) {
  commandStore.executeCommand(commandId)
}

// 检查命令是否可用
function isEnabled(commandId: string): boolean {
  return commandStore.isCommandEnabled(commandId)
}
</script>

<template>
  <div class="flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4">
    <!-- Menubar 菜单栏 -->
    <Menubar class="border-none bg-transparent">
      <!-- 文件菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">文件</MenubarTrigger>
        <MenubarContent>
          <template v-for="cmd in fileCommands" :key="cmd.id">
            <!-- 在"导出"、"保存到游戏"、"监控游戏目录"之前添加分隔线 -->
            <MenubarSeparator
              v-if="
                cmd.id === 'file.import' || cmd.id === 'file.export' || cmd.id === 'file.saveToGame'
              "
            />
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>
        </MenubarContent>
      </MenubarMenu>

      <!-- 编辑菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">编辑</MenubarTrigger>
        <MenubarContent>
          <template v-for="cmd in editCommands" :key="cmd.id">
            <!-- 在"删除"之前和"全选"之前添加分隔线 -->
            <MenubarSeparator v-if="cmd.id === 'edit.delete' || cmd.id === 'edit.selectAll'" />
            <!-- 在"移动"之前添加分隔线 -->
            <MenubarSeparator v-if="cmd.id === 'edit.move'" />
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>
        </MenubarContent>
      </MenubarMenu>

      <!-- 视图菜单 -->
      <MenubarMenu>
        <MenubarTrigger class="text-sm font-medium">视图</MenubarTrigger>
        <MenubarContent>
          <template v-for="cmd in viewCommands" :key="cmd.id">
            <!-- 在"重置视图"之前添加分隔线 -->
            <MenubarSeparator
              v-if="cmd.id === 'view.resetView' || cmd.id === 'view.coordinateSystem'"
            />
            <MenubarItem :disabled="!isEnabled(cmd.id)" @click="handleCommand(cmd.id)">
              {{ cmd.label }}
              <MenubarShortcut v-if="cmd.shortcut">{{ cmd.shortcut }}</MenubarShortcut>
            </MenubarItem>
          </template>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>

    <!-- 监控状态指示器 -->
    <div class="flex items-center gap-2">
      <div
        v-if="watchState.isActive"
        class="flex items-center gap-2 rounded-md bg-green-50 px-3 py-1.5"
      >
        <div class="h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
        <span class="text-xs font-medium text-green-700">监控中</span>
        <span class="text-xs text-green-600">{{ watchState.dirPath }}</span>
      </div>
    </div>
  </div>
</template>
