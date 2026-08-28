import type {
  PublicCv,
  PublicEducation,
  PublicExperience,
  PublicPerson,
  PublicProject,
  PublicSkill,
} from '../src/routes/cv';
import type { PublicPerson as PublicPersonHead } from '../src/routes/people';

/**
 * COMPILE-TIME guard on the public payload's shape (T-207).
 *
 * The Public* interfaces are transcribed from docs/api-contract.md; they used
 * to be `Omit<Domain*, 'id'>`, which made tsc check the aggregate's rebuilds
 * against the upstream shape the route exists to distrust. This file fails
 * `npm run typecheck` if either half of that decoupling regresses. Most of it
 * is erased at runtime -- the one runtime test below pins the reason the change
 * is wire-invisible.
 */

/** True only when A and B are the same type (used here on key unions). */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// (a) LEAK DIRECTION -- an undeclared field added to a Domain* interface must
// not propagate into the matching Public* type. These pin each key set to the
// contract's exactly, so a Public* type that starts tracking a Domain* one
// again (`personId`, `id`, `skillId`, or any future upstream column) stops
// compiling here rather than reaching an anonymous route.
export const publicExperienceKeys: Exact<
  keyof PublicExperience,
  'company' | 'role' | 'location' | 'startDate' | 'endDate' | 'description'
> = true;
export const publicEducationKeys: Exact<
  keyof PublicEducation,
  'institution' | 'degree' | 'fieldOfStudy' | 'startDate' | 'endDate'
> = true;
export const publicSkillKeys: Exact<keyof PublicSkill, 'name' | 'category' | 'proficiency'> = true;
export const publicProjectKeys: Exact<
  keyof PublicProject,
  'name' | 'description' | 'repoUrl' | 'startDate' | 'endDate'
> = true;
export const publicCvKeys: Exact<
  keyof PublicCv,
  'name' | 'headline' | 'location' | 'summary' | 'experiences' | 'education' | 'skills' | 'projects'
> = true;

// The person half is the one the section normalizers' excess-property check
// does NOT cover on its own: `normalizePerson`'s result is SPREAD into the
// body, and spread-in properties from a non-fresh type are not checked. It is
// guarded by annotating that function's return type, so this pins the annotated
// shape -- `email` in particular, the field this repo ranks a hard blocker.
export const personalDataStaysOut = (): PublicPerson =>
  // @ts-expect-error TS2353: 'email' is not in type 'PublicPerson'.
  ({ name: 'Jane Doe', headline: null, location: null, summary: null, email: 'j@example.com' });

// (b) DROP DIRECTION -- omitting a declared field from a rebuild must be an
// error, INCLUDING the contract-optional ones. That only holds while every
// optional field is spelled as a REQUIRED KEY with a nullable value
// (`string | null`): an object literal may omit a `?:` key for free, so a
// single field slipping back to `?:` would silently reopen the drop direction
// for that field. These assert that NO key of any Public* type is optional.
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type NoOptionalKeys<T> = Exact<OptionalKeys<T>, never>;

export const publicExperienceHasNoOptionalKeys: NoOptionalKeys<PublicExperience> = true;
export const publicEducationHasNoOptionalKeys: NoOptionalKeys<PublicEducation> = true;
export const publicSkillHasNoOptionalKeys: NoOptionalKeys<PublicSkill> = true;
export const publicProjectHasNoOptionalKeys: NoOptionalKeys<PublicProject> = true;
export const publicCvHasNoOptionalKeys: NoOptionalKeys<PublicCv> = true;

// `GET /bff/api/v1/people/:id` -- the OTHER anonymous route (T-013). It declares
// its own PublicPerson, independent of the aggregate's, and until T-210 that one
// still used `?:` keys: the drop direction T-207 closed on the aggregate was
// left open here, on a route just as public. Found reviewing T-209. Guarded the
// same way, and its key set is pinned so a stripped field cannot come back.
export const publicPersonHeadKeys: Exact<
  keyof PublicPersonHead,
  'name' | 'headline' | 'location' | 'summary'
> = true;
export const publicPersonHeadHasNoOptionalKeys: NoOptionalKeys<PublicPersonHead> = true;

// ...and what that buys, spelled out: a rebuild that drops a contract-optional
// field does not compile. If `location` were `location?: string` this directive
// would report an unused '@ts-expect-error' and fail typecheck.
export const omittingAnOptionalFieldIsAnError = (): PublicExperience =>
  // @ts-expect-error TS2741: 'location' is missing.
  ({
    company: 'ACME',
    role: 'Backend Engineer',
    startDate: '2022-01-01',
    endDate: null,
    description: null,
  });

export const omittingARequiredFieldIsAnError = (): PublicSkill =>
  // @ts-expect-error TS2741: 'proficiency' is missing.
  ({ name: 'TypeScript', category: null });

export const omittingAPersonFieldIsAnError = (): PublicPerson =>
  // @ts-expect-error TS2741: 'summary' is missing.
  ({ name: 'Jane Doe', headline: null, location: null });

describe('public payload types', () => {
  // What the contract now REQUIRES, and what production has always sent.
  // Contract rule 7 (T-209): an optional field is always a present key whose
  // empty value is `null`. cv-domain-service has no @JsonInclude(NON_NULL), so
  // it has behaved this way since v1, and the normalizers copy it through
  // verbatim -- the key is PRESENT and null on the wire, not dropped.
  it('passes an upstream null through as a present, null-valued key', () => {
    const fromUpstream: PublicSkill = { name: 'TypeScript', category: null, proficiency: 'EXPERT' };

    expect(JSON.stringify(fromUpstream)).toBe(
      '{"name":"TypeScript","category":null,"proficiency":"EXPERT"}'
    );
    expect(Object.keys(JSON.parse(JSON.stringify(fromUpstream)))).toEqual([
      'name',
      'category',
      'proficiency',
    ]);
  });

  // RULE 7 NOW FORBIDS THIS INPUT -- and that is exactly why the test stays.
  //
  // Contract rule 7 (T-209) ratifies that an optional field is always a present
  // key valued `null`, so the Public* types no longer admit `undefined` and the
  // fixture below needs a cast to exist at all. What it pins is a RUNTIME fact
  // the types can no longer express: if the upstream ever violated rule 7 and
  // omitted a key, this route degrades to an ABSENT key on the wire rather than
  // emitting a literal `undefined` or fabricating a `null`.
  //
  // That matters more now, not less. Rule 7 is a guarantee INHERITED from
  // cv-domain-service, not one the BFF enforces -- the contract says so in as
  // many words -- and there is deliberately no `?? null` anywhere in cv.ts. So
  // the one thing worth pinning is what happens when the inherited guarantee
  // fails. T-205's route-level sparse test (test/cv.test.ts) covers the same
  // case end-to-end; this is the unit-level statement of why it is safe.
  it('degrades an undefined value to an absent key if the upstream ever breaks rule 7', () => {
    const violatesRule7 = { name: 'TypeScript', category: undefined, proficiency: 'EXPERT' };
    const sparse = violatesRule7 as unknown as PublicSkill;

    expect(JSON.stringify(sparse)).toBe('{"name":"TypeScript","proficiency":"EXPERT"}');
    // No fabricated null: the key is gone, not present-and-null.
    expect(Object.keys(JSON.parse(JSON.stringify(sparse)))).toEqual(['name', 'proficiency']);
  });
});
