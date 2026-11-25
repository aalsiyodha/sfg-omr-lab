-- Question-level statistics over reviewed attempts, evaluated against the published key.
-- Security-invoker view inherits institute row-level access policies.
create or replace view public.question_analytics
with (security_invoker=true) as
with attempts as (
  select s.institute_id,s.test_id,s.candidate_id,s.id as submission_id,
    s.answers,s.answer_statuses,t.answer_key
  from public.scan_submissions s
  join public.tests t on t.id=s.test_id and t.institute_id=s.institute_id
  where t.status='published'
), responses as (
  select a.institute_id,a.test_id,a.submission_id,
    q.n::integer as question,
    a.answers->>(q.n::integer-1) as response,
    a.answer_statuses->>(q.n::integer-1) as response_status,
    a.answer_key->>(q.n::integer-1) as correct_answer
  from attempts a cross join lateral generate_series(1,50) as q(n)
)
select institute_id,test_id,question,correct_answer,
 count(*)::integer as total_attempts,
 count(*) filter(where response=correct_answer and correct_answer<>'X' and response_status<>'multiple')::integer as correct_count,
 count(*) filter(where response='A')::integer as option_a,
 count(*) filter(where response='B')::integer as option_b,
 count(*) filter(where response='C')::integer as option_c,
 count(*) filter(where response='D')::integer as option_d,
 count(*) filter(where (response is null or response='X') and response_status<>'multiple')::integer as blank_count,
 count(*) filter(where response_status='multiple')::integer as multiple_count,
 round(100.0*count(*) filter(where response=correct_answer and correct_answer<>'X' and response_status<>'multiple')/nullif(count(*),0),1)
 as correct_percent
from responses group by institute_id,test_id,question,correct_answer;
grant select on public.question_analytics to authenticated;
