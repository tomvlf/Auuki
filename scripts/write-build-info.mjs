import { writeFileSync } from 'node:fs';

const destination = process.argv[2];
if(!destination) throw new Error('Provide a destination for build metadata.');

const version = process.env.ATHLIMA_BUILD_VERSION?.trim() || 'development';
const revision = process.env.ATHLIMA_BUILD_REVISION?.trim() || null;
writeFileSync(destination, `${JSON.stringify({version, revision})}\n`);
