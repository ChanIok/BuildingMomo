# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands

### Local setup & development

- `npm install` — install dependencies
- `npm run dev` — start dev server (auto-detected locale)
- `npm run dev:secure` — dev server in secure mode (`--mode secure`, respects `VITE_ENABLE_SECURE_MODE`)
- `npm run fetch-data` — update game data & icons under `public/assets` (run before build if upstream data changes or if local data is missing)

### Build, preview, and deploy

- `npx vue-tsc -b` — type-check the project
- `npm run build` — production build (type-check + Vite build + generate `dist/en/index.html`). Note: `prebuild` runs `fetch-data` automatically.
- `npm run build:secure` — production build for secure deployment (adds `--mode secure`, runs SEO cleanup)
- `npm run preview` — preview the built site locally (serves `dist`)
- GitHub Pages: push to `main` triggers `.github/workflows/deploy.yml` (sets `VITE_BASE_PATH=/BuildingMomo/`)
- Cloudflare: `npm run deploy:cloudflare` (uses `build:secure`)
- Netlify: `npm run deploy:netlify`

### Formatting

- Prettier is the sole formatter. Config in `.prettierrc.json`: no semicolons, single quotes, 100-char print width, 2-space indent, `prettier-plugin-tailwindcss`.
- Husky pre-commit hook runs `lint-staged` → `prettier --write` on staged `js/jsx/ts/tsx/vue/json/md` files.
- Format manually: `npx prettier --write <file>`

### Tests

- **No test runner or `npm test` script is configured** in this repository as of now.

## Code style & conventions

- Path alias: `@/` maps to `src/` (configured in both `tsconfig.json` and `vite.config.ts`)
- TypeScript strict mode is enabled (`tsconfig.app.json`)
- UI components use **shadcn-vue** (new-york style). Config in `components.json`; add components via `npx shadcn-vue@latest add <component>`. Primitives live in `src/components/ui/`.
- Icons: `lucide-vue-next`
- CSS: Tailwind CSS v4 via `@tailwindcss/vite` plugin; base styles in `src/index.css`
- Vite is overridden to `rolldown-vite` in `package.json` overrides
- Three.js is deduped in `vite.config.ts` resolve to avoid multi-instance issues

## High-level architecture

### Overview

- Single-page web application (Vue 3 + Vite) providing a 3D visual editor for **Infinity Nikki** home building schemes.
- The core domain model is a "home scheme" representing furniture instances loaded from / exported to the game's `BUILD_SAVEDATA_*.json` files.
- State is managed centrally with **Pinia** stores; rendering uses **Three.js** via **TresJS** (`@tresjs/core` and `@tresjs/cientos`) with heavy use of **instanced meshes** for performance.

### Application shell

- Entry point: `src/main.ts` creates the Vue app, installs Pinia, and mounts `src/App.vue`.
- `src/App.vue` is the top-level layout:
  - Sets up theme handling (light/dark/auto) based on `settingsStore` and media queries.
  - Restores workspace state via `useWorkspaceWorker` (IndexedDB + Web Worker) when auto-save is enabled and a previous session marker exists.
  - Wires global keyboard shortcuts via `useKeyboardShortcuts`, delegating to the command system.
  - Overall structure: `Toolbar` at top, central area hosting either `WelcomeScreen`, `ThreeEditor` (for scheme tabs), or `DocsViewer` (for in-app docs), with `Sidebar` on the right and `StatusBar` at the bottom.
  - Global overlays: `Toaster` (vue-sonner), `CoordinateDialog`, `GlobalAlertDialog`.

### State management (Pinia stores)

#### `editorStore` – schemes and scene graph

- Defines the core **multi-document model**:
  - `schemes`: array of `HomeScheme` objects, each wrapping a scheme's metadata and items using `Ref`/`ShallowRef` for performance.
  - `activeSchemeId` and computed `activeScheme` to track the current working scheme.
  - Each scheme holds:
    - `items: ShallowRef<AppItem[]>` – flat list of furniture instances.
    - `selectedItemIds: ShallowRef<Set<string>>` – selection set.
    - `maxInstanceId`, `maxGroupId` – monotonically increasing allocators.
    - View-related state: `currentViewConfig`, `viewState` (camera/zoom preset snapshot).
    - `groupOrigins: ShallowRef<Map<number, string>>` – maps groupId to an origin item ID used for move/rotate operations.
    - `history` – undo/redo stack (used by `useEditorHistory`).
- Derived indices for fast lookup:
  - `itemsMap` (internalId → AppItem) and `groupsMap` (groupId → Set<internalId>). These are used heavily by editor composables and the renderer.
- Scene/selection versioning:
  - `sceneVersion` and `selectionVersion` are numeric counters incremented by `triggerSceneUpdate` / `triggerSelectionUpdate` so that performance-critical observers (renderer, worker, validation store) can respond without deeply watching arrays/Sets.
- Tool state: `currentTool` (`'select' | 'hand'`), `selectionMode` (`'box' | 'lasso'`), `selectionAction` (`'new' | 'add' | 'subtract' | 'intersect' | 'toggle'`), `gizmoMode` (`'translate' | 'rotate' | null`).
- Global clipboard: `clipboardRef: ShallowRef<ClipboardData>` supports cross-scheme copy/paste with group origin preservation.
- Closed scheme history: `closedSchemesHistory` (max 10) stores exported `GameDataFile` snapshots, restored via `reopenClosedScheme`.
- Key behaviors:
  - `createScheme` / `importJSONAsScheme` construct new schemes from scratch or from game JSON (`GameDataFile.PlaceInfo`), computing max IDs and wiring scheme tabs via `tabStore.openSchemeTab`.
  - `closeScheme`, `setActiveScheme`, `updateSchemeInfo` and `renameScheme` coordinate with `tabStore` to keep titles and active tabs in sync.

#### `tabStore` – document & docs tabs

- Manages the tab strip shown in `Toolbar.vue`:
  - `tabs` is a list of `Tab` objects (`type: 'scheme' | 'doc'`).
  - `openSchemeTab(schemeId, name)` ensures there is at most one tab per scheme.
  - `openDocTab(docPage?)` manages a **single** doc tab that can show different in-app documentation pages (`QuickStart`, `UserGuide`, `FAQ`) defined under `src/components/docs`.
  - Tabs are re-orderable via `moveTab`, which is wired to the drag-and-drop logic in `Toolbar.vue`.

#### `settingsStore` – persisted app settings and secure mode auth

- `settings` uses `useLocalStorage` to persist an `AppSettings` object (theme, tooltip/background toggles, auto-save flags, 3D display mode, camera parameters, snapping, language, input bindings, etc.).
- Input bindings: `InputBindings` configures camera controls (orbit/flight mouse button, Alt+left-click) and selection modifier keys (add/subtract/toggle/intersect). `resolveSelectionBindingConflicts` and `resolveAltCameraConflicts` auto-clear conflicting bindings.
- Secure mode:
  - `verifyPassword` and `initializeAuth` encapsulate the password-based auth flow used when `VITE_ENABLE_SECURE_MODE === 'true'`.
  - In dev + secure mode, verification is short-circuited; in production it POSTs to `/api/login` and stores a password token in `localStorage` for silent re-auth.

#### `gameDataStore` – furniture metadata, buildable areas, model DB

- Lazily loads external data under `public/assets/data`:
  - `building-momo-furniture.json` – normalized into `furnitureData` map (game item ID → `FurnitureItem`), including `scaleRange` and `rotationAllowed` constraints.
  - `home-buildable-area.json` – polygons describing valid buildable XY regions.
  - `furniture_db.json` – mapping from logical furniture IDs to 3D model configurations (meshes, root offsets, color configs).
- Provides query helpers used throughout the app:
  - `getFurniture`, `getFurnitureSize`, `getIconUrl` for UI and renderer.
  - `getFurnitureModelConfig` and `getFurnitureConstraintsMap` for 3D model loading and validation rules (scale/rotation constraints) sent to the worker.
- `initialize()` loads all three datasets in parallel and exposes readiness flags consumed by renderer and persistence logic.

#### `uiStore` – view mode, sidebar, working coordinate system

- Centralizes UI-only state:
  - `viewMode` (`'2d' | '3d'`) – currently the main experience is 3D.
  - `currentViewPreset` – one of TresJS camera presets (`perspective`, `top`, `front`, etc.), used by `useThreeCamera` and renderer to orient icons and grids.
  - `sidebarView` – which sidebar panel is shown (`structure`, `transform`, `editorSettings`).
  - `sidebarHoveredGameId` – hovered furniture type in structure panel, used for cross-highlighting with the canvas.
  - `editorContainerRect` – cached bounding rect of the 3D container, updated via `useResizeObserver` in `ThreeEditor.vue`.
  - `workingCoordinateSystem` – angle-based rotation of a custom working coordinate system used by editor transforms (e.g. mirroring around arbitrary directions).
  - `gizmoSpace` – computed proxy to `settingsStore.settings.gizmoSpace` (`'world' | 'local'`).
- Interactive pick modes (temporary UI state):
  - `customPivotEnabled` / `customPivotPosition` – custom pivot rotation.
  - `isSelectingGroupOrigin` / `selectingForGroupId` – group origin selection mode.
  - `isSelectingPivotItem` / `selectedPivotPosition` – pivot item selection mode.
  - `isSelectingAlignReference` / `alignReferenceItemId` / `alignReferencePosition` – align-to-reference mode.
- Exposes coordinate transforms:
  - `workingToWorld` / `worldToWorking` – position conversion between working coordinate system and world space.
  - `dataToWorking` / `workingToData` / `workingDeltaToData` – convenience APIs combining data↔world↔working conversions for UI input/display.
  - `getEffectiveCoordinateRotation(selectedIds, itemsMap)` – resolves the active coordinate rotation accounting for local/world gizmo space, single-item local mode, and working coordinate system.

#### `commandStore` – central command bus

- Encapsulates high-level **commands** (file, edit, view, tool, help), each with `id`, `label`, `shortcut`, category, `enabled` predicate, and `execute` function.
- Ties together:
  - Editing commands (`edit.*`) implemented via `useEditorHistory`, selection / groups composables, and `useEditorManipulation`.
  - File commands (`file.*`) implemented via the `useFileOperations` facade (import/export, watch mode, save to game, import from code, reopen closed scheme).
  - View/3D commands (`view.*`) that call into callbacks registered by `ThreeEditor` (`fitCameraToScene`, `focusOnSelection`, view preset switching, camera mode toggling, gizmo space toggling, coordinate system dialog, working coordinate from selection).
  - Tool commands (`tool.*`) switching between selection, lasso, hand, gizmo modes, furniture library (`showFurnitureLibrary`), and dye panel (`showDyePanel`).
  - Sidebar commands (`sidebar.*`) switching between structure, transform, and editor settings panels.
- `Toolbar.vue` uses `commandStore` to render menus and item states; keyboard shortcuts are wired through `useKeyboardShortcuts` (see `src/composables/useKeyboardShortcuts.ts`).

#### `validationStore` – validation results and selection helpers

- Holds validation output computed in the worker:
  - Duplicate groups of items (exact same position/rotation/scale/gameId).
  - Limit issues: out-of-bounds items, oversized groups, invalid scale or rotation according to furniture constraints.
- Exposes helpers that transform validation findings into selections (e.g. `selectDuplicateItems`, `selectOutOfBoundsItems`, `selectOversizedGroupItems`, `selectInvalidScaleItems`, `selectInvalidRotationItems`), which feed back into `editorStore` selection state.

#### `loadingStore` – loading progress management

- Tracks loading state for icons and 3D models with two modes: `simple` (single-phase 0–100%) and `staged` (network 0–50%, processing 50–100%).
- Used by `LoadingProgress.vue` to render a progress bar in the UI.

#### `notificationStore` – alert dialog queue

- Manages a queue of `AlertConfig` dialogs with confirm/cancel/checkbox support.
- Supports category-based deduplication: new alerts of the same category replace queued or active alerts.
- `GlobalAlertDialog.vue` renders the current alert; `useNotification` composable provides a simplified toast API via `vue-sonner`.

### 3D editor and rendering stack

#### `ThreeEditor.vue` – 3D viewport component

- Renders the main 3D workspace using `TresCanvas` and TresJS extras (`OrbitControls`, `TransformControls`, `Grid`).
- Responsibilities that span multiple composables:
  - Camera lifecycle and navigation via `useThreeCamera` (orbit vs flight modes, view presets, dynamic near plane based on nearby objects, WASD + mouse control).
  - Background handling via `useThreeBackground`, rendering the game map texture with correct coordinate mapping and theme-derived colors.
  - Grid and axes via `useThreeGrid` and classic `Grid` / `AxesHelper` primitives.
  - Instanced rendering via `useThreeInstancedRenderer` (see below) with four display modes: `box`, `icon`, `simple-box`, `model`.
  - Selection and lasso via `useThreeSelection`, including rectangular and freeform selection in screen space.
  - Transform gizmo via `useThreeTransformGizmo`, with snapping controlled by `settingsStore` and coupled to instanced-mesh matrix updates.
  - 3D tooltips for hovered items via `useThreeTooltip`, using the same picking configuration as selection and delegating highlight handling to the renderer.
  - Context menu and overlays via `ThreeEditorOverlays.vue`, which centralizes UI overlays (selection rectangle, tooltips, debug readouts).
- Uses a shared `isTransformDragging` flag to avoid expensive full-scene rebuilds while the gizmo is being dragged.
- `CanvasToolbar.vue` provides a floating toolbar within the canvas area.

#### Renderer composables – `src/composables/renderer`

- `useThreeInstancedRenderer` (`core.ts`, re-exported by `index.ts`) orchestrates **multi-mode instanced rendering**:
  - Integrates with `editorStore` for scene and selection versions, `gameDataStore` for model info, and `settingsStore` for `threeDisplayMode` and symbol scale.
  - Maintains global index mappings (`indexToIdMap`, `idToIndexMap`) for non-model modes and specialized mappings for model mode.
  - Delegates per-mode details to:
    - `useBoxMode` – bounding-box-style volumes sized by furniture dimensions.
    - `useIconMode` – billboarded icons facing either the camera or fixed directions depending on view preset.
    - `useSimpleBoxMode` – uniform simple cubes for performance/debug views.
    - `useModelMode` – per-furniture-model instanced meshes keyed by furniture model config, with a separate fallback mesh.
  - Color & highlight management via `useInstanceColor` (selection, hover, and sidebar-hovered-game-id colors, with suppression rules when an item is both hovered and selected).
  - Instance matrix updates for gizmo interactions via `useInstanceMatrix`, including BVH refit hints.
  - Selection outline rendering via `useSelectionOutline`, which uses a mask pass + overlay pass composed in the TresJS render loop.
- Shared renderer utilities (`src/composables/renderer/shared`):
  - `asyncRaycast.ts` – async raycast for performance in large scenes.
  - `materials.ts` – shared material definitions.
  - `scratchObjects.ts` – pre-allocated Three.js objects for reuse in hot paths.
- Provides a **unified picking interface** (`pickingConfig`) used by both selection and tooltips:
  - `performRaycast(raycaster)` returns the closest instance hit along with its internal ID.
  - `indexToIdMap` exposes the current mode's index mapping in a read-only fashion.
- Performance constants defined in `src/types/constants.ts`: `MAX_RENDER_INSTANCES` (40000), `RAYCAST_SKIP_ITEM_THRESHOLD` (10000).

### Editor manipulation & coordinate systems

- `src/composables/editor/useEditorManipulation.ts` is the main **domain-level transform engine**:
  - Uses Three.js math (matrices, quaternions, Eulers) to implement precise group transforms (translate, rotate, scale) with correct mapping between game-space rotations and renderer-space rotations.
  - `calculateNewTransform` mirrors the renderer's transform pipeline and compensates for the Y-axis flip and roll/pitch inversions used in rendering.
  - Supports absolute and relative transform modes, multi-item scaling around selection centers, and mirroring across arbitrary axes in the working coordinate system (via `uiStore.globalToWorking` / `workingToGlobal`).
  - Enforces furniture constraints using `gameDataStore` when limit detection is enabled, matching the rules used by the worker.
- `src/composables/editor/useEditorAlignment.ts` – **alignment and distribution engine**:
  - Supports center-point alignment (icon/simple-box modes) and OBB-based boundary alignment (box/model modes).
  - Group-aware: if any member of a group is selected, the entire group moves as a unit.
  - Reference item: can align to an external reference item rather than the selection boundary.
  - Working coordinate system: alignment axes rotate with the working coordinate system.
  - Uses pure functions from `src/lib/alignmentHelpers.ts` for OBB construction, axis projection, and delta calculation.
- Other editor composables under `src/composables/editor`:
  - `useEditorSelection` – selection behavior (selectAll, clearSelection, invertSelection, selectSameType).
  - `useEditorGroups` – grouping and ungrouping.
  - `useEditorHistory` – undo/redo management with `saveHistory('edit' | 'selection')`.
  - `useEditorItemAdd` – item insertion logic (from furniture library).
- `src/composables/useClipboard.ts` – cross-scheme clipboard with `ClipboardData` that preserves group origins during copy/paste.

#### Coordinate system architecture

The application uses **three distinct coordinate spaces** that must be carefully converted between:

##### 1. Data Space (Game Coordinates)

- **Source**: Game save files (`BUILD_SAVEDATA_*.json`), stored in `item.x`, `item.y`, `item.z`, `item.rotation.{x,y,z}`
- **Characteristics**:
  - Right-handed, Z-up coordinate system
  - Y-axis points "downward" in the game world (higher Y = lower altitude)
  - Rotation stored as Euler angles (Roll, Pitch, Yaw) in degrees
- **Usage**: Persistent storage, undo/redo snapshots, validation logic

##### 2. World Space (Three.js Scene)

- **Transformation**: Data Space with `Scale(1, -1, 1)` applied (Y-axis flip)
- **Characteristics**:
  - Y-axis points "upward" (opposite of Data Space)
  - Used by Three.js for rendering and physics calculations
  - The scene parent node applies `Scale(1, -1, 1)` to flip Y
- **Usage**: Three.js objects, Gizmo positioning, coordinate conversions
- **Conversion**:

  ```javascript
  // Data → World
  worldPos = { x: dataPos.x, y: -dataPos.y, z: dataPos.z }

  // World → Data
  dataPos = { x: worldPos.x, y: -worldPos.y, z: worldPos.z }
  ```

##### 3. Visual Space (UI Display)

- **Purpose**: Coordinate space used by UI inputs and Gizmo visualization
- **Transformation from Data Space**: `{ x: rot.x, y: -rot.y, z: rot.z }`
- **Usage**: Transform panel display, Gizmo rotation, working coordinate system calculations
- **Note**: When converting to/from quaternions (e.g., in Gizmo or coordinate transforms), Z-axis is additionally negated for 'ZYX' Euler order
- **Files**: `src/lib/matrixTransform.ts`, `src/components/SidebarTransform.vue`

##### Z-axis rotation convention

All Gizmo and coordinate conversion functions use **'ZYX' Euler order with Z-axis negated**:

```javascript
// Standard pattern in Gizmo, coordinateTransform, and rotationTransform
const euler = new Euler(
  (rotation.x * Math.PI) / 180,
  (rotation.y * Math.PI) / 180,
  -(rotation.z * Math.PI) / 180, // Z-axis NEGATED
  'ZYX'
)
```

This convention is consistently applied in:

- `useThreeTransformGizmo.ts` (Gizmo display)
- `src/lib/coordinateTransform.ts` (all convert\* functions)
- `src/lib/rotationTransform.ts` (working coordinate rotations)
- `src/lib/alignmentHelpers.ts` (alignment axis calculation)

##### Working coordinate system

- **Purpose**: Allow transforms relative to an arbitrary rotated reference frame
- **Storage**: `uiStore.workingCoordinateSystem.rotation` (Visual Space)
- **Activation**: User presses `Z` to align with selected item, or sets custom angles
- **Key Functions**:
  - `convertPositionWorkingToGlobal` / `convertPositionGlobalToWorking` - Position conversion (World Space I/O)
  - `convertRotationWorkingToGlobal` / `convertRotationGlobalToWorking` - Rotation conversion (Visual Space I/O)
  - `rotateItemsInWorkingCoordinate` - Apply rotation in working coordinate system
  - `uiStore.dataToWorking` / `uiStore.workingToData` / `uiStore.workingDeltaToData` - Convenience APIs combining data↔world↔working for UI
- **Implementation**: `src/lib/coordinateTransform.ts`, `src/lib/rotationTransform.ts`

##### Key conversion rules

**Rule 1: Position conversion (Data ↔ World)**

```javascript
// Data → World: Y negated
const worldPos = { x: dataPos.x, y: -dataPos.y, z: dataPos.z }

// World → Data: Y negated
const dataPos = { x: worldPos.x, y: -worldPos.y, z: worldPos.z }
```

**Rule 2: Rotation conversion (Data ↔ Visual)**

```javascript
// Use matrixTransform utility functions
const visualRotation = matrixTransform.dataRotationToVisual(dataRotation)
const dataRotation = matrixTransform.visualRotationToData(visualRotation)
```

**Rule 3: Working coordinate system**

- `convert*` functions expect **Visual Space** rotation values
- Always use `matrixTransform.dataRotationToVisual()` before passing `item.rotation` to coordinate conversion functions
- Always use `matrixTransform.visualRotationToData()` before storing results back to `item.rotation`

##### Common pitfalls to avoid

1. **Coordinate space consistency**
   - `convert*` functions work in **Visual Space** - always use `dataRotationToVisual()` before calling them
   - `item.rotation` is **Data Space** - always use `visualRotationToData()` before storing
   - Functions like `mirrorRotationInWorkingCoord` work in **Data Space** directly

2. **Y-axis flip for positions**
   - Data ↔ World conversions always require Y negation: `{ x, y: -y, z }`
   - This is separate from rotation conversions

3. **Working coordinate system**
   - Use `uiStore.getEffectiveCoordinateRotation()` - it returns Visual Space values ready for use
   - Don't manually convert or transform these values before passing to coordinate functions

##### Files to review for coordinate system changes

- **Core conversion**: `src/lib/coordinateTransform.ts`
- **Matrix utilities**: `src/lib/matrixTransform.ts`
- **Rotation transforms**: `src/lib/rotationTransform.ts`
- **Alignment helpers**: `src/lib/alignmentHelpers.ts`
- **Collision & bounding boxes**: `src/lib/collision.ts`
- **Transform panel**:
  - Main container: `src/components/SidebarTransform.vue`
  - Selection logic: `src/composables/transform/useTransformSelection.ts`
  - Sub-components: `src/components/transform/TransformAxisInputs.vue`, `TransformRotationSection.vue`, `TransformAlignSection.vue`
- **Editor manipulation**: `src/composables/editor/useEditorManipulation.ts`
- **Editor alignment**: `src/composables/editor/useEditorAlignment.ts`
- **Gizmo handling**: `src/composables/useThreeTransformGizmo.ts`
- **UI state**: `src/stores/uiStore.ts`

### Core utilities (`src/lib`)

The `lib` directory contains reusable mathematical and geometric utilities that are shared across the application.

#### `matrixTransform.ts` – Coordinate space conversion

- **Purpose**: Bidirectional conversion between game data coordinates and Three.js world matrices
- **Key functions**:
  - `buildWorldMatrixFromItem(item, hasModelConfig)` – Converts game data (position, rotation, scale) to Three.js world matrix, handling coordinate system differences (X/Y swap, Y-axis flip, Roll/Pitch negation)
  - `extractItemDataFromWorldMatrix(worldMatrix)` – Reverse conversion from world matrix back to game data format
  - `dataRotationToVisual(rotation)` / `visualRotationToData(rotation)` – Rotation space conversion for UI/Gizmo use
  - `dataPositionToWorld(position)` / `worldPositionToData(position)` – Position space conversion
  - `applyParentFlipInPlace(matrix)` – In-place matrix modification for performance-critical paths
- **Coordinate system handling**: Encapsulates the `Scale(1, -1, 1)` parent flip and X/Y axis swap logic used throughout the rendering pipeline

#### `collision.ts` – OBB and collision detection

- **Purpose**: Oriented Bounding Box (OBB) calculations for accurate collision, snapping, and selection
- **Key types**:
  - `OBB` class – Represents an oriented bounding box with center, half-extents, and rotation axes
- **Key functions**:
  - `getOBBFromMatrix(matrix, baseSize)` – Constructs OBB from world matrix (for Box mode)
  - `getOBBFromMatrixAndModelBox(matrix, modelBox)` – Constructs OBB from world matrix + model bounding box (for Model mode)
  - `mergeOBBs(obbs, referenceAxes?)` – Merges multiple OBBs into a single bounding volume
  - `calculateOBBSnapVector(movingOBB, staticOBB, threshold)` – Computes snap vector for surface snapping using Separating Axis Theorem
- **Usage**: Shared by Gizmo transform (`useThreeTransformGizmo`), editor manipulation (`useEditorManipulation`), alignment (`useEditorAlignment`), and transform panel (`useTransformSelection`) to ensure consistent bounding box calculations across box/model modes

#### `coordinateTransform.ts` – Working coordinate system

- **Purpose**: Transforms between global space and arbitrary rotated working coordinate systems
- **Key functions**:
  - `convertPositionWorkingToGlobal` / `convertPositionGlobalToWorking` – Position conversion (World Space I/O)
  - `convertRotationWorkingToGlobal` / `convertRotationGlobalToWorking` – Rotation conversion (Visual Space I/O)
- **Usage**: Enables transforms relative to custom reference frames (e.g., align to selected item's orientation)

#### `rotationTransform.ts` – Rotation operations

- **Purpose**: High-level rotation operations in working coordinate systems
- **Key functions**:
  - `rotateItemsInWorkingCoordinate(items, axis, angle, center, workingRotation)` – Rotates items around an axis in a working coordinate system
  - `extractSingleAxisRotation(rotation)` – Extracts single-axis rotation from a rotation object

#### `alignmentHelpers.ts` – Alignment pure functions

- **Purpose**: Reusable pure functions for alignment/distribution calculations
- **Key functions**:
  - `buildItemOBB(item, currentMode, gameDataStore, modelManager)` – Constructs OBB accounting for box vs model mode differences
  - `calculateAlignAxisVector(axis, workingRotation)` – Computes world-space direction vector for an alignment axis
  - `calculateAlignTarget(projections, mode, axis)` – Determines target alignment position from unit projections
  - `calculateAlignDelta(projection, targetValue, mode, axis)` – Calculates per-unit movement distance
  - `shouldInvertForYAxis(axis)` – Handles Y-axis flip for visual min/max consistency

#### `geometry.ts` – Basic geometric calculations

- **Purpose**: Simple AABB bounds calculations
- **Key functions**:
  - `calculateBounds(items, getItemSize?)` – Computes axis-aligned bounding box from item positions (optionally considering item sizes)
- **Note**: For more accurate bounding boxes that consider rotation, use `collision.ts` OBB functions instead

#### Other utilities

- `watchHistoryStore.ts` – IndexedDB-backed storage for file watch history entries
- `cameraUtils.ts` – Camera utility functions
- `keyboard.ts` – Keyboard input helpers

### Persistence, worker, and validation pipeline

#### `useWorkspaceWorker` (main thread)

- Bridges the Vue app with a dedicated Web Worker (`src/workers/workspace.worker.ts`) via Comlink (`src/workers/client.ts`).
- Responsibilities:
  - Manages an IndexedDB snapshot key (`workspace_snapshot`) for multi-scheme + multi-tab workspace restore.
  - Tracks whether the worker should be active based on `settingsStore` flags (`enableAutoSave`, `enableDuplicateDetection`, `enableLimitDetection`).
  - On activation, sends an initial full snapshot (`createCurrentSnapshot`), then:
    - Streams structural updates (tabs, activeTab) and content updates (items, selection, view state) through a debounced `updateState` API.
    - Syncs user settings, buildable area polygons, and furniture constraints into worker-local state.
  - Maintains a lightweight `has_unsaved_session` marker in `localStorage` so the app can quickly decide whether to attempt workspace restore on startup.

#### `workspace.worker.ts` (Web Worker)

- Owns the authoritative **workspace snapshot** and performs:
  - Auto-save to IndexedDB when `enableAutoSave` is on (with debounce and `SAVE_COMPLETE` messages back to the main thread).
  - Validation of the active scheme's items against:
    - Duplicate detection (exact duplicates in position/rotation/scale/gameId).
    - Build limits: Z-height bounds and inclusion inside any buildable area polygon.
    - Furniture constraints from `gameDataStore` (scale ranges and rotation-allowed axes, using EPSILON tolerances to avoid floating point noise).
- Exposes APIs consumed by `useWorkspaceWorker`:
  - `initWorkspace`, `updateState`, `updateSettings`, `updateBuildableAreas`, `updateFurnitureConstraints`, and `revalidate`.

#### Workspace restore

- `useWorkspaceWorker.restore()` reads `workspace_snapshot` via `idb-keyval.get`, reconstructs `HomeScheme` instances (rebuilding max IDs, ShallowRefs, and view state), and rehydrates `editorStore` and `tabStore` so the app resumes where the user left off.

### File I/O and game integration

- `src/composables/useFileOperations.ts` is a facade that composes focused file-op modules:
  - `src/composables/fileOps/watchMode.ts`:
    - Watch mode (`startWatchMode`, polling, `importFromWatchedFile`, `importFromHistory`) over `BUILD_SAVEDATA_*.json` via File System Access API.
    - `saveToGame` writeback flow (permission handling, file index update, self-write suppression).
    - Watch history persistence via `WatchHistoryDB` (`src/lib/watchHistoryStore.ts`).
  - `src/composables/fileOps/codeImport.ts`:
    - Scheme code import (`importFromCode`) from NUAN5 API.
    - Supports two code types:
      - `island`: import as a new scheme tab.
      - `combination`: import into active scheme (create an empty scheme first if none exists), place with screen-center raycast anchor using `centerXY + minZ`, remap IDs/groups, and select imported items.
- The facade still owns `importJSON`, `exportJSON`, and shared save-preparation (`prepareDataForSave`) with validation-derived corrections (out-of-bounds filtering, oversized-group ungrouping, scale clamp, invalid-axis rotation reset).
- File I/O logic is tightly coupled with validation (via `validationStore` and worker results) and game metadata (`gameDataStore`) to ensure exported data respects in-game limits.

### Internationalization and SEO

- Runtime i18n:
  - `useI18n` in `src/composables/useI18n.ts` manages the current `Locale` (`'zh' | 'en'`), persists it in `localStorage`, and exposes `t(key, params?)` translation lookup using nested keys.
  - Locales live under `src/locales/zh` and `src/locales/en` and drive UI strings, command labels, and menus.
- SEO / static HTML i18n:
  - `scripts/build-i18n.js` post-processes `dist/index.html` into `dist/en/index.html`, updating `<html lang>`, titles, meta tags, Open Graph tags, and canonical URLs for the English site.
  - Vite's PWA plugin (`vite.config.ts`) is configured with a manifest and Workbox runtime caching tailored for HTML, JS/CSS, fonts, images, 3D models, and JSON data.

### UI layout components

- `Toolbar.vue` – top menubar + tab strip + global settings dialog:
  - Uses `commandStore` for File/Edit/View/Tool/Help menus and view preset submenus.
  - Renders re-orderable scheme/doc tabs with context menus for close/close-others/rename.
  - Shows watch-mode status from `fileOps.watchState`.
- `Sidebar.vue` – right-hand panel switching between:
  - Structure view (`SidebarSelection`) for selected items/groups with hover-to-highlight (`sidebarHoveredGameId`).
  - Transform panel (`SidebarTransform`) for numeric coordinate/rotation/scale editing:
    - Uses `useTransformSelection` composable for selection info calculation.
    - Sub-components: `TransformAxisInputs` (reusable 3-axis input), `TransformRotationSection` (rotation + custom pivot), `TransformAlignSection` (align & distribute).
  - Editor settings (`SidebarEditorSettings`) for 3D and validation options.
- `CanvasToolbar.vue` – floating toolbar within the 3D canvas area.
- `StatusBar.vue` – bottom status area surfaces validation summaries, selection counts, and autosave/watch indicators.
- `FurnitureLibrary.vue` – furniture inventory panel for adding items.
- `DyePanel.vue` – furniture color/dye editing panel.
- `LoadingProgress.vue` – loading progress indicator.
- Docs under `src/components/docs` (`QuickStart`, `UserGuide`, `FAQ` in both zh/en) are displayed inside the app via `DocsViewer` and the doc tab.

### Serverless functions

- `netlify/functions/` and `netlify/edge-functions/` – Netlify serverless functions
- `functions/` – Cloudflare Pages functions (includes `functions/api/` for the login endpoint used by secure mode)

### Type system (`src/types/`)

- `editor.ts` – Core domain types: `AppItem`, `GameItem`, `GameDataFile`, `HomeScheme`, `ClipboardData`, `ClosedSchemeHistory`, `TransformParams`, `WorkingCoordinateSystem`, `HistorySnapshot`, `FileWatchState`, `GameColorMap`
- `furniture.ts` – Furniture metadata: `FurnitureItem`, `FurnitureModelConfig`, `FurnitureMeshConfig`, `FurnitureColorConfig`, `FurnitureDB`
- `persistence.ts` – Workspace persistence: `WorkspaceSnapshot`, `HomeSchemeSnapshot`, `ValidationResult`
- `tab.ts` – Tab types: `Tab`, `TabType`
- `constants.ts` – Render constants: `MAX_RENDER_INSTANCES`, `RAYCAST_SKIP_ITEM_THRESHOLD`

## Notes for future changes

- When adding major features, prefer to extend existing composables and stores instead of duplicating logic:
  - New editor operations should be built as composables under `src/composables/editor` and orchestrated via `commandStore` and `Toolbar`.
  - New visualizations or render modes should integrate with `useThreeInstancedRenderer` and its per-mode modules so that selection, picking, and highlighting remain consistent.
  - Any changes to save/load semantics should flow through `editorStore` and the `useFileOperations` facade (`fileOps/watchMode.ts`, `fileOps/codeImport.ts`) and, if relevant, be reflected in `workspace.worker.ts` validation rules.
- If you introduce a test runner or additional build/lint tooling, update the **Commands** section accordingly.
