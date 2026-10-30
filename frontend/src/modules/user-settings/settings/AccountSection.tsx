import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { logout } from 'modules/auth/actions/logoutActions';
import { DeleteAccountSection } from 'modules/auth/components/DeleteAccountSection';
import { buildLabel } from 'modules/common/buildInfo';
import { listLinkedIdentities } from 'api/calendarOverlays.api';
import { Button } from 'ui/Button';
import { SettingRow, SettingsGroup } from './SettingsUi';

export function AccountSection() {
    const { t } = useTranslation();
    const dispatch = useDispatch<any>();
    const [email, setEmail] = useState<string | null>(null);

    useEffect(() => {
        void listLinkedIdentities()
            .then((rows) => setEmail(rows.find((row) => row.provider === 'google')?.email ?? null))
            .catch(() => setEmail(null));
    }, []);

    return (
        <div className="space-y-4">
            <SettingsGroup>
                <SettingRow
                    stack
                    label={t('settings.account')}
                    hint={email ? t('settings.signedInAs', { email }) : t('settings.accountHint')}
                >
                    <Button variant="secondary" icon={LogOut} onClick={() => dispatch(logout(true))}>
                        {t('settings.logout')}
                    </Button>
                </SettingRow>
                <SettingRow label={t('settings.version')}>
                    <span className="text-body-sm tabular-nums text-ide-muted">Build {buildLabel()}</span>
                </SettingRow>
            </SettingsGroup>
            <SettingsGroup title={t('settings.dangerZone')} className="border-ide-error/40">
                <div className="px-4 py-3 md:px-5">
                    <DeleteAccountSection />
                </div>
            </SettingsGroup>
        </div>
    );
}
