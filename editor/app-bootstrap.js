// Preserve the existing editor module; add only synchronization policy helpers.
import './rich-editor.js';
import * as policy from '../shared/sync-policy.mjs';
window.EasybookSyncPolicy=policy;
