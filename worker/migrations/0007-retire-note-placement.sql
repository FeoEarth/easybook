-- Only retired placement metadata; retain every note, folder and attachment.
UPDATE management_state SET items=COALESCE((SELECT json_group_object(key,json(value)) FROM json_each(management_state.items) WHERE key NOT LIKE 'n:%'), '{}'),version=version+1 WHERE EXISTS (SELECT 1 FROM json_each(management_state.items) WHERE key LIKE 'n:%');
DELETE FROM management_receipts WHERE json_extract(payload,'$.key') LIKE 'n:%';
