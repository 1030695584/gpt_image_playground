import type { AgentConversation, AgentMessage, AgentRound, ResponsesOutputItem, TaskRecord } from '../types'
import { getAgentRoundResponseOutput } from './agentResponseState'
import { stripImageMentionMarkers } from './promptImageMentions'
import { normalizeResponsesOutputItems } from './responsesOutputState'

const AGENT_ROUND_IMAGE_MENTION_RE = /@(?:第)?(\d+)轮图(\d+)/g

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function normalizeAgentRound(value: unknown, fallbackIndex: number): AgentRound | null {
  if (!isRecord(value)) return null
  const round = value as Partial<AgentRound>
  if (typeof round.id !== 'string' || !round.id) return null
  if (typeof round.userMessageId !== 'string' || !round.userMessageId) return null

  const status = round.status === 'running'
    ? 'error'
    : round.status === 'error' || round.status === 'done'
    ? round.status
    : 'done'
  const outputTaskIds = normalizeStringArray(round.outputTaskIds)
  const taskPrompts = isRecord(round.outputTaskPrompts)
    ? Object.entries(round.outputTaskPrompts).filter(([id, prompt]) => typeof prompt === 'string' && outputTaskIds.includes(id))
    : []
  // 宽度用于分配回放数组，限制备份中异常计数的内存开销
  const taskWidths = isRecord(round.deletedOutputTaskWidths)
    ? Object.entries(round.deletedOutputTaskWidths).filter(([id, width]) =>
        outputTaskIds.includes(id) && Number.isSafeInteger(width) && width >= 0 && width <= 10000)
    : []
  const responseOutput = Array.isArray(round.responseOutput) ? normalizeResponsesOutputItems(round.responseOutput) : undefined

  return {
    id: round.id,
    index: typeof round.index === 'number' ? round.index : fallbackIndex + 1,
    parentRoundId: typeof round.parentRoundId === 'string' ? round.parentRoundId : null,
    userMessageId: round.userMessageId,
    ...(typeof round.userBranchId === 'string' && round.userBranchId ? { userBranchId: round.userBranchId } : {}),
    ...(typeof round.assistantMessageId === 'string' ? { assistantMessageId: round.assistantMessageId } : {}),
    prompt: typeof round.prompt === 'string' ? round.prompt : '',
    inputImageIds: normalizeStringArray(round.inputImageIds),
    maskTargetImageId: typeof round.maskTargetImageId === 'string' ? round.maskTargetImageId : null,
    maskImageId: typeof round.maskImageId === 'string' ? round.maskImageId : null,
    outputTaskIds,
    ...(taskWidths.length ? { deletedOutputTaskWidths: Object.fromEntries(taskWidths) } : {}),
    ...(taskPrompts.length ? { outputTaskPrompts: Object.fromEntries(taskPrompts) } : {}),
    ...(typeof round.responseId === 'string' ? { responseId: round.responseId } : {}),
    ...(responseOutput ? { responseOutput } : {}),
    status,
    error: status === 'error'
      ? typeof round.error === 'string' ? round.error : '上次请求已中断'
      : null,
    createdAt: typeof round.createdAt === 'number' ? round.createdAt : Date.now(),
    finishedAt: typeof round.finishedAt === 'number' ? round.finishedAt : null,
  }
}

function normalizeAgentMessage(value: unknown): AgentMessage | null {
  if (!isRecord(value)) return null
  const message = value as Partial<AgentMessage>
  if (typeof message.id !== 'string' || !message.id) return null
  if (message.role !== 'user' && message.role !== 'assistant') return null
  if (typeof message.roundId !== 'string' || !message.roundId) return null

  return {
    id: message.id,
    role: message.role,
    content: typeof message.content === 'string' ? message.content : '',
    roundId: message.roundId,
    ...(Array.isArray(message.inputImageIds) ? { inputImageIds: normalizeStringArray(message.inputImageIds) } : {}),
    maskTargetImageId: typeof message.maskTargetImageId === 'string' ? message.maskTargetImageId : null,
    maskImageId: typeof message.maskImageId === 'string' ? message.maskImageId : null,
    ...(Array.isArray(message.outputTaskIds) ? { outputTaskIds: normalizeStringArray(message.outputTaskIds) } : {}),
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
  }
}

export function isEmptyAgentConversation(conversation: AgentConversation) {
  return conversation.rounds.length === 0 && conversation.messages.length === 0 && !conversation.activeRoundId
}

export function normalizeAgentConversations(value: unknown): AgentConversation[] {
  if (!Array.isArray(value)) return []

  const conversationIds = new Set<string>()
  return value
    .filter((item): item is Record<string, unknown> & { id: string } => {
      if (!isRecord(item)) return false
      const id = item.id
      if (typeof id !== 'string' || !id || conversationIds.has(id)) return false
      conversationIds.add(id)
      return true
    })
    .map((conversation) => {
      const roundIds = new Set<string>()
      const normalizedRounds = Array.isArray(conversation.rounds)
        ? conversation.rounds.map(normalizeAgentRound).filter((round): round is AgentRound => {
            if (!round || roundIds.has(round.id)) return false
            roundIds.add(round.id)
            return true
          })
        : []
      const hasBranchParents = normalizedRounds.some((round) => round.parentRoundId)
      const hasStoredActiveRound = typeof conversation.activeRoundId === 'string'
      const rounds = hasBranchParents || hasStoredActiveRound
        ? normalizedRounds
        : normalizedRounds.map((round, index) => ({
            ...round,
            parentRoundId: index > 0 ? normalizedRounds[index - 1].id : null,
          }))
      const messageIds = new Set<string>()
      const messages = Array.isArray(conversation.messages)
        ? conversation.messages
            .map(normalizeAgentMessage)
            .filter((message): message is AgentMessage => {
              if (!message || !roundIds.has(message.roundId) || messageIds.has(message.id)) return false
              messageIds.add(message.id)
              return true
            })
        : []
      // 旧版重试会复制用户消息；同一父轮次下的同文输入共用回复切换器
      const groups = new Map<string, string>()
      const users = new Map(messages.filter((item) => item.role === 'user').map((item) => [item.id, item]))
      for (const round of rounds) {
        const user = users.get(round.userMessageId)
        if (user?.roundId === round.id) {
          if (!round.inputImageIds.length && user.inputImageIds?.length) round.inputImageIds = [...user.inputImageIds]
          round.maskImageId ??= user.maskImageId
          round.maskTargetImageId ??= user.maskTargetImageId
        }
        const text = user?.content ?? round.prompt
        const key = JSON.stringify([round.parentRoundId, text])
        const group = text ? groups.get(key) : undefined
        round.userBranchId ??= group ?? round.userMessageId
        if (text && !group) groups.set(key, round.userBranchId)
      }
      return {
        id: conversation.id,
        title: typeof conversation.title === 'string' && conversation.title.trim() ? conversation.title : '新对话',
        ...(Array.isArray(conversation.visitedRoundIds) ? {
          visitedRoundIds: uniqueIds(normalizeStringArray(conversation.visitedRoundIds).filter((id) => roundIds.has(id))),
        } : {}),
        activeRoundId: typeof conversation.activeRoundId === 'string' && roundIds.has(conversation.activeRoundId) ? conversation.activeRoundId : rounds[rounds.length - 1]?.id ?? null,
        createdAt: typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now(),
        updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : Date.now(),
        rounds,
        messages,
      }
    })
}

function getAgentRoundChildren(conversation: AgentConversation, parentRoundId: string | null) {
  return conversation.rounds.filter((round) => (round.parentRoundId ?? null) === parentRoundId)
}

export function getAgentRoundSubtreeIds(conversation: AgentConversation, roundIds: Set<string>) {
  const children = new Map<string, string[]>()
  for (const round of conversation.rounds) {
    if (!round.parentRoundId) continue
    const group = children.get(round.parentRoundId)
    if (group) group.push(round.id)
    else children.set(round.parentRoundId, [round.id])
  }
  const affected = new Set(roundIds)
  for (const id of affected) {
    for (const child of children.get(id) ?? []) affected.add(child)
  }
  return affected
}

function getLatestAgentLeafId(conversation: AgentConversation, startRoundId: string | null = null): string | null {
  const ranks = new Map(conversation.visitedRoundIds?.map((id, index) => [id, index]))
  let currentId = startRoundId
  const seen = new Set<string>()
  while (!currentId || !seen.has(currentId)) {
    if (currentId) seen.add(currentId)
    const children = getAgentRoundChildren(conversation, currentId)
    const nextId = children.reduce<AgentRound | undefined>((best, item) =>
      !best || (ranks.get(item.id) ?? -1) >= (ranks.get(best.id) ?? -1) ? item : best, undefined)?.id
    if (!nextId) return currentId
    currentId = nextId
  }

  return null
}

export function getAgentRoundPath(conversation: AgentConversation, roundId: string | null): AgentRound[] {
  if (!roundId) return []
  const byId = new Map(conversation.rounds.map((round) => [round.id, round]))
  const path: AgentRound[] = []
  const seen = new Set<string>()
  let current = byId.get(roundId) ?? null

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentRoundId ? byId.get(current.parentRoundId) ?? null : null
  }

  return path
}

export function getAgentAssistantMessage(conversation: AgentConversation, round: AgentRound) {
  const matchesRound = (message: AgentMessage) => message.roundId === round.id && message.role === 'assistant'
  const linked = round.assistantMessageId && conversation.messages.find((message) => message.id === round.assistantMessageId && matchesRound(message))
  return linked || conversation.messages.find(matchesRound)
}

export function getActiveAgentRounds(conversation: AgentConversation): AgentRound[] {
  const activeRoundId = conversation.activeRoundId && conversation.rounds.some((round) => round.id === conversation.activeRoundId)
    ? conversation.activeRoundId
    : getLatestAgentLeafId(conversation)
  return getAgentRoundPath(conversation, activeRoundId ?? null)
}

export function getAgentInputHistory(conversation: AgentConversation, editingRoundId: string | null) {
  if (!editingRoundId) return getActiveAgentRounds(conversation)
  const editing = conversation.rounds.find((round) => round.id === editingRoundId)
  return getAgentRoundPath(conversation, editing?.parentRoundId ?? null)
}

function reindexAgentRounds(conversation: AgentConversation): AgentConversation {
  const indexById = new Map<string, number>()
  const seen = new Set<string>()
  const visit = (parentRoundId: string | null, depth: number) => {
    for (const child of getAgentRoundChildren(conversation, parentRoundId)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      indexById.set(child.id, depth)
      visit(child.id, depth + 1)
    }
  }
  visit(null, 1)
  return {
    ...conversation,
    rounds: conversation.rounds.map((round) => ({
      ...round,
      index: indexById.get(round.id) ?? round.index,
    })),
  }
}

export function remapAgentRoundMentionsForPathChange(content: string, oldPath: AgentRound[], newPath: AgentRound[]) {
  if (!content || oldPath.length === 0) return content
  const newIndexByRoundId = new Map(newPath.map((round, index) => [round.id, index + 1]))
  const text = content.replace(AGENT_ROUND_IMAGE_MENTION_RE, (match, roundNumber: string, imageNumber: string) => {
    const oldRound = oldPath[Number(roundNumber) - 1]
    if (!oldRound) return match
    const newRoundIndex = newIndexByRoundId.get(oldRound.id)
    if (!newRoundIndex) return `@已删除轮次图${imageNumber}`
    return `@第${newRoundIndex}轮图${imageNumber}`
  })
  // 工具参数和输出中也会保存 JSON 编码的引用标签
  return text.replace(/<ref\b[^<>]*?\bid=(\\*["'])(round-(\d+)-(?:image|reference)-\d+)\1[^<>]*>/g,
    (tag, _quote: string, id: string, number: string) => {
      const source = oldPath[Number(number) - 1]
      if (!source) return tag
      const index = newIndexByRoundId.get(source.id)
      return index ? tag.replace(id, id.replace(`round-${number}-`, `round-${index}-`)) : tag.replace('<ref', '<removed_ref')
    })
}

function remapResponseReferences(output: ResponsesOutputItem[], oldPath: AgentRound[], newPath: AgentRound[]) {
  const remap = (text: string) => remapAgentRoundMentionsForPathChange(text, oldPath, newPath)
  return output.map((item) => ({
    ...item,
    ...(item.arguments ? { arguments: remap(item.arguments) } : {}),
    ...(typeof item.output === 'string' ? { output: remap(item.output) } : {}),
    ...(Array.isArray(item.output) ? { output: item.output.map((part) => part.text ? { ...part, text: remap(part.text) } : part) } : {}),
    ...(Array.isArray(item.content) ? { content: item.content.map((part) => ({
      ...part,
      ...(part.text ? { text: remap(part.text) } : {}),
      ...(part.refusal ? { refusal: remap(part.refusal) } : {}),
    })) } : {}),
    ...(item.revised_prompt ? { revised_prompt: remap(item.revised_prompt) } : {}),
  }))
}

export function remapAgentTaskReferencesAfterDeletion(task: TaskRecord, before: AgentConversation, after: AgentConversation) {
  if (task.agentConversationId && task.agentConversationId !== before.id) return task
  const linkedMessage = before.messages.find((message) => message.outputTaskIds?.includes(task.id))
  const owner = before.rounds.find((round) => round.outputTaskIds.includes(task.id) || round.id === linkedMessage?.roundId ||
    (task.agentConversationId === before.id && task.agentRoundId === round.id))
  if (!owner) return task
  const oldPath = getAgentRoundPath(before, owner.id)
  const newPath = getAgentRoundPath(after, owner.id)
  if (!newPath.length || oldPath.length === newPath.length) return task
  const prompt = remapAgentRoundMentionsForPathChange(task.prompt, oldPath, newPath)
  return prompt === task.prompt ? task : { ...task, prompt }
}

export function deleteAgentRoundFromConversation(conversation: AgentConversation, roundId: string, now = Date.now(), tasks: TaskRecord[] = [], sharedTaskIds: ReadonlySet<string> = new Set()): AgentConversation {
  const targetRound = conversation.rounds.find((round) => round.id === roundId)
  if (!targetRound) return conversation

  const removed = getAgentSiblingRounds(conversation, targetRound, 'assistant')
  const removedIds = new Set(removed.map((round) => round.id))
  const oldPathByRoundId = new Map(conversation.rounds.map((round) => [round.id, getAgentRoundPath(conversation, round.id)]))
  const rounds = conversation.rounds
    .filter((candidate) => !removedIds.has(candidate.id))
    .map((candidate) =>
      candidate.parentRoundId && removedIds.has(candidate.parentRoundId)
        ? { ...candidate, parentRoundId: targetRound.parentRoundId ?? null }
        : candidate,
    )
  const messages = conversation.messages.filter((candidate) => !removedIds.has(candidate.roundId))
  const nextConversation = reindexAgentRounds({
    ...conversation,
    rounds,
    messages,
    ...(conversation.visitedRoundIds ? { visitedRoundIds: conversation.visitedRoundIds.filter((id) => !removedIds.has(id)) } : {}),
    activeRoundId: conversation.activeRoundId && removedIds.has(conversation.activeRoundId) ? null : conversation.activeRoundId ?? null,
  })
  const newPathByRoundId = new Map(nextConversation.rounds.map((round) => [round.id, getAgentRoundPath(nextConversation, round.id)]))
  const remappedMessages = nextConversation.messages.map((message) => {
    const oldPath = oldPathByRoundId.get(message.roundId) ?? []
    const newPath = newPathByRoundId.get(message.roundId) ?? []
    const content = remapAgentRoundMentionsForPathChange(message.content, oldPath, newPath)
    return content === message.content ? message : { ...message, content }
  })
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const remappedRounds = nextConversation.rounds.map((round) => {
    const oldPath = oldPathByRoundId.get(round.id)!
    const newPath = newPathByRoundId.get(round.id)!
    if (oldPath.length === newPath.length) return round
    const output = getAgentRoundResponseOutput(round, tasks)
    const prompts = new Map(Object.entries(round.outputTaskPrompts ?? {}))
    for (const id of round.outputTaskIds) {
      const task = tasksById.get(id)
      if (!task || (!prompts.has(id) && !sharedTaskIds.has(id) &&
        (!task.agentConversationId || task.agentConversationId === conversation.id))) continue
      const prompt = prompts.get(id) ?? task.prompt
      const remapped = remapAgentRoundMentionsForPathChange(prompt, oldPath, newPath)
      if (remapped !== task.prompt) prompts.set(id, remapped)
      else prompts.delete(id)
    }
    return {
      ...round,
      prompt: remapAgentRoundMentionsForPathChange(round.prompt, oldPath, newPath),
      ...(round.outputTaskPrompts || prompts.size ? { outputTaskPrompts: prompts.size ? Object.fromEntries(prompts) : undefined } : {}),
      ...(output ? { responseOutput: remapResponseReferences(output, oldPath, newPath) } : {}),
    }
  })
  const withRemappedMessages = { ...nextConversation, rounds: remappedRounds, messages: remappedMessages }
  const activeRounds = getActiveAgentRounds(withRemappedMessages)
  return {
    ...withRemappedMessages,
    activeRoundId: withRemappedMessages.activeRoundId ?? activeRounds[activeRounds.length - 1]?.id ?? null,
    updatedAt: now,
  }
}

export function selectAgentBranch(conversation: AgentConversation, roundId: string | null) {
  const path = getActiveAgentRounds(conversation)
  const visited = new Set(conversation.visitedRoundIds)
  for (const round of path) {
    visited.delete(round.id)
    visited.add(round.id)
  }
  return { activeRoundId: roundId, visitedRoundIds: [...visited] }
}

export function getAgentSiblingRounds(conversation: AgentConversation, round: AgentRound, role: AgentMessage['role']) {
  const siblings = getAgentRoundChildren(conversation, round.parentRoundId ?? null)
  if (siblings.length < 2) return siblings
  const userBranchId = round.userBranchId ?? round.userMessageId
  if (role === 'assistant') return siblings.filter((item) => (item.userBranchId ?? item.userMessageId) === userBranchId)

  const ranks = new Map(conversation.visitedRoundIds?.map((id, index) => [id, index]))
  const users = new Map<string, AgentRound>()
  for (const item of siblings) {
    const id = item.userBranchId ?? item.userMessageId
    const prev = users.get(id)
    if (id === userBranchId) users.set(id, round)
    else if (!prev || (ranks.get(item.id) ?? -1) >= (ranks.get(prev.id) ?? -1)) users.set(id, item)
  }
  return [...users.values()]
}

export function getAgentBranchLeafId(conversation: AgentConversation, roundId: string) {
  return getLatestAgentLeafId(conversation, roundId) ?? roundId
}

export function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)))
}

export function getAgentRoundTaskIds(round: AgentRound, tasks: TaskRecord[]) {
  const existingTaskIds = new Set(tasks.map((task) => task.id))
  return uniqueIds([
    ...round.outputTaskIds,
    ...tasks
      .filter((task) => task.agentRoundId === round.id)
      .map((task) => task.id),
  ]).filter((taskId) => existingTaskIds.has(taskId))
}

export function getAgentLinkedTaskIds(conversations: AgentConversation[]) {
  return new Set(conversations.flatMap((item) => [
    ...item.rounds.flatMap((round) => round.outputTaskIds),
    ...item.messages.flatMap((message) => message.outputTaskIds ?? []),
  ]))
}

export function getAgentSharedTaskIds(conversation: AgentConversation, conversations: AgentConversation[]) {
  const sharedTaskIds = getAgentLinkedTaskIds(conversations.filter((item) => item.id !== conversation.id))
  const seen = new Set<string>()
  for (const round of conversation.rounds) {
    for (const id of round.outputTaskIds) {
      if (seen.has(id) || round.outputTaskPrompts?.[id] !== undefined) sharedTaskIds.add(id)
      seen.add(id)
    }
  }
  return sharedTaskIds
}

export function getAgentRoundDeletionTaskIds(conversation: AgentConversation, roundIds: Set<string>, tasks: TaskRecord[], conversations: AgentConversation[]) {
  const rounds = conversation.rounds.filter((round) => roundIds.has(round.id))
  const messages = conversation.messages.filter((item) => roundIds.has(item.roundId))
  const messageIds = new Set(messages.map((item) => item.id))
  const ids = new Set([...rounds.flatMap((round) => round.outputTaskIds), ...messages.flatMap((item) => item.outputTaskIds ?? [])])
  // 无归属字段的旧任务可能被多份导入的对话共用
  const otherLinks = getAgentLinkedTaskIds(conversations.filter((item) => item.id !== conversation.id))
  for (const id of otherLinks) ids.delete(id)
  for (const task of tasks) {
    if (!task.agentConversationId) continue
    if (task.agentConversationId !== conversation.id) ids.delete(task.id)
    else if ((task.agentRoundId && roundIds.has(task.agentRoundId)) || (task.agentMessageId && messageIds.has(task.agentMessageId))) ids.add(task.id)
  }
  return ids
}

export function getAgentConversationTaskIds(conversation: AgentConversation | null | undefined, tasks: TaskRecord[], conversations: AgentConversation[] = []) {
  if (!conversation) return []
  const linked = getAgentLinkedTaskIds([conversation])
  const otherLinks = getAgentLinkedTaskIds(conversations.filter((item) => item.id !== conversation.id))
  return tasks.filter((task) => task.agentConversationId
    ? task.agentConversationId === conversation.id
    : linked.has(task.id) && !otherLinks.has(task.id)).map((task) => task.id)
}

export function getConversationSearchText(conversation: AgentConversation) {
  // 去掉提及标记和评论胶囊中的编码数据，只按可见文字搜索
  return [
    conversation.title,
    ...conversation.messages.map((message) => message.content),
    ...conversation.rounds.map((round) => round.prompt),
  ].map(stripImageMentionMarkers).join('\n').toLocaleLowerCase()
}
