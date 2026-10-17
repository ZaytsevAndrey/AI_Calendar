import type { LoginFormProps } from './LoginForm';

/** Login must not accept Apple sign-in props (Settings CalDAV only). */
describe('LoginForm Apple exclusion', () => {
  it('props type has no Apple fields', () => {
    const props: LoginFormProps = {
      requestStatus: 'idle',
      onGoogleSignIn: () => undefined,
      microsoftAvailable: true,
      onMicrosoftSignIn: () => undefined,
    };
    expect(props).not.toHaveProperty('onAppleSignIn');
    expect(props).not.toHaveProperty('appleAvailable');
  });
});
