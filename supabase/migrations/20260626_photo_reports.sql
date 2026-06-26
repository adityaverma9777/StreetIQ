alter table public.hazards
  add column if not exists source varchar default 'sensor'
    check (source in ('sensor', 'photo'));

alter table public.hazards
  add column if not exists image_url text;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'hazards'
      and policyname = 'Public can view under_review photo hazards'
  ) then
    execute 'create policy "Public can view under_review photo hazards"
      on public.hazards for select
      using (status = ''under_review'' and source = ''photo'')';
  end if;
end;
$$;

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
  insert into public.hazards (type, location, severity_score, confidence_score, image_url, status, source, confirmation_count)
  values (
    p_type,
    st_point(p_lon, p_lat)::geography,
    p_severity,
    p_confidence,
    p_image_url,
    'under_review',
    'photo',
    0
  ) returning id into v_new_id;
  return v_new_id;
end;
$$ language plpgsql security definer;

grant execute on function public.report_hazard_photo to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('hazard-images', 'hazard-images', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Anyone can upload hazard images'
  ) then
    execute 'create policy "Anyone can upload hazard images"
      on storage.objects for insert
      with check (bucket_id = ''hazard-images'')';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Anyone can view hazard images'
  ) then
    execute 'create policy "Anyone can view hazard images"
      on storage.objects for select
      using (bucket_id = ''hazard-images'')';
  end if;
end;
$$;
