// A measurement, not for merging: every step's time (actions, expects, hooks, fixtures), so a CI
// run shows where each spec's seconds go. Written to test-results/step-times.json, which the
// e2e-results-N artifact uploads.
import {mkdirSync, writeFileSync} from 'node:fs'
import type {Reporter, TestCase, TestResult, TestStep} from '@playwright/test/reporter'

type Row = {file: string; test: string; category: string; title: string; line?: number; depth: number; start: number; ms: number}

export default class StepTimes implements Reporter {
  rows: Row[] = []
  tests: {file: string; test: string; start: number; ms: number; status: string}[] = []
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    let depth = 0
    for (let p = step.parent; p; p = p.parent) depth++
    const file = test.location.file.split('/journeys/')[1] ?? test.location.file
    const here = step.location?.file.endsWith(file) ? step.location.line : undefined
    this.rows.push({file, test: test.title, category: step.category, title: step.title.slice(0, 160), line: here ?? step.location?.line, depth, start: step.startTime.getTime(), ms: step.duration})
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.tests.push({file: test.location.file.split('/journeys/')[1] ?? test.location.file, test: test.title, start: result.startTime.getTime(), ms: result.duration, status: result.status})
  }
  onEnd() {
    mkdirSync('test-results', {recursive: true})
    writeFileSync('test-results/step-times.json', JSON.stringify({tests: this.tests, steps: this.rows}))
  }
}
