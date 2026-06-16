-- Enable the PostGIS extension for geospatial operations
create extension if not exists postgis;

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Table: profiles
create table public.profiles (
    id uuid references auth.users on delete cascade primary key,
    reputation_score int default 0,
    created_at timestamptz default now()
);

-- Table: hazards
create table public.hazards (
    id uuid primary key default uuid_generate_v4(),
    type varchar not null check (type in ('pothole', 'crack', 'waterlogging', 'debris')),
    location geography(point, 4326) not null,
    severity_score int not null check (severity_score between 1 and 5),
    status varchar default 'under_review' check (status in ('reported', 'under_review', 'verified', 'repaired')),
    confidence_score float not null,
    reporter_id uuid references auth.users(id),
    confirmation_count int default 1,
    image_url text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.hazards enable row level security;

-- RLS Policies for hazards
create policy "Public can view verified hazards"
on public.hazards for select
using (status = 'verified');

create policy "Users can view their own reports"
on public.hazards for select
using (auth.uid() = reporter_id);

-- STRICT RULE: Direct inserts/updates are DENIED. Must use RPC.
create policy "Deny direct inserts to hazards"
on public.hazards for insert with check (false);

create policy "Deny direct updates to hazards"
on public.hazards for update using (false);

-- RLS Policies for profiles
create policy "Public can view profiles"
on public.profiles for select using (true);

create policy "Users can update own profile"
on public.profiles for update using (auth.uid() = id);

-- Function: Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for new user
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RPC: report_hazard (Transaction Safe Deduplication)
create or replace function public.report_hazard(
  p_type varchar,
  p_lon float,
  p_lat float,
  p_severity int,
  p_confidence float,
  p_image_url text default null
) returns uuid as $$
declare
  v_existing_id uuid;
  v_grid_hash int;
  v_new_id uuid;
begin
  -- Generate a 64-bit integer hash based on coarse coordinates to act as a lock key
  -- This prevents concurrent writes in the exact same ~10m area
  v_grid_hash := hashtext(round(p_lon::numeric, 4)::text || round(p_lat::numeric, 4)::text);
  
  -- Acquire advisory lock for this grid area
  perform pg_advisory_xact_lock(v_grid_hash);

  -- Check for existing active hazard of same type within 10 meters
  select id into v_existing_id
  from public.hazards
  where type = p_type
    and status in ('reported', 'under_review', 'verified')
    and st_dwithin(location, st_point(p_lon, p_lat)::geography, 10)
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    -- Increment confirmation count
    update public.hazards
    set confirmation_count = confirmation_count + 1,
        updated_at = now(),
        -- Auto-verify if heavily confirmed (e.g., 3 confirmations)
        status = case when confirmation_count >= 2 then 'verified' else status end
    where id = v_existing_id;
    return v_existing_id;
  else
    -- Insert new hazard
    insert into public.hazards (type, location, severity_score, confidence_score, reporter_id, image_url)
    values (
      p_type,
      st_point(p_lon, p_lat)::geography,
      p_severity,
      p_confidence,
      auth.uid(),
      p_image_url
    ) returning id into v_new_id;
    return v_new_id;
  end if;
end;
$$ language plpgsql security definer;
