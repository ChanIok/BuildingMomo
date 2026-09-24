<template>
  <div class="doc-content">
    <h1>FAQ</h1>

    <h2>Safety Notice</h2>

    <div class="doc-warning">
      <strong>Please read carefully before using this tool.</strong>
    </div>

    <h3>How it Works</h3>
    <p>
      <strong
        >This tool is, at its core, a visual JSON editor for the game's home building data.</strong
      >
    </p>
    <p>
      The game stores home building data as plain text JSON files in the local
      <code>BuildData\BUILD_SAVEDATA_[UID].json</code> file. Each entry contains a furniture item's
      coordinates, rotation angles, and scale values — unencrypted and unobfuscated.
    </p>
    <p>
      This tool reads those files via standard browser File System Access APIs, renders them in 3D
      for visual editing, and writes back the same JSON format. Everything runs locally in the
      browser — no game process interaction, no data uploaded.
    </p>

    <h3>Can I Do This Without the Tool?</h3>
    <p>
      Absolutely, and for players with concerns, we recommend using this simplest method. You can
      open the aforementioned files with Notepad, manually edit the coordinate and rotation values,
      save, and import back into the game. It's even more direct — you just need to memorize every
      furniture item's ID, calculate 3D coordinates and Euler angles by hand, and make sure you
      don't misplace a single comma.
    </p>

    <h3>Is this Officially Approved?</h3>
    <p>
      <strong>No.</strong> While the game validates data on import and has a review mechanism,
      actively modifying these files is <strong>not explicitly officially supported</strong>.
    </p>

    <h3>Risks</h3>
    <p>Theoretical risks include:</p>
    <ul>
      <li>Data corruption or loss</li>
      <li>Scheme failing in-game review</li>
      <li>Account restrictions (though unlikely for local file edits)</li>
    </ul>

    <h3>Disclaimer</h3>
    <p><strong>By using this tool, you agree that:</strong></p>
    <ul>
      <li><strong>Use at Own Risk:</strong> You assume all responsibility for any consequences.</li>
      <li><strong>Compliance:</strong> You will use the tool in accordance with local laws.</li>
      <li><strong>Personal Use Only:</strong> Not for commercial use.</li>
    </ul>

    <div class="doc-warning">
      <strong>If you are uncomfortable with these risks, please do not use this tool.</strong><br />
      This tool is designed as an interim solution for players with specific needs until official
      building tools become available.
    </div>

    <h2>Troubleshooting</h2>

    <h3>Furniture Replaced by Old Scheme After Restoring In-Game</h3>
    <p>
      <strong>Issue:</strong>
      After the version 2.9 update, when selecting <strong>"Restore Build"</strong> in-game,
      furniture items in the scheme are largely replaced by items from your previous scheme.
    </p>
    <p>
      <strong>Cause:</strong>
      The game updated its build restore mechanism. When furniture IDs (Instance ID) in the scheme
      saved from the editor overlap with IDs used in the current in-game scheme, the game mistakenly
      retains the old furniture entries.
    </p>
    <p><strong>Solutions (choose one):</strong></p>
    <ol>
      <li>
        <strong>Method 1: Clear and save in-game (Easiest)</strong>
        <ul>
          <li>Enter building mode in-game and use <strong>"Clear All"</strong>.</li>
          <li>
            <strong>"Save"</strong> and exit building mode (to fully release ID allocations
            in-game).
          </li>
          <li>
            Return to the editor, <strong>"Save to Game"</strong>, and restore the build in-game
            again.
          </li>
        </ul>
      </li>
      <li>
        <strong>Method 2: Reassign IDs in the editor (No in-game clearing needed)</strong>
        <ul>
          <li>Import your currently active in-game scheme into the editor.</li>
          <li>
            Press <code>Ctrl + A</code> to select all, then press <code>Delete</code> to remove
            them.
          </li>
          <li>
            Switch to the target scheme tab, press <code>Ctrl + A</code> to select all, and press
            <code>Ctrl + C</code> to copy.
          </li>
          <li>
            Switch back to the cleared tab, press <code>Ctrl + V</code> to paste, and
            <strong>"Save to Game"</strong> (new non-conflicting IDs will be automatically
            assigned).
          </li>
        </ul>
      </li>
    </ol>

    <h3>"Can't Open This Folder" (Contains System Files)</h3>
    <p>
      <strong>Issue:</strong> After clicking <strong>File &gt; Link Game Folder</strong>, the
      browser shows a dialog saying it can't open the folder because it contains system files.
    </p>
    <p>
      <strong>Cause:</strong> The game is installed under a path browsers block web apps from
      accessing, such as <code>Program Files</code>. This is a Chrome / Edge security restriction
      that the tool cannot bypass.
    </p>
    <p><strong>Solutions (choose one):</strong></p>
    <ol>
      <li>
        <strong>Move the game to a normal path</strong>
        <ul>
          <li>Move the entire game folder to a normal location such as <code>D:\Games\</code></li>
          <li>
            Game launcher → Settings (top-right) → Download Settings → Game Installation Path →
            folder icon to select the new directory (no re-download or full reinstall required)
          </li>
        </ul>
      </li>
      <li>
        <strong>Use manual import/export instead</strong>
        <ul>
          <li>
            <strong>File &gt; Import Data</strong>: select a JSON file from the game's
            <code>BuildData</code> folder
          </li>
          <li>
            <strong>File &gt; Export Data</strong>: download after editing, then manually copy back
            to <code>BuildData</code> to replace the original file
          </li>
          <li>Do not use folder monitoring</li>
        </ul>
      </li>
    </ol>

    <h3>"Save to Game" Permission Error</h3>
    <p>
      <strong>Issue:</strong> The game folder is already linked (top-right shows
      <strong>Monitoring</strong>), but saving fails with an error like
      <code>...could not be modified due to the state of the underlying filesystem</code>.
    </p>
    <p>
      <strong>Cause:</strong> The browser granted write permission, but Windows rejected the actual
      write. Usually the directory containing <code>BuildData</code> is not writable for your user.
    </p>
    <p><strong>Solutions (choose one):</strong></p>
    <ol>
      <li>
        <strong>Run browser as administrator (Recommended)</strong>
        <ul>
          <li>Close your browser completely</li>
          <li>Right-click browser icon → "Run as administrator"</li>
          <li>Re-open the editor website</li>
        </ul>
      </li>
      <li>
        <strong>Modify folder permissions</strong>
        <ul>
          <li>Right-click the <code>BuildData</code> folder → Properties → Security → Edit</li>
          <li>Select your current user (or Everyone)</li>
          <li>Check "Allow" for "Full control"</li>
        </ul>
      </li>
      <li>
        <strong>Use manual import/export instead</strong>
        <ul>
          <li>
            <strong>File &gt; Import Data</strong>: select a JSON file from the game's
            <code>BuildData</code> folder
          </li>
          <li>
            <strong>File &gt; Export Data</strong>: download after editing, then manually copy back
            to <code>BuildData</code> to replace the original file
          </li>
          <li>Without using <strong>Save to Game</strong></li>
        </ul>
      </li>
    </ol>

    <h3>Import Prompts Appear During Building</h3>
    <p>
      <strong>Issue:</strong> The editor shows "File Update Detected" import prompts even though you
      didn't manually click "Recover from Stuck."
    </p>
    <p>
      <strong>Cause:</strong> This is normal. The game auto-saves building data about every 5
      minutes, and the monitoring mode detects these file changes.
    </p>
    <p><strong>What to Do:</strong></p>
    <ul>
      <li>
        To avoid popups, disable <strong>Watch Popup</strong> in settings and use
        <strong>Monitoring BuildData</strong> in the top-right corner to view history and load the
        latest scheme
      </li>
    </ul>

    <h3>No Import Dialog After 'Recover from Stuck'</h3>
    <p>
      <strong>Troubleshooting:</strong> Check if the top-right corner shows
      <strong>Monitoring BuildData</strong>. If not, click
      <strong>File &gt; Link Game Folder</strong> to restart. Monitoring restores automatically
      after page refresh; re-authorization is usually not needed.
    </p>

    <h2>Data Sources</h2>

    <h3>Furniture Data</h3>
    <p>
      Furniture names and icons are provided by
      <a
        href="https://nuan5.pro"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      >
        NUAN5.PRO
      </a>
      . Thanks for their support!
    </p>

    <h2>Feedback</h2>
    <p>For bug reports or feature requests:</p>
    <p>
      <a
        href="https://github.com/ChanIok/BuildingMomo/issues"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      >
        GitHub Issues
      </a>
    </p>

    <h2>About</h2>
    <ul>
      <li>
        <strong>Motivation:</strong> The official editor was driving me crazy. Instead of waiting, I
        built this.
      </li>
      <li>
        <strong>Maintenance:</strong> I'll keep this updated as long as I'm still playing the game.
      </li>
      <li>
        <strong>Copyright:</strong> Code is open source under the
        <a
          href="https://github.com/ChanIok/BuildingMomo/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          MIT License </a
        >. Game assets belong to the original developer.
      </li>
    </ul>
  </div>
</template>
