import React, { useState } from 'react';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import UserSettingsForm from 'modules/user-settings/components/UserSettingsForm';

const SettingsPage: React.FC = () => {
    const [error, setError] = useState<string | null>(null);

    const {
        data: userSettings,
        isLoading,
        error: apiError,
    } = useGetUserSettingsQuery(undefined, { refetchOnMountOrArgChange: true });

    const handleRetry = () => {
        if (apiError instanceof Error) {
            setError(apiError.message);
        } else {
            setError('Failed to fetch settings');
        }
    };

    if (isLoading) {
        return (
            <div className="page-shell">
                <div className="settings-card text-center">
                    <h2 className="mb-2 text-lg font-semibold text-ide-text">Loading settings…</h2>
                    <p className="text-sm text-ide-muted">Please wait.</p>
                </div>
            </div>
        );
    }

    if (apiError) {
        return (
            <div className="page-shell">
                <div className="settings-card border-ide-error text-center">
                    <h2 className="mb-2 text-lg font-semibold text-ide-error">Could not load settings</h2>
                    <p className="mb-4 text-sm text-ide-muted">Please try again.</p>
                    <button type="button" onClick={handleRetry} className="ui-btn-danger">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell">
            <header className="page-head">
                <div>
                    <h1 className="page-title">Settings</h1>
                    <p className="page-lead">Wake/sleep times and Google Calendar.</p>
                </div>
            </header>

            <div className="settings-card">
                <div className="mb-8 border-b border-ide-border pb-8">
                    <h2 className="mb-2 text-xl font-semibold text-ide-text">Time management</h2>
                    <p className="text-sm text-ide-muted">
                        These settings affect how your schedule is built. Set wake and sleep times and
                        connect Google Calendar.
                    </p>
                </div>

                {error ? (
                    <div className="mb-4 rounded-lg border border-ide-error bg-ide-error/10 px-4 py-3 text-sm text-ide-error">
                        {error}
                    </div>
                ) : null}

                {userSettings && Object.keys(userSettings).length > 0 && userSettings.id && (
                    <UserSettingsForm initialData={userSettings} />
                )}
            </div>
        </div>
    );
};

export default SettingsPage;
