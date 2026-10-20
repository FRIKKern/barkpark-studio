// The types a "Create new document" list offers (task-37691740e53e77b7): document types
// only. A Barkpark schema of kind "object" is a named composite other schemas embed (a
// page-builder section such as "Artikkel hero seksjon"); it owns no documents.
export const isDocumentType = (schema: {kind?: string}) => schema.kind !== 'object'
