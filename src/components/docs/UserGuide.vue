<template>
  <div class="doc-content">
    <h1>使用指南</h1>

    <h2>导入游戏方案</h2>

    <h3>方式一：从游戏目录导入（推荐）</h3>
    <ol>
      <li>点击顶部菜单栏 <strong>文件 &gt; 选择游戏目录</strong></li>
      <li>浏览并选择游戏安装目录的 <code>InfinityNikki</code> 文件夹</li>
      <li>系统会自动加载当前方案，并实时监控文件变化</li>
      <li>在游戏中点击 脱离卡死 后导出建造数据，回到编辑器后导入即可</li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>如何找到游戏安装目录：</strong><br />
      在游戏启动器的「启动游戏」按钮右侧小箭头，点击「打开安装位置」即可获取游戏路径。
    </p>

    <h3>方式二：手动导入 JSON 文件</h3>
    <ol>
      <li>点击顶部菜单栏 <strong>文件 &gt; 导入建造数据</strong></li>
      <li>
        在游戏安装目录下找到建造数据文件：<br />
        <code>InfinityNikki\X6Game\Saved\SavedData\BuildData\BUILD_SAVEDATA_[用户UID].json</code>
      </li>
      <li>选择该 JSON 文件导入，文件会作为新方案标签打开</li>
    </ol>

    <h2>基础操作</h2>

    <h3>选择物品</h3>
    <ul>
      <li><strong>单击</strong>：选中单个物品</li>
      <li><strong>框选工具</strong>：按住鼠标左键拖拽矩形区域选择</li>
      <li><strong>套索工具</strong>：自由绘制曲线选择物品（点击工具栏切换到套索模式）</li>
      <li><strong>添加选择</strong>：<code>Shift + 框选/套索</code>（追加到当前选择）</li>
      <li><strong>减选</strong>：<code>Alt + 框选/套索</code>（从当前选择中移除）</li>
      <li><strong>交叉选择</strong>：<code>Shift + Alt + 框选/套索</code>（仅保留交集）</li>
      <li><strong>全选可见物品</strong>：<code>Ctrl + A</code></li>
    </ul>

    <h3>移动物品</h3>
    <ul>
      <li><strong>变换轴工具（Gizmo）</strong>：选中物品后，会显示三个彩色箭头和平面</li>
      <li>
        <strong>沿轴移动</strong>：拖拽 <span style="color: #ef4444">红色（X）</span>、<span
          style="color: #84cc16"
          >绿色（Y）</span
        >、<span style="color: #3b82f6">蓝色（Z）</span> 箭头，沿对应轴向移动
      </li>
      <li><strong>平面移动</strong>：拖拽轴之间的小方块，在对应平面内自由移动</li>
      <li>
        <strong>侧边栏数值编辑</strong>：选中物品后，右侧「变换」面板会显示位置 (X、Y、Z) 输入框
        <ul>
          <li><strong>绝对模式</strong>：直接设置物品的世界坐标位置</li>
          <li><strong>相对模式</strong>：输入增量值，在当前位置基础上移动物品（多选物品时常用）</li>
          <li>
            <strong>多选范围</strong>：多选物品时，可查看和调整选中物品的坐标范围（Min ~ Max）
          </li>
        </ul>
      </li>
    </ul>

    <h3>旋转物品</h3>
    <ul>
      <li><strong>侧边栏数值编辑</strong>：选中物品后，右侧「变换」面板会显示旋转 (°) 输入框</li>
      <li>
        <strong>旋转轴说明</strong>：
        <ul>
          <li><span style="color: #ef4444">X 轴</span>：绕 X 轴旋转（俯仰/倾斜）</li>
          <li><span style="color: #84cc16">Y 轴</span>：绕 Y 轴旋转（点头）</li>
          <li><span style="color: #3b82f6">Z 轴</span>：绕 Z 轴旋转（左右转向/偏航）</li>
        </ul>
      </li>
      <li><strong>绝对模式</strong>：直接设置目标旋转角度（单选物品时可用）</li>
      <li><strong>相对模式</strong>：输入增量值，在当前旋转基础上增加旋转（多选物品强制使用）</li>
    </ul>

    <h3>复制和删除</h3>
    <ul>
      <li><strong>复制</strong>：<code>Ctrl + C</code> 复制，<code>Ctrl + V</code> 粘贴</li>
      <li><strong>剪切</strong>：<code>Ctrl + X</code></li>
      <li><strong>删除</strong>：选中物品后按 <code>Delete</code> 键</li>
      <li><strong>跨方案复制</strong>：可以在不同方案标签之间复制粘贴物品</li>
    </ul>

    <h3>视图与相机</h3>

    <h4 class="mt-4 mb-2 text-base font-medium">1. 透视视图 (Perspective)</h4>
    <p>模拟人眼视觉，支持两种操作模式（无缝切换）：</p>
    <ul>
      <li>
        <strong>轨道模式 (默认)</strong>：
        <ul>
          <li><strong>旋转</strong>：按住 <code>鼠标中键</code> 拖动</li>
          <li><strong>缩放</strong>：鼠标滚轮</li>
          <li><strong>平移</strong>：透视视图下不支持鼠标平移，请直接使用键盘 WASD 移动</li>
        </ul>
      </li>
      <li>
        <strong>漫游模式 (Flight)</strong>：按 <code>W/A/S/D</code> 任意键自动进入，类似游戏操作。
        <ul>
          <li>
            <strong>移动</strong>：<code>W</code>(前) <code>S</code>(后) <code>A</code>(左)
            <code>D</code>(右)
          </li>
          <li><strong>升降</strong>：<code>Space</code>(升) <code>Q</code>(降)</li>
          <li><strong>看四周</strong>：按住 <code>鼠标中键</code> 拖动</li>
          <li><strong>加速</strong>：按住 <code>Shift</code> 键移动</li>
          <li><strong>退出</strong>：按 <code>F</code> 键聚焦选中物品，即可退出漫游回到轨道模式</li>
        </ul>
      </li>
    </ul>

    <h4 class="mt-4 mb-2 text-base font-medium">2. 正交视图 (Orthographic)</h4>
    <p>无透视畸变的平行投影（如顶视图），视图锁定不可旋转：</p>
    <ul>
      <li>
        <strong>平移画布</strong>：按住 <code>鼠标中键</code> 拖动，或 <code>空格 + 左键</code> 拖动
      </li>
      <li><strong>缩放画布</strong>：鼠标滚轮</li>
    </ul>

    <h4 class="mt-4 mb-2 text-base font-medium">视图辅助</h4>
    <ul>
      <li><strong>聚焦选中 (F)</strong>：最常用的导航键，迷失方向时按 F 可快速找回目标</li>
      <li><strong>重置视图</strong>：菜单栏 <strong>视图 &gt; 重置视图</strong></li>
    </ul>

    <h3>显示模式</h3>
    <p>编辑器支持三种物品显示模式，可根据需要在工具栏切换：</p>
    <ul>
      <li>
        <strong>简易方块 (Simple Cube)</strong>：
        <br />
        <strong>默认模式（推荐）</strong
        >。将所有物品统一显示为标准立方体，方便点击选中和进行大规模布局。
        <ul>
          <li class="text-sm text-muted-foreground">
            <strong>提示</strong>：支持通过左下角滑块或 <code>Ctrl + 滚轮</code> 调整方块显示大小。
          </li>
        </ul>
      </li>
      <li>
        <strong>完全体积 (Full Volume)</strong>：
        <br />
        显示物品基于长宽高的物理包围盒。主要用于<strong>体积预览</strong>或检查空间占用。
        <br />
        <span class="text-sm text-muted-foreground"
          >注意：由于仅包含尺寸数据，复杂物体（如大树）也会显示为巨大的长方体。</span
        >
      </li>
      <li>
        <strong>图标模式 (Icon)</strong>：
        <br />
        显示物品的游戏图标，方便快速识别物品种类。在透视视图中图标会自动面向相机，在正交视图（如顶视图）中会贴合平面。
        <ul>
          <li class="text-sm text-muted-foreground">
            <strong>提示</strong>：支持通过左下角滑块或 <code>Ctrl + 滚轮</code> 调整图标显示大小。
          </li>
        </ul>
      </li>
    </ul>

    <h3>撤销和重做</h3>
    <ul>
      <li><strong>撤销</strong>：<code>Ctrl + Z</code>，最多保留 50 步历史记录</li>
      <li><strong>重做</strong>：<code>Ctrl + Y</code></li>
      <li><strong>记录的操作</strong>：选中、移动、复制、删除、成组、解散组等所有编辑操作</li>
    </ul>

    <h2>高级功能</h2>

    <h3>组合编辑</h3>
    <p>对多个物品进行成组，可以作为一个整体进行操作：</p>
    <ul>
      <li><strong>成组</strong>：选中多个物品，按 <code>Ctrl + G</code></li>
      <li><strong>解散组</strong>：选中组内物品，按 <code>Ctrl + Shift + G</code></li>
      <li>
        <strong>组的特性</strong>：
        <ul>
          <li>点击组内任意物品，自动选中整组</li>
          <li>移动、复制、删除操作会应用到整组</li>
          <li>组在画布上用彩色边框标识，不同组使用不同颜色</li>
        </ul>
      </li>
    </ul>

    <h3>工作坐标系</h3>
    <p>工作坐标系功能允许你旋转画布坐标轴，特别适合编辑斜向布局的建筑（如 45° 摆放的建筑群）。</p>
    <ul>
      <li><strong>启用方式</strong>：菜单栏 <strong>视图 &gt; 工作坐标系</strong></li>
      <li><strong>旋转角度</strong>：支持任意角度旋转（常用 45°、90° 等）</li>
      <li><strong>移动操作</strong>：启用后，移动物品会沿旋转后的坐标轴方向进行</li>
    </ul>

    <h3>方案检测</h3>
    <p>
      编辑器会自动检测方案中的问题，并在底部状态栏显示警告。<strong>点击状态栏的警告，即可选中问题物品</strong>进行处理。
    </p>
    <ul>
      <li>
        <strong>重复物品检测</strong>：
        检测位置、旋转完全重叠的物品（常因复制粘贴后未移动导致）。建议选中后按
        <code>Delete</code> 清理。
      </li>
      <li>
        <strong>区域限制检查</strong>：
        物品超出了游戏允许的建造范围或高度限制。请将其移回安全区域内。
      </li>
      <li>
        <strong>组大小限制</strong>： 检测包含超过 50 个物品的组合。请将过大的组解散（<code
          >Ctrl + Shift + G</code
        >）并重新分组。
      </li>
      <li>
        <strong>渲染性能提示</strong>：
        当物品数量过多时，为保持流畅仅渲染部分物品。未渲染的物品依然会被保存和导出，无需担心丢失。
      </li>
    </ul>

    <h2>数据安全</h2>

    <h3>工作台记忆</h3>
    <p>编辑器具备状态持久化功能，旨在防止意外情况导致的数据丢失。</p>
    <ul>
      <li>
        <strong>实时状态保护</strong
        >：系统会实时记录当前打开的方案标签及未保存的修改。若浏览器意外关闭或页面刷新，再次访问时将自动恢复至离开前的状态。
      </li>
      <li>
        <strong>使用限制</strong>：此功能基于浏览器的本地数据库
        (IndexedDB)。请注意，清理浏览器数据或使用“无痕模式”可能导致这些临时状态丢失。
      </li>
      <li>
        <strong>建议</strong
        >：此功能主要用于异常恢复，不建议替代正式存档。重要修改完成后，请务必执行
        <strong>保存到游戏</strong> 或 <strong>导出建造数据</strong>。
      </li>
    </ul>

    <h2>导出和保存</h2>

    <h3>保存到游戏（监控模式）</h3>
    <p>如果你通过"选择游戏目录"导入方案，可以直接保存回游戏：</p>
    <ol>
      <li>编辑完成后，按 <code>Ctrl + S</code> 或点击 <strong>文件 &gt; 保存到游戏</strong></li>
      <li>文件会直接覆盖游戏中的方案文件</li>
      <li>回到游戏，重新加载存档即可看到修改</li>
    </ol>

    <h3>导出为 JSON 文件</h3>
    <ol>
      <li>点击 <strong>文件 &gt; 导出建造数据</strong></li>
      <li>选择保存位置，下载 JSON 文件</li>
      <li>手动复制到游戏目录并重命名，替换原文件</li>
    </ol>

    <h2>最佳实践建议</h2>
    <ul>
      <li>
        <strong>模块化编辑（分治法）</strong>：<br />
        如果家园方案非常复杂，建议将主要建筑群或组件<strong>剪切</strong>到一个新的空白方案标签页中单独编辑。这样可以获得更流畅的操作体验和清晰的视野。编辑完成后，再<strong>复制粘贴</strong>回主方案中组合。
      </li>
      <li>
        <strong>推荐的高效工作流</strong>：<br />
        实际上，<strong>80% 的布局工作都可以在“顶视图 + 简易方块模式”下完成</strong>。这种类似 2D
        平面设计的操作方式最直观、效率最高。你无需花费大量精力学习复杂的 3D
        漫游操作，仅在需要微调高度或预览最终效果时切换到透视视图即可。
      </li>
    </ul>
  </div>
</template>
