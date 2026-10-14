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

/** The message of an entity table whose search (and "shown only" filter) leaves no rows. */
export function noMatchText(
  what: string,
  query: string,
  shownOnly: boolean,
): string {
  const q = query.trim();
  if (shownOnly && !q) return `None of the ${what} are shown`;
  if (shownOnly) return `No shown ${what} match “${q}”`;
  return `No ${what} match “${q}”`;
}
