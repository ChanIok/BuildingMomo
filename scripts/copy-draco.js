import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 源目录和目标目录
const sourceDir = path.resolve(__dirname, '../node_modules/three/examples/jsm/libs/draco/gltf')
const targetDir = path.resolve(__dirname, '../public/draco')

console.log('[copy-draco] Copying Draco decoder files...')
console.log(`  Source: ${sourceDir}`)
console.log(`  Target: ${targetDir}`)

try {
  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
    console.log('[copy-draco] Created target directory')
  }

  // 需要复制的文件
  const filesToCopy = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']

  // 复制文件
  let copiedCount = 0
  for (const file of filesToCopy) {
    const sourcePath = path.join(sourceDir, file)
    const targetPath = path.join(targetDir, file)

    if (!fs.existsSync(sourcePath)) {
      console.warn(`[copy-draco] Warning: Source file not found: ${file}`)
      continue
    }

    fs.copyFileSync(sourcePath, targetPath)
    const stats = fs.statSync(targetPath)
    console.log(`[copy-draco] ✓ Copied ${file} (${(stats.size / 1024).toFixed(2)} KB)`)
    copiedCount++
  }

  console.log(`[copy-draco] Successfully copied ${copiedCount}/${filesToCopy.length} files`)
} catch (error) {
  console.error('[copy-draco] Error:', error.message)
  process.exit(1)
}
