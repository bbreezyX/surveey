-- Run as the migration/operator role, before giving service credentials to processes.
-- These are NOLOGIN privilege groups. Attach separately created login users privately.
CREATE ROLE survey_public_read NOLOGIN;
CREATE ROLE survey_admin_write NOLOGIN;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO survey_public_read, survey_admin_write;
GRANT SELECT ON delivery_publication, delivery_activepublication, delivery_publishedmedia,
  delivery_mediagrant TO survey_public_read;
GRANT SELECT, INSERT, UPDATE ON survey_account, survey_point, survey_photo, survey_observation,
  survey_observationevidence, survey_draft, survey_revision, survey_ratebucket,
  delivery_publication, delivery_activepublication, delivery_publishedmedia, delivery_mediagrant,
  django_session TO survey_admin_write;
GRANT SELECT, INSERT ON survey_auditevent TO survey_admin_write;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO survey_admin_write;
-- Cleanup is an operator command, so ordinary service roles have no DELETE grant.
-- A session is logged out by Django deleting its own session row.
GRANT DELETE ON django_session TO survey_admin_write;
REVOKE UPDATE, DELETE ON survey_auditevent, survey_revision, survey_observation,
  survey_observationevidence, delivery_publication, delivery_mediagrant FROM survey_admin_write;
-- Do not grant membership in the migration role, table ownership, or CREATE on schema public.
-- Public S3 credentials: GetObject for display/* ONLY; no originals/*, PutObject or ListBucket.
-- Admin S3 credentials: GetObject/PutObject for originals/* and display/*; cleanup credentials separately.
