/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Note: Do NOT use output: 'standalone' with Amplify SSR hosting
};

module.exports = nextConfig;