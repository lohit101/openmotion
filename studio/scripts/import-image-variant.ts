/** Import an explicitly reviewed local framing result; no GPU access. */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { Store } from '../server/store';
import { importImageVariant } from '../server/local-image-variant';

const { values } = parseArgs({ options: { parent: { type: 'string' }, folder: { type: 'string' }, title: { type: 'string' }, data: { type: 'string' } } });
if (!values.parent || !values.folder || !values.title) throw new Error('Use --parent JOB_ID --folder REVIEWED_FOLDER --title TITLE.');
const store = new Store(path.resolve(values.data || path.join(import.meta.dirname, '../data')));
try { const job = importImageVariant(store, values.parent, path.resolve(values.folder), values.title); console.log(JSON.stringify({ id: job.id, title: job.title, origin: job.origin, paidInference: false })); }
finally { store.close(); }
