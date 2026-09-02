const path = require("node:path");

const releasePath = process.env.RELEASE_PATH;

if (!releasePath) {
  throw new Error("RELEASE_PATH is required");
}

module.exports = {
  apps: [
    {
      name: "adimology",
      cwd: releasePath,
      script: "server.js",
      node_args: `--env-file=${path.join(releasePath, ".env.production")}`,
      exec_mode: "cluster",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "0.0.0.0",
        PORT: process.env.APP_PORT || "3100",
      },
    },
  ],
};
