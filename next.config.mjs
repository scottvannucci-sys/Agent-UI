/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the server bundle lean; node:sqlite is a builtin and needs no shimming.
  serverExternalPackages: [],
};

export default nextConfig;
