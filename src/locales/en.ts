export const enLocale = {
  // Scheme
  scheme: {
    defaultName: 'Scheme {n}',
    unnamed: 'Unnamed Scheme',
    title: 'Scheme Settings',
    description: 'Modify the tab name and file name for the current scheme.',
    nameLabel: 'Tab Name',
    namePlaceholder: 'e.g., Scheme 1',
    fileLabel: 'File Name',
    filePlaceholder: 'e.g., BUILD_SAVEDATA_123.json',
    tipsTitle: 'Tips:',
    tips: {
      name: 'Tab Name: Shown in the scheme tabs.',
      file: 'File Name: Shown at bottom-left; used as the default export filename.',
    },
    toast: {
      nameRequired: 'Tab name cannot be empty',
      fileRequired: 'File name cannot be empty',
      success: 'Scheme info updated',
    },
  },

  // Coordinate System
  coordinate: {
    title: 'Coordinate System Settings',
    description:
      'Set the rotation angle for the working coordinate system. 0° means global system.',
    globalLabel: 'Global Axis (0°)',
    workingLabel: 'Working Axis ({angle}°)',
    rotationLabel: 'Rotation Angle',
    unit: 'Degrees',
  },

  // Welcome Screen
  welcome: {
    title: 'BuildingMomo',
    subtitle: 'Infinity Nikki Home Visual Editor',
    features: ['Batch Manage Buildings', 'Merge Across Layouts', 'Visual Coordinate Editor'],
    mobileOnly: {
      title: 'Desktop Only',
      desc: 'This tool is for editing local game files',
    },
    selectGameDir: 'Link Game Folder',
    selectGameDirDesc: 'Auto-sync game data',
    importData: 'Import Data File',
    importDataDesc: 'Load JSON manually',
    notSupported: 'Browser not supported',
    safety: 'Safety Notice',
    riskDisclaimer: 'Educational use only. Use at your own risk',
    processLocal: 'Files are processed locally. First time?',
    helpDoc: 'Read the Guide',
    credit: 'Data & Icons by',
    creditLink: 'NUAN5.PRO',
    creditPowered: '',
    github: 'GitHub Repository',
    spinningMomo: 'SpinningMomo',
  },

  // Toolbar Menu
  menu: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    help: 'Help',
  },

  // Command Labels
  command: {
    file: {
      new: 'New Scheme',
      startWatchMode: 'Link Game Folder',
      stopWatchMode: 'Stop Watching',
      import: 'Import Data',
      export: 'Export Data',
      saveToGame: 'Save to Game',
    },
    edit: {
      undo: 'Undo',
      redo: 'Redo',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      delete: 'Delete',
      selectAll: 'Select All',
      deselectAll: 'Deselect All',
      invertSelection: 'Invert Selection',
      group: 'Group',
      ungroup: 'Ungroup',
      move: 'Move',
    },
    view: {
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      fitToView: 'Frame All',
      focusSelection: 'Frame Selection',
      coordinateSystem: 'Coordinate System',
      setViewPerspective: 'Perspective',
      setViewTop: 'Top',
      setViewBottom: 'Bottom',
      setViewFront: 'Front',
      setViewBack: 'Back',
      setViewRight: 'Right',
      setViewLeft: 'Left',
      viewPreset: 'Presets',
    },
    tool: {
      select: 'Select',
      hand: 'Hand',
      toggleGizmo: 'Toggle Gizmo',
    },
    help: {
      openDocs: 'Documentation',
    },
  },

  // Shortcut Hints
  shortcut: {
    ctrl: 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    space: 'Space',
    delete: 'Delete',
    escape: 'Esc',
    f1: 'F1',
  },

  // Documentation
  doc: {
    title: 'BuildingMomo Documentation',
    subtitle: 'User Guide & Help',
    quickstart: 'Quick Start',
    guide: 'User Guide',
    faq: 'FAQ',
    github: 'GitHub Repository',
  },

  // File Operations and Monitoring
  fileOps: {
    duplicate: {
      title: 'Duplicate Items',
      desc: 'Detected {n} duplicate items.',
      detail:
        'These items have identical position, rotation, and scale. They will overlap completely in-game.',
    },
    limit: {
      title: 'Auto-fix Limits',
      desc: 'The following issues will be fixed upon saving:',
      outOfBounds: '{n} items out of bounds (will be removed)',
      oversized: '{n} oversized groups (will be ungrouped)',
    },
    save: {
      confirmTitle: 'Confirm Save',
      confirmDesc: 'Issues detected. Continue saving?',
      continue: 'Continue Save',
    },
    import: {
      success: 'Import Successful',
      failed: 'Import Failed: {reason}',
      readFailed: 'Failed to read file',
    },
    export: {
      noData: 'No data to export',
    },
    saveToGame: {
      noDir: 'Please link game folder first',
      noData: 'No data to save',
      noPermission: 'No write permission',
      success: 'Saved successfully!',
      failed: 'Save failed: {reason}',
    },
    watch: {
      notSupported: 'File System Access API not supported. Please use Chrome or Edge.',
      noBuildData:
        'BuildData directory not found. Please select the game folder (InfinityNikki\\X6Game\\Saved\\SavedData\\BuildData).',
      foundTitle: 'Save File Found',
      foundDesc: 'File: {name}\nLast Modified: {time}\n\nImport now?',
      importNow: 'Import Now',
      later: 'Later',
      started: 'Monitoring started. Waiting for game data...',
      parseFailed: 'Monitoring started. Found file but failed to parse.',
      startFailed: 'Failed to start monitoring: {reason}',
    },
    importWatched: {
      notStarted: 'Monitoring not started',
      notFound: 'BUILD_SAVEDATA_*.json not found',
    },
  },

  // Errors and Notifications
  notification: {
    furnitureDataLoadFailed: 'Failed to load furniture data, some features may be unavailable',
    fileUpdate: {
      title: 'File Update Detected',
      desc: 'File {name} updated at {time}.\n\nImport new data?',
      confirm: 'Import Now',
      cancel: 'Later',
    },
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
  },

  // Settings
  settings: {
    title: 'Settings',
    description: 'Configure display options and editor settings',
    language: 'Language',
    languageHint: 'Switch interface language, reloads UI text and documentation',
    furnitureTooltip: {
      label: 'Furniture Tooltips',
      hint: 'Show name and icon when hovering over items',
    },
    background: {
      label: 'Background Image',
      hint: 'Show reference background image on canvas',
    },
    editAssist: 'Editor Assistance',
    duplicateDetection: {
      label: 'Duplicate Detection',
      hint: 'Detects items with identical position, rotation, and scale.',
    },
    limitDetection: {
      label: 'Limit Detection',
      hint: 'Detects out-of-bounds items and oversized groups. Disable to bypass checks and force save.',
    },
    autoSave: {
      label: 'Workspace Memory',
      hint: 'Automatically save current state to resume editing later.',
    },
    autoUpdateFurniture: 'Auto-Update Furniture Data',
    showGizmo: 'Transform Gizmo',
    threeDisplayMode: '3D Display Mode',
    threeSymbolScale: 'Icon/Block Scale',
    reset: 'Reset to Default Settings',
  },

  // Watch Mode
  watchMode: {
    monitoring: 'Monitoring',
  },

  // Common Text
  common: {
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    remove: 'Remove',
    loading: 'Loading...',
    error: 'Error',
    warning: 'Warning',
    success: 'Success',
  },

  // Editor View
  editor: {
    viewMode: {
      orthographic: 'Orthographic',
      perspective: 'Perspective',
      flight: 'Flight Mode',
      orbit: 'Orbit Mode',
    },
    controls: {
      ortho: 'Left Select · Mid/Space Pan · Wheel Zoom',
      orbit: 'Left Select · Mid Orbit · Wheel Zoom · F Focus · WASD Fly',
      flight: 'WASD Move · Space/Q Up/Down · Hold Mid Look · F Focus',
    },
    sizeControl: {
      box: 'Box Size',
      icon: 'Icon Size',
      shortcut: 'Ctrl + Wheel to adjust',
    },
    debug: {
      show: 'Show Camera Debug',
      hide: 'Hide Camera Debug',
      title: '📷 Camera Status',
      mode: 'Mode',
      view: 'View',
      projection: 'Projection',
      position: 'Position',
      target: 'Target',
      orbitCenter: 'Orbit Center',
      viewFocused: 'View Focused',
      navKey: 'Nav Key',
      active: 'Active',
      inactive: 'Inactive',
      zoom: 'Zoom',
      yes: 'Yes',
      no: 'No',
    },
  },

  // Status Bar
  status: {
    unnamed: 'Unnamed',
    lastModified: 'Last modified: {time}',
    coordinate: {
      enabled: 'Enabled',
      disabled: 'Disabled',
      tooltip: 'Working Coord: {angle}° ({state}) - Click to adjust',
    },
    duplicate: {
      found: 'Found {count} duplicates - Click to select',
      label: '{count} Duplicates',
    },
    rename: '{name} - Click to rename',
    limit: {
      outOfBounds: '{count} Out of bounds',
      outOfBoundsTip: '{count} items out of build area - Click to select',
      oversized: '{count} Oversized groups',
      oversizedTip: '{count} groups exceed 50 items - Click to select',
    },
    render: {
      limited: 'Render Limited',
      limitedTip: 'Render limit exceeded: {total} items, showing first {max}',
    },
    stats: {
      total: 'Total {count}',
      selected: 'Selected {count}',
      groups: 'Groups {count}',
    },
  },

  // Sidebar
  sidebar: {
    structure: 'Structure',
    transform: 'Transform',
    noSelection: 'Select items to view details or edit',
    selectionList: 'Selection',
    groupSingle: 'Group #{id}',
    groupMultiple: '{count} Groups',
    noIcon: 'No Icon',
    itemDefaultName: 'Item {id}',
    group: 'Group',
    ungroup: 'Ungroup',
    tools: {
      label: 'Tools',
      box: 'Box Select (V)',
      lasso: 'Lasso Tool',
      hand: 'Hand Tool (H)',
      gizmo: 'Show Gizmo (G)',
    },
    selectionMode: {
      label: 'Selection Mode',
      new: 'New Selection (Default)',
      add: 'Add to Selection (Shift)',
      subtract: 'Subtract from Selection (Alt)',
      intersect: 'Intersect Selection (Shift+Alt)',
    },
    displayMode: {
      label: 'Display',
      box: 'Full Volume',
      simpleBox: 'Simple Box',
      icon: 'Icon Mode',
    },
  },

  // Transform Panel
  transform: {
    position: 'Position',
    rotation: 'Rotation (°)',
    absolute: 'Absolute',
    relative: 'Relative',
    workingCoord: '(Working Coord)',
    workingCoordTip: 'Values converted to working coordinate system<br />Rotation: {angle}°',
    correction: '(Corrected)',
    correctionTip: 'Z-Rotation is corrected<br />Actual = Display + {angle}°',
    range: 'Range (Min ~ Max)',
    rangeTip: 'Range based on working coordinate system<br />Rotation: {angle}°',
  },
}
