export type PaymentMethod = 
        | "CARD"
        | "UPI"
        | "NETBANKING"
        | "WALLET" 
        | "MANDATE"


export type PaymentStatus = 
        | "PENDING"
        | "FAILED"
        | "RECOVERING"
        | "SUCCEEDED"
        | "EXHAUSTED"
        | "HARD_STOPPED"


export type FailureSource = "CUSTOMER" | "BANK" | "GATEWAY" | "BUSINESS"

export type FailureStep = "AUTHENTICATION" | "AUTHORIZATION" | "CAPTURE"

export type RecoveryStatus = 
        | "FAILED"
        | "CLASSIFIED"
        | "SCHEDULED"
        | "RETRYING"
        | "RECOVERED"
        | "HARD_STOPPED"
        | "EXHAUSTED"
        | "HUMAN_REVIEW"


export type RootCause =
        | "CUSTOMER_FUNDS_LOW"
        | "CUSTOMER_AUTH_FAILURE"
        | "CUSTOMER_ABANDONMENT"
        | "ISSUER_TEMPORARY_FAILURE"
        | "GATEWAY_FAILURE"
        | "PAYMENT_METHOD_INVALID"
        | "MANDATE_INVALID"
        | "UNKNOWN";

export type RecoveryActions = 
        | "RETRY"
        | "WAIT"
        | "SWITCH_RAIL"
        | "MESSAGE"
        | "HARD_STOP"
        | "HUMAN_REVIEW"

export type ClassificationSource = "RULE"  | "LLM_SUGGESTION" | "HUMAN";

export type RecoveryOutcomeStatus =
        | "SUCCESS"
        | "FAILED"
        | "BLOCKED"
        | "DUPLICATE"
        | "CANCELLED";