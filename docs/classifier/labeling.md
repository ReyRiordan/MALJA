# Labelling guide

How to label a file in `test/eval/eligibility/` (format in eval.md). It restates the rubric in prompt.md for a labeller and adds the precedents settled while labelling wording the rubric does not name. Labels are ground truth for `pnpm eval:classifier`: label what the rubric says the answer should be, not what a model would probably say. Read the whole description before labelling.

The student facts below are the `classifier` values in config.json. When the cohort changes, update them here and relabel postings whose answer depends on them.

Students: master's students in Carnegie Mellon's M.S. in Artificial Intelligence and Innovation, a mix of US citizens and F-1 international students. They graduate in **May 2028** and want **summer 2027** internships. In-scope fields: software engineering, machine learning, AI, data science that builds or trains models rather than reports or dashboards, and technical product management (PM for a software or AI product, or one that asks for a CS or engineering background), including research internships in those areas.

## relevant: is this a summer 2027 internship in the fields above?

- "yes" only when all three hold: the posting is an internship or co-op, not a full-time, contract, new-grad, or rotational analyst role; it is for summer 2027, or names no term at all (a summer program with no year counts; "this summer" counts); and the work is in the fields.
- "no" when the posting states a mismatch on any of the three: full-time, contract, new-grad, or rotational analyst role; a different term (fall, spring, year-round only, or summer 2026); or the work is in another field (mechanical, civil, chemistry, marketing, finance, or business/data analytics such as BI reporting and dashboard work), even if it mentions Python.
- Judge the field by the work the description assigns, not the title. A "Data Analyst Intern" whose work is training models is in scope; a "Data Science Intern" whose work is dashboards, SQL reports, and Excel/Tableau/Power BI is analytics, which is another field.
- A title without "intern", "internship", or "co-op" (e.g. "Software Engineer", "AI/ML Engineer") is a regular job: "no" unless the description itself says it is an internship or co-op. Bank-style "Summer Analyst, Software Engineering" programs are internships.
- A title with "analyst"/"analytics" and no engineer/developer/scientist/ML/AI wording is "no" unless the description assigns modelling, ML, or software work.
- "unclear" when the posting is silent or genuinely mixed on one of the three, e.g. a bare "Engineering Intern" with no field named, or a role split evenly between in-scope and out-of-scope work.
- Electrical/hardware/embedded: embedded software or firmware work counts as software engineering; circuit design, PCB, or test-bench hardware work is other engineering.

## categories: what kinds of work does the role do?

Label categories only on files the label sends (neither `relevant` nor `degreeOk` is "no"). On a file whose label suppresses the job, set `categories` and `categoriesAlso` to null; those files are not scored.

`categories` is the set that must appear: each id a channel follower would clearly want this job for. `categoriesAlso` is the set that may appear without penalty: ids a reasonable reader could also pick. Put an id in exactly one of the two, or neither. `[]` is valid for `categories` when no id fits; an `unclear` relevance often still names the work. The ids:

- `swe`: general software (backend, frontend, full-stack, mobile, developer tools). The default for software work that no other id carves out.
- `infra`: DevOps, SRE, cloud, platform, CI/CD, observability, compute infrastructure.
- `security`: application security, security engineering, detection, offensive security.
- `qa`: QA, test automation, validation and verification.
- `ai`: applied AI on LLMs or foundation models: agents, RAG, AI tooling, evals.
- `ml`: trains or fine-tunes models: recommender systems, CV/NLP modelling, ML performance.
- `data`: data engineering, and data science that builds models.
- `embedded`: embedded software, firmware, flight software, robotics and autonomy software.
- `research`: the role is mainly research (publishing, novel methods, a research lab or team). Always next to a domain id, never alone.
- `pm`: technical product management.

Rules:

- Judge by the work the description assigns, not the title.
- `infra`, `security`, `qa`, and `embedded` are carved out of `swe`: a role that is mainly that work gets the carve-out instead of `swe`. For `infra`, `security`, and `qa`, when the role also does substantial general software work, `swe` goes in `categoriesAlso`.
- For `embedded` the test is the skills asked for, because embedded roles ask for C/C++, RTOS, microcontrollers, and firmware rather than web, backend, cloud, and SQL. A mainly embedded, flight, or autonomy software role gets `embedded` alone, with `swe` not acceptable. A role that asks for both skill sets (an embedded lab that also wants backend services and SQL) gets both required.
- `ai` versus `ml`: building on top of LLMs (prompting, agents, RAG, LLM-backed product features) is `ai`; training, fine-tuning, or optimising models is `ml`. A role that does both gets both. A generic "AI/ML" posting with no detail gets the one the work leans to in `categories` and the other in `categoriesAlso`.
- A generic software internship that lists several possible teams (backend, ML, infra, ...) is `swe`, with the team ids named prominently in `categoriesAlso`.
- `research` is required only when research is the main job ("Research Intern", "Research Scientist Intern", a lab doing publishable work). An engineering role on a research team gets `research` in `categoriesAlso`.
- `data` is data pipelines, warehousing, ETL, or model-building data science. Analytics and dashboards are out of scope for relevance, so they never earn `data` on their own.
- `embedded` covers robotics and autonomy software (perception, planning, controls software, simulation for robots). Perception model training is `ml` too.
- Training, pre-training, or fine-tuning LLMs is `ml`; `ai` is then acceptable, not required. AI agents used as a tool for other work (agents that write kernels) do not make `ai` required.
- The system an AI or software role works on is not its category: an LLM agent over an observability stack is `ai`, with `infra` acceptable. Building platforms that run AI training and inference is `infra`, with `ml` acceptable.

## degreeOk: does the degree requirement admit a master's student graduating May 2028?

- "yes" when it explicitly accepts master's or graduate students, lists levels that include master's (BS/MS; bachelor's, master's, or PhD), or only says "pursuing a degree" with no level.
- "no" only when the text excludes master's students outright with words like "only", "must be", "not eligible": undergraduate/bachelor's only, rising juniors or seniors only ("must be a rising senior"), PhD students only, MBA students only, or a required graduation date/window that May 2028 misses (e.g. "graduating December 2027", "graduating between Dec 2028 and June 2029").
- "unclear" for everything else, including "pursuing a bachelor's degree", "currently pursuing a Bachelor's degree in Computer Science", "enrolled in a bachelor's degree program" with no exclusion language. A graduation window stated next to a bachelor's degree is bachelor's wording, not an exclusion: if the window includes May 2028, answer "unclear".
- "Rising junior or senior pursuing a bachelor's degree" stated as the requirement for an "undergraduate ... intern" role reads as exclusion: "no". A bare "pursuing a bachelor's degree" is "unclear".
- No degree language at all (common in regular jobs): "unclear". A completed degree for an experienced hire ("bachelor's degree in CS required, master's preferred"): label what it says ("master's preferred" includes master's -> "yes"; "bachelor's degree required" -> "unclear").
- "PhD preferred" or "MS/PhD preferred" alongside acceptance of others is not exclusion.

## workAuth: what work-authorisation constraint does the posting state?

- "citizen_only": requires US citizenship, a security clearance (or ability to obtain one), or ITAR/export-control "US person" status.
- "no_sponsorship": sponsorship not available now or in the future, or must be authorised to work "without sponsorship".
- "none": explicitly says sponsorship is available or international students are welcome.
- "unclear": says nothing, a bare "must be authorized to work in the US", or citizenship mentioned only as a protected class in an EEO statement. If both citizen_only and no_sponsorship apply, choose citizen_only.

## Writing the label

Edit the JSON file in place. Set `expected` to every value, in the order relevant, categories, categoriesAlso, degreeOk, workAuth, and write `note` as one or two sentences quoting the deciding phrase for each field, in the style:

"Acme: relevant yes, 'Software Engineer Intern, Summer 2027', backend Go work. degreeOk unclear, 'pursuing a Bachelor's degree in CS' with no exclusion. workAuth no_sponsorship, 'will not sponsor now or in the future'. categories swe, 'build backend services in Go'; also infra, 'deploy on Kubernetes'."

Keep every other field unchanged. Keep the file as 2-space-indented JSON with a trailing newline. If a posting is truly ambiguous even under these rules, pick the best label and start the note with "BORDERLINE:".

## Precedents set while labelling (follow these)

- workAuth "no_sponsorship" also for: "must have permanent / indefinite work authorization", "right to work in the U.S. without restriction", "F-1 OPT/CPT not eligible". A US-person list that admits permanent residents plus explicit no-sponsorship wording is "no_sponsorship", not "citizen_only".
- workAuth "unclear" for hedged export-control text ("non-U.S. persons may require an export license"), "US based applicants only" (a location rule), and sponsorship "at our sole discretion".
- workAuth "citizen_only" for "must be able to obtain a security clearance" or clearance as a condition of employment.
- degreeOk "no" for "must be currently enrolled in a BS/BA program", "must be a rising junior or senior", "PhD students only / working towards a PhD" as the only level, and a required graduation window May 2028 misses even when phrased "you're graduating in Spring 2027". A window only under "Preferred qualifications" is not a requirement.
- degreeOk "unclear" for bare undergraduate/bachelor's wording without "must"/"only" ("Undergrad enrolled in CS", "current undergraduate pursuing a degree").
- relevant: a full-time new-grad or early-career role is "no" even when the work is in scope. A multi-role posting dominated by out-of-scope roles is "no".
- Duplicated descriptions (LinkedIn clones) get identical labels.
