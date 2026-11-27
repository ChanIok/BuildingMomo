import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_INPUT = path.resolve(__dirname, '../public/assets/furniture-v2/manifest.json')
const DEFAULT_METADATA = path.resolve(
  __dirname,
  '../public/assets/data/building-momo-furniture.json'
)
const DEFAULT_OUTPUT = path.resolve(__dirname, '../temp/furniture_layout_all.json')

const LAYOUT = {
  X_MIN: -18000,
  X_MAX: 25000,
  Y_MIN: -16000,
  Y_MAX: 27000,
  Z_START: 100,
  SPACING: 1000,
  Z_LAYER_HEIGHT: 5000,
}

const ITEM_ID_OFFSET = 1170000000
const MAX_HORIZONTAL_DIM = 800

function parseArgs(argv) {
  let input = DEFAULT_INPUT
  let metadata = DEFAULT_METADATA
  let output = DEFAULT_OUTPUT

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-i' || arg === '--input') {
      input = path.resolve(argv[++i] ?? '')
    } else if (arg === '-m' || arg === '--metadata') {
      metadata = path.resolve(argv[++i] ?? '')
    } else if (arg === '-o' || arg === '--output') {
      output = path.resolve(argv[++i] ?? '')
    } else if (arg === '-h' || arg === '--help') {
      return { help: true, input, metadata, output }
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }

  return { help: false, input, metadata, output }
}

function loadDimensionsMap(metadataPath) {
  const dimensions = new Map()
  if (!fs.existsSync(metadataPath)) {
    console.warn(`警告：未找到家具尺寸数据 ${metadataPath}，全部将使用 Scale = 1`)
    return dimensions
  }

  const data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
  for (const entry of data?.d ?? []) {
    const itemId = entry?.[0]
    const dim = entry?.[1]?.[3]
    if (
      Number.isSafeInteger(itemId) &&
      Array.isArray(dim) &&
      dim.length === 3 &&
      dim.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    ) {
      dimensions.set(itemId, dim)
    }
  }
  return dimensions
}

function resolveUniformScale(dim) {
  if (!dim) return 1
  const horizontalMax = Math.max(dim[0], dim[1])
  if (!Number.isFinite(horizontalMax) || horizontalMax <= MAX_HORIZONTAL_DIM) {
    return 1
  }
  return Number((MAX_HORIZONTAL_DIM / horizontalMax).toFixed(4))
}

function buildPlaceInfo(furnitureList, dimensions) {
  const xCount = Math.floor((LAYOUT.X_MAX - LAYOUT.X_MIN) / LAYOUT.SPACING) + 1
  const yCount = Math.floor((LAYOUT.Y_MAX - LAYOUT.Y_MIN) / LAYOUT.SPACING) + 1
  const itemsPerLayer = xCount * yCount

  console.log(`摆放区域：X轴 ${xCount} 个位置，Y轴 ${yCount} 个位置`)
  console.log(`每层可摆放：${itemsPerLayer} 个物品`)
  console.log(`预计需要：${Math.ceil(furnitureList.length / itemsPerLayer)} 层`)

  const placeInfo = []
  let scaledCount = 0
  let minScale = 1
  let missingDimCount = 0

  for (let index = 0; index < furnitureList.length; index++) {
    const furniture = furnitureList[index]
    const furnitureId = furniture?.id
    if (furnitureId === undefined || furnitureId === null) {
      console.warn(`警告：第 ${index} 个家具缺少 id 字段，跳过`)
      continue
    }

    const itemId = ITEM_ID_OFFSET + furnitureId
    const dim = dimensions.get(itemId)
    if (!dim) missingDimCount += 1

    const scale = resolveUniformScale(dim)
    if (scale < 1) {
      scaledCount += 1
      if (scale < minScale) minScale = scale
    }

    const layer = Math.floor(index / itemsPerLayer)
    const posInLayer = index % itemsPerLayer
    const xIdx = posInLayer % xCount
    const yIdx = Math.floor(posInLayer / xCount)

    const locationX = LAYOUT.X_MIN + xIdx * LAYOUT.SPACING
    const locationY = LAYOUT.Y_MIN + yIdx * LAYOUT.SPACING
    const locationZ = LAYOUT.Z_START + layer * LAYOUT.Z_LAYER_HEIGHT

    placeInfo.push({
      GroupID: 0,
      Rotation: {
        Pitch: 0,
        Yaw: 0,
        Roll: 0,
      },
      TempInfo: {},
      ItemID: itemId,
      Scale: {
        Y: scale,
        X: scale,
        Z: scale,
      },
      InstanceID: index + 1,
      AttachID: 0,
      Location: {
        Y: locationY,
        X: locationX,
        Z: locationZ,
      },
      ColorMap: {
        0: 0,
      },
    })
  }

  return { placeInfo, scaledCount, minScale, missingDimCount }
}

function main() {
  const { help, input, metadata, output } = parseArgs(process.argv.slice(2))

  if (help) {
    console.log(
      '用法: node scripts/generate-furniture-layout.js [--input <manifest.json>] [--metadata <building-momo-furniture.json>] [--output <输出.json>]'
    )
    console.log(`默认输入: ${DEFAULT_INPUT}`)
    console.log(`默认尺寸数据: ${DEFAULT_METADATA}`)
    console.log(`默认输出: ${DEFAULT_OUTPUT}`)
    return
  }

  if (!fs.existsSync(input)) {
    throw new Error(`未找到输入文件: ${input}`)
  }

  const manifest = JSON.parse(fs.readFileSync(input, 'utf8'))
  const rawList = Array.isArray(manifest?.furniture) ? manifest.furniture : []
  const furnitureList = [...rawList].sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0))
  const dimensions = loadDimensionsMap(metadata)

  console.log(`共找到 ${furnitureList.length} 个家具项（已按 ID 升序排序）`)

  const { placeInfo, scaledCount, minScale, missingDimCount } = buildPlaceInfo(
    furnitureList,
    dimensions
  )
  const result = {
    NeedRestore: true,
    PlaceInfo: placeInfo,
  }

  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8')

  console.log(`\n生成完成！`)
  console.log(`输出文件：${output}`)
  console.log(`共生成 ${placeInfo.length} 个物品`)
  console.log(
    `水平尺寸超 ${MAX_HORIZONTAL_DIM} 已等比缩小：${scaledCount} 个（最小缩放 ${minScale}，缺失尺寸 ${missingDimCount} 个）`
  )

  if (placeInfo.length > 0) {
    const maxZ = placeInfo.reduce((max, item) => Math.max(max, item.Location.Z), LAYOUT.Z_START)
    const actualLayers = Math.floor((maxZ - LAYOUT.Z_START) / LAYOUT.Z_LAYER_HEIGHT) + 1
    console.log(`实际使用层数：${actualLayers}`)
    console.log(`Z轴范围：${LAYOUT.Z_START} ~ ${maxZ}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`[generate-furniture-layout] ${error.message}`)
  process.exit(1)
}
