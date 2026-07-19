import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { useEffect } from 'react'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
}

// Small, obviously-labeled toolbar (Phase UI-3's standing design mandate:
// no jargon, no unlabeled icon-only buttons where a word does the job just
// as well) -- this is a policy/legal-text editor for non-technical owners,
// not a general-purpose document editor, so the feature set is
// deliberately narrow. See sanitizeHtml.ts's ALLOWED_TAGS: anything this
// toolbar can produce must stay in sync with what that allow-list permits.
export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Keeps the editor in sync if `value` is reset out from under it (e.g.
  // the modal reopened for a different field) without fighting the user's
  // own typing mid-edit.
  useEffect(() => {
    if (!editor) return
    if (!editor.isFocused && editor.getHTML() !== value) {
      editor.commands.setContent(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  function setLink() {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previousUrl || 'https://')
    if (url === null) return
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim(), target: '_blank' }).run()
  }

  if (!editor) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-inset">
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-1.5">
        <ToolbarButton editor={editor} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold">
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton editor={editor} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic">
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton editor={editor} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} label="Underline">
          <u>U</u>
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          editor={editor}
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="Heading"
        >
          Heading
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="Bullet list"
        >
          &bull; List
        </ToolbarButton>
        <ToolbarButton
          editor={editor}
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="Numbered list"
        >
          1. List
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton editor={editor} active={editor.isActive('link')} onClick={setLink} label="Insert link">
          Link
        </ToolbarButton>
      </div>
      <EditorContent
        editor={editor}
        className="tiptap-content max-h-80 min-h-[160px] overflow-y-auto px-3 py-2 text-sm text-fg [&_.ProseMirror]:min-h-[140px] [&_.ProseMirror]:outline-none"
      />
    </div>
  )
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  editor: Editor
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={[
        'rounded-md px-2 py-1 text-xs font-medium transition',
        active ? 'bg-accent text-bg' : 'text-fg-secondary hover:bg-surface hover:text-fg',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
