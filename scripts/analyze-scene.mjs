// Read-only file diagnostic using shared snapshot and geometry primitives.
// node scripts/analyze-scene.mjs temp/house.json [--output temp/analysis.json]
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [filename, ...args] = process.argv.slice(2)
if (!filename || (args.length && (args.length !== 2 || args[0] !== '--output'))) {
  console.error('Usage: node scripts/analyze-scene.mjs <game.json> [--output <analysis.json>]')
  process.exitCode = 1
} else {
  const inputPath = path.resolve(filename)
  const metadataPath = path.join(root, 'public/assets/data/building-momo-furniture.json')
  const outputPath = args[1] ? path.resolve(args[1]) : null
  if (outputPath && [inputPath, metadataPath].some((file) => file.toLowerCase() === outputPath.toLowerCase())) {
    throw new Error('Output must not overwrite input or furniture metadata')
  }
  const server = await createServer({ configFile: false, root,
    cacheDir: path.join(root, 'node_modules/.cache/scene-analysis'),
    server: { middlewareMode: true }, resolve: { alias: { '@': path.join(root, 'src') } } })
  try {
    const { parseGameDataContent } = await server.ssrLoadModule('/src/lib/gameDataFormat.ts')
    const { createAnalysisSnapshot } = await server.ssrLoadModule('/src/lib/sceneAnalysis/snapshot.ts')
    const { getAnalysisBounds } = await server.ssrLoadModule('/src/lib/sceneAnalysis/geometry.ts')
    const { getAnalysisSummary } = await server.ssrLoadModule('/src/lib/sceneAnalysis/queries.ts')
    const parsed = parseGameDataContent(await fs.readFile(inputPath, 'utf8'))
    const data = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
    const furniture = new Map(data.d)
    // Parser owns format compatibility. This projection only supplies AppItem fields.
    const items = parsed.items.map(({ ItemID, InstanceID, Location, Rotation, GroupID, ...extra }) => ({
      internalId: String(InstanceID), instanceId: InstanceID, gameId: ItemID, groupId: GroupID,
      x: Location.X, y: Location.Y, z: Location.Z,
      rotation: { x: Rotation.Roll, y: Rotation.Pitch, z: Rotation.Yaw }, extra,
    }))
    const getSize = (id) => furniture.get(id)?.[3] ?? null
    const snapshot = createAnalysisSnapshot({
      id: crypto.randomUUID(), schemeId: 'file-analysis', items,
      itemIds: items.map((item) => item.internalId), collectionTree: { nodes: [], groups: [] }, groupOrigins: new Map(),
      getFurniture(gameId) {
        const info = furniture.get(gameId)
        if (!info) return null
        const category = data.c[info[6]]
        return { gameId, nameZh: info[0], nameEn: info[1], sizeCm: info[3],
          iconUrl: info[2] ? `assets/furniture-icon/${info[2]}.webp` : null,
          category: category ? { id: info[6], nameZh: category[0], nameEn: category[1], parentId: category[3] ?? null } : null }
      },
      // CLI does not create a renderer or download assets. Bounds are explicitly
      // tagged furniture-box; viewport sessions can use already loaded model bounds.
      getBounds: (item) => getAnalysisBounds(item, { getFurnitureSize: getSize, getModelConfig: () => null }),
    })
    const summary = getAnalysisSummary(snapshot)
    if (outputPath) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, JSON.stringify({
        geometryPolicy: 'furniture-dimensions-only; no model geometry or images',
        snapshot,
      }, null, 2))
    }
    console.log(JSON.stringify({ geometryPolicy: 'furniture-dimensions-only', ...summary,
      ...(outputPath ? { output: outputPath } : {}),
    }, null, 2))
  } finally { await server.close() }
}
