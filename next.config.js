// Export statique (Cloudflare Workers, assets seuls) : activé UNIQUEMENT par CF_STATIC_EXPORT=1 (voir test-env/deployer-cloudflare-test.ps1).
// Sans cette variable, la configuration est celle d'avant : npm run dev, next build et Netlify ne changent pas.
const staticExport = process.env.CF_STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  ...(staticExport ? { output: 'export', trailingSlash: true } : {}),
};

module.exports = nextConfig;
