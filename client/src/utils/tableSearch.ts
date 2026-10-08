/**
 * Table search, as in chimerax-copick's entity tables: a case-insensitive
 * substring match against any of a row's columns (object, user, session, type…).
 */

export function matchesSearch(
  query: string,
  fields: readonly (string | number | null | undefined)[],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some(
    (f) => f !== null && f !== undefined && String(f).toLowerCase().includes(q),
  );
}
