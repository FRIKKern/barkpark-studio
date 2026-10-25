import studio from '../studio.config'
import {studioBrand} from './plugins'

/** The studio's name (the config's title: VITE_STUDIO_TITLE, else "Barkpark Studio"), in the navbar and every browser tab. */
export const studioName = studioBrand(studio.title).name
