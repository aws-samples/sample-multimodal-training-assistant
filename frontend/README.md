# Frontend — AI Learning Platform

Next.js + React + TypeScript frontend with CopilotKit for the chat interface. Deploys as a static site to S3/CloudFront.

## Prerequisites

- Node.js 18+
- npm

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
# Generate from deployed infrastructure (recommended)
cd .. && ./deploy.sh -e dev -i

# Or copy the example and fill in values manually
cp .env.example .env.local
```

3. Start the development server:
```bash
npm run dev
```

The frontend runs on http://localhost:3000.

## Available Scripts

- `dev` — Start Next.js dev server
- `build` — Build static export for production
- `lint` — Run ESLint

## Documentation

- [CopilotKit Documentation](https://docs.copilotkit.ai)
- [Next.js Documentation](https://nextjs.org/docs)
- [Strands Agents Documentation](https://strandsagents.com/latest/documentation/docs/)

## Troubleshooting

### Agent Connection Issues
If the chat is not connecting, make sure:
1. The agent is running on port 8000 (or `USE_RUNTIME=true` in `.env.local` for AgentCore Runtime)
2. AWS credentials are configured
3. `.env.local` has the correct Cognito and runtime configuration
