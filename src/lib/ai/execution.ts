import type { ConversationRepository } from './repository'
import type { ScriptExecutor } from './scriptClient'
import { createWorkbenchTools } from './tools'
import {
  failure,
  type AssetRecord,
  type ConversationRecords,
  type EditorHost,
  type ToolRecord,
} from './types'

export function unresolvedEdits(records: ConversationRecords) {
  const acknowledged = new Set(records.messages.flatMap((message) => message.acknowledges ?? []))
  return records.tools.flatMap((tool) =>
    tool.edits.filter((edit) => edit.state === 'uncertain' && !acknowledged.has(edit.id))
  )
}

/** Shared commit boundary: vars and images are published only after storage succeeds. */
export async function executeWorkbenchTool(options: {
  records: ConversationRecords
  repository: ConversationRepository
  host: EditorHost
  tool: ToolRecord
  signal: AbortSignal
  language?: string
  script?: ScriptExecutor
  defaultSchemeId: string | null
  onChange: () => void
}) {
  const { records, repository, host, tool, signal, onChange } = options
  const save = async (changed: Parameters<ConversationRepository['save']>[1]) => {
    records.conversation = await repository.save(records.conversation, changed)
  }
  if (tool.name !== 'execute_js' || tool.inputError) {
    tool.state = 'failed'
    tool.result = {
      ok: false,
      error: { code: 'invalid_input', message: tool.inputError ?? 'Use execute_js({code})' },
    }
    await save([tool])
    onChange()
    return
  }
  try {
    const workbench = createWorkbenchTools(
      records,
      repository,
      host,
      options.language ?? 'zh',
      options.script,
      options.defaultSchemeId
    )
    const output = await workbench.execute(tool, signal)
    const assets: AssetRecord[] = []
    const nextTool = { ...tool, assets: [...tool.assets] }
    for (const image of output.attachments ?? []) {
      const asset: AssetRecord = {
        id: image.imageId,
        conversationId: records.conversation.id,
        width: image.width,
        height: image.height,
        bytes: image.blob.size,
        blob: image.blob,
        mediaType: image.blob.type,
        ...(image.details ? { details: image.details } : {}),
      }
      const { blob: _blob, conversationId: _conversationId, ...reference } = asset
      nextTool.assets.push(reference)
      assets.push(asset)
    }
    const { attachments: _attachments, variables, ...result } = output
    nextTool.result = result
    nextTool.state = tool.edits.some((e) => e.state === 'uncertain')
      ? 'uncertain'
      : result.ok
        ? 'succeeded'
        : signal.aborted
          ? 'interrupted'
          : 'failed'
    await save([nextTool, ...assets, ...(variables ? [variables] : [])])
    Object.assign(tool, nextTool)
    if (variables) records.variables = variables
    onChange()
  } catch (error) {
    tool.edits = tool.edits.map((edit) =>
      edit.state === 'prepared' ? { ...edit, state: 'uncertain' as const } : edit
    )
    tool.state = tool.edits.some((edit) => edit.state === 'uncertain') ? 'uncertain' : 'interrupted'
    tool.result = {
      ok: false,
      error: {
        code: failure(error).code,
        message: error instanceof Error ? error.message : String(error),
      },
    }
    await save([tool])
    onChange()
    throw error
  }
}
