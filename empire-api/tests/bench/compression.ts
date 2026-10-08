import { fork, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';

const SOCKETS = Number(process.env.BENCH_SOCKETS ?? 50);
const FRAMES_PER_SOCKET = Number(process.env.BENCH_FRAMES ?? 400);
const BYTES_PER_MB = 1024 * 1024;

function syntheticFrame(index: number): string {
  const building = (id: number): number[] => [2997, id, 195 + (id % 7), 210, id % 4, 0, 4, 100, -1, -1, 0, 0];
  const data = {
    KID: 0,
    gca: {
      O: { OID: 40_000 + index, N: `owner${index}`, AP: [[0, 4408 + index, 573, 660, 1]] },
      BD: Array.from({ length: 120 }, (_, id) => building(id + index)),
      A: [1, 573, 660, 4408 + index, 85_778, 4, 4, 4, 4, 1, `castle ${index}`, 0],
    },
  };
  return `%xt%jaa%1%0%${JSON.stringify(data)}%`;
}

function sampleFrames(): string[] {
  const real = process.env.BENCH_REAL_FRAME;
  if (real && fs.existsSync(real)) return [fs.readFileSync(real, 'utf8').trim()];
  return Array.from({ length: 16 }, (_, index) => syntheticFrame(index));
}

function runServer(): void {
  const frames = sampleFrames();
  const server = new WebSocketServer({ port: 0, perMessageDeflate: { threshold: 0 } });
  server.on('connection', (socket) => {
    socket.on('message', () => {
      for (let index = 0; index < FRAMES_PER_SOCKET; index++) socket.send(frames[index % frames.length]);
    });
  });
  server.on('listening', () => process.send?.({ port: (server.address() as { port: number }).port }));
}

async function startServer(): Promise<{ child: ChildProcess; port: number }> {
  const child = fork(fileURLToPath(import.meta.url), ['server'], { execArgv: process.execArgv });
  const port = await new Promise<number>((resolve) => child.once('message', (message: any) => resolve(message.port)));
  return { child, port };
}

interface Measure {
  cpuMs: number;
  rssMb: number;
  externalMb: number;
  negotiated: boolean;
}

async function measure(port: number, deflate: boolean): Promise<Measure> {
  global.gc?.();
  const before = process.memoryUsage();
  const sockets = await Promise.all(
    Array.from(
      { length: SOCKETS },
      () =>
        new Promise<WebSocket>((resolve) => {
          const socket = new WebSocket(`ws://127.0.0.1:${port}`, { perMessageDeflate: deflate });
          socket.once('open', () => resolve(socket));
        }),
    ),
  );
  const negotiated = sockets[0].extensions.includes('permessage-deflate');
  const cpuBefore = process.cpuUsage();
  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve) => {
          let received = 0;
          socket.on('message', (message) => {
            message.toString();
            if (++received === FRAMES_PER_SOCKET) resolve();
          });
          socket.send('go');
        }),
    ),
  );
  const cpu = process.cpuUsage(cpuBefore);
  global.gc?.();
  const after = process.memoryUsage();
  for (const socket of sockets) socket.terminate();
  return {
    cpuMs: (cpu.user + cpu.system) / 1000,
    rssMb: (after.rss - before.rss) / BYTES_PER_MB,
    externalMb: (after.external + after.arrayBuffers - before.external - before.arrayBuffers) / BYTES_PER_MB,
    negotiated,
  };
}

async function main(): Promise<void> {
  const frames = sampleFrames();
  const raw = frames.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0);
  const packed = frames.reduce((sum, frame) => sum + deflateRawSync(frame).length, 0);
  const { child, port } = await startServer();
  try {
    const plain = await measure(port, false);
    const deflated = await measure(port, true);
    const total = SOCKETS * FRAMES_PER_SOCKET;
    const line = (label: string, result: Measure): string =>
      `  ${label.padEnd(12)} negotiated=${String(result.negotiated).padEnd(5)} cpu ${result.cpuMs.toFixed(0)}ms ` +
      `(${((result.cpuMs * 1000) / total).toFixed(1)}us/frame)  rss ${result.rssMb.toFixed(1)} MB  ` +
      `buffers ${result.externalMb.toFixed(1)} MB`;
    const kind = frames.length > 1 ? 'synthetic' : 'real';
    console.log(`\n  ${SOCKETS} sockets x ${FRAMES_PER_SOCKET} frames, ${kind} frames`);
    console.log(`  wire size: ${raw} -> ${packed} bytes deflated (${((packed / raw) * 100).toFixed(0)}%)`);
    console.log(line('no deflate', plain));
    console.log(line('deflate', deflated));
    console.log(`  deflate costs ${(deflated.cpuMs / plain.cpuMs).toFixed(1)}x the client CPU\n`);
  } finally {
    child.kill();
  }
}

if (process.argv[2] === 'server') runServer();
else await main();
