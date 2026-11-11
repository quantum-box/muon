import { test } from 'node:test'
import assert from 'node:assert/strict'
import { highlightJson, formatJson } from '../src/lib/utils.ts'

test('highlightJson escapes markup in non-JSON bodies', () => {
  const body = '<img src=x onerror=alert(1)>'
  const html = highlightJson(formatJson(body))
  assert.ok(!html.includes('<img'), html)
  assert.equal(html, '&lt;img src=x onerror=alert(1)&gt;')
})

test('highlightJson escapes markup inside JSON string values', () => {
  const html = highlightJson(
    formatJson('{"name":"<script>alert(1)</script>","n":1}'),
  )
  assert.ok(!html.includes('<script'), html)
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), html)
  assert.ok(html.includes('<span class="json-key">"name"</span>'), html)
  assert.ok(html.includes('<span class="json-number">1</span>'), html)
})

test('highlightJson escapes ampersands before highlighting', () => {
  const html = highlightJson('{"q": "a&b"}')
  assert.ok(html.includes('"a&amp;b"'), html)
})
