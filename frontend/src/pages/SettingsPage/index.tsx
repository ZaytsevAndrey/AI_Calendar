import React, { useState } from 'react';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import UserSettingsForm from 'modules/user-settings/components/UserSettingsForm';
import './styles.scss';

const SettingsPage: React.FC = () => {
  const [error, setError] = useState<string | null>(null);

  // Fetch user settings
  const { 
    data: userSettings, 
    isLoading, 
    error: apiError
  } = useGetUserSettingsQuery();


  const handleRetry = () => {
    if (apiError instanceof Error) {
      setError(apiError.message);
    } else {
      setError('Failed to fetch settings');
    }
  };

  if (isLoading) {
    return (
      <div className="settings-page">
        <div className="loading-container">
          <h2>Loading your settings...</h2>
          <p>Please wait while we fetch your preferences.</p>
        </div>
      </div>
    );
  }

  if (apiError) {
    return (
      <div className="settings-page">
        <div className="error-container">
          <h2>Error loading settings</h2>
          <p>We couldn&apos;t load your settings. Please try again.</p>
          <button onClick={handleRetry} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1>User Settings</h1>
      </header>

      <div className="settings-container">
        <div className="settings-description">
          <h2>Time Management Settings</h2>
          <p>
            These settings determine how your schedule is organized. Set your wake and sleep times,
            preferred work patterns, and other preferences to help the AI organize your tasks more effectively.
          </p>
        </div>



        {error && <div className="error">{error}</div>}

        {userSettings && Object.keys(userSettings).length > 0 && userSettings.id && (
          <UserSettingsForm
            initialData={userSettings}
          />
        )}
      </div>
    </div>
  );
};

export default SettingsPage; 