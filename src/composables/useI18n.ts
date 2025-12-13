import { computed } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { zhLocale } from '../locales/zh'
import { enLocale } from '../locales/en'

export type Locale = 'zh' | 'en'

// 语言字典
const locales: Record<Locale, Record<string, any>> = {
  zh: zhLocale,
  en: enLocale,
}

// 检测初始语言
function getInitialLanguage(): Locale {
  // URL 已由 index.html 的早期重定向脚本处理，直接根据路径判断
  if (typeof window !== 'undefined' && /\/en(\/|$)/.test(window.location.pathname)) {
    return 'en'
  }
  return 'zh'
}

// 获取嵌套属性值的辅助函数
function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.')
  let value = obj
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key]
    } else {
      return undefined
    }
  }
  return value
}

// 全局i18n状态
const detected = getInitialLanguage()
const _locale = useLocalStorage<Locale>('buildingmomo_locale', detected)

/**
 * i18n 组合函数
 */
export function useI18n() {
  const locale = computed({
    get: () => _locale.value,
    set: (val: Locale) => {
      _locale.value = val
    },
  })

  /**
   * 翻译函数
   * @param key 翻译键，支持嵌套 dot notation，例如 'welcome.title'
   * @param params 替换参数，例如 { n: 1 } 会替换字符串中的 {n}
   * @returns 翻译后的字符串，如果找不到则返回 key 本身
   */
  function t(key: string, params?: Record<string, string | number>): string {
    const dict = locales[locale.value]
    let value = getNestedValue(dict, key)

    if (typeof value === 'string') {
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          value = value.replace(new RegExp(`{${k}}`, 'g'), String(v))
        })
      }
      return value
    }

    // 如果键不存在或值不是字符串，返回键本身作为降级处理
    console.warn(`Translation key not found: ${key}`)
    return key
  }

  /**
   * 获取所有翻译字典（用于特殊场景）
   */
  function getLocaleDict(): Record<string, any> {
    return locales[locale.value]
  }

  /**
   * 切换语言
   */
  function setLocale(newLocale: Locale) {
    locale.value = newLocale
  }

  return {
    locale,
    t,
    getLocaleDict,
    setLocale,
  }
}
