import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';

const TARGET = 'CertificateManager';

export interface DomainValidationRecord {
  name: string;
  type: string;
  value: string;
}

export interface CertificateStatus {
  status: string;
  validation: DomainValidationRecord[];
}

/** ACM client (AWS JSON 1.1). Certificates for CloudFront must live in us-east-1. */
export class AcmClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(op: string, payload: object): Promise<T> {
    const res = await this.client.send({
      service: 'acm',
      method: 'POST',
      path: '/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `${TARGET}.${op}`,
      },
      body: JSON.stringify(payload),
    });
    const text = res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Request a DNS-validated certificate and return its ARN. */
  async requestCertificate(domainName: string, idempotencyToken: string): Promise<string> {
    const out = await this.call<{ CertificateArn: string }>('RequestCertificate', {
      DomainName: domainName,
      ValidationMethod: 'DNS',
      IdempotencyToken: idempotencyToken,
    });
    return out.CertificateArn;
  }

  async describeCertificate(certificateArn: string): Promise<CertificateStatus> {
    const out = await this.call<{
      Certificate?: {
        Status?: string;
        DomainValidationOptions?: Array<{
          ResourceRecord?: { Name?: string; Type?: string; Value?: string };
        }>;
      };
    }>('DescribeCertificate', { CertificateArn: certificateArn });

    const cert = out.Certificate ?? {};
    const validation: DomainValidationRecord[] = [];
    for (const opt of cert.DomainValidationOptions ?? []) {
      const rr = opt.ResourceRecord;
      if (rr?.Name && rr.Type && rr.Value) {
        validation.push({ name: rr.Name, type: rr.Type, value: rr.Value });
      }
    }
    return { status: cert.Status ?? 'PENDING_VALIDATION', validation };
  }

  async deleteCertificate(certificateArn: string): Promise<void> {
    try {
      await this.call('DeleteCertificate', { CertificateArn: certificateArn });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }
}
