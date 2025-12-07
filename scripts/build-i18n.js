import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, '../dist')
const enDir = path.join(distDir, 'en')

console.log('Building i18n versions...')

if (!fs.existsSync(distDir)) {
  console.error('dist directory not found. Please run build first.')
  process.exit(1)
}

if (!fs.existsSync(enDir)) {
  fs.mkdirSync(enDir, { recursive: true })
}

// Read the original index.html
const indexHtmlPath = path.join(distDir, 'index.html')
let htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8')

// --- Create English Version ---
let enHtmlContent = htmlContent

// 1. Change lang attribute
enHtmlContent = enHtmlContent.replace(/<html lang="zh-CN">/i, '<html lang="en">')

// 2. Inject global variable for language detection
enHtmlContent = enHtmlContent.replace(
  '<head>',
  '<head>\n    <script>window.__INITIAL_LANG__ = "en"</script>'
)

// 3. Update Title
enHtmlContent = enHtmlContent.replace(
  /<title>.*?<\/title>/,
  '<title>BuildingMomo - Infinity Nikki Home Visual Editor</title>'
)

// 4. Update Description
const descRegex = /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i
enHtmlContent = enHtmlContent.replace(
  descRegex,
  '<meta name="description" content="A visual editor for Infinity Nikki home building schemes. Quickly move, copy, and delete large building groups. Merge schemes freely with WYSIWYG coordinate editing." />'
)

// 4.1 Update Keywords (New)
const kwRegex = /<meta\s+name="keywords"\s+content="[^"]*"\s*\/?>/i
enHtmlContent = enHtmlContent.replace(
  kwRegex,
  '<meta name="keywords" content="Infinity Nikki, Home Editor, Building Tool, Scheme Editor, BuildingMomo, Home Visual Editor, WYSIWYG" />'
)

// 5. Update Canonical
const canonicalRegex = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i
enHtmlContent = enHtmlContent.replace(
  canonicalRegex,
  '<link rel="canonical" href="https://infinitymomo.com/en/" />'
)

// 6. Update OG Title
const ogTitleRegex = /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i
enHtmlContent = enHtmlContent.replace(
  ogTitleRegex,
  '<meta property="og:title" content="BuildingMomo - Infinity Nikki Home Visual Editor" />'
)

// 7. Update OG Description
const ogDescRegex = /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i
enHtmlContent = enHtmlContent.replace(
  ogDescRegex,
  '<meta property="og:description" content="A visual editor for Infinity Nikki home building schemes. Quickly move, copy, and delete large building groups." />'
)

// 8. Update OG URL
const ogUrlRegex = /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i
enHtmlContent = enHtmlContent.replace(
  ogUrlRegex,
  '<meta property="og:url" content="https://infinitymomo.com/en/" />'
)

// Write the file
fs.writeFileSync(path.join(enDir, 'index.html'), enHtmlContent)

console.log('Created dist/en/index.html')
console.log('i18n build complete.')
