import organization from './organization.md?raw'

/** Only this catalog is included in the system prompt; bodies are read through inspect. */
export const scenarioGuides = [
  {
    id: 'organization',
    name: '集合与家具组整理',
    description:
      '创建或重组集合、家具组，以及诊断分组质量；包含范围判断、归组依据、冲突处理与提交核验。',
    content: organization,
  },
] as const
