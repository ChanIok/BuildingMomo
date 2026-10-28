import organization from './organization.md?raw'

/** Only this catalog is included in the system prompt; bodies are read through api.help. */
export const scenarioGuides = [
  {
    id: 'organization',
    name: '集合与家具组整理',
    description: '创建、重组或诊断集合与家具组。',
    content: organization,
  },
] as const
