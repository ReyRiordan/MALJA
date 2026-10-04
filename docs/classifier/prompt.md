# Prompt

Code: `src/classifier/prompt.ts` (pure, no I/O), `src/classifier/types.ts` (`CATEGORIES`, `Category`).

```ts
MAX_DESCRIPTION_CHARS = 12_000
MAX_REASON_CHARS = 500
VERDICT_JSON_SCHEMA                                      // strict JSON schema for response_format
VerdictSchema                                            // zod mirror: relevant, categories, degree_ok, work_auth, reason
buildMessages(facts: ProgramFacts, input: ClassifyInput): ChatMessage[]
parseVerdict(content: string): Verdict | null
```

## Program facts come from config

`classifier.program`, `classifier.graduation`, `classifier.term`, and `classifier.fields` in config.json go into the system prompt verbatim. The search URL already carries the year-specific "summer 2027", so the year facts live next to it and next year's cohort is a config edit, not a redeploy. The rubric and the JSON schema stay in code.

The prompt tells the model who the students are, when they graduate, which term they want, and which fields count, so a graduation-window rule in a posting can be checked against the configured date and a stated term or field can be checked against the configured ones. `term` and `fields` are required rather than defaulted because a silent default would suppress jobs. The field list lives in config, not the prompt, so the code is not tied to one program.

## Rubric

The system prompt opens by asking whether this is a `term` internship that `program` might want to apply to, what kind of work it is, and whether they are eligible. It then states the rules in these words. Keep this section and `systemPrompt()` in sync.

`relevant`: is this a `term` internship in `fields`?

- "yes" only when all three hold: the posting is an internship or co-op, not a full-time, contract, new-grad, or rotational analyst role; it is for `term`, or names no term at all; and the work is in `fields`.
- "no" when the posting states a mismatch on any of the three: it is a full-time, contract, new-grad, or rotational analyst role; it names a different term (for example fall, spring, or year-round only); or the work is in another field (for example mechanical, civil, chemistry, marketing, sales such as account executive or sales and business development, go-to-market strategy, finance, or business and data analytics such as BI reporting and dashboard work), even if it mentions Python.
- Judge the field by the work the description assigns, not the title. A "Data Analyst Intern" whose work is training models is in scope; a "Data Science Intern" whose work is dashboards, SQL reports, and Excel, Tableau, or Power BI is analytics, which is another field.
- The title is the strongest signal. Employers put "intern", "internship", or "co-op" in the title of nearly every internship, so a title without any of those words (for example "Software Engineer", "AI/ML Engineer", "Junior Developer") is very likely a regular job: answer "no" unless the description itself says it is an internship or co-op.
- A title containing "analyst" or "analytics" with no engineer, developer, scientist, ML, or AI wording (for example "Data Analyst Intern", "Business Analyst Intern", "Logistics Analytics Intern") is very likely an analytics role: answer "no" unless the description itself assigns modelling, ML, or software work.
- "unclear" when the posting is silent or mixed on one of the three, for example a bare "Engineering Intern" with no field named.

`categories`: which skillsets does the role require? List every id the posting requires, or none. An id names the skillset the work needs, not the domain, team, or system the role works on.

- "swe": general software engineering (backend, frontend, full-stack, mobile, developer tools, software test automation). The default for software work that no id below covers.
- "aiml": AI and ML skills are core to the work: training or fine-tuning models, ML fundamentals, data science that builds models, computer vision, NLP, or recommender modelling, agents, RAG and retrieval, prompt and context engineering, evals.
- "infra": DevOps, SRE, cloud, platform, CI/CD, observability, compute infrastructure, networking (network engineering, SDN, cloud networking), and ML platforms, MLOps, and model serving infrastructure.
- "data": data engineering: pipelines, ETL, warehousing, Spark, Airflow, dbt, streaming.
- "security": application security, security engineering, detection, offensive security.
- "perf": performance engineering on servers and accelerators: GPU and CUDA kernels, ML compilers (LLVM, MLIR, Triton), quantization and inference optimisation, HPC.
- "embedded": software tied to physical hardware: firmware, RTOS, flight software, device drivers, hardware and firmware validation and verification, robotics and autonomy (ROS, controls, motion planning, SLAM).
- "solutions": technical customer-facing work: solutions and sales engineering, solutions architecture, forward deployed engineering, customer and implementation engineering, GTM engineering, technical account management.
- "pm": technical product management.
- Judge by the work the description assigns, not the title.
- List more than one id only when the posting requires more than one skillset.
- Every other id replaces "swe": a role that is mainly that work gets that id instead of "swe". Add "swe" only when the posting also assigns substantial general product software work.
- "aiml" versus "swe": AI that the team ships as a feature, a thin API call to a model from ordinary backend code, or AI tools the engineer uses (for example Copilot or Cursor) is "swe". List both only when both kinds of work are substantial.
- An ML context alone does not add "aiml". A "perf" role, or an ML platform, MLOps, or model serving "infra" role, also gets "aiml" only when the posting assigns modelling work (training, model architecture, evals).
- Learned perception for robots or vehicles is "embedded" and "aiml".
- A research role gets the id of the skillset it needs: an ML research intern is "aiml".
- "solutions" gets another id only when the customer work requires that skillset: building RAG proofs of concept for customers adds "aiml"; demoing a product does not.
- Analytics, BI reporting, and dashboard work is not "data".
- Categories sort the work; they never decide relevant. Infrastructure, security, performance engineering, QA and test automation, embedded, data engineering, and technical customer-facing solutions roles count as software engineering for relevant, so a role that is mainly one of them is still in the fields.
- Answer even when relevant is "no". Use an empty list only when the work fits none of the ids.

`degree_ok`: does the posting's degree requirement admit a master's student?

- "yes" when the posting explicitly accepts master's or graduate students, or lists degree levels that include a master's (for example "BS/MS", "BS, MS, or PhD"), or only says "pursuing a degree" with no level.
- "no" only when the text excludes master's students outright with words like "only", "must be", or "not eligible": undergraduate or bachelor's students only, PhD students only, MBA students only, or a required graduation date or window that the configured graduation misses.
- "unclear" for everything else, including "pursuing a bachelor's degree", "currently pursuing a Bachelor's degree in Computer Science", or "enrolled in a bachelor's degree program" with no exclusion language, since many such postings still take master's students. Naming a bachelor's degree is a requirement to hold or be working toward one, not a ban on master's students; a master's student has met it. A graduation window stated next to a bachelor's degree (for example "graduating Spring 2028 with a Bachelor's degree", or "enrolled in a bachelor's program" with an expected graduation range) is bachelor's wording, not an exclusion: check the window against the configured graduation and answer "unclear" when it fits.

`work_auth`: what work-authorisation constraint does the posting state?

- "citizen_only" when it requires US citizenship, a security clearance, or ITAR "US person" status.
- "no_sponsorship" when it says sponsorship is not available now or in the future, or requires authorisation to work "without sponsorship".
- "none" when it explicitly says sponsorship is available or international students are welcome.
- "unclear" when it says nothing, and also for a bare "must be authorized to work in the US", because F-1 students on CPT are authorized for internships and that line alone excludes nobody.

`reason`: one sentence quoting the phrase that decided each of the three answers, or saying that the posting is silent.

The relevance rule is a model filter with no keyword gate on the card title in code. A title keyword nobody thought of (bank-style "Summer Analyst, Software Engineering") would lose a job silently, and off-title postings are rare enough that one detail fetch plus one classifier call each is cheap. `yes` needs all three tests and `no` needs a stated mismatch, so a posting that names no term still counts as a match, because many summer internships never say the year. The field test exists because a mechanics research internship is exactly the non-CS internship the search returns.

The title rule exists because the guest search returns plenty of regular jobs that never say "full-time": a recruiter repost titled "Software Engineer" that asks for professional experience, or a contract "AI/ML Engineer" paid hourly. Without the rule the model read those as silent on the internship test and answered `unclear`, which goes out untagged. The rule is a prompt instruction rather than a code gate so the bank-style title still reaches the model, which can say `yes` when the description calls it an internship. LinkedIn's own employment type is not a substitute: real internships in the eval set are tagged Full-time or Volunteer as often as Internship.

The analyst-title rule exists because analytics internships pass every other test: the title says intern, the body mentions "AI-enabled tools" or Python, and the work is reports, dashboards, and SQL. Without the rule the model read those as silent on the field test and answered `unclear`, which reaches the group with a tag. The field is judged on the work the description assigns, so a "Data Analyst Intern" training models still passes and a title with engineer, developer, or scientist wording next to "analyst" (bank-style "Summer Analyst, Software Engineer") is not caught. What counts as data science, and that technical product management and technical customer-facing engineering are in scope, comes from `classifier.fields` in config, not from the rubric in code.

Categories split up what passes `relevant`; they do not widen it, so `embedded` means software tied to hardware, not hardware design. `solutions` is the exception: `classifier.fields` names technical customer-facing engineering explicitly, because otherwise the id would mostly tag jobs that `relevant = no` suppresses. The widening is limited to the same test `pm` uses: customer-facing work (demos, POCs, integrations, deploying the product with customers) in a role that asks for a CS or engineering background or assigns technical work. Quota-carrying sales and go-to-market strategy stay in the "no" field list, so the group does not fill with account executive and SDR internships. The id is `solutions` rather than `sales` because `#sales` would suggest exactly the roles that are excluded.

Each id names a skillset that a software-only engineer usually lacks, and a job gets the ids for the skillsets it requires, not for the domain, team, or system it works on. A channel follower has a skillset, so that is what routes a job: a web dashboard on an ML team goes to `swe`, and a CUDA kernel job for model inference goes to `perf`, not `aiml`. The same principle decides every boundary. `aiml` covers both training models and building on them (agents, RAG, prompt and context engineering, evals) because both need the same AI-specific skills and generic "AI/ML" postings do not say which they mean; AI as a shipped feature or a thin model API call is `swe`, since those followers have the skills it takes. `perf` exists because GPU kernels, ML compilers, and HPC need parallel programming, computer architecture, and profiling skills that most `aiml` people do not have; it stays apart from `embedded`, which shares C/C++ and computer architecture but targets devices rather than servers and accelerators, so a merged id would mislabel either robotics or CUDA jobs. The cost is a quiet `perf` channel, accepted because the group gets everything. `embedded` keeps its name because it is the term students search for, and covers robotics and autonomy as well as firmware. `data` is data engineering only; model-building data science is `aiml`, so the two do not overlap. There is no `qa` id, because software test automation needs `swe` skills and hardware validation needs `embedded` ones, and no `research` id, because research is a role type rather than a skillset: a research role gets the id of what it researches, and `classifier.fields` keeps research internships in scope.

The list is multi-label, but most jobs need one id: a second one is listed only when the posting requires a second skillset. About one sendable job in ten sits on a real boundary (backend and infra, an ML platform, LLM product work), and single-label would route those arbitrarily from run to run, while a channel should be complete on its own. Every id other than `swe` replaces `swe` rather than sitting next to it, so a general-software follower does not get specialist roles. The ids and definitions live in code next to the rubric, not in config.json, because the schema enum and the eval labels depend on them: changing the list means re-labelling the eval set and a store migration for ids already on rows. Categories are filled even for `relevant = no`, which costs nothing and helps audits. The line saying categories never decide `relevant` exists because without it the model read specialist ids as fields outside `classifier.fields` and suppressed QA, SRE, security, and data engineering internships that the relevance rule alone sends; performance engineering and solutions roles are named in it for the same reason.

The degree rule leans permissive on purpose. Missing a job costs more than a tagged message, so bachelor's-only wording without exclusion language is `unclear`, not `no`. A stated graduation window is taken at its word.

## Inputs and schema

The user message carries the title, the company, and the description. A description longer than `MAX_DESCRIPTION_CHARS` is cut there and ends with `[truncated]`.

The reply is requested as `response_format: { type: "json_schema", strict: true }` with five required keys and no extras. `relevant` is the first property so the model decides it before eligibility, and `categories` comes next, before the eligibility fields. `categories` is an array whose items are the `CATEGORIES` enum; `VerdictSchema` rejects an unknown id and removes duplicates, keeping first-seen order. `[]` is valid. `VerdictSchema` validates whatever comes back, so a model that ignores `json_schema` still works: `parseVerdict` tries the whole string as JSON, then the first `{...}` block for fenced or prose-wrapped replies, then zod. `reason` is cut to `MAX_REASON_CHARS`. Anything that fails returns null and the client turns that into the `unparsable output` cause.

## null versus unclear

The fallback verdict has `categories: []`, which reads the same as a posting the model could not place.

On the job row, `degree_ok = NULL` means never classified: the group had no description anywhere. `unclear` means the model could not tell, or the call failed and the fallback verdict was stored. They stay distinct so the audit row says which.

`relevant = NULL` next to a non-null `degree_ok` is a row classified before the column existed. The store reads it back as `unclear`, and `categories = NULL` as `[]`, so `Verdict` stays total. See docs/core/store.md.
