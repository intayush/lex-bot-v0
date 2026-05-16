/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@legal-chatbot/shared'],
  experimental: {
    serverActions: {
      // Stable encryption key for server action IDs across deploys.
      // Without this, each build generates new action IDs, causing
      // "Failed to find Server Action" errors when Netlify serves
      // cached HTML from a previous build.
      encryptionKey: process.env.SERVER_ACTIONS_KEY || 'dev-key-must-be-exactly-32chars!',
    },
  },
};

export default nextConfig;
