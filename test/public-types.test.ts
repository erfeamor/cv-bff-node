import type {
  PublicCv,
  PublicEducation,
  PublicExperience,
  PublicPerson,
  PublicProject,
  PublicSkill,
} from '../src/routes/cv';

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
// optional field is spelled as a REQUIRED KEY with a nullable/omissible value
// (`string | null | undefined`): an object literal may omit a `?:` key for free, so a
// single field slipping back to `?:` would silently reopen the drop direction
// for that field. These assert that NO key of any Public* type is optional.
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type NoOptionalKeys<T> = Exact<OptionalKeys<T>, never>;

export const publicExperienceHasNoOptionalKeys: NoOptionalKeys<PublicExperience> = true;
export const publicEducationHasNoOptionalKeys: NoOptionalKeys<PublicEducation> = true;
export const publicSkillHasNoOptionalKeys: NoOptionalKeys<PublicSkill> = true;
export const publicProjectHasNoOptionalKeys: NoOptionalKeys<PublicProject> = true;
export const publicCvHasNoOptionalKeys: NoOptionalKeys<PublicCv> = true;

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
    description: undefined,
  });

export const omittingARequiredFieldIsAnError = (): PublicSkill =>
  // @ts-expect-error TS2741: 'proficiency' is missing.
  ({ name: 'TypeScript', category: undefined });

export const omittingAPersonFieldIsAnError = (): PublicPerson =>
  // @ts-expect-error TS2741: 'summary' is missing.
  ({ name: 'Jane Doe', headline: null, location: null });

describe('public payload types', () => {
  // What production ACTUALLY sends. cv-domain-service has no
  // @JsonInclude(NON_NULL), so an absent optional arrives as an explicit null
  // and the normalizers copy it through verbatim: the key is PRESENT and null
  // on the wire, not dropped. This is why the optionals are `| null` (T-207
  // review 1) -- the earlier fixture here used an omitted key, a shape the
  // upstream does not produce.
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

  // The omitted-key case is still reachable (the Domain* types spell these
  // `?: string`), and there `| undefined` is what keeps the payload identical
  // to the old `?:` spelling -- JSON.stringify drops undefined-valued keys.
  // T-205's sparse test fixes this half in place at the route level.
  it('drops an undefined-valued key, so `| undefined` is wire-identical to `?:`', () => {
    const sparse: PublicSkill = { name: 'TypeScript', category: undefined, proficiency: 'EXPERT' };

    expect(JSON.stringify(sparse)).toBe('{"name":"TypeScript","proficiency":"EXPERT"}');
  });
});
