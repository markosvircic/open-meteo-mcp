import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenMeteoClient } from './client.js';

type Internal = {
  client: { request: (...args: unknown[]) => Promise<unknown> };
  retryOrMap: (instance: unknown, error: unknown) => Promise<unknown>;
};

function axiosError(status: number, reason?: string, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    config: { url: '/v1/ecmwf' },
    response: { status, data: reason ? { reason } : {}, headers },
  });
}

describe('OpenMeteoClient retry', () => {
  let client: OpenMeteoClient;
  let internal: Internal;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.OPEN_METEO_RETRY_DELAYS_MS = '3000,10000,20000';
    client = new OpenMeteoClient();
    internal = client as unknown as Internal;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.OPEN_METEO_RETRY_DELAYS_MS;
  });

  it('retries a per-minute 429 and returns the retried response', async () => {
    const request = vi.spyOn(internal.client, 'request').mockResolvedValueOnce({ data: { ok: 1 } });
    const promise = internal.retryOrMap(
      internal.client,
      axiosError(429, 'Minutely API request limit exceeded. Please try again in one minute.'),
    );
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual({ data: { ok: 1 } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After when present', async () => {
    const request = vi.spyOn(internal.client, 'request').mockResolvedValueOnce({ data: {} });
    const promise = internal.retryOrMap(
      internal.client,
      axiosError(429, undefined, { 'retry-after': '7' }),
    );
    await vi.advanceTimersByTimeAsync(6999);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry an hourly or daily 429', async () => {
    const request = vi.spyOn(internal.client, 'request');
    await expect(
      internal.retryOrMap(internal.client, axiosError(429, 'Hourly API request limit exceeded.')),
    ).rejects.toThrow('Open-Meteo rate limit reached. Please retry later.');
    expect(request).not.toHaveBeenCalled();
  });

  it('gives up after the configured number of retries', async () => {
    const err = axiosError(429);
    (err.config as { __retryCount?: number }).__retryCount = 3;
    await expect(internal.retryOrMap(internal.client, err)).rejects.toThrow(
      'Open-Meteo rate limit reached. Please retry later.',
    );
  });

  it('does not retry a 400', async () => {
    const request = vi.spyOn(internal.client, 'request');
    await expect(internal.retryOrMap(internal.client, axiosError(400, 'bad'))).rejects.toThrow(
      'Invalid request parameters: bad',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
