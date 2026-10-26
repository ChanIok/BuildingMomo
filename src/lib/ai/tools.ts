import { tool, type ToolSet } from 'ai'
import { createArtifacts, describeArtifact } from './artifacts'
import { runComputation, type ComputeExecutor } from './computeClient'
import { readInput } from './toolSchema'
import {
  inspectInput,
  computeInput,
  renderInput,
  applyInput,
  organizationInput,
} from './toolInputs'
import { scenarioGuides } from './guides'
import type { ConversationRepository } from './repository'
import {
  AiError,
  messageText,
  assertNotAborted,
  type ArtifactRecord,
  type ConversationRecords,
  type EditorHost,
  type RenderPanel,
  type ToolOutput,
} from './types'
import type { AnalysisCamera, ImageLayout } from '../sceneAnalysis/images'
import { readObject, readString } from '../sceneAnalysis/validation'

export const workbenchTools = {
  inspect: tool({
    description:
      '读取选区、已保存资料、计算文档或内置场景指南。涉及当前或新选区时先用 ref="selection" 捕获调用时的成员；空选区请用户选择，不扩展到整个方案。继续已有分析沿用原引用。集合默认只返回概况，引用固定成员，不冻结坐标；读取集合返回当前成员状态及更新后的引用。图片引用会重新附上原图，不重新渲染。计算文档入口：inspect({"ref":"api"})；场景指南入口见主提示词目录。',
    inputSchema: inspectInput,
    metadata: { effect: 'read' },
  }),
  compute: tool({
    description: [
      '在一次性 Worker 中执行只读同步 JavaScript 函数体，默认 5 秒超时。执行环境提供 input、api、publish，每次运行独立，无持久全局变量，不提供编辑入口；不要使用导入、异步任务、网络或浏览器 API。',
      'inputs 配置引用映射；代码从 input.<键名> 读取，不会注入同名独立变量，也没有 inputs 全局对象。集合解析为完整精度物品数组；表格、报告、计划解析为保存的 JSON。',
      '结果必须通过 publish 发布，普通 return 或 console.log 不会返回给模型。签名：publish.set(label, instanceIdsOrItems)、publish.table(label, array)、publish.report(label, json)、publish.plan(label, {collections, groups})。每次都必须传名称和数据两个参数。',
      'publish.set 保存输入中的精确成员，publish.table 保存明细，两者只返回引用和概况；publish.report 内容直接进入上下文，用于结论、数量和异常，不要反复输出整张物品表。新引用在调用结束后分配，等工具返回再使用，不猜编号，也不在本次代码中引用本次发布结果。',
      'api 提供共享坐标与统计辅助函数。使用物品字段或辅助函数前可调用 inspect({"ref":"api"}) 查完整数据结构、签名和坐标约定。',
      '最小示例：{"inputs":{"items":"R1"},"code":"publish.report(\'数量\', input.items.length)"}',
    ].join('\n'),
    inputSchema: computeInput,
    metadata: { effect: 'read' },
  }),
  render: tool({
    description: [
      '生成透视场景图或原素材图册，按 panels 顺序合成带标题的拼图；单幅也传 panels 数组。',
      'ref 决定显示成员，focus 只改变取景；隔离遮挡使用局部 ref。标签未检测遮挡，可能重叠。atlas 只展示原素材图标，不证明实际用途。图片未附上时用 inspect 取回。',
      '最小示例（R1 替换为工具已返回的集合引用）：{"panels":[{"ref":"R1","label":"全景"}]}',
    ].join('\n'),
    inputSchema: renderInput,
    metadata: { effect: 'read' },
  }),
  apply: tool({
    description:
      '在用户授权范围内，用精确集合引用执行一笔可撤销的集合/家具组整理。直接传 collections/groups，或仅传 plan。不能移动、旋转、缩放或删除物品。同一批工具顺序执行，最多一个 apply 且必须放最后。宿主核验当前场景版本、成员和保护状态；过期集合先 inspect 获取更新后的引用，受场景变化影响的判断需重算。revision=null 的历史派生计划不能用于编辑，摘要本身不使证据过期。以操作核验为准，不重放中断或结果不明的编辑；用 inspect({"ref":"操作 recordId"}) 先回查，不额外增加确认流程。',
    inputSchema: applyInput,
    metadata: { effect: 'edit' },
  }),
} satisfies ToolSet

export const computationHelp = `输入与执行
compute({inputs:{items:"R1"},code:"..."}) 中，input.items 为集合的完整精度数组；表格、报告、计划则解析为其保存的 JSON。inputs 必填，无输入时传 {}；代码只从 input 读取，不会注入同名独立变量。执行环境提供 input、api、publish，支持普通同步 JS，无持久全局变量、导入或异步 API，默认 5 秒超时。普通 return 或 console.log 不发布结果。
物品：{instanceId:number,gameId:number,groupId:number,name:string|null,position:{x,y,z},rotation:{x,y,z},scale:{x,y,z},bounds:{min:{x,y,z},max:{x,y,z},source}|null}。
instanceId 标识实例，gameId 标识素材。位置和 bounds 是世界空间厘米、Z 向上；rotation 是视觉角度（度），scale 是视觉轴。inspect 的实例显示值会舍入，计算输入保留完整精度。

计算辅助
api.groupBy(array,fn) → 按键分组的对象。
api.distribution(numberArray,precision=1) → [{value,count}]。
api.dominantFrame(items) → {yaw,origin:{x,y,z},support}，估计正交主轴，不代表入口方向。
api.toFrame(position,frame)、api.fromFrame(position,frame) → 使用编辑器共享规则换算工作坐标与世界坐标，避免自行套用视觉角度。
bounds 为世界 AABB（可能为 null）；旋转其角点不能还原物体真实定向边界。api.gap(a.bounds,b.bounds) 返回保守 AABB 间距或 null，重叠或零间距不能证明连接。

发布结果
publish.set(label,instanceIdsOrItems) 保存输入集合中的精确成员；publish.table(label,array) 保存明细，两者只返回引用和概况。
publish.report(label,json) 直接返回内容，适合结论、数量和异常。
publish.plan(label,{collections:[{id,name,parentId,order?}],groups:[{id,name,collectionId,ref,order?}]}) 保存整理计划，字段含义与 apply 一致，无新集合传 collections:[]，顶层 parentId/collectionId 传 null。每个发布方法都需要 label 和 value 两个参数。新引用在调用完成后才分配，不能在本次代码中猜编号用于计划。
引用固定成员；inspect/compute 读取这些成员的当前状态。旧表格、报告可继续分析，但以历史派生数据计算时结果 revision=null，不能授权当前编辑；受场景变化影响的计划应从当前集合重算。
完整结果和代码可用 inspect 的 content/source 回查，旧引用可用 inspect({"ref":"history"}) 查找。

例：保存候选，只返回需要判断的少量信息
const frame = api.dominantFrame(input.items);
const rows = input.items.map(item => ({item, local: api.toFrame(item.position, frame)}));
const parts = rows.filter(row => row.local.z < 100).map(row => row.item);
publish.set("低位候选", parts);
publish.report("候选概况", {count: parts.length, heights: api.distribution(parts.map(i => i.position.z), 10)});
高度筛选只是候选条件，不直接证明物品用途。`

export function estimateText(text: string) {
  let units = 0
  for (const char of text) units += char.charCodeAt(0) > 127 ? 1 : 1 / 3
  return Math.ceil(units)
}
// OpenCode's general byte budget, applied once to the complete structured result.
export const TOOL_OUTPUT_BYTES = 50 * 1024
export function toolModelResult(tool: import('./types').ToolRecord, maxBytes = TOOL_OUTPUT_BYTES) {
  const text = JSON.stringify({ ...tool.result, recordId: tool.id })
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  const preview = new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true })
  return JSON.stringify({
    ok: tool.result?.ok ?? false,
    truncated: true,
    totalBytes: bytes.length,
    preview,
    references: tool.artifactIds,
    recordId: tool.id,
    instruction:
      '完整结果已保存。用 inspect 读取此 recordId 的 content，可按 offset/limit（字符）分段，或读取其资料引用。preview 不是完整结果。',
  })
}
function display(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isInteger(value)) return Math.round(value * 10) / 10
  if (Array.isArray(value)) return value.map(display)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, display(v)]))
  return value
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export function createWorkbenchTools(
  records: ConversationRecords,
  repository: ConversationRepository,
  host: EditorHost,
  language: string,
  compute: ComputeExecutor = runComputation
) {
  const cache = new Map<string, ToolOutput>()
  return {
    definitions: workbenchTools,
    async execute(
      name: string,
      parameters: Record<string, unknown>,
      version: string,
      signal: AbortSignal,
      toolId: string
    ): Promise<ToolOutput> {
      const store = createArtifacts(records, repository)
      try {
        assertNotAborted(signal)
        host.assertCurrent(version)
        const definition = Object.hasOwn(workbenchTools, name)
          ? workbenchTools[name as keyof typeof workbenchTools]
          : undefined
        if (!definition)
          throw new AiError(
            'invalid_input',
            `Unknown tool ${name}. Available tools: ${Object.keys(workbenchTools).join(', ')}`
          )
        const p = parameters // Already validated by the SDK against the shared schema.
        const signature = `${version}:${name}:${canonical(p)}`
        const live =
          p.ref === 'selection' ||
          p.ref === 'history' ||
          records.artifacts.some((a) => a.ref === p.ref && a.kind === 'image')
        const repeated = name !== 'apply' && !live ? cache.get(signature) : undefined
        if (repeated) return { ...repeated, artifacts: [] }
        let revision: string | null = version
        const schemeId = host.current().summary.schemeId
        const source = { toolId, inputs: [] as string[] }
        const add = (
          kind: ArtifactRecord['kind'],
          label: string,
          value?: unknown,
          count?: number
        ) => store.add({ kind, label, revision, schemeId, count, source }, value)
        const set = async (ref: unknown, fresh = false) => {
          const a = store.get(readString(ref, 'reference'))
          if (a.schemeId !== schemeId || a.kind !== 'set')
            throw new AiError('invalid_input', 'Reference must be a set from the active scheme')
          if (fresh && a.revision !== version)
            throw new AiError(
              'stale_reference',
              `Inspect ${a.ref} to renew exact members; derived analysis may need recomputation.`
            )
          const members = await store.members(a.ref)
          return { artifact: a, members }
        }
        const offset = p.offset ?? 0,
          limit = p.limit
        const page = (values: unknown[]) => {
          const rows = values.slice(
            offset as number,
            limit === undefined ? undefined : (offset as number) + (limit as number)
          )
          return {
            total: values.length,
            offset,
            nextOffset:
              (offset as number) + rows.length < values.length
                ? (offset as number) + rows.length
                : null,
            rows,
          }
        }
        const textPage = (text: string) => {
          const end = limit === undefined ? text.length : (offset as number) + (limit as number)
          return {
            totalCharacters: text.length,
            offset,
            nextOffset: end < text.length ? end : null,
            content: text.slice(offset as number, end),
          }
        }
        let data: unknown, attachments: ToolOutput['attachments']
        if (name === 'inspect') {
          const ref = readString(p.ref, 'reference'),
            mode = p.mode ?? 'overview'
          if (ref === 'api') data = { documentation: computationHelp }
          else if (ref.startsWith('guide:')) {
            const guide = scenarioGuides.find((guide) => ref === `guide:${guide.id}`)
            if (!guide)
              throw new AiError(
                'invalid_input',
                `未知场景指南 ${ref}。可用入口：${scenarioGuides.map((guide) => `guide:${guide.id}`).join('、')}`
              )
            data = { guideId: guide.id, title: guide.name, documentation: guide.content }
          } else if (ref === 'history')
            data = page([
              ...records.messages.map((m) => ({
                ref: `M${m.sequence}`,
                role: m.role,
                preview: messageText(m).slice(0, 80),
                references: m.references,
              })),
              ...records.artifacts.map(describeArtifact),
            ])
          else if (/^M\d+$/.test(ref) || records.tools.some((t) => t.id === ref)) {
            const m = records.messages.find((m) => `M${m.sequence}` === ref)
            const t = records.tools.find((t) => t.id === ref)
            if (!m && !t) throw new AiError('invalid_input')
            const text = JSON.stringify(
              m
                ? {
                    text: messageText(m),
                    reasoning: messageText(m, 'reasoning'),
                    references: m.references,
                    toolIds: m.toolIds,
                  }
                : {
                    recordId: t!.id,
                    name: t!.name,
                    state: t!.state,
                    input: t!.input,
                    result: t!.result,
                    references: t!.artifactIds,
                    images: t!.assets,
                    transactionId: t!.edit?.transactionId,
                  }
            )
            data = textPage(text)
          } else {
            let a: ArtifactRecord
            if (ref === 'selection') {
              const selected = host.selection()
              a = await add(
                'set',
                language === 'en' ? 'Current selection' : '当前选区',
                selected.members,
                selected.members.length
              )
            } else {
              a = store.get(ref)
              source.inputs.push(a.ref)
            }
            if (mode === 'source') {
              const producer = records.tools.find((t) => t.id === a.source?.toolId)
              const code =
                producer?.name === 'compute' ? (producer.input as { code: string }).code : ''
              const { content, ...metadata } = textPage(code)
              data = {
                ...describeArtifact(a),
                inputs: a.source?.inputs,
                ...metadata,
                code: content,
              }
            } else if (a.kind === 'set') {
              const selected = await set(a.ref)
              const snapshot = selected.members.length ? host.snapshot(selected.members) : null
              const renewed = await add('set', a.label, selected.members, selected.members.length)
              if (mode === 'types')
                data = {
                  ...describeArtifact(renewed),
                  ...page(
                    (snapshot?.furniture ?? []).map((f) => ({
                      gameId: f.gameId,
                      name: language === 'en' ? f.nameEn : f.nameZh,
                      count: f.instanceCount,
                    }))
                  ),
                }
              else if (mode === 'items') {
                const fields = (p.fields ?? ['position']) as string[]
                data = {
                  ...describeArtifact(renewed),
                  ...page(
                    (snapshot?.items ?? []).map((i) =>
                      display({
                        instanceId: i.instanceId,
                        gameId: i.gameId,
                        groupId: i.groupId,
                        ...Object.fromEntries(fields.map((f) => [f, i[f as 'position']])),
                      })
                    )
                  ),
                }
              } else if (mode === 'collections')
                data = {
                  ...describeArtifact(renewed),
                  ...page([
                    ...(snapshot?.collections ?? []),
                    ...(snapshot?.groups ?? []).map(({ originItemId: _id, ...g }) => g),
                  ]),
                }
              else
                data = {
                  ...describeArtifact(renewed),
                  typeCount: snapshot?.furniture.length ?? 0,
                  coordinateSystem: snapshot?.coordinateSystem,
                  evidence:
                    a.revision === version ? 'current' : 'renewed_membership_check_analysis',
                  groupCount: snapshot?.groups.length ?? 0,
                }
            } else if (a.kind === 'image') {
              if (!a.asset) throw new AiError('storage')
              const asset = await repository.read<import('./types').AssetRecord>(a.asset.id)
              if (!asset || asset.conversationId !== records.conversation.id)
                throw new AiError('storage')
              data = describeArtifact(a)
              attachments = [
                { imageId: asset.id, blob: asset.blob, width: asset.width, height: asset.height },
              ]
            } else {
              const value = await store.data(a)
              if (Array.isArray(value) && mode !== 'content')
                data = { ...describeArtifact(a), ...page(value) }
              else {
                const text = JSON.stringify(value)
                data = { ...describeArtifact(a), ...textPage(text) }
              }
            }
          }
        } else if (name === 'compute') {
          const inputs = readObject(p.inputs),
            input: Record<string, unknown> = Object.create(null)
          const allowed = new Map<number, string>()
          for (const [key, ref] of Object.entries(inputs)) {
            const a = store.get(readString(ref, 'input reference'))
            source.inputs.push(a.ref)
            if (a.schemeId !== schemeId || a.kind === 'image')
              throw new AiError(
                'invalid_input',
                'compute accepts sets, reports, tables or plans from the active scheme'
              )
            if (a.kind === 'set') {
              const members = await store.members(a.ref),
                snapshot = members.length ? host.snapshot(members) : null
              const furniture = new Map(snapshot?.furniture.map((f) => [f.gameId, f]))
              input[key] = (snapshot?.items ?? []).map(({ id, ...i }) => {
                if (allowed.has(i.instanceId) && allowed.get(i.instanceId) !== id)
                  throw new AiError('invalid_input', 'Ambiguous InstanceID')
                allowed.set(i.instanceId, id)
                const f = furniture.get(i.gameId)
                return { ...i, name: (language === 'en' ? f?.nameEn : f?.nameZh) ?? null }
              })
            } else {
              if (a.revision !== version) revision = null
              input[key] = await store.data(a)
            }
          }
          const code = readString(p.code, 'code')
          const outputs = await compute(code, input, signal)
          host.assertCurrent(version)
          assertNotAborted(signal)
          if (!Array.isArray(outputs)) throw new AiError('compute', 'Invalid Worker output')
          const published = []
          for (const output of outputs) {
            if (!output || !['set', 'report', 'table', 'plan'].includes(output.kind))
              throw new AiError('compute', 'Invalid publication')
            const text = JSON.stringify(output.value)
            if (text === undefined) throw new AiError('compute', 'Publication must be JSON')
            const label = readString(output.label, 'publication label')
            let value = output.value
            if (output.kind === 'table' && !Array.isArray(value))
              throw new AiError('compute', 'A table must be an array')
            if (output.kind === 'plan') {
              readInput(organizationInput, value, 'apply 计划')
            }
            if (output.kind === 'set') {
              if (!Array.isArray(value))
                throw new AiError('compute', 'A set must contain input items or instanceIds')
              const ids = value
              if (
                new Set(ids).size !== ids.length ||
                ids.some((i) => !Number.isSafeInteger(i) || !allowed.has(i))
              )
                throw new AiError(
                  'compute',
                  'Published set contains duplicates or members outside the inputs'
                )
              value = ids.map((i) => allowed.get(i)!)
            }
            const a = await add(
              output.kind,
              label,
              value,
              Array.isArray(value) ? value.length : undefined
            )
            published.push({
              ...describeArtifact(a),
              ...(output.kind === 'report' ? { report: JSON.parse(text) } : {}),
            })
          }
          data = {
            publications: published,
            instruction: published.length
              ? '使用返回的引用；需要明细或代码时再 inspect content/source。'
              : "未发布结果。普通 return 不会返回结果；请使用 publish 方法，例如 publish.report('结果', value)，每次传名称和数据两个参数。",
          }
        } else if (name === 'render') {
          const panels: RenderPanel[] = [],
            panelRefs: string[] = []
          const layout = p.layout as ImageLayout | undefined
          for (const [index, raw] of (p.panels as Record<string, unknown>[]).entries()) {
            const q = raw
            const selected = await set(q.ref),
              kind = q.kind ?? 'scene'
            if (
              kind === 'atlas' &&
              ['focus', 'camera', 'width', 'height', 'color', 'labels'].some(
                (key) => q[key] !== undefined
              )
            )
              throw new AiError(
                'invalid_input',
                `panels[${index}]: atlas 只使用 ref/label/kind/layout；场景参数请用于 kind=scene。`
              )
            if (kind === 'scene' && q.layout !== undefined)
              throw new AiError(
                'invalid_input',
                `panels[${index}].layout 仅用于 atlas；场景拼图请用外层 layout。`
              )
            const focused = q.focus === undefined ? null : await set(q.focus)
            const labeled = typeof q.labels === 'string' ? await set(q.labels) : null
            if (
              [...(focused?.members ?? []), ...(labeled?.members ?? [])].some(
                (id) => !selected.members.includes(id)
              )
            )
              throw new AiError(
                'invalid_input',
                `panels[${index}]: focus、labels 引用的成员必须包含于 ref 显示集合。`
              )
            if (focused && !focused.members.length)
              throw new AiError('invalid_input', `panels[${index}].focus 不能是空集合。`)
            panels.push({
              label: readString(q.label, 'panel label'),
              kind: kind as RenderPanel['kind'],
              members: selected.members,
              focus: focused?.members,
              camera: q.camera as AnalysisCamera | undefined,
              width: q.width as number | undefined,
              height: q.height as number | undefined,
              layout: q.layout as ImageLayout | undefined,
              color: q.color as string | undefined,
              labels: labeled ? labeled.members : (q.labels as boolean | undefined),
            })
            panelRefs.push(selected.artifact.ref)
            source.inputs.push(selected.artifact.ref)
            if (focused) source.inputs.push(focused.artifact.ref)
            if (labeled) source.inputs.push(labeled.artifact.ref)
          }
          const output = await host.render(panels, signal, layout)
          host.assertCurrent(version)
          assertNotAborted(signal)
          const id = `asset:${records.conversation.id}:${crypto.randomUUID()}`
          const a = await store.add(
            {
              kind: 'image',
              label: panels.map((p) => p.label).join(' / '),
              revision,
              schemeId,
              source,
              asset: { id, width: output.width, height: output.height, bytes: output.blob.size },
            },
            output.details
          )
          attachments = [
            { imageId: id, blob: output.blob, width: output.width, height: output.height },
          ]
          data = {
            ...describeArtifact(a),
            panels: panels.map((p, i) => ({
              panel: i + 1,
              label: p.label,
              ref: panelRefs[i],
              kind: p.kind,
              count: p.members.length,
              camera: p.camera,
            })),
            evidence: output.details,
          }
        } else {
          let command = p
          if (p.plan !== undefined) {
            const a = store.get(readString(p.plan, 'plan'))
            if (a.kind !== 'plan' || a.schemeId !== schemeId) throw new AiError('invalid_input')
            if (a.revision !== version)
              throw new AiError('stale_reference', 'Recompute this plan against the current scene')
            command = readInput(organizationInput, await store.data(a), 'apply 计划')
          }
          const groups = []
          for (const value of command.groups as unknown[]) {
            const group = readObject(value, ['id', 'name', 'collectionId', 'ref', 'order']),
              selected = await set(group.ref, true)
            const { ref: _ref, ...rest } = group
            groups.push({ ...rest, itemIds: selected.members })
          }
          host.assertCurrent(version)
          assertNotAborted(signal)
          return host.apply({ collections: command.collections, groups }, version)
        }
        host.assertCurrent(version)
        assertNotAborted(signal)
        const output = { ok: true, data, attachments, artifacts: store.staged }
        cache.set(signature, output)
        return output
      } catch (cause) {
        if (cause instanceof AiError && !['storage', 'cancelled', 'stale'].includes(cause.code))
          return { ok: false, error: { code: cause.code, message: cause.message } }
        if (cause instanceof Error && cause.name === 'SceneAnalysisError')
          return {
            ok: false,
            error: {
              code: (cause as { code?: string }).code ?? 'invalid_input',
              message: cause.message,
            },
          }
        throw cause
      }
    },
  }
}
