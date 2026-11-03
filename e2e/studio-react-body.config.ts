import base from './playwright.config'

// Candidate replay is Studio-only: it must not boot the Sanity reference or either
// preview site, and it always receives an isolated Barkpark dataset from the runner.
const webServers = Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : []

export default {
  ...base,
  webServer: webServers.slice(-1),
  projects: base.projects?.filter((project) => project.name === 'studio'),
}
