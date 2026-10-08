-- Parsed enquiries kept with the upload, so the page can process them one request at a time.
alter table seed_uploads add column enquiries jsonb not null default '[]';
alter table seed_uploads add column year integer;
