<script setup lang="ts">
import Toolbar from './components/Toolbar.vue'
import Sidebar from './components/Sidebar.vue'
import CanvasEditor from './components/CanvasEditor.vue'
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden">
    <!-- 顶部工具栏 -->
    <Toolbar />

    <!-- 主体内容区 -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧边栏 -->
      <Sidebar />

      <!-- 画布区域 -->
      <CanvasEditor />
    </div>
  </div>
</template>

<style scoped>
/* 组件样式已在各自组件中定义 */
</style>
