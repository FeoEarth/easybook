// Preserve the existing editor module; add only synchronization policy helpers.
import './rich-editor.js';
import * as policy from '../shared/sync-policy.mjs';
window.EasybookSyncPolicy=policy;

import * as attachments from '../shared/attachments.mjs';
window.EasybookAttachments=attachments;

import * as localAiProtocol from '../shared/local-ai-protocol.mjs';
window.EasybookLocalAiProtocol=localAiProtocol;

import * as servers from '../shared/server-registry.mjs';
window.EasybookServers=servers;

import * as serverAuth from '../shared/web-server-auth.mjs';
window.EasybookServerAuth=serverAuth;

import {createVideoPlayer,mediaMime} from './video-player.js';
window.EasybookVideo={create:createVideoPlayer,mime:mediaMime,pauseAll:()=>document.querySelectorAll('video').forEach(v=>v.pause())};
