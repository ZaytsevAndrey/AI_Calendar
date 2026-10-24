import { microsoftEventExtras } from './map-microsoft-preview';

describe('microsoftEventExtras', () => {
  it('maps Outlook body, meeting link, and people', () => {
    const extras = microsoftEventExtras({
      subject: 'Customer call',
      bodyPreview: 'Customer call',
      body: { contentType: 'html', content: '<p>Agenda</p>' },
      location: { displayName: 'Contoso HQ' },
      locations: [{ displayName: 'Contoso HQ' }, { displayName: 'Building B' }],
      showAs: 'busy',
      importance: 'high',
      sensitivity: 'confidential',
      webLink: 'https://outlook.office.com/calendar/item/1',
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/1', tollNumber: '+1555' },
      attendees: [
        {
          type: 'required',
          emailAddress: { name: 'Sam', address: 'sam@contoso.com' },
          status: { response: 'accepted' },
        },
        {
          type: 'optional',
          emailAddress: { name: 'Lee', address: 'lee@contoso.com' },
          status: { response: 'notResponded' },
        },
      ],
      organizer: { emailAddress: { name: 'Sam', address: 'sam@contoso.com' } },
      isReminderOn: true,
      reminderMinutesBeforeStart: 15,
      categories: ['Client'],
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] } },
      hasAttachments: true,
      createdDateTime: '2026-10-01T00:00:00.000Z',
    });

    expect(extras.description).toBe('Customer call');
    expect(extras.location).toBe('Contoso HQ');
    expect(extras.htmlLink).toContain('outlook.office.com');
    expect(extras.preview?.descriptionHtml).toBe('<p>Agenda</p>');
    expect(extras.preview?.joinLinks?.[0].url).toContain('teams.microsoft.com');
    expect(extras.preview?.locations).toEqual(['Building B']);
    expect(extras.preview?.importance).toBe('high');
    expect(extras.preview?.sensitivity).toBe('confidential');
    expect(extras.preview?.showAs).toBe('busy');
    expect(extras.preview?.categories).toEqual(['Client']);
    expect(extras.preview?.hasAttachments).toBe(true);
    expect(extras.preview?.recurrenceText).toBe('weekly · monday, wednesday');
    expect(extras.attendees?.[1]).toMatchObject({ optional: true, responseStatus: 'needsAction' });
    expect(extras.reminders?.overrides?.[0].minutes).toBe(15);
    expect(extras.preview?.importance).not.toBe('normal');
  });

  it('drops normal importance', () => {
    const extras = microsoftEventExtras({ importance: 'normal', showAs: 'free' });
    expect(extras.preview?.importance).toBeUndefined();
    expect(extras.preview?.showAs).toBe('free');
    expect(extras.transparency).toBe('transparent');
  });
});
