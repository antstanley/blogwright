import { AwsError } from './errors.js';
import type { SigningClient } from './signer.js';
import type { ResourceTags } from '../tags.js';

const TARGET = 'Logs_20140328';

export interface LogEvent {
  eventId: string;
  timestamp: number;
  message: string;
}

export interface FilterEventsOptions {
  startTime?: number | undefined;
  endTime?: number | undefined;
}

/** CloudWatch Logs client (AWS JSON 1.1). */
export class LogsClient {
  constructor(private readonly client: SigningClient) {}

  private async call<T>(op: string, payload: object): Promise<T> {
    const res = await this.client.send({
      service: 'logs',
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

  async ensureLogGroup(name: string, tags?: ResourceTags): Promise<void> {
    try {
      await this.call('CreateLogGroup', {
        logGroupName: name,
        ...(tags && Object.keys(tags).length > 0 ? { tags } : {}),
      });
    } catch (err) {
      if (err instanceof AwsError && err.isAlreadyExists) return;
      throw err;
    }
  }

  async putRetentionPolicy(name: string, retentionInDays: number): Promise<void> {
    await this.call('PutRetentionPolicy', { logGroupName: name, retentionInDays });
  }

  async logGroupExists(name: string): Promise<boolean> {
    const out = await this.call<{ logGroups?: Array<{ logGroupName: string }> }>(
      'DescribeLogGroups',
      { logGroupNamePrefix: name },
    );
    return (out.logGroups ?? []).some((g) => g.logGroupName === name);
  }

  async deleteLogGroup(name: string): Promise<void> {
    try {
      await this.call('DeleteLogGroup', { logGroupName: name });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  /** Fetch events across a log group within an optional time window. */
  async filterEvents(logGroupName: string, opts: FilterEventsOptions = {}): Promise<LogEvent[]> {
    const events: LogEvent[] = [];
    let nextToken: string | undefined;
    do {
      const out = await this.call<{ events?: LogEvent[]; nextToken?: string }>('FilterLogEvents', {
        logGroupName,
        ...(opts.startTime !== undefined ? { startTime: opts.startTime } : {}),
        ...(opts.endTime !== undefined ? { endTime: opts.endTime } : {}),
        ...(nextToken ? { nextToken } : {}),
      });
      for (const e of out.events ?? []) {
        events.push({ eventId: e.eventId, timestamp: e.timestamp, message: e.message });
      }
      nextToken = out.nextToken;
    } while (nextToken);
    return events;
  }

  // --- CloudWatch vended log delivery (used to send CloudFront access logs here) ---

  async putDeliverySource(
    name: string,
    resourceArn: string,
    logType: string,
    tags?: ResourceTags,
  ): Promise<string> {
    const out = await this.call<{ deliverySource?: { arn?: string } }>('PutDeliverySource', {
      name,
      resourceArn,
      logType,
      ...(tags && Object.keys(tags).length > 0 ? { tags } : {}),
    });
    return out.deliverySource?.arn ?? '';
  }

  async putDeliveryDestination(name: string, logGroupArn: string): Promise<string> {
    const out = await this.call<{ deliveryDestination?: { arn?: string } }>(
      'PutDeliveryDestination',
      { name, deliveryDestinationConfiguration: { destinationResourceArn: logGroupArn } },
    );
    return out.deliveryDestination?.arn ?? '';
  }

  async createDelivery(deliverySourceName: string, deliveryDestinationArn: string): Promise<void> {
    try {
      await this.call('CreateDelivery', { deliverySourceName, deliveryDestinationArn });
    } catch (err) {
      if (err instanceof AwsError && err.isAlreadyExists) return;
      throw err;
    }
  }

  /** The delivery id linking a given source (needed to delete it), or undefined if none. */
  async findDeliveryIdBySource(deliverySourceName: string): Promise<string | undefined> {
    let nextToken: string | undefined;
    do {
      const out = await this.call<{
        deliveries?: Array<{ id?: string; deliverySourceName?: string }>;
        nextToken?: string;
      }>('DescribeDeliveries', nextToken ? { nextToken } : {});
      const match = (out.deliveries ?? []).find((d) => d.deliverySourceName === deliverySourceName);
      if (match?.id) return match.id;
      nextToken = out.nextToken;
    } while (nextToken);
    return undefined;
  }

  /** Ids of every delivery attached to a delivery source. */
  async deliveriesForSource(sourceName: string): Promise<string[]> {
    const ids: string[] = [];
    let nextToken: string | undefined;
    do {
      const out = await this.call<{
        deliveries?: Array<{ id: string; deliverySourceName?: string }>;
        nextToken?: string;
      }>('DescribeDeliveries', nextToken ? { nextToken } : {});
      for (const d of out.deliveries ?? []) {
        if (d.deliverySourceName === sourceName) ids.push(d.id);
      }
      nextToken = out.nextToken;
    } while (nextToken);
    return ids;
  }

  async deleteDelivery(id: string): Promise<void> {
    try {
      await this.call('DeleteDelivery', { id });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async deleteDeliverySource(name: string): Promise<void> {
    try {
      await this.call('DeleteDeliverySource', { name });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }

  async deleteDeliveryDestination(name: string): Promise<void> {
    try {
      await this.call('DeleteDeliveryDestination', { name });
    } catch (err) {
      if (err instanceof AwsError && err.isNotFound) return;
      throw err;
    }
  }
}
