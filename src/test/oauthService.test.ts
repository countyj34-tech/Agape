import { describe, it, expect, vi, beforeEach } from 'vitest';
import { oauthService } from '../lib/oauthService';

// Mock fetch globally
global.fetch = vi.fn();

describe('OAuthService', () => {
  beforeEach(() => {
    // Clear all mocks and cached tokens
    vi.clearAllMocks();
    oauthService.clearTokens();
  });

  describe('getAccessToken', () => {
    it('should request and cache a new token when none exists', async () => {
      const mockTokenResponse = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'payments',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const token = await oauthService.getAccessToken('mtn');

      expect(token).toBe('test-access-token');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should return cached token when valid token exists', async () => {
      const mockTokenResponse = {
        access_token: 'cached-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'payments',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      // First call - should fetch new token
      await oauthService.getAccessToken('mtn');

      // Second call - should return cached token
      const cachedToken = await oauthService.getAccessToken('mtn');

      expect(cachedToken).toBe('cached-token');
      expect(global.fetch).toHaveBeenCalledTimes(1); // Only one fetch call
    });

    it('should throw error when OAuth config is missing', async () => {
      await expect(oauthService.getAccessToken('unknown')).rejects.toThrow(
        'OAuth configuration not found for gateway: unknown'
      );
    });

    it('should handle token request failure', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'invalid_client' }),
      });

      await expect(oauthService.getAccessToken('mtn')).rejects.toThrow(
        'OAuth token request failed: 400 Bad Request'
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh token when refresh token is available', async () => {
      // First, set up a cached token with refresh token
      const initialToken = {
        access_token: 'initial-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token-123',
        scope: 'payments',
        expires_at: Date.now() + 3600000,
      };

      // Mock the refresh token response
      const refreshResponse = {
        access_token: 'refreshed-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
        scope: 'payments',
      };

      // Manually set the cached token (simulating previous successful auth)
      (oauthService as any).tokens.set('mtn', initialToken);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(refreshResponse),
      });

      const newToken = await oauthService.refreshAccessToken('mtn');

      expect(newToken).toBe('refreshed-token');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error when no refresh token is available', async () => {
      await expect(oauthService.refreshAccessToken('mtn')).rejects.toThrow(
        'No refresh token available for gateway: mtn'
      );
    });
  });

  describe('clearTokens', () => {
    it('should clear tokens for specific gateway', async () => {
      const mockTokenResponse = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'payments',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      await oauthService.getAccessToken('mtn');

      // Verify token is cached
      expect((oauthService as any).tokens.has('mtn')).toBe(true);

      // Clear specific gateway
      oauthService.clearTokens('mtn');

      // Verify token is cleared
      expect((oauthService as any).tokens.has('mtn')).toBe(false);
    });

    it('should clear all tokens when no gateway specified', async () => {
      const mockTokenResponse = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'payments',
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      await oauthService.getAccessToken('mtn');
      await oauthService.getAccessToken('airtel');

      // Verify tokens are cached
      expect((oauthService as any).tokens.has('mtn')).toBe(true);
      expect((oauthService as any).tokens.has('airtel')).toBe(true);

      // Clear all tokens
      oauthService.clearTokens();

      // Verify all tokens are cleared
      expect((oauthService as any).tokens.size).toBe(0);
    });
  });

  describe('getTokenInfo', () => {
    it('should return token expiry information', async () => {
      const mockTokenResponse = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'payments',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      await oauthService.getAccessToken('mtn');

      const tokenInfo = oauthService.getTokenInfo('mtn');

      expect(tokenInfo).toBeTruthy();
      expect(tokenInfo?.is_expired).toBe(false);
      expect(tokenInfo?.expires_at).toBeGreaterThan(Date.now());
    });

    it('should return null when no token exists', () => {
      const tokenInfo = oauthService.getTokenInfo('mtn');
      expect(tokenInfo).toBeNull();
    });
  });
});