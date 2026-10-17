import React from 'react';
import { render, screen } from '@testing-library/react';
import LoginForm from './LoginForm';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('LoginForm', () => {
  it('shows Google and optional Microsoft, never Apple', () => {
    render(
      <LoginForm
        requestStatus="idle"
        onGoogleSignIn={() => undefined}
        onMicrosoftSignIn={() => undefined}
        microsoftAvailable
      />,
    );
    expect(screen.getByText('auth.continueGoogle')).toBeTruthy();
    expect(screen.getByText('auth.continueMicrosoft')).toBeTruthy();
    expect(screen.queryByText('auth.continueApple')).toBeNull();
    expect(screen.queryByText(/Apple/i)).toBeNull();
  });
});
