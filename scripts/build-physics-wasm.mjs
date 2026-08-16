import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = path.join(repository, "physics-core");
const wasmInput = path.join(
  core,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "sim_studio_physics.wasm",
);
const output = path.join(repository, "app", "physics", "wasm");

function run(command, args, cwd = repository) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], core);
run("wasm-bindgen", [
  "--target",
  "web",
  "--out-dir",
  output,
  "--out-name",
  "sim_studio_physics",
  wasmInput,
]);
