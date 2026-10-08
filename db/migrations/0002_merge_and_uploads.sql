-- Dropped call merged into its callback (same number within 10 min)
alter table calls add column merged_into uuid references calls (id) on delete restrict;
create index calls_merged_into_idx on calls (merged_into);

-- One seed_uploads row per distinct file, so re-uploads don't double-count channels
alter table seed_uploads add constraint seed_uploads_file_hash_key unique (file_hash);
