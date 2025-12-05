<script setup lang="ts"></script>

<template>
  <div class="doc-content">
    <h1>Quick Start</h1>

    <p class="text-sm text-muted-foreground">
      We recommend using Chrome or Edge browser for the best experience.
    </p>

    <h2>Project Introduction</h2>
    <p>
      <strong>BuildingMomo</strong> is a visualization editor tool designed specifically for the
      Infinity Nikki game to edit home schemes.
    </p>
    <p>
      <strong>Core Features:</strong>
    </p>
    <ul>
      <li>Batch manage large building groups</li>
      <li>Merge building groups across different home schemes</li>
      <li>Visual coordinate editing (WYSIWYG)</li>
    </ul>
    <p class="text-sm text-muted-foreground">
      Designed for players with special building needs (complex adjustments, scheme merging, batch
      grouping).
    </p>

    <h2>Scenario: Merging Across Schemes</h2>
    <p>
      <strong>Scenario:</strong> You've built a garden in Scheme 1 and want to move it to Scheme 2
      without rebuilding.
    </p>

    <h3>Step 1: Import Scheme 1</h3>
    <ol>
      <li>In-game, enter build mode (ensure Scheme 1 is active)</li>
      <li>Click top-right menu → <strong>Recover from Stuck > Confirm</strong></li>
      <li>In editor, click <strong>File > Link Game Folder</strong></li>
      <li>Select your game folder (<code>InfinityNikki</code> folder)</li>
      <li>Confirm import, Scheme 1 opens in a new tab</li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>Finding game folder:</strong><br />
      In the launcher, click the arrow next to "Launch Game" and select "Open Installation
      Location".
    </p>

    <h3>Step 2: Import Scheme 2</h3>
    <ol>
      <li>Return to game, re-enter build mode</li>
      <li>Select <strong>Cancel</strong> on "Restore Building" dialog</li>
      <li>Load Scheme 2 (target scheme)</li>
      <li>Click top-right menu → <strong>Recover from Stuck > Confirm</strong></li>
      <li>In editor, confirm import, Scheme 2 opens as the second tab</li>
    </ol>

    <p class="text-sm text-muted-foreground">
      Editor should now have two tabs: Scheme 1 and Scheme 2.
    </p>

    <h3>Step 3: Copy Buildings</h3>
    <ol>
      <li>Switch to Scheme 1 tab</li>
      <li>
        Drag to select the area to copy:
        <ul>
          <li>Left-click and drag to select</li>
          <li><code>Shift + Drag</code> to add to selection</li>
          <li><code>Alt + Drag</code> to deselect</li>
        </ul>
      </li>
      <li>Press <code>Ctrl + C</code> to copy</li>
    </ol>

    <h3>Step 4: Paste to Target</h3>
    <ol>
      <li>Switch to Scheme 2 tab</li>
      <li>Press <code>Ctrl + V</code> to paste</li>
      <li>Drag to adjust position</li>
      <li>Press <code>Ctrl + S</code> or click <strong>File > Save to Game</strong></li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>Tip:</strong> Click <strong>Group</strong> in the right menu to group items. They will
      remain grouped in-game for easier adjustments.
    </p>

    <h3>Step 5: Apply In-Game</h3>
    <ol>
      <li>Return to game, re-enter build mode</li>
      <li>Select <strong>Restore</strong> on "Restore Building" dialog</li>
      <li>Done! Your buildings are now in Scheme 2</li>
    </ol>

    <div class="doc-success">
      ✅ <strong>Congratulations!</strong> You've mastered cross-scheme merging.
    </div>

    <h2>Scenario: Multi-Story Load Limit Workaround</h2>
    <p>
      <strong>Problem:</strong> Multi-story buildings consume high local load even when empty. Since
      the game's local load calculation covers all heights in an area, this prevents adding
      furniture throughout the entire building.
      <br />
      <br />
      <strong>Solution:</strong> Using first-floor decoration as an example, use this tool to
      temporarily <strong>transfer upper-floor items to a newly created empty scheme</strong>. After
      decorating the first floor, paste them back.
    </p>

    <h3>Step 1: Select Building</h3>
    <ol>
      <li>Drag-select the entire building (all floors)</li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>Tip:</strong> Use <strong>Top View</strong> for easier selection.
    </p>

    <h3>Step 2: Deselect First Floor</h3>
    <ol>
      <li>Switch to <strong>Perspective</strong> or <strong>Front View</strong></li>
      <li>Hold <code>Alt</code> and drag-select first-floor items to deselect them</li>
      <li>Only upper floors should remain selected</li>
    </ol>

    <h3>Step 3: Transfer Upper Floors</h3>
    <ol>
      <li>Ensure upper-floor items are selected</li>
      <li>Press <code>Ctrl + X</code> to cut</li>
      <li>Click <strong>File &gt; New Scheme</strong> to create a temporary tab</li>
      <li>Press <code>Ctrl + V</code> to paste items to the temporary scheme</li>
      <li>Switch back to original scheme tab, press <code>Ctrl + S</code> to save</li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>Tip:</strong> If you're comfortable with coordinates, you can alternatively use the
      horizontal offset method (Relative mode in Transform Panel, X or Y = <code>5000</code>), but
      the new scheme method is safer and more intuitive.
    </p>

    <h3>Step 4: Decorate First Floor</h3>
    <ol>
      <li>In-game, load scheme. Upper floors are now transferred away, freeing up load capacity</li>
      <li>Decorate the first floor without load warnings</li>
    </ol>

    <h3>Step 5: Restore Building</h3>
    <ol>
      <li>After decorating, click <strong>Recover from Stuck</strong> in-game to save progress</li>
      <li>In editor, re-import the scheme (opens as a new tab)</li>
      <li>Switch to the temporary scheme tab, press <code>Ctrl + A</code> to select all items</li>
      <li>Press <code>Ctrl + X</code> to cut</li>
      <li>Switch to the newly imported scheme tab, press <code>Ctrl + V</code> to paste back</li>
      <li>Press <code>Ctrl + S</code> to save, return to game and restore building. Done!</li>
    </ol>

    <h2>Next Steps</h2>
    <p>Learn more:</p>
    <ul>
      <li><strong>User Guide:</strong> Detailed workflow and advanced features</li>
      <li><strong>FAQ:</strong> Solutions to common issues</li>
    </ul>
    <p class="text-sm text-muted-foreground">
      <strong>Shortcuts:</strong> <code>Ctrl + C/V</code> Copy/Paste, <code>Delete</code> Delete,
      <code>Ctrl + Z</code> Undo
    </p>
  </div>
</template>
