import type { AgentRound, TaskRecord } from '../types'
import { replaceImageMentionsForApi, stripImageMentionMarkers } from './promptImageMentions'

const AGENT_ROUND_IMAGE_REFERENCE_RE = /@(?:第)?(\d+)轮图(\d+)/g
const AGENT_REF_TAG_RE = /<ref\b[^>]*\bid=(["'])(round-(\d+)-(?:image|reference)-(\d+))\1[^>]*\/?>/g

export function getAgentCurrentReferenceId(round: AgentRound, index: number) {
  return `round-${round.index}-reference-${index + 1}`
}

export function getAgentGeneratedImageReferenceId(round: AgentRound, index: number) {
  return `round-${round.index}-image-${index + 1}`
}

export function getAgentReferenceTag(referenceId: string) {
  return `<ref id="${referenceId}" />`
}

export function getAgentRemovedReferenceTag(referenceId: string) {
  return `<removed_ref id="${referenceId}" />`
}

export function setAgentRoundOutputTaskIds(round: AgentRound, ids: string[]): AgentRound {
  const keep = new Set(ids)
  const prompts = Object.entries(round.outputTaskPrompts ?? {}).filter(([id]) => keep.has(id))
  const widths = Object.entries(round.deletedOutputTaskWidths ?? {}).filter(([id]) => keep.has(id))
  return {
    ...round,
    outputTaskIds: ids,
    ...(round.outputTaskPrompts ? { outputTaskPrompts: prompts.length ? Object.fromEntries(prompts) : undefined } : {}),
    ...(round.deletedOutputTaskWidths ? { deletedOutputTaskWidths: widths.length ? Object.fromEntries(widths) : undefined } : {}),
  }
}

export function getAgentTaskImageSlots(task: TaskRecord | undefined, missingWidth = 1): Array<string | null> {
  if (!task) return Array(Number.isSafeInteger(missingWidth) && missingWidth >= 0 ? missingWidth : 1).fill(null)
  if (!Array.isArray(task.removedOutputImageIndices)) return task.outputImages
  const width = task.outputImages.length + task.removedOutputImageIndices.length
  const removed = new Set(task.removedOutputImageIndices)
  if (removed.size !== task.removedOutputImageIndices.length ||
    task.removedOutputImageIndices.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= width)) return task.outputImages
  let liveIndex = 0
  return Array.from({ length: width }, (_, index) =>
    removed.has(index) ? null : task.outputImages[liveIndex++] ?? null)
}

export function collectAgentRoundOutputImageSlots(round: AgentRound, tasks: TaskRecord[]) {
  return round.outputTaskIds.flatMap((id) => getAgentTaskImageSlots(tasks.find((task) => task.id === id), round.deletedOutputTaskWidths?.[id]))
}

export function extractAgentReferenceIds(text: string) {
  return Array.from(text.matchAll(AGENT_REF_TAG_RE), (match) => match[2]).filter((id): id is string => Boolean(id))
}

export function replaceAgentPromptImageReferencesForApi(
  prompt: string,
  currentRound: AgentRound,
  rounds: AgentRound[],
  tasks: TaskRecord[],
) {
  const withCurrentReferences = replaceImageMentionsForApi(
    prompt,
    currentRound.inputImageIds.length,
    (index) => getAgentReferenceTag(getAgentCurrentReferenceId(currentRound, index)),
  )

  const replaceGeneratedReference = (text: string, roundNumber: string, imageNumber: string) => {
    const roundIndex = Number(roundNumber) - 1
    const imageIndex = Number(imageNumber) - 1
    const sourceRound = rounds[roundIndex]
    if (!sourceRound || imageIndex < 0) return text

    const imageId = collectAgentRoundOutputImageSlots(sourceRound, tasks)[imageIndex]
    if (!imageId) return getAgentRemovedReferenceTag(getAgentGeneratedImageReferenceId(sourceRound, imageIndex))

    const currentReferenceIndex = currentRound.inputImageIds.indexOf(imageId)
    const referenceId = currentReferenceIndex >= 0
      ? getAgentCurrentReferenceId(currentRound, currentReferenceIndex)
      : getAgentGeneratedImageReferenceId(sourceRound, imageIndex)
    return getAgentReferenceTag(referenceId)
  }
  const withAgentReferences = withCurrentReferences.replace(AGENT_ROUND_IMAGE_REFERENCE_RE, replaceGeneratedReference)
  return stripImageMentionMarkers(withAgentReferences)
}
