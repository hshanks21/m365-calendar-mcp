import { runBootstrap } from './google-oauth.js';

const result = await runBootstrap(process.argv.slice(2), process.env);
if (result.ok) console.log(result.message);
else console.error(result.message);
process.exitCode = result.ok ? 0 : 1;
