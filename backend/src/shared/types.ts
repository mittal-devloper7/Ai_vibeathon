export interface AuthContext {
  organizationId: string;
  apiKeyId: string;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthContext;
      orgId?: string;
    }
  }
}
