/**
 * Generator flow tests — verify every HTTP call made to the OutSystems API.
 * No real credentials needed: fetch and the token manager are both mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAndDeployApp } from '../src/services/outsystems-api.worker';
import {
  OutSystemsApiClient,
  withRetry,
  pollWithBackoff,
  ApiError,
} from '../src/utils/apiClient';
import { Env } from '../src/worker/types';

// ── Mock the token manager so no real auth is attempted ──────────────────────
vi.mock('../src/services/token-manager.worker', () => ({
  getValidOutSystemsToken: vi.fn().mockResolvedValue('mock-token-abc123'),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const mockEnv: Env = {
  OS_HOSTNAME: 'test.outsystems.dev',
  OS_USERNAME: 'test@example.com',
  OS_PASSWORD: 'test-password',
  OS_DEV_ENVID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  COGNITO_REFRESH_TOKEN: 'mock-refresh',
  MCP_SERVER_SECRET: 'test-secret',
  LOG_LEVEL: 'silent',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Collect every yielded string, swallowing a final throw so callers can
 *  assert on yields independently of whether the generator threw. */
async function collectYields(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const v of gen) out.push(v);
  } catch {
    // intentional — caller checks yields; use expectThrow for the error
  }
  return out;
}

/** Drain the generator and return the thrown error (fails if nothing throws). */
async function expectThrow(gen: AsyncGenerator<string>): Promise<Error> {
  try {
    for await (const _ of gen) {
      // drain
    }
  } catch (e: any) {
    return e as Error;
  }
  throw new Error('Expected generator to throw but it completed normally');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OutSystemsApiClient — HTTP request structure
// ─────────────────────────────────────────────────────────────────────────────

describe('OutSystemsApiClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the correct URL from hostname + endpoint', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ key: 'j1', status: 'Pending' }));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await client.request('/api/app-generation/v1alpha4/jobs', {
      token: 'tk',
      method: 'POST',
      body: { prompt: 'test' },
    });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://my-org.outsystems.dev/api/app-generation/v1alpha4/jobs');
  });

  it('sends Authorization: Bearer <token>', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await client.request('/endpoint', { token: 'secret-xyz' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer secret-xyz');
  });

  it('adds Content-Type: application/json and serialises body when body provided', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await client.request('/endpoint', { token: 'tk', method: 'POST', body: { foo: 'bar' } });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe('{"foo":"bar"}');
  });

  it('omits Content-Type when no body and no explicit header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await client.request('/endpoint', { token: 'tk' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('sends Content-Type when passed via explicit headers (body-less POST)', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await client.request('/endpoint', {
      token: 'tk',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBeUndefined();
  });

  it('throws ApiError with the correct status on a 4xx response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await expect(client.request('/endpoint', { token: 'tk' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
  });

  it('throws ApiError(415) on Unsupported Media Type', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unsupported Media Type', { status: 415 }));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await expect(
      client.request('/endpoint', { token: 'tk', method: 'POST' }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 415 });
  });

  it('throws ApiError(500) on a server error', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await expect(client.request('/endpoint', { token: 'tk' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
    });
  });

  it('throws TimeoutError when fetch aborts', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    const client = new OutSystemsApiClient('my-org.outsystems.dev');
    await expect(client.request('/endpoint', { token: 'tk', timeout: 1 })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. withRetry — retry logic
// ─────────────────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('returns immediately on first-attempt success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, 3, 0)).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on 5xx and succeeds on the third attempt', async () => {
    const err = new ApiError(503, '/endpoint');
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue('recovered');
    expect(await withRetry(fn, 3, 0)).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx (other than 429) — fails immediately', async () => {
    const err = new ApiError(415, '/endpoint');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, 0)).rejects.toMatchObject({ status: 415 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries on 429 Too Many Requests', async () => {
    const err = new ApiError(429, '/endpoint');
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');
    expect(await withRetry(fn, 3, 0)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    const err = new ApiError(500, '/endpoint');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, 0)).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-API errors (network errors etc.)', async () => {
    const err = new Error('Network failure');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, 3, 0)).rejects.toThrow('Network failure');
    expect(fn).toHaveBeenCalledTimes(3); // non-ApiError errors are retried
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. pollWithBackoff — polling logic
// ─────────────────────────────────────────────────────────────────────────────

describe('pollWithBackoff', () => {
  const FAST = { initialInterval: 0, maxInterval: 0 };

  it('returns on the very first poll when condition is already met', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'Done' });
    const result = await pollWithBackoff<{ status: string }>(fn, r => r.status === 'Done', r => r.status === 'Failed', { maxAttempts: 5, ...FAST });
    expect(result).toEqual({ status: 'Done' });
    expect(fn).toHaveBeenCalledOnce();
  });

  it('keeps polling until the success condition is met', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ status: 'Pending' })
      .mockResolvedValueOnce({ status: 'Running' })
      .mockResolvedValue({ status: 'Done' });
    const result = await pollWithBackoff<{ status: string }>(fn, r => r.status === 'Done', r => r.status === 'Failed', { maxAttempts: 10, ...FAST });
    expect(result).toEqual({ status: 'Done' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws when the failure condition is met', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ status: 'Running' })
      .mockResolvedValue({ status: 'Failed' });
    await expect(
      pollWithBackoff<{ status: string }>(fn, r => r.status === 'Done', r => r.status === 'Failed', { maxAttempts: 10, ...FAST }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws a timeout error after maxAttempts without resolution', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 'Running' });
    await expect(
      pollWithBackoff<{ status: string }>(fn, r => r.status === 'Done', r => r.status === 'Failed', { maxAttempts: 3, ...FAST }),
    ).rejects.toThrow('Polling timeout');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onProgress on each poll attempt', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ status: 'Running' })
      .mockResolvedValue({ status: 'Done' });
    const onProgress = vi.fn();
    await pollWithBackoff(fn, r => r.status === 'Done', r => r.status === 'Failed', { maxAttempts: 5, ...FAST, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. createAndDeployApp — full pipeline integration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('createAndDeployApp', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // Returns a fetch mock that drives the happy path.
  // Job status: first call → ReadyToGenerate, second+ → Done
  function happyPathFetch() {
    let jobStatusCalls = 0;
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const method = opts?.method ?? 'GET';

      if (url.endsWith('/jobs') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Pending' }));

      if (url.includes('/jobs/job-abc') && !url.includes('/generation') && method === 'GET') {
        jobStatusCalls++;
        return Promise.resolve(
          jobStatusCalls === 1
            ? jsonResponse({ key: 'job-abc', status: 'ReadyToGenerate' })
            : jsonResponse({ key: 'job-abc', status: 'Done', appSpec: { appKey: 'app-xyz' } }),
        );
      }

      if (url.includes('/generation') && method === 'POST')
        return Promise.resolve(jsonResponse({}));

      if (url.endsWith('/publications') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'pub-123', status: 'Queued' }));

      if (url.includes('/publications/pub-123') && method === 'GET')
        return Promise.resolve(jsonResponse({ key: 'pub-123', status: 'Finished', applicationKey: 'app-xyz', applicationRevision: 1 }));

      if (url.includes('/applications/app-xyz') && method === 'GET')
        return Promise.resolve(jsonResponse({ key: 'app-xyz', name: 'TestApp', urlPath: 'TestApp' }));

      return Promise.resolve(new Response(`Unexpected: ${method} ${url}`, { status: 500 }));
    });
  }

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('yields step messages for all 7 steps and ends with 🎉', async () => {
    happyPathFetch();
    const yields = await collectYields(createAndDeployApp('Create a task manager', mockEnv));

    expect(yields.some(y => y.includes('Authenticating'))).toBe(true);
    for (let step = 1; step <= 7; step++) {
      expect(yields.some(y => y.includes(`Step ${step}`))).toBe(true);
    }
    expect(yields.some(y => y.includes('🎉'))).toBe(true);
  });

  it('constructs the final URL with the -dev.outsystems.app pattern', async () => {
    happyPathFetch();
    const yields = await collectYields(createAndDeployApp('Create a task manager', mockEnv));
    const successMsg = yields.find(y => y.includes('🎉'));
    expect(successMsg).toContain('https://test-dev.outsystems.app/TestApp');
  });

  // ── Step 1: job creation request ────────────────────────────────────────────

  it('Step 1 — POST /jobs with correct headers and body', async () => {
    happyPathFetch();
    await collectYields(createAndDeployApp('Create a task manager', mockEnv));

    const call = mockFetch.mock.calls.find(([url, opts]) =>
      url.endsWith('/jobs') && opts?.method === 'POST',
    )!;
    expect(call).toBeDefined();
    const [, opts] = call;
    expect(opts.headers['Authorization']).toBe('Bearer mock-token-abc123');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ portfolioKey: null });
  });

  // ── Step 3: trigger generation request ──────────────────────────────────────

  it('Step 3 — POST /generation sends Content-Type: application/json with prompt as JSON string body', async () => {
    happyPathFetch();
    await collectYields(createAndDeployApp('Create a task manager', mockEnv));

    const call = mockFetch.mock.calls.find(([url, opts]) =>
      url.includes('/generation') && opts?.method === 'POST',
    )!;
    expect(call).toBeDefined();
    const [, opts] = call;
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBe('Bearer mock-token-abc123');
    expect(JSON.parse(opts.body as string)).toBe('Create a task manager');
  });

  it('Step 3 — /generation URL includes the job ID', async () => {
    happyPathFetch();
    await collectYields(createAndDeployApp('Create a task manager', mockEnv));

    const call = mockFetch.mock.calls.find(([url, opts]) =>
      url.includes('/generation') && opts?.method === 'POST',
    )!;
    expect(call[0]).toContain('/jobs/job-abc/generation');
  });

  // ── Step 5: publication request ─────────────────────────────────────────────

  it('Step 5 — POST /publications with correct applicationKey and revision', async () => {
    happyPathFetch();
    await collectYields(createAndDeployApp('Create a task manager', mockEnv));

    const call = mockFetch.mock.calls.find(([url, opts]) =>
      url.endsWith('/publications') && opts?.method === 'POST',
    )!;
    expect(call).toBeDefined();
    const body = JSON.parse(call[1].body as string);
    expect(body.applicationKey).toBe('app-xyz');
    expect(body.applicationRevision).toBe(1);
  });

  // ── Error cases ──────────────────────────────────────────────────────────────

  it('throws and yields ❌ when OS_HOSTNAME is missing', async () => {
    const env = { ...mockEnv, OS_HOSTNAME: '' };
    const err = await expectThrow(createAndDeployApp('Create an app', env as Env));
    expect(err.message).toContain('OS_HOSTNAME');
  });

  it('Step 1 failure — throws when job creation returns 500', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response('Server Error', { status: 500 })));
    vi.useFakeTimers();
    const errPromise = expectThrow(createAndDeployApp('Create an app', mockEnv));
    await vi.runAllTimersAsync();
    const err = await errPromise;
    vi.useRealTimers();
    expect(err.message).toBeTruthy();
  });

  it('Step 2 failure — throws when job status goes to Failed', async () => {
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const method = opts?.method ?? 'GET';
      if (url.endsWith('/jobs') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Pending' }));
      if (url.includes('/jobs/job-abc') && method === 'GET')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Failed' }));
      return Promise.resolve(new Response('Unexpected', { status: 500 }));
    });
    const err = await expectThrow(createAndDeployApp('Create an app', mockEnv));
    expect(err.message).toBeTruthy();
  });

  it('Step 3 failure — 415 on /generation yields ❌ and throws', async () => {
    let jobStatusCalls = 0;
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const method = opts?.method ?? 'GET';
      if (url.endsWith('/jobs') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Pending' }));
      if (url.includes('/jobs/job-abc') && !url.includes('/generation') && method === 'GET') {
        jobStatusCalls++;
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'ReadyToGenerate' }));
      }
      if (url.includes('/generation') && method === 'POST')
        return Promise.resolve(new Response('Unsupported Media Type', { status: 415 }));
      return Promise.resolve(new Response('Unexpected', { status: 500 }));
    });

    const yields = await collectYields(createAndDeployApp('Create an app', mockEnv));
    expect(yields.some(y => y.includes('❌'))).toBe(true);
    const err = await expectThrow(createAndDeployApp('Create an app', mockEnv));
    expect(err.message).toBeTruthy();
  });

  it('Step 4 failure — surfaces the OutSystems error message when generation fails', async () => {
    let jobStatusCalls = 0;
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const method = opts?.method ?? 'GET';
      if (url.endsWith('/jobs') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Pending' }));
      if (url.includes('/jobs/job-abc') && !url.includes('/generation') && method === 'GET') {
        jobStatusCalls++;
        return Promise.resolve(
          jobStatusCalls === 1
            ? jsonResponse({ key: 'job-abc', status: 'ReadyToGenerate' })
            : jsonResponse({ key: 'job-abc', status: 'Failed', error: { message: 'Prompt too complex' } }),
        );
      }
      if (url.includes('/generation') && method === 'POST')
        return Promise.resolve(jsonResponse({}));
      return Promise.resolve(new Response('Unexpected', { status: 500 }));
    });

    const err = await expectThrow(createAndDeployApp('Create an app', mockEnv));
    expect(err.message).toBe('Prompt too complex');
  });

  it('Step 5 failure — throws when publication creation returns 500', async () => {
    let jobStatusCalls = 0;
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const method = opts?.method ?? 'GET';
      if (url.endsWith('/jobs') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Pending' }));
      if (url.includes('/jobs/job-abc') && !url.includes('/generation') && method === 'GET') {
        jobStatusCalls++;
        return Promise.resolve(
          jobStatusCalls === 1
            ? jsonResponse({ key: 'job-abc', status: 'ReadyToGenerate' })
            : jsonResponse({ key: 'job-abc', status: 'Done', appSpec: { appKey: 'app-xyz' } }),
        );
      }
      if (url.includes('/generation') && method === 'POST')
        return Promise.resolve(jsonResponse({}));
      if (url.endsWith('/publications') && method === 'POST')
        return Promise.resolve(new Response('Server Error', { status: 500 }));
      return Promise.resolve(new Response('Unexpected', { status: 500 }));
    });

    vi.useFakeTimers();
    const errPromise = expectThrow(createAndDeployApp('Create an app', mockEnv));
    await vi.runAllTimersAsync();
    const err = await errPromise;
    vi.useRealTimers();
    expect(err.message).toBeTruthy();
  });

  it('Step 6 failure — surfaces OutSystems error when deployment fails', async () => {
    let jobStatusCalls = 0;
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const method = opts?.method ?? 'GET';
      if (url.endsWith('/jobs') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Pending' }));
      if (url.includes('/jobs/job-abc') && !url.includes('/generation') && method === 'GET') {
        jobStatusCalls++;
        return Promise.resolve(
          jobStatusCalls === 1
            ? jsonResponse({ key: 'job-abc', status: 'ReadyToGenerate' })
            : jsonResponse({ key: 'job-abc', status: 'Done', appSpec: { appKey: 'app-xyz' } }),
        );
      }
      if (url.includes('/generation') && method === 'POST')
        return Promise.resolve(jsonResponse({}));
      if (url.endsWith('/publications') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'pub-123', status: 'Queued' }));
      if (url.includes('/publications/pub-123') && method === 'GET')
        return Promise.resolve(
          jsonResponse({ key: 'pub-123', status: 'Failed', applicationKey: 'app-xyz', applicationRevision: 1, error: { message: 'Deployment timed out' } }),
        );
      return Promise.resolve(new Response('Unexpected', { status: 500 }));
    });

    const err = await expectThrow(createAndDeployApp('Create an app', mockEnv));
    expect(err.message).toBe('Deployment timed out');
  });

  it('Step 7 failure — throws when application details has no urlPath', async () => {
    let jobStatusCalls = 0;
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const method = opts?.method ?? 'GET';
      if (url.endsWith('/jobs') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'job-abc', status: 'Pending' }));
      if (url.includes('/jobs/job-abc') && !url.includes('/generation') && method === 'GET') {
        jobStatusCalls++;
        return Promise.resolve(
          jobStatusCalls === 1
            ? jsonResponse({ key: 'job-abc', status: 'ReadyToGenerate' })
            : jsonResponse({ key: 'job-abc', status: 'Done', appSpec: { appKey: 'app-xyz' } }),
        );
      }
      if (url.includes('/generation') && method === 'POST')
        return Promise.resolve(jsonResponse({}));
      if (url.endsWith('/publications') && method === 'POST')
        return Promise.resolve(jsonResponse({ key: 'pub-123', status: 'Queued' }));
      if (url.includes('/publications/pub-123') && method === 'GET')
        return Promise.resolve(jsonResponse({ key: 'pub-123', status: 'Finished', applicationKey: 'app-xyz', applicationRevision: 1 }));
      if (url.includes('/applications/app-xyz') && method === 'GET')
        return Promise.resolve(jsonResponse({ key: 'app-xyz', name: 'TestApp', urlPath: '' }));
      return Promise.resolve(new Response('Unexpected', { status: 500 }));
    });

    const err = await expectThrow(createAndDeployApp('Create an app', mockEnv));
    expect(err.message).toContain('URL');
  });
});
