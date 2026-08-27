/**
 * Path-parameter guard for person ids.
 *
 * TWO checks, and neither can do the other's job:
 *
 * 1. SHAPE -- `PERSON_ID_PATTERN`. Every contract path spells the person id
 *    `{id}`/`{personId}` and the domain payloads type it as `number`
 *    (`DomainPerson.id`), so a value carrying anything but digits is not an id.
 *    The regex is deliberately stricter than a parse would be: `Number('1e3')`
 *    is 1000 and `parseInt('12abc')` is 12, so parsing ALONE would accept
 *    inputs this guard exists to refuse.
 * 2. MAGNITUDE -- `<= LONG_MAX`, Java's `Long.MAX_VALUE` (9223372036854775807).
 *    cv-domain-service binds this segment to a `Long`; a larger value cannot
 *    identify a row there, it can only fail conversion. The shape check cannot
 *    see this on its own -- a 300-digit run IS a run of digits -- which is how
 *    an unusable id came to produce five upstream calls and a 502 where a 400
 *    belonged (T-206, reproduced live twice by exploratory QA).
 *
 * The magnitude bound is on the parsed VALUE, not on the digit COUNT, and the
 * difference bites in both directions: `9223372036854775808` has the same 19
 * digits as the maximum yet overflows it, while `0000000000000000000000001` is
 * id 1 however it is spelled. A digit-count bound would answer both wrongly.
 * There is deliberately no length pre-check before the parse: Node caps the
 * request line at 16 KB, so the input is already bounded and `BigInt` parses
 * that in microseconds -- the branch would buy nothing and would drag the
 * leading-zero false positive back in at a higher threshold.
 *
 * `BigInt`, NEVER `Number` -- a correctness requirement, not a style choice.
 * `Number` loses integer precision above 2^53 (9007199254740992), which is
 * BELOW `Long.MAX_VALUE` (~9.22e18):
 * `Number('9007199254740993') === Number('9007199254740992')` is `true`. A
 * `Number` comparison would therefore already be wrong for legitimate 16-17
 * digit ids, well before reaching the boundary it exists to defend. Do not
 * "simplify" it; `test/validate-person-id.test.ts` pins that pair.
 *
 * WHAT THIS DOES NOT DECIDE: whether the id EXISTS, or whether `0` is a real
 * row -- both are the domain service's business, and a well-formed in-range id
 * is still free to come back 404.
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

/** Java `Long.MAX_VALUE` -- the widest id cv-domain-service can bind. */
const LONG_MAX = 9223372036854775807n;

export function isValidPersonId(value: string | undefined): value is string {
  if (typeof value !== 'string' || !PERSON_ID_PATTERN.test(value)) {
    return false;
  }
  // Safe by construction: the pattern above guarantees a non-empty run of ASCII
  // digits, which is the one input shape `BigInt()` cannot throw on.
  return BigInt(value) <= LONG_MAX;
}
