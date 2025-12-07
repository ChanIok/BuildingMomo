<template>
  <div class="doc-content">
    <h1>常见问题</h1>

    <h2>⚠️ 安全须知与免责声明</h2>

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
    <p class="text-sm text-muted-foreground">
      <strong>强烈建议：</strong>在使用前备份原始方案，谨慎编辑数据，避免使用超出合理范围的坐标值。
    </p>

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

    <p class="mt-8 text-sm text-muted-foreground">最后更新：2025-12-06</p>
  </div>
</template>
