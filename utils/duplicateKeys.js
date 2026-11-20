/**
 * Decide which documents may receive their unique comparison key (phoneKey / emailKey).
 * The OLDEST document in each group gets the key; later ones with the same key are returned
 * as duplicates for a human to resolve — they're left unkeyed so the unique index can still be built.
 *
 * @param docs     [{ _id, createdAt, ... }]
 * @param keyOf    (doc) => string   (empty string = nothing to key)
 * @param scopeOf  (doc) => string   uniqueness scope (e.g. gym id for phones; '' for global emails)
 */
export function assignFirstKeys(docs, { keyOf, scopeOf = () => '' }) {
  const sorted = [...docs].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
  const owners = new Map()      // `${scope}\u0000${key}` -> first doc
  const groups = new Map()      // same -> [first, ...later duplicates]
  const assign = []
  for (const doc of sorted) {
    const key = keyOf(doc)
    if (!key) continue
    const id = `${scopeOf(doc)}\u0000${key}`
    if (!owners.has(id)) { owners.set(id, doc); assign.push({ id: doc._id, key }); continue }
    if (!groups.has(id)) groups.set(id, [owners.get(id)])
    groups.get(id).push(doc)
  }
  return { assign, duplicates: [...groups.values()] }
}
