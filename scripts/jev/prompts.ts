/** Experiment only. Named system prompts for the LLM side of the bake-off. */
import { buildMessages, type ProgramFacts } from "../../src/classifier/prompt.ts";

const current = (f: ProgramFacts) =>
  buildMessages(f, { title: "", company: "", description: "" })[0]?.content ?? "";

/** The same precedents B2 got as Jev criteria, added to the current rubric. */
const PRECEDENTS = `
Further rules for hard cases:
- relevant: product management for banking, lending, card, investment, or other business products that asks for business, finance, or marketing backgrounds is not technical product management: "no". An MBA-only product role is "no". A full-time new-grad or early-career role is "no" even when the work is in scope.
- degree_ok "no" also covers class-year restrictions ("must be a rising junior or senior", "Sophomore, Junior or Senior currently pursuing bachelor's degree") and "must be currently enrolled in a BS/BA program" or "must be working towards a Bachelor's degree". A bare "pursuing a bachelor's degree" or "Undergrad enrolled in CS" without "must", "only", or class years stays "unclear". A graduation window that appears only under preferred qualifications is not a requirement.
- work_auth "no_sponsorship" also covers "must have permanent / indefinite work authorization", "right to work in the U.S. without restriction", and "F-1 OPT/CPT not eligible". A US-person list that admits permanent residents plus no-sponsorship wording is "no_sponsorship", not "citizen_only". "Must be able to obtain a security clearance" is "citizen_only". Export-control text that allows an export license for non-US persons, "US based applicants only", and sponsorship "at our sole discretion" are "unclear". A posting that accepts F-1 CPT students is "none".
`;

const v2 = (f: ProgramFacts) => current(f).replace("\nreason:", `${PRECEDENTS}\nreason:`);

export const PROMPTS: Record<string, (f: ProgramFacts) => string> = { current, v2 };
