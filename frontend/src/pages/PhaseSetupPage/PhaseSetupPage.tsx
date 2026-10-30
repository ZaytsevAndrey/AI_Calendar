import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
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
import { logout } from 'modules/auth/actions/logoutActions';
import { showErrorToast } from 'utils/toast';
import { phaseSetupOffersDayShape, type PhaseSetupStep } from './phaseSetupStep';
import { ArrowLeft, ArrowRight, Check, SkipForward } from 'lucide-react';
import { Button } from 'ui/Button';
import { TimeField } from 'ui/TimeField';

const PhaseSetupPage: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const dispatch = useDispatch<any>();
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

    const [step, setStep] = useState<PhaseSetupStep>('sleep');
    const [wakeTime, setWakeTime] = useState('08:00');
    const [sleepTime, setSleepTime] = useState('23:00');
    const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [presetChoice, setPresetChoice] = useState<PhasePresetChoice>('defaults');

    useEffect(() => {
        if (settings?.wakeTime) setWakeTime(settings.wakeTime.slice(0, 5));
        if (settings?.sleepTime) setSleepTime(settings.sleepTime.slice(0, 5));
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

    const saveWakeSleep = async (): Promise<boolean> => {
        try {
            await updateSettings({ wakeTime, sleepTime }).unwrap();
            return true;
        } catch {
            showErrorToast({
                title: t('phases.saveSettingsFailed'),
                detail: t('phases.saveSettingsDetail'),
            });
            return false;
        }
    };

    const handleContinue = async () => {
        const saved = await saveWakeSleep();
        if (saved) setStep('phases');
    };

    const handleSave = async () => {
        if (selectedDays.length === 0) {
            showErrorToast({
                title: t('phases.selectWeekdays'),
                detail: t('phases.selectWeekdaysSetupDetail'),
            });
            return;
        }
        const saved = await saveWakeSleep();
        if (!saved) return;
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
        const saved = await saveWakeSleep();
        if (!saved) return;
        await runBootstrap(undefined);
    };

    const busy = savingSettings || bootstrapping || applyingPreset;
    const showDayShape = phaseSetupOffersDayShape(step);

    return (
        <div className="page-shell-fill">
            <div className="page-scroll">
                <div className="mx-auto w-full max-w-2xl">
                    <div className="rounded-sheet border border-ide-border bg-ide-panel p-5 shadow-ide-md sm:p-8">
                        <div className="mb-6 flex items-center gap-3" aria-hidden>
                            <img src="/icon-64.png" alt="" className="h-8 w-8 rounded-[9px]" />
                            <div className="flex flex-1 gap-1.5">
                                <span className="h-1.5 flex-1 rounded-full bg-ide-accentBlue" />
                                <span className={`h-1.5 flex-1 rounded-full ${showDayShape ? 'bg-ide-accentBlue' : 'bg-ide-border'}`} />
                            </div>
                        </div>
                        <p className="mb-1 text-body-sm text-ide-muted">
                            {t('phases.setupStep', { step: showDayShape ? 2 : 1, total: 2 })}
                        </p>
                        <h1 className="mb-2 text-title font-semibold text-ide-text md:text-display">
                            {showDayShape ? t('phases.setupTitle') : t('phases.setupSleepTitle')}
                        </h1>
                        <p className="mb-8 text-body text-ide-muted">
                            {showDayShape ? t('phases.setupLead') : t('phases.setupSleepLead')}
                        </p>

                        {showDayShape ? (
                            <div className="space-y-6">
                                <WeekDaysSelector
                                    selectedDays={selectedDays}
                                    setSelectedDays={setSelectedDays}
                                    errors={errors}
                                />
                                <div>
                                    <p className="mb-2 text-body-sm font-medium text-ide-muted">{t('phases.dayShape')}</p>
                                    <PhasePresetPicker
                                        includeDefaults
                                        value={presetChoice}
                                        onChange={setPresetChoice}
                                        disabled={busy}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div>
                                    <label htmlFor="setup-wake" className="mb-1.5 block text-body-sm font-medium text-ide-muted">
                                        {t('phases.wake')}
                                    </label>
                                    <TimeField
                                        id="setup-wake"
                                        value={wakeTime}
                                        onChange={setWakeTime}
                                        className="w-40"
                                        minuteStep={15}
                                        aria-label={t('phases.wake')}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="setup-sleep" className="mb-1.5 block text-body-sm font-medium text-ide-muted">
                                        {t('phases.sleep')}
                                    </label>
                                    <TimeField
                                        id="setup-sleep"
                                        value={sleepTime}
                                        onChange={setSleepTime}
                                        className="w-40"
                                        minuteStep={15}
                                        aria-label={t('phases.sleep')}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                            {showDayShape ? (
                                <>
                                    <Button
                                        type="button"
                                        disabled={busy || selectedDays.length === 0}
                                        onClick={handleSave}
                                        className="flex-1 sm:flex-initial sm:min-w-[200px]"
                                        icon={Check}
                                    >
                                        {t('phases.saveCreate')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        disabled={busy}
                                        onClick={handleSkip}
                                        className="flex-1 sm:flex-initial"
                                        icon={SkipForward}
                                    >
                                        {t('phases.skipDefaults')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => setStep('sleep')}
                                        className="flex-1 sm:order-first sm:mr-auto sm:flex-initial"
                                        icon={ArrowLeft}
                                    >
                                        {t('phases.setupBack')}
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    type="button"
                                    disabled={busy}
                                    onClick={handleContinue}
                                    className="flex-1 sm:flex-initial sm:min-w-[200px]"
                                    icon={ArrowRight}
                                >
                                    {t('phases.setupContinue')}
                                </Button>
                            )}
                        </div>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => dispatch(logout(true))}
                            className="mt-6 min-h-11 text-body-sm text-ide-muted underline-offset-2 hover:text-ide-text hover:underline md:min-h-0"
                        >
                            {t('settings.logout')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PhaseSetupPage;
