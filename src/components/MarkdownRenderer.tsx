import { memo } from 'react'
import { Streamdown, type Components, type StreamdownTranslations } from 'streamdown'

type MarkdownRendererProps = {
  content: string
  streaming?: boolean
  className?: string
}

const allowedUrlProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function safeUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin)
    return allowedUrlProtocols.has(parsed.protocol) ? url : '#blocked'
  } catch {
    return '#blocked'
  }
}

const markdownComponents: Components = {
  a({ children, href, node: _node, ...props }) {
    const shouldOpenBlank = Boolean(href && href !== '#blocked')
    return (
      <a
        {...props}
        href={href}
        rel={shouldOpenBlank ? 'noreferrer' : undefined}
        target={shouldOpenBlank ? '_blank' : undefined}
      >
        {children}
      </a>
    )
  },
}

const translations: Partial<StreamdownTranslations> = {
  copied: '已复制',
  copyCode: '复制代码',
  copyLink: '复制链接',
  copyTable: '复制表格',
  copyTableAsCsv: '复制为 CSV',
  copyTableAsMarkdown: '复制为 Markdown',
  copyTableAsTsv: '复制为 TSV',
  downloadFile: '下载文件',
  downloadImage: '下载图片',
  downloadTable: '下载表格',
  downloadTableAsCsv: '下载为 CSV',
  downloadTableAsMarkdown: '下载为 Markdown',
  externalLinkWarning: '即将打开外部链接',
  imageNotAvailable: '图片不可用',
  openExternalLink: '打开外部链接',
  openLink: '打开链接',
  tableFormatCsv: 'CSV',
  tableFormatMarkdown: 'Markdown',
  tableFormatTsv: 'TSV',
  viewFullscreen: '全屏查看',
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  streaming = false,
  className = '',
}: MarkdownRendererProps) {
  return (
    <Streamdown
      className={`markdown-renderer ${className}`.trim()}
      components={markdownComponents}
      controls={{
        code: { copy: true, download: false },
        mermaid: false,
        table: { copy: true, download: false, fullscreen: true },
      }}
      dir="auto"
      isAnimating={streaming}
      lineNumbers={false}
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={streaming}
      skipHtml
      translations={translations}
      urlTransform={safeUrl}
    >
      {content}
    </Streamdown>
  )
})

export default MarkdownRenderer
