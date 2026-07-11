import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway deploys via standalone output for a smaller image
  output: "standalone",
  // Pin the workspace root — a stray lockfile in the user home directory
  // otherwise makes Next trace files from the wrong root.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
