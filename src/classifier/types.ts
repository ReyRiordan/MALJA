/** Whether the posting is an internship for the configured term in the configured fields. */
export type Relevant = "yes" | "no" | "unclear";

/** Whether the posting's degree requirement admits a master's student. */
export type DegreeOk = "yes" | "no" | "unclear";

/** Work authorisation constraint found in the description. */
export type WorkAuth = "none" | "citizen_only" | "no_sponsorship" | "unclear";

/**
 * Kinds of work a relevant role can be, multi-label. Definitions live in the prompt rubric;
 * changing the list means re-labelling the eval set.
 */
export const CATEGORIES = [
  "swe",
  "infra",
  "security",
  "qa",
  "ai",
  "ml",
  "data",
  "embedded",
  "research",
  "pm",
  "solutions",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** The classifier's answer for one job. Stored on the job row and read by the loop. */
export interface Verdict {
  relevant: Relevant;
  /** Deduped, may be empty: `[]` means unplaced, or the call failed. */
  categories: Category[];
  degreeOk: DegreeOk;
  workAuth: WorkAuth;
  reason: string;
}

/** What the loop hands the classifier for one group: the first clone with a description. */
export interface ClassifyInput {
  title: string;
  company: string;
  description: string;
}

/**
 * `error` is null when the verdict is the model's answer, and a short cause string when the
 * verdict is the `unclear` fallback. The loop stores `verdict` either way and counts consecutive
 * errors for the `classifier_down` alert.
 */
export interface ClassifyResult {
  verdict: Verdict;
  error: string | null;
}

export interface Classifier {
  /** Never throws. */
  classify(input: ClassifyInput): Promise<ClassifyResult>;
}
