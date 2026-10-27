// Failed storage operations remain recoverable. Invalid fences are never retried.
export const retryablePurge="(status IN('queued','running') OR (status='failed' AND error='R2_CLEANUP_RETRY'))";
export const purgeRetryDelay=attempts=>Math.min(86400000,60000*2**Math.min(11,Math.max(0,attempts)));
