-- Ozone Crew chat (group chat with Ozone): crews, crew_members, crew_messages.
-- A crew is the owner + up to 4 invited friends/family (5 members max).
-- NOT APPLIED AUTOMATICALLY: run this in the Supabase SQL editor (or `supabase db push`)
-- for project grkppyxvyojtygqxevwz before wiring the Crew UI in OzoneChat.tsx.

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'My Crew' check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists crews_owner_idx on public.crews(owner_id);

create table if not exists public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index if not exists crew_members_user_idx on public.crew_members(user_id);

create table if not exists public.crew_messages (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  username text check (username is null or char_length(username) <= 30),
  body text not null check (char_length(btrim(body)) between 1 and 800),
  is_ozone boolean not null default false, -- AI replies (written server-side with the service role)
  created_at timestamptz not null default now()
);
create index if not exists crew_messages_crew_time_idx on public.crew_messages(crew_id, created_at desc);

-- ---------- helpers ----------
-- SECURITY DEFINER so RLS policies can check membership without recursing into crew_members' own policy.
create or replace function public.is_crew_member(p_crew uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crew_members m where m.crew_id = p_crew and m.user_id = auth.uid());
$$;

create or replace function public.is_crew_owner(p_crew uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crews c where c.id = p_crew and c.owner_id = auth.uid());
$$;

-- Owner is added as the first member automatically.
create or replace function public.crews_add_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.crew_members (crew_id, user_id, role, invited_by)
  values (new.id, new.owner_id, 'owner', new.owner_id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists crews_add_owner_trg on public.crews;
create trigger crews_add_owner_trg after insert on public.crews
  for each row execute function public.crews_add_owner();

-- Max 5 members per crew (owner + 4 invites). Locks the crew row so concurrent invites can't overshoot.
create or replace function public.crew_members_enforce_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_count int;
begin
  select owner_id into v_owner from public.crews where id = new.crew_id for update;
  if v_owner is null then raise exception 'Crew not found'; end if;
  if new.role = 'owner' and new.user_id <> v_owner then raise exception 'Only the crew owner can have the owner role'; end if;
  if new.user_id <> v_owner then new.role := 'member'; end if;
  select count(*) into v_count from public.crew_members where crew_id = new.crew_id and user_id <> v_owner;
  if new.user_id <> v_owner and v_count >= 4 then
    raise exception 'Crew is full: the owner can invite up to 4 friends or family' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists crew_members_limit_trg on public.crew_members;
create trigger crew_members_limit_trg before insert on public.crew_members
  for each row execute function public.crew_members_enforce_limit();

-- Stamp the sender's username from their profile when the client doesn't send one.
create or replace function public.crew_messages_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.username is null and new.user_id is not null then
    select left(p.username, 30) into new.username from public.profiles p where p.id = new.user_id;
  end if;
  return new;
exception when undefined_table then
  return new; -- profiles table not present yet
end $$;

drop trigger if exists crew_messages_stamp_trg on public.crew_messages;
create trigger crew_messages_stamp_trg before insert on public.crew_messages
  for each row execute function public.crew_messages_stamp();

-- ---------- RLS ----------
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.crew_messages enable row level security;

revoke all on public.crews, public.crew_members, public.crew_messages from anon;
grant select, insert, update, delete on public.crews to authenticated;
grant select, insert, delete on public.crew_members to authenticated;
grant select, insert on public.crew_messages to authenticated;

-- crews: members can see their crew; anyone signed in can create one they own; only the owner edits/deletes.
drop policy if exists crews_select on public.crews;
create policy crews_select on public.crews for select to authenticated
  using (owner_id = auth.uid() or public.is_crew_member(id));
drop policy if exists crews_insert on public.crews;
create policy crews_insert on public.crews for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists crews_update on public.crews;
create policy crews_update on public.crews for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists crews_delete on public.crews;
create policy crews_delete on public.crews for delete to authenticated
  using (owner_id = auth.uid());

-- crew_members: members see the roster; only the owner adds (invites); the owner removes anyone, members can leave.
drop policy if exists crew_members_select on public.crew_members;
create policy crew_members_select on public.crew_members for select to authenticated
  using (public.is_crew_member(crew_id));
drop policy if exists crew_members_insert on public.crew_members;
create policy crew_members_insert on public.crew_members for insert to authenticated
  with check (public.is_crew_owner(crew_id) and invited_by = auth.uid());
drop policy if exists crew_members_delete on public.crew_members;
create policy crew_members_delete on public.crew_members for delete to authenticated
  using ((public.is_crew_owner(crew_id) and role <> 'owner') or (user_id = auth.uid() and role <> 'owner'));

-- crew_messages: members only read and post, as themselves, never as Ozone.
drop policy if exists crew_messages_select on public.crew_messages;
create policy crew_messages_select on public.crew_messages for select to authenticated
  using (public.is_crew_member(crew_id));
drop policy if exists crew_messages_insert on public.crew_messages;
create policy crew_messages_insert on public.crew_messages for insert to authenticated
  with check (public.is_crew_member(crew_id) and user_id = auth.uid() and is_ozone = false);

-- ---------- realtime ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crew_messages') then
    alter publication supabase_realtime add table public.crew_messages;
  end if;
end $$;
