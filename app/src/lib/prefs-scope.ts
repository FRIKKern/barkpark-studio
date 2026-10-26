import type {SignInMode} from '../server/auth'

/**
 * Whether this sign-in mode keeps per-editor prefs on Barkpark (lib/prefs). Shared mode has
 * no editor: everyone works as BARKPARK_TOKEN, so an owned token would pool every editor's
 * prefs (recent searches too) on one account. There they stay in each browser
 * (task-7a14426526f4772a).
 */
export const serverPrefs = (mode: SignInMode) => mode !== 'shared'
