/**
 * 游戏存档样例。
 *
 * 覆盖三种真实存在的结构：
 * - 旧版 PlaceInfo（扁平条目，ColorMap 可为对象或数组）
 * - 新版 Snapshots（嵌套 furnitureInfo.trans）
 * - 新版 BuildRecord（根数组）
 *
 * 前三份样例描述同一批家具，用于验证「新旧格式解析结果一致」。
 */

const ITEM_A = {
  ItemID: 1170000010,
  InstanceID: 1001,
  Location: { X: 100, Y: 200, Z: 30 },
  Rotation: { Pitch: 10, Yaw: 90, Roll: -5 },
  Scale: { X: 1, Y: 2, Z: 1.5 },
  GroupID: 3,
  AttachID: 7,
  ColorMap: [12, 34],
}

const ITEM_B = {
  ItemID: 1170000618,
  InstanceID: 1002,
  Location: { X: -50, Y: 0, Z: 0 },
  Rotation: { Pitch: 0, Yaw: 0, Roll: 0 },
  Scale: { X: 1, Y: 1, Z: 1 },
  GroupID: 0,
  AttachID: 0,
  ColorMap: [0],
  TempInfo: { custom: 'keep-me', nested: { a: 1 } },
}

/** 旧版扁平结构。 */
export const LEGACY_PLACE_INFO_JSON = JSON.stringify({
  Name: '旧版方案',
  NeedRestore: true,
  PlaceInfo: [ITEM_A, ITEM_B],
})

/** 与 LEGACY_PLACE_INFO_JSON 等价的新版 Snapshots 结构。 */
export const NEW_SNAPSHOTS_JSON = JSON.stringify({
  Name: '新版方案',
  NeedRestore: true,
  Snapshots: [
    {
      bIsAdd: false,
      instanceID: ITEM_A.InstanceID,
      furnitureInfo: {
        group_id: ITEM_A.GroupID,
        trans: {
          rotation: { y: ITEM_A.Rotation.Yaw, x: ITEM_A.Rotation.Pitch, z: ITEM_A.Rotation.Roll },
          position: { y: ITEM_A.Location.Y, x: ITEM_A.Location.X, z: ITEM_A.Location.Z },
          scale: { y: ITEM_A.Scale.Y, x: ITEM_A.Scale.X, z: ITEM_A.Scale.Z },
        },
        colors: ITEM_A.ColorMap,
        cfg_item_id: ITEM_A.ItemID,
        attach_id: ITEM_A.AttachID,
      },
      extra: {},
    },
    {
      bIsAdd: false,
      instanceID: ITEM_B.InstanceID,
      furnitureInfo: {
        group_id: ITEM_B.GroupID,
        trans: {
          rotation: { y: ITEM_B.Rotation.Yaw, x: ITEM_B.Rotation.Pitch, z: ITEM_B.Rotation.Roll },
          position: { y: ITEM_B.Location.Y, x: ITEM_B.Location.X, z: ITEM_B.Location.Z },
          scale: { y: ITEM_B.Scale.Y, x: ITEM_B.Scale.X, z: ITEM_B.Scale.Z },
        },
        colors: [0],
        cfg_item_id: ITEM_B.ItemID,
        attach_id: ITEM_B.AttachID,
      },
      extra: { TempInfo: ITEM_B.TempInfo },
    },
  ],
})

/** 新版 BuildRecord 根数组（与 Snapshots 内容相同，只是没有外层包装）。 */
export const NEW_BUILD_RECORD_JSON = JSON.stringify(
  (JSON.parse(NEW_SNAPSHOTS_JSON) as { Snapshots: unknown[] }).Snapshots
)

/** 旧版 ColorMap 对象格式。 */
export const LEGACY_OBJECT_COLORMAP_JSON = JSON.stringify({
  PlaceInfo: [{ ...ITEM_A, ColorMap: { '0': 12, '1': 34 } }],
})

/** 游戏在没有建造数据时会写出空对象而不是空数组。 */
export const EMPTY_SNAPSHOTS_JSON = JSON.stringify({ NeedRestore: true, Snapshots: {} })

/** 缺字段的脏数据：应回退到默认值而不是崩溃。 */
export const PARTIAL_ITEM_JSON = JSON.stringify({
  PlaceInfo: [{ ItemID: 1170000010, InstanceID: 1001 }],
})

export const INVALID_JSON = '{ not json'

export const UNKNOWN_ROOT_JSON = JSON.stringify({ SomethingElse: [] })
