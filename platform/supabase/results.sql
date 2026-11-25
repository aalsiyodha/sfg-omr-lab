-- Apply after schema.sql. This introduces institute-scoped candidates and grading.
-- Candidate names / identifying data should only be collected where necessary,
-- with institute authority and a published retention/privacy policy.
create table if not exists public.candidates (
 id uuid primary key default gen_random_uuid(),
 institute_id uuid not null references public.institutes(id) on delete cascade,
 candidate_code text not null check(length(trim(candidate_code)) between 1 and 80),
 display_name text not null check(length(trim(display_name)) between 1 and 120),
 created_at timestamptz not null default now(),
 unique(institute_id,candidate_code),
 unique(id,institute_id)
);
create table if not exists public.scan_submissions (
 id uuid primary key default gen_random_uuid(),
 institute_id uuid not null,
 test_id uuid not null references public.tests(id) on delete cascade,
 candidate_id uuid not null,
 sheet_student_id text,
 scan_engine_version text not null,
 qr_verified boolean not null default false,
 timing_matched integer not null check(timing_matched between 0 and 50),
 reviewer_id uuid not null references auth.users(id),
 reviewed_at timestamptz not null default now(),
 answers jsonb not null,
 answer_statuses jsonb not null,
 created_at timestamptz not null default now(),
 unique(id,institute_id),
 foreign key(candidate_id,institute_id)
   references public.candidates(id,institute_id) on delete cascade
);
create index if not exists submissions_test on public.scan_submissions(test_id,institute_id);
create index if not exists submissions_candidate on public.scan_submissions(candidate_id,created_at desc);
create table if not exists public.scored_attempts (
 id uuid primary key default gen_random_uuid(),
 institute_id uuid not null,
 submission_id uuid not null unique,
 test_id uuid not null references public.tests(id) on delete cascade,
 candidate_id uuid not null,
 correct_count integer not null check(correct_count between 0 and 50),
 incorrect_count integer not null check(incorrect_count between 0 and 50),
 blank_count integer not null check(blank_count between 0 and 50),
 cancelled_count integer not null check(cancelled_count between 0 and 50),
 multiple_count integer not null check(multiple_count between 0 and 50),
 total_score numeric(10,3) not null,
 scored_at timestamptz not null default now(),
 foreign key(submission_id,institute_id) references public.scan_submissions(id,institute_id) on delete cascade,
 foreign key(candidate_id,institute_id) references public.candidates(id,institute_id) on delete cascade
);
create index if not exists scores_by_test on public.scored_attempts(test_id,institute_id,total_score desc,scored_at asc);
alter table public.candidates enable row level security;
alter table public.scan_submissions enable row level security;
alter table public.scored_attempts enable row level security;

create policy "members read candidates" on public.candidates
 for select to authenticated using(public.is_institute_member(institute_id));
create policy "admins add candidates" on public.candidates
 for insert to authenticated with check(public.can_manage_institute(institute_id));
create policy "members read submissions" on public.scan_submissions
 for select to authenticated using(public.is_institute_member(institute_id));
create policy "members read scores" on public.scored_attempts
 for select to authenticated using(public.is_institute_member(institute_id));

-- Only a verified, reviewed submission can be stored.
create or replace function public.require_verified_submission()
returns trigger language plpgsql set search_path='' as $$
declare owner_org uuid; expected_test integer; state text;
begin
 select t.institute_id,t.sheet_test_number,t.status
   into owner_org,expected_test,state from public.tests t where t.id=new.test_id;
 if owner_org is distinct from new.institute_id or state <> 'published' then
   raise exception 'Published test in the same institute required';
 end if;
 if not new.qr_verified or new.timing_matched<>50 then
   raise exception 'QR identity and all 50 timing marks required';
 end if;
 if new.reviewer_id is distinct from auth.uid() then
   raise exception 'Reviewer must be the current authenticated user';
 end if;
 if jsonb_typeof(new.answers)<>'array' or jsonb_array_length(new.answers)<>50
    or jsonb_typeof(new.answer_statuses)<>'array'
    or jsonb_array_length(new.answer_statuses)<>50 then
   raise exception 'Exactly 50 answers and 50 statuses required';
 end if;
 if exists(select 1 from jsonb_array_elements_text(new.answer_statuses) v
   where v.value not in ('detected','blank','multiple','manual')) then
   raise exception 'Unreviewed or invalid answer status';
 end if;
 if exists(select 1 from jsonb_array_elements(new.answers) a
   where a.value not in ('null'::jsonb,'"A"'::jsonb,'"B"'::jsonb,
     '"C"'::jsonb,'"D"'::jsonb,'"X"'::jsonb)) then
   raise exception 'Invalid recorded answer';
 end if;
 return new;
end; $$;
create trigger validate_scan before insert on public.scan_submissions
  for each row execute function public.require_verified_submission();

-- A single, auditable DB transaction calculates the score from the published
-- answer key. Do not trust client-supplied totals or leaderboard positions.
create or replace function public.submit_reviewed_scan(
 org_id uuid, exam_id uuid, person_id uuid, raw_answers jsonb,
 raw_statuses jsonb, engine_version text, qr_ok boolean, timing_count int,
 sheet_id text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare key jsonb; correct_mark numeric; wrong_mark numeric;
        sub_id uuid; current_test public.tests%rowtype;
        a text; k text; st text; i int; correct_n int:=0;
        wrong_n int:=0; blank_n int:=0; cancelled_n int:=0; multi_n int:=0;
        final_score numeric:=0;
begin
 if auth.uid() is null or not public.can_manage_institute(org_id) then
   raise exception 'Institute owner/admin authorization required';
 end if;
 select * into current_test from public.tests
  where id=exam_id and institute_id=org_id and status='published' for share;
 if not found then raise exception 'Published test not found'; end if;
 if not qr_ok or timing_count<>50 then raise exception 'Unverified sheet'; end if;
 if jsonb_typeof(raw_answers)<>'array' or jsonb_array_length(raw_answers)<>50 or
   jsonb_typeof(raw_statuses)<>'array' or jsonb_array_length(raw_statuses)<>50 then
   raise exception 'Exactly 50 answers/statuses required';
 end if;
 if not exists(select 1 from public.candidates where id=person_id and institute_id=org_id)
 then raise exception 'Candidate not in institute'; end if;
 for i in 0..49 loop
   a:=raw_answers->>i; st:=raw_statuses->>i; k:=current_test.answer_key->>i;
   if st not in ('detected','blank','multiple','manual') then
     raise exception 'Unreviewed answer'; end if;
   if a is not null and a not in ('A','B','C','D','X') then
     raise exception 'Invalid answer'; end if;
   if k='X' then cancelled_n:=cancelled_n+1;
   elsif st='multiple' then multi_n:=multi_n+1; wrong_n:=wrong_n+1;
   elsif a is null or a='X' then blank_n:=blank_n+1;
   elsif a=k then correct_n:=correct_n+1;
   else wrong_n:=wrong_n+1;
   end if;
 end loop;
 final_score:=correct_n*current_test.correct_marks+wrong_n*current_test.wrong_marks;
 insert into public.scan_submissions(institute_id,test_id,candidate_id,
   sheet_student_id,scan_engine_version,qr_verified,timing_matched,reviewer_id,
   answers,answer_statuses)
 values(org_id,exam_id,person_id,sheet_id,engine_version,qr_ok,timing_count,
   auth.uid(),raw_answers,raw_statuses) returning id into sub_id;
 insert into public.scored_attempts(institute_id,submission_id,test_id,candidate_id,
  correct_count,incorrect_count,blank_count,cancelled_count,multiple_count,total_score)
 values(org_id,sub_id,exam_id,person_id,correct_n,wrong_n,blank_n,cancelled_n,
  multi_n,final_score);
 return sub_id;
end; $$;
revoke all on function public.submit_reviewed_scan(uuid,uuid,uuid,jsonb,jsonb,text,boolean,int,text) from public;
grant execute on function public.submit_reviewed_scan(uuid,uuid,uuid,jsonb,jsonb,text,boolean,int,text) to authenticated;
grant select on public.candidates,public.scan_submissions,public.scored_attempts to authenticated;
grant insert on public.candidates to authenticated;

-- Institute leaderboard: best result per candidate, with deterministic ties.
create or replace view public.institute_leaderboard
with (security_invoker=true) as
with best as (
 select distinct on (s.test_id,s.candidate_id)
 s.institute_id,s.test_id,s.candidate_id,s.total_score,
 s.correct_count,s.incorrect_count,s.blank_count,s.multiple_count,s.scored_at
 from public.scored_attempts s
 order by s.test_id,s.candidate_id,s.total_score desc,s.scored_at asc
)
select b.*,c.candidate_code,c.display_name,
 dense_rank() over(partition by b.test_id order by b.total_score desc) as rank
from best b join public.candidates c on c.id=b.candidate_id
 and c.institute_id=b.institute_id;
grant select on public.institute_leaderboard to authenticated;
