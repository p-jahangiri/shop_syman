import { PassThrough } from 'node:stream';
import { createAdminServer } from './server.mjs';

// Vercel rejects payloads above 4.5 MB before invocation. Keep a conservative,
// explicit request ceiling here; the existing BFF's smaller route limits apply too.
export const vercelRequestLimit = 4 * 1024 * 1024;

function problem(response, status, title) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  response.end(JSON.stringify({ title }));
}

function requestBytes(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', failed);
      request.removeListener('aborted', aborted);
      if (error) reject(error);
      else resolve(value);
    };
    const data = (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > vercelRequestLimit) {
        finish(null);
        request.resume();
      } else chunks.push(chunk);
    };
    const end = () => finish(Buffer.concat(chunks, size));
    const failed = (error) => finish(null, error);
    const aborted = () => failed(new Error('Request aborted.'));
    request.on('data', data);
    request.once('end', end);
    request.once('error', failed);
    request.once('aborted', aborted);
  });
}

export function createVercelAdminHandler(options = {}) {
  // The Vercel CDN serves dist. Reuse the same BFF policy implementation without
  // binding a listener or forwarding requests directly around its route guards.
  const server = createAdminServer(options);
  const dispatch = server.listeners('request')[0];
  return async function handler(request, response) {
    if (!request.url?.startsWith('/api/')) {
      request.resume();
      problem(response, 404, 'not_found');
      return;
    }
    if (Number(request.headers['content-length']) > vercelRequestLimit) {
      request.resume();
      problem(response, 413, 'vercel_request_too_large');
      return;
    }
    try {
      // Do not read request.body: Vercel's JSON helper would deserialize money
      // and multipart bytes. Forward the original bytes and query unchanged.
      const raw = await requestBytes(request);
      if (response.destroyed || response.writableEnded) return;
      if (raw === null) {
        problem(response, 413, 'vercel_request_too_large');
        return;
      }
      const buffered = new PassThrough();
      buffered.method = request.method;
      buffered.url = request.url;
      buffered.headers = request.headers;
      const abort = () => buffered.emit('aborted');
      const sourceError = () => response.destroy();
      request.once('aborted', abort);
      request.once('error', sourceError);
      try {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            response.removeListener('finish', complete);
            response.removeListener('close', complete);
            response.removeListener('error', failed);
          };
          const complete = () => {
            cleanup();
            resolve();
          };
          const failed = (error) => {
            cleanup();
            reject(error);
          };
          response.once('finish', complete);
          response.once('close', complete);
          response.once('error', failed);
          Promise.resolve(dispatch(buffered, response)).catch(failed);
          buffered.end(raw);
        });
      } finally {
        request.removeListener('aborted', abort);
        request.removeListener('error', sourceError);
        buffered.destroy();
      }
    } catch {
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent) problem(response, 503, 'unavailable');
      else response.destroy();
    }
  };
}
