# Product Requirements Document
**AI-Powered Product Discovery & Specification Workspace**
**Status:** Draft for review
**Product stage:** MVP
**Initial user model:** Single authorized user

**Primary objective:** Transform ambiguous business problems into evidence-linked, implementation-ready product specifications.

---

## 1. Executive Summary
The product is an AI-powered workspace for solo founders and small SaaS agencies to turn incomplete briefs and vague business problems into structured, research-informed product specifications.

Unlike a conventional AI document generator, the product maintains explicit relationships between source evidence, assumptions, open questions, requirements, and generated deliverables.

The system guides the user through a controlled workflow:
1. Capture a business problem and supporting material.
2. Identify missing information, assumptions, and contradictions.
3. Resolve critical questions through guided clarification.
4. Generate requirements linked to their supporting evidence.
5. Generate a PRD and related product artifacts.
6. Review requirement coverage, evidence quality, and unresolved risks.

The MVP will focus on a single-user workflow, with architecture that can accommodate multiple users in the future.

## 2. Problem Statement
Small SaaS agencies and solo founders frequently receive incomplete client briefs, feature requests, or business problems without sufficient user evidence. Converting these inputs into reliable product plans requires manual effort across discovery, UX research, requirements analysis, prioritization, and documentation.

This creates several risks:
- Unvalidated assumptions become product requirements.
- Critical questions remain unanswered.
- Requirements lose their connection to source evidence.
- User stories and acceptance criteria become inconsistent.
- Product documents drift as new information emerges.
- Development begins before the problem and scope are sufficiently understood.

## 3. Proposed Solution
Build a guided product discovery and specification workspace that converts raw inputs into connected, reviewable product artifacts.

The system will not treat AI-generated content as automatically verified truth. It will distinguish evidence-backed findings, assumptions, recommendations, and unresolved questions.

**Core value proposition:** Move from an unclear business problem to a traceable, reviewable product specification with less manual effort and less avoidable rework.

## 4. Target Users
- **Primary persona:** Solo SaaS founder. Needs to translate an idea or problem into clear requirements before implementation.
- **Secondary persona:** Small SaaS agency or product consultant. Needs to convert client briefs and available evidence into structured discovery outputs, PRDs, and development-ready requirements.

*Note: The MVP will support the primary workflow through a single authorized account. Multi-user collaboration, client workspaces, and team permissions are not part of the initial release.*

## 5. Product Goals
- Reduce manual effort required to structure product discovery.
- Surface critical information gaps before requirements are finalized.
- Make assumptions explicit and track their validation status.
- Preserve traceability from source evidence to requirements and deliverables.
- Generate consistent, editable product documentation.
- Identify gaps in requirement coverage before development begins.

**Success metrics (Initial Release):**
- Time from project creation to first PRD draft.
- Percentage of generated requirements with valid source references or explicit assumption flags.
- Number of critical gaps identified and resolved.
- Percentage of requirements with linked acceptance criteria.
- Percentage of projects passing the product readiness review.
*(Numerical targets will be established after a baseline is collected.)*

## 6. MVP Scope

**P0: Initial release**
1. Project creation and management.
2. Business brief intake through pasted text and supported file uploads.
3. Source storage, text extraction, chunking, and embeddings.
4. Structured analysis of assumptions, gaps, and contradictions.
5. Guided clarification workflow.
6. Requirement generation with validated source relationships.
7. PRD generation.
8. Basic traceability and readiness review.
9. Markdown export.

**P1: After the core workflow is reliable**
- Research plan generation, User interview and survey plans, Competitive research.
- User stories and acceptance criteria, Edge-case catalog, Success metrics specification.
- Traceability matrix, Source-change impact and stale-artifact management.

**P2: Future enhancements**
- Multi-user collaboration, Client-specific workspaces, Notion and Linear integrations.
- Advanced competitor monitoring, Additional AI providers, Advanced research evidence ingestion.

*Scope decision: Build through the core intake, analysis, clarification, requirements, and PRD workflow first. Do not implement every deliverable before the central evidence-to-requirement pipeline is reliable.*

## 7. Core Functional Requirements

- **FR-001: Project management:** The user must be able to create, view, rename, and archive projects. Each project must have a stable identifier, name, description, timestamps, and owner. Projects must be isolated from unauthorized access at both application and database levels.
- **FR-002: Source intake:** The user must be able to paste a business brief and upload supported documents. The system must store the original source, extract text, track processing status, split text into chunks, generate embeddings, preserve identifiers, report failures, and prevent failed processing from reporting as successful. Unsupported files must produce an actionable error.
- **FR-003: Discovery analysis:** The system must analyze sources and return structured findings (Assumptions, Information gaps, Contradictions, Evidence-backed observations, Recommended clarification questions). Findings need identifiers, descriptions, categories, severity/confidence, status, and validated source references. **AI must not invent source references.**
- **FR-004: Guided clarification:** Show open questions prioritized by importance. User can answer, edit, and mark resolved. Answers persist as new evidence linked to the question. Resolving a question does not automatically validate an assumption unless criteria are met.
- **FR-005: Requirement generation:** Generate requirements from approved evidence and labeled assumptions. Include ID, description, type, priority, status, valid source/assumption references, business rules, acceptance criteria status, and review status.
- **FR-006: PRD generation:** Generate an editable PRD containing executive summary, problem statement, goals/non-goals, target users, MVP scope, functional requirements, user journeys, business rules/edge cases, data/integration reqs, non-functional reqs, metrics, acceptance criteria, and assumptions. Retain links to requirements/sources.
- **FR-007: Traceability:** Support relationships (e.g., requirement derived from source, requirement depends on assumption, etc.). Store as structured database records, not just text inside documents.
- **FR-008: Readiness review:** Identify requirements without evidence, unresolved gaps, contradictions, missing criteria, stale deliverables, and broken links. Calculate score from stored data, not AI opinion.
- **FR-009: Document editing and export:** Rich-text editing that preserves saved content, artifact versions, and database relationships. Markdown export preserving formatting.
- **FR-010: Generation reliability:** Long-running workflows must support processing status, retry handling, duplicate prevention, failure reporting, step-level execution records, and safe recovery.

## 8. Key User Journey
1. Create a project.
2. Paste a client brief or upload source documents.
3. Wait for ingestion and analysis to complete.
4. Review assumptions, gaps, and contradictions.
5. Answer the highest-priority clarification questions.
6. Generate and review requirements.
7. Generate the PRD.
8. Inspect unresolved issues and source traceability.
9. Edit the document and export it.

## 9. Non-Functional Requirements
- Protect project data through server-side authorization and database access controls.
- Validate all AI-generated structured data before persistence.
- Protect secrets and AI provider credentials.
- Handle rate limits, timeouts, and provider failures.
- Preserve source and artifact version history.
- Support accessible, responsive interfaces.
- Log workflow failures without exposing sensitive source content.
- Use database migrations for schema changes.
- Maintain automated tests for business logic, permissions, and traceability.

## 10. MVP Acceptance Criteria
1. User can create a project and ingest a supported brief.
2. System persists original sources and successfully processed chunks.
3. Analysis produces validated, structured assumptions and gaps.
4. Invalid source references are rejected before database persistence.
5. Clarification answers are stored and linked to the appropriate questions.
6. Generated requirements have valid traceability records or explicit flags.
7. The PRD can be generated, edited, saved, and exported.
8. Readiness review identifies missing relationships and unresolved gaps.
9. Unauthorized requests cannot access or modify project data.
10. Automated tests verify main workflow and failure paths.

## 11. Explicit Non-Goals
The MVP is **not** intended to be:
- An autonomous product manager making unreviewed decisions.
- A replacement for primary user research.
- A multi-tenant agency platform at launch.
- A fully automated deployment or coding agent.

## 12. Key Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| **Hallucinated evidence links** | Validate every referenced ID against persisted records. |
| **Incorrect conclusions** | Distinguish evidence, inference, and assumptions. |
| **Document drift** | Version artifacts and track source dependencies. |
| **Long-running generation failures** | Use durable workflow steps and idempotent persistence. |
| **Scope expansion** | Release the core workflow before advanced deliverables. |
| **Unauthorized access** | Enforce authorization server-side and with database policies. |

## 13. Open Decisions
- Exact file formats supported at launch.
- Embedding model and dimensions.
- Definition and weighting of readiness score.
- Competitive research inclusion in initial release.
- Versioning behavior for edited artifacts.
- Retention/deletion policies for uploaded sources.

---

# Architecture Specification

| Layer | Selected Approach | Architectural Requirement |
| :--- | :--- | :--- |
| **Application** | Next.js with TypeScript | Follow the existing starter conventions |
| **Hosting** | Vercel | Separate deployment config from app logic |
| **Authentication**| Supabase Auth with Google | Restrict access to configured owner account |
| **Database** | Supabase PostgreSQL | Migrations, constraints, and RLS |
| **AI Orchestration**| Vercel AI SDK with OpenRouter| Structured outputs and validated persistence |
| **Editor** | BlockNote | Store editor-compatible content, support MD export |
| **Evidence Retrieval**| Supabase pgvector | Persist chunk IDs and embedding metadata |
| **External Research**| Claude web search or Exa/Tavily| Keep research claims separate from verified evidence |
| **Background Workflows**| Inngest | Retries, idempotency, execution status, recoverable steps |
| **Version Control** | GitHub | Commit changes in small, reviewable units |

## Core Data Model
- **`projects`**: Owner (`owner_id`), metadata, lifecycle.
- **`sources`**: Original briefs, notes, uploads, answers. Includes `processing_status` and `version`.
- **`chunks`**: Extracted text, embeddings. Includes `source_id` and a stable chunk identifier.
- **`assumptions`**: Validation status (`status`), plus evidence supporting validation or invalidation.
- **`gaps`**: Questions, `severity`, `status`, and `resolution_source_id` where applicable.
- **`requirements`**: Priorities, `evidence_status`, and a review status.
- **`artifacts`**: PRDs, stories, plans. Includes `version`, `status`, and `generated_from_version`.
- **`links`**: Traceability relationships. Includes `relation` and creation metadata. *(Note: Must validate endpoints and permitted types application-side before insert).*
- **`runs`**: Workflow status, model, input/output references, `idempotency_key`, and error details.

---

# Security Decisions to Make Explicit
1. **Single-user authentication:** Middleware should protect application routes, but it must not be the only authorization control. Verify identity and ownership in server-side operations and enforce database policies. Pre-provision the authorized Google account.
2. **Supabase RLS:** Use the authenticated user's identity (`auth.uid()`) to enforce ownership. Protect service-role credentials on the server only. Verify anonymous sessions cannot read/write project data.

---

# Cursor Implementation Plan & Next Steps

**1. Foundation and authentication**
Set up the starter, environment variables, Google sign-in, authorized-account restriction, GitHub repository, and Vercel deployment. Verify both authorized and unauthorized access.

**2. Database schema and migrations**
Create the core tables, relationships, constraints, RLS policies, and test fixtures. Verify project isolation before adding AI generation.

**3. Source intake**
Implement brief submission, file storage, extraction, chunking, embeddings, and ingestion status tracking.

**4. Analyze workflow**
Define Zod schemas for assumptions, gaps, contradictions, and evidence references. Generate structured output and validate references before persisting results.

**5. Gaps board and clarification**
Display unresolved questions, collect answers, and save those answers as linked sources.

**6. Requirements and PRD**
Generate requirements from the approved evidence, maintain traceability, and create an editable PRD.

**7. Review and export**
Add the initial readiness checks, missing-evidence report, artifact status, and Markdown export.

### The Immediate First Task for Cursor
*(Do not build the whole app. Feed this to Cursor first):*
"Inspect the starter repository and existing Supabase configuration. Propose migrations for the core data model defined in `PRD.md`. Define Zod schemas and TypeScript types for analysis outputs. Add protections to validate every evidence reference against actual source IDs. Stop after the schema and Analyze workflow are implemented and verified, leaving the UI for later."