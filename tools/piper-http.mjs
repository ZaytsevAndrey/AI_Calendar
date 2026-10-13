/**
 * Local Piper HTTP process. The binary and voice files live in local/piper
 * and are not part of the repo. Nest calls POST /speak.
 *
 *   node tools/piper-http.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'local', 'piper');
const piperExe = join(root, 'piper', 'piper.exe');
const voicesDir = join(root, 'voices');
const port = Number(process.env.PIPER_PORT || 5510);

const VOICES = {
  uk: 'uk_UA-tetiana-high.onnx',
  en: 'en_US-lessac-medium.onnx',
};

function voiceFile(language) {
  const code = String(language || 'en').toLowerCase().slice(0, 2);
  return join(voicesDir, VOICES[code] || VOICES.en);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function synthesize(text, language) {
  return new Promise(async (resolve, reject) => {
    const dir = await mkdtemp(join(tmpdir(), 'piper-'));
    const wavPath = join(dir, 'out.wav');
    const child = spawn(
      piperExe,
      ['--model', voiceFile(language), '--output_file', wavPath],
      { cwd: dirname(piperExe), stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      rm(dir, { recursive: true, force: true }).catch(() => undefined);
      reject(err);
    });
    child.on('close', async (code) => {
      try {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `piper exited ${code}`));
          return;
        }
        resolve(await readFile(wavPath));
      } catch (err) {
        reject(err);
      } finally {
        rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    });
    child.stdin.end(text);
  });
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/speak') {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = JSON.parse(await readBody(request));
    const text = String(body.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 2000) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'text is required' }));
      return;
    }
    const wav = await synthesize(text, body.language);
    response.writeHead(200, { 'Content-Type': 'audio/wav' });
    response.end(wav);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Piper listening on http://127.0.0.1:${port}`);
});
