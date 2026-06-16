-- Enable realtime on hazards (if not already)
alter publication supabase_realtime add table public.hazards;

-- Road scan sessions table
create table if not exists public.road_scans (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null,
  reporter_id uuid references auth.users(id),
  location geography(point, 4326) not null,
  detected_type varchar check (detected_type in ('pothole', 'crack', 'waterlogging', 'debris')),
  confidence float check (confidence between 0 and 1),
  speed_kmh float,
  source varchar not null default 'drive_scan' check (source in ('drive_scan', 'ai_scan')),
  recorded_at timestamptz default now()
);

alter table public.road_scans enable row level security;

create policy "Anyone can insert road scans"
  on public.road_scans for insert with check (true);

create policy "Anyone can view road scans"
  on public.road_scans for select using (true);

alter publication supabase_realtime add table public.road_scans;

-- Add source and ai_label columns to hazards
alter table public.hazards
  add column if not exists source varchar default 'manual_report'
    check (source in ('manual_report', 'drive_scan', 'ai_scan')),
  add column if not exists ai_label varchar;

-- Spatial index for fast proximity queries
create index if not exists road_scans_location_idx
  on public.road_scans using gist (location);

-- RPC: insert road scan (bypasses RLS for anon users)
create or replace function public.insert_road_scan(
  p_session_id uuid,
  p_lat float,
  p_lon float,
  p_detected_type varchar,
  p_confidence float,
  p_speed_kmh float,
  p_source varchar default 'drive_scan'
) returns uuid as $$
declare
  v_id uuid;
begin
  insert into public.road_scans (session_id, reporter_id, location, detected_type, confidence, speed_kmh, source)
  values (
    p_session_id,
    auth.uid(),
    st_point(p_lon, p_lat)::geography,
    p_detected_type,
    p_confidence,
    p_speed_kmh,
    p_source
  ) returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;
