# Cloudflare AI Setup Guide

This guide will help you set up Cloudflare Workers AI for the hackathon platform, including both direct AI inference and AI Gateway monitoring.

## Prerequisites

- A Cloudflare account
- Workers AI enabled on your account
- API token with appropriate permissions

## Step 1: Enable Workers AI

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **AI > Workers AI**
3. If prompted, agree to the terms and enable Workers AI for your account

## Step 2: Create an API Token

1. Go to **My Profile > API Tokens** in your Cloudflare dashboard
2. Click **Create Token**
3. Choose **Create Custom Token**
4. Give it a name like "TanStack AI Token"
5. Add the following permissions:
   - **Account > Workers AI > Read**
   - **Account > AI Gateway > Read** (if using gateway)
   - **Account > Account Settings > Read** (to get account ID)
6. Click **Continue to summary** and create the token
7. **Important**: Copy and save the token - you won't be able to see it again!

## Step 3: Get Your Account ID

1. In your Cloudflare dashboard, go to **Workers** (or any page that shows your account)
2. Your Account ID is displayed in the URL or in the right sidebar
3. Copy this ID for the environment variables

## Step 4: Create an AI Gateway (Optional but Recommended)

AI Gateway provides monitoring, rate limiting, and analytics for your AI requests.

1. In your Cloudflare dashboard, go to **AI > AI Gateway**
2. Click **Create Gateway**
3. Give it a name like "tanstack-ai-gateway"
4. Choose your account and region
5. Click **Create**
6. Copy the Gateway ID from the gateway details page

### Step 4a: Enable Authenticated Gateway (Recommended for Production)

Authenticated Gateway adds security by requiring a valid authorization token for each request. This is especially important when storing logs, as it prevents unauthorized access.

1. In your Cloudflare dashboard, go to **AI > AI Gateway > [Your Gateway] > Settings**
2. Click **Create authentication token** to generate a custom token with "Run" permissions
3. **Important**: Copy and save this token immediately - you won't be able to see it again!
4. Toggle on **Authenticated Gateway**
5. Set the `CLOUDFLARE_GATEWAY_AUTH_TOKEN` environment variable (see below)

### Step 4b: Set Up OpenAI Provider (Optional)

OpenAI models can be used through Cloudflare AI Gateway. **We use Provider Keys** (configured in the dashboard) - no tokens needed in code.

**Set Up Provider Keys in Dashboard**

1. Sign up for an OpenAI account at [https://openai.com/](https://openai.com/) if you haven't already
2. Get your OpenAI API token from your OpenAI dashboard
3. In your Cloudflare dashboard, go to **AI > AI Gateway > [Your Gateway] > Provider Keys**
4. Click **+ Add** next to OpenAI
5. Enter your OpenAI API token
6. Click **Save** - the gateway will securely store and automatically use this key
7. **That's it!** No code changes or environment variables needed

The gateway will automatically inject the stored OpenAI key into all requests - you don't need to set any OpenAI-related environment variables.

**Available OpenAI Models:**
- `gpt-5-nano` - **Default** - OpenAI's GPT-5 nano model.
  - **Performance**: Fast inference, good for general purpose tasks.
  - **Capabilities**: Reasoning, Streaming, Structured Outputs, Tool Calling
  - **Pricing**: Check Cloudflare Workers AI Pricing for current rates.
  - See [OpenAI documentation](https://developers.cloudflare.com/ai-gateway/usage/providers/openai/) for full list

**Note**: OpenAI models use the OpenAI endpoint through AI Gateway, so you still need `CLOUDFLARE_GATEWAY_ID` set.

## Environment Variables Setup

Cloudflare AI operations run in Convex, so the environment variables only need to be set in your Convex environment variables.

**Important**: These variables must be set in Convex, not in your local `.env` file or Netlify. The Convex environment is separate and shared across all deployments.

### Development Environment

Set environment variables for your development Convex deployment:

```bash
# Set required environment variables (development)
npx convex env set CLOUDFLARE_API_TOKEN your_api_token_here
npx convex env set CLOUDFLARE_ACCOUNT_ID your_account_id_here

# Set optional gateway variable (if using AI Gateway)
npx convex env set CLOUDFLARE_GATEWAY_ID your_gateway_id_here

# Set optional gateway authentication token (if Authenticated Gateway is enabled)
npx convex env set CLOUDFLARE_GATEWAY_AUTH_TOKEN your_gateway_auth_token_here
```

### Production Environment

Set environment variables for your production Convex deployment:

```bash
# Set required environment variables (production)
npx convex env set CLOUDFLARE_API_TOKEN your_api_token_here --prod
npx convex env set CLOUDFLARE_ACCOUNT_ID your_account_id_here --prod

# Set optional gateway variable (if using AI Gateway)
npx convex env set CLOUDFLARE_GATEWAY_ID your_gateway_id_here --prod

# Set optional gateway authentication token (if Authenticated Gateway is enabled)
npx convex env set CLOUDFLARE_GATEWAY_AUTH_TOKEN your_gateway_auth_token_here --prod
```

### Using the Convex Dashboard

Alternatively, you can set them via the Convex dashboard:

1. Go to your [Convex Dashboard](https://dashboard.convex.dev)
2. Select your project
3. Go to **Settings > Environment Variables**
4. Select the environment (Development or Production) from the dropdown
5. Add the following variables:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_GATEWAY_ID` (optional)
   - `CLOUDFLARE_GATEWAY_AUTH_TOKEN` (optional, required if Authenticated Gateway is enabled)
6. Click **Save** - Convex will automatically redeploy your functions

**Note**: Since Cloudflare AI runs in Convex, you don't need to set these variables in your local `.env` file or Netlify. This also avoids Netlify's 10-26 second function timeout limits, as Convex actions can run for up to 10 minutes.

## Testing Your Setup

1. Start your development server: `pnpm dev`
2. Navigate to `/app/ai-playground`
3. Try the **"Direct Workers AI"** option first - this should work immediately
4. If you set up a gateway, try the **"AI Gateway"** option
5. Use the **"Gateway Diagnostics"** tab to test your gateway connectivity

## Troubleshooting

### "Missing required Cloudflare AI environment variables"

- Make sure you've set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your Convex environment variables
- **For development**: Use `npx convex env set CLOUDFLARE_API_TOKEN your_api_token_here` (and same for `CLOUDFLARE_ACCOUNT_ID`)
- **For production**: Use `npx convex env set CLOUDFLARE_API_TOKEN your_api_token_here --prod` (and same for `CLOUDFLARE_ACCOUNT_ID`)
- Or set it via the Convex Dashboard: **Settings > Environment Variables** (select the correct environment)
- Use `npx convex env ls` to list all environment variables and verify both variables are present
- After setting, Convex will automatically redeploy - wait a few seconds and try again
- Verify the variable names match exactly (case-sensitive)

### Gateway requests not logging

- Verify your `CLOUDFLARE_GATEWAY_ID` is correct
- Check that the gateway exists in your Cloudflare dashboard

### Gateway authentication errors (401)

- If Authenticated Gateway is enabled, make sure you've set `CLOUDFLARE_GATEWAY_AUTH_TOKEN`
- Verify the token was created in Gateway Settings > Authentication with "Run" permissions
- Ensure the token matches the one shown when you created it (you can't view it again after creation)
- If you lost the token, create a new one in the Gateway Settings

### Long-running AI operations timing out

- Cloudflare AI operations now run in Convex, which supports up to 10 minutes of execution time
- This avoids Netlify's 10-26 second timeout limits
- If you still experience timeouts, check your Convex dashboard for any execution limits

## How It Works

The Cloudflare AI integration runs entirely in Convex:

- **Direct Workers AI**: Direct calls to Cloudflare Workers AI models
- **AI Gateway**: Routes requests through Cloudflare's AI Gateway for monitoring and analytics
- **OpenAI Provider**: Uses OpenAI models via AI Gateway's OpenAI endpoint
  - **Provider Keys**: When configured in the dashboard, the gateway automatically injects the stored OpenAI API key
- **Structured Output**: Generates structured JSON responses from AI models
- **Comparison**: Compares direct vs gateway methods side-by-side

All operations use Convex actions with the `"use node"` directive to access Node.js packages like `workers-ai-provider`, `@ai-sdk/openai`, and `ai`.

### Using OpenAI Models

To use OpenAI models instead of Workers AI models, pass `{ useOpenAI: true }` to `generateEarlySummaryWithGateway()`:

```typescript
const result = await generateEarlySummaryWithGateway(prompt, {
  useOpenAI: true,
  openaiModel: 'gpt-5-nano', // Optional, defaults to 'gpt-5-nano'
});
```

**Important**: Make sure you've configured the OpenAI Provider Key in your AI Gateway dashboard (see Step 4b above). The gateway will automatically use the stored key - no environment variables needed!

OpenAI `gpt-5-nano` supports structured outputs via `generateObject`, providing better reliability than Workers AI models that don't support JSON Mode. The model also supports:
- **Reasoning**: Advanced reasoning capabilities for complex tasks
- **Streaming**: Real-time token streaming for better UX
- **Structured Outputs**: Reliable JSON generation with schemas
- **Tool Calling**: Function calling support for agentic workflows

## Rate Limits

Cloudflare Workers AI has rate limits based on your plan:

- **Free tier**: Limited requests per day
- **Paid plans**: Higher limits and additional features

Check your Cloudflare dashboard for current usage and limits.

## Security Best Practices

- Never commit API keys to version control
- Use Convex environment variables for all sensitive configuration
- Rotate API keys regularly
- Monitor API usage in the Cloudflare dashboard
- Set up rate limiting if needed for production use

## Support

For issues with Cloudflare AI:

- Check the [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- Review your Cloudflare dashboard for API status
- Check application logs for detailed error messages
- Verify network connectivity to Cloudflare API

## Need Help?

- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [OpenAI Provider Documentation](https://developers.cloudflare.com/ai-gateway/usage/providers/openai/)
- [Cloudflare Dashboard](https://dash.cloudflare.com)
