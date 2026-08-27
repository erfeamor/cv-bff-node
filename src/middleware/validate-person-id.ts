/**
 * Path-parameter guard for person ids.
 *
 * THREE checks, and no two of them can do each other's job:
 *
 * 1. SHAPE -- `PERSON_ID_PATTERN`. Every contract path spells the person id
 *    `{id}`/`{personId}` and the domain payloads type it as `number`
 *    (`DomainPerson.id`), so a value carrying anything but digits is not an id.
 *    The regex is deliberately stricter than a parse would be: `Number('1e3')`
 *    is 1000 and `parseInt('12abc')` is 12, so parsing ALONE would accept
 *    inputs this guard exists to refuse.
 * 2. LENGTH -- `<= MAX_ID_LENGTH`, checked BEFORE the parse.
 * 3. MAGNITUDE -- `<= LONG_MAX`, Java's `Long.MAX_VALUE` (9223372036854775807).
 *    cv-domain-service binds this segment to a `Long` (`@PathVariable Long` in
 *    all five controllers, `BIGINT` in `V1__init_schema.sql`); a larger value
 *    cannot identify a row there, it can only fail conversion. The shape check
 *    cannot see this on its own -- a 300-digit run IS a run of digits -- which
 *    is how an unusable id came to produce five upstream calls and a 502 where
 *    a 400 belonged (T-206, reproduced live twice by exploratory QA).
 *
 * WHY BOTH (2) AND (3), which is not redundancy. They fail in opposite
 * directions and each is structurally blind to the other's case:
 *
 * - The magnitude bound is on the parsed VALUE, not on the digit COUNT, and
 *   that is right: `9223372036854775808` has the same 19 digits as the maximum
 *   yet overflows it, while `0000000000000000000000001` is id 1 however it is
 *   spelled. A digit-count bound alone would answer both wrongly.
 * - But a value bound alone leaves the string unbounded, and
 *   `BigInt('0'.repeat(9000) + '1')` is `1n` -- in range, accepted, and the
 *   route then builds a 9 KB upstream URL and fans out five calls. Which is
 *   T-206's own symptom restored through the leading-zero door, so the length
 *   cap is not belt-and-braces: without it AC1 is simply not met.
 *
 * WHY 64, and why it is tied to the DOWNSTREAM limit. No legitimate id exceeds
 * 19 digits, so this cap is not a validity rule -- it is an abuse bound, and it
 * has to sit far above 19 (rejecting a plausibly zero-padded id would reinstate
 * the false positive the value check exists to avoid) and far below the length
 * at which the upstream request line stops being reasonable. cv-domain-service
 * overrides nothing in `src/main/resources/`, so Spring Boot 3's 8192-byte
 * `max-http-request-header-size` default applies: at 64 digits the longest URL
 * this route builds (`.../people/<id>/experiences`) is under 150 bytes, ~2% of
 * that budget, while a 9000-digit id blows straight through it and returns 502.
 * Below the 8 KB threshold the harm is not an error but cache-key evasion --
 * every distinct spelling of id 1 is a fresh CDN key costing five more calls to
 * a t3.micro on a route T-013 ratified as ANONYMOUS. The cap bounds the
 * spellings per id at 64 rather than leaving the count open-ended.
 *
 * An earlier version of this comment argued the length pre-check was
 * unnecessary because NODE caps the request line at 16 KB. That cap is real,
 * but it is TWICE the downstream limit, so it bounds nothing that matters: it
 * was the wrong side of the hop to reason from. Recorded rather than deleted,
 * because the argument is plausible enough to be made again.
 *
 * `BigInt`, NEVER `Number` -- a correctness requirement, not a style choice.
 * `Number` loses integer precision above 2^53 (9007199254740992), which is
 * BELOW `Long.MAX_VALUE` (~9.22e18):
 * `Number('9007199254740993') === Number('9007199254740992')` is `true`. A
 * `Number` comparison would therefore already be wrong for legitimate 16-17
 * digit ids, well before reaching the boundary it exists to defend. Do not
 * "simplify" it: the test that FAILS under a `Number` implementation is
 * `test/validate-person-id.test.ts`'s `Long.MAX_VALUE + 1` case, since `Number`
 * coerces max and max+1 to the same value and accepts both.
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
 * owns fixing that route. `isValidPersonId` is the ONLY export for that reason:
 * the pattern is one third of the rule, and an importer testing it directly
 * would get the shape check with neither bound -- i.e. T-206 all over again.
 *
 * The check runs BEFORE any upstream call. On the aggregate route that matters
 * more than on a single-fetch one: `/cv` fans one caller-supplied segment out
 * into FIVE upstream URLs, and T-013 ratified it as anonymous, so nothing
 * authenticates the caller first.
 */
const PERSON_ID_PATTERN = /^[0-9]+$/;

/** Abuse bound on the SPELLING, not a validity rule -- see "WHY 64" above. */
const MAX_ID_LENGTH = 64;

/** Java `Long.MAX_VALUE` -- the widest id cv-domain-service can bind. */
const LONG_MAX = 9223372036854775807n;

export function isValidPersonId(value: string | undefined): value is string {
  if (typeof value !== 'string' || !PERSON_ID_PATTERN.test(value)) {
    return false;
  }
  if (value.length > MAX_ID_LENGTH) {
    return false;
  }
  // Safe by construction: the pattern above guarantees a non-empty run of ASCII
  // digits, which is the one input shape `BigInt()` cannot throw on.
  return BigInt(value) <= LONG_MAX;
}
