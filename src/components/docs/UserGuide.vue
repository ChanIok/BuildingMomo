<template>
  <div class="doc-content">
    <h1>使用指南</h1>

    <h2>导入游戏方案</h2>

    <h3>方式一：从游戏目录导入（推荐）</h3>
    <ol>
      <li>点击顶部菜单栏 <strong>文件 &gt; 选择游戏目录</strong></li>
      <li>浏览并选择游戏安装目录的 <code>InfinityNikki</code> 文件夹</li>
      <li>系统会自动加载当前方案，并实时监控文件变化</li>
      <li>在游戏中点击 <strong>脱离卡死</strong> 后导出建造数据，回到编辑器后导入即可</li>
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

    <h2>视图与相机</h2>

    <h3 class="mt-4 mb-2 text-base font-medium">1. 透视视图 (Perspective)</h3>
    <p>模拟人眼视觉，支持两种相机控制模式，按 <code>Tab</code> 键切换：</p>
    <ul>
      <li>
        <strong>轨道模式 (默认)</strong>：以目标为中心观察
        <ul>
          <li><strong>环绕</strong>：按住 <code>鼠标中键</code> 拖动</li>
          <li><strong>缩放</strong>：鼠标滚轮</li>
          <li><strong>聚焦</strong>：选中物品后按 <code>F</code></li>
        </ul>
      </li>
      <li>
        <strong>飞行模式</strong>：第一人称自由飞行
        <ul>
          <li>
            <strong>平移</strong>：<code>W/A/S/D</code> (前后左右) |
            <strong>升降</strong>：<code>Space</code>(升) / <code>Q</code>(降) |
            <strong>加速</strong>：按住 <code>Shift</code>
          </li>
          <li><strong>转向</strong>：按住 <code>鼠标中键</code> 拖动</li>
          <li><strong>聚焦</strong>：选中物品后按 <code>F</code></li>
        </ul>
      </li>
    </ul>

    <h3 class="mt-4 mb-2 text-base font-medium">2. 正交视图 (Orthographic)</h3>
    <p>无透视畸变的平行投影（如顶视图），视图锁定不可旋转：</p>
    <ul>
      <li>
        <strong>平移画布</strong>：按住 <code>鼠标中键</code> 拖动，或 <code>空格 + 左键</code> 拖动
      </li>
      <li><strong>缩放画布</strong>：鼠标滚轮</li>
    </ul>

    <h3 class="mt-4 mb-2 text-base font-medium">通用操作</h3>
    <ul>
      <li><strong>聚焦目标 (F)</strong>：选中物品按 <code>F</code> 快速聚焦，迷失方向时的救星。</li>
      <li><strong>重置视图</strong>：菜单栏 <strong>视图 &gt; 重置视图</strong></li>
    </ul>

    <h2>核心编辑操作</h2>

    <h3>选择物品</h3>
    <ul>
      <li><strong>基础选择</strong>：单击选中，拖拽框选。</li>
      <li>
        <strong>组合选择</strong>：<code>Shift</code> 加选，<code>Alt</code> 减选，<code
          >Shift + Alt</code
        >
        交叉选择。
      </li>
      <li><strong>全选</strong>：<code>Ctrl + A</code> (全选可见物品)。</li>
    </ul>

    <h3>移动与变换</h3>
    <ul>
      <li>
        <strong>快捷键</strong>：<code>Ctrl + C/V</code> (复制粘贴)、<code>Del</code> (删除)、<code
          >Ctrl + Z/Y</code
        >
        (撤销/重做)。
      </li>
      <li><strong>移动/旋转</strong>：选中后拖拽三色轴，或在右侧变换面板输入数值。</li>
      <li>
        <strong>成组</strong>：<code>Ctrl + G</code> (成组)、<code>Ctrl + Shift + G</code>
        (解散组)。成组后可整体移动/复制。
      </li>
    </ul>

    <h2>高级功能</h2>

    <h3>工作坐标系</h3>
    <p>
      通过菜单栏 <strong>视图 &gt; 工作坐标系</strong> 开启。支持旋转坐标轴，专用于编辑 45°
      等斜向布局的建筑群。
    </p>

    <h3>方案检测</h3>
    <p>编辑器会自动检测并在底部状态栏提示以下问题，点击警告即可定位：</p>
    <ul>
      <li><strong>重复物品</strong>：位置、旋转、缩放完全一样的物品。</li>
      <li><strong>区域限制</strong>：超出游戏建造范围或高度限制。</li>
      <li><strong>组大小限制</strong>：单个组超过 50 个物品（游戏限制）。</li>
    </ul>

    <h3>工作台记忆</h3>
    <p>
      系统会自动记录当前方案和未保存的修改，意外关闭后可恢复到之前状态。清理浏览器数据可能导致状态丢失。
    </p>

    <h2>显示与性能</h2>
    <ul>
      <li><strong>简易方块 (推荐)</strong>：默认模式，性能最佳，适合大规模布局编辑。</li>
      <li><strong>图标模式</strong>：显示游戏图标，方便辨识物品种类。</li>
      <li><strong>完全体积</strong>：显示物理包围盒，用于预览空间占用。</li>
    </ul>

    <h2>数据保存与导出</h2>

    <h3>方式一：保存到游戏（推荐）</h3>
    <p>适用于通过「选择游戏目录」导入的方案：</p>
    <ol>
      <li>编辑完成后，按 <code>Ctrl + S</code> 或点击 <strong>文件 &gt; 保存到游戏</strong></li>
      <li>文件会直接覆盖游戏中的方案文件</li>
      <li>回到游戏，恢复建造数据即可生效</li>
    </ol>

    <h3>方式二：导出 JSON 文件</h3>
    <ol>
      <li>点击 <strong>文件 &gt; 导出建造数据</strong></li>
      <li>选择保存位置，下载 JSON 文件</li>
      <li>
        手动复制到游戏目录并替换原文件：<br />
        <code>InfinityNikki\X6Game\Saved\SavedData\BuildData\BUILD_SAVEDATA_[用户UID].json</code>
      </li>
    </ol>

    <h2>最佳实践</h2>
    <ul>
      <li>
        <strong>先用平面搞定 80% 布局</strong>： 推荐在
        <strong>顶视图 + 简易方块模式</strong> 下完成大部分排布操作。
      </li>
      <li>
        <strong>再用透视视图做细节检查</strong>：
        只在需要检查高度、遮挡关系或最终观感时，短暂切换到透视视图预览和微调。
      </li>
      <li>
        <strong>复杂建筑单独新建方案</strong>：
        对于大型或结构复杂的建筑群，建议先将这一片区域<strong>剪切到新的空白方案标签</strong>中单独编辑。
      </li>
    </ul>
  </div>
</template>
