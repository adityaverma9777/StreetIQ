-- This uses pgTAP to test RLS policies and concurrency logic
begin;
select plan(5);

-- Test 1: Direct inserts to hazards should fail for anonymous/authenticated users
set local role authenticated;
select throws_ok(
    $$ insert into public.hazards (type, location, severity_score, confidence_score) values ('pothole', st_point(0,0), 3, 0.9) $$,
    'new row violates row-level security policy for table "hazards"',
    'Direct insert to hazards should be denied by RLS'
);

-- Test 2: Direct updates should fail
select throws_ok(
    $$ update public.hazards set severity_score = 5 where type = 'pothole' $$,
    'new row violates row-level security policy for table "hazards"',
    'Direct update to hazards should be denied by RLS'
);

-- Test 3: Viewing verified hazards works
select lives_ok(
    $$ select * from public.hazards where status = 'verified' $$,
    'Public/authenticated users can view verified hazards'
);

-- Test 4: report_hazard RPC works and handles deduplication
set local role authenticated;
-- Insert first hazard
select lives_ok(
    $$ select public.report_hazard('pothole', -95.36, 29.76, 3, 0.95) $$,
    'First RPC call succeeds'
);

-- Call again at exact same location (simulating near duplicate)
-- It should increment confirmation_count rather than creating a new row
prepare check_dedupe as 
select confirmation_count from public.hazards where type = 'pothole' limit 1;

select public.report_hazard('pothole', -95.36001, 29.76001, 3, 0.95);
select results_eq(
    'check_dedupe',
    ARRAY[2],
    'Second RPC call within 10m increments confirmation_count to 2'
);

select * from finish();
rollback;
