#!/usr/bin/env node
/*
 * Fail the build when a source file imports a RELATIVE module that git does
 * not track.
 *
 * Why this exists: "referenced but never committed" has broken production
 * twice in this repo (see CLAUDE.md, and commit cbb7cf4 "Add missing
 * DropdownPortal component (was referenced but never committed)"). It is a
 * nasty failure mode because every local check passes -- the file is right
 * there on the developer's disk, typecheck resolves it, the dev server serves
 * it, the production build succeeds. Only a clean checkout somewhere else
 * discovers the import points at nothing.
 *
 * Approach: resolve every relative import against `git ls-files` rather than
 * against the filesystem. That is what a fresh `git clone` would see, without
 * the cost of actually performing one.
 *
 * Usage:
 *   node scripts/check-untracked-imports.mjs             # whole repo
 *   node scripts/check-untracked-imports.mjs apps/web    # one workspace
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const roots = process.argv.slice(2)
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

// Everything git knows about, as repo-relative POSIX paths.
const tracked = new Set(
  execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean),
)

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'generated', '.expo', 'coverage'])

// Extensionless imports resolve through this list, mirroring bundler/tsc
// resolution closely enough for the question being asked.
const CANDIDATE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
]

// `import x from './y'`, `export ... from './y'`, bare `import './y'`, and
// `require('./y')`. The specifier must start with `./` or `../`: a bare
// package name is node_modules' problem rather than git's, and requiring a
// slash also stops prose like '...' inside a comment from matching.
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)['"](\.\.?\/[^'"]*)['"]/g

function stripComments(text) {
  // `[^:]` before the `//` keeps `https://` inside a string from being
  // treated as the start of a line comment.
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*/gm, '$1')
}

function sourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...sourceFiles(full))
    } else if (SOURCE_RE.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const searchRoots = roots.length ? roots.map((r) => path.resolve(repoRoot, r)) : [repoRoot]
const files = searchRoots.flatMap((r) => (fs.existsSync(r) ? sourceFiles(r) : []))

let problems = []

for (const file of files) {
  const rel = path.relative(repoRoot, file).split(path.sep).join('/')
  // Only check files git tracks: an untracked file importing an untracked
  // file is a work-in-progress, not a shipping hazard.
  if (!tracked.has(rel)) continue

  // Comments are stripped first: a commented-out import is not a real
  // import, and this file's own doc block would otherwise flag its own
  // examples. Block comments before line comments, so a `//` inside a
  // /* ... */ block does not truncate it early.
  const text = stripComments(fs.readFileSync(file, 'utf8'))
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1]
    const abs = path.resolve(path.dirname(file), spec)
    const relTarget = path.relative(repoRoot, abs).split(path.sep).join('/')

    if (CANDIDATE_SUFFIXES.some((suffix) => tracked.has(relTarget + suffix))) continue

    // Distinguish the two failures: a file that exists on disk but is NOT in
    // git is the dangerous one this check exists for. A specifier that
    // resolves to nothing at all is a plain broken import, reported too.
    const existsOnDisk = CANDIDATE_SUFFIXES.some((suffix) => {
      try {
        return fs.statSync(abs + suffix).isFile()
      } catch {
        return false
      }
    })

    problems.push({ file: rel, spec, relNoExt: relTarget, kind: existsOnDisk ? 'UNTRACKED' : 'MISSING' })
  }
}

// A target git deliberately IGNORES is not a hazard -- it is rebuilt on every
// install. The generated Prisma client is the case here: 137 correct imports
// of a gitignored directory that `postinstall: prisma generate` recreates.
// Ask git rather than hardcoding directory names, so this follows .gitignore
// as it changes. Batched through one `check-ignore --stdin` call.
const candidates = [...new Set(problems.filter((p) => p.kind === 'UNTRACKED').map((p) => p.relNoExt))]
let ignored = new Set()
if (candidates.length > 0) {
  const parse = (out) =>
    new Set(
      String(out || '')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.trim().split(path.sep).join('/')),
    )
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      encoding: 'utf8',
      cwd: repoRoot,
      input: candidates.join('\n'),
      maxBuffer: 16 * 1024 * 1024,
    })
    ignored = parse(out)
  } catch (err) {
    // check-ignore exits 1 when NOTHING matched -- a normal result, not a
    // failure, and its stdout still holds whatever DID match.
    ignored = parse(err.stdout)
  }
}

problems = problems.filter((p) => !(p.kind === 'UNTRACKED' && ignored.has(p.relNoExt)))

if (problems.length === 0) {
  console.log(`check-untracked-imports: OK (${files.length} files scanned)`)
  process.exit(0)
}

console.error('check-untracked-imports: FAILED\n')
for (const p of problems) {
  const explain =
    p.kind === 'UNTRACKED'
      ? 'exists on this machine but is NOT COMMITTED -- a clean checkout would fail to build'
      : 'does not resolve to any file'
  console.error(`  ${p.kind}  ${p.file}`)
  console.error(`      imports '${p.spec}' -- ${explain}\n`)
}
console.error(`${problems.length} problem(s). Commit the file(s), or fix the import.`)
process.exit(1)
