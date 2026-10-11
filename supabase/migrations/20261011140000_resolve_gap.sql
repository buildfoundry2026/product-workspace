-- =============================================================================
-- FR-004 Guided clarification: resolve a gap with a user answer, atomically.
--
-- In one transaction:
--   1. inserts the answer as a new `clarification_answer` source (new evidence),
--   2. marks the gap 'resolved' and points resolution_source_id at that source,
--   3. records a traceability link: source --answers--> gap.
--
-- SECURITY INVOKER, so every read/write goes through the owner RLS policies;
-- an unauthorized caller simply cannot see the gap. The gap row is locked
-- FOR UPDATE so concurrent submissions cannot both resolve it.
--
-- The source is inserted as 'processing'; the application chunks and embeds
-- it afterwards and moves it to 'completed' or 'failed'.
-- =============================================================================

create or replace function public.resolve_gap(p_gap_id uuid, p_answer text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gap       public.gaps%rowtype;
  v_source_id uuid;
begin
  if p_answer is null or char_length(btrim(p_answer, E' \t\n\r')) = 0 then
    raise exception 'An answer is required.' using errcode = '22023';
  end if;
  if char_length(p_answer) > 20000 then
    raise exception 'Answers must be 20,000 characters or fewer.' using errcode = '22023';
  end if;

  select * into v_gap from public.gaps where id = p_gap_id for update;
  if not found then
    raise exception 'Gap not found.' using errcode = 'P0002';
  end if;
  if v_gap.status not in ('open', 'answered') then
    raise exception 'This gap is already %.', v_gap.status using errcode = '55000';
  end if;
  if exists (
    select 1 from public.projects p
    where p.id = v_gap.project_id and p.status = 'archived'
  ) then
    raise exception 'Gaps in archived projects cannot be resolved.' using errcode = '55000';
  end if;

  insert into public.sources (
    project_id, owner_id, kind, title, content, content_hash,
    mime_type, processing_status, metadata
  )
  values (
    v_gap.project_id,
    v_gap.owner_id,
    'clarification_answer',
    left('Answer: ' || btrim(v_gap.question), 300),
    p_answer,
    encode(sha256(convert_to(p_answer, 'UTF8')), 'hex'),
    'text/plain',
    'processing',
    jsonb_build_object('gap_id', v_gap.id)
  )
  returning id into v_source_id;

  update public.gaps
  set status = 'resolved',
      resolution_source_id = v_source_id,
      resolved_at = now()
  where id = v_gap.id;

  insert into public.links (
    project_id, owner_id, from_type, from_id, to_type, to_id, relation, created_by
  )
  values (
    v_gap.project_id, v_gap.owner_id, 'source', v_source_id, 'gap', v_gap.id, 'answers', 'user'
  );

  return jsonb_build_object(
    'gap_id', v_gap.id,
    'source_id', v_source_id,
    'project_id', v_gap.project_id
  );
end;
$$;

revoke all on function public.resolve_gap(uuid, text) from public, anon;
grant execute on function public.resolve_gap(uuid, text) to authenticated;
