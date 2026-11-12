import { Logger } from '@nestjs/common';

const logger = new Logger('EnvValidation');
export function validateRequiredEnvVars(
  requiredVars: string[],
  requiredAnyOf: string[][] = [],
): void {
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);
  const missingGroups = requiredAnyOf.filter(
    (varNames) => !varNames.some((varName) => process.env[varName]),
  );

  if (missingVars.length > 0 || missingGroups.length > 0) {
    console.error('Missing required environment variables:');
    missingVars.forEach((varName) => {
      logger.error(`  - ${varName}`);
    });
    missingGroups.forEach((varNames) => {
      logger.error(`  - one of: ${varNames.join(', ')}`);
    });
    // Exit the process if these are critical
    process.exit(1);
  }
}
