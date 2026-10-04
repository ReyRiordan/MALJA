import { z } from "zod";
import { CATEGORIES, type ClassifyInput, type Verdict } from "./types.ts";

export const MAX_DESCRIPTION_CHARS = 12_000;
export const MAX_REASON_CHARS = 500;
const TRUNCATION_MARKER = "\n[truncated]";

export interface ProgramFacts {
  /** Who the students are, e.g. "master's students in CMU's M.S. in AI and Innovation". */
  program: string;
  /** When they graduate, e.g. "May 2028". */
  graduation: string;
  /** The internship term the searches target, e.g. "summer 2027". */
  term: string;
  /** The fields a posting must be in, in prose, e.g. "software engineering, machine learning, ...". */
  fields: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** Strict JSON schema sent as `response_format`. `VerdictSchema` is its zod mirror. */
export const VERDICT_JSON_SCHEMA = {
  name: "eligibility_verdict",
  strict: true,
  schema: {
    type: "object",
    properties: {
      relevant: { type: "string", enum: ["yes", "no", "unclear"] },
      categories: { type: "array", items: { type: "string", enum: CATEGORIES } },
      degree_ok: { type: "string", enum: ["yes", "no", "unclear"] },
      work_auth: { type: "string", enum: ["none", "citizen_only", "no_sponsorship", "unclear"] },
      reason: { type: "string" },
    },
    required: ["relevant", "categories", "degree_ok", "work_auth", "reason"],
    additionalProperties: false,
  },
} as const;

export const VerdictSchema = z.object({
  relevant: z.enum(["yes", "no", "unclear"]),
  categories: z.array(z.enum(CATEGORIES)).transform((ids) => [...new Set(ids)]),
  degree_ok: z.enum(["yes", "no", "unclear"]),
  work_auth: z.enum(["none", "citizen_only", "no_sponsorship", "unclear"]),
  reason: z.string(),
});

/** The rubric. docs/classifier/prompt.md quotes every rule word for word; keep them in sync. */
function systemPrompt(facts: ProgramFacts): string {
  return `You screen job postings for ${facts.program}. They graduate in ${facts.graduation} and are looking for ${facts.term} internships, so these are students partway through their program, not graduating seniors.

Read the posting and answer: is this a ${facts.term} internship that ${facts.program} might want to apply to, what kind of work is it, and are they eligible? Base every answer only on what the posting says. Do not guess at what the employer probably meant.

relevant: is this a ${facts.term} internship in ${facts.fields}?
- "yes" only when all three hold: the posting is an internship or co-op, not a full-time, contract, new-grad, or rotational analyst role; it is for ${facts.term}, or names no term at all; and the work is in ${facts.fields}.
- "no" when the posting states a mismatch on any of the three: it is a full-time, contract, new-grad, or rotational analyst role; it names a different term (for example fall, spring, or year-round only); or the work is in another field (for example mechanical, civil, chemistry, marketing, finance, or business and data analytics such as BI reporting and dashboard work), even if it mentions Python.
- Judge the field by the work the description assigns, not the title. A "Data Analyst Intern" whose work is training models is in scope; a "Data Science Intern" whose work is dashboards, SQL reports, and Excel, Tableau, or Power BI is analytics, which is another field.
- The title is the strongest signal. Employers put "intern", "internship", or "co-op" in the title of nearly every internship, so a title without any of those words (for example "Software Engineer", "AI/ML Engineer", "Junior Developer") is very likely a regular job: answer "no" unless the description itself says it is an internship or co-op.
- A title containing "analyst" or "analytics" with no engineer, developer, scientist, ML, or AI wording (for example "Data Analyst Intern", "Business Analyst Intern", "Logistics Analytics Intern") is very likely an analytics role: answer "no" unless the description itself assigns modelling, ML, or software work.
- "unclear" when the posting is silent or mixed on one of the three, for example a bare "Engineering Intern" with no field named.

categories: what kinds of work does the role do? List every id that fits, or none.
- "swe": general software engineering (backend, frontend, full-stack, mobile, developer tools). The default for software work that no id below carves out.
- "infra": DevOps, SRE, cloud, platform, CI/CD, observability, compute infrastructure.
- "security": application security, security engineering, detection, offensive security.
- "qa": QA, test automation, validation and verification.
- "ai": applied AI built on LLMs or foundation models: agents, RAG, AI tooling, evals.
- "ml": training or fine-tuning models: recommender systems, computer vision or NLP modelling, ML performance.
- "data": data engineering, and data science that builds models.
- "embedded": embedded software, firmware, flight software, robotics and autonomy software.
- "research": the role is mainly research. It describes the type of role, not the domain, so always list it next to a domain id (for example "research" and "ml"), never alone.
- "pm": technical product management.
- "infra", "security", and "qa" are carved out of "swe": a role that is mainly that work gets that id instead of "swe".
- Judge by the work the description assigns, not the title.
- Categories sort the work; they never decide relevant. Infrastructure, security, QA, and data engineering roles count as software engineering for relevant, so a role that is mainly one of them is still in the fields.
- Answer even when relevant is "no". Use an empty list only when the work fits none of the ids.

degree_ok: does the posting's degree requirement admit a master's student?
- "yes" when the posting explicitly accepts master's or graduate students, or lists degree levels that include a master's (for example "BS/MS", "BS, MS, or PhD"), or only says "pursuing a degree" with no level.
- "no" only when the text excludes master's students outright with words like "only", "must be", or "not eligible": undergraduate or bachelor's students only, PhD students only, MBA students only, or a required graduation date or window that a ${facts.graduation} graduation misses.
- "unclear" for everything else, including "pursuing a bachelor's degree", "currently pursuing a Bachelor's degree in Computer Science", or "enrolled in a bachelor's degree program" with no exclusion language, since many such postings still take master's students. Naming a bachelor's degree is a requirement to hold or be working toward one, not a ban on master's students; a master's student has met it. A graduation window stated next to a bachelor's degree (for example "graduating Spring 2028 with a Bachelor's degree", or "enrolled in a bachelor's program" with an expected graduation range) is bachelor's wording, not an exclusion: check the window against ${facts.graduation} and answer "unclear" when it fits.

work_auth: what work-authorisation constraint does the posting state?
- "citizen_only" when it requires US citizenship, a security clearance, or ITAR "US person" status.
- "no_sponsorship" when it says sponsorship is not available now or in the future, or requires authorisation to work "without sponsorship".
- "none" when it explicitly says sponsorship is available or international students are welcome.
- "unclear" when it says nothing, and also for a bare "must be authorized to work in the US", because F-1 students on CPT are authorized for internships and that line alone excludes nobody.

reason: one sentence quoting the phrase that decided each of the three answers, or saying that the posting is silent.

Reply with a single JSON object with exactly these keys: relevant, categories, degree_ok, work_auth, reason.`;
}

export function truncateDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_CHARS) return description;
  return description.slice(0, MAX_DESCRIPTION_CHARS) + TRUNCATION_MARKER;
}

export function buildMessages(facts: ProgramFacts, input: ClassifyInput): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(facts) },
    {
      role: "user",
      content: `Title: ${input.title}\nCompany: ${input.company}\n\nDescription:\n${truncateDescription(input.description)}`,
    },
  ];
}

/**
 * Turns model output into a `Verdict`, or null when it cannot. Tries the whole string as JSON,
 * then the first `{...}` block (fenced or prose-wrapped replies), then validates with zod.
 * The reason is capped at MAX_REASON_CHARS.
 */
export function parseVerdict(content: string): Verdict | null {
  const parsed = tryJson(content) ?? tryJson(firstObjectBlock(content));
  if (parsed === null) return null;
  const result = VerdictSchema.safeParse(parsed);
  if (!result.success) return null;
  return {
    relevant: result.data.relevant,
    categories: result.data.categories,
    degreeOk: result.data.degree_ok,
    workAuth: result.data.work_auth,
    reason: result.data.reason.slice(0, MAX_REASON_CHARS),
  };
}

function tryJson(text: string | null): unknown | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

function firstObjectBlock(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end <= start ? null : text.slice(start, end + 1);
}
