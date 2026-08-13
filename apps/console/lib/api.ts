/**
 * Console → API access helpers. Console routes are cookie-authenticated (ADR-012), so
 * every request must carry credentials; forgetting that is the classic "works in curl,
 * 401 in the browser" bug.
 */
export const API_BASE = process.env['NEXT_PUBLIC_API_BASE'] ?? '/api/v1';

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

export const defaultRequestInit: RequestInit = {
  credentials: 'include',
  headers: { accept: 'application/json' },
};
