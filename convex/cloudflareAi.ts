'use node';

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText, streamText } from 'ai';
import { v } from 'convex/values';
import { createWorkersAI } from 'workers-ai-provider';
import { z } from 'zod';
import { assertUserId } from '../src/lib/shared/user-id';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { authComponent } from './auth';
import { guarded } from './authz/guardFactory';
import { isAutumnConfigured } from './autumn';

// Type for AI Search document results
interface AISearchDocument {
  id: string;
  path?: string;
  folder?: string;
  title?: string;
  text?: string;
  score?: number;
}

// Simple token estimation function (rough approximation)
function estimateTokens(text: string): number {
  // Rough approximation: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

// Helper function to get and validate environment variables
// Note: We don't log warnings here to avoid log spam. The error thrown contains
// helpful messages that will be shown to users/developers via the UI or API responses.
function getCloudflareConfig() {
  const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Missing required Cloudflare AI environment variables: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. Please set them in your Convex environment variables. See docs/CLOUDFLARE_AI_SETUP.md for setup instructions.',
    );
  }

  return {
    apiToken: CLOUDFLARE_API_TOKEN,
    accountId: CLOUDFLARE_ACCOUNT_ID,
    gatewayId: process.env.CLOUDFLARE_GATEWAY_ID,
    gatewayAuthToken: process.env.CLOUDFLARE_GATEWAY_AUTH_TOKEN, // Optional: Gateway authentication token for authenticated gateway
  };
}

// Helper function to get and validate AI Search configuration
function getAISearchConfig() {
  const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  const CLOUDFLARE_AI_SEARCH_INSTANCE_ID = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID;

  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      'Missing required Cloudflare AI environment variables: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. Please set them in your Convex environment variables. See docs/CLOUDFLARE_AI_SETUP.md for setup instructions.',
    );
  }

  if (!CLOUDFLARE_AI_SEARCH_INSTANCE_ID) {
    throw new Error(
      'Missing required Cloudflare AI Search environment variable: CLOUDFLARE_AI_SEARCH_INSTANCE_ID. Please set it in your Convex environment variables. See docs/CLOUDFLARE_AI_SETUP.md for setup instructions.',
    );
  }

  return {
    apiToken: CLOUDFLARE_API_TOKEN,
    accountId: CLOUDFLARE_ACCOUNT_ID,
    instanceId: CLOUDFLARE_AI_SEARCH_INSTANCE_ID,
  };
}

// Cached providers to avoid re-initialization
let workersaiProvider: ReturnType<typeof createWorkersAI> | null = null;
let llamaModel: ReturnType<ReturnType<typeof createWorkersAI>> | null = null;
let falconModel: ReturnType<ReturnType<typeof createWorkersAI>> | null = null;

function getWorkersAIProvider() {
  if (!workersaiProvider) {
    const config = getCloudflareConfig();

    workersaiProvider = createWorkersAI({
      accountId: config.accountId,
      apiKey: config.apiToken,
    });

    if (workersaiProvider) {
      llamaModel = workersaiProvider('@cf/meta/llama-3.1-8b-instruct');
      falconModel = workersaiProvider('@cf/tiiuae/falcon-7b-instruct');
    }
  }

  if (!llamaModel || !falconModel) {
    throw new Error('Failed to initialize AI models');
  }

  return { llamaModel, falconModel };
}

type StructuredResult = {
  title: string;
  summary: string;
  keyPoints: string[];
  category: string;
  difficulty: string;
};

function isStructuredResult(value: unknown): value is StructuredResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.keyPoints) &&
    candidate.keyPoints.every((point) => typeof point === 'string') &&
    typeof candidate.category === 'string' &&
    typeof candidate.difficulty === 'string'
  );
}

async function ensureAuthenticatedUser(ctx: ActionCtx) {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Authentication required');
  }

  const userId = assertUserId(authUser, 'Unable to resolve user id.');
  return { authUser, userId };
}

// Helper function for streaming - emits chunks via handlers
const STREAMING_FLUSH_CHAR_TARGET = 100;
const STREAMING_FLUSH_INTERVAL_MS = 100;

// Zod schema for early summary structured output
const earlySummarySchema = z.object({
  mainPurpose: z.string().describe('What the project does and its main purpose (2-3 sentences)'),
  keyTechnologiesAndFrameworks: z
    .string()
    .describe(
      'Key technologies and frameworks used in the project, formatted as markdown bulleted list with brief descriptions',
    ),
  mainFeaturesAndFunctionality: z
    .string()
    .describe(
      'Main features and functionality of the application, formatted as markdown bulleted list',
    ),
});

export type EarlySummary = z.infer<typeof earlySummarySchema>;

/**
 * Generate structured summary using Google AI Studio (Gemini) via AI Gateway
 * Uses Provider Keys configured in AI Gateway dashboard
 * See: https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/
 */
async function generateSummaryWithGoogleAI(
  prompt: string,
  geminiModel: string = 'google-ai-studio/gemini-flash-lite-latest',
): Promise<{
  summary: EarlySummary;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  finishReason: string;
}> {
  const config = getCloudflareConfig();

  if (!config.gatewayId) {
    throw new Error(
      'CLOUDFLARE_GATEWAY_ID environment variable is required for gateway functionality. Please set it in your Convex environment variables.',
    );
  }

  // Use Google AI Studio provider endpoint: /v1/{account_id}/{gateway_id}/google-ai-studio/v1beta
  // According to Cloudflare docs, Google AI Studio uses the Google Generative AI SDK
  // Base URL needs /v1beta suffix for Google's API versioning
  // Model format: models/gemini-flash-lite-latest (no prefix needed)
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/google-ai-studio/v1beta`;

  // Use the model name as-is (e.g., "models/gemini-flash-lite-latest")
  // Remove any "google-ai-studio/" prefix if present
  const modelName = geminiModel.replace(/^google-ai-studio\//, '');

  console.log(
    `[AI Gateway] Using Google AI Studio model: ${modelName} via Google AI Studio endpoint with Provider Keys (stored in gateway)`,
  );

  // Provider Keys are configured in AI Gateway dashboard - gateway automatically injects the stored key
  // The gateway uses cf-aig-authorization header for gateway authentication
  // The Authorization header should be empty/removed so gateway can inject the stored provider key
  // Use custom fetch to handle gateway authentication and Provider Keys
  const googleAI = createGoogleGenerativeAI({
    // Pass empty string - we'll remove the Authorization header so gateway can inject stored key
    apiKey: '',
    baseURL,
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);

      // Remove the Authorization header (Google SDK adds it with empty string)
      // Gateway will automatically inject stored Google AI Studio key when forwarding
      headers.delete('Authorization');

      // Use cf-aig-authorization for gateway auth
      if (config.gatewayAuthToken) {
        headers.set('cf-aig-authorization', `Bearer ${config.gatewayAuthToken}`);
      } else {
        // If no gateway auth token, use Cloudflare API token in cf-aig-authorization
        headers.set('cf-aig-authorization', `Bearer ${config.apiToken}`);
      }

      return fetch(url, {
        ...init,
        headers,
      });
    },
    // Note: Provider Keys are configured in AI Gateway dashboard:
    // 1. We pass empty string as apiKey
    // 2. We remove the Authorization header (so gateway can inject stored key)
    // 3. We use cf-aig-authorization for gateway authentication
    // 4. Gateway automatically injects stored Google AI Studio key when forwarding to Google AI Studio
  });

  // Use generateObject with Google AI Studio - it supports structured outputs
  const result = await generateObject({
    model: googleAI(modelName),
    prompt,
    schema: earlySummarySchema,
  });

  const validated = earlySummarySchema.parse(result.object);

  const estimatedUsage =
    !result.usage || !result.usage.totalTokens || result.usage.totalTokens === 0
      ? {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(JSON.stringify(validated)),
          totalTokens: estimateTokens(prompt) + estimateTokens(JSON.stringify(validated)),
        }
      : result.usage;

  return {
    summary: validated,
    usage: estimatedUsage,
    finishReason: result.finishReason || 'stop',
  };
}

/**
 * Generate structured summary using OpenAI GPT-5 nano via AI Gateway
 * Uses Provider Keys configured in AI Gateway dashboard
 * See: https://developers.cloudflare.com/ai-gateway/usage/providers/openai/
 */
async function generateSummaryWithOpenAI(
  prompt: string,
  openaiModel: string = 'gpt-5-nano',
): Promise<{
  summary: EarlySummary;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  finishReason: string;
}> {
  const config = getCloudflareConfig();

  if (!config.gatewayId) {
    throw new Error(
      'CLOUDFLARE_GATEWAY_ID environment variable is required for gateway functionality. Please set it in your Convex environment variables.',
    );
  }

  // Use OpenAI provider endpoint: /v1/{account_id}/{gateway_id}/openai
  // According to Cloudflare docs: https://developers.cloudflare.com/ai-gateway/usage/providers/openai/
  // OpenAI supports both /chat/completions and /responses endpoints
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/openai`;
  const modelName = openaiModel;

  console.log(
    `[AI Gateway] Using OpenAI model: ${modelName} via OpenAI endpoint with Provider Keys (stored in gateway)`,
  );

  // Provider Keys are configured in AI Gateway dashboard - gateway automatically injects the stored key
  // The gateway uses cf-aig-authorization header for gateway authentication
  // The Authorization header should be empty/removed so gateway can inject the stored provider key
  // Use custom fetch to handle gateway authentication and Provider Keys
  const openai = createOpenAI({
    // Pass empty string - we'll remove the Authorization header so gateway can inject stored key
    apiKey: '',
    baseURL,
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers);

      // Remove the Authorization header (OpenAI SDK adds it with empty string)
      // Gateway will automatically inject stored OpenAI key when forwarding
      headers.delete('Authorization');

      // Use cf-aig-authorization for gateway auth
      if (config.gatewayAuthToken) {
        headers.set('cf-aig-authorization', `Bearer ${config.gatewayAuthToken}`);
      } else {
        // If no gateway auth token, use Cloudflare API token in cf-aig-authorization
        headers.set('cf-aig-authorization', `Bearer ${config.apiToken}`);
      }

      return fetch(url, {
        ...init,
        headers,
      });
    },
    // Note: Provider Keys are configured in AI Gateway dashboard:
    // 1. We pass empty string as apiKey
    // 2. We remove the Authorization header (so gateway can inject stored key)
    // 3. We use cf-aig-authorization for gateway authentication
    // 4. Gateway automatically injects stored OpenAI key when forwarding to OpenAI
  });

  // Use generateObject with OpenAI - it supports /responses endpoint for structured outputs
  // According to Cloudflare docs, OpenAI supports both /chat/completions and /responses
  const result = await generateObject({
    model: openai(modelName),
    prompt,
    schema: earlySummarySchema,
  });

  const validated = earlySummarySchema.parse(result.object);

  const estimatedUsage =
    !result.usage || !result.usage.totalTokens || result.usage.totalTokens === 0
      ? {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(JSON.stringify(validated)),
          totalTokens: estimateTokens(prompt) + estimateTokens(JSON.stringify(validated)),
        }
      : result.usage;

  return {
    summary: validated,
    usage: estimatedUsage,
    finishReason: result.finishReason || 'stop',
  };
}

/**
 * Generate structured summary using AI Gateway with object output
 * This ensures all three sections are present and complete
 * Supports Workers AI models, OpenAI (via OpenAI endpoint), and Google AI Studio (via Google AI Studio endpoint)
 */
export async function generateSummaryWithGateway(
  prompt: string,
  options?: {
    useOpenAI?: boolean;
    openaiModel?: string;
    useGoogleAI?: boolean;
    geminiModel?: string;
  },
): Promise<{
  summary: EarlySummary;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  finishReason: string;
}> {
  // Use Google AI Studio if requested
  if (options?.useGoogleAI) {
    return generateSummaryWithGoogleAI(prompt, options.geminiModel);
  }

  // Use OpenAI if requested
  if (options?.useOpenAI) {
    return generateSummaryWithOpenAI(prompt, options.openaiModel);
  }

  const config = getCloudflareConfig();

  if (!config.gatewayId) {
    throw new Error(
      'CLOUDFLARE_GATEWAY_ID environment variable is required for gateway functionality. Please set it in your Convex environment variables.',
    );
  }

  // Create gateway-specific provider using workers-ai-provider
  // Note: If Authenticated Gateway is enabled, the workers-ai-provider library should handle
  // the cf-aig-authorization header automatically when using gateway bindings.
  const gatewayWorkersAI = createWorkersAI({
    accountId: config.accountId,
    apiKey: config.apiToken,
    gateway: {
      id: config.gatewayId,
      metadata: {
        userId: 'authenticated-user',
        requestType: 'demo',
        timestamp: new Date().toISOString(),
      },
    },
  });

  // Use GPT-OSS-120B - note: this model does NOT support JSON Mode, so we use generateText
  // and parse manually. See: https://developers.cloudflare.com/workers-ai/features/json-mode/
  const modelName = '@cf/openai/gpt-oss-120b';
  console.log(
    `[AI Gateway] Using model: ${modelName} (note: does not support JSON Mode, using generateText)`,
  );
  const selectedModel = gatewayWorkersAI(modelName);

  try {
    // GPT-OSS-120B doesn't support JSON Mode, so we use generateText and parse manually
    console.log(`[AI Gateway] Calling generateText with ${modelName}...`);
    const result = await generateText({
      model: selectedModel,
      prompt: `${prompt}\n\nIMPORTANT: Respond with ONLY valid JSON matching this exact structure:\n{\n  "mainPurpose": "...",\n  "keyTechnologiesAndFrameworks": "...",\n  "mainFeaturesAndFunctionality": "..."\n}\n\nDo not include any markdown formatting, code blocks, or explanatory text. Only return the raw JSON object.`,
    });
    console.log(`[AI Gateway] Successfully generated text with ${modelName}`);

    // Parse the JSON response manually
    let text = result.text.trim();

    // Remove markdown code blocks if present
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error(`[AI Gateway] Failed to parse JSON from ${modelName}:`, parseError);
      console.error(`[AI Gateway] Response text (first 500 chars):`, text.slice(0, 500));
      // If JSON parsing fails, try to repair truncated JSON (similar to generateObject error handling)
      throw new Error(
        `Failed to parse JSON response from ${modelName}. The response may be truncated.`,
      );
    }

    // Validate and convert to expected format
    const validated = earlySummarySchema.parse({
      mainPurpose: parsed.mainPurpose || '',
      keyTechnologiesAndFrameworks: parsed.keyTechnologiesAndFrameworks || '',
      mainFeaturesAndFunctionality: parsed.mainFeaturesAndFunctionality || '',
    });

    // If usage data is not available or all zeros, estimate based on text
    const estimatedUsage =
      !result.usage || !result.usage.totalTokens || result.usage.totalTokens === 0
        ? {
            inputTokens: estimateTokens(prompt),
            outputTokens: estimateTokens(JSON.stringify(validated)),
            totalTokens: estimateTokens(prompt) + estimateTokens(JSON.stringify(validated)),
          }
        : result.usage;

    return {
      summary: validated,
      usage: estimatedUsage,
      finishReason: result.finishReason || 'stop',
    };
  } catch (error) {
    // Check if this is an empty response error (model didn't generate anything)
    const isEmptyResponse =
      error instanceof Error &&
      'text' in error &&
      (error as { text?: string }).text === '' &&
      (error.name === 'AI_NoObjectGeneratedError' || error.name === 'AI_JSONParseError');

    if (isEmptyResponse) {
      console.error(`[AI Gateway] ${modelName} returned empty response. Error details:`, {
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        hasText: 'text' in error && (error as { text?: string }).text !== undefined,
        textLength: 'text' in error ? (error as { text?: string }).text?.length : 0,
      });
      console.error(`[AI Gateway] Falling back to Llama 3.1 8B.`);
      // Fallback to Llama if model returns empty response
      const llamaModel = gatewayWorkersAI('@cf/meta/llama-3.1-8b-instruct');
      try {
        const fallbackResult = await generateObject({
          model: llamaModel,
          prompt,
          schema: earlySummarySchema,
        });
        const validated = earlySummarySchema.parse(fallbackResult.object);
        const estimatedUsage =
          !fallbackResult.usage ||
          !fallbackResult.usage.totalTokens ||
          fallbackResult.usage.totalTokens === 0
            ? {
                inputTokens: estimateTokens(prompt),
                outputTokens: estimateTokens(JSON.stringify(validated)),
                totalTokens: estimateTokens(prompt) + estimateTokens(JSON.stringify(validated)),
              }
            : fallbackResult.usage;
        return {
          summary: validated,
          usage: estimatedUsage,
          finishReason: fallbackResult.finishReason || 'stop',
        };
      } catch (fallbackError) {
        // If fallback also fails with JSON parse error, try to repair it
        const isFallbackJsonError =
          fallbackError instanceof Error &&
          (fallbackError.message.includes('Unterminated string') ||
            fallbackError.message.includes('could not parse the response') ||
            fallbackError.name === 'AI_JSONParseError' ||
            fallbackError.name === 'AI_NoObjectGeneratedError');

        if (isFallbackJsonError && fallbackError instanceof Error && 'text' in fallbackError) {
          const partialJson = (fallbackError as { text?: string }).text;
          if (partialJson && partialJson.length > 0) {
            console.warn(`[AI Gateway] Llama fallback JSON was truncated, attempting to repair...`);
            // Use the same repair logic (will be handled below)
            // Re-throw with the fallback error so it gets handled by the repair logic
            throw fallbackError;
          }
        }
        // Re-throw if we can't handle it
        throw fallbackError;
      }
    }

    // Check if this is a JSON parsing error (truncated response)
    const isJsonParseError =
      error instanceof Error &&
      (error.message.includes('Unterminated string') ||
        error.message.includes('could not parse the response') ||
        error.name === 'AI_JSONParseError' ||
        error.name === 'AI_NoObjectGeneratedError');

    const errorObj = error instanceof Error ? error : undefined;
    console.log(`[AI Gateway] Checking for JSON parse error:`, {
      isJsonParseError,
      errorName: errorObj?.name ?? 'Unknown',
      errorMessage: errorObj?.message ?? String(error),
      hasText: errorObj && 'text' in errorObj,
      textLength:
        errorObj && 'text' in errorObj ? ((errorObj as { text?: string }).text?.length ?? 0) : 0,
    });

    if (isJsonParseError && error instanceof Error && 'text' in error) {
      // Try to extract partial JSON from the error
      const partialJson = (error as { text?: string }).text;
      console.log(`[AI Gateway] Partial JSON found:`, {
        hasPartialJson: !!partialJson,
        partialJsonLength: partialJson?.length || 0,
        partialJsonPreview: partialJson?.slice(0, 200) || 'none',
      });
      if (partialJson && partialJson.length > 0) {
        console.warn(`[AI Gateway] JSON was truncated, attempting to repair partial response...`);
        try {
          // Try to complete the JSON by closing strings and objects
          let repairedJson = partialJson.trim();

          // Check if we have the third field
          const hasMainFeatures = repairedJson.includes('"mainFeaturesAndFunctionality"');

          // If we're missing the third field, we need to add it
          if (!hasMainFeatures) {
            // Find the last complete quote (working backwards, handling escaped quotes)
            let lastCompleteQuote = -1;
            for (let i = repairedJson.length - 1; i >= 0; i--) {
              if (repairedJson[i] === '"') {
                // Check if it's escaped
                let escapeCount = 0;
                for (let j = i - 1; j >= 0 && repairedJson[j] === '\\'; j--) {
                  escapeCount++;
                }
                // If even number of backslashes (or zero), quote is not escaped
                if (escapeCount % 2 === 0) {
                  lastCompleteQuote = i;
                  break;
                }
              }
            }

            if (lastCompleteQuote !== -1) {
              // Cut at the last complete quote and close the string
              repairedJson = repairedJson.slice(0, lastCompleteQuote + 1);
              // Remove any trailing incomplete text
              repairedJson = repairedJson.replace(/[^"]$/, '');
            } else {
              // If no complete quote found, try to find the start of the last incomplete string
              // and remove everything from there
              const lastIncompleteStringStart = repairedJson.lastIndexOf('"');
              if (lastIncompleteStringStart !== -1) {
                repairedJson = repairedJson.slice(0, lastIncompleteStringStart);
              }
            }

            // Remove trailing comma/whitespace
            repairedJson = repairedJson.replace(/,\s*$/, '');

            // Add the missing third field
            repairedJson +=
              ',\n  "mainFeaturesAndFunctionality": "Features information not available due to response truncation."\n}';
          } else {
            // We have the field, but it might be incomplete
            // Find the last complete array item (one that ends with ", or "\n)
            // Work backwards to find a complete string item
            let lastCompleteItemEnd = -1;

            // Search backwards for the last complete item pattern: ", followed by optional whitespace and newline/comma
            for (let i = repairedJson.length - 1; i >= 0; i--) {
              if (repairedJson[i] === '"') {
                // Check if it's escaped
                let escapeCount = 0;
                for (let j = i - 1; j >= 0 && repairedJson[j] === '\\'; j--) {
                  escapeCount++;
                }
                // If even number of backslashes (or zero), quote is not escaped
                if (escapeCount % 2 === 0) {
                  // Check if this quote is followed by comma (complete array item)
                  const afterQuote = repairedJson.slice(i + 1);
                  // Match: ", or ",\n or ",\r\n (complete item)
                  if (afterQuote.match(/^,\s*\n/) || afterQuote.match(/^,\s*$/)) {
                    lastCompleteItemEnd = i + 1;
                    // Find where the comma/newline ends
                    const commaMatch = afterQuote.match(/^,\s*/);
                    if (commaMatch) {
                      lastCompleteItemEnd += commaMatch[0].length;
                    }
                    break;
                  }
                }
              }
            }

            if (lastCompleteItemEnd !== -1) {
              // Cut at the last complete item
              repairedJson = repairedJson.slice(0, lastCompleteItemEnd).trim();
              // Remove trailing comma
              repairedJson = repairedJson.replace(/,\s*$/, '');
              // Close the array and object
              repairedJson += '\n  ]\n}';
            } else if (!repairedJson.endsWith('}')) {
              // No complete items found, try to close what we have
              // Find the last quote and close from there
              const lastQuote = repairedJson.lastIndexOf('"');
              if (lastQuote !== -1) {
                // Check if it's escaped
                let isEscaped = false;
                for (let i = lastQuote - 1; i >= 0 && repairedJson[i] === '\\'; i--) {
                  isEscaped = !isEscaped;
                }

                if (!isEscaped) {
                  // Check if we're in an array context
                  const beforeQuote = repairedJson.slice(0, lastQuote);
                  const hasArrayStart =
                    beforeQuote.includes('"mainFeaturesAndFunctionality"') &&
                    beforeQuote.includes('[');

                  if (
                    hasArrayStart &&
                    !repairedJson.includes(
                      ']',
                      repairedJson.indexOf('"mainFeaturesAndFunctionality"'),
                    )
                  ) {
                    // We're in an array, close the string, array, and object
                    repairedJson = repairedJson.slice(0, lastQuote + 1);
                    repairedJson = repairedJson.replace(/,\s*$/, '');
                    repairedJson += '\n  ]\n}';
                  } else {
                    // Just close the string and object
                    repairedJson = repairedJson.slice(0, lastQuote + 1);
                    repairedJson = repairedJson.replace(/,\s*$/, '');
                    repairedJson += '\n}';
                  }
                }
              }
            }
          }

          const parsed = JSON.parse(repairedJson);

          // Ensure all required fields exist with defaults if missing
          // Convert arrays to markdown bullet lists if needed
          const repaired = {
            mainPurpose:
              parsed.mainPurpose || 'Information not available due to response truncation.',
            keyTechnologiesAndFrameworks: Array.isArray(parsed.keyTechnologiesAndFrameworks)
              ? parsed.keyTechnologiesAndFrameworks.join('\n')
              : parsed.keyTechnologiesAndFrameworks || 'Information not available.',
            mainFeaturesAndFunctionality: Array.isArray(parsed.mainFeaturesAndFunctionality)
              ? parsed.mainFeaturesAndFunctionality.join('\n')
              : parsed.mainFeaturesAndFunctionality ||
                'Features information not available due to response truncation.',
          };

          const validated = earlySummarySchema.parse(repaired);

          console.log(`[AI Gateway] Successfully repaired truncated JSON response`);

          // Try to get usage from error if available
          const errorUsage = (
            error as {
              usage?: { outputTokens?: number; inputTokens?: number; totalTokens?: number };
            }
          ).usage;

          return {
            summary: validated,
            usage: errorUsage || { outputTokens: 256, inputTokens: 3001, totalTokens: 3257 },
            finishReason: 'length', // Indicate truncation
          };
        } catch (repairError) {
          console.error(`[AI Gateway] Failed to repair JSON:`, repairError);
          // Log the partial JSON for debugging
          console.error(`[AI Gateway] Partial JSON that failed to repair:`, partialJson);
        }
      }
    }

    // Log the full error for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(
      `[AI Gateway] Structured output failed:`,
      errorMessage,
      errorStack ? `\nStack: ${errorStack}` : '',
    );

    // Re-throw to let caller handle fallback
    throw error;
  }
}

export async function generateWithGatewayHelper(
  prompt: string,
  model: 'llama' | 'falcon' = 'llama',
) {
  const config = getCloudflareConfig();

  if (!config.gatewayId) {
    throw new Error(
      'CLOUDFLARE_GATEWAY_ID environment variable is required for gateway functionality. Please set it in your Convex environment variables.',
    );
  }

  // Create gateway-specific provider using workers-ai-provider
  // Note: If Authenticated Gateway is enabled, the workers-ai-provider library should handle
  // the cf-aig-authorization header automatically when using gateway bindings.
  const gatewayWorkersAI = createWorkersAI({
    accountId: config.accountId,
    apiKey: config.apiToken,
    gateway: {
      id: config.gatewayId,
      metadata: {
        userId: 'authenticated-user',
        requestType: 'demo',
        timestamp: new Date().toISOString(),
      },
    },
  });

  const selectedModel =
    model === 'llama'
      ? gatewayWorkersAI('@cf/meta/llama-3.1-8b-instruct')
      : gatewayWorkersAI('@cf/tiiuae/falcon-7b-instruct');

  const result = await generateText({
    model: selectedModel,
    prompt,
  });

  // If usage data is not available or all zeros, estimate based on text
  const estimatedUsage =
    !result.usage || !result.usage.totalTokens || result.usage.totalTokens === 0
      ? {
          inputTokens: estimateTokens(prompt),
          outputTokens: estimateTokens(result.text),
          totalTokens: estimateTokens(prompt) + estimateTokens(result.text),
        }
      : result.usage;

  // Log if response was truncated (finishReason other than 'stop' indicates truncation)
  if (result.finishReason && result.finishReason !== 'stop') {
    console.warn(
      `[AI Gateway] Response finished with reason: ${result.finishReason}. Response may be truncated. Response length: ${result.text.length} chars`,
    );
  }

  return {
    provider: 'cloudflare-gateway-workers-ai',
    model: model === 'llama' ? '@cf/meta/llama-3.1-8b-instruct' : '@cf/tiiuae/falcon-7b-instruct',
    response: result.text,
    usage: estimatedUsage,
    finishReason: result.finishReason || 'stop',
  };
}

// Streaming version for structured output
export const streamStructuredResponse = guarded.action(
  'profile.read',
  {
    topic: v.string(),
    style: v.union(v.literal('formal'), v.literal('casual'), v.literal('technical')),
    requestId: v.string(),
  },
  async (
    ctx: ActionCtx,
    args,
    _role,
  ): Promise<{
    responseId: Id<'aiResponses'>;
  }> => {
    const { userId } = await ensureAuthenticatedUser(ctx);

    const modelName = '@cf/meta/llama-3.1-8b-instruct';

    const { responseId } = (await ctx.runMutation(internal.aiResponses.createResponse, {
      userId,
      requestKey: args.requestId,
      method: 'structured',
      provider: 'cloudflare-workers-ai-structured',
      model: modelName,
    })) as { responseId: Id<'aiResponses'> };

    const markError = async (message: string) => {
      await ctx.runMutation(internal.aiResponses.markError, {
        responseId,
        errorMessage: message,
      });
    };

    try {
      const { llamaModel } = getWorkersAIProvider();
      const prompt = `Generate a structured explanation about "${args.topic}" in a ${args.style} style. Return ONLY valid JSON with this exact structure: {"title": "string", "summary": "string", "keyPoints": ["string1", "string2"], "category": "string", "difficulty": "beginner|intermediate|advanced"}`;

      const result = await streamText({
        model: llamaModel,
        prompt,
      });

      let accumulatedText = '';
      let bufferedContent = '';
      let lastFlushTime = Date.now();
      const flushBufferedContent = async () => {
        if (!bufferedContent) {
          return;
        }
        await ctx.runMutation(internal.aiResponses.appendChunk, {
          responseId,
          content: bufferedContent,
        });
        bufferedContent = '';
        lastFlushTime = Date.now();
      };

      // Accumulate text chunks
      for await (const delta of result.textStream) {
        accumulatedText += delta;
        bufferedContent += delta;
        const shouldFlush =
          bufferedContent.length >= STREAMING_FLUSH_CHAR_TARGET ||
          Date.now() - lastFlushTime >= STREAMING_FLUSH_INTERVAL_MS;
        if (shouldFlush) {
          await flushBufferedContent();
        }
      }
      await flushBufferedContent();

      // Try to parse the accumulated text as JSON
      let structuredData: StructuredResult | null = null;
      let parseError = null;

      try {
        // Clean up the text (remove markdown code blocks if present)
        let jsonText = accumulatedText.trim();
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        const parsed = JSON.parse(jsonText);
        if (isStructuredResult(parsed)) {
          structuredData = parsed;
        } else {
          parseError = 'Structured data response missing required fields';
        }
      } catch (error) {
        parseError = error instanceof Error ? error.message : 'Failed to parse JSON';
        const jsonMatch = accumulatedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (isStructuredResult(parsed)) {
              structuredData = parsed;
              parseError = null;
            }
          } catch {
            // Keep the original error
          }
        }
      }

      const usage = await result.usage;
      const finishReason = await result.finishReason;

      const estimatedUsage =
        !usage || !usage.totalTokens || usage.totalTokens === 0
          ? {
              inputTokens: estimateTokens(prompt),
              outputTokens: estimateTokens(accumulatedText),
              totalTokens: estimateTokens(prompt) + estimateTokens(accumulatedText),
            }
          : usage;

      await ctx.runMutation(internal.aiResponses.markComplete, {
        responseId,
        response: accumulatedText,
        usage: estimatedUsage,
        finishReason: finishReason || 'stop',
        structuredData: structuredData ?? undefined,
        rawText: accumulatedText,
        parseError: parseError ?? undefined,
      });

      return { responseId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await markError(message);
      throw error;
    }
  },
);

// List AI Gateways to find Gateway IDs
export const listAIGateways = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    const config = getCloudflareConfig();
    const listUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-gateway/gateways`;

    try {
      const response = await fetch(listUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list gateways: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as {
        result?: Array<{
          id: string;
          name: string;
          created_at?: string;
        }>;
        success?: boolean;
      };

      const gateways = data.result ?? [];
      return {
        success: true,
        gateways: gateways.map((g) => ({
          id: g.id,
          name: g.name,
          createdAt: g.created_at,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        gateways: [],
      };
    }
  },
);

// Test gateway connectivity
export const testGatewayConnectivity = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    if (!isAutumnConfigured()) {
      return {
        success: false,
        error:
          'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI access.',
        gatewayUrl: null,
      };
    }

    const config = getCloudflareConfig();

    if (!config.gatewayId) {
      // Note: We don't log warnings here to avoid log spam. The error response contains
      // helpful messages that will be shown to users/developers via the UI or API responses.
      return {
        success: false,
        error:
          'CLOUDFLARE_GATEWAY_ID not configured. Set it in Convex environment variables to enable Cloudflare Gateway. See docs/CLOUDFLARE_AI_SETUP.md for setup instructions.',
        gatewayUrl: null,
      };
    }

    // Test if gateway provider can be initialized (basic connectivity test)
    try {
      const testWorkersAI = createWorkersAI({
        accountId: config.accountId,
        apiKey: config.apiToken,
        gateway: {
          id: config.gatewayId,
          metadata: {
            userId: 'test-user',
            requestType: 'connectivity-test',
            timestamp: new Date().toISOString(),
          },
        },
      });

      // Try to create a model and make a simple request
      const testModel = testWorkersAI('@cf/meta/llama-3.1-8b-instruct');

      const result = await generateText({
        model: testModel,
        prompt: 'Hello',
      });

      return {
        success: true,
        status: 200,
        statusText: 'OK',
        gatewayUrl: `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}`,
        response: result.text,
      };
    } catch (error) {
      console.error('❌ Gateway connectivity test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        gatewayUrl: `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}`,
      };
    }
  },
);

// Comparison endpoint that runs both in parallel

// Check if Cloudflare AI Search is configured
export const isAISearchConfigured = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
    const CLOUDFLARE_AI_SEARCH_INSTANCE_ID = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID ?? '';
    return {
      configured:
        CLOUDFLARE_API_TOKEN.length > 0 &&
        CLOUDFLARE_ACCOUNT_ID.length > 0 &&
        CLOUDFLARE_AI_SEARCH_INSTANCE_ID.length > 0,
    };
  },
);

// List all AI Search instances (RAG instances)
export const listAISearchInstances = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    const config = getAISearchConfig();
    // Try different possible endpoint formats
    const possibleEndpoints = [
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/autorag/rags`,
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/rags`,
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances`,
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search`,
    ];

    for (const listUrl of possibleEndpoints) {
      try {
        console.log(`[AI Search] Trying endpoint: ${listUrl}`);
        const response = await fetch(listUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = (await response.json()) as {
            result?: Array<{
              id?: string;
              name?: string;
              rag_name?: string;
              instance_id?: string;
              created_at?: string;
            }>;
            success?: boolean;
          };

          const instances = data.result ?? [];
          return {
            success: true,
            endpoint: listUrl,
            instances: instances.map((i) => ({
              id: i.id || i.instance_id || i.name || i.rag_name || 'unknown',
              name: i.name || i.rag_name || i.id || 'unknown',
              ragName: i.rag_name || i.name || 'unknown',
              createdAt: i.created_at,
            })),
          };
        } else if (response.status !== 404) {
          // If it's not a 404, this might be the right endpoint but with an error
          const errorText = await response.text();
          console.log(`[AI Search] Endpoint ${listUrl} returned ${response.status}: ${errorText}`);
        }
      } catch (error) {
        console.log(
          `[AI Search] Endpoint ${listUrl} failed:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
    }

    return {
      success: false,
      error:
        'Could not find valid endpoint to list AI Search instances. The API endpoint format may have changed.',
      instances: [],
    };
  },
);

interface AISearchQueryOptions {
  query: string;
  model?: string;
  maxNumResults?: number;
  rewriteQuery?: boolean;
  pathPrefix?: string; // R2 path prefix to filter by (e.g., "repos/{submissionId}/files/")
}

interface AISearchResponse {
  response?: string;
  data?: Array<AISearchDocument>;
  search_query?: string;
  result?: {
    response?: string;
    data?: Array<AISearchDocument>;
  };
}

async function queryAISearchHelper(options: AISearchQueryOptions): Promise<AISearchResponse> {
  const config = getAISearchConfig();
  // Correct endpoint format: /autorag/rags/{instance_name}/ai-search
  const queryUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/autorag/rags/${config.instanceId}/ai-search`;

  // Build request body with optional folder filter
  const requestBody: {
    query: string;
    model: string;
    max_num_results: number;
    rewrite_query: boolean;
    filters?: {
      type: string;
      filters: Array<{
        type: string;
        key: string;
        value: string;
      }>;
    };
  } = {
    query: options.query,
    model: options.model ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    max_num_results: options.maxNumResults ?? 20,
    rewrite_query: options.rewriteQuery ?? false,
  };

  // Add folder filter if pathPrefix is provided
  // Cloudflare AI Search uses 'folder' attribute for path filtering
  // Format: compound filter with 'gt' and 'lte' to match paths starting with prefix
  if (options.pathPrefix) {
    // Remove trailing slash if present for filter comparison
    const folderPrefix = options.pathPrefix.replace(/\/$/, '');
    // Use compound filter to match folder paths starting with prefix
    // 'gt' includes paths greater than prefix + '/', 'lte' includes up to prefix + 'z'
    requestBody.filters = {
      type: 'and',
      filters: [
        {
          type: 'gt',
          key: 'folder',
          value: `${folderPrefix}/`,
        },
        {
          type: 'lte',
          key: 'folder',
          value: `${folderPrefix}z`,
        },
      ],
    };
  }

  console.log('[AI Search] Making request:', {
    instanceId: config.instanceId,
    query: options.query,
    model: requestBody.model,
    maxNumResults: requestBody.max_num_results,
    pathPrefix: options.pathPrefix,
    filters: requestBody.filters,
    queryUrl: queryUrl.replace(config.accountId, '[ACCOUNT_ID]'), // Hide account ID in logs
  });

  const response = await fetch(queryUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();

    if (
      response.status === 401 ||
      errorText.includes('Authentication error') ||
      errorText.includes('Unauthorized')
    ) {
      throw new Error(
        `AI Search authentication error (401): Please verify your CLOUDFLARE_API_TOKEN has "AI Search > Edit" permissions. See docs/CLOUDFLARE_AI_SETUP.md for setup instructions.`,
      );
    }

    if (
      response.status === 400 &&
      (errorText.includes('Could not route') || errorText.includes('No route for that URI'))
    ) {
      throw new Error(
        `AI Search instance not found (400): The instance name "${config.instanceId}" may be incorrect or the account does not have AI Search enabled. Verify CLOUDFLARE_AI_SEARCH_INSTANCE_ID matches your instance name.`,
      );
    }

    throw new Error(`AI Search query error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as AISearchResponse;

  // Extract documents for logging
  const documents = data.data ?? data.result?.data ?? [];
  const responseText = data.response ?? data.result?.response ?? '';

  console.log('[AI Search] Response received:', {
    hasResponse: !!responseText,
    responseLength: responseText.length,
    documentsFound: documents.length,
    searchQuery: data.search_query,
    documents: documents
      .map((doc: AISearchDocument) => ({
        id: doc.id,
        path: doc.path || doc.folder,
        title: doc.title,
        textLength: doc.text?.length || 0,
        score: doc.score,
      }))
      .slice(0, 5), // Log first 5 documents
    hasMoreDocuments: documents.length > 5,
  });

  return data;
}

// Query Cloudflare AI Search (with usage tracking)
export const queryAISearch = guarded.action(
  'profile.read',
  {
    query: v.string(),
    model: v.optional(v.string()),
    maxNumResults: v.optional(v.number()),
    rewriteQuery: v.optional(v.boolean()),
    pathPrefix: v.optional(v.string()),
  },
  async (_ctx: ActionCtx, args, _role) => {
    // Use server-side folder filtering if pathPrefix is provided
    const result = await queryAISearchHelper({
      query: args.query,
      model: args.model,
      maxNumResults: args.maxNumResults,
      rewriteQuery: args.rewriteQuery,
      pathPrefix: args.pathPrefix, // Pass pathPrefix for server-side filtering
    });

    // Extract the generated response and documents
    const generatedResponse = result.response ?? result.result?.response;
    const documents = result.data ?? result.result?.data ?? [];

    // Estimate usage (AI Search doesn't provide detailed token usage)
    const estimatedUsage = {
      inputTokens: estimateTokens(args.query),
      outputTokens: estimateTokens(generatedResponse ?? ''),
      totalTokens: estimateTokens(args.query) + estimateTokens(generatedResponse ?? ''),
    };

    // Filter documents by path prefix if provided (client-side filtering)
    // This ensures we only return documents from the specified submission
    let filteredDocuments = documents as Array<{
      filename?: string;
      attributes?: {
        path?: string;
      };
      text?: string;
      score?: number;
    }>;

    if (args.pathPrefix) {
      filteredDocuments = filteredDocuments.filter((doc) => {
        const docPath = doc.attributes?.path || doc.filename || '';
        return docPath.startsWith(args.pathPrefix as string);
      });
    }

    return {
      response: generatedResponse,
      documents: filteredDocuments,
      searchQuery: result.search_query,
      usage: estimatedUsage,
    };
  },
);

// Query Cloudflare AI Search for Repo Chat (no usage tracking)
export const queryAISearchForRepoChat = guarded.action(
  'profile.read',
  {
    query: v.string(),
    model: v.optional(v.string()),
    maxNumResults: v.optional(v.number()),
    rewriteQuery: v.optional(v.boolean()),
    pathPrefix: v.optional(v.string()),
  },
  async (_ctx: ActionCtx, args, _role) => {
    // Skip usage tracking for repo chat queries
    // Use server-side folder filtering if pathPrefix is provided
    const result = await queryAISearchHelper({
      query: args.query,
      model: args.model,
      maxNumResults: args.maxNumResults,
      rewriteQuery: args.rewriteQuery,
      pathPrefix: args.pathPrefix, // Pass pathPrefix for server-side filtering
    });

    // Extract the generated response and documents
    const generatedResponse = result.response ?? result.result?.response;
    const documents = result.data ?? result.result?.data ?? [];

    // Filter documents by path prefix if provided (client-side filtering)
    // This ensures we only return documents from the specified submission
    let filteredDocuments = documents as Array<{
      filename?: string;
      attributes?: {
        path?: string;
      };
      text?: string;
      score?: number;
    }>;

    if (args.pathPrefix) {
      filteredDocuments = filteredDocuments.filter((doc) => {
        const docPath = doc.attributes?.path || doc.filename || '';
        return docPath.startsWith(args.pathPrefix as string);
      });
    }

    return {
      response: generatedResponse,
      documents: filteredDocuments,
      searchQuery: result.search_query,
    };
  },
);

// Streaming version of queryAISearchForRepoChat (no usage tracking)
// Simulates streaming by chunking the response text
export const streamAISearchForRepoChat = guarded.action(
  'profile.read',
  {
    query: v.string(),
    model: v.optional(v.string()),
    maxNumResults: v.optional(v.number()),
    rewriteQuery: v.optional(v.boolean()),
    pathPrefix: v.optional(v.string()),
    requestId: v.string(),
  },
  async (
    ctx: ActionCtx,
    args,
    _role,
  ): Promise<{
    responseId: Id<'aiResponses'>;
  }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthorized');
    }

    const userId = assertUserId(authUser, 'Unable to resolve user id.');

    // Create response record
    const { responseId } = (await ctx.runMutation(internal.aiResponses.createResponse, {
      userId,
      requestKey: args.requestId,
      method: 'direct',
      provider: 'cloudflare-ai-search',
      model: args.model ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    })) as { responseId: Id<'aiResponses'> };

    const markError = async (message: string) => {
      await ctx.runMutation(internal.aiResponses.markError, {
        responseId,
        errorMessage: message,
      });
    };

    try {
      // Query AI Search (returns full response at once)
      const result = await queryAISearchHelper({
        query: args.query,
        model: args.model,
        maxNumResults: args.maxNumResults,
        rewriteQuery: args.rewriteQuery,
        pathPrefix: args.pathPrefix,
      });

      // Extract the generated response and documents
      const generatedResponse = result.response ?? result.result?.response ?? '';
      const documents = result.data ?? result.result?.data ?? [];

      console.log('[Repo Chat] Processing AI search result:', {
        requestId: args.requestId,
        responseLength: generatedResponse.length,
        documentsCount: documents.length,
        documentsPaths: documents
          .map((doc: AISearchDocument) => doc.path || doc.folder)
          .slice(0, 10),
        hasMoreDocuments: documents.length > 10,
      });

      // Update metadata
      await ctx.runMutation(internal.aiResponses.updateMetadata, {
        responseId,
        provider: 'cloudflare-ai-search',
        model: args.model ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      });

      // Simulate streaming by chunking the response
      // Split into chunks of approximately STREAMING_FLUSH_CHAR_TARGET characters
      const chunkSize = STREAMING_FLUSH_CHAR_TARGET;
      let bufferedContent = '';
      let lastFlushTime = Date.now();

      const flushBufferedContent = async () => {
        if (!bufferedContent) {
          return;
        }
        await ctx.runMutation(internal.aiResponses.appendChunk, {
          responseId,
          content: bufferedContent,
        });
        bufferedContent = '';
        lastFlushTime = Date.now();
      };

      // Process response in chunks
      for (let i = 0; i < generatedResponse.length; i += chunkSize) {
        const chunk = generatedResponse.slice(i, i + chunkSize);
        bufferedContent += chunk;

        // Flush if we've accumulated enough or enough time has passed
        const shouldFlush =
          bufferedContent.length >= STREAMING_FLUSH_CHAR_TARGET ||
          Date.now() - lastFlushTime >= STREAMING_FLUSH_INTERVAL_MS;

        if (shouldFlush) {
          await flushBufferedContent();
        }

        // Small delay to simulate real streaming
        if (i + chunkSize < generatedResponse.length) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Flush any remaining content
      await flushBufferedContent();

      // Mark as complete
      const estimatedUsage = {
        inputTokens: estimateTokens(args.query),
        outputTokens: estimateTokens(generatedResponse),
        totalTokens: estimateTokens(args.query) + estimateTokens(generatedResponse),
      };

      await ctx.runMutation(internal.aiResponses.markComplete, {
        responseId,
        response: generatedResponse,
        usage: estimatedUsage,
        finishReason: 'stop',
      });

      return { responseId };
    } catch (error) {
      await markError(error instanceof Error ? error.message : 'Failed to query AI Search');
      throw error;
    }
  },
);

// Test AI Search connectivity
export const testAISearchConnectivity = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    if (!isAutumnConfigured()) {
      return {
        success: false,
        error:
          'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI access.',
        instanceUrl: null,
      };
    }

    const config = getAISearchConfig();
    const testResult = await queryAISearchHelper({
      query: 'test query',
      maxNumResults: 1,
    });

    return {
      success: true,
      status: 200,
      statusText: 'OK',
      instanceUrl: `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/autorag/rags/${config.instanceId}`,
      response: testResult.response,
    };
  },
);
