import { NestFastifyApplication } from '@nestjs/platform-fastify';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function api(
  app: NestFastifyApplication,
  method: HttpMethod,
  url: string,
  opts?: { token?: string; payload?: unknown },
) {
  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  if (opts?.payload !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return app.inject({
    method,
    url,
    headers,
    payload: opts?.payload as string | object | Buffer | NodeJS.ReadableStream,
  });
}

export function jsonBody(res: { json: () => unknown }): Record<string, unknown> {
  const body = res.json();
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return { value: body };
}
