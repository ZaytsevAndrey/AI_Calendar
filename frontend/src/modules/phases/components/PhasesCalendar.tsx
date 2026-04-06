import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { PhaseDTO } from 'api/phases.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { timeToMinutes } from '../utils/phasesTimeUtils';

interface PhasesCalendarProps {
  phases: PhaseDTO[];
  onEditPhase?: (phase: PhaseDTO) => void;
}

const PhasesCalendar: React.FC<PhasesCalendarProps> = ({ phases, onEditPhase }) => {
  // Отримуємо налаштування користувача для часу сну
  const { data: userSettings } = useGetUserSettingsQuery();

  // Витягуємо початок і кінець дня з userSettings
  const startTime = userSettings?.wakeTime || '07:00';
  const endTime = userSettings?.sleepTime || '22:00';
  const startTimeMinutes = timeToMinutes(startTime);
  const endTimeMinutes = timeToMinutes(endTime);

  // Створюємо масив днів тижня (без конкретних дат)
  const getWeekDays = () => {
    const days = [];
    for (let i = 1; i <= 6; i++) {
      days.push(i); // 1 = Monday, ..., 6 = Saturday
    }
    days.push(0); // 0 = Sunday
    return days;
  };

  // Створюємо часові слоти тільки в межах дня
  const getTimeSlots = () => {
    const slots = [];
    for (let hour = startTimeMinutes / 60; hour <= endTimeMinutes / 60; hour++) {
      const time = `${hour.toString().padStart(2, '0')}:00`;
      slots.push(time);
    }
    return slots;
  };

  // Фільтруємо фази - приховуємо час сну
  const getDisplayPhases = () => {
    console.log('All phases:', phases);
    const filtered = phases.filter(phase => phase.type !== 'sleep_time');
    console.log('Filtered phases (excluding sleep):', filtered);
    return filtered;
  };

  // Перевіряємо, чи час входить в час сну
  const isSleepTime = (time: string): boolean => {
    console.log('Checking sleep time for:', time);
    console.log('User settings:', userSettings);
    
    if (!userSettings?.sleepTime) {
      console.log('No sleep time set, returning false');
      return false;
    }

    const timeMinutes = timeToMinutes(time);
    const sleepMinutes = timeToMinutes(userSettings.sleepTime);
    
    // Припускаємо, що час сну триває 8 годин
    const sleepDuration = 8 * 60; // 8 годин у хвилинах
    const sleepStartMinutes = sleepMinutes;
    const sleepEndMinutes = (sleepMinutes + sleepDuration) % (24 * 60); // Обмежуємо до 24 годин

    console.log(`Sleep calculation: start=${sleepStartMinutes}, end=${sleepEndMinutes}, current=${timeMinutes}`);

    if (sleepStartMinutes > sleepEndMinutes) {
      // Час сну перетинає північ
      const isSleep = timeMinutes >= sleepStartMinutes || timeMinutes <= sleepEndMinutes;
      console.log(`Sleep crosses midnight, isSleep: ${isSleep}`);
      return isSleep;
    } else {
      const isSleep = timeMinutes >= sleepStartMinutes && timeMinutes <= sleepEndMinutes;
      console.log(`Normal sleep time, isSleep: ${isSleep}`);
      return isSleep;
    }
  };

  const weekDays = getWeekDays();
  const timeSlots = getTimeSlots();
  const displayPhases = getDisplayPhases();

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Weekly Phases Template
      </Typography>
      
      <Box sx={{ 
        display: 'grid', 
        gridTemplateColumns: '80px repeat(7, 1fr)',
        gap: 1
      }}>
        {/* Заголовок з днями тижня */}
        <Box sx={{ 
          p: 1, 
          backgroundColor: 'grey.100', 
          borderBottom: '1px solid #e0e0e0',
          fontWeight: 'bold',
          textAlign: 'center'
        }}>
          Time
        </Box>
        {weekDays.map((dayOfWeek, index) => (
          <Box 
            key={dayOfWeek}
            sx={{ 
              p: 1, 
              backgroundColor: 'grey.100', 
              borderBottom: '1px solid #e0e0e0',
              fontWeight: 'bold',
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" display="block">
              {dayNames[index]}
            </Typography>
          </Box>
        ))}

        {/* Часові мітки зліва */}
        <Box sx={{ 
          position: 'relative',
          minHeight: '600px',
          borderRight: '1px solid #e0e0e0',
          backgroundColor: 'grey.50'
        }}>
          {timeSlots.filter(time => !isSleepTime(time)).map((time, index) => {
            const timeMinutes = timeToMinutes(time);
            // Замість жорстко заданого '09:00' використовуємо startTime
            const startTimeMinutes = timeToMinutes(startTime);
            const timeDiff = timeMinutes - startTimeMinutes;
            const top = (timeDiff / 60) * 40 + (index * 1); // 40px на годину + бордери
            
            return (
              <Box
                key={time}
                sx={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: 0,
                  right: 0,
                  height: '40px',
                  fontSize: '0.6rem',
                  color: 'grey.600',
                  padding: '2px 4px',
                  borderTop: '1px solid rgba(0,0,0,0.1)',
                  backgroundColor: 'rgba(255,255,255,0.5)',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {time}
              </Box>
            );
          })}
        </Box>

        {/* Суцільні прямокутники фаз для кожного дня */}
        {weekDays.map((dayOfWeek, dayIndex) => {
          const phases = getDisplayPhases().filter(phase => {
            if (!phase.weekDays || phase.weekDays.length === 0) {
              return true; // Show for all days if not specified
            }
            return phase.weekDays.includes(dayOfWeek);
          });

          return (
            <Box
              key={`day-${dayOfWeek}`}
              sx={{
                position: 'relative',
                minHeight: '600px',
                borderRight: dayIndex < 6 ? '1px solid #e0e0e0' : 'none',
                backgroundColor: 'grey.50'
              }}
            >
              {/* Відображаємо фази як суцільні прямокутники */}
              {phases.map((phase) => {
                const startMinutes = timeToMinutes(phase.startTime);
                const endMinutes = timeToMinutes(phase.endTime);
                // Замість жорстко заданого '09:00' використовуємо startTime
                const startTimeMinutes = timeToMinutes(startTime);
                
                // Розраховуємо позицію та висоту прямокутника
                const startDiff = startMinutes - startTimeMinutes;
                const top = (startDiff / 60) * 40 + Math.floor(startDiff / 60) * 1; // 40px на годину + бордери
                
                const duration = endMinutes - startMinutes;
                const height = (duration / 60) * 40 + Math.floor(duration / 60) * 1; // 40px на годину + бордери
                
                return (
                  <Box
                    key={`${dayOfWeek}-${phase.id}`}
                    sx={{
                      position: 'absolute',
                      top: `${top}px`,
                      left: '2px',
                      right: '2px',
                      height: `${height}px`,
                      backgroundColor: phase.color,
                      opacity: 0.7, // 70% прозорість тільки для кольору
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid rgba(0,0,0,0.1)',
                      borderRadius: '2px',
                      cursor: onEditPhase ? 'pointer' : 'default',
                      '&:hover': {
                        opacity: 0.9 // 90% прозорість при hover
                      }
                    }}
                    title={`${phase.name} (${phase.startTime}-${phase.endTime})`}
                    onClick={onEditPhase ? () => onEditPhase(phase) : undefined}
                  >
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        fontSize: '0.7rem',
                        color: 'white',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.7)',
                        textAlign: 'center',
                        padding: '2px',
                        lineHeight: 1
                      }}
                    >
                      {phase.name}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {/* Легенда */}
      {displayPhases.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle2" sx={{ width: '100%', mb: 1 }}>
            Legend:
          </Typography>
          {displayPhases
            .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
            .map((phase) => (
            <Box 
              key={phase.id}
              sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 0.5,
                p: 0.5,
                borderRadius: 1,
                backgroundColor: phase.color,
                opacity: 0.7,
                color: 'white',
                fontWeight: 'bold',
                fontSize: '0.8rem'
              }}
            >
              <Box 
                sx={{ 
                  width: 12, 
                  height: 12, 
                  borderRadius: '50%', 
                  backgroundColor: 'white',
                  border: '1px solid rgba(255,255,255,0.3)'
                }} 
              />
              <Typography variant="caption" sx={{ color: 'white', fontWeight: 'bold' }}>
                {phase.name} ({phase.startTime}-{phase.endTime})
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
};

export default PhasesCalendar; 