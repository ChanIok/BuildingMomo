import { z } from 'zod'

const text = z.string().min(1).regex(/\S/)
const positiveInteger = z.number().int().min(1)

// Field structure is sent to models; refinements run locally through the SDK.
export const organizationInput = z.strictObject({
  collections: z
    .array(
      z.strictObject({
        id: text
          .max(100)
          .describe(
            '本计划内唯一的集合 ID，供 parentId/collectionId 引用；不得与已有集合 ID 冲突。'
          ),
        name: text.max(200).describe('玩家可读的集合名称。'),
        parentId: text
          .max(100)
          .nullable()
          .describe('父集合 ID，可引用本计划或已有集合；顶层必须传 null。'),
        order: z.number().optional().describe('排序值；省略时按数组顺序。'),
      })
    )
    .describe('本次新建的集合；无新集合时传 []。未提及的已有组织保持原状。'),
  groups: z
    .array(
      z.strictObject({
        id: text.max(100).describe('本计划内唯一的家具组 ID。'),
        name: text.max(200).describe('玩家可读的家具组名称，体现局部搭建单元。'),
        collectionId: text
          .max(100)
          .nullable()
          .describe('所属集合 ID，可引用本计划或已有集合；不属于集合时必须传 null。'),
        ref: text.describe(
          '工具已返回的当前精确成员集合引用，例如 R2；不填 InstanceID 数组或素材 ID。'
        ),
        order: z.number().optional().describe('排序值；省略时按数组顺序。'),
      })
    )
    .min(1)
    .describe('本次创建或重新整理的家具组，至少一组；每组非空，组间成员不能重复。'),
})

export const inspectInput = z.strictObject({
  ref: text.describe(
    '必填。selection 捕获即时选区；api 返回计算文档；guide:ID 返回内置场景指南全文；history 列出消息和资料；R数字读取已返回资料；M数字或操作 recordId 回查记录。文档入口填在 ref，不是 mode。'
  ),
  mode: z
    .enum(['overview', 'types', 'items', 'collections', 'content', 'source'])
    .optional()
    .describe(
      '省略为 overview 概况。集合用 types 读素材数量、items 读实例、collections 读集合/家具组；content 读资料 JSON，source 读生成代码。计算文档请调用 inspect({"ref":"api"})。'
    ),
  fields: z
    .array(z.enum(['position', 'rotation', 'scale', 'bounds']))
    .refine((values) => new Set(values).size === values.length, '不能包含重复字段。')
    .optional()
    .describe(
      '仅在 mode=items 时选择实例附加字段；省略为 ["position"]，身份字段始终返回。显示数值会舍入，精确分析使用 compute。'
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('从 0 开始的偏移；列表按行，content/source 和历史记录按字符。省略为 0。'),
  limit: positiveInteger
    .optional()
    .describe('本次最多读取的行数或字符数，单位同 offset；省略读取剩余全部。'),
})

export const computeInput = z.strictObject({
  inputs: z
    .object({})
    .catchall(text.describe('工具已返回的资料引用，例如 R1。'))
    .describe(
      '必填，即使无输入也传 {}。键为自选名称，值为已返回的集合/表格/报告/计划引用；如 {"items":"R1"} 在代码中通过 input.items 读取。图片、场景指南和 selection/api/history 不能作为计算输入。'
    )
    .superRefine((inputs, ctx) => {
      for (const key of Object.keys(inputs)) {
        if (
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
          ['__proto__', 'constructor', 'prototype'].includes(key)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: '输入名称必须是合法变量名，且不能使用 __proto__、constructor 或 prototype。',
          })
        }
      }
    }),
  code: text.describe(
    "同步 JS 函数体；可用对象为 input、api、publish。通过 input.<键名> 读取输入，通过 publish 方法的 (label, value) 两个参数发布结果；普通 return 不发布。最小代码：publish.report('数量', input.items.length)。"
  ),
})

export const renderInput = z.strictObject({
  panels: z
    .array(
      z.strictObject({
        ref: text.describe('工具已返回的显示成员集合引用。'),
        label: text.describe('面板标题，说明观察对象或视角。'),
        kind: z
          .enum(['scene', 'atlas'])
          .optional()
          .describe(
            '省略为 scene 场景；atlas 为该集合全部素材的原始图标图册。atlas 只使用 ref/label/kind/layout。'
          ),
        focus: text
          .optional()
          .describe(
            '仅 scene：用于自动取景的非空子集引用，必须包含于 ref；其余成员仍显示。省略对全部成员取景。'
          ),
        camera: z
          .strictObject({
            azimuth: z
              .number()
              .optional()
              .describe('方位角，度；0 从世界 +X 看，90 从 +Y 看，省略为 45。'),
            elevation: z.number().optional().describe('相对世界 XY 平面的仰角，度；省略为 25。'),
            fov: z
              .number()
              .gt(0)
              .lt(180)
              .optional()
              .describe('透视垂直视场角，度，大于 0 小于 180；省略为 45。'),
            distance: z
              .number()
              .gt(0)
              .optional()
              .describe('相机距离，世界厘米；省略时自动容纳 focus 或全部成员。'),
            target: z
              .strictObject({
                x: z.number().describe('世界 X，厘米。'),
                y: z.number().describe('世界 Y，厘米。'),
                z: z.number().describe('世界 Z，厘米，向上。'),
              })
              .optional()
              .describe('世界坐标瞄准点；省略时按取景成员自动确定。'),
          })
          .optional()
          .describe('仅 scene：透视相机，可只指定部分参数。世界 Z 向上。'),
        width: positiveInteger.optional().describe('仅 scene：单幅宽度，像素；省略为 1024。'),
        height: positiveInteger.optional().describe('仅 scene：单幅高度，像素；省略为 1024。'),
        layout: z
          .strictObject({
            columns: positiveInteger.optional().describe('图册列数；省略为 4。'),
            cellWidth: positiveInteger.optional().describe('图册单元格宽度，像素；省略为 240。'),
            cellHeight: positiveInteger.optional().describe('图册单元格高度，像素；省略为 232。'),
          })
          .optional()
          .describe('仅 atlas：素材图标网格；scene 面板不使用此字段，面板拼图用外层 layout。'),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional()
          .describe('仅 scene：统一染色，格式 #RRGGBB，例如 #FF8800。'),
        labels: z
          .union([z.boolean(), text])
          .optional()
          .describe(
            '仅 scene：true 标出全部 InstanceID，false 不标；也可传子集引用只标该部分，子集必须包含于 ref。'
          ),
      })
    )
    .min(1)
    .describe('按顺序生成的面板。'),
  layout: z
    .strictObject({
      columns: positiveInteger.optional().describe('拼图列数；省略时按面板数量自动安排。'),
      cellWidth: positiveInteger
        .optional()
        .describe('拼图单元格宽度，像素；省略时采用最大原图宽度。'),
      cellHeight: z
        .number()
        .int()
        .min(33)
        .optional()
        .describe('拼图单元格高度，像素，含 32px 标题，至少 33；省略为最大原图高度加 32。'),
    })
    .optional()
    .describe('多面板拼图的列数和单元格尺寸；与 atlas 内部素材网格独立。省略时保留原图尺寸。'),
})

export const applyInput = z
  .strictObject({
    plan: text
      .optional()
      .describe('compute 通过 publish.plan 发布的计划引用。传此字段时不传 collections/groups。'),
    collections: organizationInput.shape.collections.optional(),
    groups: organizationInput.shape.groups.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.plan !== undefined) {
      if (value.collections !== undefined || value.groups !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['plan'],
          message: 'plan 与 collections/groups 不能同时传入。',
        })
      }
    } else {
      for (const field of ['collections', 'groups'] as const) {
        if (value[field] === undefined)
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: '缺少必填字段；请传 plan，或同时传 collections 和 groups。',
          })
      }
    }
  })
  .describe(
    '两种形式二选一：{plan:"R3"}，或 {collections:[],groups:[{id:"desk",name:"茶案与陈设",collectionId:null,ref:"R2"}]}。'
  )
