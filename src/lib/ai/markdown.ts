import type { NodeRendererProps } from 'markstream-vue'

/** Markdown is display-only. Never resolve model-authored URLs against this app's origin. */
export function isAiMarkdownLink(url: string) {
  if (!/^https?:\/\//i.test(url) || /[\u0000-\u0020\u007f]/.test(url)) return false
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

export const configureAiMarkdown: NonNullable<NodeRendererProps['customMarkdownIt']> = (md) => {
  md.validateLink = isAiMarkdownLink
  return md
}
