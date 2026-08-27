/**
 * Path-parameter guard for person ids.
 *
 * Every contract path spells the person id `{id}`/`{personId}`, and the domain
 * payloads type it as `number` (`DomainPerson.id`) -- so anything that is not a
 * run of digits is not an id, and must never reach an upstream URL.
 *
 * WHY THIS IS SHARED RATHER THAN PRIVATE TO ONE ROUTE (T-201 ruling 3):
 * T-204 must apply the identical rule to `GET /people/:id`, which is still
 * unguarded. A private helper would guarantee two implementations of one rule,
 * which is exactly how this defect came to have two instances in the first
 * place. T-204 adopts this in one line; it is NOT absorbed by T-201 and still
 * owns fixing that route.
 *
 * The check runs BEFORE any upstream call. On the aggregate route that matters
 * more than on a single-fetch one: `/cv` fans one caller-supplied segment out
 * into FIVE upstream URLs, and T-013 ratified it as anonymous, so nothing
 * authenticates the caller first.
 */
export const PERSON_ID_PATTERN = /^[0-9]+$/;

export function isValidPersonId(value: string | undefined): value is string {
  return typeof value === 'string' && PERSON_ID_PATTERN.test(value);
}
