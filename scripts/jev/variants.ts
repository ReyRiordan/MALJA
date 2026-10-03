/**
 * Experiment only. Jev question sets and the code that composes their answers into a Verdict.
 * Each compose takes thresholds so score.ts can sweep them over cached answers without new calls.
 */
import type { JevAnswer, JevQuestion, Label } from "./lib.ts";

export interface Thresholds {
  /** Minimum probability mass behind a suppressing `no` (relevant or degree). */
  no: number;
  /** Minimum probability for a decisive `yes`. */
  yes: number;
  /** Minimum top probability for a decisive work-auth value. */
  work: number;
}

export interface Variant {
  name: string;
  questions: Record<string, JevQuestion>;
  compose(a: Record<string, JevAnswer>, title: string, t: Thresholds): Label & { reason: string };
}

const PROGRAM = "a master's student in an AI master's program who graduates in May 2028";
const INTERN_TITLE =
  /\b(intern|interns|internship|internships|co-?op|summer (analyst|associate|scholar|student))\b/i;

function choice(
  a: Record<string, JevAnswer>,
  key: string,
): { choice: string; p: Record<string, number>; confidence: number } {
  const ans = a[key];
  if (ans?.type !== "choice") throw new Error(`missing choice ${key}`);
  return {
    choice: ans.choice,
    p: ans.probabilities ?? { [ans.choice]: 1 },
    confidence: ans.confidence ?? 0,
  };
}
function noul(a: Record<string, JevAnswer>, key: string): number {
  const ans = a[key];
  if (ans?.type !== "noul") throw new Error(`missing noul ${key}`);
  return ans.noul;
}
const sum = (p: Record<string, number>, keys: string[]) =>
  keys.reduce((s, k) => s + (p[k] ?? 0), 0);
const fmt = (p: number) => p.toFixed(2);

// ---------------------------------------------------------------------------------------------
// A: mirror. The three current questions as Jev choices, with the rubric as criteria.
// ---------------------------------------------------------------------------------------------
export const mirror: Variant = {
  name: "A-mirror",
  questions: {
    relevant: {
      type: "choice",
      instructions: `Is this posting a summer 2027 internship in software engineering, machine learning, AI, model-building data science, or technical product management, that ${PROGRAM} might apply to?`,
      criteria: {
        yes: "It is an internship or co-op (the title says intern, internship, co-op, or a bank-style Summer Analyst program), for summer 2027 or naming no term, and the assigned work is software engineering, ML, AI, model-building data science, or technical product management.",
        no: "It states a mismatch: a full-time, contract, new-grad, or rotational role, or a title without intern wording whose description never says internship; or a fall, spring, or year-round term; or work in another field such as mechanical, civil, chemistry, marketing, finance, or analytics (BI reporting, dashboards, SQL reports, Excel, Tableau, Power BI).",
        unclear:
          "The posting is silent or mixed on whether it is an internship, its term, or its field, for example a bare 'Engineering Intern' with no field named.",
      },
    },
    degree_ok: {
      type: "choice",
      instructions: `Does the posting's degree requirement admit ${PROGRAM}?`,
      criteria: {
        yes: "The posting explicitly accepts master's or graduate students, lists degree levels that include a master's (BS/MS; bachelor's, master's, or PhD), or only says 'pursuing a degree' with no level.",
        no: "The text excludes master's students outright: undergraduate or bachelor's students only, rising juniors or seniors only, PhD students only, MBA students only, or a required graduation window that ends before May 2028 or starts after it.",
        unclear:
          "Everything else, including a bachelor's degree named without exclusion language ('pursuing a bachelor's degree in Computer Science'), or no degree requirement at all.",
      },
    },
    work_auth: {
      type: "choice",
      instructions: "What work-authorisation constraint does the posting state?",
      criteria: {
        citizen_only: "Requires US citizenship, a security clearance, or ITAR 'US person' status.",
        no_sponsorship:
          "Says visa sponsorship is not available now or in the future, or requires authorisation to work without sponsorship.",
        none: "Explicitly says sponsorship is available or international students are welcome.",
        unclear:
          "Says nothing about work authorisation, or only a bare 'must be authorized to work in the US', or only mentions citizenship as a protected class in an equal-opportunity statement.",
      },
    },
  },
  compose(a, _title, t) {
    const pick = (key: string): "yes" | "no" | "unclear" => {
      const c = choice(a, key);
      if ((c.p.no ?? 0) >= t.no) return "no";
      if ((c.p.yes ?? 0) >= t.yes) return "yes";
      return "unclear";
    };
    const w = choice(a, "work_auth");
    const workAuth = (w.p[w.choice] ?? 0) >= t.work ? (w.choice as Label["workAuth"]) : "unclear";
    const r = choice(a, "relevant");
    const d = choice(a, "degree_ok");
    return {
      relevant: pick("relevant"),
      degreeOk: pick("degree_ok"),
      workAuth,
      reason: `relevant ${JSON.stringify(r.p)} degree ${JSON.stringify(d.p)} work ${w.choice}(${fmt(w.p[w.choice] ?? 0)})`,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// B: decomposed choices. Atomic facts with named "silent" options; rules live in code.
// ---------------------------------------------------------------------------------------------
const IN_SCOPE = [
  "software_engineering",
  "ml_ai",
  "data_science_modelling",
  "technical_product_management",
];
const OUT_SCOPE = ["analytics_reporting", "other_engineering", "business", "it_support"];

export const decomposed: Variant = {
  name: "B-decomposed",
  questions: {
    role_type: {
      type: "choice",
      instructions: "What kind of position is this posting for?",
      criteria: {
        internship: {
          what: "An internship, co-op, or summer program for current students, including bank-style 'Summer Analyst' programs.",
          examples: [
            "Software Engineer Intern",
            "Summer 2027 Internship",
            "Co-op, Machine Learning",
          ],
        },
        full_time: {
          what: "A regular full-time or part-time job, often asking for years of professional experience, never described as an internship.",
          not_for: "Internships that happen to be full-time hours during the summer.",
        },
        contract: {
          what: "A contract, freelance, temporary, or hourly contractor role that is not described as an internship.",
        },
        new_grad: {
          what: "A job for people who have already graduated: new grad, entry level, early career, or a post-graduation rotational program.",
        },
      },
    },
    season: {
      type: "choice",
      instructions: "In which season does the posting say the internship or job takes place?",
      criteria: {
        summer: "Summer, or dates between May and September.",
        fall: "Fall or autumn only, or dates between September and December.",
        spring: "Spring or winter only, or dates between January and May.",
        year_round:
          "Year-round, part-time during the school year, or several terms with no summer option.",
        not_stated: "The posting does not name a season or dates.",
      },
    },
    year: {
      type: "choice",
      instructions:
        "Which year does the posting say the internship or job takes place in? Ignore graduation years and the company's founding year.",
      criteria: {
        y2026: "2026",
        y2027: "2027",
        y2028: "2028",
        not_stated: "No year is named for when the work happens.",
      },
    },
    field: {
      type: "choice",
      instructions: {
        question: "Which field is the work the description assigns in?",
        focus:
          "Judge the day-to-day work the description assigns, not the title or a passing mention of Python or AI tools.",
      },
      criteria: {
        software_engineering: {
          what: "Building software: applications, backend, frontend, infrastructure, platforms, developer tools, embedded or systems software.",
        },
        ml_ai: {
          what: "Building, training, evaluating, or deploying machine learning models, LLM or generative AI applications, computer vision, or AI research.",
        },
        data_science_modelling: {
          what: "Statistical or predictive modelling, experimentation, and data science that builds models.",
          not_for: "Reporting, dashboards, and SQL queries for business stakeholders.",
        },
        technical_product_management: {
          what: "Product management for a software or AI product, or one that asks for a computer science or engineering background.",
        },
        analytics_reporting: {
          what: "Business, data, or financial analytics: reports, dashboards, SQL queries, Excel, Tableau, Power BI, KPI tracking.",
          not_for: "Work that trains models or builds software.",
        },
        other_engineering: {
          what: "Mechanical, civil, chemical, electrical hardware, aerospace, materials, manufacturing, or physical science work.",
        },
        business: {
          what: "Marketing, sales, finance, accounting, operations, HR, consulting, or other non-technical business work.",
        },
        it_support: { what: "IT help desk, technical support, network or systems administration." },
      },
    },
    degree: {
      type: "choice",
      instructions: "What does the posting say about the candidate's degree level?",
      criteria: {
        includes_masters: {
          what: "Accepts master's or graduate students, or lists degree levels that include a master's.",
          examples: ["BS/MS", "bachelor's, master's, or PhD", "graduate student"],
        },
        any_level: {
          what: "Says 'pursuing a degree' or 'enrolled in a university' without naming a level.",
        },
        bachelors_named: {
          what: "Names a bachelor's degree as the requirement, without saying only undergraduates may apply.",
          examples: [
            "pursuing a Bachelor's degree in Computer Science",
            "enrolled in a bachelor's program",
          ],
        },
        undergrad_only: {
          what: "Explicitly limits the role to undergraduates.",
          examples: [
            "undergraduate students only",
            "must be a rising junior or senior",
            "enrolled in an accredited undergraduate program",
          ],
        },
        phd_only: {
          what: "Requires a PhD student or PhD candidate; master's students are not accepted.",
        },
        mba_only: { what: "Requires an MBA student." },
        not_stated: {
          what: "Says nothing about degree level or enrollment, or only names a completed degree for an experienced hire.",
        },
      },
    },
    grad_end: {
      type: "choice",
      instructions: "What is the latest graduation date the posting accepts for applicants?",
      criteria: {
        before_2027_06: "Graduating by May 2027 or earlier.",
        "2027_06_to_2027_12": "Graduating between June and December 2027.",
        "2028_01_to_2028_08": "Graduating between January and August 2028.",
        after_2028_08: "Graduating September 2028 or later.",
        not_stated: "The posting does not state a graduation date or window.",
      },
    },
    grad_start: {
      type: "choice",
      instructions: "What is the earliest graduation date the posting accepts for applicants?",
      criteria: {
        by_2028_05: "May 2028 or earlier, or only an end date is given.",
        after_2028_05: "June 2028 or later.",
        not_stated: "The posting does not state a graduation date or window.",
      },
    },
    work_auth: {
      type: "choice",
      instructions: "What does the posting say about work authorisation or visa sponsorship?",
      criteria: {
        citizen_or_clearance: {
          what: "Requires US citizenship, a security clearance, or ITAR / export-control 'US person' status.",
        },
        no_sponsorship: {
          what: "Says visa sponsorship is not available now or in the future, or requires authorisation to work without sponsorship.",
        },
        sponsorship_available: {
          what: "Says sponsorship is available, or international students are welcome.",
        },
        authorized_only: {
          what: "Only says candidates must be authorized to work in the US, without mentioning sponsorship.",
        },
        not_stated: {
          what: "Says nothing about work authorisation, or mentions citizenship only as a protected class in an equal-opportunity statement.",
        },
      },
    },
  },
  compose(a, title, t) {
    const role = choice(a, "role_type");
    const season = choice(a, "season");
    const year = choice(a, "year");
    const field = choice(a, "field");
    const degree = choice(a, "degree");
    const gEnd = choice(a, "grad_end");
    const gStart = choice(a, "grad_start");
    const work = choice(a, "work_auth");
    const titleIntern = INTERN_TITLE.test(title);

    // relevant: each test yields yes / no / unclear; any no -> no, all yes -> yes.
    const pIntern = role.p.internship ?? 0;
    const roleNo = titleIntern ? 1 - pIntern >= t.no : pIntern < t.yes;
    const roleYes = pIntern >= t.yes;
    const pOtherSeason = sum(season.p, ["fall", "spring", "year_round"]);
    const pOtherYear = sum(year.p, ["y2026", "y2028"]);
    const termNo = pOtherSeason >= t.no || pOtherYear >= t.no;
    const pIn = sum(field.p, IN_SCOPE);
    const pOut = sum(field.p, OUT_SCOPE);
    const fieldNo = pOut >= t.no;
    const fieldYes = pIn >= t.yes;
    const relevant = roleNo || termNo || fieldNo ? "no" : roleYes && fieldYes ? "yes" : "unclear";

    // degreeOk
    const pExclude = sum(degree.p, ["undergrad_only", "phd_only", "mba_only"]);
    const pAdmit = sum(degree.p, ["includes_masters", "any_level"]);
    const windowNo =
      sum(gEnd.p, ["before_2027_06", "2027_06_to_2027_12"]) >= t.no ||
      (gStart.p.after_2028_05 ?? 0) >= t.no;
    const degreeOk = pExclude >= t.no || windowNo ? "no" : pAdmit >= t.yes ? "yes" : "unclear";

    const wmap: Record<string, Label["workAuth"]> = {
      citizen_or_clearance: "citizen_only",
      no_sponsorship: "no_sponsorship",
      sponsorship_available: "none",
      authorized_only: "unclear",
      not_stated: "unclear",
    };
    const workAuth =
      (work.p[work.choice] ?? 0) >= t.work ? (wmap[work.choice] ?? "unclear") : "unclear";

    const reason = [
      `role=${role.choice}(${fmt(pIntern)} intern, titleIntern=${titleIntern})`,
      `season=${season.choice} year=${year.choice}`,
      `field=${field.choice}(in ${fmt(pIn)} out ${fmt(pOut)})`,
      `degree=${degree.choice}(excl ${fmt(pExclude)} admit ${fmt(pAdmit)})`,
      `grad=${gStart.choice}..${gEnd.choice}`,
      `work=${work.choice}(${fmt(work.p[work.choice] ?? 0)})`,
    ].join(" ");
    return { relevant, degreeOk, workAuth, reason };
  },
};

// ---------------------------------------------------------------------------------------------
// C: decomposed nouls. The same facts as yes/no propositions with a probability band.
// ---------------------------------------------------------------------------------------------
const yn = (instructions: string, yes: string, no: string): JevQuestion => ({
  type: "noul",
  instructions,
  criteria: { true: yes, false: no },
});

export const nouls: Variant = {
  name: "C-nouls",
  questions: {
    is_internship: yn(
      "Is this position an internship, co-op, or student summer program?",
      "The posting describes an internship, co-op, or summer program for current students.",
      "A regular full-time, part-time, contract, or new-grad job.",
    ),
    other_term: yn(
      "Does the posting say the work takes place in a term other than summer, such as fall, spring, or year-round?",
      "It names fall, spring, winter, or year-round as the only term.",
      "It names summer, or names no term.",
    ),
    other_year: yn(
      "Does the posting say the work takes place in a year other than 2027?",
      "It names 2026 or 2028 as the year the internship happens.",
      "It names 2027, or names no year.",
    ),
    in_scope_field: yn(
      "Is the assigned work software engineering, machine learning, AI, model-building data science, or technical product management?",
      "The day-to-day work builds software, trains or deploys models, builds AI applications, or manages a software product.",
      "The work is analytics or reporting, another engineering discipline, business, or IT support.",
    ),
    analytics_or_other_field: yn(
      "Is the assigned work mainly analytics, reporting, non-software engineering, business, or IT support?",
      "Dashboards, SQL reports, Excel, BI tools, mechanical/civil/chemical engineering, marketing, finance, operations, or help desk.",
      "Software engineering, machine learning, AI, model-building data science, or technical product management.",
    ),
    accepts_masters: yn(
      "Does the posting accept master's or graduate students, or only say 'pursuing a degree' without a level?",
      "It names master's or graduate students among accepted levels, or names no level.",
      "It names only bachelor's, only PhD, only MBA, or says nothing about degrees.",
    ),
    excludes_masters: yn(
      "Does the posting explicitly limit applicants to undergraduates only, PhD students only, or MBA students only?",
      "Words like 'undergraduate students only', 'must be a rising junior or senior', or 'PhD candidates only'.",
      "It accepts several levels, names a bachelor's without limiting to it, or says nothing.",
    ),
    grad_window_excludes: yn(
      "Does the posting require a graduation date that is before May 2028 or after May 2028?",
      "A required graduation window that ends before May 2028 or starts after it, such as 'graduating December 2027'.",
      "No graduation window, or one that includes May 2028.",
    ),
    citizen_only: yn(
      "Does the posting require US citizenship, a security clearance, or ITAR US-person status?",
      "Requires citizenship, clearance, or US-person status.",
      "No such requirement, or citizenship mentioned only in an equal-opportunity statement.",
    ),
    no_sponsorship: yn(
      "Does the posting say visa sponsorship is not available?",
      "Sponsorship not available now or in the future, or must work without sponsorship.",
      "Sponsorship available, or not mentioned.",
    ),
    sponsorship_available: yn(
      "Does the posting say visa sponsorship is available or international students are welcome?",
      "Sponsorship is available or international students are welcome.",
      "Sponsorship not available, or not mentioned.",
    ),
  },
  compose(a, title, t) {
    const n = (k: string) => noul(a, k);
    const titleIntern = INTERN_TITLE.test(title);
    const pIntern = n("is_internship");
    const roleNo = titleIntern ? 1 - pIntern >= t.no : pIntern < t.yes;
    const termNo = n("other_term") >= t.no || n("other_year") >= t.no;
    const fieldNo = n("analytics_or_other_field") >= t.no && 1 - n("in_scope_field") >= t.no;
    const relevant =
      roleNo || termNo || fieldNo
        ? "no"
        : pIntern >= t.yes && n("in_scope_field") >= t.yes
          ? "yes"
          : "unclear";
    const degreeOk =
      n("excludes_masters") >= t.no || n("grad_window_excludes") >= t.no
        ? "no"
        : n("accepts_masters") >= t.yes
          ? "yes"
          : "unclear";
    const w: [Label["workAuth"], number][] = [
      ["citizen_only", n("citizen_only")],
      ["no_sponsorship", n("no_sponsorship")],
      ["none", n("sponsorship_available")],
    ];
    const top = w.reduce((m, x) => (x[1] > m[1] ? x : m));
    const workAuth = top[1] >= t.work ? top[0] : "unclear";
    const reason = Object.entries(a)
      .map(([k, v]) => `${k}=${v.type === "noul" ? fmt(v.noul) : "?"}`)
      .join(" ");
    return { relevant, degreeOk, workAuth, reason };
  },
};

export const VARIANTS: Record<string, Variant> = {
  [mirror.name]: mirror,
  [decomposed.name]: decomposed,
  [nouls.name]: nouls,
};

// ---------------------------------------------------------------------------------------------
// B2: B with dev-set fixes. Degree splits bare undergrad wording from explicit restriction,
// field separates business PM from technical PM, work auth gets the labelling precedents.
// ---------------------------------------------------------------------------------------------
const b2Questions: Record<string, JevQuestion> = {
  ...decomposed.questions,
  field: {
    ...(decomposed.questions.field as Extract<JevQuestion, { type: "choice" }>),
    criteria: {
      ...(decomposed.questions.field as Extract<JevQuestion, { type: "choice" }>).criteria,
      technical_product_management: {
        what: "Product management for a software, data, or AI product, working with engineers, or asking for a computer science or engineering background.",
        not_for:
          "Product roles for banking, lending, card, or investment products that ask for business, finance, or marketing backgrounds.",
      },
      business_product_management: {
        what: "Product management, product strategy, or program management for financial, banking, consumer, or business products, with business cases, market research, and stakeholder work, and no engineering background asked.",
        examples: [
          "Consumer Banking Payments Product Management intern",
          "MBA Product Intern",
          "Program Management intern doing requirements and adoption metrics",
        ],
      },
    },
  },
  degree: {
    type: "choice",
    instructions: "What does the posting require about the candidate's degree level?",
    criteria: {
      includes_masters: {
        what: "Accepts master's or graduate students, or lists degree levels that include a master's.",
        examples: [
          "BS/MS",
          "bachelor's, master's, or PhD",
          "graduate student",
          "Bachelor's or Master's program",
        ],
      },
      any_level: {
        what: "Says 'pursuing a degree' or 'enrolled in a university' without naming a level.",
      },
      bachelors_named: {
        what: "Names a bachelor's or undergraduate degree as what the candidate is pursuing, but does not say only undergraduates may apply.",
        examples: [
          "pursuing a Bachelor's degree in Computer Science",
          "enrolled in a bachelor's program",
          "Undergrad enrolled in CS",
          "current undergraduate pursuing a degree",
        ],
        not_for: "Postings that say 'must', 'only', or limit applicants to particular class years.",
      },
      undergrad_only: {
        what: "Restricts applicants to undergraduates with 'must', 'only', or a class-year requirement.",
        examples: [
          "must be a rising junior or senior",
          "Sophomore, Junior or Senior currently pursuing bachelor's degree",
          "must be currently enrolled in a full-time BS/BA degree program",
          "undergraduate students only",
        ],
        not_for: "A bachelor's degree named without 'must', 'only', or class years.",
      },
      phd_only: {
        what: "Requires a PhD student or PhD candidate; master's students are not accepted.",
      },
      mba_only: { what: "Requires an MBA student." },
      not_stated: {
        what: "Says nothing about degree level or enrollment, or only names a completed degree for an experienced hire.",
      },
    },
  },
  work_auth: {
    type: "choice",
    instructions: "What does the posting say about work authorisation or visa sponsorship?",
    criteria: {
      citizen_or_clearance: {
        what: "Requires US citizenship, a security clearance or the ability to obtain one, or ITAR / export-control 'US person' status with no exception.",
        not_for:
          "Export-control text that allows an export license or authorization for non-US persons.",
      },
      no_sponsorship: {
        what: "Says visa sponsorship is not available now or in the future, or requires permanent, indefinite, or unrestricted authorisation to work, or says F-1 OPT/CPT students are not eligible.",
        examples: [
          "will not sponsor",
          "without need for sponsorship now or in the future",
          "must have permanent work authorization",
          "right to work in the U.S. without restriction",
        ],
      },
      sponsorship_available: {
        what: "Says sponsorship is available, or international or F-1 CPT students are welcome.",
      },
      authorized_only: {
        what: "Only says candidates must be authorized or eligible to work in the US, without mentioning sponsorship, permanence, or restrictions.",
      },
      not_stated: {
        what: "Says nothing about work authorisation, mentions citizenship only in an equal-opportunity statement, or hedged export-control text that allows a license.",
      },
    },
  },
};

export const decomposed2: Variant = {
  name: "B2-decomposed",
  questions: b2Questions,
  compose(a, title, t) {
    const out = decomposed.compose(a, title, t);
    const field = choice(a, "field");
    // business PM is out of scope
    if (
      out.relevant !== "no" &&
      (field.p.business_product_management ?? 0) + sum(field.p, OUT_SCOPE) >= t.no
    ) {
      out.relevant = "no";
    } else if (out.relevant === "yes" && sum(field.p, IN_SCOPE) < t.yes) {
      out.relevant = "unclear";
    }
    out.reason = `${out.reason} bizPM=${fmt(field.p.business_product_management ?? 0)}`;
    return out;
  },
};
VARIANTS[decomposed2.name] = decomposed2;
