import { describe, expect, it } from 'vitest';

import { staticCredentials } from './credentials.js';
import { IamClient } from './iam.js';
import { SigningClient, type RawResponse, type Transport } from './signer.js';

const credentials = staticCredentials({ accessKeyId: 'A', secretAccessKey: 'B' });

function response(status: number, body: string): RawResponse {
  const bytes = new TextEncoder().encode(body);
  return { statusCode: status, headers: {}, body: bytes, text: () => body };
}

const ALREADY_EXISTS = `<ErrorResponse><Error><Code>EntityAlreadyExists</Code><Message>Role exists</Message></Error></ErrorResponse>`;
const GET_ROLE = `<GetRoleResponse><GetRoleResult><Role><Arn>arn:aws:iam::1:role/deploy</Arn></Role></GetRoleResult></GetRoleResponse>`;

function iamWith(transport: Transport): IamClient {
  return new IamClient(new SigningClient({ region: 'us-east-1', credentials, transport }));
}

const TRUST = { Version: '2012-10-17', Statement: [{ Effect: 'Allow' }] };

describe('IamClient.ensureRole', () => {
  it('reconciles the trust policy when the role already exists', async () => {
    const actions: string[] = [];
    const bodies: string[] = [];
    const transport: Transport = async (req) => {
      const body = String(req.body ?? '');
      const action = /Action=([A-Za-z]+)/.exec(body)?.[1] ?? '?';
      actions.push(action);
      bodies.push(decodeURIComponent(body));
      if (action === 'CreateRole') return response(409, ALREADY_EXISTS);
      if (action === 'GetRole') return response(200, GET_ROLE);
      return response(200, '<UpdateAssumeRolePolicyResponse/>');
    };

    const arn = await iamWith(transport).ensureRole('deploy', TRUST, 'desc');

    expect(arn).toBe('arn:aws:iam::1:role/deploy');
    expect(actions).toEqual(['CreateRole', 'GetRole', 'UpdateAssumeRolePolicy']);
    expect(bodies[2]).toContain('"Version":"2012-10-17"');
  });

  it('creates the role and skips the trust reconcile when it is new', async () => {
    const actions: string[] = [];
    const transport: Transport = async (req) => {
      const action = /Action=([A-Za-z]+)/.exec(String(req.body ?? ''))?.[1] ?? '?';
      actions.push(action);
      return response(
        200,
        `<CreateRoleResponse><CreateRoleResult><Role><Arn>arn:aws:iam::1:role/deploy</Arn></Role></CreateRoleResult></CreateRoleResponse>`,
      );
    };

    const arn = await iamWith(transport).ensureRole('deploy', TRUST);

    expect(arn).toBe('arn:aws:iam::1:role/deploy');
    expect(actions).toEqual(['CreateRole']);
  });
});

describe('IamClient.ensureRole tags', () => {
  it('sends Tags.member params on create and TagRole on the exists path', async () => {
    const bodies: string[] = [];
    let phase = 0;
    const transport: Transport = async (req) => {
      const body = decodeURIComponent(String(req.body ?? ''));
      bodies.push(body);
      if (body.includes('Action=CreateRole')) return response(409, ALREADY_EXISTS);
      if (body.includes('Action=GetRole')) return response(200, GET_ROLE);
      phase += 1;
      return response(200, '<ok/>');
    };

    await iamWith(transport).ensureRole('deploy', TRUST, 'd', {
      environment: 'production',
      app: 'blog.example.com',
    });

    expect(bodies[0]).toContain('Tags.member.1.Key=environment');
    expect(bodies[0]).toContain('Tags.member.1.Value=production');
    expect(bodies[0]).toContain('Tags.member.2.Key=app');
    const tagRole = bodies.find((b) => b.includes('Action=TagRole'));
    expect(tagRole).toContain('Tags.member.2.Value=blog.example.com');
    expect(phase).toBeGreaterThan(0);
  });
});
