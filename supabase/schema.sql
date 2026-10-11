-- =============================================================================
-- AI-Powered Product Discovery & Specification Workspace
-- Core schema: projects, sources, chunks, assumptions, gaps, requirements,
--              artifacts, links, runs
--
-- Security model (PRD "Security Decisions"):
--   * Single authorized owner: a pre-provisioned Google account whose email is
--     stored in app_private.authorized_owner. Every RLS policy requires BOTH
--       1. the row's owner_id = auth.uid(), and
--       2. the caller is that authorized Google account.
--   * Anonymous sessions have no policies and no table privileges.
--   * service_role (server only, Inngest workflows) bypasses RLS and must set
--     owner_id explicitly; owner_id is NOT NULL so a missing owner fails loudly.
--
-- Integrity model (PRD "Evidence Integrity"):
--   * Every child row carries (project_id, owner_id) with a composite FK to
--     projects, so rows cannot point at another owner's project.
--   * Cross-table references inside a project use composite FKs on
--     (id, project_id), so evidence cannot cross project boundaries.
--   * links endpoints are polymorphic; a trigger verifies each endpoint exists
--     in the same project before insert/update.
--
-- Embedding dimension: 1024 (Voyage AI voyage-3 family). The PRD lists the
-- embedding model as an open decision; change vector(1024) in chunks and
-- match_chunks together if a different model is chosen.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- -----------------------------------------------------------------------------
-- Private schema (not exposed through the Data API)
-- -----------------------------------------------------------------------------
create schema if not exists app_private;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

-- Singleton holding the one Google account allowed to use the app.
create table app_private.authorized_owner (
  singleton  boolean primary key default true check (singleton),
  email      text not null check (email = lower(btrim(email)) and email like '%@%'),
  created_at timestamptz not null default now()
);

revoke all on table app_private.authorized_owner from public, anon, authenticated;
grant select, insert, update, delete on table app_private.authorized_owner to service_role;

-- True only for the authenticated, email-confirmed, Google-linked owner account.
create or replace function app_private.is_authorized_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join app_private.authorized_owner o on lower(u.email) = o.email
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
  );
$$;

revoke all on function app_private.is_authorized_owner() from public, anon;
grant execute on function app_private.is_authorized_owner() to authenticated, service_role;

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.set_updated_at() from public, anon;

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  description text,
  status      text not null default 'active' check (status in ('active', 'archived')),
  metadata    jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Target for composite FKs that pin child rows to the project's owner.
  unique (id, owner_id),
  check ((status = 'archived') = (archived_at is not null))
);

create index projects_owner_id_idx on public.projects (owner_id);

-- -----------------------------------------------------------------------------
-- runs (workflow executions; created first so other tables can reference them)
-- -----------------------------------------------------------------------------
create table public.runs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null,
  owner_id        uuid not null default auth.uid(),
  parent_run_id   uuid,
  workflow        text not null check (workflow in (
                    'ingest_source', 'analyze', 'generate_requirements',
                    'generate_prd', 'generate_artifact', 'readiness_review',
                    'research'
                  )),
  step_name       text,
  status          text not null default 'queued' check (status in (
                    'queued', 'running', 'succeeded', 'failed', 'cancelled'
                  )),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 300),
  model           text,
  inngest_event_id text,
  inngest_run_id   text,
  attempt         integer not null default 1 check (attempt >= 1),
  input_refs      jsonb not null default '{}'::jsonb,
  output_refs     jsonb not null default '{}'::jsonb,
  error_code      text,
  error_message   text,
  error_details   jsonb,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, project_id),
  unique (owner_id, idempotency_key),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (parent_run_id, project_id)
    references public.runs (id, project_id) on delete cascade,
  check (status <> 'failed' or error_message is not null),
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create index runs_project_id_idx on public.runs (project_id, created_at desc);
create index runs_parent_run_id_idx on public.runs (parent_run_id) where parent_run_id is not null;
create index runs_active_idx on public.runs (project_id, status) where status in ('queued', 'running');

-- -----------------------------------------------------------------------------
-- sources (briefs, notes, uploads, clarification answers, research)
-- -----------------------------------------------------------------------------
create table public.sources (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null,
  owner_id            uuid not null default auth.uid(),
  kind                text not null check (kind in (
                        'brief', 'note', 'upload', 'clarification_answer', 'research'
                      )),
  title               text not null check (char_length(btrim(title)) between 1 and 300),
  content             text,
  storage_path        text,
  mime_type           text,
  file_size_bytes     bigint check (file_size_bytes is null or file_size_bytes >= 0),
  content_hash        text,
  lineage_id          uuid not null default gen_random_uuid(),
  version             integer not null default 1 check (version >= 1),
  previous_version_id uuid,
  processing_status   text not null default 'pending' check (processing_status in (
                        'pending', 'processing', 'completed', 'failed'
                      )),
  processing_error    text,
  processed_at        timestamptz,
  created_by_run_id   uuid,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, project_id),
  unique (lineage_id, version),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (previous_version_id, project_id)
    references public.sources (id, project_id) on delete set null (previous_version_id),
  foreign key (created_by_run_id, project_id)
    references public.runs (id, project_id) on delete set null (created_by_run_id),
  -- A source must carry either inline text or an uploaded file.
  check (content is not null or storage_path is not null),
  check (kind <> 'upload' or storage_path is not null),
  -- Failed processing must never look successful.
  check (processing_status <> 'failed' or processing_error is not null),
  check (processing_status <> 'completed' or processed_at is not null)
);

create index sources_project_id_idx on public.sources (project_id, created_at desc);
create index sources_processing_idx on public.sources (project_id, processing_status);
create index sources_previous_version_idx on public.sources (previous_version_id) where previous_version_id is not null;
create index sources_created_by_run_idx on public.sources (created_by_run_id) where created_by_run_id is not null;

-- -----------------------------------------------------------------------------
-- chunks (extracted text + embeddings)
-- -----------------------------------------------------------------------------
create table public.chunks (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null,
  project_id      uuid not null,
  owner_id        uuid not null default auth.uid(),
  -- Stable identifier within a source: (source_id, chunk_index).
  chunk_index     integer not null check (chunk_index >= 0),
  content         text not null check (char_length(content) > 0),
  content_hash    text not null,
  token_count     integer check (token_count is null or token_count >= 0),
  char_start      integer check (char_start is null or char_start >= 0),
  char_end        integer,
  embedding       extensions.vector(1024),
  embedding_model text,
  embedded_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (source_id, chunk_index),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (source_id, project_id)
    references public.sources (id, project_id) on delete cascade,
  check (char_end is null or char_start is null or char_end >= char_start),
  check ((embedding is null) = (embedding_model is null))
);

create index chunks_project_id_idx on public.chunks (project_id);
create index chunks_embedding_hnsw_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- assumptions
-- -----------------------------------------------------------------------------
create table public.assumptions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  owner_id          uuid not null default auth.uid(),
  statement         text not null check (char_length(btrim(statement)) > 0),
  category          text,
  severity          text not null default 'medium' check (severity in ('critical', 'high', 'medium', 'low')),
  confidence        numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  status            text not null default 'unvalidated' check (status in (
                      'unvalidated', 'validated', 'invalidated', 'needs_review'
                    )),
  validation_notes  text,
  status_changed_at timestamptz,
  created_by        text not null default 'user' check (created_by in ('user', 'ai', 'system')),
  created_by_run_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, project_id),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (created_by_run_id, project_id)
    references public.runs (id, project_id) on delete set null (created_by_run_id),
  -- Validation/invalidation must be justified; supporting evidence lives in links.
  check (status not in ('validated', 'invalidated') or validation_notes is not null)
);

create index assumptions_project_id_idx on public.assumptions (project_id, status);
create index assumptions_created_by_run_idx on public.assumptions (created_by_run_id) where created_by_run_id is not null;

-- -----------------------------------------------------------------------------
-- gaps (information gaps, contradictions, clarification questions)
-- -----------------------------------------------------------------------------
create table public.gaps (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null,
  owner_id             uuid not null default auth.uid(),
  gap_type             text not null default 'information_gap' check (gap_type in (
                         'information_gap', 'contradiction', 'clarification_question'
                       )),
  question             text not null check (char_length(btrim(question)) > 0),
  description          text,
  category             text,
  severity             text not null default 'medium' check (severity in ('critical', 'high', 'medium', 'low')),
  priority             integer not null default 0,
  status               text not null default 'open' check (status in (
                         'open', 'answered', 'resolved', 'dismissed'
                       )),
  resolution_source_id uuid,
  resolution_notes     text,
  resolved_at          timestamptz,
  created_by           text not null default 'user' check (created_by in ('user', 'ai', 'system')),
  created_by_run_id    uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, project_id),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (resolution_source_id, project_id)
    references public.sources (id, project_id) on delete set null (resolution_source_id),
  foreign key (created_by_run_id, project_id)
    references public.runs (id, project_id) on delete set null (created_by_run_id),
  check (status <> 'answered' or resolution_source_id is not null),
  check ((status = 'resolved') = (resolved_at is not null))
);

create index gaps_project_id_idx on public.gaps (project_id, status, severity);
create index gaps_resolution_source_idx on public.gaps (resolution_source_id) where resolution_source_id is not null;
create index gaps_created_by_run_idx on public.gaps (created_by_run_id) where created_by_run_id is not null;

-- -----------------------------------------------------------------------------
-- requirements
-- -----------------------------------------------------------------------------
create table public.requirements (
  id                         uuid primary key default gen_random_uuid(),
  project_id                 uuid not null,
  owner_id                   uuid not null default auth.uid(),
  ref_code                   text not null check (ref_code ~ '^[A-Z]{2,5}-[0-9]{3,}$'),
  title                      text not null check (char_length(btrim(title)) > 0),
  description                text not null,
  requirement_type           text not null default 'functional' check (requirement_type in (
                               'functional', 'non_functional', 'business_rule',
                               'data', 'integration'
                             )),
  priority                   text not null default 'P1' check (priority in ('P0', 'P1', 'P2')),
  status                     text not null default 'draft' check (status in (
                               'draft', 'approved', 'deprecated'
                             )),
  evidence_status            text not null default 'unsupported' check (evidence_status in (
                               'evidence_backed', 'assumption_based', 'unsupported'
                             )),
  review_status              text not null default 'pending' check (review_status in (
                               'pending', 'approved', 'changes_requested', 'rejected'
                             )),
  acceptance_criteria_status text not null default 'missing' check (acceptance_criteria_status in (
                               'missing', 'draft', 'complete'
                             )),
  business_rules             jsonb not null default '[]'::jsonb check (jsonb_typeof(business_rules) = 'array'),
  acceptance_criteria        jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  created_by                 text not null default 'user' check (created_by in ('user', 'ai', 'system')),
  created_by_run_id          uuid,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, ref_code),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (created_by_run_id, project_id)
    references public.runs (id, project_id) on delete set null (created_by_run_id)
);

create index requirements_project_id_idx on public.requirements (project_id, status);
create index requirements_created_by_run_idx on public.requirements (created_by_run_id) where created_by_run_id is not null;

-- -----------------------------------------------------------------------------
-- artifacts (PRDs, stories, plans) — versioned per lineage
-- -----------------------------------------------------------------------------
create table public.artifacts (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null,
  owner_id               uuid not null default auth.uid(),
  artifact_type          text not null check (artifact_type in (
                           'prd', 'user_stories', 'research_plan', 'interview_plan',
                           'survey_plan', 'competitive_research', 'edge_cases',
                           'metrics_spec', 'traceability_matrix'
                         )),
  title                  text not null check (char_length(btrim(title)) between 1 and 300),
  -- BlockNote document JSON; content_markdown is the export cache.
  content                jsonb not null default '[]'::jsonb,
  content_markdown       text,
  lineage_id             uuid not null default gen_random_uuid(),
  version                integer not null default 1 check (version >= 1),
  previous_version_id    uuid,
  status                 text not null default 'draft' check (status in (
                           'draft', 'in_review', 'approved', 'stale', 'archived'
                         )),
  -- Snapshot of the input versions used to generate this artifact, e.g.
  -- {"sources": {"<source_id>": 2}, "requirements": ["<id>", ...]}.
  generated_from_version jsonb not null default '{}'::jsonb check (jsonb_typeof(generated_from_version) = 'object'),
  created_by             text not null default 'user' check (created_by in ('user', 'ai', 'system')),
  created_by_run_id      uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, project_id),
  unique (lineage_id, version),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (previous_version_id, project_id)
    references public.artifacts (id, project_id) on delete set null (previous_version_id),
  foreign key (created_by_run_id, project_id)
    references public.runs (id, project_id) on delete set null (created_by_run_id)
);

create index artifacts_project_id_idx on public.artifacts (project_id, artifact_type, status);
create index artifacts_previous_version_idx on public.artifacts (previous_version_id) where previous_version_id is not null;
create index artifacts_created_by_run_idx on public.artifacts (created_by_run_id) where created_by_run_id is not null;

-- -----------------------------------------------------------------------------
-- links (traceability graph)
-- Permitted (from_type, relation, to_type) combinations are validated in the
-- application; the database guarantees types are known and endpoints exist in
-- the same project.
-- -----------------------------------------------------------------------------
create table public.links (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null,
  owner_id          uuid not null default auth.uid(),
  from_type         text not null check (from_type in (
                      'source', 'chunk', 'assumption', 'gap', 'requirement', 'artifact'
                    )),
  from_id           uuid not null,
  to_type           text not null check (to_type in (
                      'source', 'chunk', 'assumption', 'gap', 'requirement', 'artifact'
                    )),
  to_id             uuid not null,
  relation          text not null check (relation in (
                      'derived_from', 'supported_by', 'contradicted_by', 'depends_on',
                      'validates', 'invalidates', 'answers', 'resolves',
                      'covered_by', 'references'
                    )),
  rationale         text,
  confidence        numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  created_by        text not null default 'user' check (created_by in ('user', 'ai', 'system')),
  created_by_run_id uuid,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (from_type, from_id, relation, to_type, to_id),
  foreign key (project_id, owner_id)
    references public.projects (id, owner_id) on delete cascade,
  foreign key (created_by_run_id, project_id)
    references public.runs (id, project_id) on delete set null (created_by_run_id),
  check (not (from_type = to_type and from_id = to_id))
);

create index links_project_id_idx on public.links (project_id);
create index links_from_idx on public.links (from_type, from_id);
create index links_to_idx on public.links (to_type, to_id);
create index links_created_by_run_idx on public.links (created_by_run_id) where created_by_run_id is not null;

-- SECURITY INVOKER: endpoint lookups go through RLS for authenticated callers.
create or replace function app_private.link_endpoint_exists(
  p_type text,
  p_id uuid,
  p_project_id uuid
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  case p_type
    when 'source' then
      return exists (select 1 from public.sources where id = p_id and project_id = p_project_id);
    when 'chunk' then
      return exists (select 1 from public.chunks where id = p_id and project_id = p_project_id);
    when 'assumption' then
      return exists (select 1 from public.assumptions where id = p_id and project_id = p_project_id);
    when 'gap' then
      return exists (select 1 from public.gaps where id = p_id and project_id = p_project_id);
    when 'requirement' then
      return exists (select 1 from public.requirements where id = p_id and project_id = p_project_id);
    when 'artifact' then
      return exists (select 1 from public.artifacts where id = p_id and project_id = p_project_id);
    else
      return false;
  end case;
end;
$$;

revoke all on function app_private.link_endpoint_exists(text, uuid, uuid) from public, anon;
grant execute on function app_private.link_endpoint_exists(text, uuid, uuid) to authenticated, service_role;

create or replace function app_private.validate_link_endpoints()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app_private.link_endpoint_exists(new.from_type, new.from_id, new.project_id) then
    raise exception 'links: % % does not exist in project %',
      new.from_type, new.from_id, new.project_id
      using errcode = 'foreign_key_violation';
  end if;

  if not app_private.link_endpoint_exists(new.to_type, new.to_id, new.project_id) then
    raise exception 'links: % % does not exist in project %',
      new.to_type, new.to_id, new.project_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

revoke all on function app_private.validate_link_endpoints() from public, anon;

create trigger links_validate_endpoints
  before insert or update of project_id, from_type, from_id, to_type, to_id
  on public.links
  for each row execute function app_private.validate_link_endpoints();

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create trigger projects_set_updated_at     before update on public.projects     for each row execute function app_private.set_updated_at();
create trigger runs_set_updated_at         before update on public.runs         for each row execute function app_private.set_updated_at();
create trigger sources_set_updated_at      before update on public.sources      for each row execute function app_private.set_updated_at();
create trigger assumptions_set_updated_at  before update on public.assumptions  for each row execute function app_private.set_updated_at();
create trigger gaps_set_updated_at         before update on public.gaps         for each row execute function app_private.set_updated_at();
create trigger requirements_set_updated_at before update on public.requirements for each row execute function app_private.set_updated_at();
create trigger artifacts_set_updated_at    before update on public.artifacts    for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Semantic search over chunks (SECURITY INVOKER, so RLS applies)
-- -----------------------------------------------------------------------------
create or replace function public.match_chunks(
  p_project_id      uuid,
  p_query_embedding extensions.vector(1024),
  p_match_count     integer default 10,
  p_min_similarity  double precision default 0
)
returns table (
  id          uuid,
  source_id   uuid,
  chunk_index integer,
  content     text,
  similarity  double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.source_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity
  from public.chunks c
  where c.project_id = p_project_id
    and c.embedding is not null
    and 1 - (c.embedding operator(extensions.<=>) p_query_embedding) >= p_min_similarity
  order by c.embedding operator(extensions.<=>) p_query_embedding
  limit least(greatest(p_match_count, 1), 50);
$$;

revoke all on function public.match_chunks(uuid, extensions.vector, integer, double precision) from public, anon;
grant execute on function public.match_chunks(uuid, extensions.vector, integer, double precision) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges: no anonymous access at all; authenticated access is gated by RLS.
-- -----------------------------------------------------------------------------
revoke all on table
  public.projects, public.runs, public.sources, public.chunks,
  public.assumptions, public.gaps, public.requirements,
  public.artifacts, public.links
from anon;

grant select, insert, update, delete on table
  public.projects, public.runs, public.sources, public.chunks,
  public.assumptions, public.gaps, public.requirements,
  public.artifacts, public.links
to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- Every policy: row belongs to the caller AND the caller is the authorized
-- Google account. (select ...) wrappers let Postgres evaluate once per query.
-- -----------------------------------------------------------------------------
alter table public.projects     enable row level security;
alter table public.runs         enable row level security;
alter table public.sources      enable row level security;
alter table public.chunks       enable row level security;
alter table public.assumptions  enable row level security;
alter table public.gaps         enable row level security;
alter table public.requirements enable row level security;
alter table public.artifacts    enable row level security;
alter table public.links        enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'runs', 'sources', 'chunks', 'assumptions',
    'gaps', 'requirements', 'artifacts', 'links'
  ]
  loop
    execute format(
      'create policy "owner can select %1$s" on public.%1$I for select to authenticated
         using (owner_id = (select auth.uid()) and (select app_private.is_authorized_owner()))',
      t);
    execute format(
      'create policy "owner can insert %1$s" on public.%1$I for insert to authenticated
         with check (owner_id = (select auth.uid()) and (select app_private.is_authorized_owner()))',
      t);
    execute format(
      'create policy "owner can update %1$s" on public.%1$I for update to authenticated
         using (owner_id = (select auth.uid()) and (select app_private.is_authorized_owner()))
         with check (owner_id = (select auth.uid()) and (select app_private.is_authorized_owner()))',
      t);
    execute format(
      'create policy "owner can delete %1$s" on public.%1$I for delete to authenticated
         using (owner_id = (select auth.uid()) and (select app_private.is_authorized_owner()))',
      t);
  end loop;
end;
$$;

commit;

-- =============================================================================
-- Post-install: pre-provision the authorized Google account (run once, as an
-- admin in the SQL editor). Must match AUTHORIZED_OWNER_EMAIL in .env.local.
--
--   insert into app_private.authorized_owner (email)
--   values (lower('owner@example.com'))
--   on conflict (singleton) do update set email = excluded.email;
-- =============================================================================
