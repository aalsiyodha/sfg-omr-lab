-- OMR Lab institute platform v0.1. Apply once in Supabase SQL Editor.
-- IMPORTANT: Supabase Auth must be enabled and Google provider configured separately.
create extension if not exists pgcrypto;

create table if not exists public.institutes (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 3 and 100),
  slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.institute_members (
  institute_id uuid not null references public.institutes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','admin','reviewer')),
  joined_at timestamptz not null default now(),
  primary key(institute_id,user_id)
);
create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes(id) on delete cascade,
  title text not null check(length(trim(title)) between 3 and 120),
  sheet_test_number integer not null check(sheet_test_number between 1 and 40),
  question_count integer not null default 50 check(question_count=50),
  status text not null default 'draft' check(status in ('draft','published')),
  answer_key jsonb not null default '[]'::jsonb,
  correct_marks numeric(6,2) not null default 2,
  wrong_marks numeric(6,2) not null default -0.66,
  published_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint key_array check (jsonb_typeof(answer_key)='array')
);
create index if not exists tests_institute_date on public.tests(institute_id,created_at desc);
create index if not exists members_user on public.institute_members(user_id);

create or replace function public.is_institute_member(org uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.institute_members m
    where m.institute_id=org and m.user_id=(select auth.uid()))
$$;
create or replace function public.can_manage_institute(org uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.institute_members m
    where m.institute_id=org and m.user_id=(select auth.uid())
      and m.role in ('owner','admin'))
$$;

alter table public.institutes enable row level security;
alter table public.institute_members enable row level security;
alter table public.tests enable row level security;
create policy "members read institutes" on public.institutes
  for select to authenticated using (public.is_institute_member(id));
create policy "members read memberships" on public.institute_members
  for select to authenticated using (public.is_institute_member(institute_id));
create policy "members read tests" on public.tests
  for select to authenticated using (public.is_institute_member(institute_id));
create policy "admins create tests" on public.tests
  for insert to authenticated with check (
    public.can_manage_institute(institute_id) and created_by=(select auth.uid()));
create policy "admins update draft tests" on public.tests
  for update to authenticated using (
    public.can_manage_institute(institute_id) and status='draft')
  with check (public.can_manage_institute(institute_id));

-- Only verified users can create an institute; first membership is created atomically.
create or replace function public.create_institute(institute_name text, institute_slug text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if length(trim(institute_name)) not between 3 and 100 then raise exception 'Name must be 3–100 characters'; end if;
  if institute_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' then raise exception 'Invalid institute slug'; end if;
  insert into public.institutes(name,slug,created_by)
    values(trim(institute_name),institute_slug,auth.uid()) returning id into org;
  insert into public.institute_members(institute_id,user_id,role)
    values(org,auth.uid(),'owner');
  return org;
end; $$;
revoke all on function public.create_institute(text,text) from public;
grant execute on function public.create_institute(text,text) to authenticated;

-- A published answer key is immutable in v0.1. Future corrections create a version.
create or replace function public.validate_test_write() returns trigger
language plpgsql set search_path='' as $$
declare answer text; elem jsonb;
begin
  if tg_op='UPDATE' and old.status='published' then
    raise exception 'Published tests are immutable';
  end if;
  if jsonb_typeof(new.answer_key)<>'array' or
      jsonb_array_length(new.answer_key) not in (0,50) then
    raise exception 'Answer key must be empty or contain exactly 50 entries';
  end if;
  if jsonb_array_length(new.answer_key)=50 then
    for elem in select value from jsonb_array_elements(new.answer_key) loop
      if elem <> 'null'::jsonb and elem not in (
        '"A"'::jsonb,'"B"'::jsonb,'"C"'::jsonb,'"D"'::jsonb,'"X"'::jsonb) then
        raise exception 'Invalid answer-key value';
      end if;
    end loop;
  end if;
  if new.status='published' then
    if jsonb_array_length(new.answer_key)<>50 or
      exists(select 1 from jsonb_array_elements(new.answer_key) e where e.value='null'::jsonb)
    then raise exception 'Complete all 50 answers or cancel questions before publishing'; end if;
    new.published_at=coalesce(new.published_at,now());
  end if;
  if new.correct_marks<=0 or new.wrong_marks>0 then
    raise exception 'Invalid marking scheme';
  end if;
  new.updated_at=now();
  return new;
end $$;
create trigger validate_test before insert or update on public.tests
for each row execute function public.validate_test_write();

-- SQL grants for Supabase data API. Row policies still enforce tenancy.
grant select on public.institutes,public.institute_members,public.tests to authenticated;
grant insert,update on public.tests to authenticated;
