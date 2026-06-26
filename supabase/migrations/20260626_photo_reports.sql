alter table public.hazards
  add column if not exists source varchar default 'sensor'
    check (source in ('sensor', 'photo'));

create policy "Public can view under_review photo hazards"
on public.hazards for select
using (status = 'under_review' and source = 'photo');

create or replace function public.report_hazard_photo(
  p_type varchar,
  p_lat float,
  p_lon float,
  p_severity int,
  p_confidence float,
  p_image_url text default null
) returns uuid as $$
declare
  v_new_id uuid;
begin
  insert into public.hazards (type, location, severity_score, confidence_score, reporter_id, image_url, status, source, confirmation_count)
  values (
    p_type,
    st_point(p_lon, p_lat)::geography,
    p_severity,
    p_confidence,
    auth.uid(),
    p_image_url,
    'under_review',
    'photo',
    0
  ) returning id into v_new_id;
  return v_new_id;
end;
$$ language plpgsql security definer;
