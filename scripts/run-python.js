"use strict";

const { spawn, spawnSync } = require("child_process");
const path = require("path");

const script = process.argv[2];
if (!script) {
  process.stderr.write("usage: node scripts/run-python.js <script> [args...]\n");
  process.exit(2);
}

const extraArgs = process.argv.slice(3);
const root = path.resolve(__dirname, "..");
const candidates =
  process.platform === "win32"
    ? [
        ["python", []],
        ["py", ["-3"]],
        ["python3", []],
      ]
    : [
        ["python3", []],
        ["python", []],
      ];

function isPython3(command, prefixArgs) {
  const result = spawnSync(
    command,
    [...prefixArgs, "-c", "import sys; raise SystemExit(0 if sys.version_info[0] >= 3 else 1)"],
    { windowsHide: true }
  );
  return result.status === 0;
}

const chosen = candidates.find(([command, prefixArgs]) => isPython3(command, prefixArgs));
if (!chosen) {
  process.stderr.write(
    "Python 3 is required. Install it and add `python` or `python3` to PATH.\n"
  );
  process.exit(1);
}

const child = spawn(chosen[0], [...chosen[1], script, ...extraArgs], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
