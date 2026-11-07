#!/usr/bin/env node
/**
 * Renders `coverage/coverage-summary.json` as a pull-request comment.
 *
 * The number a reviewer needs is not the total - the suite fails below its
 * floor anyway - but which files are carrying the uncovered branches, and
 * whether the totals moved. Jest writes `json-summary` for exactly this, so the
 * comment is a rendering of the run that just happened rather than a second
 * measurement that could disagree with it.
 *
 * Usage:
 *   node scripts/coverage-comment.mjs [--out coverage-comment.md] [--max-files 15]
 *
 * Prints the markdown to stdout and, with `--out`, also writes it there. The
 * workflow posts the file so the shell never has to quote a multi-line body.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const METRICS = ['statements', 'branches', 'functions', 'lines']

const arg = (name, fallback) => {
  const index = process.argv.indexOf('--' + name)
  return index < 0 ? fallback : process.argv[index + 1]
}

/** The suite's own floor, so the comment cannot state a different one. */
const floors = () => {
  const config = require(path.join(root, 'jest.config.js'))
  return (config.coverageThreshold && config.coverageThreshold.global) || {}
}

const pct = (summary) =>
  typeof summary === 'object' && summary ? summary.pct : undefined

const readSummary = (file) => {
  if (!fs.existsSync(file)) {
    throw new Error(
      'no coverage summary at ' +
        file +
        ' - run `npm test`, which writes coverage/coverage-summary.json'
    )
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** A row per metric, with the floor the run had to clear. */
const metricRows = (total, floor) =>
  METRICS.map((metric) => {
    const entry = total[metric] || {}
    return (
      '| ' +
      [
        metric,
        entry.covered ?? '-',
        entry.total ?? '-',
        pct(entry) ?? '-',
        floor[metric] ?? '-'
      ].join(' | ') +
      ' |'
    )
  })

/**
 * Files worth a reviewer's attention: anything below full coverage, worst
 * first. A file at 100% needs no line in a comment that asks for a decision.
 */
const attentionRows = (byFile, max) => {
  const rows = Object.entries(byFile)
    .filter(([name]) => name !== 'total')
    .map(([name, entry]) => ({
      file: path.relative(root, name) || name,
      lines: pct(entry.lines) ?? 0,
      branches: pct(entry.branches) ?? 0,
      uncovered: (entry.lines && entry.lines.total - entry.lines.covered) || 0
    }))
    .filter((row) => row.lines < 100 || row.branches < 100)
    .sort(
      (a, b) =>
        a.lines - b.lines ||
        a.branches - b.branches ||
        a.file.localeCompare(b.file)
    )

  const shown = rows.slice(0, max)
  const table = shown.map(
    (row) =>
      '| `' +
      row.file +
      '` | ' +
      row.lines +
      ' | ' +
      row.branches +
      ' | ' +
      row.uncovered +
      ' |'
  )
  return { table, hidden: rows.length - shown.length }
}

const render = (summary, maxFiles) => {
  const total = summary.total || {}
  const floor = floors()
  const { table, hidden } = attentionRows(summary, maxFiles)

  const failed = METRICS.filter((metric) => {
    const limit = floor[metric]
    const value = pct(total[metric])
    return (
      typeof limit === 'number' && typeof value === 'number' && value < limit
    )
  })

  const lines = [
    '## Test coverage',
    '',
    '| metric | covered | total | % | floor |',
    '| --- | --- | --- | --- | --- |',
    ...metricRows(total, floor),
    '',
    failed.length
      ? '**Below the floor: ' +
        failed.join(', ') +
        '** - `npm test` fails here.'
      : 'Every metric clears the floor `npm test` enforces.',
    ''
  ]

  if (table.length) {
    lines.push(
      '<details><summary>Files below full coverage (' +
        table.length +
        (hidden > 0
          ? ', worst ' + table.length + ' of ' + (table.length + hidden)
          : '') +
        ')</summary>',
      '',
      '| file | lines % | branches % | uncovered lines |',
      '| --- | --- | --- | --- |',
      ...table,
      '',
      '</details>',
      ''
    )
  }

  lines.push(
    '<sub>From <code>jest --coverage</code> on this head; the totals are the run CI just made.</sub>'
  )
  return lines.join('\n') + '\n'
}

const out = arg('out', null)
const maxFiles = Number(arg('max-files', '15'))
const summaryFile = path.join(root, 'coverage', 'coverage-summary.json')

const markdown = render(readSummary(summaryFile), maxFiles)
if (out) fs.writeFileSync(out, markdown)
process.stdout.write(markdown)
