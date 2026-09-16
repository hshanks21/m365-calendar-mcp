import { runMicrosoftBootstrap } from "./m365-oauth.js";
const result = await runMicrosoftBootstrap(process.argv.slice(2), process.env);
if (result.ok) console.log(result.message);
else console.error(result.message);
process.exitCode = result.ok ? 0 : 1;
