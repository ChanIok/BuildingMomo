import { describe, expect, it } from 'vitest'
import {
  buildSchemeHistoryFile,
  parseSchemeHistoryFile,
  schemeHistoryFileName,
  selectSchemeHistoryToPrune,
} from '@/lib/schemeHistory'
import { SCHEME_HISTORY_VERSION } from '@/types/schemeHistory'
import type { AppItem } from '@/types/editor'

const DAY = 24 * 60 * 60 * 1000

function buildFile(overrides: Record<string, unknown> = {}) {
  return buildSchemeHistoryFile(
    {
      schemeId: 'scheme-1',
      source: 'local',
      name: '测试方案',
      items: [] as AppItem[],
      groupOrigins: new Map([
        [1, 'a'],
        [2, 'b'],
      ]),
    },
    1_700_000_000_000
  )
}

describe('schemeHistoryFileName', () => {
  it('同一 id 恒定映射到同一文件名', () => {
    const id = '3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071'
    expect(schemeHistoryFileName(id)).toBe(schemeHistoryFileName(id))
    expect(schemeHistoryFileName(id)).toBe(`${id}.json`)
  })

  it('冒号等 Windows 非法字符被替换掉（id 形态变化时的防御）', () => {
    expect(schemeHistoryFileName('archive:0f9e-1234')).toBe('archive_0f9e-1234.json')
    expect(schemeHistoryFileName('room:ABCD')).toBe('room_ABCD.json')
  })

  it('去掉首尾的点与空格，避免隐藏文件与 Windows 结尾限制', () => {
    expect(schemeHistoryFileName('..abc.')).toBe('abc.json')
    // 空格不属于白名单，先被替换成下划线，因此不会再触发首尾裁剪
    expect(schemeHistoryFileName('  abc  ')).toBe('__abc__.json')
    expect(schemeHistoryFileName('...')).toBe('scheme.json')
  })

  it('超长 id 被截断到 64 字符', () => {
    const name = schemeHistoryFileName('a'.repeat(200))
    expect(name).toBe(`${'a'.repeat(64)}.json`)
  })

  it('不同 id 不会碰撞到同一文件名', () => {
    const ids = ['a-b', 'a/b', 'a:b', 'a.b']
    const names = new Set(ids.map(schemeHistoryFileName))
    expect(names.size).toBeGreaterThan(1)
  })
})

describe('方案历史文件序列化', () => {
  it('往返不丢 groupOrigins（Map 存为条目数组）', () => {
    const file = buildFile()
    const parsed = parseSchemeHistoryFile(JSON.parse(JSON.stringify(file)))

    expect(parsed).not.toBeNull()
    expect(parsed!.schemeId).toBe('scheme-1')
    expect(parsed!.name).toBe('测试方案')
    expect(parsed!.updatedAt).toBe(1_700_000_000_000)
    expect(parsed!.groupOrigins).toEqual([
      [1, 'a'],
      [2, 'b'],
    ])
    expect(new Map(parsed!.groupOrigins).get(2)).toBe('b')
  })

  it('版本不匹配时拒绝解析', () => {
    const raw = { ...buildFile(), version: SCHEME_HISTORY_VERSION + 1 }
    expect(parseSchemeHistoryFile(raw)).toBeNull()
  })

  it('缺少 schemeId 或 items 结构非法时拒绝解析', () => {
    expect(parseSchemeHistoryFile({ ...buildFile(), schemeId: '' })).toBeNull()
    expect(parseSchemeHistoryFile({ ...buildFile(), items: undefined })).toBeNull()
    expect(parseSchemeHistoryFile(null)).toBeNull()
    expect(parseSchemeHistoryFile('not-an-object')).toBeNull()
  })
})

describe('selectSchemeHistoryToPrune', () => {
  const now = 1_700_000_000_000

  it('超出条数上限时淘汰最旧的', () => {
    const candidates = [
      { fileName: 'old.json', updatedAt: now - 3 * DAY },
      { fileName: 'mid.json', updatedAt: now - 2 * DAY },
      { fileName: 'new.json', updatedAt: now - 1 * DAY },
    ]

    expect(
      selectSchemeHistoryToPrune(candidates, now, { maxCount: 2, maxAgeMs: 90 * DAY })
    ).toEqual(['old.json'])
  })

  it('超出保留期限的一律淘汰，即使条数未达上限', () => {
    const candidates = [
      { fileName: 'ancient.json', updatedAt: now - 100 * DAY },
      { fileName: 'fresh.json', updatedAt: now - DAY },
    ]

    expect(
      selectSchemeHistoryToPrune(candidates, now, { maxCount: 100, maxAgeMs: 90 * DAY })
    ).toEqual(['ancient.json'])
  })

  it('都在限制内时不淘汰任何文件', () => {
    const candidates = [
      { fileName: 'a.json', updatedAt: now - DAY },
      { fileName: 'b.json', updatedAt: now - 2 * DAY },
    ]

    expect(
      selectSchemeHistoryToPrune(candidates, now, { maxCount: 100, maxAgeMs: 90 * DAY })
    ).toEqual([])
  })

  it('不修改传入的数组', () => {
    const candidates = [
      { fileName: 'a.json', updatedAt: now - DAY },
      { fileName: 'b.json', updatedAt: now - 2 * DAY },
    ]
    const snapshot = candidates.map((item) => ({ ...item }))

    selectSchemeHistoryToPrune(candidates, now, { maxCount: 100, maxAgeMs: 90 * DAY })

    expect(candidates).toEqual(snapshot)
  })
})
