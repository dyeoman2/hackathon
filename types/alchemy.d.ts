/**
 * Type declarations for Alchemy Run
 * Reference: https://alchemy.run/getting-started
 */
declare module 'alchemy' {
  export default function alchemy(appName: string): Promise<{
    finalize(): Promise<void>;
  }>;
}

declare module 'alchemy/cloudflare' {
  export interface R2BucketOptions {
    name: string;
  }

  export function R2Bucket(
    id: string,
    options: R2BucketOptions,
  ): Promise<{
    name: string;
  }>;

  export function PermissionGroups(
    id: string,
  ): Promise<Record<string, { id: string; name: string }>>;

  export interface AccountApiTokenOptions {
    name: string;
    policies: Array<{
      effect: 'allow' | 'deny';
      resources: Record<string, string>;
      permissionGroups: Array<{ id: string }>;
    }>;
  }

  export function AccountApiToken(
    id: string,
    options: AccountApiTokenOptions,
  ): Promise<{
    value: string; // The API token value
  }>;
}
