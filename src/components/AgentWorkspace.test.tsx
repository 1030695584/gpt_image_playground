// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { AgentConversation } from '../types'
import { useStore } from '../store'
import AgentWorkspace from './AgentWorkspace'

it.each(['waiting', 'streaming', 'empty'])('keeps reply navigation reachable for a %s branch', (phase) => {
  const conversation: AgentConversation = {
    id: 'test', title: '测试', activeRoundId: 'first', createdAt: 1, updatedAt: 1,
    rounds: ['first', 'second'].map((id) => ({
      id, index: 1, userMessageId: `user-${id}`, userBranchId: 'input', prompt: '用户消息',
      inputImageIds: [], outputTaskIds: [], status: id === 'first' || phase === 'empty' ? 'done' : 'running',
      error: null, createdAt: 1, finishedAt: null,
    })),
    messages: [
      { id: 'user-first', roundId: 'first', role: 'user', content: '用户消息', createdAt: 1 },
      { id: 'reply-first', roundId: 'first', role: 'assistant', content: '已完成', createdAt: 1 },
      { id: 'user-second', roundId: 'second', role: 'user', content: '用户消息', createdAt: 1 },
    ],
  }
  if (phase === 'streaming') {
    conversation.messages.push({ id: 'reply-second', roundId: 'second', role: 'assistant', content: '正在输出', createdAt: 1 })
  }

  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const initial = useStore.getState()
  const container = document.createElement('div')
  const root = createRoot(container)
  const scroll = vi.fn()
  try {
    useStore.setState({
      appMode: 'agent', agentConversations: [conversation], activeAgentConversationId: conversation.id,
      settings: { ...initial.settings, agentScrollToBottomAfterSubmit: false },
    })
    act(() => root.render(<AgentWorkspace />))
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="下一分支"]')!
    act(() => next.click())

    const previous = container.querySelector<HTMLButtonElement>('button[aria-label="上一分支"]')!
    expect(previous).toBeTruthy()
    const controls = previous.parentElement!.parentElement!
    controls.scrollIntoView = scroll
    act(() => vi.advanceTimersByTime(20))
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    if (phase !== 'empty') expect(container.querySelector('button[aria-label="重新生成"]')).toBeNull()

    act(() => previous.click())
    expect(useStore.getState().agentConversations[0].activeRoundId).toBe('first')
    expect(useStore.getState().agentConversations[0].rounds[1].status).toBe(phase === 'empty' ? 'done' : 'running')
  } finally {
    act(() => root.unmount())
    useStore.setState(initial, true)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
