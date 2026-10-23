-- Ozone Crew chat (group chat with Ozone + game characters) and Web Push subscriptions.
-- Additive only: new tables, functions, policies, triggers, realtime publication entries.
-- A crew is the owner + up to 4 invited friends/family (5 members max).
-- Every crew mutation goes through SECURITY DEFINER RPCs; clients can only SELECT crew tables
-- and INSERT their own (non-bot) chat messages. Bot/character replies are written by
-- /api/ozone-chat with the service role.

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'My Crew' check (char_length(btrim(name)) between 1 and 40),
  -- AI characters "called in" to the chat besides Ozone (who is always there).
  characters text[] not null default '{}'::text[]
    check (characters <@ array['volt','ember','nova']::text[] and coalesce(array_length(characters, 1), 0) <= 3),
  created_at timestamptz not null default now()
);
create unique index if not exists crews_one_per_owner_idx on public.crews(owner_id);

create table if not exists public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index if not exists crew_members_user_idx on public.crew_members(user_id);

create table if not exists public.crew_invites (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (crew_id, invitee_id)
);
create index if not exists crew_invites_invitee_idx on public.crew_invites(invitee_id, status);

create table if not exists public.crew_messages (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  username text check (username is null or char_length(username) <= 30),
  body text not null check (char_length(btrim(body)) between 1 and 1500),
  is_bot boolean not null default false,          -- AI replies (service role only)
  persona text check (persona is null or persona in ('ozone','volt','ember','nova')),
  reply_to uuid references public.crew_messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crew_messages_crew_time_idx on public.crew_messages(crew_id, created_at desc);
create unique index if not exists crew_messages_one_reply_idx on public.crew_messages(reply_to, persona) where is_bot;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 10 and 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  prefs jsonb not null default '{"quests": true, "crew": true, "drops": true, "rewards": true}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- ---------- helpers ----------
create or replace function public.is_crew_member(p_crew uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crew_members m where m.crew_id = p_crew and m.user_id = auth.uid());
$$;

create or replace function public.is_crew_owner(p_crew uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.crews c where c.id = p_crew and c.owner_id = auth.uid());
$$;

create or replace function public.crews_add_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.crew_members (crew_id, user_id, role, invited_by)
  values (new.id, new.owner_id, 'owner', new.owner_id)
  on conflict do nothing;
  return new;
end $$;

create trigger crews_add_owner_trg after insert on public.crews
  for each row execute function public.crews_add_owner();

-- Max 5 members per crew (owner + 4). Locks the crew row so concurrent accepts can't overshoot.
create or replace function public.crew_members_enforce_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_count int;
begin
  select owner_id into v_owner from public.crews where id = new.crew_id for update;
  if v_owner is null then raise exception 'Crew not found'; end if;
  if new.user_id = v_owner then new.role := 'owner'; else new.role := 'member'; end if;
  select count(*) into v_count from public.crew_members where crew_id = new.crew_id and user_id <> v_owner;
  if new.user_id <> v_owner and v_count >= 4 then
    raise exception 'Crew is full: up to 4 friends or family plus the owner' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger crew_members_limit_trg before insert on public.crew_members
  for each row execute function public.crew_members_enforce_limit();

-- Human messages always carry the sender's real profile username (clients can't spoof names).
create or replace function public.crew_messages_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.is_bot then
    new.persona := null;
    new.reply_to := null;
    select left(p.username, 30) into new.username from public.profiles p where p.id = new.user_id;
  end if;
  return new;
end $$;

create trigger crew_messages_stamp_trg before insert on public.crew_messages
  for each row execute function public.crew_messages_stamp();

-- ---------- RPCs ----------
create or replace function public.create_crew(p_name text default 'My Crew')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into v from public.crews where owner_id = auth.uid();
  if v is not null then return v; end if;
  insert into public.crews (owner_id, name)
  values (auth.uid(), coalesce(nullif(left(btrim(coalesce(p_name, '')), 40), ''), 'My Crew'))
  returning id into v;
  return v;
end $$;

create or replace function public.rename_crew(p_crew uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crew_owner(p_crew) then raise exception 'Only the crew owner can rename the crew'; end if;
  update public.crews set name = coalesce(nullif(left(btrim(coalesce(p_name, '')), 40), ''), 'My Crew') where id = p_crew;
end $$;

create or replace function public.invite_to_crew(p_crew uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_taken int;
  v_id uuid;
begin
  select owner_id into v_owner from public.crews where id = p_crew for update;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'Only the crew owner can invite'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'Pick a friend to invite'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Player not found'; end if;
  if exists (select 1 from public.crew_members where crew_id = p_crew and user_id = p_user) then raise exception 'Already in your crew'; end if;
  select (select count(*) from public.crew_members where crew_id = p_crew and user_id <> v_owner)
       + (select count(*) from public.crew_invites where crew_id = p_crew and status = 'pending' and invitee_id <> p_user)
    into v_taken;
  if v_taken >= 4 then raise exception 'Crew is full: up to 4 friends or family (pending invites count)'; end if;
  insert into public.crew_invites (crew_id, invitee_id, invited_by, status)
  values (p_crew, p_user, auth.uid(), 'pending')
  on conflict (crew_id, invitee_id) do update set status = 'pending', invited_by = auth.uid(), created_at = now(), responded_at = null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.respond_crew_invite(p_invite uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.crew_invites;
begin
  select * into r from public.crew_invites where id = p_invite for update;
  if r.id is null or r.invitee_id <> auth.uid() then raise exception 'Invite not found'; end if;
  if r.status <> 'pending' then raise exception 'This invite is no longer open'; end if;
  if p_accept then
    insert into public.crew_members (crew_id, user_id, role, invited_by)
    values (r.crew_id, r.invitee_id, 'member', r.invited_by) on conflict do nothing;
  end if;
  update public.crew_invites set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = p_invite;
  return r.crew_id;
end $$;

create or replace function public.cancel_crew_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_crew uuid;
begin
  select crew_id into v_crew from public.crew_invites where id = p_invite and status = 'pending';
  if v_crew is null or not public.is_crew_owner(v_crew) then raise exception 'Invite not found'; end if;
  update public.crew_invites set status = 'cancelled', responded_at = now() where id = p_invite;
end $$;

create or replace function public.leave_crew(p_crew uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_crew_owner(p_crew) then raise exception 'Owners can disband the crew instead of leaving'; end if;
  delete from public.crew_members where crew_id = p_crew and user_id = auth.uid();
end $$;

create or replace function public.remove_crew_member(p_crew uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crew_owner(p_crew) then raise exception 'Only the crew owner can remove members'; end if;
  if p_user = auth.uid() then raise exception 'You own this crew'; end if;
  delete from public.crew_members where crew_id = p_crew and user_id = p_user and role <> 'owner';
end $$;

create or replace function public.disband_crew(p_crew uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_crew_owner(p_crew) then raise exception 'Only the crew owner can disband the crew'; end if;
  delete from public.crews where id = p_crew; -- cascades to this crew's members, invites, messages
end $$;

create or replace function public.set_crew_characters(p_crew uuid, p_chars text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not public.is_crew_member(p_crew) then raise exception 'Not in this crew'; end if;
  select coalesce(array_agg(distinct c), '{}') into v
    from unnest(coalesce(p_chars, '{}')) c where c in ('volt','ember','nova');
  update public.crews set characters = v where id = p_crew;
  return v;
end $$;

-- Push subscriptions: one row per browser endpoint, re-assigned to whoever is signed in on it.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_prefs jsonb default null, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_prefs jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' then raise exception 'Invalid push endpoint'; end if;
  v_prefs := jsonb_build_object(
    'quests', coalesce((p_prefs->>'quests')::boolean, true),
    'crew', coalesce((p_prefs->>'crew')::boolean, true),
    'drops', coalesce((p_prefs->>'drops')::boolean, true),
    'rewards', coalesce((p_prefs->>'rewards')::boolean, true));
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, prefs, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, v_prefs, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    prefs = excluded.prefs, user_agent = excluded.user_agent, updated_at = now();
end $$;

-- ---------- RLS ----------
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.crew_invites enable row level security;
alter table public.crew_messages enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.crews, public.crew_members, public.crew_invites, public.crew_messages, public.push_subscriptions from anon, authenticated;
grant select on public.crews, public.crew_members, public.crew_invites to authenticated;
grant select, insert on public.crew_messages to authenticated;
grant select, update, delete on public.push_subscriptions to authenticated;

revoke all on function public.create_crew(text), public.rename_crew(uuid, text), public.invite_to_crew(uuid, uuid),
  public.respond_crew_invite(uuid, boolean), public.cancel_crew_invite(uuid), public.leave_crew(uuid),
  public.remove_crew_member(uuid, uuid), public.disband_crew(uuid), public.set_crew_characters(uuid, text[]),
  public.save_push_subscription(text, text, text, jsonb, text) from public, anon;
grant execute on function public.create_crew(text), public.rename_crew(uuid, text), public.invite_to_crew(uuid, uuid),
  public.respond_crew_invite(uuid, boolean), public.cancel_crew_invite(uuid), public.leave_crew(uuid),
  public.remove_crew_member(uuid, uuid), public.disband_crew(uuid), public.set_crew_characters(uuid, text[]),
  public.save_push_subscription(text, text, text, jsonb, text) to authenticated;

-- crews: members (and pending invitees, to see the crew name) can read.
create policy crews_select on public.crews for select to authenticated
  using (owner_id = auth.uid() or public.is_crew_member(crews.id)
         or exists (select 1 from public.crew_invites i where i.crew_id = crews.id and i.invitee_id = auth.uid() and i.status = 'pending'));

create policy crew_members_select on public.crew_members for select to authenticated
  using (public.is_crew_member(crew_id));

create policy crew_invites_select on public.crew_invites for select to authenticated
  using (invitee_id = auth.uid() or public.is_crew_member(crew_id));

create policy crew_messages_select on public.crew_messages for select to authenticated
  using (public.is_crew_member(crew_id));
create policy crew_messages_insert on public.crew_messages for insert to authenticated
  with check (public.is_crew_member(crew_id) and user_id = auth.uid() and is_bot = false and persona is null and reply_to is null);

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- ---------- realtime ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['crew_messages', 'crew_invites'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
