import {useQuery} from '@tanstack/react-query'
import type {FileAsset} from './files'
import type {ImageMeta} from './image-meta'

/** An asset's name, size and type; for an image also its pixel size and blur placeholder (lib/image-meta.ts). */
export const useFileInfo = (ref: string | undefined) =>
  useQuery({
    queryKey: ['media-info', ref],
    enabled: !!ref,
    staleTime: Infinity,
    // A 404 is an answer (an image field shows a Sanity image id Barkpark has no file for as unknown): no retries.
    retry: (count, err) => !err.message.endsWith(' 404') && count < 3,
    queryFn: () => fetch(`/api/media/${encodeURIComponent(ref!.replace(/^asset-/, ''))}/info`).then((r) => (r.ok ? (r.json() as Promise<FileAsset & ImageMeta>) : Promise.reject(new Error(`file → ${r.status}`)))),
  })
