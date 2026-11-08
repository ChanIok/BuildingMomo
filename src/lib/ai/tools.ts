import type { ToolSet } from 'ai'
import { executeInput } from './toolInputs'
import { runScript, type ScriptExecutor } from './scriptClient'
import { serializeData, type HostCall } from './scriptRuntime'
import { scenarioGuides } from './guides'
import type { ConversationRepository } from './repository'
import {
  AiError,
  assertNotAborted,
  type ConversationRecords,
  type EditorHost,
  type ImageAttachment,
  type ItemReference,
  type JsonValue,
  type ScriptItem,
  type ToolRecord,
} from './types'
import { readObject, readString, readVector } from '../sceneAnalysis/validation'
import type { AnalysisCamera, ImageLayout } from '../sceneAnalysis/images'

const defaultScenePanelSize = 768
const maxScenePanelSize = 1024

// Sent with the tool declaration on every request; no opening help round trip.
const executionHelp = `执行支持 await 的 JavaScript 函数体；除 api.math 外，所有 API 方法均需 await。
vars 是会话持久化变量，支持含有限数值的 JSON 数据和家具对象；执行与保存成功后生效，失败保留旧值，删除用 delete vars.name。局部变量仅用于本次执行。
完整数据留在 vars 中供代码筛选、统计和比较；console.log/return 将判断依据、计算结论和待核对样本送入上下文。图片回执和编辑结果由宿主附上。

## 读取
api.schemes() → [{id,name}]，列出已加载方案。
api.items(schemeId?) → 可见、未锁定家具的完整数组。
api.selection(schemeId?) → 当前选区的家具数组，空选区返回 []。
api.structure(schemeId?) → {groups,collections}，现有分组和分类树（含空分类），通过 groupId 对应家具。
api.refresh(items) → 按原成员及顺序读取当前数据；成员缺失、隐藏或锁定时整次报错。
api.catalog({query?,gameIds?}) → 在宿主端按家具名称/分类或精确 gameId 查询目录；query 可为字符串或字符串数组，返回匹配的 {gameId,name,sizeCm,scaleRange,rotationAllowed,combination}。不要无条件读取全目录；用筛选结果取 gameId 交给 api.place。
省略 schemeId 时使用本轮消息固定的默认方案，切换标签不改变目标；api.viewport() 是例外，只捕获调用时当前打开的方案和视口。
家具数据类型：
Vector3 = {x:number,y:number,z:number}。
Bounds = {min:Vector3,max:Vector3,source:'model-aabb'|'furniture-box'|'slide-path'}，表示保守 AABB。
Furniture = {ref:number,instanceId:number,gameId:number,name:string|null,groupId:number,position:Vector3,rotation:Vector3,scale:Vector3,bounds:Bounds|null}。
传入原家具对象或 filter/slice 得到的数组，ref 由宿主管理。数据保留完整精度：position/bounds 为世界厘米、Z 向上；rotation 为视觉角度（度）；scale 为视觉 x/y/z。保守边界接近不代表模型接触。

## 渲染
api.render(panels,layout?) → {imageId,width,height,details:{panels,...}}，生成并附上一张合图。
panels 为非空数组，所有家具来自同一方案；每项 {items,label,kind?:'scene'|'atlas',focus?:items,camera?,width?,height?,color?,labels?:boolean,layout?}，items 非空。
scene 为默认类型，目标方案须打开模型视图。focus 是 items 的非空子集，仅控制取景；labels=true 显示 InstanceID。width/height 各默认 ${defaultScenePanelSize}px，长边上限 ${maxScenePanelSize}px，超出时等比缩小；回执返回实际尺寸。
camera:{azimuth?,elevation?,fov?,distance?,target?:{x,y,z}}，方位 0 从 +X 看、90 从 +Y 看；默认方位 45°、俯仰 25°、FOV 45°并自动取景。
atlas 展示原素材图标，可用于后台方案；仅接受 items/label/kind/layout，默认 4 列、240×232 单元格。
layout:{columns?,cellWidth?,cellHeight?}，面板内仅用于 atlas。外层省略时自动紧凑排版，等比缩放、不裁切；显式指定时使用等大网格，默认单元格取原图最大宽、高加 32px 标题区，外层 cellHeight 须大于 32。
工具结果自动包含 images:[{id,width,height,bytes,details}]，id 即 imageId；details.panels 含编号、标题、视角及渲染/缺失情况，合图面板另含 frame:{x,y,width,height}。结合渲染与缺失情况判断图片覆盖范围。
api.viewport() → 获取用户当前 3D 视口画面和实际相机信息，不移动相机、不改变选择、不产生编辑。返回的 view.details.camera 包含 projection、position、forward、viewMatrix、projectionMatrix，view.details.viewport 包含输出尺寸；不返回家具列表。需要按视角筛选家具时，在脚本局部变量中 await api.items()，依据返回的 camera、viewport 和家具 position/bounds 自行 filter，只输出少量候选。

## 编辑与回查
每次写入都是一笔可撤销的正式事务，直接生效，可用撤销恢复；编辑前旧快照先 refresh 并重新判断。
api.edit(items) → 把改过字段的家具数组写回场景。items 来自 api.items/selection/refresh，可直接改 position/rotation/scale/gameId/groupId；省略的字段保持原状。坐标与 api.items 同义：position 为世界厘米、Z 向上，rotation 为视觉角度，scale 为视觉 x/y/z。
api.place(items,schemeId?) → [{gameId,position,rotation?,scale?,groupId?}]，新增家具并返回带 ref、instanceId、bounds 的新家具数组；省略的旋转、缩放、分组使用默认值。组合家具会按目录定义展开，组合条目使用默认旋转和缩放。省略 schemeId 用本轮默认方案。
api.remove(items) → 删除给定家具数组。
api.rotate(items,{delta,pivot}) → 以世界坐标 pivot、视觉角度 delta 围绕组合旋转，一次事务。
api.translate(items,{delta}) → 按世界厘米 delta 平移，一次事务。
api.scale(items,{factors,pivot}) → 以世界坐标 pivot、视觉轴 factors 做组合缩放，一次事务。
api.duplicate(items,{offsets}) → 按多个世界坐标偏移复制家具，返回按 offset 分组的新家具数组，一次事务。
api.organize(groups,collections=[]) → 一笔可撤销的分类与编组编辑。
groups:[{name,items,collectionId?:string|null,order?}]；collections:[{id,name,parentId:string|null,order?}]。
新分类 id 为本调用自选局部名称；collectionId/parentId 可引用它或已有分类。省略 collectionId 为 null。
创建新组并重新编入指定成员，成员不可重复分配，未提及家具保持原状。
编辑前旧快照先 refresh 并重新判断。已完成编辑在脚本后续失败时仍生效；结果不明时先回查核对，再继续。
api.history({id?,offset?,limit?}) → 无 id 列执行目录；有 id 分段读取完整记录 JSON，offset/limit 为字符偏移和数量，默认 0/10000；只读取记录。
api.showImage(imageId) → 重新附上本会话的历史原图。
api.help(topic) → 读取长指南，如 api.help("guide:organization")。

## 数学与统计
api.math.groupBy<T>(values:T[],keyFn:(value:T)=>string|number) → Record<string,T[]>，按 keyFn 的返回值分组，保留原成员。
api.math.distribution(values:number[],precision=1) → {value:number,count:number}[]。
values 为有限数值；precision 为有限正数统计步长，单位与输入一致，默认 1。按 Math.round(value/precision)*precision 归类计数，按 value 升序返回。
Frame = {yaw:number,origin:Vector3}，yaw 为视觉 Z 角（度），origin 为世界坐标原点。
api.math.dominantFrame(items:Furniture[]) → Frame & {support:number}，items 非空。
将家具视觉 Z 旋转按 90°周期归一化、以 1°分箱，取最多成员的箱估计平面主轴 yaw（0≤yaw<90）；support 为该箱成员数。origin 的 x/y 为全体家具位置点包围盒中心，z 为 0。
api.math.toFrame(position:Vector3,frame:Frame) → Vector3，将世界坐标点转换为 frame 局部坐标。
api.math.fromFrame(position:Vector3,frame:Frame) → Vector3，将 frame 局部坐标点转换为世界坐标；与 toFrame 互逆。
api.math.gap(boundsA:Bounds|null,boundsB:Bounds|null) → number|null，返回保守 AABB 间的最短距离（厘米）；任一边界为 null 时返回 null，0 表示包围盒接触或重叠。

## 示例
读取完整选区到 vars，由代码统计素材构成，输出名称与数量供判断：
vars.selected=await api.selection();
const byType=api.math.groupBy(vars.selected,x=>x.gameId);
vars.types=Object.values(byType).map(items=>({gameId:items[0].gameId,name:items[0].name,count:items.length}));
console.log(vars.types);
候选组示例：已确认选区中某类楼板在指定高度范围构成屋顶，vars.roofGameId 和 vars.roofZ=[minZ,maxZ] 来自本次观察。
const [minZ,maxZ]=vars.roofZ;
vars.groups=[{name:"屋顶",items:vars.selected.filter(x=>x.gameId===vars.roofGameId && x.position.z>=minZ && x.position.z<=maxZ)}];
console.log(vars.groups.map(g=>({name:g.name,count:g.items.length})));
核验候选组后提交：await api.organize(vars.groups);
批量合图：vars.batches 为围绕待判断问题准备的 {name,items,views:[{name,camera},…]} 数组，各批选择互补视角。
const panels=vars.batches.flatMap(batch=>batch.views.map(view=>({items:batch.items,label:batch.name+" · "+view.name,camera:view.camera})));
await api.render(panels);

读取当前视口并在脚本内筛选，不把完整方案输出到上下文：
const view=await api.viewport();
const items=await api.items();
// 按 view.details.camera 和 view.details.viewport 投影筛选 items；只 console.log 少量候选。
console.log(view.details.camera, view.details.viewport, items.length);`

export const workbenchTools = {
  execute_js: {
    description: executionHelp,
    inputSchema: executeInput,
  },
} satisfies ToolSet

function readLayout(value: unknown, board = false): ImageLayout | undefined {
  if (value === undefined) return undefined
  const layout = readObject(value, ['columns', 'cellWidth', 'cellHeight'])
  for (const [key, n] of Object.entries(layout))
    if (!Number.isSafeInteger(n) || (n as number) <= (board && key === 'cellHeight' ? 32 : 0))
      throw new AiError(
        'invalid_input',
        `${board ? 'board' : 'atlas'} layout.${key} must be an integer greater than ${board && key === 'cellHeight' ? 32 : 0}`
      )
  return layout as ImageLayout
}

export function describeVariables(records: ConversationRecords) {
  return Object.fromEntries(
    Object.entries(records.variables.values).map(([name, value]) => [
      name,
      Array.isArray(value)
        ? { type: 'array', length: value.length }
        : value === null
          ? { type: 'null' }
          : { type: typeof value },
    ])
  )
}

export const TOOL_OUTPUT_BYTES = 50 * 1024
export function estimateText(text: string) {
  let units = 0
  for (const char of text) units += char.charCodeAt(0) > 127 ? 1 : 1 / 3
  return Math.ceil(units)
}
export function toolModelResult(tool: ToolRecord, maxBytes = TOOL_OUTPUT_BYTES) {
  const receipts = tool.assets.length ? { images: tool.assets } : {}
  const text = JSON.stringify({
    ...tool.result,
    recordId: tool.id,
    ...receipts,
    edits: tool.edits.map(publicEdit),
  })
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  return JSON.stringify({
    ok: tool.result?.ok,
    recordId: tool.id,
    truncated: true,
    preview: new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true }),
    totalBytes: bytes.length,
    ...receipts,
    edits: tool.edits.map(publicEdit),
    instruction:
      '输出已保存，用 api.history({id:recordId,offset,limit}) 分段读取；从已记录的编辑结果继续。',
  })
}
function publicEdit(edit: ToolRecord['edits'][number]) {
  return {
    id: edit.id,
    schemeId: edit.schemeId,
    state: edit.state,
    ...(edit.result === undefined ? {} : { result: edit.result }),
  }
}

export function createWorkbenchTools(
  records: ConversationRecords,
  repository: ConversationRepository,
  host: EditorHost,
  language: string,
  execute: ScriptExecutor = runScript,
  defaultSchemeId: string | null = host.context().schemeId
) {
  return {
    definitions: workbenchTools,
    async execute(tool: ToolRecord, signal: AbortSignal) {
      const variables = structuredClone(records.variables)
      const attachments: ImageAttachment[] = []
      const referenceKey = (r: ItemReference) => `${r.schemeId}:${r.internalId}:${r.revision}`
      const referenceIndices = new Map(variables.references.map((r, i) => [referenceKey(r), i]))
      const data = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value))
      let storageFailure: unknown
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) controller.abort()
      let accepting = true
      let tail = Promise.resolve()
      const references = (items: unknown): ItemReference[] => {
        if (!Array.isArray(items))
          throw new AiError('invalid_input', 'Expected a furniture array, e.g. vars.selected')
        const refs = items.map((item) => {
          const ref = item?.ref
          if (!Number.isSafeInteger(ref) || ref < 1 || !variables.references[ref - 1])
            throw new AiError(
              'invalid_input',
              'Use furniture returned by api.items/selection/refresh, without rebuilding objects'
            )
          return variables.references[ref - 1]!
        })
        if (new Set(refs.map((r) => `${r.schemeId}:${r.internalId}`)).size !== refs.length)
          throw new AiError('invalid_input', 'Furniture array contains duplicate members')
        return refs
      }
      const read = (schemeId: string, members?: string[]): ScriptItem[] => {
        const snapshot = host.snapshot(schemeId, members)
        const catalog = new Map(snapshot.furniture.map((f) => [f.gameId, f]))
        return snapshot.items.map(({ id, ...item }) => {
          const reference = { schemeId, internalId: id, revision: snapshot.id }
          let index = referenceIndices.get(referenceKey(reference))
          if (index === undefined) {
            index = variables.references.push(reference) - 1
            referenceIndices.set(referenceKey(reference), index)
          }
          const info = catalog.get(item.gameId)
          return {
            ...item,
            ref: index + 1,
            name: (language === 'en' ? info?.nameEn : info?.nameZh) ?? null,
          }
        })
      }
      const oneScheme = (refs: ItemReference[]) => {
        const id = refs[0]?.schemeId
        if (!id || refs.some((r) => r.schemeId !== id))
          throw new AiError('invalid_input', 'Use a nonempty set from one scheme')
        return id
      }
      const checkRevision = (refs: ItemReference[], id: string) => {
        const version = host.revision(id)
        if (refs.some((r) => r.revision !== version))
          throw new AiError(
            'stale',
            'Furniture snapshot changed. Refresh the members and reconsider the grouping before editing.'
          )
        return version
      }
      /** 所有写入共用同一套 prepared/uncertain 门禁与逐次编辑回执。 */
      const commitEdit = async (schemeId: string, command: unknown, version: string) => {
        const acknowledged = new Set(records.messages.flatMap((m) => m.acknowledges ?? []))
        if (
          records.tools.some((t) =>
            t.edits.some(
              (e) => ['prepared', 'uncertain'].includes(e.state) && !acknowledged.has(e.id)
            )
          )
        )
          throw new AiError(
            'uncertain_edit',
            'Check and acknowledge the unresolved edit before editing again'
          )
        const edit: ToolRecord['edits'][number] = {
          id: `${tool.id}:edit:${tool.edits.length}`,
          schemeId,
          state: 'prepared',
          input: command,
        }
        tool.edits.push(edit)
        try {
          await repository.save(records.conversation, [tool])
        } catch (error) {
          storageFailure = error
          edit.state = 'failed'
          throw error
        }
        let appliedEdit: ToolRecord['edits'][number]['outcome']
        try {
          assertNotAborted(controller.signal)
          const result = host.apply(schemeId, command, version)
          edit.result = result.data
          edit.outcome = result.edit
          appliedEdit = result.edit
          edit.state = result.ok ? 'succeeded' : 'failed'
        } catch (error) {
          edit.state = 'failed'
          edit.result = { error: error instanceof Error ? error.message : String(error) }
          await repository.save(records.conversation, [tool])
          throw error
        }
        try {
          await repository.save(records.conversation, [tool])
        } catch (error) {
          storageFailure = error
          edit.state = 'uncertain'
          throw error
        }
        return {
          receipt: data(publicEdit(edit)),
          itemIds: appliedEdit?.itemIds ?? [],
          itemIdGroups: appliedEdit?.itemIdGroups ?? [],
        }
      }
      const dispatch: HostCall = async (method, args) => {
        assertNotAborted(controller.signal)
        const schemeId = () =>
          readString(args[0] ?? defaultSchemeId, 'schemeId (no default scheme; call api.schemes())')
        if (method === 'schemes') return serializeData(host.schemes())
        if (method === 'help') {
          const guide = scenarioGuides.find((g) => `guide:${g.id}` === args[0])
          if (!guide)
            throw new AiError(
              'invalid_input',
              'Choose a guide topic, e.g. api.help("guide:organization"). Basic API usage is in the execute_js tool description.'
            )
          return guide.content
        }
        if (method === 'structure') return serializeData(host.structure(schemeId()))
        if (method === 'items') return serializeData(read(schemeId()))
        if (method === 'selection') {
          const id = schemeId()
          return serializeData(read(id, host.selection(id)))
        }
        if (method === 'refresh') {
          const refs = references(args[0])
          if (!refs.length) return []
          const groups = new Map<string, ItemReference[]>()
          for (const ref of refs) {
            const group = groups.get(ref.schemeId) ?? []
            group.push(ref)
            groups.set(ref.schemeId, group)
          }
          const refreshed = new Map<string, ScriptItem>()
          for (const [id, group] of groups)
            for (const item of read(
              id,
              group.map((r) => r.internalId)
            )) {
              const ref = variables.references[item.ref - 1]!
              refreshed.set(`${id}:${ref.internalId}`, item)
            }
          return serializeData(refs.map((r) => refreshed.get(`${r.schemeId}:${r.internalId}`)!))
        }
        if (method === 'render') {
          if (!Array.isArray(args[0]) || !args[0].length)
            throw new AiError(
              'invalid_input',
              'render expects a nonempty panels array, e.g. [{items:vars.selected,label:"Selection"}]'
            )
          const layout = readLayout(args[1], true)
          let scheme: string | undefined
          // Validate the entire batch before rendering its first panel.
          const panels = args[0].map((value, index) => {
            try {
              const p = readObject(value, [
                'items',
                'label',
                'kind',
                'focus',
                'camera',
                'width',
                'height',
                'color',
                'labels',
                'layout',
              ])
              const refs = references(p.items),
                id = oneScheme(refs)
              if (scheme !== undefined && scheme !== id)
                throw new AiError('invalid_input', 'All panels must use furniture from one scheme')
              scheme = id
              const label = readString(p.label, 'panel label')
              if (p.kind !== undefined && p.kind !== 'scene' && p.kind !== 'atlas')
                throw new AiError('invalid_input', 'kind must be scene or atlas')
              const kind = p.kind === 'atlas' ? ('atlas' as const) : ('scene' as const)
              if (
                kind === 'atlas' &&
                ['focus', 'camera', 'width', 'height', 'color', 'labels'].some(
                  (key) => p[key] !== undefined
                )
              )
                throw new AiError(
                  'invalid_input',
                  'atlas only accepts items, label, kind and layout'
                )
              if (kind === 'scene' && p.layout !== undefined)
                throw new AiError(
                  'invalid_input',
                  'scene does not accept panel.layout; pass the board layout as the second argument'
                )
              const atlasLayout = readLayout(p.layout)
              for (const key of ['width', 'height']) {
                const n = p[key]
                if (n !== undefined && (!Number.isSafeInteger(n) || (n as number) < 1))
                  throw new AiError('invalid_input', `${key} must be a positive integer`)
              }
              if (p.labels !== undefined && typeof p.labels !== 'boolean')
                throw new AiError('invalid_input', 'labels must be boolean')
              if (p.color !== undefined) readString(p.color, 'color')
              const camera =
                p.camera === undefined
                  ? undefined
                  : readObject(p.camera, ['azimuth', 'elevation', 'fov', 'distance', 'target'])
              if (camera) {
                for (const key of ['azimuth', 'elevation', 'fov', 'distance'])
                  if (
                    camera[key] !== undefined &&
                    (typeof camera[key] !== 'number' || !Number.isFinite(camera[key]))
                  )
                    throw new AiError('invalid_input', `camera.${key} must be finite`)
                if (
                  camera.fov !== undefined &&
                  ((camera.fov as number) <= 0 || (camera.fov as number) >= 180)
                )
                  throw new AiError('invalid_input', 'camera.fov must be between 0 and 180 degrees')
                if (camera.distance !== undefined && (camera.distance as number) <= 0)
                  throw new AiError('invalid_input', 'camera.distance must be positive')
                if (camera.target !== undefined) readVector(camera.target)
              }
              const focus = p.focus === undefined ? undefined : references(p.focus)
              if (focus && !focus.length)
                throw new AiError('invalid_input', 'focus must be nonempty when provided')
              const members = new Set(refs.map((r) => r.internalId))
              if (focus?.some((r) => r.schemeId !== id || !members.has(r.internalId)))
                throw new AiError(
                  'invalid_input',
                  'focus must be a subset of the rendered furniture'
                )
              const width = (p.width as number | undefined) ?? defaultScenePanelSize
              const height = (p.height as number | undefined) ?? defaultScenePanelSize
              const scale = Math.min(1, maxScenePanelSize / Math.max(width, height))
              return {
                label,
                kind,
                members: [...members],
                focus: focus?.map((r) => r.internalId),
                camera: camera as AnalysisCamera | undefined,
                ...(kind === 'scene'
                  ? {
                      width: Math.max(1, Math.round(width * scale)),
                      height: Math.max(1, Math.round(height * scale)),
                    }
                  : {}),
                color: p.color as string | undefined,
                labels: p.labels as boolean | undefined,
                layout: atlasLayout,
              }
            } catch (error) {
              throw new AiError(
                'invalid_input',
                `panels[${index}]: ${error instanceof Error ? error.message : String(error)}`
              )
            }
          })
          const image = await host.render(scheme!, panels, controller.signal, layout)
          assertNotAborted(controller.signal)
          const imageId = `asset:${records.conversation.id}:${crypto.randomUUID()}`
          attachments.push({
            imageId,
            blob: image.blob,
            width: image.width,
            height: image.height,
            details: { schemeId: scheme, ...image.details },
          })
          return data({ imageId, width: image.width, height: image.height, details: image.details })
        }
        if (method === 'viewport') {
          if (args.length) throw new AiError('invalid_input', 'viewport does not accept arguments')
          const id = readString(
            host.context().schemeId,
            'No active scheme; open a scheme in the editor before capturing the current viewport'
          )
          const image = await host.viewport(id, controller.signal)
          assertNotAborted(controller.signal)
          const imageId = `asset:${records.conversation.id}:${crypto.randomUUID()}`
          attachments.push({
            imageId,
            blob: image.blob,
            width: image.width,
            height: image.height,
            details: { ...image.details, schemeId: id },
          })
          return data({ imageId, width: image.width, height: image.height, details: image.details })
        }
        if (method === 'catalog') {
          const filter = args[0] === undefined ? {} : readObject(args[0], ['query', 'gameIds'])
          const queries =
            filter.query === undefined
              ? []
              : Array.isArray(filter.query)
                ? filter.query.map((query) =>
                    readString(query, 'catalog query').toLocaleLowerCase()
                  )
                : [readString(filter.query, 'catalog query').toLocaleLowerCase()]
          const gameIds =
            filter.gameIds === undefined
              ? null
              : (() => {
                  if (
                    !Array.isArray(filter.gameIds) ||
                    !filter.gameIds.every((id) => Number.isSafeInteger(id) && (id as number) > 0)
                  )
                    throw new AiError('invalid_input', 'catalog gameIds must be positive integers')
                  return new Set(filter.gameIds as number[])
                })()
          const limit = 100
          if (!queries.length && !gameIds)
            throw new AiError(
              'invalid_input',
              'catalog requires query or gameIds; for example api.catalog({query:"屋顶"})'
            )
          const matches = host.catalog().filter((entry) => {
            if (gameIds && !gameIds.has(entry.gameId)) return false
            if (!queries.length) return true
            const haystack = [entry.nameZh, entry.nameEn, entry.categoryZh, entry.categoryEn]
              .filter((value): value is string => Boolean(value))
              .map((value) => value.toLocaleLowerCase())
            return queries.some((query) => haystack.some((value) => value.includes(query)))
          })
          if (matches.length > limit)
            throw new AiError(
              'invalid_input',
              `catalog query matched ${matches.length} items; refine the query`
            )
          return serializeData(
            matches.map((entry) => ({
              gameId: entry.gameId,
              name: (language === 'en' ? entry.nameEn : entry.nameZh) ?? null,
              sizeCm: entry.sizeCm,
              scaleRange: entry.scaleRange,
              rotationAllowed: entry.rotationAllowed,
              combination: entry.combination,
            }))
          )
        }
        if (method === 'organize') {
          if (!Array.isArray(args[0]) || !args[0].length)
            throw new AiError('invalid_input', 'organize expects a nonempty groups array')
          const groups = args[0].map((value, index) => {
            const g = readObject(value, ['name', 'items', 'collectionId', 'order'])
            return { input: g, refs: references(g.items), id: `group-${index}` }
          })
          const refs = groups.flatMap((g) => g.refs),
            id = oneScheme(refs)
          const command = {
            collections: args[1] ?? [],
            groups: groups.map((g) => ({
              id: g.id,
              name: g.input.name,
              collectionId: g.input.collectionId ?? null,
              itemIds: g.refs.map((r) => r.internalId),
              ...(g.input.order === undefined ? {} : { order: g.input.order }),
            })),
          }
          return (await commitEdit(id, command, checkRevision(refs, id))).receipt
        }
        if (method === 'edit') {
          const refs = references(args[0])
          if (!refs.length)
            throw new AiError('invalid_input', 'edit expects a nonempty furniture array')
          const id = oneScheme(refs)
          const version = checkRevision(refs, id)
          const items = (args[0] as unknown as Record<string, unknown>[]).map((entry, index) => {
            try {
              return {
                itemId: refs[index]!.internalId,
                ...(entry.position !== undefined ? { position: readVector(entry.position) } : {}),
                ...(entry.rotation !== undefined ? { rotation: readVector(entry.rotation) } : {}),
                ...(entry.scale !== undefined ? { scale: readVector(entry.scale) } : {}),
                ...(entry.gameId !== undefined ? { gameId: entry.gameId } : {}),
                ...(entry.groupId !== undefined ? { groupId: entry.groupId } : {}),
              }
            } catch (error) {
              throw new AiError(
                'invalid_input',
                `items[${index}]: ${error instanceof Error ? error.message : String(error)}`
              )
            }
          })
          return (await commitEdit(id, { kind: 'edit', items }, version)).receipt
        }
        if (method === 'place') {
          if (!Array.isArray(args[0]) || !args[0].length)
            throw new AiError('invalid_input', 'place expects a nonempty items array')
          const id = readString(
            args[1] ?? defaultSchemeId,
            'schemeId (no default scheme; call api.schemes())'
          )
          const items = args[0].map((value, index) => {
            try {
              const spec = readObject(value, ['gameId', 'position', 'rotation', 'scale', 'groupId'])
              if (!Number.isSafeInteger(spec.gameId) || (spec.gameId as number) <= 0)
                throw new AiError('invalid_input', 'gameId must be a positive integer')
              return {
                gameId: spec.gameId as number,
                position: readVector(spec.position),
                ...(spec.rotation !== undefined ? { rotation: readVector(spec.rotation) } : {}),
                ...(spec.scale !== undefined ? { scale: readVector(spec.scale) } : {}),
                ...(spec.groupId !== undefined ? { groupId: spec.groupId } : {}),
              }
            } catch (error) {
              throw new AiError(
                'invalid_input',
                `items[${index}]: ${error instanceof Error ? error.message : String(error)}`
              )
            }
          })
          const committed = await commitEdit(id, { kind: 'place', items }, host.revision(id))
          return serializeData(read(id, committed.itemIds))
        }
        if (method === 'remove') {
          const refs = references(args[0])
          if (!refs.length)
            throw new AiError('invalid_input', 'remove expects a nonempty furniture array')
          const id = oneScheme(refs)
          const version = checkRevision(refs, id)
          return (
            await commitEdit(
              id,
              { kind: 'remove', itemIds: refs.map((r) => r.internalId) },
              version
            )
          ).receipt
        }
        if (method === 'rotate' || method === 'translate' || method === 'scale') {
          const refs = references(args[0])
          if (!refs.length)
            throw new AiError('invalid_input', `${method} expects a nonempty furniture array`)
          const id = oneScheme(refs)
          const options = readObject(args[1], ['delta', 'factors', 'pivot'])
          const command = {
            kind: method,
            itemIds: refs.map((r) => r.internalId),
            ...(method === 'rotate'
              ? { delta: readVector(options.delta), pivot: readVector(options.pivot) }
              : method === 'translate'
                ? { delta: readVector(options.delta) }
                : { factors: readVector(options.factors), pivot: readVector(options.pivot) }),
          }
          const version = checkRevision(refs, id)
          return (await commitEdit(id, command, version)).receipt
        }
        if (method === 'duplicate') {
          const refs = references(args[0])
          if (!refs.length)
            throw new AiError('invalid_input', 'duplicate expects a nonempty furniture array')
          const id = oneScheme(refs)
          const options = readObject(args[1], ['offsets'])
          if (!Array.isArray(options.offsets) || !options.offsets.length)
            throw new AiError('invalid_input', 'duplicate expects a nonempty offsets array')
          const offsets = options.offsets.map((offset, index) => {
            try {
              return readVector(offset)
            } catch (error) {
              throw new AiError(
                'invalid_input',
                `offsets[${index}]: ${error instanceof Error ? error.message : String(error)}`
              )
            }
          })
          const version = checkRevision(refs, id)
          const committed = await commitEdit(
            id,
            { kind: 'duplicate', itemIds: refs.map((r) => r.internalId), offsets },
            version
          )
          const groups = committed.itemIdGroups.length
            ? committed.itemIdGroups
            : [committed.itemIds]
          return serializeData(groups.map((itemIds) => read(id, itemIds)))
        }
        if (method === 'history') {
          const options =
            args[0] === undefined ? {} : readObject(args[0], ['id', 'offset', 'limit'])
          if (!options.id)
            return serializeData(
              records.tools.map((t) => ({
                id: t.id,
                state: t.state,
                edits: t.edits.map(publicEdit),
                images: t.assets,
              }))
            )
          const found = records.tools.find((t) => t.id === options.id)
          if (!found)
            throw new AiError('invalid_input', 'Unknown execution ID in this conversation')
          const offset = options.offset ?? 0,
            limit = options.limit ?? 10000
          if (
            !Number.isSafeInteger(offset) ||
            (offset as number) < 0 ||
            !Number.isSafeInteger(limit) ||
            (limit as number) < 1
          )
            throw new AiError(
              'invalid_input',
              'offset/limit must be nonnegative/positive integers (characters)'
            )
          const text = JSON.stringify({
            code: found.input,
            result: found.result,
            edits: found.edits.map(publicEdit),
            images: found.assets,
          })
          return {
            text: text.slice(offset as number, (offset as number) + (limit as number)),
            total: text.length,
            nextOffset:
              (offset as number) + (limit as number) < text.length
                ? (offset as number) + (limit as number)
                : null,
          }
        }
        if (method === 'showImage') {
          const asset = await repository.read<import('./types').AssetRecord>(
            readString(args[0], 'imageId')
          )
          if (!asset || asset.conversationId !== records.conversation.id)
            throw new AiError('invalid_input', 'Unknown image in this conversation')
          attachments.push({
            imageId: asset.id,
            blob: asset.blob,
            width: asset.width,
            height: asset.height,
            details: asset.details,
          })
          return { imageId: asset.id, width: asset.width, height: asset.height }
        }
        throw new AiError('invalid_input', `Unknown API method: ${method}`)
      }
      const call: HostCall = (method, args) => {
        if (!accepting) return Promise.reject(new AiError('cancelled'))
        const pending = tail.then(() => dispatch(method, args))
        tail = pending.then(
          () => {},
          () => {}
        )
        return pending
      }
      try {
        const result = await execute(
          readString((tool.input as { code: string }).code, 'code'),
          variables.values,
          call,
          controller.signal
        )
        accepting = false
        if (!result.ok) controller.abort()
        await tail
        if (storageFailure) throw storageFailure
        if (result.ok) {
          assertNotAborted(controller.signal)
          variables.values = result.values!
        }
        return {
          ok: result.ok,
          data: {
            logs: result.logs,
            ...(result.result === undefined ? {} : { result: result.result }),
            variables: describeVariables(result.ok ? { ...records, variables } : records),
          },
          error: result.error,
          attachments,
          ...(result.ok ? { variables } : {}),
        }
      } finally {
        accepting = false
        controller.abort()
        await tail
        signal.removeEventListener('abort', abort)
      }
    },
  }
}
