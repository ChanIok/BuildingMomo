import { z } from 'zod'
import { externalExecuteInput, type createExternalWorkbench } from './externalWorkbench'
import type { ConversationRepository } from './repository'
import { formatInputError } from './toolSchema'
import { toolModelResult, workbenchTools } from './tools'
import { failure, type AssetRecord } from './types'
import { blobBase64 } from './diagnostics'

export const desktopAiProtocol = 1
export const mcpVersions = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26']
const serverInfo = { name: 'BuildingMomo', version: '1.0.0' }
const instructions =
  'Operate on the open BuildingMomo editor. Omit contextId only for the first call of a new task; reuse the returned contextId on subsequent calls. Each context owns vars, references and execution history. Its default scheme is fixed at creation and does not follow tab changes. Never borrow another chat’s context. Edits affect the shared scheme. Refresh old furniture before editing. On an interrupted or uncertain outcome, inspect api.history() instead of replaying edits. The user checks and acknowledges uncertain edits in BuildingMomo.'

export interface McpHttpRequest {
  body: unknown
  protocolVersion?: string
  methodHeader?: string
  nameHeader?: string
}
export interface McpHttpResponse {
  status: number
  body?: unknown
}

export const externalToolDefinition = {
  name: 'execute_js',
  description: `${instructions}\n\n${workbenchTools.execute_js.description}`,
  inputSchema: z.toJSONSchema(externalExecuteInput, { target: 'draft-7', io: 'input' }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
}

function object(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/** Stateless HTTP protocol adapter. Application state is addressed only by contextId. */
export function createMcpHandler(options: {
  workbench: ReturnType<typeof createExternalWorkbench>
  repository: ConversationRepository
  isReady: () => boolean
  language: () => string
}) {
  return async (request: McpHttpRequest, signal: AbortSignal): Promise<McpHttpResponse> => {
    const message = request.body
    const id =
      object(message) && (typeof message.id === 'string' || typeof message.id === 'number')
        ? message.id
        : null
    const error = (code: number, text: string, status = 400, data?: unknown): McpHttpResponse => ({
      status,
      body: {
        jsonrpc: '2.0',
        id,
        error: { code, message: text, ...(data === undefined ? {} : { data }) },
      },
    })
    if (
      !object(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      (message.id !== undefined && id === null) ||
      (message.params !== undefined && !object(message.params))
    )
      return error(-32600, 'Invalid JSON-RPC request')
    const params = message.params ?? {}
    const version = request.protocolVersion ?? '2025-03-26'
    const modern = version === '2026-07-28'
    const complete = (value: Record<string, unknown>): McpHttpResponse => ({
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: { ...(modern ? { resultType: 'complete' } : {}), ...value },
      },
    })
    if (message.method !== 'initialize' && !mcpVersions.includes(version))
      return error(-32022, 'Unsupported protocol version', 400, {
        supported: mcpVersions,
        requested: version,
      })
    if (modern) {
      const meta = params._meta
      if (
        !object(meta) ||
        meta['io.modelcontextprotocol/protocolVersion'] !== version ||
        request.methodHeader !== message.method ||
        (message.method === 'tools/call' && request.nameHeader !== params.name)
      )
        return error(-32020, 'MCP metadata/header mismatch')
      const client = meta['io.modelcontextprotocol/clientInfo']
      if (
        !object(client) ||
        typeof client.name !== 'string' ||
        typeof client.version !== 'string' ||
        !object(meta['io.modelcontextprotocol/clientCapabilities'])
      )
        return error(-32602, 'Missing MCP client metadata')
    }
    if (message.id === undefined) {
      if (!message.method.startsWith('notifications/'))
        return error(-32600, 'Requests require an id')
      // Stateless HTTP has no client-scoped RPC-id namespace. Cancel through the
      // owning HTTP request (native requestId), never another chat's matching id.
      return { status: 202 }
    }
    if (!options.isReady())
      return error(
        -32000,
        'Enable external AI in the authenticated BuildingMomo desktop editor.',
        503
      )
    if (message.method === 'initialize') {
      if (typeof params.protocolVersion !== 'string')
        return error(-32602, 'Missing protocolVersion')
      return complete({
        protocolVersion:
          mcpVersions.includes(params.protocolVersion) && params.protocolVersion !== mcpVersions[0]
            ? params.protocolVersion
            : '2025-11-25',
        capabilities: { tools: {} },
        serverInfo,
        instructions,
      })
    }
    if (message.method === 'server/discover')
      return complete({
        supportedVersions: mcpVersions,
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
        instructions,
      })
    if (message.method === 'ping') return complete({})
    if (message.method === 'tools/list') return complete({ tools: [externalToolDefinition] })
    if (message.method !== 'tools/call')
      return error(-32601, 'Method not found', modern ? 404 : 200)
    if (params.name !== 'execute_js') return error(-32602, 'Unknown tool', 200)
    const input = externalExecuteInput.safeParse(params.arguments)
    if (!input.success)
      return complete({
        isError: true,
        content: [
          { type: 'text', text: formatInputError(externalExecuteInput, input.error, 'execute_js') },
        ],
      })
    try {
      const records = await options.workbench.run(input.data, signal, options.language())
      const tool = records.tools.at(-1)!
      const result = {
        contextId: records.conversation.id,
        defaultSchemeId: records.conversation.external!.schemeId,
        ...JSON.parse(toolModelResult(tool)),
      }
      const content: Record<string, unknown>[] = [{ type: 'text', text: JSON.stringify(result) }]
      for (const reference of tool.assets) {
        const asset = await options.repository.read<AssetRecord>(reference.id)
        if (!asset || asset.conversationId !== records.conversation.id)
          throw new Error('Missing stored image')
        content.push({
          type: 'image',
          data: await blobBase64(asset.blob),
          mimeType: asset.mediaType ?? asset.blob.type,
        })
      }
      return complete({ isError: !tool.result?.ok, structuredContent: result, content })
    } catch (cause) {
      return complete({
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              contextId: input.data.contextId,
              error: {
                code: failure(cause).code,
                message: cause instanceof Error ? cause.message : String(cause),
              },
              instruction:
                'Do not automatically replay edits. Inspect the execution history in BuildingMomo if an outcome is unknown.',
            }),
          },
        ],
      })
    }
  }
}
