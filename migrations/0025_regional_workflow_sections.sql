ALTER TABLE regional_activities ADD COLUMN section TEXT NOT NULL DEFAULT 'technical' CHECK(section IN ('technical','financial'));
ALTER TABLE regional_activities ADD COLUMN workflow_type TEXT;
ALTER TABLE regional_activities ADD COLUMN workflow_status TEXT;
UPDATE regional_activities SET section=CASE WHEN activity_type IN ('rfp','prospection','quotation') THEN 'financial' ELSE 'technical' END,
 workflow_type=activity_type,workflow_status=status;
CREATE INDEX IF NOT EXISTS idx_regional_activities_section ON regional_activities(section,workflow_status);
