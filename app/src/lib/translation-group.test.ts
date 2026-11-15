import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {METADATA_TYPE, groupOf, languageOf, linkMutations, lostRace, membersOf, metadataId, seedMutations, translatedFields, translationDoc, translationsOf, unlinkMutations, type Metadata, type TranslationRef} from './translation-group.ts'

// A group as @sanity/document-internationalization 6 stores it (a published `post` in two languages).
const sanity = (extra: Partial<Metadata> = {}): Metadata => ({
  _id: 'f0a1', _rev: 'r1', _createdAt: '2026-01-02T00:00:00Z', schemaTypes: ['post'],
  translations: [
    {_key: 'k1', _type: 'internationalizedArrayReferenceValue', language: 'nb', value: {_type: 'reference', _ref: 'post-nb', _weak: true, _strengthenOnPublish: {type: 'post'}}},
    {_key: 'k2', _type: 'internationalizedArrayReferenceValue', language: 'en', value: {_type: 'reference', _ref: 'post-en'}},
  ],
  ...extra,
})

test('translations: the schema option reads languages and the language field; a broken one leaves the type untranslated', () => {
  assert.deepEqual(translationsOf({translations: {languages: [{id: 'nb', title: 'Norsk'}, 'en', {id: 'nb', title: 'twice'}, {id: 'not a code'}, 7]}}), {languages: [{id: 'nb', title: 'Norsk'}, {id: 'en', title: 'en'}], languageField: 'language'})
  assert.equal(translationsOf({translations: {languages: ['en-GB'], languageField: 'locale'}})?.languageField, 'locale')
  assert.equal(translationsOf({translations: {languages: ['en'], languageField: 'a.b'}})?.languageField, 'language')
  for (const desk of [undefined, null, {}, {translations: true}, {translations: {languages: []}}, {translations: {languages: 'en'}}]) assert.equal(translationsOf(desk), undefined)
  // The form never draws the language field, declared hidden or not; an untranslated type's fields are untouched.
  const fields = [{name: 'title'}, {name: 'language'}]
  assert.deepEqual(translatedFields(fields, {translations: {languages: ['en']}}).fields, [{name: 'title'}, {name: 'language', hidden: true}])
  assert.deepEqual(translatedFields(fields, {orderings: []}), {fields})
  assert.equal(languageOf({language: 'en'}, translationsOf({translations: {languages: ['en']}})!), 'en')
  assert.equal(languageOf({language: ''}, translationsOf({translations: {languages: ['en']}})!), undefined)
})

test('translations: the fixture type carries the option (volume), with its language field hidden', () => {
  const volume = JSON.parse(readFileSync(new URL('../../../fixtures/barkpark-schema/volume.json', import.meta.url), 'utf8'))
  const {translations, fields} = translatedFields<{name: string; hidden?: boolean}>(volume.fields, volume.desk)
  assert.deepEqual(translations?.languages.map((l) => l.id), ['nb', 'en'])
  assert.equal(fields.find((f) => f.name === translations!.languageField)?.hidden, true)
})

test("translations: Sanity's stored group reads as its members, by either version's language key", () => {
  assert.deepEqual(membersOf(sanity()), [{language: 'nb', id: 'post-nb'}, {language: 'en', id: 'post-en'}])
  // The plugin before v4: the language is the `_key`. A draft id names its document. A second entry for a language loses.
  const old = {translations: [{_key: 'nb', value: {_type: 'reference', _ref: 'drafts.a'}}, {_key: 'en', value: {_ref: 'b'}}, {_key: 'x', language: 'en', value: {_ref: 'c'}}, {_key: 'de'}]}
  assert.deepEqual(membersOf(old), [{language: 'nb', id: 'a'}, {language: 'en', id: 'b'}])
  assert.deepEqual(membersOf(null), [])
})

test('translations: a document finds its group by id; a duplicate (a new id) is in none', () => {
  const later = sanity({_id: 'later', _createdAt: '2026-03-01T00:00:00Z'})
  assert.equal(groupOf([later, sanity()], 'post-en')?._id, 'f0a1') // named by two: the oldest
  assert.equal(groupOf([sanity()], 'post-en-copy'), undefined)
  assert.equal(metadataId('post-nb'), metadataId('post-nb')) // two browsers starting one group write one document
})

test('translations: creating links the new document in one fenced write, in the stored shape', () => {
  assert.deepEqual(translationDoc({_id: 'drafts.post-nb', _rev: 'x', _type: 'post', title: 'Hei', slug: {current: 'hei'}, language: 'nb'}, 'new', 'post', 'language', 'de'), {_id: 'new', _type: 'post', title: 'Hei', slug: {current: 'hei'}, language: 'de'})
  const [patch, publish] = linkMutations(sanity(), {id: 'post-nb', language: 'nb'}, {id: 'new', language: 'de'}, 'post', ['s', 'n']) as [{patch: {id: string; type: string; ifRevisionID: string; set: {translations: TranslationRef[]}}}, unknown]
  assert.equal(patch.patch.ifRevisionID, 'r1') // a second editor's link first refuses this one, whole
  assert.deepEqual([patch.patch.id, patch.patch.type], ['f0a1', METADATA_TYPE])
  assert.deepEqual(patch.patch.set.translations, [...sanity().translations!, {_key: 'n', _type: 'internationalizedArrayReferenceValue', language: 'de', value: {_type: 'reference', _ref: 'new', _weak: true, _strengthenOnPublish: {type: 'post'}}}])
  assert.deepEqual(publish, {publish: {id: 'f0a1', type: METADATA_TYPE}})
  // An entry whose document is gone is replaced, never doubled; the source's own entry is put back if lost.
  const replaced = linkMutations(sanity(), {id: 'post-nb', language: 'nb'}, {id: 'en2', language: 'en'}, 'post', ['s', 'n']) as [{patch: {set: {translations: TranslationRef[]}}}]
  assert.deepEqual(membersOf(replaced[0].patch.set), [{language: 'nb', id: 'post-nb'}, {language: 'en', id: 'en2'}])
  const lost = linkMutations(sanity({translations: sanity().translations!.slice(1)}), {id: 'post-nb', language: 'nb'}, {id: 'de1', language: 'de'}, 'post', ['s', 'n']) as [{patch: {set: {translations: TranslationRef[]}}}]
  assert.deepEqual(membersOf(lost[0].patch.set), [{language: 'en', id: 'post-en'}, {language: 'nb', id: 'post-nb'}, {language: 'de', id: 'de1'}])
  // A group of the plugin before v4 keeps its shape.
  const keyed = linkMutations({_id: 'm', _rev: 'r', translations: [{_key: 'nb', value: {_type: 'reference', _ref: 'a'}}]}, {id: 'a', language: 'nb'}, {id: 'b', language: 'en'}, 'post', ['s', 'n']) as [{patch: {set: {translations: {_key: string; language?: string}[]}}}]
  assert.deepEqual(keyed[0].patch.set.translations.map((e) => [e._key, e.language]), [['nb', undefined], ['en', undefined]])
  // A new group starts as its source alone, a write that changes nothing when sent twice.
  assert.deepEqual(seedMutations('translations-a', 'a', 'nb', 'post', 'k'), [
    {createIfNotExists: {_id: 'translations-a', _type: METADATA_TYPE, schemaTypes: ['post'], translations: [{_key: 'k', _type: 'internationalizedArrayReferenceValue', language: 'nb', value: {_type: 'reference', _ref: 'a', _weak: true, _strengthenOnPublish: {type: 'post'}}}]}},
    {publish: {id: 'translations-a', type: METADATA_TYPE}},
  ])
})

test('translations: unlinking takes one member out; a group left with one member goes', () => {
  const three = sanity({translations: [...sanity().translations!, {_key: 'k3', language: 'de', value: {_type: 'reference', _ref: 'post-de'}}]})
  const [patch, then] = unlinkMutations(three, 'post-en') as [{patch: {ifRevisionID: string; set: {translations: TranslationRef[]}}}, unknown]
  assert.equal(patch.patch.ifRevisionID, 'r1')
  assert.deepEqual(membersOf(patch.patch.set), [{language: 'nb', id: 'post-nb'}, {language: 'de', id: 'post-de'}])
  assert.deepEqual(then, {publish: {id: 'f0a1', type: METADATA_TYPE}})
  assert.deepEqual((unlinkMutations(sanity(), 'post-en') as unknown[])[1], {delete: {id: 'f0a1', type: METADATA_TYPE}})
  assert.equal(unlinkMutations(sanity(), 'someone-else'), null)
  assert.equal(lostRace('mutate 412: {"error":{"code":"precondition_failed"}}'), true)
  assert.equal(lostRace('mutate 500: {"error":{}}'), false)
})
