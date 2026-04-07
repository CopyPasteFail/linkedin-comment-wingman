import { spawnSync } from "node:child_process";

const commands =
  process.platform === "win32"
    ? [
        [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run lint"]],
        [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm audit --audit-level=high"]],
      ]
    : [
        ["npm", ["run", "lint"]],
        ["npm", ["audit", "--audit-level=high"]],
      ];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
