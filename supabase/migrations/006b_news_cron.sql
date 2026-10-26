-- 006b: descarga del calendario cada hora (minuto 7) con pg_cron + pg_net llamando a la función news-sync.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('news-sync', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://neqfafcelxgcxroicmer.supabase.co/functions/v1/news-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lcWZhZmNlbHhnY3hyb2ljbWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NzQzMTksImV4cCI6MjEwODQ1MDMxOX0.vXL1CxSMtno5ynotmSramelv7hXEaN0oQ8NmGC9eWZo'),
    body := '{}'::jsonb)
$cron$);
