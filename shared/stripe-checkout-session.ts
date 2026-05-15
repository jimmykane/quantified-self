export type VerifiedCheckoutMode = 'payment' | 'subscription';

export interface VerifyCheckoutSessionRequest {
    sessionId: string;
}

export interface VerifyCheckoutSessionResult {
    verified: true;
    transactionId: string;
    mode: VerifiedCheckoutMode;
    isTrialCheckout: boolean;
    priceId?: string;
    currency?: string;
    value?: number;
    role?: string | null;
}
