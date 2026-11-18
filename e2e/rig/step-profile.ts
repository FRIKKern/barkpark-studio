import type {Reporter, TestCase, TestResult, TestStep} from '@playwright/test/reporter'

// Temporary (task-c1df532bed870536): every step of 150 ms or more, with where it was called,
// so a CI run shows where each spec's time goes.
export default class StepProfile implements Reporter {
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.duration < 150 || !['pw:api', 'expect', 'test.step', 'hook', 'fixture'].includes(step.category)) return
    let depth = 0
    for (let p = step.parent; p; p = p.parent) depth++
    const at = step.location ? `${step.location.file.replace(/.*\/e2e\//, '')}:${step.location.line}` : '-'
    const spec = test.location.file.replace(/.*\/journeys\//, '')
    console.log(`PROF ${spec}:${test.location.line} d${depth} ${step.category} ${step.duration} ${at} ${step.title.replace(/\s+/g, ' ').slice(0, 90)}`)
  }
}
