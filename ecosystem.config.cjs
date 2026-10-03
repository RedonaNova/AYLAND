// pm2 config for the backend on a server (HANDBOOK §12): the orchestrator API, both MCP servers and both A2A agents.
// The web app stays on Vercel and reaches the API through AYLAND_API_ORIGIN.
//
//   pm2 start ecosystem.config.cjs     first start (then `pm2 save` and `pm2 startup` to survive reboots)
//   pm2 reload ecosystem.config.cjs    after `git pull` and `uv --directory backend sync --frozen --no-dev`
//   pm2 logs ayland-api                pm2 status · pm2 stop ecosystem.config.cjs
//
// Settings come from the repo-root .env, which backend/ayland/config.py reads itself. One process per service:
// chat runs and trip events live in the API's memory, so never run it in cluster mode or with more instances.
const path = require("node:path");

const backend = path.join(__dirname, "backend");
const python = path.join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
// Only the API answers other machines (Vercel, or a tunnel/reverse proxy on this one); tools and agents stay local.
const apiHost = process.env.AYLAND_API_HOST || "0.0.0.0";

function service(name, module, port, host = "127.0.0.1") {
  return {
    name: `ayland-${name}`,
    cwd: backend,
    script: python,
    args: ["-m", "uvicorn", module, "--host", host, "--port", String(port), "--timeout-graceful-shutdown", "3"],
    interpreter: "none",
    exec_mode: "fork",
    instances: 1,
    restart_delay: 2000,
    kill_timeout: 5000,
    time: true,
  };
}

module.exports = {
  apps: [
    service("travel", "ayland.mcp_servers.travel_data.server:app", 8201),
    service("merchant", "ayland.mcp_servers.merchant.server:app", 8202),
    service("booking", "ayland.a2a_agents.booking.server:app", 8301),
    service("interpreter", "ayland.a2a_agents.interpreter.server:app", 8302),
    service("api", "ayland.orchestrator.app:app", 8000, apiHost),
  ],
};
