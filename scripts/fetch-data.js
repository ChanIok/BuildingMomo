import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_URL = 'https://nuan5.pro/assets/data/building-momo-furniture.json'
const ICON_BASE_URL = 'https://nuan5.pro/assets/furniture-icon/'

const PUBLIC_DIR = path.resolve(__dirname, '../public')
const DATA_DIR = path.join(PUBLIC_DIR, 'assets/data')
const ICON_DIR = path.join(PUBLIC_DIR, 'assets/furniture-icon')

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}
if (!fs.existsSync(ICON_DIR)) {
  fs.mkdirSync(ICON_DIR, { recursive: true })
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {number} maxRetries - Maximum retry attempts
 * @param {Array<number>} delays - Delay times for each retry (ms)
 * @param {string} description - Operation description for logging
 */
async function retryWithBackoff(
  fn,
  maxRetries = 3,
  delays = [3000, 6000, 10000],
  description = 'operation'
) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === maxRetries) {
        throw new Error(`${description} failed after ${maxRetries} retries: ${err.message}`)
      }
      const delay = delays[i] || delays[delays.length - 1]
      console.log(
        `\n⚠️  ${description} failed (attempt ${i + 1}/${maxRetries + 1}): ${err.message}`
      )
      console.log(`   Waiting ${delay / 1000}s before retry...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

async function downloadFile(url, dest, retries = 3) {
  return retryWithBackoff(
    async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      fs.writeFileSync(dest, buffer)
    },
    retries,
    [3000, 6000, 10000],
    `Downloading ${url}`
  )
}

async function main() {
  try {
    console.log('Fetching furniture data...')

    // Fetch JSON data with retry mechanism
    const jsonData = await retryWithBackoff(
      async () => {
        const dataResponse = await fetch(DATA_URL)
        if (!dataResponse.ok)
          throw new Error(`HTTP ${dataResponse.status} ${dataResponse.statusText}`)
        return await dataResponse.json()
      },
      3,
      [3000, 6000, 10000],
      'Fetching JSON data'
    )

    const dataDest = path.join(DATA_DIR, 'building-momo-furniture.json')
    fs.writeFileSync(dataDest, JSON.stringify(jsonData, null, 2))
    console.log(`✅ Data saved to ${dataDest}`)

    // Extract icon IDs
    // Structure: { v: string, d: [ [id, [name_zh, name_en, icon_id, dim]], ... ] }
    const items = jsonData.d || []
    const iconIds = new Set()

    for (const item of items) {
      // item[1] is the data array, item[1][2] is icon_id
      const iconId = item[1][2]
      if (iconId) {
        iconIds.add(iconId)
      }
    }

    console.log(`Found ${iconIds.size} icons to download.`)

    let downloadedCount = 0
    let skippedCount = 0
    let errorCount = 0

    // Download icons with concurrency limit
    const CONCURRENCY = 10
    const iconIdsArray = Array.from(iconIds)

    for (let i = 0; i < iconIdsArray.length; i += CONCURRENCY) {
      const chunk = iconIdsArray.slice(i, i + CONCURRENCY)
      await Promise.all(
        chunk.map(async (iconId) => {
          const filename = `${iconId}.webp`
          const dest = path.join(ICON_DIR, filename)
          const url = `${ICON_BASE_URL}${filename}`

          if (fs.existsSync(dest)) {
            const stats = fs.statSync(dest)
            if (stats.size > 0) {
              skippedCount++
              return
            }
          }

          try {
            await downloadFile(url, dest)
            downloadedCount++
            process.stdout.write('.') // Progress indicator
          } catch (err) {
            console.error(`\nError downloading ${url}:`, err.message)
            errorCount++
          }
        })
      )
    }

    console.log('\nDownload complete.')
    console.log(`Downloaded: ${downloadedCount}`)
    console.log(`Skipped (already exists): ${skippedCount}`)
    console.log(`Errors: ${errorCount}`)
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

main()
