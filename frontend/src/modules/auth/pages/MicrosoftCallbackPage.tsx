import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import i18n from 'i18n';
import { Spinner } from '../../../ui/Spinner';
import apiCall from '../../common/utils/apiCall';
import { LOGIN } from '../actions/actionTypes';
import { setLocalStorageItem } from '../../../utils/localStorage';
import { UserSettingsApi } from '../../../api/user-settings.api';
import { showErrorToast } from '../../../utils/toast';

/** Same ticket → JWT flow as Google, for Microsoft OAuth. */
const MicrosoftCallbackPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const ticket = searchParams.get('ticket');
    if (!ticket) {
      showErrorToast({
        title: i18n.t('auth.signInFailed'),
        detail: i18n.t('auth.didNotComplete'),
      });
      navigate('/login?error=signin', { replace: true });
      return;
    }

    const finish = async () => {
      try {
        const response = await apiCall({
          method: 'POST',
          url: '/auth/microsoft/session',
          data: { ticket },
        });
        const data = response?.data as {
          access_token: string;
          refresh_token: string;
        };
        setLocalStorageItem('access_token', data.access_token);
        setLocalStorageItem('refresh_token', data.refresh_token);
        dispatch({
          type: LOGIN.success,
          payload: data,
        });

        try {
          const settings = await UserSettingsApi.checkRequiredSettings();
          if (!settings.requiredFilled) {
            navigate('/settings', { replace: true });
            return;
          }
          if (!settings.hasPhases) {
            navigate('/setup/phases', { replace: true });
            return;
          }
        } catch {
          navigate('/', { replace: true });
          return;
        }
        navigate('/', { replace: true });
      } catch (error) {
        console.error('Microsoft sign-in ticket exchange failed:', error);
        showErrorToast({
          title: i18n.t('auth.signInFailed'),
          detail: t('auth.microsoftFailed'),
        });
        navigate('/login?error=signin', { replace: true });
      }
    };

    void finish();
  }, [dispatch, navigate, searchParams, t]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="h-10 w-10" />
    </div>
  );
};

export default MicrosoftCallbackPage;
