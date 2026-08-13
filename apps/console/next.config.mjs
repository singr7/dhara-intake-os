/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The edge proxy serves the patient runner at / and the staff console under /console
  // on the same host, so one LAN URL covers both surfaces (infra/nginx/nginx.conf).
  basePath: '/console',
  // Standalone output keeps the console image small and dependency-complete (doc 10 §2).
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  eslint: {
    // Linting is a workspace-level task (turbo `lint`), not part of `next build`.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
