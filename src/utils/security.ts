import { logger } from './logger.js';

/**
 * Security configuration
 */
export interface SecurityConfig {
  /** List of allowed user IDs (empty = allow all) */
  allowedUsers: string[];

  /** Whether whitelist is enabled */
  whitelistEnabled: boolean;

  /** Maximum message length in characters */
  maxMessageLength: number;

  /** Whether to enable prompt injection detection */
  promptInjectionDetection: boolean;
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowedUsers: [],
  whitelistEnabled: false,
  maxMessageLength: 10000,
  promptInjectionDetection: true,
};

/**
 * Parse ALLOWED_USERS environment variable
 * Format: comma-separated user IDs (e.g., "123456,789012,345678")
 */
function parseAllowedUsers(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim() === '') {
    return [];
  }

  return envValue
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Load security configuration.
 * When appSecurityConfig (from AppConfig.security) is provided, uses those values
 * instead of re-parsing process.env — satisfying the single-source-of-truth requirement.
 */
export function loadSecurityConfig(appSecurityConfig?: {
  allowedUsers?: string;
  maxMessageLength?: number;
  promptInjectionDetection?: boolean;
}): SecurityConfig {
  const allowedUsers = parseAllowedUsers(appSecurityConfig?.allowedUsers ?? process.env.ALLOWED_USERS);
  const whitelistEnabled = allowedUsers.length > 0;

  const maxMessageLength = appSecurityConfig?.maxMessageLength
    ?? (process.env.MAX_MESSAGE_LENGTH
      ? parseInt(process.env.MAX_MESSAGE_LENGTH, 10)
      : DEFAULT_SECURITY_CONFIG.maxMessageLength);

  const promptInjectionDetection = appSecurityConfig?.promptInjectionDetection
    ?? process.env.PROMPT_INJECTION_DETECTION !== 'false';

  const config: SecurityConfig = {
    allowedUsers,
    whitelistEnabled,
    maxMessageLength: isNaN(maxMessageLength)
      ? DEFAULT_SECURITY_CONFIG.maxMessageLength
      : maxMessageLength,
    promptInjectionDetection,
  };

  if (whitelistEnabled) {
    logger.info(
      { userCount: allowedUsers.length },
      'User whitelist enabled'
    );
  } else {
    logger.warn('User whitelist disabled - all users allowed');
  }

  return config;
}

/**
 * Check if a user is allowed based on whitelist
 */
export function isUserAllowed(
  userId: string,
  config: SecurityConfig
): boolean {
  // If whitelist is disabled, allow all users
  if (!config.whitelistEnabled) {
    return true;
  }

  return config.allowedUsers.includes(userId);
}

/**
 * Validate message length
 */
export function isMessageLengthValid(
  message: string,
  config: SecurityConfig
): boolean {
  return message.length <= config.maxMessageLength;
}

/**
 * Prompt injection detection patterns
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction override attempts
  /ignore\s+(all\s+)?(previous\s+)?(instructions?|prompts?)/i,
  /disregard\s+(all\s+)?(previous\s+)?(instructions?|prompts?)/i,
  /forget\s+(all\s+)?(previous\s+)?(instructions?|prompts?)/i,

  // System prompt extraction attempts
  /what\s+is\s+your\s+system\s+prompt/i,
  /show\s+me\s+your\s+(system\s+)?instructions/i,
  /reveal\s+your\s+(system\s+)?prompt/i,
  /print\s+your\s+(system\s+)?prompt/i,

  // Role manipulation attempts
  /you\s+are\s+now\s+(a|an)\s+/i,
  /pretend\s+you\s+are\s+(a|an)?\s*/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(a|an)?\s*/i,
  /roleplay\s+as\s+(a|an)?\s*/i,

  // Jailbreak attempts
  /\bDAN\b.*\bmode\b/i,
  /developer\s+mode/i,
  /bypass\s+(safety|security|filters?)/i,
  /disable\s+(safety|security|filters?)/i,

  // Instruction injection markers
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /###\s*(Human|Assistant|System):/i,
];

/**
 * Check for potential prompt injection attempts
 * Returns detected patterns if found, empty array if clean
 */
export function detectPromptInjection(
  message: string,
  config: SecurityConfig
): string[] {
  if (!config.promptInjectionDetection) {
    return [];
  }

  const detectedPatterns: string[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      detectedPatterns.push(pattern.source);
    }
  }

  if (detectedPatterns.length > 0) {
    logger.warn(
      { patternCount: detectedPatterns.length },
      'Potential prompt injection detected'
    );
  }

  return detectedPatterns;
}

/**
 * Validation result for messages
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

/**
 * Validate an incoming message
 */
export function validateMessage(
  message: string,
  userId: string,
  config: SecurityConfig
): ValidationResult {
  // Check user whitelist
  if (!isUserAllowed(userId, config)) {
    return {
      valid: false,
      error: 'unauthorized',
    };
  }

  // Check message length
  if (!isMessageLengthValid(message, config)) {
    return {
      valid: false,
      error: 'message_too_long',
    };
  }

  // Check for prompt injection
  const injectionPatterns = detectPromptInjection(message, config);
  if (injectionPatterns.length > 0) {
    return {
      valid: true, // Still allow but with warning
      warnings: ['potential_prompt_injection'],
    };
  }

  return { valid: true };
}

/**
 * Get user-friendly error message
 */
export function getSecurityErrorMessage(error: string): string {
  switch (error) {
    case 'unauthorized':
      return '抱歉，您沒有使用此 Bot 的權限。如需存取，請聯繫管理員。';
    case 'message_too_long':
      return '抱歉，您的訊息過長。請縮短訊息後重試。';
    default:
      return '抱歉，發生安全驗證錯誤。';
  }
}

