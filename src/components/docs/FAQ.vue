<template>
  <div class="doc-content">
    <h1>常见问题</h1>

    <h2>安全须知与免责声明</h2>

    <div class="doc-warning">
      <strong>使用本工具前，请仔细阅读并理解以下内容：</strong>
    </div>

    <h3>工具的工作原理</h3>
    <p>
      本工具通过编辑游戏「脱离卡死」功能生成的本地 JSON 文件来辅助家园建造。
      工具仅在本地运行，不修改游戏程序或内存，也不上传任何数据到服务器。
    </p>

    <h3>这是官方许可的功能吗？</h3>
    <p>
      <strong>不是。</strong>虽然游戏将建造数据以明文 JSON 形式存储（未加密），
      并且在导入时会进行数据合法性校验，保存时也会经过审核机制，
      但修改这些数据<strong>并非官方明确许可的行为</strong>。
    </p>

    <h3>使用本工具有哪些风险？</h3>
    <p>理论上可能存在以下风险：</p>
    <ul>
      <li>家园方案数据丢失或损坏</li>
      <li>家园方案审核不通过</li>
      <li>游戏账号被警告、限制或封禁</li>
    </ul>

    <h3>免责声明</h3>
    <p><strong>您使用本工具即表示您同意：</strong></p>
    <ul>
      <li><strong>风险自负</strong>：您自行承担使用本工具可能产生的一切后果</li>
      <li><strong>合法合规</strong>：您确认编辑的内容不违反所在地区的法律法规</li>
      <li><strong>个人使用</strong>：仅供个人学习和合理使用，不用于商业或分析用途</li>
      <li><strong>免除责任</strong>：本工具及其开发者不对因使用本工具而产生的任何损失承担责任</li>
    </ul>

    <div class="doc-warning">
      <strong>如果您对上述风险有任何顾虑，请勿使用本工具。</strong><br />
      本工具的设计初衷是在官方推出完善的建造工具前，为有特殊需求的玩家提供的辅助方案。
    </div>

    <h2>使用中的常见问题</h2>

    <h3>「保存到游戏」提示权限错误</h3>
    <p>
      <strong>问题描述：</strong>保存失败，错误信息类似
      <code>...could not be modified due to the state of the underlying filesystem</code>。
    </p>
    <p>
      <strong>原因：</strong>游戏安装在系统保护目录（如 Program Files），浏览器无法直接写入文件。
    </p>
    <p><strong>解决方法（任选其一）：</strong></p>
    <ol>
      <li>
        <strong>以管理员身份运行浏览器（推荐）</strong>
        <ul>
          <li>关闭浏览器</li>
          <li>右键浏览器图标 → "以管理员身份运行"</li>
          <li>重新访问编辑器网站</li>
        </ul>
      </li>
      <li>
        <strong>修改文件夹权限</strong>
        <ul>
          <li>右键 BuildData 文件夹 → 属性 → 安全 → 编辑</li>
          <li>选择当前用户（或 Everyone）</li>
          <li>勾选"完全控制"的"允许"</li>
        </ul>
      </li>
      <li>
        <strong>使用导出功能代替</strong>
        <ul>
          <li>使用「文件 > 导出建造数据」下载 JSON 文件</li>
          <li>手动复制到游戏目录替换原文件</li>
        </ul>
      </li>
    </ol>

    <h3>没有点击「脱离卡死」却收到导入数据提示</h3>
    <p>
      <strong>问题描述：</strong
      >编辑器弹出"检测到文件更新"的导入提示，但我并没有在游戏中手动点击「脱离卡死」按钮。
    </p>
    <p>
      <strong>原因：</strong
      >这是正常现象。游戏在建造过程中会不定时自动保存临时建造数据，监控模式会检测到这些自动保存的文件变化。
    </p>
    <p><strong>处理方式：</strong></p>
    <ul>
      <li>如果您还在建造中，可以点击"稍后"忽略该提示</li>
      <li>只有在主动点击「脱离卡死」后的导入提示，才是您需要导入的完整方案数据</li>
    </ul>

    <h3>点击「脱离卡死」后没有弹出导入窗口</h3>
    <p><strong>问题描述：</strong>在游戏中点击「脱离卡死」并确认后，编辑器没有显示任何导入提示。</p>
    <p><strong>排查步骤：</strong></p>
    <ol>
      <li>检查编辑器右上角是否显示 <strong>"监控中 BuildData"</strong> 状态</li>
      <li>如果未显示监控状态，说明监控已停止，需要重新选择游戏目录启动监控</li>
      <li>
        刷新网页或重新打开编辑器后，监控状态会丢失，需要重新点击
        <strong>文件 &gt; 选择游戏目录</strong>
      </li>
    </ol>
    <p class="text-sm text-muted-foreground">
      <strong>提示：</strong>监控模式依赖浏览器的文件系统访问权限，页面刷新后需要重新授权目录访问。
    </p>

    <h2>关于数据来源</h2>

    <h3>家具数据从哪里来？</h3>
    <p>
      工具使用的家具数据（家具名称、图标等）来自
      <a
        href="https://nuan5.pro"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      >
        NUAN5.PRO
      </a>
      , 感谢 NUAN5.PRO 提供的数据支持！
    </p>

    <h2>遇到问题？</h2>
    <p>如果你在使用中遇到问题或有功能建议，欢迎在 GitHub 仓库提交 Issue：</p>
    <p>
      <a
        href="https://github.com/ChanIok/BuildingMomo/issues"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      >
        前往 GitHub Issues
      </a>
    </p>

    <h2>关于与声明</h2>
    <ul>
      <li><strong>开发初衷</strong>：等官方优化家园编辑？我等不了，血压都要飙升了。</li>
      <li><strong>维护说明</strong>：在我退坑游戏前，还会持续进行正常的维护更新。</li>
      <li>
        <strong>版权归属</strong>：代码基于
        <a
          href="https://github.com/ChanIok/BuildingMomo/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          MIT 协议
        </a>
        开源，游戏素材版权归原厂商所有。
      </li>
    </ul>
  </div>
</template>
