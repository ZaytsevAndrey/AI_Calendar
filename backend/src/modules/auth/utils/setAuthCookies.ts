import { FastifyReply } from 'fastify';
import { FastifyInstance } from 'fastify';
import '@fastify/cookie';

type FastifyReplyWithCookie = FastifyReply & {
  setCookie: (name: string, value: string, options?: any) => void;
};

export function setAuthCookies(
  reply: FastifyReply,
  tokens: { access_token: string; refresh_token: string },
): void {
  // Return tokens directly in the response
  reply.send(tokens);
}
