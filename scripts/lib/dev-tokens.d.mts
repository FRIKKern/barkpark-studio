export declare const DEV_EDITOR: RegExp
export declare function devTokensFile(): string
export declare function readDevTokens(): Record<string, string>
export declare function devToken(workspace: string, email: string): string | undefined
export declare function keepDevToken(workspace: string, email: string, token: string | undefined): void
export declare function sweepDevTokens(o: {url: string; admin: string; everything?: boolean; emails?: string[]}): Promise<{revoked: number; failed: number; kept: number}>
export declare const EDITOR_PERMISSIONS: Record<string, string[]>
export declare function editorPermissions(email: string): string[]
