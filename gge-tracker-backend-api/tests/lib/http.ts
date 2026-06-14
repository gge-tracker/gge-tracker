/**
 * Thin axios wrapper
 */
import axios, { AxiosRequestConfig, Method } from 'axios';
import { randomUUID } from 'node:crypto';
import { config } from '../config';

export interface HttpResult {
  status: number;
  headers: Record<string, any>;
  body: any;
  raw: string;
  ms: number;
  networkError?: string;
}

export interface RequestOptions {
  method?: Method;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  clientIp?: string;
  timeoutMs?: number;
}

/** Generates a unique, routable-looking IPv4 so each call is its own rate-limit bucket */
export function uniqueIp(): string {
  const b = () => 1 + Math.floor(Math.random() * 254);
  return `${b()}.${b()}.${b()}.${b()}`;
}

const CIRCUIT_THRESHOLD = 10;
let consecutiveNetworkErrors = 0;
let circuitOpen = false;

export function isCircuitOpen(): boolean {
  return circuitOpen;
}

export function resetCircuit(): void {
  consecutiveNetworkErrors = 0;
  circuitOpen = false;
}

export async function request(options: RequestOptions): Promise<HttpResult> {
  const { method = 'GET', path, headers = {}, body, clientIp, timeoutMs } = options;
  const url = config.baseUrl + path;
  const ip = clientIp ?? uniqueIp();

  if (circuitOpen) {
    return { status: 0, headers: {}, body: undefined, raw: '', ms: 0, networkError: 'circuit-open: server unreachable' };
  }

  const axiosConfig: AxiosRequestConfig = {
    method,
    url,
    headers: {
      'X-Forwarded-For': ip,
      'User-Agent': `gge-api-test/${randomUUID().slice(0, 8)}`,
      ...headers,
    },
    data: body,
    timeout: timeoutMs ?? config.requestTimeoutMs,
    validateStatus: () => true,
    // Keep the raw payload so we can scan it for leaks regardless of content-type.
    transformResponse: [(d) => d],
    maxRedirects: 0,
  };

  const started = performance.now();
  try {
    const response = await axios.request(axiosConfig);
    const ms = performance.now() - started;
    const raw = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    let parsed: any = raw;
    const contentType = String(response.headers['content-type'] ?? '');
    if (contentType.includes('application/json')) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
    consecutiveNetworkErrors = 0;
    return { status: response.status, headers: response.headers as any, body: parsed, raw, ms };
  } catch (error: any) {
    const ms = performance.now() - started;
    consecutiveNetworkErrors++;
    if (consecutiveNetworkErrors >= CIRCUIT_THRESHOLD) circuitOpen = true;
    return {
      status: 0,
      headers: {},
      body: undefined,
      raw: '',
      ms,
      networkError: error?.code ?? error?.message ?? String(error),
    };
  }
}
