# Labelling guide

How to label a file in `test/eval/eligibility/` (format in eval.md). It restates the rubric in prompt.md for a labeller and adds the precedents settled while labelling wording the rubric does not name. Labels are ground truth for `pnpm eval:classifier`: label what the rubric says the answer should be, not what a model would probably say. Read the whole description before labelling.

The student facts below are the `classifier` values in config.json. When the cohort changes, update them here and relabel postings whose answer depends on them.

Students: master's students in Carnegie Mellon's M.S. in Artificial Intelligence and Innovation, a mix of US citizens and F-1 international students. They graduate in **May 2028** and want **summer 2027** internships. In-scope fields: software engineering, machine learning, AI, data science that builds or trains models rather than reports or dashboards, and technical product management (PM for a software or AI product, or one that asks for a CS or engineering background), including research internships in those areas, and technical customer-facing engineering (solutions engineering, solutions architecture, sales engineering, forward deployed engineering) for roles that ask for a CS or engineering background or assign technical work.

## relevant: is this a summer 2027 internship in the fields above?

- "yes" only when all three hold: the posting is an internship or co-op, not a full-time, contract, new-grad, or rotational analyst role; it is for summer 2027, or names no term at all (a summer program with no year counts; "this summer" counts); and the work is in the fields.
- "no" when the posting states a mismatch on any of the three: full-time, contract, new-grad, or rotational analyst role; a different term (fall, spring, year-round only, or summer 2026); or the work is in another field (mechanical, civil, chemistry, marketing, sales such as account executive or sales/business development, go-to-market strategy, finance, electrical or hardware design (circuits, PCBs, FPGAs), or business/data analytics such as BI reporting and dashboard work), even if it mentions Python.
- Judge the field by the skills the work requires, not the title. If the core work needs skills from another field, answer "no" even when it also assigns software tasks. A "Data Analyst Intern" whose work is training models is in scope; a "Data Science Intern" whose work is dashboards, SQL reports, and Excel/Tableau/Power BI is analytics, which is another field.
- A title without "intern", "internship", or "co-op" (e.g. "Software Engineer", "AI/ML Engineer") is a regular job: "no" unless the description itself says it is an internship or co-op. Bank-style "Summer Analyst, Software Engineering" programs are internships.
- A title with "analyst"/"analytics" and no engineer/developer/scientist/ML/AI wording is "no" unless the description assigns modelling, ML, or software work.
- "unclear" when the posting is silent or genuinely mixed on one of the three, e.g. a bare "Engineering Intern" with no field named.
- Customer-facing roles: solutions engineer, solutions architect, sales engineer, forward deployed engineer, customer engineer, GTM engineer (builds sales automation and CRM/enrichment integrations), technical account manager, and implementation or onboarding engineer are in the fields when the work is demos, POCs, integrations, or deploying the product with customers and the posting asks for a CS/engineering background or assigns technical work. The same title without either (selling industrial equipment, chemicals, or building systems) is another field. Quota-carrying sales (account executive, SDR/BDR, business development), GTM strategy or operations, technical support or helpdesk, and consulting-firm technology analyst programs are "no".
- Electrical/hardware/embedded: embedded software or firmware work counts as software engineering. A role whose core work is circuit, PCB, FPGA, or test-fixture design is "no", even with test scripts, tools, or a website on the side.

## categories: what kinds of work does the role do?

Label categories only on files the label sends (neither `relevant` nor `degreeOk` is "no"). On a file whose label suppresses the job, set `categories` and `categoriesAlso` to null; those files are not scored.

`categories` is the set that must appear: each id a channel follower would clearly want this job for. `categoriesAlso` is the set that may appear without penalty: ids a reasonable reader could also pick. Put an id in exactly one of the two, or neither. `[]` is valid for `categories` when no id fits; an `unclear` relevance often still names the work.

An id names a skillset a software-only engineer usually lacks. Label the skillset the role requires, not the domain, team, or system it works on: a web dashboard built on an ML team is `swe`, not `aiml`. The ids:

- `swe`: general software (backend, frontend, full-stack, mobile, developer tools, software test automation). The default for software work that no other id covers.
- `aiml`: AI and ML skills are core to the work: training or fine-tuning models, ML fundamentals, model-building data science, CV/NLP/recommender modelling, agents, RAG and retrieval, prompt and context engineering, evals.
- `infra`: DevOps, SRE, cloud, platform, CI/CD, observability, compute infrastructure, networking (network engineering, SDN, cloud networking), and ML platforms, MLOps, and model serving infrastructure.
- `data`: data engineering: pipelines, ETL, warehousing, Spark/Airflow/dbt, streaming.
- `security`: application security, security engineering, detection, offensive security.
- `perf`: performance engineering on servers and accelerators: GPU/CUDA kernels, ML compilers (LLVM/MLIR/Triton), quantization and inference optimisation, HPC.
- `embedded`: software tied to physical hardware: firmware, RTOS, flight software, device drivers, hardware/firmware validation and verification, robotics and autonomy (ROS, controls, motion planning, SLAM).
- `solutions`: technical customer-facing work: solutions and sales engineering, solutions architecture, forward deployed engineering, customer and implementation engineering, GTM engineering, technical account management.
- `pm`: technical product management.

Rules:

- Judge by the work the description assigns and the skills its qualifications, required or preferred, ask for, not the title or the company's domain. The rule is the same for every id: when at least three qualification items, or most of the list, ask for one id's specific skills, that id is required, next to the duties' id rather than replacing it. Backend duties with a preferred list that is all AI (PyTorch, RAG, agents, LoRA, LLM evals) is `swe` and `aiml` required; backend duties with qualifications of Kubernetes, Terraform, and CI/CD is `swe` and `infra` required. One or two items add nothing, however specific ("ML a plus", "familiarity with Docker", "experience with cloud computing", "MLOps for models in production"); at most they put the id in `categoriesAlso`. AI coding tools (Copilot, Cursor, Claude Code) in the qualifications are `swe`, as in the work.
- Require more than one id only when the posting requires more than one skillset. Most sendable postings require one.
- Every other id replaces `swe`: a role that is mainly that work gets that id instead of `swe`. `swe` is required next to it only when the posting also assigns substantial general product software work; when it assigns some, `swe` goes in `categoriesAlso`.
- `aiml` versus `swe`: `aiml` when AI-specific skills are core (the list above). `swe` when AI is a feature the team ships, a thin API call to a model from ordinary backend code, or a tool the engineer uses (Copilot, Cursor). Both required only when both skillsets are substantial in the work or the qualifications. A generic "AI/ML" posting is `aiml`.
- An ML context alone does not earn `aiml`. A `perf` role (CUDA kernels for model inference, an ML compiler) or an ML platform, MLOps, or serving `infra` role gets `aiml` required only when the posting also assigns modelling work (training, model architecture, evals); otherwise `aiml` goes in `categoriesAlso` at most.
- AI agents used as a tool for other work (agents that write kernels) do not make `aiml` required. An LLM agent built over an observability stack is `aiml`, with `infra` acceptable.
- `embedded` versus `swe`: the test is the skills asked for. Embedded roles ask for C/C++, RTOS, microcontrollers, and firmware rather than web, backend, cloud, and SQL. A mainly embedded, flight, or autonomy software role gets `embedded` alone, with `swe` not acceptable. A role that asks for both skill sets gets both required.
- `embedded` versus `perf`: devices versus servers and accelerators. Firmware and robotics are `embedded`; GPU kernels and HPC are `perf`.
- Robotics and autonomy software (ROS, controls, motion planning, SLAM, simulation for robots) is `embedded`. Learned perception also requires `aiml`.
- Validation and verification: software test automation is `swe`; hardware or firmware validation and verification is `embedded`.
- `data` is data engineering only. Model-building data science is `aiml`. Analytics and dashboards are out of scope for relevance and never earn `data`.
- A research role gets the id of the skillset it researches: an ML research intern is `aiml`.
- `solutions` next to a domain id: required only when the customer work needs that skillset (building RAG or agent POCs for customers -> `aiml` required). When the role only sells or demos a product in that domain, the id goes in `categoriesAlso`.
- Forward deployed engineer: `solutions` required, `swe` in `categoriesAlso`.
- A generic software internship that lists several possible teams (backend, ML, infra, ...) is `swe`, with the team ids named prominently in `categoriesAlso`.

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
- relevant "no" for a multi-year co-op worked during school terms ("1 to 2 year Co-Op"): year-round, not summer.
- relevant "no" for sales or applications engineering on hardware, telecom equipment, chips, industrial products, or facilities (TI, Emerson, Ericsson RAN presales, data-center colocation sales), even with an engineering degree asked: the customer work is not software. Presales whose demos are only pitches and messaging, with no technical work assigned, is also "no".
- relevant "no" for Siemens Healthineers "Electrical Engineering Co-op": PCB assembly, FPGA, and test-fixture design with a circuit-design education focus are the core; test firmware, tools, and websites are side tasks.
- Duplicated descriptions (LinkedIn clones) get identical labels.
