import { useState } from 'react'
import { useStore } from '../store'
import { createSketchId, type SketchComment } from '../lib/sketch'
import { getImageComments, upsertImageCommentMention } from '../lib/promptImageMentions'

/**
 * 画板评论：重新编辑参考图时从提示词中该图的评论胶囊恢复，保存时写回胶囊。
 * 坐标均为相对画布宽高的比例，与原图一致。
 */
export function useSketchComments(replaceImageId?: string) {
  const [initialComments] = useState(() => {
    const state = useStore.getState()
    const idx = replaceImageId ? state.inputImages.findIndex((img) => img.id === replaceImageId) : -1
    return idx >= 0 ? getImageComments(state.prompt, idx) : []
  })
  const [comments, setComments] = useState<SketchComment[]>(() => initialComments.map((comment) => ({ ...comment, id: createSketchId() })))
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)

  const commentData = comments.filter((comment) => comment.text.trim()).map((comment) => ({ x: comment.x, y: comment.y, text: comment.text.trim() }))
  const commentsChanged = JSON.stringify(commentData) !== JSON.stringify(initialComments)

  const updateComment = (id: string, patch: Partial<SketchComment>) => {
    setComments((items) => items.map((comment) => comment.id === id ? { ...comment, ...patch } : comment))
  }

  const createComment = (x: number, y: number) => {
    const id = createSketchId()
    setComments((items) => [...items, { id, x, y, text: '' }])
    setActiveCommentId(id)
  }

  /** 收起评论输入框，空评论直接删除 */
  const finishComment = () => {
    setComments((items) => items.flatMap((comment) => {
      if (comment.id !== activeCommentId) return [comment]
      return comment.text.trim() ? [{ ...comment, text: comment.text.trim() }] : []
    }))
    setActiveCommentId(null)
  }

  const openComment = (id: string) => {
    setComments((items) => items.filter((comment) => comment.id === id || comment.id !== activeCommentId || comment.text.trim()))
    setActiveCommentId(id)
  }

  const removeComment = (id: string) => {
    setComments((items) => items.filter((comment) => comment.id !== id))
    setActiveCommentId(null)
  }

  /**
   * 把评论写入提示词中第 idx 张参考图的评论胶囊：已有则原地更新，否则插到输入框光标处（有选区时替换选中内容）。
   * merge 为 true 时保留该图原有评论，用于导出结果与已有参考图相同的情况。
   */
  const saveComments = (idx: number, merge = false) => {
    const latest = useStore.getState()
    const next = merge ? [...getImageComments(latest.prompt, idx), ...commentData] : commentData
    const selection = latest.promptSelection?.prompt === latest.prompt ? latest.promptSelection : { start: Infinity, end: Infinity }
    const result = upsertImageCommentMention(latest.prompt, idx, next, selection.start, selection.end)
    latest.setPrompt(result.prompt)
    // 输入框不在焦点上不会同步选区，手动移到新胶囊之后，避免下次插入仍按旧选区覆盖
    if (result.cursor != null) latest.setPromptSelection({ start: result.cursor, end: result.cursor })
  }

  return {
    comments,
    activeCommentId,
    commentData,
    commentsChanged,
    updateComment,
    createComment,
    finishComment,
    openComment,
    removeComment,
    saveComments,
  }
}
