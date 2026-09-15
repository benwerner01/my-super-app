// The one place the dashboard's bind address is defined, used by both `dev` and
// `start`. Loopback only: this has no auth because nothing outside this machine
// can reach it, so the host must never become 0.0.0.0.
import { spawn } from "node:child_process";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = process.env.DASHBOARD_PORT ?? "7777";

const mode = process.argv[2] === "dev" ? "dev" : "start";
const next = path.join(import.meta.dirname, "node_modules", ".bin", "next");

const child = spawn(next, [mode, "--hostname", HOST, "--port", PORT], {
  cwd: import.meta.dirname,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
