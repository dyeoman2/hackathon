#!/usr/bin/env tsx
/**
 * Complete R2 Infrastructure Setup Script
 *
 * This script automates the entire R2 infrastructure setup process:
 * 1. Deploys infrastructure with Alchemy (R2 bucket + Cloudflare API token)
 * 2. Extracts values from Alchemy output
 * 3. Creates R2 API tokens automatically
 * 4. Sets all Convex environment variables
 * 5. Guides through AI Search setup and sets that env var too
 *
 * Usage:
 *   pnpm tsx scripts/setup-r2-infra.ts
 *
 * Prerequisites:
 *   - Alchemy configured and logged in (run `npx alchemy configure` and `npx alchemy login`)
 *   - Convex project initialized (run `npx convex dev` at least once)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

interface AlchemyOutput {
  cloudflareApiToken?: string;
  accountId?: string;
  bucketName?: string;
}

interface R2TokenOutput {
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function execCommand(
  command: string,
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: Array<'inherit' | 'pipe' | 'ignore'> | 'inherit' | 'pipe';
  },
): string {
  try {
    const { stdio = ['inherit', 'pipe', 'pipe'], ...restOptions } = options || {};
    return execSync(command, {
      encoding: 'utf-8',
      stdio,
      ...restOptions,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Command failed: ${command}\n${errorMessage}`);
  }
}

function readAlchemyStateFiles(): AlchemyOutput | null {
  const result: AlchemyOutput = {
    bucketName: 'hackathon-repos',
  };

  // Try to get account ID from bucket file (this is usually available)
  const bucketPaths = [
    join(process.cwd(), '.alchemy', 'hackathon-infra', 'yeoman', 'hackathon-repos.json'),
    join(process.cwd(), '.alchemy', 'hackathon-infra', 'default', 'hackathon-repos.json'),
  ];

  for (const bucketPath of bucketPaths) {
    if (existsSync(bucketPath)) {
      try {
        const bucketContent = readFileSync(bucketPath, 'utf-8');
        const bucketData = JSON.parse(bucketContent);
        if (bucketData.output?.accountId) {
          result.accountId = bucketData.output.accountId;
        }
      } catch {
        // Ignore errors reading bucket file
      }
      break;
    }
  }

  // Try to find the token file
  const tokenPaths = [
    join(process.cwd(), '.alchemy', 'hackathon-infra', 'yeoman', 'r2-management-token.json'),
    join(process.cwd(), '.alchemy', 'hackathon-infra', 'default', 'r2-management-token.json'),
  ];

  let tokenFile: string | null = null;
  for (const path of tokenPaths) {
    if (existsSync(path)) {
      tokenFile = path;
      break;
    }
  }

  if (tokenFile) {
    try {
      const tokenContent = readFileSync(tokenFile, 'utf-8');
      const tokenData = JSON.parse(tokenContent);

      // Check if token creation failed
      if (tokenData.status === 'error' || tokenData.status === 'failed') {
        // Mark as manual required so we can handle it gracefully
        result.cloudflareApiToken = 'MANUAL_TOKEN_REQUIRED';
        return result;
      }

      // Check if token is created and has a value
      if (tokenData.status === 'created' && tokenData.output?.value) {
        result.cloudflareApiToken = tokenData.output.value;
        return result; // Return with both token and account ID
      }

      // If token is still creating, check if it's been stuck for a while
      // (status will be "creating" if it's in progress)
      // We'll return what we have (account ID) and let the polling handle it
    } catch {
      // If we can't read the file, continue without token
    }
  }

  // Return what we have (at least account ID if available)
  return result.accountId ? result : null;
}

function parseAlchemyOutput(output: string): AlchemyOutput {
  const result: AlchemyOutput = {};

  // First, try to read from Alchemy state files (most reliable)
  const stateData = readAlchemyStateFiles();
  if (stateData) {
    return stateData;
  }

  // Fallback: Try to extract from command output
  // Try to extract Cloudflare API token (r2ManagementToken.value)
  // Alchemy outputs resources in various formats
  // Look for patterns like: r2ManagementToken: { value: "..." } or r2ManagementToken.value = "..."
  // Also check for JSON-like output or key-value pairs
  const tokenPatterns = [
    // JSON format: "r2ManagementToken": { "value": "..." }
    /r2ManagementToken["\s]*:[\s]*\{[^}]*value["\s]*:[\s]*["']([^"']+)["']/i,
    // Object format: r2ManagementToken: { value: "..." }
    /r2ManagementToken[:\s]*\{[^}]*value[:\s]*["']([^"']+)["']/i,
    // Dot notation: r2ManagementToken.value = "..."
    /r2ManagementToken\.value[:\s]*=["']([^"']+)["']/i,
    // After "Creating Resource..." look for token output
    /r2-management-token[\s\S]*?value[:\s]*["']([^"']+)["']/i,
    // Generic token pattern after r2-management-token
    /r2-management-token[\s\S]*?([a-zA-Z0-9_-]{40,})/i,
    // Fallback: any long alphanumeric string after r2ManagementToken
    /r2ManagementToken[:\s]+([a-zA-Z0-9_-]{40,})/i,
  ];

  for (const pattern of tokenPatterns) {
    const match = output.match(pattern);
    if (match?.[1] && match[1].length > 20 && match[1] !== 'MANUAL_TOKEN_REQUIRED') {
      result.cloudflareApiToken = match[1];
      break;
    }
  }

  // Try to extract account ID from various patterns
  // Account IDs are 32 character hex strings
  const accountIdPatterns = [
    /account[_\s-]?id[:\s]+([a-f0-9]{32})/i,
    /"account_id"[:\s]*["']([a-f0-9]{32})["']/i,
    /accountId[:\s]*["']([a-f0-9]{32})["']/i,
    // From Alchemy stage output: "Stage: yeoman" might contain account info
    /account[:\s]+([a-f0-9]{32})/i,
  ];

  for (const pattern of accountIdPatterns) {
    const match = output.match(pattern);
    if (match?.[1]) {
      result.accountId = match[1];
      break;
    }
  }

  // Bucket name is known (hackathon-repos)
  result.bucketName = 'hackathon-repos';

  return result;
}

async function ensureAlchemyConfigured(): Promise<void> {
  console.log('🔍 Checking Alchemy setup...\n');

  // Check if alchemy is installed (it should be in package.json, but verify)
  try {
    execCommand('npx alchemy --version', { stdio: 'pipe' });
  } catch {
    console.log('⚠️  Alchemy CLI not found. It should be installed as a dependency.\n');
    console.log('Checking if it needs to be installed...\n');

    // Check if it's in package.json
    try {
      const packageJsonPath = join(process.cwd(), 'package.json');
      const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      if (!packageJson.dependencies?.alchemy && !packageJson.devDependencies?.alchemy) {
        console.log('Installing Alchemy...\n');
        execCommand('pnpm add alchemy', { stdio: 'inherit' });
      }
    } catch (error) {
      console.error(
        '❌ Could not check/install Alchemy:',
        error instanceof Error ? error.message : error,
      );
      console.error('\nPlease ensure Alchemy is installed: pnpm add alchemy');
      process.exit(1);
    }
  }

  // Check if ALCHEMY_PROFILE is set
  const profileEnv = process.env.ALCHEMY_PROFILE;
  if (profileEnv) {
    console.log(`ℹ️  Using Alchemy profile: ${profileEnv}\n`);
  } else {
    console.log('ℹ️  Using default Alchemy profile.\n');
    console.log('   If you configured Cloudflare on a custom profile (e.g., "hackathon"),');
    console.log('   set ALCHEMY_PROFILE environment variable:\n');
    console.log('   ALCHEMY_PROFILE=hackathon pnpm infra:setup\n');
  }

  // Note: We'll check if Cloudflare is configured when we try to deploy
  // The deploy function will catch configuration errors and provide guidance
  console.log('✅ Alchemy CLI is available\n');
}

async function deployWithAlchemy(): Promise<AlchemyOutput> {
  console.log('🚀 Step 1: Deploying infrastructure with Alchemy...\n');

  try {
    // Use ALCHEMY_PROFILE if set, otherwise use default
    const profileEnv = process.env.ALCHEMY_PROFILE;
    const env = profileEnv ? { ...process.env, ALCHEMY_PROFILE: profileEnv } : process.env;

    const output = execCommand('pnpm infra:deploy', { env });
    console.log(output);

    // Wait a moment for Alchemy to finish writing state files, then check
    console.log('\n📖 Reading Alchemy state files...\n');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Read state files - account ID should be available immediately from bucket file
    let parsed = parseAlchemyOutput(output);

    // Only poll for account ID if not found (should be immediate, but just in case)
    let attempts = 0;
    const maxAttempts = 3;
    while (!parsed.accountId && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      parsed = parseAlchemyOutput(output);
      attempts++;
    }

    // Log what we found
    if (parsed.accountId) {
      console.log(`✅ Account ID extracted: ${parsed.accountId}`);
    } else {
      console.log('⚠️  Could not extract Account ID from state files');
    }

    // API token will never be created automatically (OAuth tokens can't create API tokens)
    // So we'll always need manual creation - no need to wait/poll for it
    console.log('\n⚠️  API token not available.');
    console.log('This is expected - Alchemy OAuth tokens cannot create API tokens.');
    console.log("You'll need to create a Cloudflare API token manually.\n");
    console.log('Next steps:');
    console.log('1. Go to https://dash.cloudflare.com/profile/api-tokens');
    console.log('2. Click "Create Token"');
    console.log('3. Use "Edit Cloudflare Workers" template (includes R2 permissions)');
    console.log('4. Copy the token value\n');

    const tokenInput = await question(
      'Enter your Cloudflare API token (or press Enter to exit and create it manually): ',
    );
    if (tokenInput.trim()) {
      parsed.cloudflareApiToken = tokenInput.trim();
    } else {
      // User wants to create manually - we'll handle this in the error handler
      throw new Error('API_TOKEN_MANUAL_REQUIRED');
    }

    // If we didn't get account ID, ask for it
    if (!parsed.accountId) {
      console.log('\n⚠️  Could not automatically extract Account ID.');
      parsed.accountId = await question(
        'Enter your Cloudflare Account ID (found in Dashboard sidebar): ',
      );
    }

    return parsed;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorOutput = error instanceof Error ? String(error) : String(error);

    // Check if user wants to create token manually
    if (errorMessage === 'API_TOKEN_MANUAL_REQUIRED') {
      console.log('\n📋 Manual API Token Creation Required\n');
      console.log('Please create a Cloudflare API token:');
      console.log('1. Go to https://dash.cloudflare.com/profile/api-tokens');
      console.log('2. Click "Create Token"');
      console.log('3. Use "Edit Cloudflare Workers" template OR create custom token with:');
      console.log('   - Account > R2 > Read & Write');
      console.log('4. Copy the token value\n');

      const apiToken = await question('Enter your Cloudflare API token: ');
      const accountId = await question('Enter your Cloudflare Account ID: ');

      return {
        cloudflareApiToken: apiToken.trim(),
        accountId: accountId.trim(),
        bucketName: 'hackathon-repos',
      };
    }

    // Check for R2 not enabled error
    if (
      errorMessage.includes('Please enable R2') ||
      errorMessage.includes('10042') ||
      errorOutput.includes('Please enable R2') ||
      errorOutput.includes('10042')
    ) {
      console.error('\n❌ R2 is not enabled in your Cloudflare account.\n');
      console.error('Please enable R2 through the Cloudflare Dashboard:\n');
      console.error('1. Go to https://dash.cloudflare.com');
      console.error('2. Navigate to R2 (in the left sidebar)');
      console.error('3. Click "Get Started" or "Enable R2"');
      console.error('4. Follow the prompts to enable R2 for your account\n');
      console.error('Once R2 is enabled, run this script again.\n');
      process.exit(1);
    }

    // Check for API token creation permission error
    if (
      errorMessage.includes('Unauthorized to access requested resource') ||
      errorMessage.includes('Error creating token') ||
      errorOutput.includes('Unauthorized to access requested resource') ||
      errorOutput.includes('Error creating token')
    ) {
      console.error('\n⚠️  R2 bucket was created successfully, but API token creation failed.\n');
      console.error(
        "This is because Alchemy OAuth tokens don't have permission to create API tokens.",
      );
      console.error("This is expected - you'll need to create the API token manually.\n");
      console.error('Next steps:\n');
      console.error('1. Create a Cloudflare API token manually:');
      console.error('   - Go to https://dash.cloudflare.com/profile/api-tokens');
      console.error('   - Click "Create Token"');
      console.error('   - Use "Edit Cloudflare Workers" template OR create custom token with:');
      console.error('     * Account > R2 > Read & Write');
      console.error('   - Copy the token value\n');
      console.error('2. Use that token to create R2 API tokens:');
      console.error('   CLOUDFLARE_API_TOKEN=<your-token> \\');
      console.error('   CLOUDFLARE_ACCOUNT_ID=<your-account-id> \\');
      console.error('   pnpm infra:create-r2-token\n');
      console.error(
        '3. Then set Convex environment variables manually or continue with the script.\n',
      );
      console.error('The R2 bucket "hackathon-repos" is ready!\n');

      // Ask if they want to continue with manual token creation
      const continueManual = await question(
        'Do you have a Cloudflare API token ready to continue? (y/n): ',
      );
      if (continueManual.toLowerCase() === 'y') {
        const apiToken = await question('Enter your Cloudflare API token: ');
        const accountId = await question('Enter your Cloudflare Account ID: ');

        // Continue with R2 token creation using the manual API token
        try {
          const r2Tokens = await createR2Tokens(apiToken, accountId);
          await setupConvexEnvVars(apiToken, accountId, r2Tokens);
          await setupAISearch();
          console.log('\n🎉 Setup complete!\n');
          return {
            cloudflareApiToken: apiToken.trim(),
            accountId: accountId.trim(),
            bucketName: 'hackathon-repos',
          };
        } catch (error) {
          console.error(
            '\n❌ Failed to continue setup:',
            error instanceof Error ? error.message : error,
          );
          process.exit(1);
        }
      } else {
        console.log('\nYou can run the setup script again after creating the API token.\n');
        process.exit(0);
      }
    }

    // Check for specific Alchemy configuration errors
    if (
      errorMessage.includes('No credentials found') ||
      errorMessage.includes('not found in profile')
    ) {
      console.error('\n❌ Alchemy Cloudflare provider is not configured on the current profile.\n');

      const profileEnv = process.env.ALCHEMY_PROFILE;
      if (profileEnv) {
        console.error(`Current profile: ${profileEnv}\n`);
      } else {
        console.error('Current profile: default\n');
        console.error(
          'ℹ️  If you configured Cloudflare on a different profile (e.g., "hackathon"),',
        );
        console.error('   run this script with: ALCHEMY_PROFILE=hackathon pnpm infra:setup\n');
      }

      console.error('Please run:');
      console.error('  1. npx alchemy configure');
      console.error('     (Make sure Cloudflare is configured on the profile you want to use)');
      console.error('  2. npx alchemy login');
      console.error('     (Or: ALCHEMY_PROFILE=<your-profile> npx alchemy login)');
      console.error('\nThen run this script again.\n');
      process.exit(1);
    }

    console.error('❌ Failed to deploy with Alchemy:', errorMessage);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure you have run: npx alchemy configure');
    console.error('2. Make sure you have run: npx alchemy login');
    console.error('3. Check the error message above for more details\n');
    process.exit(1);
  }
}

function setConvexEnvVar(key: string, value: string, isProd = false): void {
  console.log(`   Setting ${key}...`);
  try {
    const prodFlag = isProd ? '--prod' : '';
    execCommand(`npx convex env set ${key} "${value}" ${prodFlag}`, {
      env: { ...process.env },
    });
    console.log(`   ✅ ${key} set`);
  } catch (error) {
    console.error(`   ❌ Failed to set ${key}:`, error instanceof Error ? error.message : error);
    throw error;
  }
}

async function createR2Tokens(
  cloudflareApiToken: string,
  accountId: string,
): Promise<R2TokenOutput> {
  console.log('\n🔑 Step 2: Creating R2 API tokens...\n');

  try {
    // Try JSON output first (if script supports it)
    let output: string;
    let r2Tokens: R2TokenOutput | null = null;

    try {
      output = execCommand('pnpm infra:create-r2-token', {
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: cloudflareApiToken,
          CLOUDFLARE_ACCOUNT_ID: accountId,
          AUTOMATED: 'true',
        },
      });

      // Try to parse JSON output
      const jsonMatch = output.match(/\{[\s\S]*"bucketName"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          r2Tokens = JSON.parse(jsonMatch[0]) as R2TokenOutput;
        } catch {
          // JSON parse failed, fall through to text parsing
        }
      }
    } catch {
      // If automated mode fails, try without it
      output = execCommand('pnpm infra:create-r2-token', {
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: cloudflareApiToken,
          CLOUDFLARE_ACCOUNT_ID: accountId,
        },
      });
    }

    // If we got JSON, use it
    if (r2Tokens) {
      console.log('✅ R2 tokens created successfully');
      return r2Tokens;
    }

    // Otherwise parse text output
    console.log(output);

    // Parse the output to extract credentials
    // The script outputs lines like: npx convex env set CLOUDFLARE_R2_ACCESS_KEY_ID <value>
    const accessKeyMatch = output.match(/CLOUDFLARE_R2_ACCESS_KEY_ID\s+(\S+)/);
    const secretKeyMatch = output.match(/CLOUDFLARE_R2_SECRET_ACCESS_KEY\s+(\S+)/);
    const bucketMatch = output.match(/CLOUDFLARE_R2_BUCKET_NAME\s+(\S+)/);
    const accountIdMatch = output.match(/CLOUDFLARE_ACCOUNT_ID\s+(\S+)/);

    // Also try to match the actual values from the "Access Key ID:" and "Secret Access Key:" lines
    const accessKeyFromValue = output.match(/Access Key ID:\s+(\S+)/);
    const secretKeyFromValue = output.match(/Secret Access Key:\s+(\S+)/);

    const accessKeyId = accessKeyMatch?.[1] || accessKeyFromValue?.[1];
    const secretAccessKey = secretKeyMatch?.[1] || secretKeyFromValue?.[1];
    const bucketName = bucketMatch?.[1] || 'hackathon-repos';

    if (!accessKeyId || !secretAccessKey) {
      // If parsing fails, ask user to provide values
      console.log('\n⚠️  Could not automatically parse R2 token output.');
      console.log('Please check the output above and provide the values:\n');

      return {
        bucketName: bucketName,
        accessKeyId: await question('R2 Access Key ID: '),
        secretAccessKey: await question('R2 Secret Access Key: '),
        accountId: accountIdMatch?.[1] || accountId,
      };
    }

    return {
      bucketName,
      accessKeyId,
      secretAccessKey,
      accountId: accountIdMatch?.[1] || accountId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a 404 error (endpoint not available)
    if (errorMessage.includes('404') || errorMessage.includes('No route matches')) {
      console.error('\n⚠️  R2 API token creation via API is not available.');
      console.error('R2 API tokens must be created manually in the Cloudflare Dashboard.\n');
      console.error('Please create R2 API tokens manually:');
      console.error('1. In the R2 Overview page, scroll down to "Account Details" section');
      console.error('2. Click the "{ } Manage" button next to "API Tokens"');
      console.error('3. Click "Create Account API token" (recommended for production)');
      console.error('4. Enter a token name (e.g., "hackathon-repos")');
      console.error('5. Under "Permissions", select:');
      console.error('   - Object Read: Allow');
      console.error('   - Object Write: Allow');
      console.error('6. Under "R2 Buckets", select "hackathon-repos" (or "All buckets")');
      console.error('7. Click "Create API Token"');
      console.error('8. Copy the Access Key ID and Secret Access Key (shown only once!)\n');

      const hasTokens = await question('Do you have the R2 API token credentials ready? (y/n): ');
      if (hasTokens.toLowerCase() === 'y') {
        const accessKeyId = await question('Enter R2 Access Key ID: ');
        const secretAccessKey = await question('Enter R2 Secret Access Key: ');
        const bucketName = 'hackathon-repos';

        return {
          bucketName,
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
          accountId,
        };
      } else {
        console.log('\nPlease create the R2 API tokens manually and run this script again.');
        console.log('Or set the Convex environment variables manually:\n');
        console.log(`npx convex env set CLOUDFLARE_R2_BUCKET_NAME hackathon-repos`);
        console.log('npx convex env set CLOUDFLARE_R2_ACCESS_KEY_ID <access-key-id>');
        console.log('npx convex env set CLOUDFLARE_R2_SECRET_ACCESS_KEY <secret-access-key>');
        console.log(`npx convex env set CLOUDFLARE_ACCOUNT_ID ${accountId}\n`);
        throw new Error('R2_TOKEN_MANUAL_REQUIRED');
      }
    }

    console.error('❌ Failed to create R2 tokens:', errorMessage);
    throw error;
  }
}

async function setupConvexEnvVars(
  cloudflareApiToken: string,
  accountId: string,
  r2Tokens: R2TokenOutput,
): Promise<void> {
  console.log('\n📦 Step 3: Setting Convex environment variables...\n');

  const isProd = process.argv.includes('--prod');
  const envLabel = isProd ? 'production' : 'development';

  console.log(`Setting variables for ${envLabel} environment...\n`);

  // Set Cloudflare API token (from Alchemy)
  setConvexEnvVar('CLOUDFLARE_API_TOKEN', cloudflareApiToken, isProd);

  // Set Account ID
  setConvexEnvVar('CLOUDFLARE_ACCOUNT_ID', accountId, isProd);

  // Set R2 credentials
  setConvexEnvVar('CLOUDFLARE_R2_BUCKET_NAME', r2Tokens.bucketName, isProd);
  setConvexEnvVar('CLOUDFLARE_R2_ACCESS_KEY_ID', r2Tokens.accessKeyId, isProd);
  setConvexEnvVar('CLOUDFLARE_R2_SECRET_ACCESS_KEY', r2Tokens.secretAccessKey, isProd);

  console.log('\n✅ All R2-related environment variables set!');
}

async function setupWorkersAIAndGateway(): Promise<void> {
  console.log('\n🧠 Step 4: Enabling Workers AI & configuring AI Gateway...\n');

  console.log(
    'Workers AI powers the rubric-based reviews and needs to be enabled in your Cloudflare account.',
  );
  console.log('If you have not done this yet:');
  console.log('  1. Go to https://dash.cloudflare.com');
  console.log('  2. Navigate to AI > Workers AI');
  console.log('  3. Enable Workers AI (agree to the terms)');
  console.log('');

  const enabled = await question('Have you already enabled Workers AI for this account? (y/n): ');
  if (enabled.toLowerCase() !== 'y') {
    console.log(
      '\nPlease enable Workers AI before continuing — it only takes a moment in the dashboard.',
    );
    await question('Press Enter once Workers AI is enabled to continue...');
  }

  console.log(
    '\nOptional: Cloudflare AI Gateway adds analytics, caching, and rate limits for AI calls.',
  );
  console.log('Create one via AI > AI Gateway (recommended). Make sure to copy the Gateway ID.');

  const gatewayId = await question('Enter your AI Gateway ID (or press Enter to skip): ');
  if (gatewayId.trim()) {
    const isProd = process.argv.includes('--prod');
    console.log(`\nSetting CLOUDFLARE_GATEWAY_ID for ${isProd ? 'production' : 'development'}...`);
    setConvexEnvVar('CLOUDFLARE_GATEWAY_ID', gatewayId.trim(), isProd);
    console.log('\n✅ AI Gateway environment variable set!');

    // Ask about Authenticated Gateway
    console.log('\n🔐 Authenticated Gateway adds security by requiring a token for each request.');
    console.log('This is recommended when storing logs. To set it up:');
    console.log('  1. Go to AI > AI Gateway > [Your Gateway] > Settings');
    console.log('  2. Click "Create authentication token" (with "Run" permissions)');
    console.log("  3. Copy the token immediately (you won't see it again!)");
    console.log('  4. Toggle on "Authenticated Gateway"\n');

    const useAuth = await question('Do you want to configure Authenticated Gateway now? (y/n): ');
    if (useAuth.toLowerCase() === 'y') {
      const authToken = await question(
        'Enter your Gateway authentication token (or press Enter to skip): ',
      );
      if (authToken.trim()) {
        console.log(
          `\nSetting CLOUDFLARE_GATEWAY_AUTH_TOKEN for ${isProd ? 'production' : 'development'}...`,
        );
        setConvexEnvVar('CLOUDFLARE_GATEWAY_AUTH_TOKEN', authToken.trim(), isProd);
        console.log('\n✅ Gateway authentication token set!');
        console.log(
          '\n⚠️  Don\'t forget to toggle on "Authenticated Gateway" in the Gateway Settings!',
        );
      } else {
        console.log('\nSkipping authentication token. You can add it later with:');
        console.log('   npx convex env set CLOUDFLARE_GATEWAY_AUTH_TOKEN <token>');
      }
    } else {
      console.log('\nSkipping Authenticated Gateway. You can configure it later:');
      console.log('  1. Create token in Gateway Settings > Authentication');
      console.log('  2. Set: npx convex env set CLOUDFLARE_GATEWAY_AUTH_TOKEN <token>');
      console.log('  3. Toggle on "Authenticated Gateway" in Settings');
    }
  } else {
    console.log('\nSkipping AI Gateway configuration. You can add it later with:');
    console.log('   npx convex env set CLOUDFLARE_GATEWAY_ID <gateway-id>');
  }
}

async function setupAISearch(): Promise<void> {
  console.log('\n🤖 Step 5: Setting up Cloudflare AI Search...\n');

  console.log('Please follow these steps in the Cloudflare Dashboard:');
  console.log('');
  console.log('1. Go to https://dash.cloudflare.com');
  console.log('2. Navigate to AI > Search (or Workers AI > Search)');
  console.log('3. Click "Create Instance"');
  console.log('4. Name it (e.g., "hackathon-repos") - this becomes the RAG name');
  console.log('5. IMPORTANT: Select "R2 bucket" as the data source');
  console.log('6. Choose your R2 bucket (hackathon-repos)');
  console.log('7. Configure the generation model (default: Llama 3.3)');
  console.log('8. Create the instance');
  console.log('');

  const instanceId = await question('Enter the AI Search Instance Name/ID (RAG name): ');

  if (!instanceId.trim()) {
    console.log('⚠️  Skipping AI Search setup. You can set it later with:');
    console.log('   npx convex env set CLOUDFLARE_AI_SEARCH_INSTANCE_ID <value>');
    return;
  }

  const isProd = process.argv.includes('--prod');
  console.log(
    `\nSetting CLOUDFLARE_AI_SEARCH_INSTANCE_ID for ${isProd ? 'production' : 'development'}...`,
  );
  setConvexEnvVar('CLOUDFLARE_AI_SEARCH_INSTANCE_ID', instanceId.trim(), isProd);

  console.log('\n✅ AI Search environment variable set!');
}

async function main() {
  console.log('🎯 R2 Infrastructure Setup Script\n');
  console.log('This script will:');
  console.log('1. Deploy infrastructure with Alchemy');
  console.log('2. Create R2 API tokens');
  console.log('3. Set Convex environment variables');
  console.log('4. Walk through Workers AI & optional AI Gateway setup');
  console.log('5. Guide you through AI Search setup\n');

  const isProd = process.argv.includes('--prod');
  if (isProd) {
    console.log('⚠️  PRODUCTION MODE: Setting variables for production environment\n');
  }

  console.log('📋 Prerequisites:');
  console.log('   - Alchemy configured: npx alchemy configure');
  console.log('   - Alchemy logged in: npx alchemy login');
  console.log('   - Convex project initialized: npx convex dev (at least once)\n');

  const proceed = await question('Continue? (y/n): ');
  if (proceed.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    process.exit(0);
  }

  try {
    // Step 0: Ensure Alchemy is configured
    await ensureAlchemyConfigured();

    // Step 1: Deploy with Alchemy
    const alchemyOutput = await deployWithAlchemy();
    if (!alchemyOutput) {
      throw new Error('Failed to deploy with Alchemy');
    }

    // Step 2: Create R2 tokens
    let r2Tokens: R2TokenOutput;
    if (!alchemyOutput.cloudflareApiToken || !alchemyOutput.accountId) {
      throw new Error('Missing cloudflareApiToken or accountId from Alchemy output');
    }
    try {
      r2Tokens = await createR2Tokens(alchemyOutput.cloudflareApiToken, alchemyOutput.accountId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === 'R2_TOKEN_MANUAL_REQUIRED') {
        console.log('\nSetup incomplete - R2 API tokens must be created manually.');
        console.log('Please follow the instructions above to create tokens, then:');
        console.log('1. Set Convex environment variables manually, OR');
        console.log('2. Run this script again after creating tokens\n');
        process.exit(0);
      }
      throw error;
    }

    // Step 3: Set Convex env vars
    if (!alchemyOutput.cloudflareApiToken || !alchemyOutput.accountId) {
      throw new Error('Missing cloudflareApiToken or accountId from Alchemy output');
    }
    await setupConvexEnvVars(alchemyOutput.cloudflareApiToken, alchemyOutput.accountId, r2Tokens);

    // Step 4 & 5: Workers AI/Gateway + AI Search
    await setupWorkersAIAndGateway();
    await setupAISearch();

    console.log('\n🎉 Setup complete!\n');
    console.log('Next steps:');
    console.log('1. Verify environment variables in Convex Dashboard');
    console.log('2. Test with a small public GitHub repository');
    console.log('3. Check Convex action logs for any errors\n');
  } catch (error) {
    console.error('\n❌ Setup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error);
  rl.close();
  process.exit(1);
});
