// import db from 'db/connection';
//
// const getSetting = async (key: string): Promise<string | null> => {
//     const record = await db('settings').where({ key }).first();
//     return record?.value ?? null;
// };
//
// export default {
//     getAccessTokenTtl: () => getSetting('accessTokenTtl'),
//     getRefreshTokenTtl: () => getSetting('refreshTokenTtl'),
//     getVerificationCodeTtl: () => getSetting('verificationCodeTtl'),
// };
