/** @type {import('next').NextConfig} */
const nextConfig = {
    // Pure static HTML: served from a CDN (Render static site), no server to cold-start.
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true },
    poweredByHeader: false,
    reactStrictMode: true,
    // Type errors still fail the build; linting is not set up for this package yet.
    eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
