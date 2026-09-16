import { runSupabaseBootstrap } from "./supabase-bootstrap.js";
const result = await runSupabaseBootstrap(process.argv.slice(2), process.env);
if (result.ok) console.log(result.message);
else console.error(result.message);
process.exitCode = result.ok ? 0 : 1;
