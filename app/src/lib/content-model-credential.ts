/** Account-mode model reads use the editor's identity even when its session is lost. */
export async function contentModelCredential(mode: string, account: () => string, service: () => Promise<string>): Promise<string> {
  return mode === 'account' ? account() : service()
}
/** Safe across the server-function error boundary; never includes a credential. */
export const ACCOUNT_SESSION_LOST = 'account_content_model_session_lost'
