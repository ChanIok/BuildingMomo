<template>
  <div class="doc-content">
    <h1>User Guide</h1>

    <h2>Importing Build Data</h2>

    <h3>Method 1: Link Game Folder (Recommended)</h3>
    <ol>
      <li>Click <strong>File &gt; Link Game Folder</strong> in the top menu bar</li>
      <li>
        Browse and select the <code>InfinityNikkiGlobal</code> folder in your game installation
        directory
      </li>
      <li>The system will auto-load the current scheme and watch for file changes in real-time</li>
      <li>
        In-game, use <strong>Recover from Stuck</strong> to export build data, then return to the
        editor to import
      </li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>How to find your game installation folder:</strong><br />
      In the game launcher, click the small arrow next to the "Start Game" button, then select "Open
      Installation Location" to get the game path.
    </p>

    <h3>Method 2: Import JSON File Manually</h3>
    <ol>
      <li>Click <strong>File &gt; Import Build Data</strong> in the top menu bar</li>
      <li>
        Find the build data file in your game installation directory:<br />
        <code
          >InfinityNikkiGlobal\X6Game\Saved\SavedData\BuildData\BUILD_SAVEDATA_[YourUID].json</code
        >
      </li>
      <li>Select the JSON file to import, and it will open as a new scheme tab</li>
    </ol>

    <h2>Views & Camera</h2>

    <h3 class="mt-4 mb-2 text-base font-medium">1. Perspective View</h3>
    <p>Simulates human vision, with two control modes:</p>
    <ul>
      <li>
        <strong>Orbit Mode (Default)</strong>:
        <ul>
          <li><strong>Rotate</strong>: Hold <code>Middle Mouse</code> and drag</li>
          <li><strong>Zoom</strong>: Mouse wheel</li>
        </ul>
      </li>
      <li>
        <strong>Flight Mode</strong>: Press <code>W/A/S/D</code> to enter, similar to game controls.
        <ul>
          <li>
            <strong>Move</strong>: <code>W/A/S/D</code> (forward/back/left/right) |
            <strong>Up/Down</strong>: <code>Q</code>(down) <code>Space</code>(up) |
            <strong>Speed</strong>: Hold <code>Shift</code>
          </li>
          <li><strong>Look Around</strong>: Hold <code>Middle Mouse</code> and drag</li>
          <li>
            <strong>Exit</strong>: Press <code>F</code> to focus selected items and return to orbit
            mode
          </li>
        </ul>
      </li>
    </ul>

    <h3 class="mt-4 mb-2 text-base font-medium">2. Orthographic View</h3>
    <p>
      Parallel projection with no perspective distortion (like top view), locked and cannot rotate:
    </p>
    <ul>
      <li>
        <strong>Pan Canvas</strong>: Hold <code>Middle Mouse</code> and drag, or
        <code>Space + Left Click</code> and drag
      </li>
      <li><strong>Zoom Canvas</strong>: Mouse wheel</li>
    </ul>

    <h3 class="mt-4 mb-2 text-base font-medium">Common Controls</h3>
    <ul>
      <li>
        <strong>Frame Selection (F)</strong>: Select an item and press <code>F</code> to quickly
        focus on it, a lifesaver when you're lost.
      </li>
      <li><strong>Reset View</strong>: Menu bar <strong>View &gt; Reset View</strong></li>
    </ul>

    <h2>Core Editing</h2>

    <h3>Selecting Items</h3>
    <ul>
      <li><strong>Basic Selection</strong>: Click to select, drag to box select.</li>
      <li>
        <strong>Combined Selection</strong>: <code>Shift</code> to add, <code>Alt</code> to
        subtract, <code>Shift + Alt</code>
        to intersect.
      </li>
      <li><strong>Select All</strong>: <code>Ctrl + A</code> (selects all visible items).</li>
    </ul>

    <h3>Moving & Transforming</h3>
    <ul>
      <li>
        <strong>Shortcuts</strong>: <code>Ctrl + C/V</code> (copy/paste), <code>Del</code> (delete),
        <code>Ctrl + Z/Y</code>
        (undo/redo).
      </li>
      <li>
        <strong>Move/Rotate</strong>: After selection, drag the colored axes, or enter values in the
        transform panel on the right.
      </li>
      <li>
        <strong>Grouping</strong>: <code>Ctrl + G</code> (group), <code>Ctrl + Shift + G</code>
        (ungroup). Grouped items can be moved/copied as a whole.
      </li>
    </ul>

    <h3>Groups Panel</h3>
    <p>
      Click <strong>Groups</strong> in the bottom canvas toolbar, or press <code>O</code> to open
      the panel.
    </p>
    <ul>
      <li>
        <strong>Collections</strong>: Create collections to organize groups, with support for
        nesting. Drag groups or collections, or right-click and choose “Move to” to change their
        location.
      </li>
      <li>
        <strong>Selection and batch moves</strong>: Click to select a group or collection,
        <code>Ctrl</code>-click to select multiple, and <code>Shift</code>-click to select a range.
        Drag the selection or use “Move to” for batch moves. “Ungrouped” lists furniture with no
        group.
      </li>
      <li>
        <strong>Rename and collapse</strong>: Double-click a name or press <code>F2</code> to
        rename. Click the arrow beside a collection to expand or collapse it. Deleting a collection
        keeps its furniture.
      </li>
      <li>
        <strong>Hide</strong>: Click the eye to toggle visibility, or <code>Alt</code>-click to show
        only that item. Click “Show all” to restore visibility. Hidden furniture is still exported.
      </li>
      <li>
        <strong>Lock</strong>: Click the lock to prevent furniture in a group or collection from
        being selected or edited. Click “Unlock all” to clear all locks.
      </li>
    </ul>
    <p>
      Group names and collections are saved with the scheme, but are not included in game JSON.
      Visibility, locks and collapse state are saved only in your own workspace.
    </p>

    <h2>Advanced Features</h2>

    <h3>Coordinate System</h3>
    <p>
      Enable via menu bar <strong>View &gt; Coordinate System</strong>. Supports rotating the
      coordinate axes, specifically for editing building groups with diagonal layouts like 45°.
    </p>

    <h3>Scheme Validation</h3>
    <p>
      The editor automatically detects and displays warnings in the bottom status bar. Click the
      warning to locate issues:
    </p>
    <ul>
      <li><strong>Duplicate Items</strong>: Items with identical position, rotation, and scale.</li>
      <li><strong>Area Limits</strong>: Items outside the valid build area or height limit.</li>
      <li><strong>Group Size Limit</strong>: Groups with more than 50 items (game limitation).</li>
    </ul>

    <h3>Workspace Memory</h3>
    <p>
      The system automatically saves your current scheme and unsaved changes. After accidental
      closure, you can recover to the previous state. Clearing browser data may result in state
      loss.
    </p>

    <h3>Scheme Archive</h3>
    <p>
      Used to centrally manage and archive multiple home building schemes. Archive data is stored
      directly in the <code>InfinityNikki\X6Game\BuildingMomo</code> folder within your game
      installation directory.
    </p>
    <ul>
      <li>
        <strong>Persistent Storage</strong>: Unlike workspace memory in tabs, the archive operates
        independently of the browser. Even if you clear browser cache or switch browsers, your
        archive data <strong>will not be lost</strong>.
      </li>
    </ul>
    <div class="doc-danger">
      <strong>Backup Reminder:</strong><br />
      Because the data is stored within the game directory,
      <strong
        >before uninstalling or reinstalling the game, please make sure to manually backup the
        <code>BuildingMomo</code> folder</strong
      >
      to prevent accidental loss of your archived data.
    </div>

    <h2>Display & Performance</h2>
    <ul>
      <li>
        <strong>Simple Blocks (Recommended)</strong>: Default mode, best performance, ideal for
        large-scale layout editing.
      </li>
      <li><strong>Icon Mode</strong>: Displays game icons, easier to identify item types.</li>
      <li><strong>Full Volume</strong>: Shows physics bounding box for previewing space usage.</li>
    </ul>

    <h2>Saving & Exporting Data</h2>

    <h3>Method 1: Save to Game (Recommended)</h3>
    <p>Available when you import via "Link Game Folder":</p>
    <ol>
      <li>
        After editing, press <code>Ctrl + S</code> or click <strong>File &gt; Save to Game</strong>
      </li>
      <li>The file will directly overwrite the scheme file in your game directory</li>
      <li>Return to the game and restore your build data as usual to apply the changes</li>
    </ol>

    <h3>Method 2: Export JSON File</h3>
    <ol>
      <li>Click <strong>File &gt; Export Data</strong></li>
      <li>Choose save location and download the JSON file</li>
      <li>
        Manually copy to game directory and replace the original file:<br />
        <code
          >InfinityNikkiGlobal\X6Game\Saved\SavedData\BuildData\BUILD_SAVEDATA_[YourUID].json</code
        >
      </li>
    </ol>

    <h2>Best Practices</h2>
    <ul>
      <li>
        <strong>Do 80% of layout in 2D first</strong>: Recommended to complete most arrangement work
        in <strong>Top View + Simple Blocks mode</strong>.
      </li>
      <li>
        <strong>Use perspective view for detail checks</strong>: Only switch to perspective view
        briefly when you need to check height, occlusion, or final appearance for preview and
        fine-tuning.
      </li>
      <li>
        <strong>Organize complex buildings with groups</strong>: Hide or lock other groups in the
        Groups Panel to focus on the part you are editing.
      </li>
    </ul>
  </div>
</template>
