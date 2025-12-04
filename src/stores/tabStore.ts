import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Tab } from '../types/tab'
import type { HomeScheme } from '../types/editor'

import { useI18n } from '@/composables/useI18n'

// 生成简单的UUID
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const useTabStore = defineStore('tab', () => {
  const { t } = useI18n()

  // 标签列表
  const tabs = ref<Tab[]>([])

  // 当前激活的标签ID
  const activeTabId = ref<string | null>(null)

  // 计算属性：当前激活的标签
  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)

  /**
   * 打开方案标签
   * 如果方案标签已存在，则激活；否则创建新标签
   */
  function openSchemeTab(schemeId: string, schemeName: string) {
    const existing = tabs.value.find((t) => t.type === 'scheme' && t.schemeId === schemeId)
    if (existing) {
      // 已存在，直接激活
      activeTabId.value = existing.id
    } else {
      // 不存在，创建新标签
      const newTab: Tab = {
        id: generateUUID(),
        type: 'scheme',
        title: schemeName,
        schemeId,
      }
      tabs.value.push(newTab)
      activeTabId.value = newTab.id
    }
  }

  /**
   * 打开文档标签（单例模式）
   * 全局只有一个文档标签，重复调用只会激活现有标签
   * @param docPage 可选参数，指定要打开的文档页面ID（如 'quickstart', 'guide', 'faq'）
   */
  function openDocTab(docPage?: string) {
    const existing = tabs.value.find((t) => t.type === 'doc')
    if (existing) {
      // 已存在，更新 docPage 并激活
      if (docPage !== undefined) {
        existing.docPage = docPage
      }
      activeTabId.value = existing.id
    } else {
      // 不存在，创建新标签
      const newTab: Tab = {
        id: generateUUID(),
        type: 'doc',
        title: t('command.help.openDocs'),
        docPage,
      }
      tabs.value.push(newTab)
      activeTabId.value = newTab.id
    }
  }

  /**
   * 关闭标签
   */
  function closeTab(tabId: string) {
    const index = tabs.value.findIndex((t) => t.id === tabId)
    if (index === -1) return

    tabs.value.splice(index, 1)

    // 如果关闭的是当前激活标签，切换到其他标签
    if (activeTabId.value === tabId) {
      if (tabs.value.length > 0) {
        // 优先切换到前一个，否则切换到第一个
        const newIndex = Math.max(0, index - 1)
        const nextTab = tabs.value[newIndex]
        if (nextTab) {
          activeTabId.value = nextTab.id
        }
      } else {
        activeTabId.value = null
      }
    }
  }

  /**
   * 设置激活标签
   */
  function setActiveTab(tabId: string) {
    if (tabs.value.some((t) => t.id === tabId)) {
      activeTabId.value = tabId
    }
  }

  /**
   * 更新方案标签名称
   */
  function updateSchemeTabName(schemeId: string, newName: string) {
    const tab = tabs.value.find((t) => t.type === 'scheme' && t.schemeId === schemeId)
    if (tab) {
      tab.title = newName
    }
  }

  /**
   * 更新文档标签的页面
   */
  function updateDocPage(docPage: string) {
    const docTab = tabs.value.find((t) => t.type === 'doc')
    if (docTab) {
      docTab.docPage = docPage
    }
  }

  /**
   * 初始化：从现有方案同步标签
   * 用于应用启动时恢复标签状态
   */
  function syncFromSchemes(schemes: HomeScheme[]) {
    schemes.forEach((scheme) => {
      if (!tabs.value.find((t) => t.schemeId === scheme.id)) {
        tabs.value.push({
          id: generateUUID(),
          type: 'scheme',
          title: scheme.name.value,
          schemeId: scheme.id,
        })
      }
    })

    // 设置第一个标签为激活状态
    if (tabs.value.length > 0 && !activeTabId.value) {
      const firstTab = tabs.value[0]
      if (firstTab) {
        activeTabId.value = firstTab.id
      }
    }
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    openSchemeTab,
    openDocTab,
    closeTab,
    setActiveTab,
    updateSchemeTabName,
    updateDocPage,
    syncFromSchemes,
  }
})
