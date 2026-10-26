import type { ArtifactRecord, ConversationRecords, PayloadRecord } from './types'
import { AiError } from './types'
import type { ConversationRepository } from './repository'

export function describeArtifact(a: ArtifactRecord) {
  return { ref: a.ref, kind: a.kind, label: a.label, count: a.count, revision: a.revision }
}

/** Canonical metadata is small. Payloads (including exact membership) load on demand. */
export function createArtifacts(records: ConversationRecords, repository: ConversationRepository) {
  const staged: (ArtifactRecord | PayloadRecord)[] = []
  const all = () => [...records.artifacts, ...staged.filter((r): r is ArtifactRecord => 'ref' in r)]
  function get(ref: string) {
    const a = all().find((a) => a.ref === ref)
    if (!a)
      throw new AiError(
        'invalid_input',
        `Unknown reference ${ref}. Inspect history for available references.`
      )
    return a
  }
  async function data(a: ArtifactRecord) {
    if (!a.payloadId) return undefined
    const value =
      (staged.find((r) => r.id === a.payloadId) as PayloadRecord | undefined) ??
      (await repository.read<PayloadRecord>(a.payloadId))
    if (!value || value.conversationId !== records.conversation.id) throw new AiError('storage')
    return value.data
  }
  async function members(ref: string) {
    const a = get(ref)
    if (a.kind !== 'set') throw new AiError('invalid_input', `${ref} is not a set`)
    const value = await data(a)
    if (!Array.isArray(value) || !value.every((id) => typeof id === 'string'))
      throw new AiError('storage')
    return value as string[]
  }
  async function add(
    input: Omit<ArtifactRecord, 'id' | 'ref' | 'conversationId' | 'payloadId'>,
    value?: unknown
  ) {
    if (input.kind === 'set') {
      if (
        !Array.isArray(value) ||
        !value.every((v) => typeof v === 'string') ||
        new Set(value).size !== value.length
      )
        throw new AiError('invalid_input')
      const sorted = [...value].sort()
      value = sorted
      for (const previous of all()) {
        if (
          previous.kind !== 'set' ||
          previous.label !== input.label ||
          previous.schemeId !== input.schemeId ||
          previous.revision !== input.revision ||
          previous.count !== sorted.length
        )
          continue
        const old = await data(previous)
        if (JSON.stringify(old) === JSON.stringify(value)) return previous
      }
    }
    const ref = `R${all().reduce((max, a) => Math.max(max, Number(a.ref.slice(1))), 0) + 1}`
    const a: ArtifactRecord = {
      ...input,
      ref,
      id: `artifact:${records.conversation.id}:${ref}`,
      conversationId: records.conversation.id,
    }
    if (value !== undefined) {
      a.payloadId = `payload:${records.conversation.id}:${ref}`
      staged.push({
        id: a.payloadId,
        conversationId: records.conversation.id,
        data: structuredClone(value),
      })
    }
    staged.push(a)
    return a
  }
  return { get, data, members, add, staged, all }
}
