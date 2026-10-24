import { googleEventExtras } from './map-google-preview';

describe('googleEventExtras', () => {
  it('keeps join links, people, and html notes', () => {
    const extras = googleEventExtras({
      description: '<p>See <a href="https://example.com">notes</a></p>',
      htmlLink: 'https://calendar.google.com/event?eid=1',
      transparency: 'opaque',
      visibility: 'private',
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      conferenceData: {
        conferenceSolution: { name: 'Google Meet' },
        entryPoints: [
          { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij', label: 'meet' },
          { entryPointType: 'phone', uri: 'tel:+15550102', label: '+1 555 0102' },
        ],
      },
      organizer: { email: 'ada@example.com', displayName: 'Ada', self: true },
      attendees: [
        { email: 'ada@example.com', displayName: 'Ada', responseStatus: 'accepted', self: true },
        { email: 'grace@example.com', displayName: 'Grace', responseStatus: 'tentative', optional: true },
      ],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      attachments: [{ title: 'Brief.pdf', fileUrl: 'https://example.com/brief.pdf' }],
      source: { title: 'From Gmail', url: 'https://mail.google.com/mail/sample' },
      eventType: 'focusTime',
      created: '2026-10-01T10:00:00.000Z',
      updated: '2026-10-02T10:00:00.000Z',
    });

    expect(extras.htmlLink).toBe('https://calendar.google.com/event?eid=1');
    expect(extras.attendees).toHaveLength(2);
    expect(extras.organizer?.displayName).toBe('Ada');
    expect(extras.preview?.joinLinks?.map((link) => link.url)).toEqual([
      'https://meet.google.com/abc-defg-hij',
    ]);
    expect(extras.preview?.phones).toEqual(['+1 555 0102']);
    expect(extras.preview?.descriptionHtml).toContain('<p>');
    expect(extras.preview?.eventKind).toBe('focusTime');
    expect(extras.preview?.showAs).toBe('busy');
    expect(extras.preview?.sensitivity).toBe('private');
    expect(extras.preview?.attachments?.[0]).toEqual({
      label: 'Brief.pdf',
      url: 'https://example.com/brief.pdf',
    });
    expect(extras.preview?.source).toEqual({
      label: 'From Gmail',
      url: 'https://mail.google.com/mail/sample',
    });
    expect(extras.reminders?.overrides?.[0]).toEqual({ method: 'popup', minutes: 10 });
    expect(extras.created).toBe('2026-10-01T10:00:00.000Z');
  });

  it('omits empty preview details', () => {
    expect(googleEventExtras({ summary: 'Standup' }).preview).toBeUndefined();
  });
});
