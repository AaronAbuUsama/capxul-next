-- Core keeps no spans in the world's database any more: every span leaves through its OTLP export, and in a test world
-- the tap (`telemetry.otlp`, 0010) holds them, where the runner reads them (roadmap 4.4, the retire). `app.events` stays.
drop table if exists app.spans;
