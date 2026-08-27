import type {
  PublicEducation,
  PublicExperience,
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

// (b) DROP DIRECTION -- omitting a declared field from a rebuild must be an
// error, INCLUDING the contract-optional ones. That only holds while every
// optional field is spelled `T | undefined` (a required key with an
// undefined-able value): an object literal may omit a `?:` key for free, so a
// single field slipping back to `?:` would silently reopen the drop direction
// for that field. These assert that NO key of any Public* type is optional.
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type NoOptionalKeys<T> = Exact<OptionalKeys<T>, never>;

export const publicExperienceHasNoOptionalKeys: NoOptionalKeys<PublicExperience> = true;
export const publicEducationHasNoOptionalKeys: NoOptionalKeys<PublicEducation> = true;
export const publicSkillHasNoOptionalKeys: NoOptionalKeys<PublicSkill> = true;
export const publicProjectHasNoOptionalKeys: NoOptionalKeys<PublicProject> = true;

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

describe('public payload types', () => {
  it('carries undefined-valued keys off the wire, so `T | undefined` is byte-identical to `?:`', () => {
    const sparse: PublicSkill = { name: 'TypeScript', category: undefined, proficiency: 'EXPERT' };

    expect(JSON.stringify(sparse)).toBe('{"name":"TypeScript","proficiency":"EXPERT"}');
    expect(Object.keys(JSON.parse(JSON.stringify(sparse)))).toEqual(['name', 'proficiency']);
  });
});
