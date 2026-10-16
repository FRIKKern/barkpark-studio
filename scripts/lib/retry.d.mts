export declare function isTransient(failure: {status?: number; error?: unknown; body?: string}): boolean
export declare function idempotent(mutations: unknown[]): boolean
export declare function backoff(attempt: number): number
export declare function withRetry(send: () => Promise<Response>, options?: {label?: string; safe?: boolean; budgetMs?: number}): Promise<Response>
