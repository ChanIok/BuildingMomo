import type { ConversationRepository } from './repository'
import { AiError, type ConversationRecords } from './types'

async function blobDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return `data:${blob.type};base64,${btoa(binary)}`
}

export async function exportConversation(
  repository: ConversationRepository,
  records: ConversationRecords,
  includeImages: boolean,
  secrets: readonly string[] = []
) {
  const requests = await repository.requests(records.conversation.id)
  const references = new Map(
    records.tools.flatMap((tool) => tool.assets.map((asset) => [asset.id, asset] as const))
  )
  const images = await Promise.all(
    [...references.values()].map(async (metadata) => {
      if (!includeImages) return metadata
      const asset = await repository.read<import('./types').AssetRecord>(metadata.id)
      if (!asset || asset.conversationId !== records.conversation.id) throw new AiError('storage')
      return { ...metadata, dataUrl: await blobDataUrl(asset.blob) }
    })
  )
  return JSON.stringify(
    {
      format: 'buildingmomo-ai',
      version: 2,
      exportedAt: new Date().toISOString(),
      ...records,
      requests,
      images,
    },
    (key, value) => {
      if (/^(api_?key|authorization|headers|requestHeaders|responseHeaders)$/i.test(key))
        return undefined
      if (typeof value !== 'string') return value
      for (const secret of secrets) {
        if (!secret) continue
        for (const encoded of [
          secret,
          JSON.stringify(secret).slice(1, -1),
          encodeURIComponent(secret),
        ])
          value = value.split(encoded).join('[REDACTED]')
      }
      return value
    },
    2
  )
}
