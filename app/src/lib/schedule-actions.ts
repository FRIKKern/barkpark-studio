import type {QueryClient} from '@tanstack/react-query'
import {previewTitle, schemaOf, schemasQuery, type Doc, type Schema} from './data'
import {publish} from './edits'
import {cancelSchedule, schedulePublish, type Schedule} from './schedules'
import {t as tt} from './i18n'
import {toast} from '../components/Toasts'

// J40, Sanity's scheduled-draft actions, from the document's menu and the Releases tool's
// Scheduled drafts rows alike.

const titleOf = (qc: QueryClient, doc: Doc) => previewTitle(doc, schemaOf(qc.getQueryData<Schema[]>(schemasQuery.queryKey) ?? [], doc._type), tt)
const refresh = (qc: QueryClient, doc: Doc) => Promise.all([qc.invalidateQueries({queryKey: ['schedule', doc._publishedId]}), qc.invalidateQueries({queryKey: ['schedules']})])

/** "Publish now": published at once, the schedule dropped. */
export async function publishScheduledNow(qc: QueryClient, doc: Doc, schedule: Schedule) {
  // The schedule goes first (a refusal says why, and nothing is published), then the
  // draft is published; a failed publish puts the schedule back at its time.
  await cancelSchedule({data: {scheduleId: schedule._id}})
  try {
    await publish(qc, doc)
  } catch (e) {
    if (new Date(schedule.publishAt).getTime() > Date.now()) await schedulePublish({data: {id: doc._publishedId, type: doc._type, publishAt: schedule.publishAt}}).catch(() => {})
    throw e
  } finally {
    await refresh(qc, doc)
  }
  toast({tone: 'positive', title: tt('The scheduled draft document {title} has been published.', {title: titleOf(qc, doc)})})
}

/** "Delete schedule": the draft stays as it is. */
export async function deleteSchedule(qc: QueryClient, doc: Doc, schedule: Schedule) {
  await cancelSchedule({data: {scheduleId: schedule._id}})
  toast({tone: 'positive', title: tt('The scheduled draft document {title} has been deleted.', {title: titleOf(qc, doc)})})
  await refresh(qc, doc)
}
