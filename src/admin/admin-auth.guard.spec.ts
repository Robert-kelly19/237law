import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAuthGuard } from './admin-auth.guard';

describe('AdminAuthGuard', () => {
  it('should allow when the admin key matches', () => {
    const guard = new AdminAuthGuard(
      { get: (key: string) => (key === 'ADMIN_API_KEY' ? 'correct-key' : undefined) } as ConfigService,
    );

    const result = guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-admin-api-key': 'correct-key' },
        }),
      }),
    } as any);

    expect(result).toBe(true);
  });

  it('should reject when the key is missing', () => {
    const guard = new AdminAuthGuard(
      { get: () => undefined } as unknown as ConfigService,
    );

    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {},
          }),
        }),
      } as any),
    ).toThrow(UnauthorizedException);
  });

  it('should reject when the key is incorrect', () => {
    const guard = new AdminAuthGuard(
      { get: (key: string) => (key === 'ADMIN_API_KEY' ? 'correct-key' : undefined) } as ConfigService,
    );

    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-admin-api-key': 'wrong-key' },
          }),
        }),
      } as any),
    ).toThrow(UnauthorizedException);
  });
});
