<template>
  <div class="doc-content">
    <h1>常见问题</h1>

    <h2>安全须知与免责声明</h2>

    <div class="doc-warning">
      <strong>使用本工具前，请仔细阅读并理解以下内容：</strong>
    </div>

    <h3>工具的工作原理</h3>
    <p><strong>本工具本质上是一个针对游戏家园建造数据的可视化 JSON 编辑器。</strong></p>
    <p>
      游戏将家园建造数据以纯文本 JSON 文件的形式存储在本地磁盘的
      <code>BuildData\BUILD_SAVEDATA_[UID].json</code>
      文件中，内容为每件家具的坐标、旋转角度、缩放等数值，未经任何加密或混淆。
    </p>
    <p>
      本工具通过浏览器标准的文件访问接口读取这些文件，以 3D 可视化的方式呈现，编辑后再写回同样格式的
      JSON，全程在浏览器本地完成，不接触游戏客户端进程，不上传任何数据。
    </p>

    <h3>不使用本工具可以吗？</h3>
    <p>
      完全可以，并且对于有顾虑的玩家，我们推荐采用这种最简单的方式。你可以用记事本打开上述文件，手动修改家具的坐标和旋转数值，保存后回到游戏导入即可。这甚至更加直接——只需要你记住每件家具的
      ID 编号、手动计算好三维坐标和欧拉角，并确保没有打错一个逗号。
    </p>

    <h3>这是官方许可的功能吗？</h3>
    <p>
      <strong>不是。</strong
      >游戏虽然对导入数据有合法性校验，保存时也会经过审核机制，但主动修改这些数据<strong>并非官方明确许可的行为</strong>。
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

    <h3>在游戏中恢复建造后家具类型错乱</h3>
    <p>
      <strong>问题描述：</strong>
      游戏 2.9
      版本更新后，在游戏中<strong>恢复建造</strong>时，方案中的家具大量变成了当前家园中已有的旧家具。
    </p>
    <p>
      <strong>原因：</strong>
      游戏更新了建造数据的恢复机制。当从编辑器保存的方案中，家具编号（Instance
      ID）与当前游戏家园占用的编号发生重叠时，游戏恢复时会错误地沿用旧家具。
    </p>
    <p><strong>解决方法（任选其一）：</strong></p>
    <ol>
      <li>
        <strong>方法一：在游戏中清空并保存（最简单）</strong>
        <ul>
          <li>在游戏中进入建造模式，执行<strong>「一键清空」</strong>。</li>
          <li><strong>「保存」</strong>并退出建造模式（彻底释放游戏占用的家具编号）。</li>
          <li>回到编辑器中重新<strong>「保存到游戏」</strong>，再次进入游戏恢复建造即可。</li>
        </ul>
      </li>
      <li>
        <strong>方法二：在编辑器中重新分配编号（无需清空游戏）</strong>
        <ul>
          <li>在编辑器中导入当前游戏正在使用的方案。</li>
          <li>按 <code>Ctrl + A</code> 全选后按 <code>Delete</code> 删除场景中的所有家具。</li>
          <li>
            切换到目标方案标签页，按 <code>Ctrl + A</code> 全选并 <code>Ctrl + C</code> 复制。
          </li>
          <li>
            切换回已清空的标签页，按
            <code>Ctrl + V</code>
            粘贴并<strong>「保存到游戏」</strong>（此时家具会被分配全新的不冲突编号）。
          </li>
        </ul>
      </li>
    </ol>

    <h3>选择游戏目录时提示「含有系统文件」</h3>
    <p>
      <strong>问题描述：</strong>点击
      <strong>文件 &gt; 选择游戏目录</strong>
      后，浏览器弹出提示，表示无法打开该文件夹（含有系统文件）。
    </p>
    <p>
      <strong>原因：</strong>游戏安装在 <code>Program Files</code>
      等浏览器禁止网页访问的目录。这是 Chrome / Edge 的安全限制，工具无法绕过。
    </p>
    <p><strong>解决方法（任选其一）：</strong></p>
    <ol>
      <li>
        <strong>将游戏目录移到普通路径</strong>
        <ul>
          <li>将整个游戏文件夹移动到 <code>D:\Games\</code> 等普通目录</li>
          <li>
            打开游戏启动器 → 右上角「设置」→「下载设置」→「游戏资源安装路径」→
            点文件夹图标选新目录（无需重新下载或完整重装）
          </li>
        </ul>
      </li>
      <li>
        <strong>改用手动导入/导出</strong>
        <ul>
          <li>「文件 &gt; 导入建造数据」：从游戏 <code>BuildData</code> 目录选择 JSON 载入</li>
          <li>
            「文件 &gt; 导出建造数据」：编辑后下载 JSON，手动复制回
            <code>BuildData</code> 替换原文件
          </li>
          <li>不使用目录监控功能</li>
        </ul>
      </li>
    </ol>

    <h3>「保存到游戏」提示权限错误</h3>
    <p>
      <strong>问题描述：</strong
      >已成功连接游戏目录（右上角显示「监控中」），但保存失败，错误信息类似
      <code>...could not be modified due to the state of the underlying filesystem</code>。
    </p>
    <p>
      <strong>原因：</strong>浏览器已允许写入，但 Windows 拒绝了实际写入，通常是
      <code>BuildData</code> 所在目录对当前用户没有写入权限。
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
          <li>右键 <code>BuildData</code> 文件夹 → 属性 → 安全 → 编辑</li>
          <li>选择当前用户（或 Everyone）</li>
          <li>勾选"完全控制"的"允许"</li>
        </ul>
      </li>
      <li>
        <strong>改用手动导入/导出</strong>
        <ul>
          <li>「文件 &gt; 导入建造数据」：从游戏 <code>BuildData</code> 目录选择 JSON 载入</li>
          <li>
            「文件 &gt; 导出建造数据」：编辑后下载 JSON，手动复制回
            <code>BuildData</code> 替换原文件
          </li>
          <li>无需使用「保存到游戏」</li>
        </ul>
      </li>
    </ol>

    <h3>没有点击「脱离卡死」却收到导入数据提示</h3>
    <p>
      <strong>问题描述：</strong
      >编辑器弹出"检测到文件更新"的导入提示，但我并没有在游戏中手动点击「脱离卡死」按钮。
    </p>
    <p>
      <strong>原因：</strong>这是正常现象。游戏在建造过程中每约 5
      分钟自动保存一次临时建造数据，监控模式会检测到这些变化。
    </p>
    <p><strong>处理方式：</strong></p>
    <ul>
      <li>
        若觉得弹窗频繁打扰，可在设置中关闭「文件监控弹窗」；
        关闭后仍会记录变动，可通过右上角「监控中 BuildData」查看历史并读取最新方案。
      </li>
    </ul>

    <h3>点击「脱离卡死」后没有弹出导入窗口</h3>
    <p>
      <strong>排查：</strong>看右上角是否显示「监控中 BuildData」。若未显示，点击
      <strong>文件 &gt; 选择游戏目录</strong>
      重新启动即可。页面刷新后会自动恢复监控，通常无需重新授权。
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
