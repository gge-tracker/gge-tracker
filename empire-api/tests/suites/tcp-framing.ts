import { Report, Section } from '../lib/report.js';
import { GgeEmpire4KingdomsTcp } from '../../src/utils/ws/empire4kingdoms-tcp.js';

const CHUNK_BYTES = 64 * 1024;

interface Reassembler {
  frames: string[];
  feed(chunk: Buffer): void;
}

function reassembler(): Reassembler {
  const socket = new GgeEmpire4KingdomsTcp('tcp://127.0.0.1:9', 'TcpFraming', 'user', 'password', false);
  const frames: string[] = [];
  (socket as unknown as { _onMessage: (message: string) => void })._onMessage = (message): void => {
    frames.push(message);
  };
  const handle = (socket as unknown as { handleTcpData: (data: Buffer) => void }).handleTcpData.bind(socket);
  return { frames, feed: handle };
}

function chunked(data: Buffer, size: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += size) chunks.push(data.subarray(offset, offset + size));
  return chunks;
}

function frameOf(body: string): Buffer {
  return Buffer.from(`%xt%gaa%1%0%${body}%\u0000`, 'utf8');
}

function framesInOneChunk(section: Section): void {
  const { frames, feed } = reassembler();
  feed(Buffer.concat([frameOf('{"A":1}'), frameOf('{"A":2}'), Buffer.from('%xt%gaa%1%0%{"A"')]));
  feed(Buffer.from(':3}%\u0000'));
  section.expect('several frames in one chunk, and a frame cut across two, all come out whole', {
    ok: frames.length === 3 && frames[2] === '%xt%gaa%1%0%{"A":3}%',
    detail: JSON.stringify(frames),
  });
}

function multibyteCharacterCutInHalf(section: Section): void {
  const { frames, feed } = reassembler();
  const frame = frameOf('{"N":"château"}');
  const cut = frame.indexOf(Buffer.from('â')) + 1;
  feed(frame.subarray(0, cut));
  feed(frame.subarray(cut));
  section.expect('a UTF-8 character split between two chunks is decoded once whole', {
    ok: frames[0] === '%xt%gaa%1%0%{"N":"château"}%',
    detail: JSON.stringify(frames),
  });
}

function largeFrameIsLinear(section: Section): void {
  const body = `{"AI":[${Array.from({ length: 200_000 }, (_, index) => `[${index},1,2,3]`).join(',')}]}`;
  const frame = frameOf(body);
  const singleChunk = reassembler();
  const startedSingle = process.hrtime.bigint();
  singleChunk.feed(frame);
  const singleMs = Number(process.hrtime.bigint() - startedSingle) / 1e6;

  const { frames, feed } = reassembler();
  const chunks = chunked(frame, CHUNK_BYTES);
  const startedChunked = process.hrtime.bigint();
  for (const chunk of chunks) feed(chunk);
  const chunkedMs = Number(process.hrtime.bigint() - startedChunked) / 1e6;

  const megabytes = (frame.length / 1024 / 1024).toFixed(1);
  section.expect(`a ${megabytes} MB frame in ${chunks.length} chunks of 64 KB is reassembled whole`, {
    ok: frames.length === 1 && frames[0].length === frame.length - 1,
    detail: `${frames.length} frame(s), ${frames[0]?.length ?? 0} chars`,
  });
  section.expect('reassembling it costs about the same as receiving it in one chunk', {
    ok: chunkedMs < Math.max(singleMs * 4, 15),
    detail: `${chunkedMs.toFixed(1)}ms in chunks, ${singleMs.toFixed(1)}ms in one`,
  });
}

function unterminatedFrameIsDropped(section: Section): void {
  const { frames, feed } = reassembler();
  const garbage = Buffer.alloc(CHUNK_BYTES, 0x41);
  for (let index = 0; index < 260; index++) feed(garbage);
  feed(frameOf('{"A":1}'));
  section.expect('more than 16 MB without a terminator is dropped, and the next frame still comes out', {
    ok: frames.length === 1 && frames[0].endsWith('{"A":1}%'),
    detail: `${frames.length} frame(s): ${frames.map((frame) => frame.slice(-12)).join(', ')}`,
  });
}

export async function runTcpFraming(report: Report): Promise<void> {
  const section = report.section('tcp-framing');
  framesInOneChunk(section);
  multibyteCharacterCutInHalf(section);
  largeFrameIsLinear(section);
  unterminatedFrameIsDropped(section);
}
