export type CanUseToolResult =
  | {
      behavior: 'allow';
      updatedInput: Record<string, unknown>;
      toolUseID: string;
      updatedPermissions?: Array<{
        type: 'addRules';
        rules: Array<{ toolName: string }>;
        behavior: 'allow';
        destination: 'localSettings';
      }>;
    }
  | {
      behavior: 'deny';
      message: string;
      toolUseID: string;
    };

export interface CanUseToolOptions {
  signal: AbortSignal;
  blockedPath?: string;
  decisionReason?: string;
  toolUseID: string;
}
