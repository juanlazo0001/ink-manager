import { Fragment, type ReactNode } from 'react'

const URL_REGEX = /(https?:\/\/[^\s]+)/g

// message.body is always plain text, never HTML, so this splits on a
// global capturing regex and renders the odd-indexed (matched) segments as
// real anchors -- no dangerouslySetInnerHTML, no sanitizer needed.
export function linkifyText(text: string): ReactNode[] {
  return text.split(URL_REGEX).map((part, i) => {
    if (i % 2 === 0) return part

    // Trailing punctuation (end of a sentence, a closing paren someone
    // wrapped the link in, etc.) usually isn't part of the URL -- keep it
    // outside the link.
    const trailingMatch = part.match(/[.,;:!?)\]}'"]+$/)
    const trailing = trailingMatch?.[0] ?? ''
    const url = trailing ? part.slice(0, -trailing.length) : part

    return (
      <Fragment key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
          {url}
        </a>
        {trailing}
      </Fragment>
    )
  })
}
