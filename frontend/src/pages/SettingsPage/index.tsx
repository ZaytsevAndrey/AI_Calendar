import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import UserSettingsForm from 'modules/user-settings/components/UserSettingsForm';
import { logout } from 'modules/auth/actions/logoutActions';
import { buildLabel } from 'modules/common/buildInfo';

const SettingsPage: React.FC = () => {
    const { t } = useTranslation();
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
            setError(t('settings.fetchFailed'));
        }
    };

    if (isLoading) {
        return (
            <div className="page-shell-fill">
                <div className="flex flex-1 items-center justify-center">
                    <div className="settings-card text-center">
                        <h2 className="mb-2 text-lg font-semibold text-ide-text">{t('settings.loadingTitle')}</h2>
                        <p className="text-sm text-ide-muted">{t('common.pleaseWait')}</p>
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
                        <h2 className="mb-2 text-lg font-semibold text-ide-error">{t('settings.loadErrorTitle')}</h2>
                        <p className="mb-4 text-sm text-ide-muted">{t('settings.loadErrorHint')}</p>
                        <button type="button" onClick={handleRetry} className="ui-btn-danger">
                            {t('common.retry')}
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
                    <h1 className="page-title">{t('settings.title')}</h1>
                    <p className="page-lead">{t('settings.lead')}</p>
                </div>
            </header>

            <div className="page-scroll space-y-6">
                <div className="settings-card">
                    <div className="mb-8 border-b border-ide-border pb-8">
                        <h2 className="mb-2 text-xl font-semibold text-ide-text">{t('settings.timeManagement')}</h2>
                        <p className="text-sm text-ide-muted">
                            {t('settings.timeManagementHint')}
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
                    <h2 className="mb-2 text-xl font-semibold text-ide-text">{t('settings.account')}</h2>
                    <p className="mb-4 text-sm text-ide-muted">
                        {t('settings.accountHint')}
                    </p>
                    <button
                        type="button"
                        onClick={() => dispatch(logout(true))}
                        className="ui-btn-secondary inline-flex items-center gap-2 border-ide-error text-ide-error hover:bg-ide-error/10 max-md:h-8 max-md:min-h-0 max-md:px-3 max-md:py-0"
                    >
                        <LogOut className="h-4 w-4" aria-hidden />
                        {t('settings.logout')}
                    </button>
                    <p className="mt-4 text-center text-[11px] leading-4 text-ide-muted md:hidden">
                        Build {buildLabel()}
                    </p>
                </section>
            </div>
        </div>
    );
};

export default SettingsPage;
