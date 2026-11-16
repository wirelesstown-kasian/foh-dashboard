import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/onboarding': ['./private-assets/initial-handbook.docx'],
  },
};

export default nextConfig;
