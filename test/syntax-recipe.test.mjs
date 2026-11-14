// Runs the syntax-check recipe exactly as written in pages.md on throwaway
// pages, so the skill text itself is what is tested (no browser, no build).
// Needs bash, python3 and node on PATH, as the recipe does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skill = readFileSync(path.join(repoRoot, 'pages.md'), 'utf8')
const heading = '### Syntax-check inline JS before publishing'
assert.notEqual(skill.indexOf(heading), -1, 'pages.md must keep the syntax-check section')
const RECIPE = skill.slice(skill.indexOf(heading)).match(/```bash\n([\s\S]*?)\n```/)[1]

const dirs = []
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

function check(html) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pages-syntax-'))
  dirs.push(dir)
  writeFileSync(path.join(dir, 'page.html'), html)
  return spawnSync('bash', ['-c', RECIPE], { cwd: dir, encoding: 'utf8' })
}
const page = (body) => `<!doctype html><meta charset="utf-8"><p>x</p>${body}`
const ok = (html) => { const r = check(page(html)); assert.equal(r.status, 0, `${html}\n${r.stdout}${r.stderr}`) }
const refused = (html, message = /SyntaxError/) => {
  const r = check(page(html))
  assert.equal(r.status, 1, `${html}\n${r.stdout}${r.stderr}`)
  assert.match(r.stdout, message, html)
}

test('classic scripts accept names that only CommonJS reserves', () => {
  ok('<script>const module = { exports: {} }; module.exports.x = 1</script>')
  ok('<script>const require = (name) => name; require("a")</script>')
  ok('<script>let exports = 1, __filename = "a", __dirname = "b"</script>')
})

test('classic scripts refuse what a browser refuses', () => {
  refused('<script>if (true) { return }</script>', /Illegal return/)
  refused('<script>await Promise.resolve(1)</script>', /await/)
  refused("<script>const s = 'it's broken'</script>")
})

test('modules are still checked as ES modules', () => {
  ok('<script type="module">const x = await Promise.resolve(1); export {}</script>')
  ok('<script type=" MODULE ">export const y = 2</script>')
  refused('<script type="module">import {</script>')
})

test('type and src are read from real attributes, not from quoted values', () => {
  refused(`<script data-note="x type='application/ld+json'">return</script>`, /Illegal return/)
  refused(`<script data-note="see src='lazy.js'">return</script>`, /Illegal return/)
  refused('<script data-type="x" data-src="lazy.js">return</script>', /Illegal return/)
  refused("<script title='a > b'>return</script>", /Illegal return/)
})

test('JavaScript MIME types are checked like the browser runs them', () => {
  refused('<script type="application/javascript">return</script>', /Illegal return/)
  refused('<script type="TEXT/JavaScript">return</script>', /Illegal return/)
  refused('<script type="">return</script>', /Illegal return/)
  refused('<script language="javascript">return</script>', /Illegal return/)
  // With parameters the type is no JavaScript MIME essence, so browsers keep it
  // as a data block: arbitrary text there is valid page content, never refused.
  const r = check(page('<script type="text/javascript; charset=utf-8">return; it\'s data</script>'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /warning: .*will not run/)
})

test('external scripts, data blocks, comments and templates are skipped', () => {
  ok('<script src="a.js">return</script>')
  ok('<script SRC=a.js></script>')
  ok('<script type="application/ld+json">{"@context": "x"}</script>')
  ok('<script type="importmap">{"imports": {}}</script>')
  ok('<script type="text/template"><p>{{ return }}</p></script>')
  ok('<!-- <script>return</script> -->')
  ok('<template><script>return</script></template>')
})

test('every script is checked, including one left open at end of file', () => {
  refused('<script>ok()</script><script>return</script>', /Illegal return/)
  refused('<script>const a = "<p>"; if (a) {', /SyntaxError/)
})

test('text that only looks like a script is never compiled', () => {
  ok('<textarea><script>return</script></textarea>')
  ok('<title><script>return</script></title>')
  ok('<noscript><script>return</script></noscript>')
  ok('<iframe><script>return</script></iframe>')
  ok('<plaintext><script>return</script>')
  ok('<template/><script>return</script>')
  refused('<textarea>x</textarea><script>return</script>', /Illegal return/)
})

test('a duplicate attribute keeps its first value, as browsers do', () => {
  refused('<script type="module" type="application/ld+json">import {</script>')
  ok('<script type="application/ld+json" type="module">import {</script>')
  refused('<script type="text/javascript" type="text/plain">return</script>', /Illegal return/)
})

test('a self-closing script still opens a script element', () => {
  refused('<script/>return</script>', /Illegal return/)
  refused('<script />return', /Illegal return/)
  ok('<script/>ok()</script><p>after</p>')
})
