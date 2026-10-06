import { useEffect, useRef, useState } from 'react'
import type { ApiProfile, TaskParams } from '../../types'
import { dismissAllTooltips } from '../../lib/tooltipDismiss'
import { ChevronDownIcon } from '../icons'
import Select from '../Select'
import ButtonTooltip from './buttonTooltip'

const CHIP_CLASS = 'h-8 px-3.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.07] dark:hover:bg-white/[0.1] text-xs text-gray-700 dark:text-gray-200 transition-colors duration-200 focus:outline-none'
const CHIP_DISABLED_CLASS = 'h-8 px-3.5 rounded-full bg-black/[0.03] dark:bg-white/[0.04] opacity-50 cursor-not-allowed text-xs text-gray-700 dark:text-gray-200'
const ROW_CLASS = 'relative flex items-center justify-between gap-3'
const ROW_LABEL_CLASS = 'text-gray-500 dark:text-gray-400'
const CONTROL_DISABLED_CLASS = 'px-3 py-1.5 rounded-xl border border-transparent dark:border-transparent bg-black/[0.04] dark:bg-white/[0.04] opacity-50 cursor-not-allowed text-xs transition-all duration-200 '

interface HintTooltipState {
  visible: boolean
  show: () => void
  hide: () => void
  clearTimer: () => void
  startTouch: () => void
}

export default function InputParamsPanel({
  params,
  setParams,
  activeProfile,
  modelOptions,
  onModelChange,
  isFalProvider,
  isFalTextToImage,
  displaySize,
  qualityOptions,
  selectClass,
  transparentOutputAvailable,
  showTransparentOutputControl,
  transparentOutputEnabled,
  transparentOutputHint,
  onTransparentOutputMenuOpenChange,
  compressionHint,
  compressionDisabled,
  outputCompressionInput,
  setOutputCompressionInput,
  commitOutputCompression,
  moderationHint,
  moderationDisabled,
  agentAutoImageCount,
  outputImageLimit,
  nInput,
  setNInputFocused,
  commitN,
  handleNInputChange,
  handleNLimitIncreaseAttempt,
  showAgentNHint,
  hideNLimitHint,
  startAgentNHintTouch,
  clearAgentNHintTouchTimer,
  nLimitHint,
  nLimitHintText,
  streamConcurrentByN,
  streamConcurrentHint,
  sizeHint,
  qualityHint,
  onOpenSizePicker,
}: {
  params: TaskParams
  setParams: (patch: Partial<TaskParams>) => void
  activeProfile: ApiProfile
  modelOptions: Array<{ label: string; value: string }>
  onModelChange: (model: string) => void
  isFalProvider: boolean
  isFalTextToImage: boolean
  displaySize: string
  qualityOptions: Array<{ label: string; value: string }>
  selectClass: string
  transparentOutputAvailable: boolean
  showTransparentOutputControl: boolean
  transparentOutputEnabled: boolean
  transparentOutputHint: HintTooltipState
  onTransparentOutputMenuOpenChange: (open: boolean) => void
  compressionHint: HintTooltipState
  compressionDisabled: boolean
  outputCompressionInput: string
  setOutputCompressionInput: (value: string) => void
  commitOutputCompression: () => void
  moderationHint: HintTooltipState
  moderationDisabled: boolean
  agentAutoImageCount: boolean
  outputImageLimit: number
  nInput: string
  setNInputFocused: (focused: boolean) => void
  commitN: () => void
  handleNInputChange: (value: string) => void
  handleNLimitIncreaseAttempt: (preventDefault: () => void) => void
  showAgentNHint: () => void
  hideNLimitHint: () => void
  startAgentNHintTouch: () => void
  clearAgentNHintTouchTimer: () => void
  nLimitHint: HintTooltipState
  nLimitHintText: string
  streamConcurrentByN: boolean
  streamConcurrentHint: HintTooltipState
  sizeHint: HintTooltipState
  qualityHint: HintTooltipState
  onOpenSizePicker: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const morePanelRef = useRef<HTMLDivElement>(null)
  // 折叠时也展示弹层内每一项的当前值，不支持的参数不显示
  const moreSummary = [
    params.output_format.toUpperCase(),
    showTransparentOutputControl
      ? `透明 ${transparentOutputEnabled}`
      : compressionDisabled ? null : `压缩 ${outputCompressionInput || '默认'}`,
    moderationDisabled ? null : `审核 ${params.moderation}`,
  ].filter(Boolean).join(' · ')
  const prefix = (text: string) => <span className="mr-1.5 text-gray-400 dark:text-gray-500">{text}</span>

  useEffect(() => {
    if (!moreOpen) return
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!morePanelRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) setMoreOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [moreOpen])

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0 text-xs">
      <div className="min-w-0 max-w-full sm:max-w-[14rem] max-sm:flex-auto">
        <Select
          value={activeProfile.model}
          onChange={(val) => onModelChange(String(val))}
          options={modelOptions}
          showValueTooltips
          menuClassName="min-w-max"
          className={CHIP_CLASS}
        />
      </div>
      <div
        className="relative max-sm:flex-auto"
        onMouseEnter={sizeHint.show}
        onMouseLeave={sizeHint.hide}
        onTouchStart={sizeHint.startTouch}
        onTouchEnd={sizeHint.clearTimer}
        onTouchCancel={sizeHint.hide}
        onClick={sizeHint.show}
      >
        <button
          type="button"
          onClick={() => { dismissAllTooltips(); onOpenSizePicker() }}
          className={`flex w-full items-center ${CHIP_CLASS}`}
        >
          {prefix('尺寸')}
          <span className="font-mono">{displaySize}</span>
        </button>
        <ButtonTooltip
          visible={(isFalTextToImage || activeProfile.codexCli) && sizeHint.visible}
          text={isFalTextToImage
            ? <>fal.ai 的文生图模式不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 参数</>
            : 'Codex CLI 不支持尺寸参数，此处设置仅基于提示词工程'}
        />
      </div>
      <div
        className="relative max-sm:flex-auto"
        onMouseEnter={qualityHint.show}
        onMouseLeave={qualityHint.hide}
        onTouchStart={qualityHint.startTouch}
        onTouchEnd={qualityHint.clearTimer}
        onTouchCancel={qualityHint.hide}
        onClick={qualityHint.show}
      >
        <Select
          value={activeProfile.codexCli ? 'auto' : isFalProvider && params.quality === 'auto' ? 'high' : params.quality}
          onChange={(val) => {
            if (!activeProfile.codexCli) setParams({ quality: val as TaskParams['quality'] })
          }}
          options={qualityOptions}
          disabled={activeProfile.codexCli}
          prefix={prefix('质量')}
          menuClassName="min-w-max"
          className={activeProfile.codexCli ? CHIP_DISABLED_CLASS : CHIP_CLASS}
        />
        <ButtonTooltip
          visible={(activeProfile.codexCli || isFalProvider) && qualityHint.visible}
          text={isFalProvider ? <>fal.ai 不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 质量参数</> : 'Codex CLI 不支持质量参数'}
        />
      </div>
      <label
        className={`relative flex items-center max-sm:flex-auto ${agentAutoImageCount ? CHIP_DISABLED_CLASS : `${CHIP_CLASS} cursor-text`}`}
        onMouseEnter={() => { showAgentNHint(); streamConcurrentHint.show() }}
        onMouseLeave={() => { hideNLimitHint(); streamConcurrentHint.hide() }}
        onTouchStart={() => { startAgentNHintTouch(); streamConcurrentHint.startTouch() }}
        onTouchEnd={() => { clearAgentNHintTouchTimer(); streamConcurrentHint.clearTimer() }}
        onTouchCancel={() => {
          clearAgentNHintTouchTimer()
          hideNLimitHint()
          streamConcurrentHint.hide()
        }}
        onClick={() => { showAgentNHint(); streamConcurrentHint.show() }}
      >
        {prefix('数量')}
        <input
          value={nInput}
          onChange={(e) => handleNInputChange(e.target.value)}
          onFocus={() => setNInputFocused(true)}
          onBlur={() => {
            setNInputFocused(false)
            commitN()
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          onWheel={(e) => {
            if (e.deltaY < 0) {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          disabled={agentAutoImageCount}
          type={agentAutoImageCount ? 'text' : 'number'}
          min={agentAutoImageCount ? undefined : 1}
          max={agentAutoImageCount ? undefined : outputImageLimit}
          style={{ width: `${Math.max(1, nInput.length)}ch` }}
          className="bg-transparent text-xs focus:outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <ButtonTooltip visible={nLimitHint.visible} text={nLimitHintText} />
        <ButtonTooltip visible={streamConcurrentByN && streamConcurrentHint.visible && !nLimitHint.visible} text="数量大于 1 时会将多图生成拆分为并发单图" />
      </label>
      <div className="relative min-w-0 max-sm:flex-auto">
        <button
          ref={moreButtonRef}
          type="button"
          onClick={() => { dismissAllTooltips(); setMoreOpen((open) => !open) }}
          aria-expanded={moreOpen}
          className={`flex w-full items-center gap-1 min-w-0 ${CHIP_CLASS} ${moreOpen ? '!bg-black/[0.07] dark:!bg-white/[0.1]' : ''}`}
        >
          <span className="flex-shrink-0">更多</span>
          <span className="flex-1 truncate text-left text-gray-400 dark:text-gray-500">· {moreSummary}</span>
          <ChevronDownIcon className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
        </button>
        {moreOpen && (
          <div
            ref={morePanelRef}
            className="absolute bottom-full left-0 z-40 mb-2 flex w-60 flex-col gap-2 rounded-xl border border-transparent bg-white/95 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-up dark:border-transparent dark:bg-gray-800/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)] dark:ring-white/[0.06]"
          >
            <div className={ROW_CLASS}>
              <span className={ROW_LABEL_CLASS}>格式</span>
              <div className="w-28">
                <Select
                  value={params.output_format}
                  onChange={(val) => {
                    setParams({
                      output_format: val as TaskParams['output_format'],
                      ...(val === 'png' ? { output_compression: null } : {}),
                      ...(val === 'jpeg' ? { transparent_output: false } : {}),
                    })
                  }}
                  options={[
                    { label: 'PNG', value: 'png' },
                    { label: 'JPEG', value: 'jpeg' },
                    { label: 'WebP', value: 'webp' },
                  ]}
                  className={selectClass}
                />
              </div>
            </div>
            {showTransparentOutputControl && (
              <div
                className={ROW_CLASS}
                onMouseEnter={transparentOutputHint.show}
                onMouseLeave={transparentOutputHint.hide}
                onTouchStart={transparentOutputHint.startTouch}
                onTouchEnd={transparentOutputHint.clearTimer}
                onTouchCancel={transparentOutputHint.hide}
                onClick={transparentOutputHint.show}
              >
                <span className={ROW_LABEL_CLASS}>透明背景</span>
                <div className="w-28">
                  <Select
                    value={transparentOutputEnabled ? 'on' : 'off'}
                    onChange={(val) => {
                      if (!transparentOutputAvailable) return
                      setParams({
                        transparent_output: val === 'on',
                        ...(params.output_format === 'png' ? { output_compression: null } : {}),
                      })
                    }}
                    options={[
                      { label: 'false', value: 'off' },
                      { label: 'true', value: 'on' },
                    ]}
                    className={selectClass}
                    onOpenChange={onTransparentOutputMenuOpenChange}
                  />
                </div>
                <ButtonTooltip
                  visible={transparentOutputHint.visible}
                  text="实现方式可在设置的 API 配置中选择"
                />
              </div>
            )}
            {!showTransparentOutputControl && (
              <label
                className={ROW_CLASS}
                onMouseEnter={compressionHint.show}
                onMouseLeave={compressionHint.hide}
                onTouchStart={compressionHint.startTouch}
                onTouchEnd={compressionHint.clearTimer}
                onTouchCancel={compressionHint.hide}
                onClick={compressionHint.show}
              >
                <span className={ROW_LABEL_CLASS}>压缩率</span>
                <input
                  value={outputCompressionInput}
                  onChange={(e) => setOutputCompressionInput(e.target.value)}
                  onBlur={commitOutputCompression}
                  disabled={compressionDisabled}
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0-100"
                  className={`w-28 px-3 py-1.5 rounded-xl border border-transparent focus:border-blue-300 dark:focus:border-blue-500/50 focus:outline-none text-xs transition-all duration-200 ${
                    compressionDisabled
                      ? 'bg-black/[0.03] dark:bg-white/[0.04] opacity-50 cursor-not-allowed'
                      : 'bg-black/[0.04] dark:bg-white/[0.06]'
                    }`}
                />
                <ButtonTooltip
                  visible={compressionHint.visible}
                  text={isFalProvider ? 'fal.ai 不支持压缩率参数' : '仅 JPEG 和 WebP 支持压缩率'}
                />
              </label>
            )}
            <div
              className={ROW_CLASS}
              onMouseEnter={moderationHint.show}
              onMouseLeave={moderationHint.hide}
              onTouchStart={moderationHint.startTouch}
              onTouchEnd={moderationHint.clearTimer}
              onTouchCancel={moderationHint.hide}
              onClick={moderationHint.show}
            >
              <span className={ROW_LABEL_CLASS}>审核</span>
              <div className="w-28">
                <Select
                  value={moderationDisabled ? 'auto' : params.moderation}
                  onChange={(val) => {
                    if (!moderationDisabled) setParams({ moderation: val as TaskParams['moderation'] })
                  }}
                  options={[
                    { label: 'auto', value: 'auto' },
                    { label: 'low', value: 'low' },
                  ]}
                  disabled={moderationDisabled}
                  className={moderationDisabled ? CONTROL_DISABLED_CLASS : selectClass}
                />
              </div>
              <ButtonTooltip
                visible={moderationDisabled && moderationHint.visible}
                text="fal.ai 不支持审核参数"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
