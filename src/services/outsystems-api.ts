import { getValidOutSystemsToken } from './token-manager.js';
import { 
  JobStatus, 
  JobCreationResponse, 
  PublicationStatus, 
  PublicationCreationResponse, 
  ApplicationDetails 
} from '../types/api-types.js';
import { 
  OutSystemsApiClient, 
  pollWithBackoff, 
  withRetry, 
  sanitizeErrorMessage 
} from '../utils/apiClient.js';
import { createLogger } from '../utils/logger.js';

// Use Web Crypto API for UUID generation (works in both Node and Workers)
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// --- Configuration ---
const OS_HOSTNAME = process.env.OS_HOSTNAME;

// --- API Helper Functions with Proper Types and Error Handling ---

/**
 * Start the initial generation job
 */
async function startGenerationJob(
  client: OutSystemsApiClient,
  token: string,
  prompt: string
): Promise<string> {
  const jobData = await withRetry(() =>
    client.request<JobCreationResponse>(
      '/api/app-generation/v1alpha3/jobs',
      {
        method: 'POST',
        token,
        body: { prompt, files: [], ignoreTenantContext: true },
        timeout: 30000
      }
    )
  );

  if (!jobData.key) {
    throw new Error("API did not return a valid Job Key.");
  }
  
  return jobData.key;
}

/**
 * Get the status of a generation job
 */
async function getJobStatus(
  client: OutSystemsApiClient,
  token: string,
  jobId: string
): Promise<JobStatus> {
  return await client.request<JobStatus>(
    `/api/app-generation/v1alpha3/jobs/${jobId}`,
    { token, timeout: 15000 }
  );
}

/**
 * Trigger the generation phase
 */
async function triggerGeneration(
  client: OutSystemsApiClient,
  token: string,
  jobId: string
): Promise<void> {
  await withRetry(() =>
    client.request<void>(
      `/api/app-generation/v1alpha3/jobs/${jobId}/generation`,
      {
        method: 'POST',
        token,
        timeout: 30000
      }
    )
  );
}

/**
 * Start the publication process
 */
async function startPublication(
  client: OutSystemsApiClient,
  token: string,
  applicationKey: string
): Promise<string> {
  const pubData = await withRetry(() =>
    client.request<PublicationCreationResponse>(
      '/api/v1/publications',
      {
        method: 'POST',
        token,
        body: { applicationKey, applicationRevision: 1, downloadUrl: null },
        timeout: 30000
      }
    )
  );

  if (!pubData.key) {
    throw new Error("API did not return a valid Publication Key.");
  }
  
  return pubData.key;
}

/**
 * Get the status of a publication
 */
async function getPublicationStatus(
  client: OutSystemsApiClient,
  token: string,
  publicationKey: string
): Promise<PublicationStatus> {
  return await client.request<PublicationStatus>(
    `/api/v1/publications/${publicationKey}`,
    { token, timeout: 15000 }
  );
}

/**
 * Get the final application details
 */
async function getApplicationDetails(
  client: OutSystemsApiClient,
  token: string,
  applicationKey: string
): Promise<ApplicationDetails> {
  return await client.request<ApplicationDetails>(
    `/api/v1/applications/${applicationKey}`,
    { token, timeout: 15000 }
  );
}

/**
 * Polling helper that yields progress updates within a generator
 */
async function* pollWithYield<T>(
  pollFn: () => Promise<T>,
  checkFn: (result: T) => boolean,
  failFn: (result: T) => boolean,
  options: {
    maxAttempts: number;
    initialInterval: number;
    maxInterval: number;
    progressMessage: (attempt: number, maxAttempts: number) => string;
  }
): AsyncGenerator<string, T, unknown> {
  const { maxAttempts, initialInterval, maxInterval, progressMessage } = options;
  
  let interval = initialInterval;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = await pollFn();

    if (checkFn(result)) {
      return result;
    }

    if (failFn(result)) {
      throw new Error(`Polling failed with result: ${JSON.stringify(result)}`);
    }

    // Yield progress every 5 attempts to avoid spamming
    if (attempts === 0 || (attempts + 1) % 5 === 0) {
      yield progressMessage(attempts + 1, maxAttempts);
    }

    await new Promise(resolve => setTimeout(resolve, interval));
    interval = Math.min(interval * 1.5, maxInterval);
    attempts++;
  }

  throw new Error(`Polling timeout after ${attempts} attempts`);
}

// --- Main Orchestration Generator with Exponential Backoff and Correlation IDs ---
export async function* createAndDeployApp(prompt: string): AsyncGenerator<string> {
  // Generate correlation ID for tracking this request
  const correlationId = generateUUID().split('-')[0];
  const logger = createLogger(correlationId);

  if (!OS_HOSTNAME) {
    const error = "Missing required environment variable: OS_HOSTNAME";
    logger.error(error);
    yield sanitizeErrorMessage(new Error(error));
    throw new Error(error);
  }

  const client = new OutSystemsApiClient(OS_HOSTNAME);

  try {
    logger.info('Starting app creation', { 
      promptLength: prompt.length,
      correlationId 
    });

    yield "🔐 Authenticating with OutSystems...";
    const token = await getValidOutSystemsToken();
    logger.debug('Token acquired successfully');
    
    // --- App Generation Phase ---
    yield "🏗️ Step 1/7: Creating generation job...";
    const jobId = await startGenerationJob(client, token, prompt);
    yield `✓ Job created with ID: ${jobId}`;
    logger.info('Job created', { jobId });

    yield "⏳ Step 2/7: Waiting for job to be ready...";
    const jobPoller = pollWithYield<JobStatus>(
      () => getJobStatus(client, token, jobId),
      (status) => status.status === 'ReadyToGenerate',
      (status) => status.status === 'Failed',
      {
        maxAttempts: 60,
        initialInterval: 2000,
        maxInterval: 10000,
        progressMessage: (attempt, max) => `   ⏳ Checking job status (attempt ${attempt}/${max})...`
      }
    );
    
    let readyJobStatus: JobStatus;
    // Manually iterate to get both yielded values and the return value
    let jobIterResult = await jobPoller.next();
    while (!jobIterResult.done) {
      yield jobIterResult.value; // yield the progress message
      jobIterResult = await jobPoller.next();
    }
    readyJobStatus = jobIterResult.value; // get the final return value
    
    yield `✓ Job is ready to generate (Status: ${readyJobStatus.status})`;
    logger.info('Job ready for generation', { status: readyJobStatus.status });

    yield "⚙️ Step 3/7: Generating application logic...";
    await triggerGeneration(client, token, jobId);
    yield "✓ Generation triggered successfully";
    logger.info('Generation triggered');
    
    yield "🔄 Step 4/7: Waiting for generation to complete...";
    const generationPoller = pollWithYield<JobStatus>(
      () => getJobStatus(client, token, jobId),
      (status) => status.status === 'Done',
      (status) => status.status === 'Failed',
      {
        maxAttempts: 120, // Generation can take longer
        initialInterval: 3000,
        maxInterval: 30000,
        progressMessage: (attempt, max) => `   🔄 Generating application (attempt ${attempt}/${max})...`
      }
    );
    
    let completedJobStatus: JobStatus;
    let genIterResult = await generationPoller.next();
    while (!genIterResult.done) {
      yield genIterResult.value;
      genIterResult = await generationPoller.next();
    }
    completedJobStatus = genIterResult.value;

    const applicationKey = completedJobStatus.appSpec?.appKey;
    if (!applicationKey) {
      throw new Error("Generation succeeded, but no Application Key was provided.");
    }
    yield `✓ Application generated (Key: ${applicationKey})`;
    logger.info('Generation completed', { applicationKey });
    
    // --- Publication Phase ---
    yield "🚀 Step 5/7: Starting application deployment...";
    const publicationKey = await startPublication(client, token, applicationKey);
    yield `✓ Deployment started (Key: ${publicationKey})`;
    logger.info('Publication started', { publicationKey });

    yield "📦 Step 6/7: Waiting for deployment to complete...";
    const publicationPoller = pollWithYield<PublicationStatus>(
      () => getPublicationStatus(client, token, publicationKey),
      (status) => status.status === 'Finished',
      (status) => status.status === 'Failed',
      {
        maxAttempts: 120,
        initialInterval: 3000,
        maxInterval: 30000,
        progressMessage: (attempt, max) => `   📦 Deploying application (attempt ${attempt}/${max})...`
      }
    );
    
    let completedPubStatus: PublicationStatus;
    let pubIterResult = await publicationPoller.next();
    while (!pubIterResult.done) {
      yield pubIterResult.value;
      pubIterResult = await publicationPoller.next();
    }
    completedPubStatus = pubIterResult.value;
    
    yield `✓ Deployment completed (Status: ${completedPubStatus.status})`;
    logger.info('Publication completed', { status: completedPubStatus.status });

    yield "🔍 Step 7/7: Retrieving application URL...";
    const appDetails = await getApplicationDetails(client, token, applicationKey);
    
    if (!appDetails?.urlPath) {
      throw new Error("Could not retrieve final application URL.");
    }

    const appHostname = OS_HOSTNAME.replace('.outsystems.dev', '-dev.outsystems.app');
    const finalUrl = `https://${appHostname}/${appDetails.urlPath}`;
    
    logger.info('App creation completed successfully', { 
      finalUrl,
      applicationKey,
      correlationId 
    });

    yield `🎉 Your app is ready! Access it at: ${finalUrl}`;

  } catch (error: any) {
    const sanitizedMessage = sanitizeErrorMessage(error);
    logger.error('App creation failed', error, { correlationId });
    
    // Yield user-friendly error message
    yield `❌ ${sanitizedMessage}`;
    
    // Re-throw with sanitized message
    throw new Error(sanitizedMessage);
  }
}
