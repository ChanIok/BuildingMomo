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
    title: 'Working Coordinate System',
    description: 'Customize the editing coordinate system direction or enable object local space',
    localSpace: 'Local Coordinate System',
    localSpaceHint: "When enabled, Gizmo aligns to the selected object's rotation",
    workingRotation: 'Working Rotation',
    axisX: 'X Axis (Roll)',
    axisY: 'Y Axis (Pitch)',
    axisZ: 'Z Axis (Yaw)',
    setFromSelection: 'Set from Selection',
    resetRotation: 'Reset Rotation',
  },

  // Welcome Screen
  welcome: {
    title: 'BuildingMomo',
    subtitle: 'Infinity Nikki Home Visual Editor',
    features: ['Batch Manage Buildings', 'Merge Across Schemes', 'Visual Coordinate Editor'],
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
      importFromCode: 'Import from Code',
      import: 'Import Data',
      export: 'Export Data',
      saveToGame: 'Save to Game',
      reopenLastClosedScheme: 'Reopen Closed Scheme',
    },
    edit: {
      undo: 'Undo',
      redo: 'Redo',
      cut: 'Cut',
      copy: 'Copy',
      duplicate: 'Duplicate',
      paste: 'Paste',
      delete: 'Delete',
      selectAll: 'Select All',
      deselectAll: 'Deselect All',
      invertSelection: 'Invert Selection',
      selectSameType: 'Select Same Type',
      group: 'Group',
      ungroup: 'Ungroup',
      move: 'Move',
    },
    view: {
      fitToView: 'Frame All',
      focusSelection: 'Frame Selection',
      coordinateSystem: 'Coordinate System',
      toggleGizmoSpace: 'Gizmo: World/Local',
      toggleCameraMode: 'Toggle Camera Mode',
      setWorkingCoordinateFromSelection: 'Working: Fit to Object',
      resetWorkingCoordinate: 'Working: Reset',
      setViewPerspective: 'Perspective',
      setViewTop: 'Top',
      setViewBottom: 'Bottom',
      setViewFront: 'Front',
      setViewBack: 'Back',
      setViewRight: 'Right',
      setViewLeft: 'Left',
      viewPreset: 'Presets',
    },
    sidebar: {
      showSelection: 'Selection (1)',
      showTransform: 'Transform (2)',
      showEditorSettings: 'Editor Settings (3)',
    },
    tool: {
      select: 'Select',
      lasso: 'Lasso',
      hand: 'Hand',
      toggleTranslate: 'Translate Mode',
      toggleRotate: 'Rotate Mode',
      toggleFurnitureLibrary: 'Furniture Library',
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
      invalidScale: '{n} items with scale values exceeding limits (will be clamped)',
      invalidRotation: '{n} items rotated on prohibited axes (will be reset to zero)',
    },
    save: {
      confirmTitle: 'Confirm Save',
      confirmDesc: 'Issues detected. Continue saving?',
      continue: 'Continue Save',
      dontShowAgain: "Don't remind me this session",
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
        'BuildData directory not found. Please select the game folder (InfinityNikkiGlobal\\X6Game\\Saved\\SavedData\\BuildData).',
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
    importCode: {
      title: 'Import from Code',
      description: 'Enter a scheme code to load building data from cloud',
      inputLabel: 'Scheme Code',
      inputPlaceholder: 'Enter scheme code',
      importing: 'Importing scheme...',
      success: 'Scheme imported successfully!',
      invalidCode: 'Please enter a valid scheme code',
      notFound: 'Scheme code not found or expired',
      networkError: 'Network error: {reason}',
      parseError: 'Failed to parse data, please verify the scheme code',
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
    language: '语言 / Language',
    languageHint: 'Switch interface language',
    theme: {
      label: 'Theme',
      hint: 'Switch between light and dark mode',
      light: 'Light',
      dark: 'Dark',
      auto: 'System',
    },
    furnitureTooltip: {
      label: 'Furniture Tooltips',
      hint: 'Show name and icon on hover',
    },
    background: {
      label: 'Background Image',
      hint: 'Show reference background',
    },
    editAssist: 'Editor Assistance',
    duplicateDetection: {
      label: 'Duplicate Detection',
      hint: 'Detect fully overlapping items',
    },
    limitDetection: {
      label: 'Compliance Checks',
      hint: 'Ensure scheme follows game standards',
    },
    autoSave: {
      label: 'Workspace Memory',
      hint: 'Automatically save current state to resume editing later.',
    },
    watchNotification: {
      label: 'Watch Popup',
      hint: 'Show a popup when the file changes; disabled will only record history.',
    },
    autoUpdateFurniture: 'Auto-Update Furniture Data',
    threeDisplayMode: '3D Display Mode',
    threeSymbolScale: 'Icon/Block Scale',
    reset: 'Reset to Default Settings',
  },

  // Watch Mode
  watchMode: {
    monitoring: 'Monitoring',
    history: {
      title: 'History',
      loadLatest: 'Load Latest Scheme',
      noHistory: 'No history schemes',
      itemCount: '{n} items',
    },
  },

  // Common Text
  common: {
    close: 'Close',
    closeOthers: 'Close Others',
    closeAll: 'Close All',
    rename: 'Rename',
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
      orbit: 'Left Select · Mid Orbit · Wheel Zoom · F Focus',
      flight: 'WASD Move · Space/Q Up/Down · Hold Mid Look · F Focus',
      tabSwitch: 'Tab Switch',
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

  // Loading Progress
  loading: {
    icon: 'Loading Icons',
    model: 'Loading Models',
    complete: 'Complete',
    failed: 'failed',
    phase: {
      network: 'Downloading...',
      processing: 'Preparing render...',
    },
  },

  // Status Bar
  status: {
    unnamed: 'Unnamed',
    lastModified: 'Last modified: {time}',
    coordinate: {
      world: 'World',
      local: 'Local',
      working: 'Working',
      tooltipWorld: 'World Coordinate System',
      tooltipLocal: 'Local Coordinate System',
      tooltipWorking: 'Working Coordinate System\nRotation: ({rotation})',
      fallbackHint: '(Fallback to {mode})',
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
      invalidScale: '{count} Invalid scale',
      invalidScaleTip:
        '{count} items have scale values exceeding furniture limits - Click to select',
      invalidRotation: '{count} Invalid rotation',
      invalidRotationTip: '{count} items are rotated on prohibited axes - Click to select',
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
    editorSettings: 'Editor',
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
      lasso: 'Lasso Tool (L)',
      hand: 'Hand Tool (H)',
      translate: 'Translate (G)',
      rotate: 'Rotate (R)',
      addFurniture: 'Furniture Library (B)',
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
      model: 'Model Mode',
    },
    camera: {
      label: 'Camera Settings',
      fov: 'FOV',
      baseSpeed: 'Move Speed',
      shiftMultiplier: 'Move Speed Multiplier',
      mouseSensitivity: 'Mouse Sensitivity',
      zoomSpeed: 'Wheel Zoom Speed',
      lockHorizontalMovement: 'Lock Horizontal Movement',
      lockHorizontalMovementHint: 'Keep movement horizontal, ignore pitch',
    },
    display: {
      label: 'Display Settings',
    },
    editAssist: {
      label: 'Editor Assistance',
    },
    snap: {
      label: 'Snap & Step',
      translationStep: 'Movement Snap',
      translationStepHint: 'Snap to grid points (multiples of this value)',
      rotationStep: 'Rotation Step',
      rotationStepHint: 'Rotate by fixed angle increments (relative step)',
      surfaceSnap: 'Surface Snap',
      surfaceSnapHint: 'Auto-detect collision when moving to prevent overlapping',
      surfaceSnapThreshold: 'Snap Threshold',
      disabled: 'Off',
    },
  },

  // Transform Panel
  transform: {
    position: 'Position',
    rotation: 'Rotation (°)',
    scale: 'Scale',
    absolute: 'Absolute',
    relative: 'Relative',
    workingCoord: '(Working Coord)',
    workingCoordTip: 'Showing rotation in working coordinate system<br />Coord rotation: {angle}',
    localCoord: '(Local Space)',
    localCoordTip:
      "Showing rotation in object's local coordinate system, relative to object's current orientation",
    range: 'Range (Min ~ Max)',
    rangeTip: 'Range based on working coordinate system<br />Rotation: {angle}°',
    mirror: 'Mirror',
    mirrorX: 'Mirror along X axis',
    mirrorY: 'Mirror along Y axis',
    mirrorZ: 'Mirror along Z axis',
    mirrorWithRotation: 'Mirror rotation',
    mirrorWithRotationHint:
      'When disabled, mirroring only adjusts position without changing item orientation',
    customPivot: 'Custom Pivot',
    customPivotHint: 'When enabled, you can specify a custom coordinate as the rotation center',
    alignAndDistribute: 'Align & Distribute',
    alignMin: 'Align to Min',
    alignCenter: 'Align to Center',
    alignMax: 'Align to Max',
    distribute: 'Distribute',
    alignMinHint: 'Align selected items to minimum bounds',
    alignCenterHint: 'Align selected items to center',
    alignMaxHint: 'Align selected items to maximum bounds',
    distributeHint: 'Evenly distribute items between endpoints',
    requireTwoItems: 'Requires at least 2 selected items',
    requireThreeItems: 'Requires at least 3 selected items',
    pivotReference: 'Reference',
    pivotReferenceHint: 'Use as reference; others follow when moved',
    selectButton: 'Select',
    cancelSelectingPivot: 'Cancel',
    pivotLabel: 'Pivot',
    clearPivot: 'Clear Pivot',
    selectingPivot: 'Click an item in the scene as pivot',
    pivotItemNotInSelection: 'Please select an item from current selection',
    pivotSet: 'Pivot set successfully',
  },

  // Furniture Library
  furnitureLibrary: {
    title: 'Furniture Library',
    searchPlaceholder: 'Search furniture...',
    noResults: 'No matching furniture found',
    stats: '{showing} of {total} items',
  },
}
