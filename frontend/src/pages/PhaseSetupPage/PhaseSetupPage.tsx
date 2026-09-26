import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    useGetUserSettingsQuery,
    useUpdateUserSettingsMutation,
    useCheckRequiredSettingsQuery,
} from 'api/userSettingsApi';
import { useApplyPhasePresetMutation, useSetupDefaultPhasesMutation } from 'api/phasesApi';
import { WeekDaysSelector } from 'modules/phases/components/WeekDaysSelector';
import {
    PhasePresetPicker,
    messageFromApiError,
    type PhasePresetChoice,
} from 'modules/phases/components/PhasePresetPicker';
import { showErrorToast } from 'utils/toast';

const PhaseSetupPage: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { data: gate } = useCheckRequiredSettingsQuery();
    const { data: settings } = useGetUserSettingsQuery();

    useEffect(() => {
        if (gate?.hasPhases) {
            navigate('/', { replace: true });
        }
    }, [gate?.hasPhases, navigate]);

    const [updateSettings, { isLoading: savingSettings }] = useUpdateUserSettingsMutation();
    const [setupDefaults, { isLoading: bootstrapping }] = useSetupDefaultPhasesMutation();
    const [applyPreset, { isLoading: applyingPreset }] = useApplyPhasePresetMutation();

    const [wakeTime, setWakeTime] = useState('08:00');
    const [sleepTime, setSleepTime] = useState('23:00');
    const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [presetChoice, setPresetChoice] = useState<PhasePresetChoice>('defaults');

    useEffect(() => {
        if (settings?.wakeTime) setWakeTime(settings.wakeTime);
        if (settings?.sleepTime) setSleepTime(settings.sleepTime);
    }, [settings?.wakeTime, settings?.sleepTime]);

    const errors =
        selectedDays.length === 0
            ? { weekDays: { message: t('phases.selectOneDay') } as { message: string } }
            : {};

    const runBootstrap = async (weekDays: number[] | undefined) => {
        try {
            await setupDefaults(weekDays && weekDays.length > 0 ? { weekDays } : undefined).unwrap();
            navigate('/', { replace: true });
        } catch (err: unknown) {
            const msg =
                err &&
                typeof err === 'object' &&
                'data' in err &&
                (err as { data?: { message?: string } }).data?.message;
            showErrorToast({
                title: t('phases.createFailed'),
                detail: typeof msg === 'string' ? msg : undefined,
            });
        }
    };

    const handleSave = async () => {
        if (selectedDays.length === 0) {
            showErrorToast({
                title: t('phases.selectWeekdays'),
                detail: t('phases.selectWeekdaysSetupDetail'),
            });
            return;
        }
        try {
            await updateSettings({ wakeTime, sleepTime }).unwrap();
        } catch {
            showErrorToast({
                title: t('phases.saveSettingsFailed'),
                detail: t('phases.saveSettingsDetail'),
            });
            return;
        }
        if (presetChoice === 'defaults') {
            await runBootstrap(selectedDays);
            return;
        }
        try {
            await applyPreset({
                presetId: presetChoice,
                weekDays: selectedDays,
            }).unwrap();
            navigate('/', { replace: true });
        } catch (err: unknown) {
            showErrorToast({
                title: t('phases.createFailed'),
                detail: messageFromApiError(err),
            });
        }
    };

    const handleSkip = async () => {
        await runBootstrap(undefined);
    };

    const busy = savingSettings || bootstrapping || applyingPreset;

    return (
        <div className="page-shell-fill">
            <div className="page-scroll">
                <div className="mx-auto w-full max-w-2xl">
                    <div className="rounded-xl border border-ide-border bg-ide-panel p-5 shadow-ide-md sm:p-8">
                        <h1 className="page-title mb-2">{t('phases.setupTitle')}</h1>
                        <p className="page-lead mb-8">{t('phases.setupLead')}</p>

                        <div className="space-y-6">
                            <div>
                                <label htmlFor="setup-wake" className="ui-label">
                                    {t('phases.wake')}
                                </label>
                                <input
                                    id="setup-wake"
                                    type="time"
                                    value={wakeTime}
                                    onChange={(e) => setWakeTime(e.target.value)}
                                    className="ui-input max-w-xs"
                                />
                            </div>
                            <div>
                                <label htmlFor="setup-sleep" className="ui-label">
                                    {t('phases.sleep')}
                                </label>
                                <input
                                    id="setup-sleep"
                                    type="time"
                                    value={sleepTime}
                                    onChange={(e) => setSleepTime(e.target.value)}
                                    className="ui-input max-w-xs"
                                />
                            </div>
                            <WeekDaysSelector
                                selectedDays={selectedDays}
                                setSelectedDays={setSelectedDays}
                                errors={errors}
                            />
                            <div>
                                <p className="ui-label mb-2">{t('phases.dayShape')}</p>
                                <PhasePresetPicker
                                    includeDefaults
                                    value={presetChoice}
                                    onChange={setPresetChoice}
                                    disabled={busy}
                                />
                            </div>
                        </div>

                        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                            <button
                                type="button"
                                disabled={busy || selectedDays.length === 0}
                                onClick={handleSave}
                                className="ui-btn-primary flex-1 sm:flex-initial sm:min-w-[200px]"
                            >
                                {t('phases.saveCreate')}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={handleSkip}
                                className="ui-btn-secondary flex-1 sm:flex-initial"
                            >
                                {t('phases.skipDefaults')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PhaseSetupPage;
