import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { LogOut } from 'lucide-react';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import UserSettingsForm from 'modules/user-settings/components/UserSettingsForm';
import { logout } from 'modules/auth/actions/logoutActions';

const SettingsPage: React.FC = () => {
    const dispatch = useDispatch<any>();
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
            <div className="page-shell-fill">
                <div className="flex flex-1 items-center justify-center">
                    <div className="settings-card text-center">
                        <h2 className="mb-2 text-lg font-semibold text-ide-text">Loading settings…</h2>
                        <p className="text-sm text-ide-muted">Please wait.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (apiError) {
        return (
            <div className="page-shell-fill">
                <div className="flex flex-1 items-center justify-center">
                    <div className="settings-card border-ide-error text-center">
                        <h2 className="mb-2 text-lg font-semibold text-ide-error">Could not load settings</h2>
                        <p className="mb-4 text-sm text-ide-muted">Please try again.</p>
                        <button type="button" onClick={handleRetry} className="ui-btn-danger">
                            Retry
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell-fill">
            <header className="page-head shrink-0">
                <div>
                    <h1 className="page-title">Settings</h1>
                    <p className="page-lead">Time zone, wake/sleep times, Google Calendar, and account.</p>
                </div>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
                <div className="settings-card">
                    <div className="mb-8 border-b border-ide-border pb-8">
                        <h2 className="mb-2 text-xl font-semibold text-ide-text">Time management</h2>
                        <p className="text-sm text-ide-muted">
                            These settings affect how your schedule is built. Wake, sleep, and phases
                            use the time zone you set here.
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

                <section className="settings-card">
                    <h2 className="mb-2 text-xl font-semibold text-ide-text">Account</h2>
                    <p className="mb-4 text-sm text-ide-muted">
                        You are signed in with Google. Signing out only ends this session; your data stays on this
                        account.
                    </p>
                    <button
                        type="button"
                        onClick={() => dispatch(logout(true))}
                        className="ui-btn-secondary inline-flex items-center gap-2 border-ide-error text-ide-error hover:bg-ide-error/10"
                    >
                        <LogOut className="h-4 w-4" aria-hidden />
                        Sign out
                    </button>
                </section>
            </div>
        </div>
    );
};

export default SettingsPage;
