#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function usage() {
  console.log(
    "Usage: node tests/e2e/make-video.cjs [artifacts_dir] [output_file]\n" +
      "Example: node tests/e2e/make-video.cjs tests/e2e/artifacts/latest tests/e2e/artifacts/latest/e2e-run.mp4"
  );
}

const rootDir = path.resolve(__dirname, "../..");
const artifactsDir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(rootDir, "tests", "e2e", "artifacts", "latest");
const outputFile = process.argv[3]
  ? path.resolve(process.cwd(), process.argv[3])
  : path.join(artifactsDir, "e2e-run.mp4");

if (!fs.existsSync(artifactsDir)) {
  console.error(`Artifacts directory not found: ${artifactsDir}`);
  usage();
  process.exit(1);
}

function collectPngFiles(dir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...collectPngFiles(fullPath));
    } else if (item.isFile() && item.name.toLowerCase().endsWith(".png")) {
      files.push(fullPath);
    }
  }
  return files;
}

const screenshots = collectPngFiles(artifactsDir).sort((a, b) => a.localeCompare(b));
if (screenshots.length === 0) {
  console.error(`No PNG screenshots found under: ${artifactsDir}`);
  process.exit(1);
}

const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpegCheck.status !== 0) {
  console.error("ffmpeg is not installed or unavailable in PATH.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
const concatFile = path.join(artifactsDir, "ffmpeg-input.txt");

const lines = [];
for (const file of screenshots) {
  lines.push(`file '${file.replace(/'/g, "'\\''")}'`);
  lines.push("duration 0.8");
}
lines.push(`file '${screenshots[screenshots.length - 1].replace(/'/g, "'\\''")}'`);

fs.writeFileSync(concatFile, lines.join("\n") + "\n", "utf8");

const ffmpegArgs = [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatFile,
  "-vf",
  "fps=30,scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2",
  "-pix_fmt",
  "yuv420p",
  outputFile,
];

const result = spawnSync("ffmpeg", ffmpegArgs, { stdio: "inherit" });
if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`Created video: ${outputFile}`);
