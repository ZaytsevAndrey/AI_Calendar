import { buildLifestylePresetBlocks } from './lifestyle-presets';

function block(
  preset: 'working' | 'student' | 'open',
  wake: string,
  sleep: string,
  name: string,
) {
  return buildLifestylePresetBlocks(preset, wake, sleep).find(
    (item) => item.name === name,
  );
}

describe('buildLifestylePresetBlocks', () => {
  it('places a working day inside a long awake window', () => {
    const blocks = buildLifestylePresetBlocks('working', '08:00', '23:00');
    expect(blocks.map((item) => item.name)).toEqual([
      'Deep work',
      'Meetings',
      'Life admin',
    ]);
    expect(block('working', '08:00', '23:00', 'Deep work')).toMatchObject({
      startTime: '08:00',
      endTime: '11:00',
    });
    expect(block('working', '08:00', '23:00', 'Meetings')).toMatchObject({
      startTime: '11:00',
      endTime: '14:00',
    });
    expect(block('working', '08:00', '23:00', 'Life admin')).toMatchObject({
      startTime: '21:00',
      endTime: '23:00',
    });
  });

  it('drops the block before sleep when earlier blocks already fill the window', () => {
    const blocks = buildLifestylePresetBlocks('working', '08:00:00', '14:00:00');
    expect(blocks.map((item) => item.name)).toEqual(['Deep work', 'Meetings']);
    expect(blocks[1]).toMatchObject({ startTime: '11:00', endTime: '14:00' });
  });

  it('shrinks the last after-wake block and drops anything under 30 minutes', () => {
    const blocks = buildLifestylePresetBlocks('working', '08:00', '12:30');
    expect(blocks.map((item) => [item.name, item.startTime, item.endTime])).toEqual([
      ['Deep work', '08:00', '11:00'],
      ['Meetings', '11:00', '12:30'],
    ]);

    expect(buildLifestylePresetBlocks('working', '08:00', '08:20')).toEqual([]);
  });

  it('fills the gap on an open day and keeps wind down', () => {
    const blocks = buildLifestylePresetBlocks('open', '08:00', '16:00');
    expect(blocks.map((item) => [item.name, item.startTime, item.endTime])).toEqual([
      ['Morning focus', '08:00', '11:00'],
      ['Errands', '11:00', '13:00'],
      ['Wind down', '14:00', '16:00'],
      ['Personal projects', '13:00', '14:00'],
    ]);
  });

  it('extends personal projects to sleep when wind down does not fit', () => {
    expect(
      buildLifestylePresetBlocks('open', '08:00', '13:00').map((item) => item.name),
    ).toEqual(['Morning focus', 'Errands']);
  });

  it('wraps clocks when the awake window crosses midnight', () => {
    const blocks = buildLifestylePresetBlocks('student', '22:00', '06:00');
    expect(blocks.map((item) => [item.name, item.startTime, item.endTime])).toEqual([
      ['Classes', '22:00', '02:00'],
      ['Study', '02:00', '05:00'],
      ['Free time', '05:00', '06:00'],
    ]);
  });
});
