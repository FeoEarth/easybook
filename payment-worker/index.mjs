import {scanMembership} from '../worker/membership-scanner.mjs';
export default {async scheduled(controller,env,ctx){ctx.waitUntil(scanMembership(env))},fetch(){return new Response('Not found',{status:404})}};
