import {test} from 'node:test'
import assert from 'node:assert/strict'
import {samplesOf, summarize} from './request-timings.ts'

test("Diagnostics' request timings: the tab's own requests by series, live streams left out", () => {
  const o = 'http://localhost:3000'
  const samples = samplesOf(
    [
      {name: `${o}/api/query/x`, startTime: 30, duration: 40.4},
      {name: `${o}/_serverFn/abc?payload=1`, startTime: 10, duration: 12},
      {name: `${o}/api/listen?q=1`, startTime: 5, duration: 9000},
      {name: `${o}/assets/index.js`, startTime: 1, duration: 3},
      {name: 'https://elsewhere.example/api/query', startTime: 2, duration: 5},
    ],
    o,
  )
  assert.deepEqual(samples, [
    {series: 'server function', at: 10, ms: 12},
    {series: 'query', at: 30, ms: 40},
  ])
})

test("Diagnostics' percentiles: nearest rank, most requests first", () => {
  const ms = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 1000]
  const s = summarize([...ms.map((m, i) => ({series: 'query', at: i, ms: m})), {series: 'mutate', at: 99, ms: 7}])
  assert.deepEqual(s, [
    {series: 'query', n: 20, median: 100, p95: 190, max: 1000},
    {series: 'mutate', n: 1, median: 7, p95: 7, max: 7},
  ])
})
