import type {ConditionContext, FieldConditions} from './conditions.ts'

// A `form.conditions` config for the unit tests and local scenes only: no deployment
// loads it (deployments build app/src/studio.config.tsx as it is, docs/DEPLOY.md).
// The same example is in docs/EXTENDING.md.
const isAdministrator = ({currentUser}: ConditionContext) => !!currentUser?.roles.some((r) => r.name === 'administrator')

export const roleConditions: Record<string, FieldConditions> = {
  // Only an administrator (a Barkpark owner or admin) moves a post's stage.
  'post.stage': {readOnly: (c) => !!c.currentUser && !isAdministrator(c)},
  // Only an administrator sees the internal rating.
  'post.rating': {hidden: (c) => !!c.currentUser && !isAdministrator(c)},
}
