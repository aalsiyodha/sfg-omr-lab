import 'server-only';
import {sql} from './neon';
import type {Choice} from './key';
import type {Institute,TestRecord} from './types';

export type Membership=Institute & {role:'owner'|'admin'|'reviewer'};
type Row=Record<string,unknown>;
function typed<T>(rows:Row[]):T[]{return rows as T[];}

export async function institutesForUser(userId:string):Promise<Membership[]>{
 const rows=await sql()`SELECT i.id,i.name,i.slug,m.role FROM institutes i
  JOIN institute_members m ON m.institute_id=i.id WHERE m.user_id=${userId} ORDER BY i.created_at DESC`;
 return typed<Membership>(rows);
}
export async function createInstituteRecord(userId:string,name:string,slug:string){
 const rows=await sql()`WITH created AS (
 INSERT INTO institutes(name,slug,created_by) VALUES(${name},${slug},${userId})
 RETURNING id
 ) INSERT INTO institute_members(institute_id,user_id,role)
 SELECT id,${userId},'owner' FROM created RETURNING institute_id`;
 return rows.length>0;
}
export async function testsForInstitute(userId:string,instituteId:string):Promise<TestRecord[]>{
 const rows=await sql()`SELECT t.* FROM tests t JOIN institute_members m ON m.institute_id=t.institute_id
  WHERE t.institute_id=${instituteId}::uuid AND m.user_id=${userId} ORDER BY t.created_at DESC`;
 return typed<TestRecord>(rows);
}
export type AuthorizedTest=TestRecord & {institute_name:string;role:'owner'|'admin'|'reviewer'};
export async function authorizedTest(userId:string,testId:string):Promise<AuthorizedTest|null>{
 const rows=await sql()`SELECT t.*,i.name AS institute_name,m.role FROM tests t
  JOIN institutes i ON i.id=t.institute_id JOIN institute_members m ON m.institute_id=t.institute_id
  WHERE t.id=${testId}::uuid AND m.user_id=${userId} LIMIT 1`;
 return typed<AuthorizedTest>(rows)[0]||null;
}
export async function createTestRecord(userId:string,instituteId:string,title:string,num:number){
 const rows=await sql()`INSERT INTO tests(institute_id,title,sheet_test_number,answer_key,created_by)
  SELECT i.id,${title},${num},${JSON.stringify(Array(50).fill(null))}::jsonb,${userId}
  FROM institutes i JOIN institute_members m ON m.institute_id=i.id
  WHERE i.id=${instituteId}::uuid AND m.user_id=${userId} AND m.role IN ('owner','admin')
  RETURNING id`;
 return rows[0]?.id?String(rows[0].id):null;
}
export async function saveAnswerKey(userId:string,testId:string,key:Choice[]){
 const rows=await sql()`UPDATE tests t SET answer_key=${JSON.stringify(key)}::jsonb
  FROM institute_members m WHERE t.id=${testId}::uuid AND t.institute_id=m.institute_id
  AND m.user_id=${userId} AND m.role IN ('owner','admin') AND t.status='draft'
  RETURNING t.id`;
 return rows.length>0;
}
export async function publishAnswerKey(userId:string,testId:string){
 const rows=await sql()`UPDATE tests t SET status='published' FROM institute_members m
  WHERE t.id=${testId}::uuid AND t.institute_id=m.institute_id AND m.user_id=${userId}
  AND m.role IN ('owner','admin') AND t.status='draft' AND jsonb_array_length(t.answer_key)=50
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.answer_key) v
    WHERE jsonb_typeof(v)!='string' OR trim(both '"' from v::text) NOT IN ('A','B','C','D','X'))
  RETURNING t.id`;
 return rows.length>0;
}
export type RankedAttempt={candidate_code:string;display_name:string;rank:number;total_score:number;
 correct_count:number;incorrect_count:number;blank_count:number;multiple_count:number};
export async function leaderboardForTest(userId:string,testId:string):Promise<RankedAttempt[]>{
 const rows=await sql()`WITH latest AS (
   SELECT DISTINCT ON(s.candidate_id) s.candidate_id,s.score,s.correct_count,s.incorrect_count,
   s.blank_count,s.multiple_count,s.reviewed_at
   FROM scan_submissions s JOIN institute_members m ON m.institute_id=s.institute_id
   WHERE s.test_id=${testId}::uuid AND m.user_id=${userId}
   ORDER BY s.candidate_id,s.reviewed_at DESC
  ), ranked AS (
    SELECT c.candidate_code,c.display_name,l.*,DENSE_RANK() OVER(ORDER BY l.score DESC) AS rank
    FROM latest l JOIN candidates c ON c.id=l.candidate_id
  ) SELECT candidate_code,display_name,score AS total_score,correct_count,incorrect_count,
     blank_count,multiple_count,rank FROM ranked ORDER BY rank,candidate_code LIMIT 500`;
 return typed<RankedAttempt>(rows);
}
export type AnalysisRow={question:number;correct_answer:string;total_attempts:number;correct_count:number;
 option_a:number;option_b:number;option_c:number;option_d:number;blank_count:number;
 multiple_count:number;correct_percent:number};
export async function analysisForTest(userId:string,testId:string):Promise<AnalysisRow[]>{
 const rows=await sql()`WITH attempts AS (
 SELECT s.answers,s.answer_statuses,t.answer_key FROM scan_submissions s
 JOIN tests t ON t.id=s.test_id AND t.institute_id=s.institute_id
 JOIN institute_members m ON m.institute_id=s.institute_id
 WHERE s.test_id=${testId}::uuid AND m.user_id=${userId} AND t.status='published'
 ), responses AS(
 SELECT q.n::int AS question,a.answers->>(q.n-1) AS response,
 a.answer_statuses->>(q.n-1) AS response_status,
 a.answer_key->>(q.n-1) AS correct_answer
 FROM attempts a CROSS JOIN LATERAL generate_series(1,50) AS q(n)
 ) SELECT question,correct_answer,count(*)::int AS total_attempts,
 count(*) FILTER (WHERE response=correct_answer AND correct_answer<>'X' AND response_status<>'multiple')::int AS correct_count,
 count(*) FILTER (WHERE response='A' AND response_status<>'multiple')::int AS option_a,
 count(*) FILTER (WHERE response='B' AND response_status<>'multiple')::int AS option_b,
 count(*) FILTER (WHERE response='C' AND response_status<>'multiple')::int AS option_c,
 count(*) FILTER (WHERE response='D' AND response_status<>'multiple')::int AS option_d,
 count(*) FILTER (WHERE (response IS NULL OR response='X') AND response_status<>'multiple')::int AS blank_count,
 count(*) FILTER (WHERE response_status='multiple')::int AS multiple_count,
 COALESCE(round(100.0*count(*) FILTER (WHERE response=correct_answer AND correct_answer<>'X' AND response_status<>'multiple')/NULLIF(count(*),0),1),0)::float AS correct_percent
 FROM responses GROUP BY question,correct_answer ORDER BY question`;
 return typed<AnalysisRow>(rows);
}
