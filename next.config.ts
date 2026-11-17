import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  experimental: { agentUpgrade: 'security' },
};
export default config;
