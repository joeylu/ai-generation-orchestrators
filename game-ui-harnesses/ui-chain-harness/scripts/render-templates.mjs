// Compatibility entry point for the former documentation renderer.
import { main } from "./templates.mjs";
await main(["build", "--browser", process.argv[2] ?? "chromium", ...process.argv.slice(3)]);
