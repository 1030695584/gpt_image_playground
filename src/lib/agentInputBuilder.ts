import type { AgentConversation, AgentMessage, AgentRound, ResponsesOutputItem, TaskRecord } from '../types'
import { getAgentAssistantMessage, getAgentRoundPath } from './agentConversationState'
import { getTaskPromptText } from './promptImageMentions'
import {
  getAgentRemovedReferenceTag,
  getAgentTaskImageSlots,
  getAgentCurrentReferenceId,
  getAgentGeneratedImageReferenceId,
  replaceAgentPromptImageReferencesForApi,
} from './agentImageReferences'
import { getAgentRoundResponseOutput, sanitizeResponseOutputForInput } from './agentResponseState'

type LoadImage = (id: string) => Promise<string | null | undefined>

interface BuildAgentApiInputOptions {
  maskTargetImageId?: string
  conversation: AgentConversation
  currentRound: AgentRound
  tasks: TaskRecord[]
  loadImage: LoadImage
}

interface BuildAgentContinuationInputOptions {
  baseInput: unknown[]
  currentRound: AgentRound
  tasks: TaskRecord[]
  currentRoundOutput: ResponsesOutputItem[]
  functionCallOutputs?: ResponsesOutputItem[]
  batchTaskIds: string[]
  toolCallsUsed: number
  maxToolCalls: number
  loadImage: LoadImage
}

async function createUserInputItem(options: BuildAgentApiInputOptions, round: AgentRound, message: AgentMessage, missing: Set<string>) {
  const current = round.id === options.currentRound.id
  const imageDataUrls: string[] = []
  const refs: string[] = []
  for (const [index, id] of round.inputImageIds.entries()) {
    if (current && id === options.maskTargetImageId) continue
    const ref = getAgentCurrentReferenceId(round, index)
    const dataUrl = await options.loadImage(id)
    if (!dataUrl) {
      if (current) throw new Error(`第 ${index + 1} 张输入图片已不存在`)
      missing.add(ref)
      continue
    }
    imageDataUrls.push(dataUrl)
    refs.push(`\n  <ref id="${ref}" />`)
  }
  const rounds = getAgentRoundPath(options.conversation, round.id)
  const text = replaceAgentPromptImageReferencesForApi(message.content, round, rounds, options.tasks)
    .replace(/<ref\b[^>]*?\bid=(["'])(round-\d+-(?:image|reference)-\d+)\1[^>]*>/g,
      (tag, _quote: string, id: string) => missing.has(id) ? getAgentRemovedReferenceTag(id) : tag)
  const referenceText = refs.length ? `\n\n<available_refs>${refs.join('')}\n</available_refs>` : ''
  return {
    role: 'user',
    content: [
      { type: 'input_text', text: `${text}${referenceText}` },
      ...imageDataUrls.map((dataUrl) => ({ type: 'input_image', image_url: dataUrl })),
    ],
  }
}

function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function createGeneratedImageReferencePart(round: AgentRound, task: TaskRecord, imageIndex: number) {
  const stored = round.outputTaskPrompts?.[task.id] ?? task.prompt
  const prompt = getTaskPromptText(typeof stored === 'string' ? stored : '', task.inputImageIds.length).replace(/\s+/g, ' ').trim()
  const truncatedPrompt = prompt.length > 1200 ? `${prompt.slice(0, 1200)}...` : prompt
  const promptAttribute = truncatedPrompt ? ` prompt="${escapeXmlAttribute(truncatedPrompt)}"` : ''
  return {
    type: 'input_text',
    text: `<ref id="${getAgentGeneratedImageReferenceId(round, imageIndex)}"${promptAttribute} />`,
  }
}

async function getGeneratedImageInputs(round: AgentRound, tasks: TaskRecord[], loadImage: LoadImage, missing: Set<string>, batchTaskIds?: string[]) {
  const content: Array<{ type: string; text?: string; image_url?: string }> = []
  const refs: string[] = []
  let imageIndex = 0
  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    const include = !batchTaskIds || (batchTaskIds.includes(taskId) && task?.status === 'done')
    for (const imageId of getAgentTaskImageSlots(task, round.deletedOutputTaskWidths?.[taskId])) {
      const ref = getAgentGeneratedImageReferenceId(round, imageIndex)
      const dataUrl = imageId ? await loadImage(imageId) : null
      if (dataUrl && task) {
        refs.push(`<ref id="${ref}" />`)
        if (include) content.push({ type: 'input_image', image_url: dataUrl }, createGeneratedImageReferencePart(round, task, imageIndex))
      } else {
        missing.add(ref)
        if (include) content.push({ type: 'input_text', text: getAgentRemovedReferenceTag(ref) })
      }
      imageIndex++
    }
  }
  return { item: content.length ? { role: 'user', content } : null, refs }
}

function createAssistantFallbackItem(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }
}

export async function buildAgentApiInput(options: BuildAgentApiInputOptions): Promise<unknown[]> {
  const input: unknown[] = []
  const missing = new Set<string>()
  const rounds = getAgentRoundPath(options.conversation, options.currentRound.id)

  // 原生图像工具将遮罩应用于请求中的第一张图片
  if (options.maskTargetImageId) {
    const index = options.currentRound.inputImageIds.indexOf(options.maskTargetImageId)
    const image = await options.loadImage(options.maskTargetImageId)
    if (index < 0 || !image) throw new Error('遮罩底图已不存在')
    input.push({ role: 'user', content: [
      { type: 'input_text', text: `Mask edit target: <ref id="${getAgentCurrentReferenceId(options.currentRound, index)}" />` },
      { type: 'input_image', image_url: image },
    ] })
  }
  for (const round of rounds) {
    const userMessage = options.conversation.messages.find((message) => message.id === round.userMessageId)
    if (!userMessage) continue

    input.push(await createUserInputItem(options, round, userMessage, missing))
    if (round.id === options.currentRound.id) continue

    const assistantMessage = getAgentAssistantMessage(options.conversation, round)
    if (!assistantMessage && !round.outputTaskIds.length) continue
    const output = getAgentRoundResponseOutput(round, options.tasks)
    if (output?.length) {
      const sanitizedOutput = sanitizeResponseOutputForInput(output)
      if (sanitizedOutput.length > 0) {
        input.push(...sanitizedOutput)
      } else {
        input.push(createAssistantFallbackItem(assistantMessage?.content || '图像已生成。'))
      }
    } else {
      input.push(createAssistantFallbackItem(assistantMessage?.content || '[No text response]'))
    }

    if (round.outputTaskIds.length > 0) {
      const images = await getGeneratedImageInputs(round, options.tasks, options.loadImage, missing)
      if (images.item) input.push(images.item)
    }
  }

  return input
}

export async function buildAgentContinuationInput(options: BuildAgentContinuationInputOptions): Promise<unknown[]> {
  const functionCallOutputIds = new Set((options.functionCallOutputs ?? [])
    .filter((item) => item.type === 'function_call_output' && item.call_id)
    .map((item) => item.call_id!))
  const currentRoundOutput = options.currentRoundOutput.filter(
    (item) => item.type !== 'function_call_output' || !item.call_id || !functionCallOutputIds.has(item.call_id),
  )
  const input = [
    ...options.baseInput,
    ...sanitizeResponseOutputForInput(currentRoundOutput, { allowPendingFunctionCalls: true }),
    ...(options.functionCallOutputs ?? []),
  ]
  const images = await getGeneratedImageInputs(options.currentRound, options.tasks, options.loadImage, new Set(), options.batchTaskIds)
  if (images.item) input.push(images.item)

  const lines = ['[System] The app has saved your generated outputs and is continuing the same Agent turn.']
  if (images.refs.length > 0) {
    lines.push(`The following image ref ids are now available for you to reference in subsequent image_generation prompts: ${images.refs.join(', ')}`)
  }
  lines.push(
    'Continue generating. Do NOT repeat what you already said in earlier responses.',
    'If you still need another round after this (e.g. more dependent images), call continue_generation.',
    `Tool-call budget: ${options.toolCallsUsed}/${options.maxToolCalls} used.`,
  )
  input.push({
    role: 'user',
    content: [{ type: 'input_text', text: lines.join('\n') }],
  })
  return input
}
