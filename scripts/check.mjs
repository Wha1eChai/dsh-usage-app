import { run } from '@wha1echai/dsh-app-check'

const mode = process.argv.find(arg => arg.startsWith('--'))
await run(import.meta.url, mode)
