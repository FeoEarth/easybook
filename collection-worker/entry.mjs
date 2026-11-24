import {WorkerEntrypoint} from 'cloudflare:workers';
import worker,{collectionTick} from './index.mjs';
export default worker;
export class CollectionScheduler extends WorkerEntrypoint {
 async tick(){return collectionTick(this.env)}
}
