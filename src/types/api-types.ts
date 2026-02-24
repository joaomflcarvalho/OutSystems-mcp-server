/**
 * Type definitions for OutSystems API responses
 * Provides type safety across all API interactions
 */

export interface TokenResponse {
  token: string;
  expiresIn: number;
}

export type JobStatusType = 'Pending' | 'ReadyToGenerate' | 'Generating' | 'Done' | 'Failed';

export interface JobStatus {
  key: string;
  status: JobStatusType;
  appSpec?: {
    appKey: string;
    [key: string]: any;
  };
  prompt?: string;
  files?: any[];
  createdAt?: string;
  updatedAt?: string;
}

export interface JobCreationResponse {
  key: string;
  status: JobStatusType;
}

export type PublicationStatusType = 'Queued' | 'Running' | 'Finished' | 'Failed';

export interface PublicationStatus {
  key: string;
  status: PublicationStatusType;
  applicationKey: string;
  applicationRevision: number;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string;
}

export interface PublicationCreationResponse {
  key: string;
  status: PublicationStatusType;
}

export interface ApplicationDetails {
  key: string;
  name: string;
  urlPath: string;
  description?: string;
  organizationKey?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiErrorResponse {
  message: string;
  code?: string;
  details?: any;
}

export interface CachedToken {
  token: string;
  expiresAt: number; // Unix timestamp in seconds
}

