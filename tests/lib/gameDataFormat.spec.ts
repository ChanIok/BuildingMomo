import { describe, expect, it } from 'vitest'
import {
  parseGameDataContent,
  serializeBuildData,
  serializeBuildRecord,
} from '@/lib/gameDataFormat'
import {
  EMPTY_SNAPSHOTS_JSON,
  INVALID_JSON,
  LEGACY_OBJECT_COLORMAP_JSON,
  LEGACY_PLACE_INFO_JSON,
  NEW_BUILD_RECORD_JSON,
  NEW_SNAPSHOTS_JSON,
  PARTIAL_ITEM_JSON,
  UNKNOWN_ROOT_JSON,
} from '../fixtures/gameJson'

describe('parseGameDataContent', () => {
  it('旧版 PlaceInfo 与新版 Snapshots、BuildRecord 解析出同一批家具', () => {
    const legacy = parseGameDataContent(LEGACY_PLACE_INFO_JSON)
    const snapshots = parseGameDataContent(NEW_SNAPSHOTS_JSON)
    const record = parseGameDataContent(NEW_BUILD_RECORD_JSON)

    expect(legacy.items).toHaveLength(2)
    expect(snapshots.items).toEqual(legacy.items)
    expect(record.items).toEqual(legacy.items)
  })

  it('提取方案名与 NeedRestore', () => {
    expect(parseGameDataContent(LEGACY_PLACE_INFO_JSON).name).toBe('旧版方案')
    expect(parseGameDataContent(NEW_SNAPSHOTS_JSON).name).toBe('新版方案')
    expect(parseGameDataContent(NEW_SNAPSHOTS_JSON).needRestore).toBe(true)
  })

  it('新版 Snapshots 语义：rotation.x=Pitch、y=Yaw、z=Roll', () => {
    const [item] = parseGameDataContent(NEW_SNAPSHOTS_JSON).items
    expect(item!.Rotation).toEqual({ Pitch: 10, Yaw: 90, Roll: -5 })
    expect(item!.Location).toEqual({ X: 100, Y: 200, Z: 30 })
    expect(item!.Scale).toEqual({ X: 1, Y: 2, Z: 1.5 })
    expect(item!.GroupID).toBe(3)
    expect(item!.AttachID).toBe(7)
  })

  it('extra 中的未知字段原样透传，不会在解析时丢失', () => {
    const [, second] = parseGameDataContent(LEGACY_PLACE_INFO_JSON).items
    expect(second!.TempInfo).toEqual({ custom: 'keep-me', nested: { a: 1 } })
  })

  it('ColorMap 对象格式原样保留，导出时才扁平化为数组', () => {
    const asObject = parseGameDataContent(LEGACY_OBJECT_COLORMAP_JSON).items[0]
    expect(asObject!.ColorMap).toEqual({ '0': 12, '1': 34 })

    const [exported] = JSON.parse(serializeBuildRecord([asObject!]))
    expect(exported.furnitureInfo.colors).toEqual([12, 34])
  })

  it('游戏写出的空对象 Snapshots 解析为空数组', () => {
    expect(parseGameDataContent(EMPTY_SNAPSHOTS_JSON).items).toEqual([])
  })

  it('缺失字段回退到默认值而不是崩溃', () => {
    const [item] = parseGameDataContent(PARTIAL_ITEM_JSON).items
    expect(item!.Location).toEqual({ X: 0, Y: 0, Z: 0 })
    expect(item!.Rotation).toEqual({ Pitch: 0, Yaw: 0, Roll: 0 })
    expect(item!.Scale).toEqual({ X: 1, Y: 1, Z: 1 })
    expect(item!.GroupID).toBe(0)
    expect(item!.ColorMap).toBeUndefined()
  })

  it('丢弃 ItemID 或 InstanceID 非法的条目', () => {
    const content = JSON.stringify({ PlaceInfo: [{ ItemID: 'x', InstanceID: 1 }, { ...{} }] })
    expect(parseGameDataContent(content).items).toEqual([])
  })

  it('结构非法时抛出可读错误', () => {
    expect(() => parseGameDataContent(INVALID_JSON)).toThrow(/Invalid JSON format/)
    expect(() => parseGameDataContent(UNKNOWN_ROOT_JSON)).toThrow(/Snapshots or PlaceInfo/)
    // 根数组非空但没有任何合法条目，说明给错了文件而不是方案为空。
    expect(() => parseGameDataContent('[{ "junk": 1 }]')).toThrow(/no valid snapshots/)
  })

  it('空根数组视为空方案而不是错误', () => {
    expect(parseGameDataContent('[]').items).toEqual([])
  })
})

describe('序列化往返', () => {
  it('parse → serializeBuildData → parse 后数据不变', () => {
    for (const content of [LEGACY_PLACE_INFO_JSON, NEW_SNAPSHOTS_JSON, NEW_BUILD_RECORD_JSON]) {
      const first = parseGameDataContent(content)
      const second = parseGameDataContent(serializeBuildData(first.items))
      expect(second.items).toEqual(first.items)
    }
  })

  it('parse → serializeBuildRecord → parse 后数据不变', () => {
    const first = parseGameDataContent(LEGACY_PLACE_INFO_JSON)
    const second = parseGameDataContent(serializeBuildRecord(first.items))
    expect(second.items).toEqual(first.items)
  })

  it('BuildData 写出 NeedRestore 与 Snapshots 根结构', () => {
    const parsed = parseGameDataContent(
      serializeBuildData(parseGameDataContent(NEW_SNAPSHOTS_JSON).items)
    )
    expect(parsed.items).toHaveLength(2)
  })

  it('无有效染色时统一写成 [0]，不保留对象格式', () => {
    const serialized = serializeBuildRecord(parseGameDataContent(PARTIAL_ITEM_JSON).items)
    expect(JSON.parse(serialized)[0].furnitureInfo.colors).toEqual([0])
  })

  it('导出时把 ColorMap 拆成 colors 数组，且不写入顶层 ColorMap', () => {
    const serialized = serializeBuildRecord(parseGameDataContent(LEGACY_PLACE_INFO_JSON).items)
    const [first] = JSON.parse(serialized)

    expect(first.furnitureInfo.colors).toEqual([12, 34])
    expect(first).not.toHaveProperty('ColorMap')
    // 未知字段必须回到 extra，否则重新导入会丢数据。
    expect(JSON.parse(serialized)[1].extra.TempInfo).toEqual({
      custom: 'keep-me',
      nested: { a: 1 },
    })
  })
})
