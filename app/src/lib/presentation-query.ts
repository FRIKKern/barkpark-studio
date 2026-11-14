import {createServerFn} from '@tanstack/react-start'
import {previewQuery} from '../server/presentation-query'
import type {PreviewAnswer} from './presentation-comlink'

type Ask = {dataset: string; perspective: string; query: string; params: Record<string, unknown>}

// The answer crosses as text: a GROQ result is any JSON.
const ask = createServerFn({method: 'POST'})
  .validator((d: Ask) => d)
  .handler(async ({data}) => JSON.stringify(await previewQuery(data)))

/** A preview page's live query, run on the server as the signed-in editor (server/presentation-query.ts). */
export const runPreviewQuery = async (data: Ask): Promise<PreviewAnswer> => JSON.parse(await ask({data})) as PreviewAnswer
