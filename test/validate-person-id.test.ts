import { isValidPersonId } from '../src/middleware/validate-person-id';

/**
 * T-206. Pure unit coverage of the guard's decision, with no Express and no
 * fetch machinery: the boundary matrix is large and every row is a parse
 * decision, not a wiring one. The route-level counterparts in `cv.test.ts`
 * prove the other half -- that the route consults this before fanning out.
 *
 * T-204 adopts this same guard for `GET /people/:id`; this file is the boundary
 * matrix it inherits, so it does not have to re-derive it.
 */
describe('isValidPersonId', () => {
  describe('accepts ids in range', () => {
    it.each(['1', '0', '12345'])('accepts %s', (value) => {
      expect(isValidPersonId(value)).toBe(true);
    });

    it('accepts Long.MAX_VALUE itself (9223372036854775807)', () => {
      expect(isValidPersonId('9223372036854775807')).toBe(true);
    });

    it('accepts a value padded with leading zeros past any plausible digit bound', () => {
      // OPTION B (H1 ruling 1) IS IN FORCE: the guard range-checks the VALUE.
      // '000...01' is id 1 however it is spelled, so it is accepted. A
      // digit-COUNT bound (Option A) would reject this 26-character string --
      // a false positive with no correctness or security benefit. If this test
      // ever starts failing, the implementation has silently switched options.
      expect(isValidPersonId('0'.repeat(25) + '1')).toBe(true);
    });
  });

  describe('rejects ids above Long.MAX_VALUE', () => {
    it('rejects Long.MAX_VALUE + 1 (9223372036854775808) -- 19 digits, so a length bound cannot see it', () => {
      // OPTION B (H1 ruling 1) IS IN FORCE. This is the row a digit-count bound
      // gets WRONG: 9223372036854775808 has exactly 19 digits, same as the max,
      // yet it overflows Java's Long. Under Option A this would return true and
      // reinstate T-206's own defect at a narrower input. Under a value range
      // check it is rejected.
      expect(isValidPersonId('9223372036854775808')).toBe(false);
    });

    it('rejects a 20-digit run (the original T-206 reproduction)', () => {
      expect(isValidPersonId('9'.repeat(20))).toBe(false);
    });

    it('rejects a 300-digit run', () => {
      expect(isValidPersonId('9'.repeat(300))).toBe(false);
    });

    it('rejects a 34-digit run (T-205 QA\'s independent reproduction)', () => {
      expect(isValidPersonId('9'.repeat(34))).toBe(false);
    });
  });

  describe('precision: the range check must not collapse neighbouring 16-digit ids', () => {
    // 2^53 is 9007199254740992 -- BELOW Long.MAX_VALUE. A Number-based range
    // check reads both of these as the same float
    // (Number('9007199254740993') === Number('9007199254740992') is true), so
    // it is already wrong for legitimate ids well before the boundary it
    // exists to defend. Both are <= Long.MAX_VALUE and both must be accepted;
    // the point is proving the implementation kept them distinct rather than
    // getting the right answer for the wrong reason.
    it('accepts 9007199254740992 (2^53)', () => {
      expect(isValidPersonId('9007199254740992')).toBe(true);
    });

    it('accepts 9007199254740993 (2^53 + 1, not representable as a Number)', () => {
      expect(isValidPersonId('9007199254740993')).toBe(true);
    });

    it('parses the two neighbours as DIFFERENT values, which Number cannot', () => {
      expect(BigInt('9007199254740993')).not.toBe(BigInt('9007199254740992'));
      expect(Number('9007199254740993')).toBe(Number('9007199254740992'));
    });
  });

  describe('rejects anything that is not a bare run of digits', () => {
    it.each([
      ['1abc', 'trailing garbage -- parseInt() would read this as 1'],
      ['1;DROP', 'injection-shaped'],
      ['1%20', 'an encoded space Express has already decoded'],
      ['1e3', 'exponent notation -- Number() would read this as 1000'],
      ['-1', 'signed'],
      ['1.0', 'decimal'],
      [' 1', 'leading whitespace'],
      ['', 'empty'],
      ['../admin', 'path traversal'],
    ])('rejects %p (%s)', (value) => {
      expect(isValidPersonId(value)).toBe(false);
    });

    it('rejects undefined (a missing path parameter)', () => {
      expect(isValidPersonId(undefined)).toBe(false);
    });
  });
});
