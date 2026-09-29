/**
 * The selection key of one instance of a RAC database.
 *
 * A RAC database is one card with a row per instance, and each row can be
 * selected on its own. The selection is a list of strings -- the ids of
 * members, observers, sites, links and derived lines, all in one namespace --
 * so an instance needs a string of its own that none of those can be:
 * `<member id>~<n>`, with `n` the 1-based place of the instance in the member's
 * list (the same number the rail's rows call "Instance n").
 *
 *  - **`~` is not in an Oracle name.** `db_unique_name` and instance names are
 *    letters, digits, `_`, `$` and `#`; the ids this page generates are those
 *    with `-` and `.`. Nothing it makes carries a `~`, and a document that
 *    names a member with one is resolved by the exact id first
 *    (`resolveSubject`), so the instance key can only ever be the fallback.
 *  - **The place, not the name.** Renaming an instance in the rail keeps the
 *    selection on it. Removing an earlier one moves the place, and the removal
 *    itself selects the database again.
 *  - **It is URL-safe.** `~` is an unreserved character, and `sel` accepts it
 *    (`state/url.ts`), so `?sel=sby01~2` round-trips.
 */

export const INSTANCE_SEP = '~';

export const instanceKey = (member: string, index: number): string =>
  `${member}${INSTANCE_SEP}${index + 1}`;

/** The member and the zero-based index a key names, or `null` when it is not an instance key. */
export function parseInstanceKey(key: string): { member: string; index: number } | null {
  const at = key.lastIndexOf(INSTANCE_SEP);
  if (at <= 0) return null;
  const tail = key.slice(at + 1);
  if (!/^[1-9][0-9]{0,2}$/.test(tail)) return null;
  return { member: key.slice(0, at), index: Number(tail) - 1 };
}
