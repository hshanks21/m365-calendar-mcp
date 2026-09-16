import { runDiscovery } from "./google-discovery.js";
const result = await runDiscovery(process.argv.slice(2), process.env);
(result.ok ? console.log : console.error)(result.message);
process.exitCode = result.ok ? 0 : 1;
