/**
 * OpenAI 兼容 API 供应商预设（2026 常用）。
 * Base URL 为 /v1 风格根路径；实际请求拼 /chat/completions 或 /models。
 */

export interface LlmProviderPreset {
  id: string
  label: string
  /** OpenAI 兼容根，如 https://api.deepseek.com/v1 */
  baseUrl: string
  models: string[]
  /** 是否建议用 GET /models 刷新 */
  supportsModelsList: boolean
  note?: string
}

export const LLM_PROVIDERS: LlmProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o', 'o4-mini', 'o3-mini'],
    supportsModelsList: true,
  },
  {
    id: 'azure',
    label: 'Azure OpenAI（自定义端点）',
    baseUrl: '',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    supportsModelsList: false,
    note: '请填写资源部署的兼容 Base URL（形如 https://{resource}.openai.azure.com/openai/v1），或改用「自定义」。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic（需兼容网关）',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest'],
    supportsModelsList: false,
    note: '官方 Messages API 非 OpenAI 格式；请经 OpenRouter / 自建兼容网关，或改选 OpenRouter。',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsModelsList: true,
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-auto', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    supportsModelsList: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.5', 'glm-4.5-flash', 'glm-4-plus', 'glm-4-flash', 'glm-z1-flash'],
    supportsModelsList: true,
  },
  {
    id: 'dashscope',
    label: '通义百炼 / DashScope 兼容',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen3-max', 'qwen-long'],
    supportsModelsList: true,
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'deepseek-ai/DeepSeek-V3.1',
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen3-235B-A22B',
      'Qwen/Qwen2.5-72B-Instruct',
      'moonshotai/Kimi-K2-Instruct',
    ],
    supportsModelsList: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'deepseek/deepseek-chat',
      'google/gemini-2.5-flash',
      'qwen/qwen3-235b-a22b',
    ],
    supportsModelsList: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      'llama-3.3-70b-versatile',
      'openai/gpt-oss-120b',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'qwen/qwen3-32b',
    ],
    supportsModelsList: true,
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-V3',
      'Qwen/Qwen3-235B-A22B-fp8-tput',
    ],
    supportsModelsList: true,
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: [
      'accounts/fireworks/models/llama-v3p3-70b-instruct',
      'accounts/fireworks/models/deepseek-v3',
      'accounts/fireworks/models/qwen3-235b-a22b',
    ],
    supportsModelsList: true,
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    models: ['yi-lightning', 'yi-large', 'yi-spark'],
    supportsModelsList: true,
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['llama3.2', 'qwen2.5', 'deepseek-r1', 'mistral'],
    supportsModelsList: true,
    note: '需本机已启动 Ollama；Key 可填任意非空（如 ollama）。',
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    models: [],
    supportsModelsList: true,
    note: '自行填写 Base URL 与模型 id（OpenAI 兼容 /chat/completions）。',
  },
]

export function getLlmProvider(id: string): LlmProviderPreset {
  return LLM_PROVIDERS.find((p) => p.id === id) || LLM_PROVIDERS[LLM_PROVIDERS.length - 1]!
}

export function chatCompletionsUrl(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (!b) return ''
  if (/\/chat\/completions$/i.test(b)) return b
  return `${b}/chat/completions`
}

export function modelsListUrl(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (!b) return ''
  if (/\/chat\/completions$/i.test(b)) {
    return b.replace(/\/chat\/completions$/i, '/models')
  }
  return `${b}/models`
}
