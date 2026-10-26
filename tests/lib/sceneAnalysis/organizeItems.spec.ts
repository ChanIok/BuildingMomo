import { expect, it } from 'vitest'
import { readOrganizeItems } from '@/lib/sceneAnalysis/organizeItems'
import { analysisSnapshot, organizationCommand } from '../../fixtures/sceneAnalysis'

function scope() {
  const snapshot = analysisSnapshot()
  return { itemIds: snapshot.items.map((item) => item.id), collections: snapshot.collections }
}

it('validates a detached incremental command, allowing single-member groups and unmentioned items', () => {
  const command = organizationCommand()
  command.groups[0]!.itemIds = ['a']
  const parsed = readOrganizeItems(scope(), command)
  command.groups[0]!.name = 'Changed caller'
  expect(parsed.groups[0]).toMatchObject({ name: 'Floor assembly', itemIds: ['a'], order: 0 })
  expect(Object.isFrozen(parsed.groups[0]!.itemIds)).toBe(true)
  expect(parsed).not.toHaveProperty('unchangedItemIds')
})

it('allows groups and new descendants under existing scoped collection ancestors', () => {
  expect(
    readOrganizeItems(scope(), {
      collections: [],
      groups: [{ id: 'one', name: 'One', collectionId: 'room', itemIds: ['a'] }],
    }).groups[0]?.collectionId
  ).toBe('room')
  const command = organizationCommand()
  expect(
    readOrganizeItems(scope(), {
      ...command,
      collections: command.collections.map((node) => ({ ...node, parentId: 'room' })),
    }).collections[0]?.parentId
  ).toBe('room')
})

it('rejects duplicate, out-of-scope and empty members before any edit', () => {
  const group = organizationCommand().groups[0]!
  for (const groups of [
    [],
    [{ ...group, itemIds: [] }],
    [{ ...group, itemIds: ['a', 'a'] }],
    [{ ...group, itemIds: ['outside'] }],
    [group, { ...group, id: 'other' }],
    [group, group],
  ]) {
    expect(() => readOrganizeItems(scope(), { ...organizationCommand(), groups })).toThrow()
  }
})

it('rejects cycles, missing or outside parents, unused folders, duplicate IDs, invalid order and old proposal fields', () => {
  const snapshot = analysisSnapshot(),
    command = organizationCommand(),
    node = command.collections[0]!
  for (const collections of [
    [{ ...node, parentId: node.id }],
    [{ ...node, parentId: 'missing' }],
    [{ ...node, parentId: 'private' }],
    [node, node],
    [{ ...node, order: Infinity }],
    [{ ...node, id: 'room' }],
    [node, { ...node, id: 'unused' }],
  ])
    expect(() =>
      readOrganizeItems(
        { itemIds: snapshot.items.map((item) => item.id), collections: snapshot.collections },
        { ...command, collections }
      )
    ).toThrow()
  expect(() =>
    readOrganizeItems(
      { itemIds: snapshot.items.map((item) => item.id), collections: snapshot.collections },
      { ...command, groups: [{ ...command.groups[0], order: NaN }] }
    )
  ).toThrow()
  expect(() =>
    readOrganizeItems(
      { itemIds: snapshot.items.map((item) => item.id), collections: snapshot.collections },
      { ...command, unchangedItemIds: ['c'] }
    )
  ).toThrow(/Unknown/)
  expect(() =>
    readOrganizeItems(
      { itemIds: snapshot.items.map((item) => item.id), collections: snapshot.collections },
      { ...command, groups: [{ ...command.groups[0], reason: 'Unused field' }] }
    )
  ).toThrow(/Unknown/)
})
