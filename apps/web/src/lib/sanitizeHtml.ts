import DOMPurify from 'dompurify'

// Single allow-list for every rendered site of the 8 StudioSettings HTML
// policy fields (see RichTextEditor.tsx for the matching editor toolbar --
// this list and that toolbar's feature set must stay in sync, since
// anything the editor can produce needs to survive sanitization on
// render, and anything not on the toolbar has no legitimate reason to be
// allowed through). Links are restricted to href/target/rel; no id/class/
// style/on* attributes anywhere, no script/iframe/object tags.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3']
const ALLOWED_ATTR = ['href', 'target', 'rel']

// The real security boundary: every place one of the 8 rich-text policy
// fields (or a snapshot copied from one) is ever rendered via
// dangerouslySetInnerHTML must pass through this first. Never render one
// of these fields' raw string directly.
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}
