import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config silences the "webpack config present but no turbopack config" error.
  // Turbopack generally handles TF.js fine without aliasing in dev mode.
  turbopack: {},
  // Webpack alias for `next build` (non-turbopack production builds)
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tensorflow/tfjs-core/dist/ops/ops_for_converter': false,
    }
    return config
  },
};

export default nextConfig;
