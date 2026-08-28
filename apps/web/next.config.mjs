/** @type {import('next').NextConfig} */
const nextConfig = {
  // Linting for the whole monorepo runs via the root `pnpm lint` (ESLint flat config).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
