import base from './playwright.config'
export default {...base, outputDir: 'evidence/runs', use: {...base.use, video: {mode: 'on', size: {width: 1440, height: 900}}}}
