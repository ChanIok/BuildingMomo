<template>
  <div class="doc-content">
    <h1>User Guide</h1>

    <h2>Importing Schemes</h2>

    <h3>Method 1: Link Game Folder (Recommended)</h3>
    <ol>
      <li>Click <strong>File > Link Game Folder</strong></li>
      <li>Select the <code>InfinityNikki</code> folder in your game installation directory</li>
      <li>The system auto-loads current scheme and watches for changes</li>
      <li>In-game, use "Recover from Stuck" to export data, then import in editor</li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>Finding game folder:</strong><br />
      In the launcher, click the arrow next to "Launch Game" and select "Open Installation
      Location".
    </p>

    <h3>Method 2: Import JSON Manually</h3>
    <ol>
      <li>Click <strong>File > Import Data</strong></li>
      <li>
        Browse to:
        <code>InfinityNikki\X6Game\Saved\SavedData\BuildData\BUILD_SAVEDATA_[UID].json</code>
      </li>
      <li>Select the file to open in a new tab</li>
    </ol>

    <h2>Basic Operations</h2>

    <h3>Selecting</h3>
    <ul>
      <li><strong>Click:</strong> Select single item</li>
      <li><strong>Drag Select:</strong> Click and drag background to draw box</li>
      <li><strong>Add to Selection:</strong> <code>Shift + Drag</code></li>
      <li><strong>Deselect:</strong> <code>Alt + Drag</code></li>
      <li><strong>Intersect:</strong> <code>Shift + Alt + Drag</code> (keep intersection)</li>
      <li><strong>Select All:</strong> <code>Ctrl + A</code></li>
    </ul>

    <h3>Moving</h3>
    <ul>
      <li><strong>Gizmo:</strong> Drag colored arrows (X/Y/Z) or plane handles</li>
      <li>
        <strong>Transform Panel (Sidebar):</strong> Edit Position (X, Y, Z)
        <ul>
          <li><strong>Absolute:</strong> Set world coordinates directly</li>
          <li><strong>Relative:</strong> Move by delta value (useful for multi-selection)</li>
        </ul>
      </li>
    </ul>

    <h3>Rotating</h3>
    <ul>
      <li><strong>Transform Panel:</strong> Edit Rotation (°)</li>
      <li>
        <strong>Axes: </strong>
        <span style="color: #ef4444">X (Pitch)</span>, <span style="color: #84cc16">Y (Yaw)</span>,
        <span style="color: #3b82f6">Z (Roll)</span>
      </li>
      <li>
        <strong>Relative Mode:</strong> Add rotation to current angle (forced for multi-selection)
      </li>
    </ul>

    <h3>Clipboard & Delete</h3>
    <ul>
      <li><strong>Copy/Paste:</strong> <code>Ctrl + C</code> / <code>Ctrl + V</code></li>
      <li><strong>Cut:</strong> <code>Ctrl + X</code></li>
      <li><strong>Delete:</strong> <code>Delete</code> key</li>
      <li><strong>Cross-Scheme:</strong> Copy/paste works between tabs</li>
    </ul>

    <h3>Camera Controls</h3>

    <h4 class="mt-4 mb-2 text-base font-medium">1. Perspective View</h4>
    <ul>
      <li>
        <strong>Orbit (Default):</strong>
        <ul>
          <li><strong>Rotate:</strong> Middle Mouse Drag</li>
          <li><strong>Zoom:</strong> Mouse Wheel</li>
          <li>
            <strong>Pan:</strong> <code>WASD</code> keys (Mouse pan not supported in perspective)
          </li>
        </ul>
      </li>
      <li>
        <strong>Flight Mode:</strong> Press <code>WASD</code> to enter
        <ul>
          <li>
            <strong>Move:</strong> <code>WASD</code> + <code>Space</code>(Up)/<code>Q</code>(Down)
          </li>
          <li><strong>Look:</strong> Middle Mouse Drag</li>
          <li><strong>Speed:</strong> Hold <code>Shift</code></li>
          <li><strong>Exit:</strong> Press <code>F</code> to focus selection</li>
        </ul>
      </li>
    </ul>

    <h4 class="mt-4 mb-2 text-base font-medium">2. Orthographic View (Top/Front/etc.)</h4>
    <ul>
      <li><strong>Pan:</strong> Middle Mouse Drag (or Space + Left Drag)</li>
      <li><strong>Zoom:</strong> Mouse Wheel</li>
    </ul>

    <h4 class="mt-4 mb-2 text-base font-medium">Helpers</h4>
    <ul>
      <li><strong>Frame Selection (F):</strong> Center view on selected items</li>
      <li><strong>Frame All:</strong> <strong>View > Frame All</strong></li>
    </ul>

    <h3>Display Modes</h3>
    <ul>
      <li>
        <strong>Block Mode (Default):</strong><br />
        Displays items as standard cubes. Best for layout and selection.
        <span class="text-sm text-muted-foreground">
          (Adjust size with bottom-left slider or <code>Ctrl + Wheel</code>)
        </span>
      </li>
      <li>
        <strong>Bounding Box:</strong><br />
        Displays physics bounding box. Good for checking space usage.
      </li>
      <li>
        <strong>Icon Mode:</strong><br />
        Displays game icons. Icons face camera in perspective view.
      </li>
    </ul>

    <h3>Undo/Redo</h3>
    <ul>
      <li><strong>Undo:</strong> <code>Ctrl + Z</code> (50 steps)</li>
      <li><strong>Redo:</strong> <code>Ctrl + Y</code></li>
    </ul>

    <h2>Advanced Features</h2>

    <h3>Grouping</h3>
    <ul>
      <li><strong>Group:</strong> <code>Ctrl + G</code></li>
      <li><strong>Ungroup:</strong> <code>Ctrl + Shift + G</code></li>
      <li><strong>Behavior:</strong> Groups act as single units for selection and transform.</li>
    </ul>

    <h3>Coordinate System</h3>
    <p>Rotate workspace axes for diagonal layouts (e.g., 45° buildings).</p>
    <ul>
      <li><strong>Enable:</strong> <strong>View > Coordinate System</strong></li>
      <li><strong>Usage:</strong> Movement follows the rotated axes when enabled.</li>
    </ul>

    <h3>Scheme Validation</h3>
    <p>
      Warnings appear in the status bar for potential issues.
      <strong>Click warning to select problem items.</strong>
    </p>
    <ul>
      <li><strong>Duplicates:</strong> Items at exact same position/rotation.</li>
      <li><strong>Out of Bounds:</strong> Items outside valid game area.</li>
      <li><strong>Group Size:</strong> Groups with >50 items (Game limit).</li>
    </ul>

    <h2>Exporting</h2>

    <h3>Save to Game</h3>
    <ol>
      <li>Press <code>Ctrl + S</code> or <strong>File > Save to Game</strong></li>
      <li>Overwrites game file directly (if folder linked)</li>
      <li>Reload in game to see changes</li>
    </ol>

    <h3>Export JSON</h3>
    <ol>
      <li><strong>File > Export Data</strong></li>
      <li>Save JSON file, then manually replace the file in game folder</li>
    </ol>

    <h2>Best Practices</h2>
    <ul>
      <li>
        <strong>Modular Editing:</strong>
        Cut complex sections to a new tab to edit in isolation, then paste back.
      </li>
      <li>
        <strong>2D Workflow: </strong>
        <strong>80% of work can be done in Top View + Block Mode.</strong> It's faster and more
        precise than flying around in 3D.
      </li>
    </ul>
  </div>
</template>
