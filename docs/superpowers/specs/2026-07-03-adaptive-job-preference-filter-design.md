# Adaptive Job Preference Filter Design

## Goal

Build an editable filtering system that learns from explicit positive and negative job feedback without silently changing the user's rules. The model focuses on job title, industry, and JD content, proposes structured rule changes, accepts user corrections, regenerates proposals, and activates nothing until the user confirms it.

## Product principles

1. Manual control is authoritative. Every active rule remains directly editable.
2. AI produces proposals, not hidden mutations.
3. A deleted job is not automatically a negative example; the user chooses the meaning of the action.
4. Learning uses both positive and negative examples to avoid over-filtering.
5. Existing sent records and daily usage remain immutable audit data.
6. The system explains why each job passes or fails and previews the effect of a proposed rule before activation.

## Job-library actions

Each job row and multi-selection toolbar exposes three distinct actions:

- `重点关注`: keep the job and store a positive feedback sample.
- `不喜欢并移除`: snapshot the job, store a negative feedback sample, cancel eligible unsent tasks, and remove the job from the active library.
- `普通移除`: cancel eligible unsent tasks and remove the job without adding a learning sample.

The negative action may include an optional user note and reason chips for `岗位名称`, `行业`, `JD工作内容`, `JD任职要求`, or `其他`. The note is not mandatory, but it is included in later model analysis.

Tasks in `pending_review`, `approved`, `paused`, or `quota_blocked` are moved to `rejected` with reason `user_removed_job`. A job currently in `sending` cannot be removed until that run resolves. Sent jobs remain in history and are only hidden from the active library. Undo restores the job snapshot and deactivates the feedback sample; it does not automatically reapprove an old task.

## Stored data

### Preference feedback

Each feedback record contains:

- stable ID and job ID;
- full immutable job snapshot;
- label `positive` or `negative`;
- selected focus fields and optional user note;
- creation time, active/undone state, and source action;
- suggestion batch IDs that consumed the sample.

The model receives the title, industry, and JD as primary evidence. Company, city, salary, experience, and education are context only and must not become exclusion rules unless the user's note explicitly requests that dimension.

### Preference rules

Rules are versioned and contain:

- action `include`, `exclude`, or `prefer`;
- field `title`, `industry`, `jd`, or `semantic_preference`;
- matching values or a short semantic preference statement;
- mode `hard` or `soft` and an editable weight;
- provenance `manual`, `ai_accepted`, or `preset`;
- evidence feedback IDs, rationale, confidence, active state, and timestamps.

Manual edits create a new version. Previous versions remain available for rollback.

### Suggestion batches

A suggestion batch records the exact active feedback IDs, current active rules, profile direction, user correction text, model/provider metadata, model cost, structured candidate rules, and status `draft`, `accepted`, `rejected`, or `superseded`.

## AI proposal workflow

Feedback accumulates locally. After five new active samples that have not been analyzed, the UI displays `可生成优化建议`; it never calls the model automatically. The user can also trigger generation manually with fewer samples.

The model compares positive and negative examples and returns schema-validated JSON containing:

- proposed title include/exclude patterns;
- proposed industry include/exclude patterns;
- JD hard-exclusion traits;
- JD soft-preference principles;
- rationale, confidence, supporting sample IDs, and counterexamples;
- warnings where evidence is insufficient or contradictory.

The user can accept individual rules, reject them, edit them before acceptance, or enter correction text and regenerate the whole draft. Regeneration includes the previous draft and correction so the model can address the disagreement. Rejected or superseded drafts never affect filtering.

## Filtering pipeline

The final evaluation order is:

1. Existing editable base constraints: city, salary, employment type, experience, and education.
2. Manual and accepted AI hard rules for title, industry, and JD.
3. Existing model-scoring call, extended with active soft preference rules and the user's profile direction.
4. Editable score threshold.

Hard rules return explicit rejection reasons such as `命中排除岗位名称：养生师` or `命中JD排除特征：主要工作为电话销售`. Soft rules do not reject directly; they influence the existing model score and produce positive/negative preference reasons. This reuses the current model call instead of adding one model call per job.

Before accepting a candidate rule, the workbench evaluates it against the current job library and shows affected jobs grouped into `将被排除`, `将被保留`, and `判断不变`. The preview performs no writes.

## Editable initial preset

For an information-management student graduating in 2027, the initial preset is a starting hypothesis rather than a permanent rule:

- Core: 数据分析, BI, 商业分析, 经营分析, 产品数据分析.
- Adjacent: ERP/CRM实施, 信息化实施, 数据运营, 数字化项目.
- Stretch: AI产品或产品实习 where the JD includes requirement analysis, data analysis, prototyping, user research, or project delivery.
- Default exclusions: 外卖, 养生, 美容, 门店销售, 电话销售, 客服, 普工, 主播, 招聘, and other roles whose JD is dominated by direct sales or offline service work.

Every preset item is editable, disableable, and removable. AI proposals cannot overwrite a manually locked rule.

## Workbench UI

### Job library

- row checkboxes and batch action toolbar;
- positive, negative-and-remove, and neutral-remove actions;
- optional negative-reason dialog;
- visible feedback label and undo action;
- operation result showing canceled tasks and stored feedback count.

### Filter settings

Add a `偏好学习` section with:

- positive/negative/new-sample counts;
- `生成优化建议` button and estimated model-call warning;
- current editable active rules with lock, disable, edit, delete, and rollback controls;
- candidate rule cards with evidence, confidence, preview, accept, reject, edit, and regenerate controls;
- correction text area for instructions such as `不要排除所有运营，只排除纯销售导向的运营`.

## APIs and boundaries

Use separate endpoints for feedback mutations, suggestion generation, rule activation/versioning, and read-only preview. The domain store owns atomic job removal, task cancellation, feedback snapshot creation, and undo. Model invocation is isolated behind a preference-optimizer interface and returns only validated structured data.

The existing in-progress deletion and sent-job work must be preserved and integrated rather than replaced. Physical job deletion must not happen before a negative feedback snapshot is safely persisted.

## Safety, cost, and failure handling

- No model call occurs during ordinary deletion, collection, or page rendering.
- Generation is user-triggered and reports estimated cost.
- Invalid model JSON, unknown sample IDs, duplicate rules, or unsupported fields reject the entire draft without changing active rules.
- Applying selected candidate rules is atomic and versioned.
- Model failure leaves feedback and current rules untouched.
- Sending automation never consumes preference drafts; it sees only active confirmed rules through the existing filtered task set.

## Acceptance criteria

1. Users can edit all active filtering rules without AI.
2. Positive, negative-and-remove, and neutral-remove actions remain semantically distinct.
3. Five new feedback samples enable but do not automatically run AI generation.
4. AI proposals use title, industry, JD, positive examples, negative examples, and user corrections.
5. Users can edit or reject every candidate and regenerate before activation.
6. No unconfirmed or invalid proposal changes filtering.
7. Preview accurately lists affected current jobs without writes.
8. Removing a job cancels eligible unsent tasks but never deletes sent history or quota evidence.
9. Filtering exposes deterministic reasons and reuses the existing model score call for soft preferences.
10. Tests cover persistence, atomicity, undo, model validation, preview, rule application, feedback thresholds, and UI contracts.
