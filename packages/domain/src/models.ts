import { ClassificationSource, FailureSource, FailureStep,
    PaymentMethod, PaymentStatus, RecoveryActions, 
    RecoveryOutcomeStatus, 
    RecoveryStatus, RootCause 
} from "./enums";

export interface Customer { 
    id: string, 
    name: string, 
    email: string, 
    phone?: string, 

    balanceState?: string, 

    salaryDay?: number;
    preferredLanguage?: "EN" | "HI" | "HINGLISH";
    createdAt: Date;
}


export interface Payment {
    id: string, 
    customerId: string, 

    amount: string, 
    currency: "INR", 

    method: PaymentMethod, 
    status: PaymentStatus,

    attemptCount: number, 
    
    createdAt: Date, 
    updatedAt: Date
}


export interface GatewayError {
    code: string, 
    reason: string, 
    source: FailureSource, 
    step: FailureStep, 
    description: string
}


export interface PaymentFailure { 
    id: string, 
    paymentId: string, 

    error: GatewayError, 

    rawPayload?: unknown, 

    occuredAt: Date
}

export interface Classification {
    id: string, 
    failureId: string, 

    cause: RootCause, 

    confidence: number, 

    ruleId?: string, 

    evidence: string[], 

    source: ClassificationSource, 

    createdAt: Date
}

export interface RecoveryActionRecord {
    id: string, 
    paymentId: string, 
    cause: RootCause, 
    action: RecoveryActions, 
    scheduledFor?: Date, 
    attemptNumber: number;
    status: RecoveryStatus;
    idempotencyKey: string;
    createdAt: Date;
    executedAt?: Date;
}

export interface RecoveryOutcome {
    id: string;

    actionId: string;

    status: RecoveryOutcomeStatus;

    amountRecovered: number;

    gatewayLatencyMs?: number;
    failureReason?: string;

    occurredAt: Date;
}

export interface AuditEvent {
    id: string;

    paymentId?: string;
    eventType: string;

    whatWeSaw: string;
    whatWeConcluded: string;
    whatWasAllowed: string;
    whatWeDid: string;
    whatHappened: string;

    metadata?: Record<string, unknown>;

    createdAt: Date;
}

export interface FailureIngestionRequest {
    paymentId: string;

    amount: number;
    currency: "INR";

    method: PaymentMethod;

    error: GatewayError;

    occurredAt?: string;
}

export interface FailureIngestionResponse {
  failureId: string;

  paymentId: string;

  status: "ACCEPTED" | "DUPLICATE";
}

export interface RecoveryDecision {
  action: RecoveryActions;

  cause: RootCause;
  reason: string;

  delayMinutes?: number;
  maxAttempts?: number;

  requiresCustomerMessage?: boolean;
  requiresHumanReview?: boolean;
}

