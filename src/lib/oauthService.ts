/**
 * OAuth 2.0 Authentication Service
 * Handles token acquisition and refresh for payment gateway APIs
 */

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface TokenData extends TokenResponse {
  expires_at: number; // timestamp when token expires
}

class OAuthService {
  private tokens: Map<string, TokenData> = new Map();

  /**
   * Get OAuth configuration for a payment gateway
   */
  private getOAuthConfig(gateway: string): OAuthConfig | null {
    const configs = {
      mtn: {
        clientId: import.meta.env.REACT_APP_MTN_CLIENT_ID,
        clientSecret: import.meta.env.REACT_APP_MTN_CLIENT_SECRET,
        tokenUrl: `${import.meta.env.REACT_APP_MTN_API_URL || 'https://api.mtn.com/v1'}/oauth/token`,
        scope: 'payments',
      },
      airtel: {
        clientId: import.meta.env.REACT_APP_AIRTEL_CLIENT_ID,
        clientSecret: import.meta.env.REACT_APP_AIRTEL_CLIENT_SECRET,
        tokenUrl: `${import.meta.env.REACT_APP_AIRTEL_API_URL || 'https://api.airtel.com/v1'}/oauth/token`,
        scope: 'payments',
      },
      zamtel: {
        clientId: import.meta.env.REACT_APP_ZAMTEL_CLIENT_ID,
        clientSecret: import.meta.env.REACT_APP_ZAMTEL_CLIENT_SECRET,
        tokenUrl: `${import.meta.env.REACT_APP_ZAMTEL_API_URL || 'https://api.zamtel.com/v1'}/oauth/token`,
        scope: 'payments',
      },
      zedmobile: {
        clientId: import.meta.env.REACT_APP_ZEDMOBILE_CLIENT_ID,
        clientSecret: import.meta.env.REACT_APP_ZEDMOBILE_CLIENT_SECRET,
        tokenUrl: `${import.meta.env.REACT_APP_ZEDMOBILE_API_URL || 'https://api.zedmobile.com/v1'}/oauth/token`,
        scope: 'payments',
      },
    };

    return configs[gateway as keyof typeof configs] || null;
  }

  /**
   * Check if a token is expired or will expire soon (within 5 minutes)
   */
  private isTokenExpired(tokenData: TokenData): boolean {
    const now = Date.now();
    const expiryBuffer = 5 * 60 * 1000; // 5 minutes buffer
    return now >= (tokenData.expires_at - expiryBuffer);
  }

  /**
   * Get a valid access token for the specified gateway
   */
  async getAccessToken(gateway: string): Promise<string> {
    const config = this.getOAuthConfig(gateway);
    if (!config) {
      throw new Error(`OAuth configuration not found for gateway: ${gateway}`);
    }

    // Check if we have a valid cached token
    const cachedToken = this.tokens.get(gateway);
    if (cachedToken && !this.isTokenExpired(cachedToken)) {
      return cachedToken.access_token;
    }

    // Get new token
    const tokenData = await this.requestAccessToken(config);

    // Cache the token
    this.tokens.set(gateway, tokenData);

    return tokenData.access_token;
  }

  /**
   * Request a new access token from the OAuth provider
   */
  private async requestAccessToken(config: OAuthConfig): Promise<TokenData> {
    try {
      const authHeader = btoa(`${config.clientId}:${config.clientSecret}`);

      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: config.scope || '',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('OAuth token request failed:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          url: config.tokenUrl,
        });
        throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}`);
      }

      const tokenResponse: TokenResponse = await response.json();

      // Calculate expiry timestamp
      const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);

      return {
        ...tokenResponse,
        expires_at: expiresAt,
      };
    } catch (error) {
      console.error('OAuth token request error:', error);
      throw new Error(`Failed to get OAuth token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Refresh an access token using refresh token (if supported)
   */
  async refreshAccessToken(gateway: string): Promise<string> {
    const config = this.getOAuthConfig(gateway);
    if (!config) {
      throw new Error(`OAuth configuration not found for gateway: ${gateway}`);
    }

    const cachedToken = this.tokens.get(gateway);
    if (!cachedToken?.refresh_token) {
      throw new Error(`No refresh token available for gateway: ${gateway}`);
    }

    try {
      const authHeader = btoa(`${config.clientId}:${config.clientSecret}`);

      const response = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: cachedToken.refresh_token,
        }),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }

      const tokenResponse: TokenResponse = await response.json();
      const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);

      const newTokenData = {
        ...tokenResponse,
        expires_at: expiresAt,
      };

      this.tokens.set(gateway, newTokenData);
      return newTokenData.access_token;
    } catch (error) {
      console.error('Token refresh error:', error);
      // Clear cached token on refresh failure
      this.tokens.delete(gateway);
      throw error;
    }
  }

  /**
   * Clear cached tokens for a gateway (useful for logout or token invalidation)
   */
  clearTokens(gateway?: string): void {
    if (gateway) {
      this.tokens.delete(gateway);
    } else {
      this.tokens.clear();
    }
  }

  /**
   * Get token expiry information for debugging
   */
  getTokenInfo(gateway: string): { expires_at: number; is_expired: boolean } | null {
    const tokenData = this.tokens.get(gateway);
    if (!tokenData) return null;

    return {
      expires_at: tokenData.expires_at,
      is_expired: this.isTokenExpired(tokenData),
    };
  }
}

// Export singleton instance
export const oauthService = new OAuthService();

// Export types for external use
export type { OAuthConfig, TokenResponse, TokenData };