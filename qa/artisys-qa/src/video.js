import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDir } from './helpers.js';

function run(cmd, args, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { if (captureStdout) stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(captureStdout ? stdout : undefined) : reject(new Error(`${cmd} exited ${code}: ${stderr}`)));
  });
}

export async function probeMediaDuration(file) {
  const stdout = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], { captureStdout: true });
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine media duration: ${file}`);
  return duration;
}

export function buildNormalizeArgs(inputFile, outputFile, preset, { sourceDurationSec, durationTargetSec } = {}) {
  if (!preset?.width || !preset?.height) throw new TypeError('Demo preset requires width and height');
  const filters = [];
  if (Number.isFinite(sourceDurationSec) && sourceDurationSec > 0 && Number.isFinite(durationTargetSec) && durationTargetSec > 0) {
    const factor = durationTargetSec / sourceDurationSec;
    filters.push(`setpts=${Number(factor.toFixed(6))}*PTS`);
  }
  filters.push(`scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease`);
  filters.push(`pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2:black`);
  return [
    '-y', '-i', inputFile,
    '-vf', filters.join(','),
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    outputFile,
  ];
}

export async function normalizeDemoVideo(inputFile, outputFile, preset, { durationTargetSec } = {}) {
  await ensureDir(path.dirname(outputFile));
  const sourceDurationSec = await probeMediaDuration(inputFile);
  await run('ffmpeg', buildNormalizeArgs(inputFile, outputFile, preset, { sourceDurationSec, durationTargetSec }));
  return outputFile;
}

export function createFrameRecorder(page, { dir, fps = 4 } = {}) {
  let stopped = false;
  let index = 0;
  let task = Promise.resolve();
  let startedAt = 0;
  const intervalMs = Math.max(100, Math.floor(1000 / fps));

  async function capture() {
    if (stopped) return;
    const file = path.join(dir, `${String(index++).padStart(6, '0')}.png`);
    try { await page.screenshot({ path: file }); } catch { /* page may be closing */ }
  }

  return {
    async start() {
      await ensureDir(dir);
      startedAt = Date.now();
      await capture();
      task = (async () => {
        while (!stopped) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
          await capture();
        }
      })();
    },
    async stop(outputFile) {
      stopped = true;
      await task;
      if (index < 2) return null;
      const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
      const effectiveFps = Math.max((index - 1) / elapsedSec, 0.01);
      try {
        await run('ffmpeg', [
          '-y', '-framerate', effectiveFps.toFixed(6), '-i', path.join(dir, '%06d.png'),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputFile,
        ]);
        await fs.rm(dir, { recursive: true, force: true });
        return outputFile;
      } catch (error) {
        await fs.writeFile(path.join(dir, 'VIDEO_BUILD_FAILED.txt'), `${error.stack || error}\n`, 'utf8');
        return null;
      }
    },
  };
}
