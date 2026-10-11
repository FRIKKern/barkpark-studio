export declare const MAX_DELETES: number
export declare function batches<T>(mutations: T[], maxDeletes?: number): T[][]
export declare function lowerCap(res: Response, maxDeletes: number): Promise<number | undefined>
export declare function sendBatches<T>(mutations: T[], send: (part: T[]) => Promise<Response>, maxDeletes?: number): Promise<Response | undefined>
