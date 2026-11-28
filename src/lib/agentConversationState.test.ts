import { describe, expect, it } from 'vitest'
import type { AgentConversation, AgentRound, TaskRecord } from '../types'
import { getAgentRoundResponseOutput, getPersistableAgentConversations } from './agentResponseState'
import { deleteAgentRoundFromConversation, remapAgentTaskReferencesAfterDeletion, getAgentAssistantMessage, getAgentBranchLeafId, getAgentSiblingRounds, getAgentRoundPath, getConversationSearchText, normalizeAgentConversations, selectAgentBranch } from './agentConversationState'

function round(id: string, parentRoundId: string | null, index: number): AgentRound {
  return {
    id,
    index,
    parentRoundId,
    userMessageId: `user-${id}`,
    prompt: id,
    inputImageIds: [],
    outputTaskIds: [],
    status: 'done',
    error: null,
    createdAt: index,
    finishedAt: index,
  }
}

function conversation(rounds: AgentRound[], activeRoundId: string | null): AgentConversation {
  return {
    id: 'conversation-a',
    title: '对话',
    activeRoundId,
    createdAt: 1,
    updatedAt: 1,
    rounds,
    messages: [],
  }
}

describe('agent conversation state', () => {
  it('recovers attachments and the mask from the user card in a legacy session', () => {
    const source = round('legacy', null, 1)
    const saved = conversation([source], source.id)
    saved.messages = [{ id: source.userMessageId, role: 'user', roundId: source.id, content: '局部修改', createdAt: 1,
      inputImageIds: ['base'], maskImageId: 'mask', maskTargetImageId: 'base' }]
    const [restored] = normalizeAgentConversations([saved])
    expect(restored.rounds[0]).toMatchObject({ inputImageIds: ['base'], maskImageId: 'mask', maskTargetImageId: 'base' })
  })

  it('switches user inputs and replies independently after reload', () => {
    const first = round('first', null, 1)
    const other = round('other', null, 1)
    const retry = { ...round('retry', null, 1), userBranchId: first.userMessageId }
    const followup = round('followup', first.id, 2)
    const stored = conversation([first, other, retry, followup], retry.id)
    stored.messages = stored.rounds.map((item) => ({
      id: `reply-${item.id}`, roundId: item.id, role: 'assistant', content: '', createdAt: 1,
    }))
    const [value] = normalizeAgentConversations([stored])
    expect(getAgentSiblingRounds(value, retry, 'user').map((item) => item.id)).toEqual([retry.id, other.id])
    expect(getAgentSiblingRounds(value, retry, 'assistant').map((item) => item.id)).toEqual([first.id, retry.id])
    expect(getAgentBranchLeafId(value, first.id)).toBe(followup.id)
    expect(getAgentBranchLeafId(value, retry.id)).toBe(retry.id)
    value.messages = value.messages.filter((message) => message.roundId !== retry.id)
    expect(getAgentSiblingRounds(value, retry, 'user').map((item) => item.id)).toEqual([retry.id, other.id])
  })

  it('restores the selected reply and nested followup when returning to a user branch after reload', () => {
    const first = round('first', null, 1)
    const other = round('other', null, 1)
    const retry = { ...round('retry', null, 1), userBranchId: first.userMessageId }
    const followup = round('followup', first.id, 2)
    const alternate = round('alternate', first.id, 2)
    const stored = conversation([first, other, retry, followup, alternate], followup.id)
    const [value] = normalizeAgentConversations([{ ...stored, ...selectAgentBranch(stored, other.id) }])
    const [previous] = getAgentSiblingRounds(value, other, 'user')
    expect(previous.id).toBe(first.id)
    expect(getAgentBranchLeafId(value, previous.id)).toBe(followup.id)
  })

  it('stops traversing cyclic parent relationships', () => {
    const value = conversation([
      round('round-a', 'round-b', 1),
      round('round-b', 'round-a', 2),
    ], 'round-a')

    expect(getAgentRoundPath(value, 'round-a').map((item) => item.id)).toEqual(['round-b', 'round-a'])
    expect(getAgentBranchLeafId(value, 'round-a')).toBe('round-a')
  })

  it.each([
    {
      name: '缺失 activeRoundId 的旧线性格式',
      activeRoundId: undefined,
      parentRoundIds: [undefined, undefined],
      expectedActiveRoundId: 'round-b',
      expectedParentRoundIds: [null, 'round-a'],
    },
    {
      name: '有效 activeRoundId 的分支格式',
      activeRoundId: 'round-a',
      parentRoundIds: [undefined, undefined],
      expectedActiveRoundId: 'round-a',
      expectedParentRoundIds: [null, null],
    },
    {
      name: '失效 activeRoundId 的分支格式',
      activeRoundId: 'round-missing',
      parentRoundIds: [undefined, undefined],
      expectedActiveRoundId: 'round-b',
      expectedParentRoundIds: [null, null],
    },
    {
      name: '带 parent 的分支格式',
      activeRoundId: undefined,
      parentRoundIds: [null, 'round-a'],
      expectedActiveRoundId: 'round-b',
      expectedParentRoundIds: [null, 'round-a'],
    },
  ])('normalizes $name compatibly', ({ activeRoundId, parentRoundIds, expectedActiveRoundId, expectedParentRoundIds }) => {
    const normalized = normalizeAgentConversations([{
      id: 'conversation-a',
      title: '对话',
      ...(activeRoundId === undefined ? {} : { activeRoundId }),
      rounds: parentRoundIds.map((parentRoundId, index) => ({
        ...round(`round-${index === 0 ? 'a' : 'b'}`, null, index + 1),
        parentRoundId,
      })),
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }])

    expect(normalized[0].activeRoundId).toBe(expectedActiveRoundId)
    expect(normalized[0].rounds.map((item) => item.parentRoundId)).toEqual(expectedParentRoundIds)
  })

  it('filters malformed and orphaned records while preserving legacy field defaults', () => {
    const normalized = normalizeAgentConversations([null, {}, { id: '' }, {
      id: 'conversation-a',
      title: '',
      rounds: [
        null,
        { id: 'bad-round' },
        { ...round('round-a', null, 1), parentRoundId: undefined, status: 'running' },
      ],
      messages: [
        null,
        { id: 'bad-role', role: 'system', content: '丢弃', roundId: 'round-a', createdAt: 1 },
        { id: 'orphan', role: 'assistant', content: '丢弃', roundId: 'missing', createdAt: 2 },
        { id: 'user-round-a', role: 'user', content: '保留', roundId: 'round-a', createdAt: 3 },
      ],
      createdAt: 1,
      updatedAt: 2,
    }])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      title: '新对话',
      activeRoundId: 'round-a',
      rounds: [{ id: 'round-a', parentRoundId: null, status: 'error', error: '上次请求已中断' }],
    })
    expect(normalized[0].messages.map((message) => message.id)).toEqual(['user-round-a'])
  })

  it('filters malformed response output items while preserving unknown typed items', () => {
    const normalized = normalizeAgentConversations([{
      id: 'conversation-a',
      rounds: [{
        ...round('round-a', null, 1),
        responseOutput: [
          null,
          [],
          'invalid',
          {},
          { type: '' },
          { type: '   ' },
          { type: 'future_response_item', custom: { enabled: true } },
          { type: 'message', content: [] },
        ],
      }],
      messages: [],
    }])

    expect(normalized[0].rounds[0].responseOutput).toEqual([
      { type: 'future_response_item', custom: { enabled: true } },
      { type: 'message', content: [] },
    ])
  })

  it('keeps the first entity when persisted IDs are duplicated', () => {
    const normalized = normalizeAgentConversations([{
      id: 'conversation-a',
      title: '第一个对话',
      rounds: [
        round('round-a', null, 1),
        { ...round('round-a', null, 2), prompt: '重复轮次' },
      ],
      messages: [
        { id: 'message-a', role: 'user', content: '第一条', roundId: 'round-a', createdAt: 1 },
        { id: 'message-a', role: 'assistant', content: '重复消息', roundId: 'round-a', createdAt: 2 },
      ],
      createdAt: 1,
      updatedAt: 1,
    }, {
      id: 'conversation-a',
      title: '重复对话',
      rounds: [],
      messages: [],
      createdAt: 2,
      updatedAt: 2,
    }])

    expect(normalized).toHaveLength(1)
    expect(normalized[0].title).toBe('第一个对话')
    expect(normalized[0].rounds.map((item) => item.prompt)).toEqual(['round-a'])
    expect(normalized[0].messages.map((message) => message.content)).toEqual(['第一条'])
  })

  it('builds case-insensitive search text from conversation content', () => {
    const value = conversation([round('round-a', null, 1)], 'round-a')
    value.title = 'Project ALPHA'
    value.rounds[0].prompt = 'Round Prompt'
    value.messages = [{ id: 'user-round-a', role: 'user', content: 'Message Body', roundId: 'round-a', createdAt: 1 }]

    expect(getConversationSearchText(value)).toBe('project alpha\nmessage body\nround prompt')
  })

  it('groups legacy inputs with identical text and finds their unlinked replies after import', () => {
    const original = { ...round('original', null, 1), prompt: '继续' }
    const resent = { ...round('resent', null, 1), prompt: '继续' }
    const child = round('followup', original.id, 2)
    const stored = conversation([original, resent, child], resent.id)
    const [value] = normalizeAgentConversations([{
      ...stored,
      messages: [
        { id: original.userMessageId, roundId: original.id, role: 'user', content: '继续' },
        { id: resent.userMessageId, roundId: resent.id, role: 'user', content: '继续' },
        { id: 'original-reply', roundId: original.id, role: 'assistant', content: '完成' },
        { id: 'resent-reply', roundId: resent.id, role: 'assistant', content: '请求失败：超时' },
      ],
    }])
    const selected = value.rounds[1]

    expect(getAgentSiblingRounds(value, selected, 'user').map((item) => item.id)).toEqual([resent.id])
    expect(getAgentSiblingRounds(value, selected, 'assistant').map((item) => item.id)).toEqual([original.id, resent.id])
    const explicit = { ...resent, id: 'explicit', userMessageId: 'new-user', userBranchId: 'new-user' }
    const [reloaded] = normalizeAgentConversations([{ ...value, rounds: [...value.rounds, explicit] }])
    expect(getAgentSiblingRounds(reloaded, selected, 'user').map((item) => item.id)).toEqual([resent.id, explicit.id])
    expect(getAgentAssistantMessage(value, selected)?.id).toBe('resent-reply')
    expect(getAgentBranchLeafId(value, original.id)).toBe(child.id)
  })

  it('keeps migrated input identities after their parents are removed', () => {
    const [migrated] = normalizeAgentConversations([conversation([
      { ...round('a', null, 1), prompt: '画一张图' },
      { ...round('b', null, 1), prompt: '画一张图' },
      { ...round('c', 'a', 2), prompt: '继续' },
      { ...round('d', 'b', 2), prompt: '继续' },
    ], 'd')])
    expect(getAgentSiblingRounds(migrated, migrated.rounds[0], 'assistant')).toHaveLength(2)
    const after = deleteAgentRoundFromConversation(migrated, 'a')
    const [reloaded] = normalizeAgentConversations([after])
    expect(getAgentSiblingRounds(reloaded, reloaded.rounds[0], 'user').map((item) => item.id)).toEqual(['c', 'd'])
  })

  it('remaps replayable prompts, tool arguments and legacy task outputs through a removed ancestor', () => {
    const first = round('a', null, 1)
    const deleted = round('b', first.id, 2)
    const tag = '<ref id="round-3-reference-1" />'
    const gone = '<ref id="round-2-image-1" />'
    const prompt = `参考 ${tag}、${gone}、@第3轮图1`
    const wanted = '参考 <ref id="round-2-reference-1" />、<removed_ref id="round-2-image-1" />、@第2轮图1'
    const output = [
      { type: 'function_call', name: 'generate_image_batch', arguments: JSON.stringify({ images: [{ prompt }] }), call_id: 'call' },
      { type: 'function_call_output', call_id: 'call', output: [{ type: 'input_text', text: prompt }] },
      { type: 'message', content: [{ type: 'output_text', text: prompt }] },
    ]
    const last = { ...round('c', deleted.id, 3), prompt, responseOutput: output, outputTaskIds: ['task'] }
    const before = conversation([first, deleted, last], last.id)
    const after = deleteAgentRoundFromConversation(before, deleted.id)
    const remapped = after.rounds[1]
    expect(remapped.prompt).toBe(wanted)
    expect(JSON.parse(remapped.responseOutput![0].arguments!)).toEqual({ images: [{ prompt: wanted }] })
    expect(remapped.responseOutput![1].output).toEqual([{ type: 'input_text', text: wanted }])
    expect(remapped.responseOutput![2].content![0].text).toBe(wanted)
    const raw = JSON.stringify({ request_id: 'keep', output, extra: { untouched: prompt } }, null, 2)
    const task = { id: 'task', prompt, rawResponsePayload: raw } as TaskRecord
    const updated = remapAgentTaskReferencesAfterDeletion(task, before, after)
    expect(updated.prompt).toBe(wanted)
    expect(updated.rawResponsePayload).toBe(raw)
    const legacy = conversation([first, deleted, { ...last, responseOutput: [] }], last.id)
    const migrated = deleteAgentRoundFromConversation(legacy, deleted.id, 10, [task])
    const [reloaded] = normalizeAgentConversations(getPersistableAgentConversations([migrated]))
    expect(getAgentRoundResponseOutput(reloaded.rounds[1], [task])).toEqual(remapped.responseOutput)
  })
})
