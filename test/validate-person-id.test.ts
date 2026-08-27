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
      // The MAX_ID_LENGTH cap added in review round 1 sits at 64 precisely so
      // it cannot reach this row: it is an abuse bound, not a validity rule.
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

    // 20 and 34 characters are both well under MAX_ID_LENGTH (64), so these two
    // rows are decided by the VALUE bound alone -- the length cap cannot reach
    // them, which is what keeps them a genuine test of the range check.
    it('rejects a 20-digit run (the original T-206 reproduction)', () => {
      expect(isValidPersonId('9'.repeat(20))).toBe(false);
    });

    it('rejects a 300-digit run (over BOTH bounds -- the length cap catches it first)', () => {
      expect(isValidPersonId('9'.repeat(300))).toBe(false);
    });

    it('rejects a 34-digit run (T-205 QA\'s independent reproduction)', () => {
      expect(isValidPersonId('9'.repeat(34))).toBe(false);
    });
  });

  describe('rejects ids too long to be worth forwarding, whatever their value', () => {
    // Review round 1, BLOCKING. These rows are about the STRING's length, and
    // the value bound is structurally blind to them: every one of them parses
    // to 1n. The cap is 64 digits -- an abuse bound, not a validity rule (see
    // the module comment for why it is tied to the DOWNSTREAM 8 KB limit).
    it('rejects a 9001-character zero-padded id whose VALUE is 1', () => {
      expect(isValidPersonId('0'.repeat(9000) + '1')).toBe(false);
    });

    it('accepts an id of exactly 64 digits (the cap itself)', () => {
      expect(isValidPersonId('0'.repeat(63) + '1')).toBe(true);
    });

    it('rejects an id of 65 digits (one past the cap)', () => {
      expect(isValidPersonId('0'.repeat(64) + '1')).toBe(false);
    });
  });

  describe('precision around 2^53 -- documentation, NOT the BigInt pin', () => {
    // Read this before deleting anything here (review round 1, finding 3).
    //
    // 2^53 is 9007199254740992, BELOW Long.MAX_VALUE, and Number cannot tell
    // 9007199254740992 from 9007199254740993. These two rows record that fact
    // and keep the pair covered -- but they do NOT detect a Number-based
    // implementation, because both values are <= the maximum and a Number
    // comparison accepts both, exactly as BigInt does. They are the right
    // answer for either implementation.
    //
    // The test that actually FAILS if someone swaps BigInt for Number is
    // 'rejects Long.MAX_VALUE + 1' above: Number coerces max and max+1 to the
    // same value, so a Number guard accepts max+1 and that assertion goes red.
    it('accepts 9007199254740992 (2^53)', () => {
      expect(isValidPersonId('9007199254740992')).toBe(true);
    });

    it('accepts 9007199254740993 (2^53 + 1, not representable as a Number)', () => {
      expect(isValidPersonId('9007199254740993')).toBe(true);
    });

    it('documents the JS constructor behaviour the guard is built around', () => {
      // Deliberately NOT a test of isValidPersonId -- it never calls it, and it
      // would pass with this module deleted. It is here so the reason the guard
      // uses BigInt is legible next to the rows above, which is the only claim
      // it makes.
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
