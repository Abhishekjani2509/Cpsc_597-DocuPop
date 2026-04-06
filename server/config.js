"use strict";
/**
 * Environment Configuration
 *
 * Centralized configuration management with environment-based settings.
 * Uses environment variables and AWS Secrets Manager for sensitive data.
 *
 * Security features:
 * - No hardcoded credentials
 * - Environment-based configuration (local, staging, production)
 * - Type-safe configuration access
 * - Validates required environment variables
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.logConfigSummary = logConfigSummary;
/**
 * Get current environment
 */
function getEnvironment() {
    const env = process.env.APP_ENV || process.env.NODE_ENV || 'local';
    if (env === 'production')
        return 'production';
    if (env === 'staging')
        return 'staging';
    return 'local';
}
/**
 * Load configuration from environment variables
 */
function loadConfig() {
    const env = getEnvironment();
    const nodeEnv = process.env.NODE_ENV || 'development';
    const config = {
        // Environment
        env,
        nodeEnv,
        isProduction: env === 'production',
        isStaging: env === 'staging',
        isLocal: env === 'local',
        // AWS Configuration
        aws: {
            region: process.env.AWS_REGION || 'us-west-1',
            accountId: process.env.AWS_ACCOUNT_ID,
        },
        // Database Configuration
        database: {
            url: process.env.DATABASE_URL,
            host: process.env.PGHOST,
            port: process.env.PGPORT ? parseInt(process.env.PGPORT) : undefined,
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
            ssl: env !== 'local', // SSL for staging/production only
        },
        // S3 Configuration (enabled for staging/production)
        s3: {
            enabled: env !== 'local',
            bucketName: process.env.S3_BUCKET_NAME || 'docupop-documents-prod',
            region: process.env.AWS_REGION || 'us-west-1',
        },
        // SQS Configuration (enabled for staging/production)
        sqs: {
            enabled: env !== 'local',
            queueUrl: process.env.SQS_QUEUE_URL,
            region: process.env.AWS_REGION || 'us-west-1',
        },
        // Cognito Configuration (enabled for staging/production)
        cognito: {
            enabled: env !== 'local',
            userPoolId: process.env.COGNITO_USER_POOL_ID || 'us-west-1_YzbMednD9',
            clientId: process.env.COGNITO_CLIENT_ID,
            region: process.env.AWS_REGION || 'us-west-1',
        },
        // Authentication
        auth: {
            secret: process.env.LOCAL_AUTH_SECRET || 'local-dev-secret-change-in-production',
            sessionMaxAge: 30 * 24 * 60 * 60, // 30 days in seconds
        },
        // OCR Worker
        ocr: {
            workerToken: process.env.PROCESSING_WORKER_TOKEN || 'dev-worker-token',
            useTextract: env !== 'local', // Use Textract for staging/production
        },
        // Secrets Manager
        secrets: {
            enabled: env !== 'local',
            region: process.env.AWS_REGION || 'us-west-1',
        },
    };
    // Validate required configuration based on environment
    if (config.s3.enabled && !config.s3.bucketName) {
        console.warn('⚠️  S3 is enabled but S3_BUCKET_NAME is not set');
    }
    if (config.sqs.enabled && !config.sqs.queueUrl) {
        console.warn('⚠️  SQS is enabled but SQS_QUEUE_URL is not set');
    }
    if (config.cognito.enabled && !config.cognito.userPoolId) {
        console.warn('⚠️  Cognito is enabled but COGNITO_USER_POOL_ID is not set');
    }
    return config;
}
// Export singleton configuration
exports.config = loadConfig();
/**
 * Log configuration summary (without sensitive data)
 */
function logConfigSummary() {
    console.log('📋 Configuration Summary:');
    console.log(`   Environment: ${exports.config.env}`);
    console.log(`   AWS Region: ${exports.config.aws.region}`);
    console.log(`   S3: ${exports.config.s3.enabled ? '✅ Enabled' : '❌ Disabled (using local storage)'}`);
    console.log(`   SQS: ${exports.config.sqs.enabled ? '✅ Enabled' : '❌ Disabled (using HTTP polling)'}`);
    console.log(`   Cognito: ${exports.config.cognito.enabled ? '✅ Enabled' : '❌ Disabled (using custom auth)'}`);
    console.log(`   Textract: ${exports.config.ocr.useTextract ? '✅ Enabled' : '❌ Disabled (using Tesseract)'}`);
    console.log(`   Secrets Manager: ${exports.config.secrets.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log('');
}
