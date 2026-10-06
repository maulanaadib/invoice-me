import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Logo/signature uploads go through server actions (FormData). The default
    // 1 MB body limit is below UPLOAD_MAX_MB (2 MB) + multipart overhead.
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
