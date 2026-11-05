import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './local-env.js'

loadLocalEnv()

if (process.env.VITE_ENABLE_SECURE_MODE === 'true') {
  const distDir = fileURLToPath(new URL('../dist/', import.meta.url))

  console.log('[clean-seo-for-secure] 正在清理私有部署的 SEO 信息...')

  // 覆盖 robots.txt 为禁止抓取版本。
  fs.writeFileSync(
    path.join(distDir, 'robots.txt'),
    `# Private deployment - No indexing allowed
User-agent: *
Disallow: /
`,
    'utf8'
  )
  console.log('[clean-seo-for-secure] 已设置 robots.txt 禁止抓取。')

  // 删除站点地图。
  const sitemapPath = path.join(distDir, 'sitemap.xml')
  if (fs.existsSync(sitemapPath)) {
    fs.unlinkSync(sitemapPath)
    console.log('[clean-seo-for-secure] 已删除 sitemap.xml。')
  }

  // 清理中英文入口中的 SEO 标签。
  for (const file of ['index.html', 'en/index.html']) {
    const htmlPath = path.join(distDir, file)
    if (!fs.existsSync(htmlPath)) continue
    let html = fs.readFileSync(htmlPath, 'utf8')

    // 修改 robots meta 为 noindex。
    html = html.replace(
      /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/gi,
      '<meta name="robots" content="noindex, nofollow, noarchive" />'
    )
    // 删除 canonical、语言替代链接、Open Graph 标签及 sitemap 引用。
    html = html.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/gi, '')
    html = html.replace(/<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*\/?>/gi, '')
    html = html.replace(/<meta\s+property="og:[^"]*"\s+content="[^"]*"\s*\/?>/gi, '')
    html = html.replace(/<link\s+rel="sitemap"\s+[^>]*>/gi, '')

    fs.writeFileSync(htmlPath, html, 'utf8')
    console.log(`[clean-seo-for-secure] 已清理 ${file} 的 SEO 标签。`)
  }

  console.log('[clean-seo-for-secure] SEO 清理完成。')
}
