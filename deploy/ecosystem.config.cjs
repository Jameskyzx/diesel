const nodeInterpreter = "/opt/node-v22.22.3-linux-x64/bin/node";
const appVersion = process.env.APP_VERSION ?? "vps";

if (!/^[A-Za-z0-9._-]{1,64}$/.test(appVersion)) {
  throw new Error("APP_VERSION must be a safe release identifier.");
}

module.exports = {
  apps: [
    {
      name: "diesel-demo",
      cwd: "/opt/diesel/current",
      // PM2's root-owned daemon may retain environment values from an older
      // release. Execute through `env -i` so the public process receives only
      // this allowlist, then let Node load the root-managed production file.
      script: "/usr/bin/env",
      interpreter: "none",
      args: [
        "-i",
        "HOME=/opt/diesel/shared",
        "PATH=/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "NODE_ENV=production",
        `APP_VERSION=${appVersion}`,
        nodeInterpreter,
        "--env-file=.env.production.local",
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "8788",
      ],
      instances: 1,
      exec_mode: "fork",
      // PM2 is administered by root on the single-host VPS, but the public
      // Next.js process (including untrusted image/PDF decoding) must never
      // inherit root privileges.
      uid: "diesel",
      gid: "diesel",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        // Kept only so `pm2 jlist` exposes the intended release for the
        // deployment assertion. `/usr/bin/env -i` rebuilds the actual app env.
        APP_VERSION: appVersion,
      },
    },
  ],
};
