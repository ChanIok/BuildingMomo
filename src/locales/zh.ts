export const zhLocale = {
  // 方案相关
  scheme: {
    defaultName: '方案 {n}',
    unnamed: '未命名方案',
    title: '方案设置',
    description: '修改当前方案的标签名称和文件名称。',
    nameLabel: '标签名称',
    namePlaceholder: '例如：方案 1',
    fileLabel: '文件名称',
    filePlaceholder: '例如：BUILD_SAVEDATA_123.json',
    tipsTitle: '提示：',
    tips: {
      name: '标签名称：显示在顶部标签页。',
      file: '文件名称：显示在左下角，且作为导出时的默认文件名。',
    },
    toast: {
      nameRequired: '标签名称不能为空',
      fileRequired: '文件名称不能为空',
      success: '方案信息已更新',
    },
  },

  // 坐标系设置
  coordinate: {
    title: '工作坐标系设置',
    description: '设置工作坐标系的旋转角度，0° 即为全局坐标系。',
    globalLabel: '全局坐标系 0°',
    workingLabel: '工作坐标系 {angle}°',
    rotationLabel: '旋转角度',
    unit: '度',
  },

  // 欢迎屏幕
  welcome: {
    title: '搬砖吧大喵',
    subtitle: '《无限暖暖》家园方案可视化编辑工具',
    features: ['快速移动/复制/删除大型建筑群', '在不同家园方案间自由合并建筑群', '可视化编辑坐标'],
    mobileOnly: {
      title: '仅支持电脑端',
      desc: '本工具用于编辑本地游戏文件',
    },
    selectGameDir: '选择游戏目录',
    selectGameDirDesc: '自动检测建造数据更新',
    importData: '导入建造数据',
    importDataDesc: '手动选择建造数据文件',
    notSupported: '您的浏览器不支持此功能',
    safety: '使用前请阅读安全须知',
    riskDisclaimer: '仅供学习交流，风险自负',
    processLocal: '文件将在本地处理，首次使用可阅读',
    helpDoc: '帮助文档',
    credit: '物品数据与图标服务由',
    creditLink: 'NUAN5.PRO',
    creditPowered: '强力驱动',
    github: 'GitHub 仓库',
    spinningMomo: '旋转吧大喵',
  },

  // 工具栏菜单
  menu: {
    file: '文件',
    edit: '编辑',
    view: '视图',
    help: '帮助',
  },

  // 命令标签
  command: {
    file: {
      new: '新建空白方案',
      startWatchMode: '选择游戏目录',
      stopWatchMode: '停止监控',
      import: '导入建造数据',
      export: '导出建造数据',
      saveToGame: '保存到游戏',
    },
    edit: {
      undo: '撤销',
      redo: '重做',
      cut: '剪切',
      copy: '复制',
      paste: '粘贴',
      delete: '删除',
      selectAll: '全选',
      deselectAll: '取消选择',
      invertSelection: '反选',
      group: '成组',
      ungroup: '取消组合',
      move: '移动',
    },
    view: {
      zoomIn: '放大',
      zoomOut: '缩小',
      fitToView: '重置视图',
      focusSelection: '聚焦选中物品',
      coordinateSystem: '工作坐标系设置',
      setViewPerspective: '透视视图',
      setViewTop: '顶视图',
      setViewBottom: '底视图',
      setViewFront: '前视图',
      setViewBack: '后视图',
      setViewRight: '右侧视图',
      setViewLeft: '左侧视图',
      viewPreset: '视图预设',
    },
    tool: {
      select: '选择工具',
      hand: '拖拽工具',
      toggleGizmo: '切换变换轴显示',
    },
    help: {
      openDocs: '打开帮助文档',
    },
  },

  // 快捷键提示
  shortcut: {
    ctrl: 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    space: 'Space',
    delete: 'Delete',
    escape: 'Esc',
    f1: 'F1',
  },

  // 文档
  doc: {
    title: '搬砖吧大喵 文档',
    subtitle: '使用指南与帮助',
    quickstart: '快速上手',
    guide: '使用指南',
    faq: '常见问题',
    github: 'GitHub 仓库',
  },

  // 文件操作和监控
  fileOps: {
    duplicate: {
      title: '重复物品',
      desc: '检测到 {n} 个重复物品。',
      detail: '这些物品的位置、旋转和缩放完全相同，会在游戏中完全重叠，可能不是您期望的摆放效果。',
    },
    limit: {
      title: '限制自动处理',
      desc: '保存时将自动修复以下问题：',
      outOfBounds: '{n} 个物品超出可建造区域 (将被移除)',
      oversized: '{n} 个组合超过 50 个物品上限 (将被解组)',
    },
    save: {
      confirmTitle: '保存确认',
      confirmDesc: '检测到以下问题，请确认是否继续保存？',
      continue: '继续保存',
    },
    import: {
      success: '导入成功',
      failed: '导入失败: {reason}',
      readFailed: '文件读取失败',
    },
    export: {
      noData: '没有可导出的数据',
    },
    saveToGame: {
      noDir: '请先连接游戏目录',
      noData: '没有可保存的数据',
      noPermission: '没有文件写入权限',
      success: '保存成功！',
      failed: '保存失败: {reason}',
    },
    watch: {
      notSupported: '您的浏览器不支持文件系统访问功能，请使用最新版本的 Chrome 或 Edge 浏览器',
      noBuildData:
        '未找到 BuildData 目录，请确保选择的是游戏目录的任意位置（InfinityNikki\\X6Game\\Saved\\SavedData\\BuildData）',
      foundTitle: '找到存档文件',
      foundDesc: '文件：{name}\n最后修改时间：{time}\n\n是否立即导入？',
      importNow: '立即导入',
      later: '稍后',
      started: '监控已启动，等待游戏导出建造数据',
      parseFailed: '监控已启动，找到存档文件但无法解析',
      startFailed: '启动监控失败: {reason}',
    },
    importWatched: {
      notStarted: '监控模式未启动',
      notFound: '未找到 BUILD_SAVEDATA_*.json 文件',
    },
  },

  // 错误和通知
  notification: {
    furnitureDataLoadFailed: '家具数据加载失败，部分功能可能不可用',
    fileUpdate: {
      title: '检测到文件更新',
      desc: '文件 {name} 已更新，最后修改时间：{time}。\n\n是否立即导入最新数据？',
      confirm: '立即导入',
      cancel: '稍后',
    },
    success: '成功',
    error: '错误',
    warning: '警告',
    info: '信息',
  },

  // 设置
  settings: {
    title: '设置',
    description: '配置应用的显示选项和编辑设置',
    language: '语言',
    languageHint: '切换界面语言，重载 UI 文案与文档',
    furnitureTooltip: {
      label: '家具名称提示',
      hint: '鼠标悬停在物品上时显示名称和图标',
    },
    background: {
      label: '家园背景图',
      hint: '在画布上显示参考背景图',
    },
    editAssist: '编辑辅助',
    duplicateDetection: {
      label: '重复物品检测',
      hint: '自动检测位置、旋转、缩放完全相同的物品，在状态栏显示提示',
    },
    limitDetection: {
      label: '方案合规性检测',
      hint: '自动检测越界物品和过大的组合。关闭则代表您已知悉风险，允许强制保存。',
    },
    autoSave: {
      label: '工作台记忆',
      hint: '自动保存当前状态，以便下次继续编辑。',
    },
    autoUpdateFurniture: '家具数据自动更新',
    showGizmo: '变换轴显示',
    threeDisplayMode: '3D显示模式',
    threeSymbolScale: '图标/方块缩放比例',
    reset: '重置为默认设置',
  },

  // 监控状态
  watchMode: {
    monitoring: '监控中',
  },

  // 其他通用文本
  common: {
    close: '关闭',
    cancel: '取消',
    confirm: '确认',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    remove: '移除',
    loading: '加载中...',
    error: '出错了',
    warning: '警告',
    success: '成功',
  },

  // 编辑器视图
  editor: {
    viewMode: {
      orthographic: '正交视图',
      perspective: '透视视图',
      flight: '漫游模式',
      orbit: '轨道模式',
    },
    controls: {
      ortho: '左键选择 · 中键/空格平移 · 滚轮缩放',
      orbit: '左键选择 · 中键环绕 · 滚轮缩放 · F 聚焦选中 · WASD 漫游',
      flight: 'WASD 平移 · Space/Q 升降 · 按住中键转向 · F 聚焦选中',
    },
    sizeControl: {
      box: '方块大小',
      icon: '图标大小',
      shortcut: 'Ctrl + 滚轮快速调整',
    },
    debug: {
      show: '显示相机调试',
      hide: '隐藏相机调试',
      title: '📷 相机状态',
      mode: '模式',
      view: '视图',
      projection: '投影',
      position: '位置',
      target: '目标',
      orbitCenter: '轨道中心',
      viewFocused: '视图聚焦',
      navKey: '导航键',
      active: '激活',
      inactive: '未激活',
      zoom: '缩放',
      yes: '是',
      no: '否',
    },
  },

  // 状态栏
  status: {
    unnamed: '未命名',
    lastModified: '最后修改: {time}',
    coordinate: {
      enabled: '已启用',
      disabled: '未启用',
      tooltip: '工作坐标系: {angle}° ({state}) - 点击调整',
    },
    duplicate: {
      found: '发现 {count} 个重复物品 - 点击选中',
      label: '{count} 个重复物品',
    },
    rename: '{name} - 点击重命名',
    limit: {
      outOfBounds: '{count} 超出区域',
      outOfBoundsTip: '{count} 个物品超出可建造区域 - 点击选中',
      oversized: '{count} 组过大',
      oversizedTip: '{count} 个组合超过 50 个物品上限 - 点击选中',
    },
    render: {
      limited: '渲染受限',
      limitedTip: '渲染数量超限：当前物品 {total} 个，仅显示前 {max} 个',
    },
    stats: {
      total: '总计 {count}',
      selected: '已选 {count}',
      groups: '组 {count}',
    },
  },

  // 侧边栏
  sidebar: {
    structure: '结构',
    transform: '变换',
    noSelection: '请选择物品查看详情或进行操作',
    selectionList: '选中列表',
    groupSingle: '组 #{id}',
    groupMultiple: '{count} 个组',
    noIcon: '无图标',
    itemDefaultName: '物品 {id}',
    group: '成组',
    ungroup: '取消组合',
    tools: {
      label: '工具',
      box: '方形选框 (V)',
      lasso: '套索工具',
      hand: '拖拽工具 (H)',
      gizmo: '显示变换轴 (G)',
    },
    selectionMode: {
      label: '选择模式',
      new: '新选区 (默认)',
      add: '加选 (Shift)',
      subtract: '减选 (Alt)',
      intersect: '交叉选区 (Shift+Alt)',
    },
    displayMode: {
      label: '显示',
      box: '完整体积',
      simpleBox: '简化方块',
      icon: '图标模式',
    },
  },

  // 变换面板
  transform: {
    position: '位置',
    rotation: '旋转 (°)',
    absolute: '绝对',
    relative: '相对',
    workingCoord: '(工作坐标系)',
    workingCoordTip: '当前数值已转换为工作坐标系<br />旋转角度: {angle}°',
    correction: '(校正)',
    correctionTip: 'Z轴旋转显示已校正<br />实际旋转 = 显示值 + {angle}°',
    range: '范围 (Min ~ Max)',
    rangeTip: '当前范围基于工作坐标系<br />旋转角度: {angle}°',
  },
}
