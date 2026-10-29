import { buildEventPreviewFacts, descriptionSources } from './eventPreviewFacts';
import { previewMockEvents, previewMockTask } from './previewMockEvents';

describe('buildEventPreviewFacts', () => {
  it('hides empty rows and shows a link when the place is a url', () => {
    const facts = buildEventPreviewFacts(
      {
        id: 'e1',
        summary: 'Standup',
        provider: 'google',
        start: { dateTime: '2026-10-24T10:00:00.000Z' },
        end: { dateTime: '2026-10-24T10:30:00.000Z' },
        location: 'https://maps.example.com/hq',
        status: 'confirmed',
      },
      null,
    );
    const location = facts.find((fact) => fact.id === 'location');
    expect(location).toMatchObject({
      kind: 'links',
      links: [{ url: 'https://maps.example.com/hq' }],
    });
    expect(facts.find((fact) => fact.id === 'join')).toBeUndefined();
    expect(facts.find((fact) => fact.id === 'comment')).toBeUndefined();
  });

  it('fills provider rows and task rows on the three samples', () => {
    const [google, outlook, apple] = previewMockEvents();
    const googleFacts = buildEventPreviewFacts(google, previewMockTask(google.id), 'Work');
    expect(googleFacts.map((fact) => fact.id)).toEqual(
      expect.arrayContaining([
        'calendar',
        'kind',
        'join',
        'phone',
        'open',
        'attachments',
        'source',
        'attendees',
        'type',
        'phase',
        'priority',
        'allowSplit',
      ]),
    );
    // The sample task is a fixed series: type is the behavior, repeating its own row.
    expect(googleFacts.find((fact) => fact.id === 'type')).toMatchObject({ text: 'fixed' });
    expect(googleFacts.some((fact) => fact.id === 'recurrence')).toBe(true);
    const outlookFacts = buildEventPreviewFacts(outlook, null);
    expect(outlookFacts.find((fact) => fact.id === 'importance')).toMatchObject({ text: 'high' });
    expect(outlookFacts.find((fact) => fact.id === 'attachments')).toMatchObject({ text: 'yes' });
    const appleFacts = buildEventPreviewFacts(apple, null);
    expect(appleFacts.find((fact) => fact.id === 'applePriority')).toMatchObject({ text: '1' });
    expect(appleFacts.find((fact) => fact.id === 'comment')).toMatchObject({ text: 'Park on the street' });
    expect(descriptionSources(google, previewMockTask(google.id)).html).toContain('<strong>');
    expect(descriptionSources(google, previewMockTask(google.id)).plain).toContain('Quarterly planning');
    expect(descriptionSources(google, previewMockTask(google.id)).plain).not.toContain('<p>');
  });
});
