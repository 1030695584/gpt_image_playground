import type { AgentConversation, AgentInputDraft, AgentRound, AppMode, InputImage, MaskDraft } from '../types'
import { getAgentRoundPath, remapAgentRoundMentionsForPathChange } from './agentConversationState'
import { remapImageMentionsForOrder } from './promptImageMentions'

const AGENT_INPUT_DRAFT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000

type InputDraftFields = Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'>

type AgentInputDraftState = InputDraftFields & {
  appMode: AppMode
  activeAgentConversationId: string | null
  agentEditingRoundId?: string | null
  agentInputDrafts: Record<string, AgentInputDraft>
}

type GalleryInputDraftState = InputDraftFields & {
  appMode: AppMode
  galleryInputDraft: AgentInputDraft | null
}

type ActiveInputDraftState = AgentInputDraftState & Pick<GalleryInputDraftState, 'galleryInputDraft'>

export function isAgentEditComposerCurrent(initial: AgentInputDraftState, state: AgentInputDraftState) {
  return state.appMode === 'agent' && state.activeAgentConversationId === initial.activeAgentConversationId &&
    state.agentEditingRoundId === initial.agentEditingRoundId && state.inputImages === initial.inputImages &&
    state.prompt === initial.prompt && state.maskDraft === initial.maskDraft
}

export function removeConversationInputDrafts(drafts: Record<string, AgentInputDraft>, id: string) {
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => getAgentDraftOwner(key).conversationId !== id))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeInputImages(value: unknown): InputImage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((img): InputImage | null => {
      if (!isRecord(img) || typeof img.id !== 'string') return null
      return {
        id: img.id,
        dataUrl: typeof img.dataUrl === 'string' ? img.dataUrl : '',
        ...(typeof img.markupImageId === 'string' && img.markupImageId ? { markupImageId: img.markupImageId } : {}),
      }
    })
    .filter((img): img is InputImage => img != null)
}

function normalizeMaskDraft(value: unknown): MaskDraft | null {
  if (!isRecord(value)) return null
  if (typeof value.targetImageId !== 'string' || typeof value.maskDataUrl !== 'string') return null
  return {
    targetImageId: value.targetImageId,
    maskDataUrl: value.maskDataUrl,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

export function normalizeAgentInputDraft(value: unknown, fallbackUpdatedAt = Date.now()): AgentInputDraft {
  const draft = isRecord(value) ? value : {}
  const updatedAt = typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : fallbackUpdatedAt
  return {
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    inputImages: normalizeInputImages(draft.inputImages),
    maskDraft: normalizeMaskDraft(draft.maskDraft),
    maskEditorImageId: typeof draft.maskEditorImageId === 'string' ? draft.maskEditorImageId : null,
    updatedAt,
  }
}

export function agentDraftKey(conversationId: string, kind: 'branch' | 'edit', roundId: string | null) {
  return JSON.stringify([conversationId, kind, roundId])
}

export function getAgentDraftOwner(key: string) {
  if (key.startsWith('[')) {
    try {
      const parts: unknown = JSON.parse(key)
      if (Array.isArray(parts) && parts.length === 3 && typeof parts[0] === 'string' &&
        (parts[1] === 'branch' || parts[1] === 'edit') && (parts[2] === null || typeof parts[2] === 'string')) {
        return { conversationId: parts[0] as string, kind: parts[1], roundId: parts[2] as string | null }
      }
    } catch { /* 旧草稿直接使用会话 ID */ }
  }
  return { conversationId: key, kind: null, roundId: null }
}

export function normalizeAgentInputDrafts(value: unknown, conversations: Pick<AgentConversation, 'id'>[]): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const conversationIds = new Set(conversations.map((conversation) => conversation.id))
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    if (!conversationIds.has(getAgentDraftOwner(conversationId).conversationId)) continue
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized, conversationId)) drafts[conversationId] = normalized
  }
  return drafts
}

export function normalizeAgentInputDraftsByKey(value: unknown): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized, conversationId)) drafts[conversationId] = normalized
  }
  return drafts
}

export function cleanStaleAgentInputDrafts(drafts: Record<string, AgentInputDraft>, activeConversationId: string | null, now = Date.now()) {
  const cutoff = now - AGENT_INPUT_DRAFT_RETENTION_MS
  const next: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (conversationId === activeConversationId || (draft.updatedAt ?? now) >= cutoff) {
      next[conversationId] = draft
    }
  }
  return next
}

export function clearInputDraftState(): InputDraftFields {
  return {
    prompt: '',
    inputImages: [],
    maskDraft: null,
    maskEditorImageId: null,
  }
}

function copyAgentInputDraft(draft: AgentInputDraft): AgentInputDraft {
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
    updatedAt: draft.updatedAt ?? Date.now(),
  }
}

function getCurrentAgentInputDraft(state: InputDraftFields): AgentInputDraft {
  return {
    prompt: state.prompt,
    inputImages: state.inputImages,
    maskDraft: state.maskDraft,
    maskEditorImageId: state.maskEditorImageId,
    updatedAt: Date.now(),
  }
}

export function isEmptyAgentInputDraft(draft: AgentInputDraft, key?: string) {
  // 编辑时清空原文也是需要保留的修改。
  return draft.prompt.length === 0 && draft.inputImages.length === 0 && !draft.maskDraft && !draft.maskEditorImageId &&
    (!key || getAgentDraftOwner(key).kind !== 'edit')
}

function setAgentInputDraft(drafts: Record<string, AgentInputDraft>, conversationId: string, draft: AgentInputDraft) {
  const next = { ...drafts }
  if (isEmptyAgentInputDraft(draft, conversationId)) {
    delete next[conversationId]
  } else {
    next[conversationId] = copyAgentInputDraft(draft)
  }
  return next
}

export function saveActiveAgentInputDrafts(state: AgentInputDraftState) {
  if (state.appMode !== 'agent' || !state.activeAgentConversationId) return state.agentInputDrafts
  const key = state.agentEditingRoundId ? agentDraftKey(state.activeAgentConversationId, 'edit', state.agentEditingRoundId) : state.activeAgentConversationId
  const draft = getCurrentAgentInputDraft(state)
  if (state.agentEditingRoundId && !state.agentInputDrafts[key] && isEmptyAgentInputDraft(draft)) return state.agentInputDrafts
  return setAgentInputDraft(state.agentInputDrafts, key, draft)
}

export function saveGalleryInputDraft(state: GalleryInputDraftState) {
  if (state.appMode !== 'gallery') return state.galleryInputDraft
  const draft = getCurrentAgentInputDraft(state)
  return isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft)
}

export function restoreGalleryInputDraftState(draft: AgentInputDraft | null): InputDraftFields {
  if (!draft) return clearInputDraftState()
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
  }
}

export function restoreAgentInputDraftState(drafts: Record<string, AgentInputDraft>, conversationId: string | null): InputDraftFields {
  const draft = conversationId ? drafts[conversationId] : null
  return restoreGalleryInputDraftState(draft ?? null)
}

export function syncActiveInputDraft<T extends Partial<AgentInputDraft>>(
  state: ActiveInputDraftState,
  patch: T,
): T & { agentInputDrafts?: Record<string, AgentInputDraft>; galleryInputDraft?: AgentInputDraft | null } {
  const draft: AgentInputDraft = {
    prompt: patch.prompt ?? state.prompt,
    inputImages: patch.inputImages ?? state.inputImages,
    maskDraft: patch.maskDraft !== undefined ? patch.maskDraft : state.maskDraft,
    maskEditorImageId: patch.maskEditorImageId !== undefined ? patch.maskEditorImageId : state.maskEditorImageId,
  }
  if (state.appMode === 'gallery') {
    return {
      ...patch,
      galleryInputDraft: isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft),
    }
  }
  if (!state.activeAgentConversationId) return patch
  return {
    ...patch,
    agentInputDrafts: setAgentInputDraft(state.agentInputDrafts, state.agentEditingRoundId
      ? agentDraftKey(state.activeAgentConversationId, 'edit', state.agentEditingRoundId) : state.activeAgentConversationId, draft),
  }
}

export function updateInputDraftImages(
  draft: InputDraftFields,
  inputImages: InputImage[],
  options: { equivalentImageIds?: Record<string, string>; clearMissingMask?: boolean } = {},
) {
  const shouldClearMask = options.clearMissingMask !== false && Boolean(draft.maskDraft) && !inputImages.some((img) => img.id === draft.maskDraft?.targetImageId)
  return {
    inputImages,
    prompt: remapImageMentionsForOrder(draft.prompt, draft.inputImages, inputImages, options.equivalentImageIds),
    ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
  }
}

function restoreDraftImages(draft: InputDraftFields, images: Map<string, string | undefined>) {
  if (!draft.inputImages.some((img) => !img.dataUrl && images.has(img.id))) return null
  const restored = draft.inputImages.flatMap((img) => {
    if (img.dataUrl || !images.has(img.id)) return [img]
    const dataUrl = images.get(img.id)
    return dataUrl ? [{ ...img, dataUrl }] : []
  })
  return updateInputDraftImages(draft, restored)
}

export function hydrateInputDraftImages(state: ActiveInputDraftState, images: Map<string, string | undefined>) {
  const patch: Partial<ActiveInputDraftState> = {}
  if (state.galleryInputDraft) {
    const updated = restoreDraftImages(state.galleryInputDraft, images)
    if (updated) {
      const draft = { ...state.galleryInputDraft, ...updated }
      patch.galleryInputDraft = isEmptyAgentInputDraft(draft) ? null : draft
    }
  }
  for (const [key, draft] of Object.entries(state.agentInputDrafts)) {
    const updated = restoreDraftImages(draft, images)
    if (!updated) continue
    const next = { ...draft, ...updated }
    patch.agentInputDrafts ??= { ...state.agentInputDrafts }
    if (isEmptyAgentInputDraft(next, key)) delete patch.agentInputDrafts[key]
    else patch.agentInputDrafts[key] = next
  }
  const visible = restoreDraftImages(state, images)
  if (visible) Object.assign(patch, visible)
  else if (state.appMode === 'gallery' && patch.galleryInputDraft && isEmptyAgentInputDraft(state)) {
    Object.assign(patch, restoreGalleryInputDraftState(patch.galleryInputDraft))
  }
  return patch
}

export function remapAgentInputDraftMentionsForPathChange(
  drafts: Record<string, AgentInputDraft>,
  conversationId: string,
  oldPath: AgentRound[],
  newPath: AgentRound[],
) {
  const draft = drafts[conversationId]
  if (!draft) return drafts
  return {
    ...drafts,
    [conversationId]: {
      ...draft,
      prompt: remapAgentRoundMentionsForPathChange(draft.prompt, oldPath, newPath),
    },
  }
}

export function reconcileAgentDraftsAfterDeletion(
  drafts: Record<string, AgentInputDraft>, before: AgentConversation, after: AgentConversation,
) {
  let next = { ...drafts }
  for (const key of Object.keys(drafts)) {
    const owner = getAgentDraftOwner(key)
    if (owner.conversationId !== before.id) continue
    if (owner.roundId && !after.rounds.some((round) => round.id === owner.roundId)) {
      delete next[key]
      continue
    }
    next = remapAgentInputDraftMentionsForPathChange(next, key,
      getAgentRoundPath(before, owner.roundId ?? before.activeRoundId ?? null),
      getAgentRoundPath(after, owner.roundId ?? after.activeRoundId ?? null))
  }
  if (after.activeRoundId !== before.activeRoundId) {
    const key = agentDraftKey(after.id, 'branch', after.activeRoundId ?? null)
    if (next[key]) {
      next[after.id] = next[key]
      delete next[key]
    } else {
      delete next[after.id]
    }
  }
  return next
}

export function restoreAgentDraftsAfterImport(
  state: AgentInputDraftState, previous: AgentConversation[], imported: AgentConversation[], activeId: string | null,
) {
  let drafts = saveActiveAgentInputDrafts(state)
  const replaced = new Map(imported.map((item) => [item.id, item]))
  for (const before of previous) {
    const after = replaced.get(before.id)
    if (!after) continue
    if (before.activeRoundId && before.activeRoundId !== after.activeRoundId && drafts[before.id]) {
      drafts = { ...drafts, [agentDraftKey(before.id, 'branch', before.activeRoundId)]: drafts[before.id] }
      delete drafts[before.id]
    }
    drafts = reconcileAgentDraftsAfterDeletion(drafts, before, after)
  }
  const conversation = activeId ? replaced.get(activeId) : null
  if (state.appMode !== 'agent' || (!conversation && activeId === state.activeAgentConversationId)) return { agentInputDrafts: drafts }
  const editing = activeId === state.activeAgentConversationId && conversation && state.agentEditingRoundId &&
    getAgentRoundPath(conversation, conversation.activeRoundId ?? null).some((item) => item.id === state.agentEditingRoundId)
    ? state.agentEditingRoundId : null
  return {
    agentInputDrafts: drafts,
    agentEditingRoundId: editing,
    ...restoreAgentInputDraftState(drafts, activeId && editing ? agentDraftKey(activeId, 'edit', editing) : activeId),
  }
}

export function getPersistableAgentInputDrafts(
  state: AgentInputDraftState & { agentConversations: Pick<AgentConversation, 'id'>[] },
) {
  const drafts = saveActiveAgentInputDrafts(state)
  const conversationIds = new Set(state.agentConversations.map((conversation) => conversation.id))
  const persistable: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (!conversationIds.has(getAgentDraftOwner(conversationId).conversationId) || isEmptyAgentInputDraft(draft, conversationId)) continue
    persistable[conversationId] = {
      ...copyAgentInputDraft(draft),
      inputImages: draft.inputImages.map((img) => ({ id: img.id, dataUrl: '', markupImageId: img.markupImageId })),
    }
  }
  return persistable
}
