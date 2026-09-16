import { runCodeBootstrap } from "./m365-confidential.js";
const result = await runCodeBootstrap(process.argv.slice(2), process.env);
if (result.ok) console.log(result.message);
else console.error(result.message);
process.exitCode = result.ok ? 0 : 1;
