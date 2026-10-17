import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CalendarProviderId } from '../calendar-providers/calendar-provider.types';
import { User } from '../users/user.entity';
import { UserIdentity } from './entities/user-identity.entity';

export type UpsertIdentityInput = {
  userId: string;
  provider: CalendarProviderId;
  providerUserId: string;
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
  isRegistrationIdentity?: boolean;
};

@Injectable()
export class UserIdentitiesService {
  constructor(
    @InjectRepository(UserIdentity)
    private readonly identityRepo: Repository<UserIdentity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  listForUser(userId: string): Promise<UserIdentity[]> {
    return this.identityRepo.find({ where: { userId } });
  }

  findByProviderUser(
    provider: CalendarProviderId,
    providerUserId: string,
  ): Promise<UserIdentity | null> {
    return this.identityRepo.findOne({ where: { provider, providerUserId } });
  }

  async upsert(input: UpsertIdentityInput): Promise<UserIdentity> {
    let row = await this.identityRepo.findOne({
      where: {
        provider: input.provider,
        providerUserId: input.providerUserId,
      },
    });
    if (row && row.userId !== input.userId) {
      throw new BadRequestException({
        code: 'IDENTITY_OWNED_BY_OTHER_USER',
        message:
          'This identity is already linked to another account. Choose which account data to keep.',
        existingUserId: row.userId,
        linkingUserId: input.userId,
      });
    }
    if (!row) {
      row = this.identityRepo.create({
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email ?? null,
        accessToken: input.accessToken ?? null,
        refreshToken: input.refreshToken ?? null,
        tokenExpiry: input.tokenExpiry ?? null,
        isRegistrationIdentity: !!input.isRegistrationIdentity,
      });
    } else {
      if (input.email !== undefined) row.email = input.email;
      if (input.accessToken !== undefined) row.accessToken = input.accessToken;
      if (input.refreshToken !== undefined) {
        row.refreshToken = input.refreshToken;
      }
      if (input.tokenExpiry !== undefined) row.tokenExpiry = input.tokenExpiry;
      if (input.isRegistrationIdentity) row.isRegistrationIdentity = true;
    }
    return this.identityRepo.save(row);
  }

  /**
   * Merge: move identities (and leave tasks on keepUserId). Caller deletes the other user.
   */
  async reassignUserIdentities(
    fromUserId: string,
    toUserId: string,
  ): Promise<void> {
    if (fromUserId === toUserId) return;
    await this.identityRepo.update({ userId: fromUserId }, { userId: toUserId });
  }

  async disconnect(
    userId: string,
    provider: CalendarProviderId,
  ): Promise<void> {
    const rows = await this.identityRepo.find({ where: { userId, provider } });
    if (!rows.length) {
      throw new NotFoundException(`No ${provider} identity linked`);
    }
    // Apple is CalDAV-only (never a sign-in identity) — always safe to drop.
    if (provider !== 'apple') {
      const remainingIdentities =
        (await this.identityRepo.count({ where: { userId } })) - rows.length;
      const user = await this.userRepo.findOne({
        where: { id: userId },
        select: { googleId: true },
      });
      // Legacy Google sign-in stores googleId on User, not always in user_identities.
      const hasGoogleLogin = !!user?.googleId && provider !== 'google';
      if (remainingIdentities <= 0 && !hasGoogleLogin) {
        throw new BadRequestException(
          'Cannot disconnect the last sign-in identity',
        );
      }
    }
    await this.identityRepo.delete({ userId, provider });
  }
}
