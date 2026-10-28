import { z } from 'zod'

export const executeInput = z.strictObject({
  code: z
    .string()
    .min(1)
    .describe('支持 await 的 JavaScript 函数体。vars 持久化；console.log 和 return 才产生输出。'),
})
