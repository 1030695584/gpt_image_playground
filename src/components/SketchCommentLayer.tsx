import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SketchComment, SketchPoint } from '../lib/sketch'
import { COMMENT_PIN_SIZE, CommentPin } from './CommentMarks'
import { TooltipButton } from './TooltipButton'
import { CheckIcon } from './editor/EditorControls'
import { TrashIcon } from './icons'

const EDITOR_WIDTH = 280
const EDITOR_HEIGHT = 44

/**
 * 画板评论气泡层：气泡按屏幕像素固定大小，不随画布缩放；
 * 任意工具下都可拖动气泡，评论工具下点击气泡会展开输入框。
 */
export default function SketchCommentLayer({
  comments,
  activeId,
  docSize,
  viewScale,
  offset,
  boundsRight,
  canOpen,
  toDocPoint,
  onMove,
  onOpen,
  onChangeText,
  onFinish,
  onDelete,
}: {
  comments: SketchComment[]
  activeId: string | null
  docSize: { width: number; height: number }
  viewScale: number
  /** 画布平移量，气泡位置 = 文档坐标 × viewScale + offset */
  offset: SketchPoint
  /** 可见区域右边界（相对画布布局框），输入框放不下时改到气泡左侧 */
  boundsRight: number
  canOpen: boolean
  toDocPoint: (event: { clientX: number; clientY: number }) => SketchPoint
  onMove: (id: string, x: number, y: number) => void
  onOpen: (id: string) => void
  onChangeText: (id: string, text: string) => void
  onFinish: () => void
  onDelete: (id: string) => void
}) {
  // offsetX / offsetY 为按下点相对气泡尖角（评论坐标）的偏移，拖动时保持不变，气泡不会跳到指针下
  const dragRef = useRef<{ id: string; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null)

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (event.pointerType !== 'touch' && event.button !== 0) return
    // 不交给画布处理，避免拖动气泡时同时作画
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = { id, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.bottom, moved: false }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.stopPropagation()
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
    drag.moved = true
    const point = toDocPoint({ clientX: event.clientX - drag.offsetX, clientY: event.clientY - drag.offsetY })
    onMove(drag.id, Math.min(1, Math.max(0, point.x / docSize.width)), Math.min(1, Math.max(0, point.y / docSize.height)))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    event.stopPropagation()
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag.moved && canOpen) onOpen(drag.id)
  }

  const activeIndex = comments.findIndex((comment) => comment.id === activeId)
  const active = comments[activeIndex]
  const getPosition = (comment: SketchComment) => ({
    x: comment.x * docSize.width * viewScale + offset.x,
    y: comment.y * docSize.height * viewScale + offset.y,
  })
  const activePosition = active && getPosition(active)

  return (
    <>
      {comments.map((comment, idx) => {
        const { x, y } = getPosition(comment)
        return (
          <CommentPin
            key={comment.id}
            index={idx}
            active={comment.id === activeId}
            className="absolute z-10 touch-none"
            style={{ left: x, top: y - COMMENT_PIN_SIZE, cursor: canOpen ? 'pointer' : 'grab' }}
            onPointerDown={(event) => handlePointerDown(event, comment.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )
      })}
      {/* 只渲染一个编辑框，切换评论时复用同一元素，避免卸载触发失焦把新打开的评论关掉 */}
      {active && activePosition && (
        <div
          className="absolute z-20 flex items-center gap-1 rounded-full border border-gray-200/80 bg-white/95 p-1 shadow-lg backdrop-blur-md focus-within:border-blue-400 dark:border-white/[0.08] dark:bg-gray-800/95 dark:focus-within:border-blue-400/60"
          style={{
            // 与气泡垂直居中对齐，右侧放不下时改到气泡左侧
            left: activePosition.x + COMMENT_PIN_SIZE + 8 + EDITOR_WIDTH > boundsRight ? activePosition.x - EDITOR_WIDTH - 8 : activePosition.x + COMMENT_PIN_SIZE + 8,
            top: activePosition.y - COMMENT_PIN_SIZE / 2 - EDITOR_HEIGHT / 2,
            width: EDITOR_WIDTH,
            height: EDITOR_HEIGHT,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          // 点击两侧按钮时不让输入框失焦，由按钮自己决定删除或收起
          onMouseDown={(event) => {
            if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
          }}
        >
          <TooltipButton
            tooltip="删除评论"
            wrapperClassName="relative inline-flex flex-none"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-red-50 hover:text-red-500 dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-red-500/15 dark:hover:text-red-400"
            onClick={() => onDelete(active.id)}
          >
            <TrashIcon className="h-4 w-4" />
          </TooltipButton>
          <input
            autoFocus
            value={active.text}
            placeholder="添加评论…"
            aria-label={`评论 ${activeIndex + 1}`}
            onChange={(event) => onChangeText(active.id, event.target.value)}
            onBlur={onFinish}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur()
            }}
            className="min-w-0 flex-1 bg-transparent px-1.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <TooltipButton
            tooltip="完成"
            wrapperClassName="relative inline-flex flex-none"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm transition hover:bg-blue-600"
            onClick={onFinish}
          >
            <CheckIcon />
          </TooltipButton>
        </div>
      )}
    </>
  )
}
